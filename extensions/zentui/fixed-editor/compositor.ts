/**
 * TerminalSplitCompositor — pins editor/footer at the bottom of the terminal
 * while the transcript scrolls above, using terminal scroll regions + alt screen.
 *
 * This patches Pi's internal TUI methods. It is inherently fragile across Pi
 * versions. All patches include capability checks and silent fallback.
 *
 * Adapted from @tifan/pi-fixed-editor (MIT) by Tifan Dwi Avianto, which was
 * itself adapted from pi-powerline-footer (MIT) by Nico Bailon.
 *
 * @internal
 */

import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { renderCluster } from "./cluster";
import { clampScrollOffset, parseKeyboardScroll, parseMouseEvent } from "./input";
import type {
	PiFixedEditorCapabilities,
	PiMethodCapability,
	PiRenderableCapability,
} from "./pi-compat";
import { highlightSelection, SelectionState } from "./selection";
import {
	CLEAR_LINE,
	cursorTo,
	DISABLE_ALT_SCROLL,
	DISABLE_AUTOWRAP,
	DISABLE_MOUSE,
	ENABLE_ALT_SCROLL,
	ENABLE_AUTOWRAP,
	ENABLE_MOUSE_SGR,
	ENTER_ALT_SCREEN,
	EXIT_ALT_SCREEN,
	emergencyTerminalReset,
	HIDE_CURSOR,
	RESET_SCROLL_REGION,
	SHOW_CURSOR,
	SYNC_BEGIN,
	SYNC_END,
	setScrollRegion,
} from "./terminal-modes";
import type { ClusterRender, CompositorConfig } from "./types";

function replaceMethod(
	capability: PiMethodCapability,
	method: (...args: unknown[]) => unknown,
): void {
	const descriptor = capability.ownDescriptor;
	Object.defineProperty(capability.target, capability.key, {
		...(descriptor ?? { configurable: true, enumerable: false, writable: true }),
		value: method,
	});
}

function restoreMethod(capability: PiMethodCapability): void {
	if (capability.ownDescriptor) {
		Object.defineProperty(capability.target, capability.key, capability.ownDescriptor);
	} else {
		Reflect.deleteProperty(capability.target, capability.key);
	}
}

function hideRenderable(capability: PiRenderableCapability | null): void {
	if (!capability) return;
	Object.defineProperty(capability.target, "render", {
		...(capability.ownDescriptor ?? { configurable: true, enumerable: false, writable: true }),
		value: () => [],
	});
}

function restoreRenderable(capability: PiRenderableCapability | null): void {
	if (!capability) return;
	if (capability.ownDescriptor) {
		Object.defineProperty(capability.target, "render", capability.ownDescriptor);
	} else {
		Reflect.deleteProperty(capability.target, "render");
	}
}

function sanitizeLine(line: string, width: number): string {
	return visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line;
}

export class TerminalSplitCompositor {
	private readonly capabilities: PiFixedEditorCapabilities;
	private readonly getConfig: () => CompositorConfig;
	private inputListener:
		| ((data: string) => { consume?: boolean; data?: string } | undefined)
		| null = null;
	private inputListenerDisposer: (() => void) | null = null;
	private emergencyCleanup: (() => void) | null = null;

	private installed = false;
	private disposed = false;
	private terminalModesEntered = false;
	private writing = false;
	private renderingCluster = false;
	private checkingOverlay = false;

	private scrollOffset = 0;
	private maxScrollOffset = 0;
	private lastRootLineCount = 0;

	/** Root lines from last renderScrollableRoot — used for selection text extraction. */
	private rootLines: string[] = [];
	/** Absolute start index of visible window in rootLines. */
	private visibleRootStart = 0;
	/** Height of the scrollable region in last render. */
	private visibleScrollableRows = 0;

	/** Selection state for app-level drag-to-select. */
	private readonly selection = new SelectionState();
	/** Timer for right-click context menu mouse reporting pause. */
	private mouseResumeTimer: ReturnType<typeof setTimeout> | null = null;
	private cursorVisible = true;

	private readonly onCopy: (() => void) | null;
	private readonly onDismissNotice: (() => void) | null;

	private cachedClusterRender: { width: number; rows: number; render: ClusterRender } | null = null;

	constructor(
		capabilities: PiFixedEditorCapabilities,
		getConfig: () => CompositorConfig,
		onCopy?: () => void,
		onDismissNotice?: () => void,
	) {
		this.capabilities = capabilities;
		this.getConfig = getConfig;
		this.onCopy = onCopy ?? null;
		this.onDismissNotice = onDismissNotice ?? null;
	}

	install(): boolean {
		if (this.installed) return true;
		if (this.disposed) return false;
		const cluster = this.capabilities.cluster;
		try {
			for (const component of [
				cluster.status,
				cluster.aboveWidget,
				cluster.editor,
				cluster.belowWidget,
				cluster.footer,
			]) {
				hideRenderable(component);
			}
			Object.defineProperty(this.capabilities.terminal, "rows", {
				configurable: true,
				get: () => this.getScrollableRows(),
			});
			replaceMethod(this.capabilities.renderMethod, (width) =>
				this.renderScrollableRoot(Number(width)),
			);
			replaceMethod(this.capabilities.doRenderMethod, () => {
				this.cachedClusterRender = null;
				try {
					this.callOriginalDoRender();
					this.requestRepaint();
				} catch {
					// If doRender throws, the original write already happened.
				}
			});
			replaceMethod(this.capabilities.writeMethod, (data) => this.write(String(data)));

			this.inputListener = (data) => this.handleInput(data);
			const inputListenerDisposer = this.capabilities.addInputListener(this.inputListener);
			if (typeof inputListenerDisposer !== "function") {
				throw new TypeError("Invalid input listener disposer");
			}
			this.inputListenerDisposer = inputListenerDisposer as () => void;
			this.emergencyCleanup = () => {
				if (!this.disposed) this.restoreForExit();
			};
			process.once("exit", this.emergencyCleanup);

			this.terminalModesEntered = true;
			this.callOriginalWrite(
				SYNC_BEGIN +
					ENTER_ALT_SCREEN +
					DISABLE_ALT_SCROLL +
					(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
					SYNC_END,
			);
			this.installed = true;
		} catch {
			this.rollbackInstallation();
			return false;
		}
		try {
			this.capabilities.requestRender?.(true);
		} catch {}
		return true;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (!this.installed) return;
		this.clearInputListener();
		if (this.mouseResumeTimer) {
			clearTimeout(this.mouseResumeTimer);
			this.mouseResumeTimer = null;
		}
		if (this.emergencyCleanup) {
			process.removeListener("exit", this.emergencyCleanup);
			this.emergencyCleanup = null;
		}
		this.restorePatchedCapabilities();
		this.restoreForExit();
		this.terminalModesEntered = false;
		this.installed = false;
		try {
			this.capabilities.requestRender?.(true);
		} catch {}
	}

	private rollbackInstallation(): void {
		this.clearInputListener();
		if (this.emergencyCleanup) {
			process.removeListener("exit", this.emergencyCleanup);
			this.emergencyCleanup = null;
		}
		this.restorePatchedCapabilities();
		if (this.terminalModesEntered) this.restoreForExit();
		this.terminalModesEntered = false;
		this.installed = false;
	}

	private clearInputListener(): void {
		const listener = this.inputListener;
		const disposer = this.inputListenerDisposer;
		this.inputListener = null;
		this.inputListenerDisposer = null;
		let disposed = false;
		if (disposer) {
			try {
				disposer();
				disposed = true;
			} catch {}
		}
		if (!disposed && listener) {
			try {
				this.capabilities.removeInputListener(listener);
			} catch {}
		}
	}

	private restorePatchedCapabilities(): void {
		restoreMethod(this.capabilities.writeMethod);
		restoreMethod(this.capabilities.doRenderMethod);
		restoreMethod(this.capabilities.renderMethod);
		for (const component of [
			this.capabilities.cluster.status,
			this.capabilities.cluster.aboveWidget,
			this.capabilities.cluster.editor,
			this.capabilities.cluster.belowWidget,
			this.capabilities.cluster.footer,
		]) {
			restoreRenderable(component);
		}
		if (this.capabilities.rowsOwnDescriptor) {
			Object.defineProperty(
				this.capabilities.terminal,
				"rows",
				this.capabilities.rowsOwnDescriptor,
			);
		} else {
			Reflect.deleteProperty(this.capabilities.terminal, "rows");
		}
	}

	private callOriginalWrite(data: string): void {
		Reflect.apply(this.capabilities.writeMethod.method, this.capabilities.terminal, [data]);
	}

	private callOriginalDoRender(): void {
		Reflect.apply(this.capabilities.doRenderMethod.method, this.capabilities.tui, []);
	}

	private callOriginalRender(width: number): string[] {
		return Reflect.apply(this.capabilities.renderMethod.method, this.capabilities.tui, [
			width,
		]) as string[];
	}

	private getRawRows(): number {
		return Math.max(2, this.capabilities.readRawRows());
	}

	private getClusterRender(width: number, rawRows: number): ClusterRender {
		if (this.cachedClusterRender?.width === width && this.cachedClusterRender?.rows === rawRows) {
			return this.cachedClusterRender.render;
		}
		const wasRendering = this.renderingCluster;
		this.renderingCluster = true;
		try {
			const render = renderCluster(this.capabilities.cluster, width, rawRows);
			this.cachedClusterRender = { width, rows: rawRows, render };
			return render;
		} finally {
			this.renderingCluster = wasRendering;
		}
	}

	private getScrollableRows(): number {
		if (
			this.disposed ||
			this.writing ||
			this.renderingCluster ||
			this.checkingOverlay ||
			this.hasVisibleOverlay()
		) {
			return this.getRawRows();
		}
		const rawRows = this.getRawRows();
		const width = Math.max(1, this.capabilities.getColumns() || 80);
		const cluster = this.getClusterRender(width, rawRows);
		return Math.max(1, rawRows - cluster.lines.length);
	}

	private hasVisibleOverlay(): boolean {
		if (this.checkingOverlay) return false;
		this.checkingOverlay = true;
		try {
			return this.capabilities.hasVisibleOverlay();
		} finally {
			this.checkingOverlay = false;
		}
	}

	private renderScrollableRoot(width: number): string[] {
		if (this.disposed) return this.callOriginalRender(width);

		if (this.hasVisibleOverlay()) return this.callOriginalRender(width);

		const rawRows = this.getRawRows();
		const cluster = this.getClusterRender(Math.max(1, width), rawRows);
		const scrollableRows = Math.max(1, rawRows - cluster.lines.length);

		const lines = this.callOriginalRender(Math.max(1, width));

		// Adjust scroll offset when new content arrives while scrolled up.
		if (
			this.scrollOffset > 0 &&
			this.lastRootLineCount > 0 &&
			lines.length > this.lastRootLineCount
		) {
			this.scrollOffset += lines.length - this.lastRootLineCount;
		}
		this.lastRootLineCount = lines.length;
		this.maxScrollOffset = Math.max(0, lines.length - scrollableRows);
		this.scrollOffset = clampScrollOffset(this.scrollOffset, this.maxScrollOffset);

		const start = Math.max(0, lines.length - scrollableRows - this.scrollOffset);
		const visible = lines.slice(start, start + scrollableRows);
		while (visible.length < scrollableRows) visible.push("");

		// Store for selection mapping and text extraction.
		this.rootLines = lines;
		this.visibleRootStart = start;
		this.visibleScrollableRows = scrollableRows;

		// Apply selection highlight to visible lines.
		return visible.map((line, i) => highlightSelection(line, start + i, this.selection));
	}

	private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
		if (this.disposed || this.hasVisibleOverlay()) return undefined;
		this.onDismissNotice?.();

		const mouseScroll = this.getConfig().mouseScroll;
		if (mouseScroll) {
			const mouseEv = parseMouseEvent(data);
			if (mouseEv) {
				this.handleMouseEvent(mouseEv);
				return { consume: true };
			}
		}

		const keyboard = parseKeyboardScroll(data);
		if (!keyboard) return undefined;

		if (keyboard.action === "jumpBottom") {
			this.scrollOffset = 0;
			this.selection.clear();
			this.capabilities.requestRender?.();
			return undefined; // Let Enter propagate to the editor.
		}

		const rawRows = this.getRawRows();
		const scrollableRows = Math.max(
			1,
			rawRows - this.getClusterRender(this.capabilities.getColumns() || 80, rawRows).lines.length,
		);

		if (keyboard.action === "pageUp") {
			const before = this.scrollOffset;
			this.selection.clear();
			this.scrollBy(scrollableRows);
			return this.scrollOffset !== before ? { consume: true } : undefined;
		}
		if (keyboard.action === "pageDown") {
			const before = this.scrollOffset;
			this.selection.clear();
			this.scrollBy(-scrollableRows);
			return this.scrollOffset !== before ? { consume: true } : undefined;
		}

		return { consume: true };
	}

	private handleMouseEvent(ev: { button: string; action: string; col: number; row: number }): void {
		// Wheel scroll.
		if (ev.button === "wheel-up" && ev.action === "press") {
			this.selection.clear();
			this.scrollBy(3);
			return;
		}
		if (ev.button === "wheel-down" && ev.action === "press") {
			this.selection.clear();
			this.scrollBy(-3);
			return;
		}

		// Right-click: pause mouse reporting for native context menu.
		if (ev.button === "right" && ev.action === "press") {
			const selectedText = this.selection.active
				? this.selection.getSelectedText(this.rootLines)
				: "";
			if (selectedText) {
				void copyToClipboard(selectedText);
			}
			this.selection.clear();
			this.pauseMouseReporting();
			this.capabilities.requestRender?.();
			return;
		}

		// Only left button is used for drag-select.
		if (ev.button !== "left") return;

		// Ignore clicks in the cluster region (below scrollable area).
		if (ev.row > this.visibleScrollableRows) return;

		// Map screen row to transcript line index.
		const lineIndex = this.visibleRootStart + ev.row - 1;
		const col = Math.max(0, ev.col - 1);

		if (ev.action === "press") {
			this.selection.start(lineIndex, col);
			this.capabilities.requestRender?.();
			return;
		}
		if (ev.action === "drag" && this.selection.isDragging) {
			this.selection.extend(lineIndex, col + 1);
			this.capabilities.requestRender?.();
			return;
		}
		if (ev.action === "release" && this.selection.isDragging) {
			this.selection.extend(lineIndex, col + 1);
			this.selection.setDragging(false);
			const text = this.selection.getSelectedText(this.rootLines);
			this.selection.clear();
			this.capabilities.requestRender?.();
			if (text) {
				void copyToClipboard(text);
				if (this.getConfig().copyNotice) this.onCopy?.();
			}
			return;
		}
	}

	/** Temporarily disable mouse reporting so the terminal's native context menu works. */
	private pauseMouseReporting(): void {
		if (this.mouseResumeTimer) clearTimeout(this.mouseResumeTimer);
		this.callOriginalWrite(SYNC_BEGIN + DISABLE_MOUSE + SYNC_END);
		this.mouseResumeTimer = setTimeout(() => {
			this.mouseResumeTimer = null;
			if (!this.disposed) {
				this.callOriginalWrite(SYNC_BEGIN + ENABLE_MOUSE_SGR + SYNC_END);
			}
		}, 1200);
		if (typeof this.mouseResumeTimer === "object" && "unref" in this.mouseResumeTimer) {
			(this.mouseResumeTimer as { unref: () => void }).unref();
		}
	}

	private scrollBy(delta: number): void {
		const next = clampScrollOffset(this.scrollOffset + delta, this.maxScrollOffset);
		if (next === this.scrollOffset) return;
		this.scrollOffset = next;
		this.capabilities.requestRender?.();
	}

	private paintCluster(cluster: ClusterRender, rawRows: number, width: number): string {
		if (cluster.lines.length === 0) return "";
		const startRow = Math.max(1, rawRows - cluster.lines.length + 1);
		let buf = RESET_SCROLL_REGION;
		for (let i = 0; i < cluster.lines.length; i++) {
			buf += cursorTo(startRow + i, 1) + CLEAR_LINE + sanitizeLine(cluster.lines[i] ?? "", width);
		}
		if (cluster.cursor) {
			buf += cursorTo(startRow + cluster.cursor.row, Math.max(1, cluster.cursor.col + 1));
			if (!this.cursorVisible) {
				buf += SHOW_CURSOR;
				this.cursorVisible = true;
			}
		} else if (this.cursorVisible) {
			buf += HIDE_CURSOR;
			this.cursorVisible = false;
		}
		return buf;
	}

	/**
	 * Restore the cursor to the row Pi's differential renderer expects.
	 *
	 * `setScrollRegion` (DECSTBM) homes the cursor to row 1, col 1, but Pi's
	 * `doRender` emits *relative* cursor moves (CUU/CUD/`\r`) computed from
	 * its tracked `hardwareCursorRow`. Without repositioning, a sparse
	 * differential update (e.g. one selection-highlighted line) is written
	 * at the wrong row because the relative move departs from (1,1)
	 * instead of the tracked row.
	 */
	private syncTuiCursor(scrollBottom: number): string {
		const { hardwareCursorRow, previousViewportTop: viewportTop } =
			this.capabilities.getCursorBookkeeping();
		const row = Math.max(1, Math.min(scrollBottom, hardwareCursorRow - viewportTop + 1));
		return cursorTo(row, 1);
	}

	private requestRepaint(): void {
		if (this.disposed || this.hasVisibleOverlay()) return;
		const rawRows = this.getRawRows();
		const width = Math.max(1, this.capabilities.getColumns() || 80);
		const cluster = this.getClusterRender(width, rawRows);
		if (cluster.lines.length === 0) return;
		this.callOriginalWrite(
			SYNC_BEGIN +
				DISABLE_AUTOWRAP +
				this.paintCluster(cluster, rawRows, width) +
				ENABLE_AUTOWRAP +
				(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
				SYNC_END,
		);
	}

	private write(data: string): void {
		if (this.disposed || this.writing || this.hasVisibleOverlay()) {
			this.callOriginalWrite(data);
			return;
		}
		this.writing = true;
		try {
			const rawRows = this.getRawRows();
			const width = Math.max(1, this.capabilities.getColumns() || 80);
			const cluster = this.getClusterRender(width, rawRows);
			const reservedRows = cluster.lines.length;
			if (reservedRows === 0 || rawRows <= 2) {
				this.callOriginalWrite(data);
				return;
			}
			const scrollBottom = Math.max(1, rawRows - reservedRows);
			this.callOriginalWrite(
				SYNC_BEGIN +
					DISABLE_AUTOWRAP +
					setScrollRegion(1, scrollBottom) +
					this.syncTuiCursor(scrollBottom) +
					data +
					this.paintCluster(cluster, rawRows, width) +
					ENABLE_AUTOWRAP +
					(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
					SYNC_END,
			);
		} finally {
			this.writing = false;
		}
	}

	private restoreTerminalState(): void {
		this.callOriginalWrite(
			SYNC_BEGIN +
				RESET_SCROLL_REGION +
				DISABLE_MOUSE +
				ENABLE_ALT_SCROLL +
				EXIT_ALT_SCREEN +
				SHOW_CURSOR +
				SYNC_END,
		);
	}

	private restoreForExit(): void {
		try {
			this.restoreTerminalState();
		} catch {
			// Process-exit cleanup cannot report errors and must not throw.
		}
	}
}

/** Export for the emergency reset test. */
export { emergencyTerminalReset };
