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

import {
	buildCluster,
	type FixedCluster,
	findEditorContainerIndex,
	hideRenderable,
	renderCluster,
	restoreRenderable,
} from "./cluster";
import { clampScrollOffset, parseKeyboardScroll, parseMouseEvent } from "./input";
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
import type { ClusterRender, CompositorConfig, TerminalLike, TuiLike } from "./types";

/** Property descriptor for the original `terminal.rows` getter. */
type RowsDescriptor = PropertyDescriptor | undefined;

function descriptorForRows(terminal: TerminalLike): RowsDescriptor {
	let target: object | null = terminal;
	while (target) {
		const descriptor = Object.getOwnPropertyDescriptor(target, "rows");
		if (descriptor) return descriptor;
		target = Object.getPrototypeOf(target);
	}
	return undefined;
}

function readRawRows(terminal: TerminalLike, descriptor: RowsDescriptor): number {
	if (descriptor?.get) {
		const value = descriptor.get.call(terminal);
		return typeof value === "number" && Number.isFinite(value) ? value : 24;
	}
	if (descriptor && "value" in descriptor) {
		const value = descriptor.value;
		return typeof value === "number" && Number.isFinite(value) ? value : 24;
	}
	const value = Reflect.get(terminal, "rows");
	return typeof value === "number" && Number.isFinite(value) ? value : 24;
}

function sanitizeLine(line: string, width: number): string {
	return visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line;
}

export class TerminalSplitCompositor {
	private readonly tui: TuiLike;
	private readonly terminal: TerminalLike;
	private readonly getConfig: () => CompositorConfig;
	private cluster: FixedCluster | null = null;

	private readonly rowsDescriptor: RowsDescriptor;
	private readonly originalWrite: (data: string) => void;
	private readonly originalDoRender: (() => void) | null;
	private readonly originalRender: ((width: number) => string[]) | null;
	private removeInputListener: (() => void) | null = null;
	private emergencyCleanup: (() => void) | null = null;

	private installed = false;
	private disposed = false;
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

	private readonly notify: ((message: string, type?: "info" | "warning" | "error") => void) | null;

	private cachedClusterRender: { width: number; rows: number; render: ClusterRender } | null = null;

	constructor(
		tui: TuiLike,
		terminal: TerminalLike,
		getConfig: () => CompositorConfig,
		notify?: (message: string, type?: "info" | "warning" | "error") => void,
	) {
		this.tui = tui;
		this.terminal = terminal;
		this.getConfig = getConfig;
		this.notify = notify ?? null;
		this.rowsDescriptor = descriptorForRows(terminal);
		this.originalWrite = terminal.write.bind(terminal);
		this.originalDoRender = typeof tui.doRender === "function" ? tui.doRender.bind(tui) : null;
		this.originalRender = typeof tui.render === "function" ? tui.render.bind(tui) : null;
	}

	/** Install all patches. Returns true on success, false if capabilities missing. */
	install(): boolean {
		if (this.installed) return true;
		if (typeof this.terminal.write !== "function") return false;
		if (typeof this.tui.addInputListener !== "function") return false;
		if (!this.originalDoRender || !this.originalRender) return false;

		const children = this.tui.children;
		if (!Array.isArray(children) || children.length < 3) return false;

		const editorIdx = findEditorContainerIndex(children, this.tui.focusedComponent);
		if (editorIdx === undefined) return false;

		const cluster = buildCluster(children, editorIdx);
		if (!cluster) return false;
		this.cluster = cluster;

		// Hide cluster components from Pi's normal render so they don't appear
		// in the scrollable transcript. Their original render output is captured
		// via __zentuiOriginalRender and painted separately by paintCluster.
		for (const component of [
			cluster.status,
			cluster.aboveWidget,
			cluster.editor,
			cluster.belowWidget,
			cluster.footer,
		]) {
			hideRenderable(component);
		}

		// Enter terminal modes.
		this.originalWrite(
			SYNC_BEGIN +
				ENTER_ALT_SCREEN +
				DISABLE_ALT_SCROLL +
				(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
				SYNC_END,
		);

		// Emergency cleanup on crash.
		this.emergencyCleanup = () => {
			if (!this.disposed) this.restoreForExit();
		};
		process.once("exit", this.emergencyCleanup);

		// Redefine terminal.rows so Pi renders only the scrollable region.
		Object.defineProperty(this.terminal, "rows", {
			configurable: true,
			get: () => this.getScrollableRows(),
		});

		// Patch tui.render to apply scroll offset.
		this.tui.render = (width: number) => this.renderScrollableRoot(width);

		// Patch tui.doRender to paint cluster after original render.
		this.tui.doRender = () => {
			this.cachedClusterRender = null; // Invalidate cluster cache per render pass.
			try {
				this.originalDoRender?.();
				this.requestRepaint();
			} catch {
				// If doRender throws, the original write already happened.
			}
		};

		// Patch terminal.write to wrap in scroll region.
		this.terminal.write = (data: string) => this.write(data);

		// Register input listener for scroll.
		this.removeInputListener = this.tui.addInputListener((data: string) => this.handleInput(data));

		this.installed = true;
		this.tui.requestRender?.(true);
		return true;
	}

	/** Full teardown — restore all patches, reset terminal modes. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		this.removeInputListener?.();
		this.removeInputListener = null;

		if (this.mouseResumeTimer) {
			clearTimeout(this.mouseResumeTimer);
			this.mouseResumeTimer = null;
		}

		if (this.emergencyCleanup) {
			process.removeListener("exit", this.emergencyCleanup);
			this.emergencyCleanup = null;
		}

		this.terminal.write = this.originalWrite;
		if (this.originalDoRender) this.tui.doRender = this.originalDoRender;
		if (this.originalRender) this.tui.render = this.originalRender;

		// Restore cluster components' original render methods.
		if (this.cluster) {
			for (const component of [
				this.cluster.status,
				this.cluster.aboveWidget,
				this.cluster.editor,
				this.cluster.belowWidget,
				this.cluster.footer,
			]) {
				restoreRenderable(component);
			}
		}

		if (this.rowsDescriptor) {
			Object.defineProperty(this.terminal, "rows", this.rowsDescriptor);
		} else {
			Reflect.deleteProperty(this.terminal, "rows");
		}

		this.restoreTerminalState();
		this.tui.requestRender?.(true);
	}

	private getRawRows(): number {
		return Math.max(2, readRawRows(this.terminal, this.rowsDescriptor));
	}

	private getClusterRender(width: number, rawRows: number): ClusterRender {
		if (this.cachedClusterRender?.width === width && this.cachedClusterRender?.rows === rawRows) {
			return this.cachedClusterRender.render;
		}
		const wasRendering = this.renderingCluster;
		this.renderingCluster = true;
		try {
			const render = this.cluster
				? renderCluster(this.cluster, width, rawRows)
				: { lines: [], cursor: null };
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
		const width = Math.max(1, this.terminal.columns || 80);
		const cluster = this.getClusterRender(width, rawRows);
		return Math.max(1, rawRows - cluster.lines.length);
	}

	private hasVisibleOverlay(): boolean {
		if (this.checkingOverlay) return false;
		this.checkingOverlay = true;
		try {
			if (typeof this.tui.hasOverlay === "function" && this.tui.hasOverlay()) return true;
			const stack = this.tui.overlayStack;
			if (!Array.isArray(stack)) return false;
			return stack.some((entry) => entry && entry.hidden !== true);
		} finally {
			this.checkingOverlay = false;
		}
	}

	private renderScrollableRoot(width: number): string[] {
		if (!this.originalRender || this.disposed) return this.originalRender?.(width) ?? [];

		if (this.hasVisibleOverlay()) {
			return this.originalRender(width);
		}

		const rawRows = this.getRawRows();
		const cluster = this.getClusterRender(Math.max(1, width), rawRows);
		const scrollableRows = Math.max(1, rawRows - cluster.lines.length);

		const lines = this.originalRender(Math.max(1, width));

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
			this.tui.requestRender?.();
			return undefined; // Let Enter propagate to the editor.
		}

		const rawRows = this.getRawRows();
		const scrollableRows = Math.max(
			1,
			rawRows - this.getClusterRender(this.terminal.columns || 80, rawRows).lines.length,
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
			this.repaintViewport();
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
			this.repaintViewport();
			return;
		}
		if (ev.action === "drag" && this.selection.isDragging) {
			this.selection.extend(lineIndex, col);
			this.repaintViewport();
			return;
		}
		if (ev.action === "release" && this.selection.isDragging) {
			this.selection.extend(lineIndex, col);
			this.selection.setDragging(false);
			const text = this.selection.getSelectedText(this.rootLines);
			this.selection.clear();
			this.repaintViewport();
			if (text) {
				void copyToClipboard(text);
				this.notify?.("Copied to clipboard", "info");
			}
			return;
		}
	}

	/** Temporarily disable mouse reporting so the terminal's native context menu works. */
	private pauseMouseReporting(): void {
		if (this.mouseResumeTimer) clearTimeout(this.mouseResumeTimer);
		this.originalWrite(SYNC_BEGIN + DISABLE_MOUSE + SYNC_END);
		this.mouseResumeTimer = setTimeout(() => {
			this.mouseResumeTimer = null;
			if (!this.disposed) {
				this.originalWrite(SYNC_BEGIN + ENABLE_MOUSE_SGR + SYNC_END);
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
		this.repaintViewport();
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

	private requestRepaint(): void {
		if (this.disposed || this.hasVisibleOverlay()) return;
		const rawRows = this.getRawRows();
		const width = Math.max(1, this.terminal.columns || 80);
		const cluster = this.getClusterRender(width, rawRows);
		if (cluster.lines.length === 0) return;
		this.originalWrite(
			SYNC_BEGIN +
				DISABLE_AUTOWRAP +
				this.paintCluster(cluster, rawRows, width) +
				ENABLE_AUTOWRAP +
				(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
				SYNC_END,
		);
	}

	private repaintViewport(): void {
		if (this.disposed || this.writing || this.hasVisibleOverlay()) return;
		const rawRows = this.getRawRows();
		const width = Math.max(1, this.terminal.columns || 80);
		const cluster = this.getClusterRender(width, rawRows);
		const scrollableRows = Math.max(1, rawRows - cluster.lines.length);
		// Re-render scrollable root to get visible lines with current offset.
		const visible = this.renderScrollableRoot(width);
		let buf = SYNC_BEGIN + DISABLE_AUTOWRAP + setScrollRegion(1, scrollableRows) + cursorTo(1, 1);
		for (let row = 0; row < scrollableRows; row++) {
			if (row > 0) buf += "\r\n";
			buf += CLEAR_LINE + sanitizeLine(visible[row] ?? "", width);
		}
		buf += this.paintCluster(cluster, rawRows, width);
		buf +=
			ENABLE_AUTOWRAP +
			(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
			SYNC_END;
		this.originalWrite(buf);
	}

	private write(data: string): void {
		if (this.disposed || this.writing || this.hasVisibleOverlay()) {
			this.originalWrite(data);
			return;
		}
		this.writing = true;
		try {
			const rawRows = this.getRawRows();
			const width = Math.max(1, this.terminal.columns || 80);
			const cluster = this.getClusterRender(width, rawRows);
			const reservedRows = cluster.lines.length;
			if (reservedRows === 0 || rawRows <= 2) {
				this.originalWrite(data);
				return;
			}
			const scrollBottom = Math.max(1, rawRows - reservedRows);
			this.originalWrite(
				SYNC_BEGIN +
					DISABLE_AUTOWRAP +
					setScrollRegion(1, scrollBottom) +
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
		this.originalWrite(
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
