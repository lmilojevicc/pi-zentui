/** Experimental fixed-editor terminal compositor. @internal */

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
	CANONICAL_TERMINAL_RESET,
	CLEAR_LINE,
	cursorTo,
	DISABLE_ALT_SCROLL,
	DISABLE_AUTOWRAP,
	DISABLE_MOUSE,
	ENABLE_AUTOWRAP,
	ENABLE_MOUSE_SGR,
	ENTER_ALT_SCREEN,
	HIDE_CURSOR,
	RESET_SCROLL_REGION,
	SHOW_CURSOR,
	SYNC_BEGIN,
	SYNC_END,
	setScrollRegion,
	transitionPrelude,
} from "./terminal-modes";
import type { ClusterRender, CompositorConfig, DisposalReason } from "./types";

function replaceMethod(
	capability: PiMethodCapability,
	method: (...args: unknown[]) => unknown,
): void {
	Object.defineProperty(capability.target, capability.key, {
		...(capability.ownDescriptor ?? { configurable: true, enumerable: false, writable: true }),
		value: method,
	});
}

function restoreMethod(capability: PiMethodCapability): void {
	if (capability.ownDescriptor)
		Object.defineProperty(capability.target, capability.key, capability.ownDescriptor);
	else Reflect.deleteProperty(capability.target, capability.key);
}

function restoreOwnedMethod(
	capability: PiMethodCapability,
	wrapper: ((...args: unknown[]) => unknown) | null,
): void {
	if (!wrapper) return;
	const descriptor = Object.getOwnPropertyDescriptor(capability.target, capability.key);
	if (!descriptor || !("value" in descriptor) || descriptor.value !== wrapper) return;
	restoreMethod(capability);
}

function replaceRenderable(
	capability: PiRenderableCapability | null,
	render: (width: number) => string[],
): void {
	if (!capability) return;
	Object.defineProperty(capability.target, "render", {
		...(capability.ownDescriptor ?? { configurable: true, enumerable: false, writable: true }),
		value: render,
	});
}

function restoreRenderable(capability: PiRenderableCapability | null): void {
	if (!capability) return;
	if (capability.ownDescriptor)
		Object.defineProperty(capability.target, "render", capability.ownDescriptor);
	else Reflect.deleteProperty(capability.target, "render");
}

function sanitizeLine(line: string, width: number): string {
	return visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line;
}

type PhysicalMode = "not-entered" | "fixed" | "normal-flow";
type RenderPhase = "idle" | "fixed-root" | "normal-flow";

export class TerminalSplitCompositor {
	private inputListener:
		| ((data: string) => { consume?: boolean; data?: string } | undefined)
		| null = null;
	private inputListenerDisposer: (() => void) | null = null;
	private installed = false;
	private disposed = false;
	private disposing = false;
	private terminalModesEntered = false;
	private writing = false;
	private checkingOverlay = false;
	private planningCluster = false;
	private renderPhase: RenderPhase = "idle";
	private transactionMode: "fixed" | "normal-flow" | null = null;
	private activeMode: PhysicalMode = "not-entered";
	private transitionTarget: "fixed" | "normal-flow" | null = null;
	private transitionGuard = false;
	private completingTransition = false;
	private pendingDesiredMode: "fixed" | "normal-flow" | null = null;
	private scrollOffset = 0;
	private maxScrollOffset = 0;
	private lastRootLineCount = 0;
	private rootLines: string[] = [];
	private visibleRootStart = 0;
	private visibleScrollableRows = 0;
	private readonly selection = new SelectionState();
	private mouseResumeTimer: ReturnType<typeof setTimeout> | null = null;
	private drainInputWrapper: ((...args: unknown[]) => unknown) | null = null;
	private stopWrapper: ((...args: unknown[]) => unknown) | null = null;
	private preparingTerminalCleanup = false;
	private cursorVisible = true;
	private cachedClusterRender: { width: number; rows: number; render: ClusterRender } | null = null;
	private readonly onCopy: ((text: string) => void) | null;
	private readonly onDismissNotice: (() => void) | null;
	private readonly fallbackWrite: (data: string) => unknown;

	constructor(
		private readonly capabilities: PiFixedEditorCapabilities,
		private readonly getConfig: () => CompositorConfig,
		onCopy?: (text: string) => void,
		onDismissNotice?: () => void,
		fallbackWrite: (data: string) => unknown = (data) => process.stdout.write(data),
	) {
		this.onCopy = onCopy ?? null;
		this.onDismissNotice = onDismissNotice ?? null;
		this.fallbackWrite = fallbackWrite;
	}

	install(): boolean {
		if (this.installed) return true;
		if (this.disposed) return false;
		try {
			this.installTerminalCleanupWrappers();
			for (const component of this.components()) {
				if (!component) continue;
				const captured = component;
				replaceRenderable(captured, (width) =>
					this.renderPhase === "normal-flow" ? captured.render.call(captured.target, width) : [],
				);
			}
			Object.defineProperty(this.capabilities.terminal, "rows", {
				configurable: true,
				get: () => this.getScrollableRows(),
			});
			replaceMethod(this.capabilities.renderMethod, (width) => this.renderRoot(Number(width)));
			replaceMethod(this.capabilities.doRenderMethod, () => this.doRender());
			replaceMethod(this.capabilities.writeMethod, (data) => this.write(String(data)));
			this.inputListener = (data) => this.handleInput(data);
			const disposer = this.capabilities.addInputListener(this.inputListener);
			if (typeof disposer !== "function") throw new TypeError("Invalid input listener disposer");
			this.inputListenerDisposer = disposer as () => void;
			this.installed = true;
			if (this.getRawRows() > 0) this.beginTransition("fixed", "shutdown");
			else this.pendingDesiredMode = "fixed";
			return true;
		} catch {
			this.rollbackInstallation();
			return false;
		}
	}

	dispose(reason: DisposalReason): void {
		if (this.disposed || this.disposing) return;
		this.disposing = true;
		let firstFailure: unknown;
		const attempt = (operation: () => void) => {
			try {
				operation();
			} catch (error) {
				firstFailure ??= error;
			}
		};
		try {
			const resumeTimer = this.mouseResumeTimer;
			this.mouseResumeTimer = null;
			if (resumeTimer) attempt(() => clearTimeout(resumeTimer));
			const listener = this.inputListener;
			const disposer = this.inputListenerDisposer;
			this.inputListener = null;
			this.inputListenerDisposer = null;
			if (disposer) attempt(disposer);
			if (listener) attempt(() => this.capabilities.removeInputListener(listener));

			for (const component of this.components()) attempt(() => restoreRenderable(component));
			attempt(() => restoreOwnedMethod(this.capabilities.stopMethod, this.stopWrapper));
			attempt(() => restoreOwnedMethod(this.capabilities.drainInputMethod, this.drainInputWrapper));
			this.stopWrapper = null;
			this.drainInputWrapper = null;
			attempt(() => restoreMethod(this.capabilities.writeMethod));
			attempt(() => restoreMethod(this.capabilities.doRenderMethod));
			attempt(() => restoreMethod(this.capabilities.renderMethod));
			attempt(() => {
				if (this.capabilities.rowsOwnDescriptor)
					Object.defineProperty(
						this.capabilities.terminal,
						"rows",
						this.capabilities.rowsOwnDescriptor,
					);
				else Reflect.deleteProperty(this.capabilities.terminal, "rows");
			});

			if (this.terminalModesEntered) {
				let primaryFailed = false;
				try {
					this.callOriginalWrite(CANONICAL_TERMINAL_RESET);
				} catch (error) {
					firstFailure ??= error;
					primaryFailed = true;
				}
				if (primaryFailed)
					attempt(() => {
						this.fallbackWrite(CANONICAL_TERMINAL_RESET);
					});
			}
			if (reason === "live" && this.installed)
				attempt(() => this.capabilities.requestForceRender());
		} finally {
			this.installed = false;
			this.terminalModesEntered = false;
			this.transitionTarget = null;
			this.transitionGuard = false;
			this.transactionMode = null;
			this.activeMode = "not-entered";
			this.disposed = true;
			this.disposing = false;
		}
		if (reason === "live" && firstFailure) throw firstFailure;
	}

	private rollbackInstallation(): void {
		try {
			this.dispose("shutdown");
		} catch {}
	}

	private installTerminalCleanupWrappers(): void {
		const compositor = this;
		const drainCapability = this.capabilities.drainInputMethod;
		const stopCapability = this.capabilities.stopMethod;
		const drainWrapper = function (this: unknown, ...args: unknown[]): unknown {
			try {
				compositor.prepareForPiTerminalCleanup();
			} catch {}
			return Reflect.apply(drainCapability.method, this, args);
		};
		const stopWrapper = function (this: unknown, ...args: unknown[]): unknown {
			try {
				compositor.prepareForPiTerminalCleanup();
			} catch {}
			return Reflect.apply(stopCapability.method, this, args);
		};
		this.drainInputWrapper = drainWrapper;
		this.stopWrapper = stopWrapper;
		replaceMethod(drainCapability, drainWrapper);
		replaceMethod(stopCapability, stopWrapper);
	}

	private prepareForPiTerminalCleanup(): void {
		if (this.preparingTerminalCleanup) return;
		this.preparingTerminalCleanup = true;
		try {
			const resumeTimer = this.mouseResumeTimer;
			this.mouseResumeTimer = null;
			if (resumeTimer) {
				try {
					clearTimeout(resumeTimer);
				} catch {}
			}
			this.clearPhysicalTransitionState();
			if (!this.terminalModesEntered) return;
			let resetWritten = false;
			try {
				this.callOriginalWrite(CANONICAL_TERMINAL_RESET);
				resetWritten = true;
			} catch {
				try {
					this.fallbackWrite(CANONICAL_TERMINAL_RESET);
					resetWritten = true;
				} catch {}
			}
			if (!resetWritten) return;
			this.terminalModesEntered = false;
			this.transitionTarget = null;
			this.transitionGuard = false;
			this.completingTransition = false;
			this.transactionMode = null;
			this.activeMode = "not-entered";
			this.pendingDesiredMode = "fixed";
			this.renderPhase = "idle";
			this.writing = false;
		} finally {
			this.preparingTerminalCleanup = false;
		}
	}

	private components(): (PiRenderableCapability | null)[] {
		const cluster = this.capabilities.cluster;
		return [
			cluster.status,
			cluster.aboveWidget,
			cluster.editor,
			cluster.belowWidget,
			cluster.footer,
		];
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
		const value = this.capabilities.readRawRows();
		return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
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
	private getClusterRender(width: number, rows: number): ClusterRender {
		if (this.cachedClusterRender?.width === width && this.cachedClusterRender.rows === rows)
			return this.cachedClusterRender.render;
		const previous = this.planningCluster;
		this.planningCluster = true;
		try {
			const render = renderCluster(this.capabilities.cluster, width, rows);
			this.cachedClusterRender = { width, rows, render };
			return render;
		} finally {
			this.planningCluster = previous;
		}
	}
	private desiredMode(width: number, rows: number): "fixed" | "normal-flow" {
		if (this.hasVisibleOverlay()) return "normal-flow";
		return this.getClusterRender(width, rows).mode === "fixed" ? "fixed" : "normal-flow";
	}
	private getScrollableRows(): number {
		const rows = this.getRawRows();
		if (
			rows === 0 ||
			this.disposed ||
			this.writing ||
			this.planningCluster ||
			this.renderPhase === "normal-flow" ||
			this.transactionMode === "normal-flow" ||
			this.transitionTarget === "normal-flow" ||
			this.hasVisibleOverlay() ||
			(this.activeMode === "normal-flow" &&
				this.transactionMode !== "fixed" &&
				this.transitionTarget !== "fixed")
		)
			return rows;
		const width = Math.max(1, this.capabilities.getColumns() || 80);
		const cluster = this.getClusterRender(width, rows);
		return cluster.mode === "fixed"
			? Math.max(
					1,
					cluster.plan?.mode === "fixed"
						? cluster.plan.transcriptRows
						: rows - cluster.lines.length,
				)
			: rows;
	}

	private clearPhysicalTransitionState(): void {
		this.selection.clear();
		this.cachedClusterRender = null;
		this.rootLines = [];
		this.visibleRootStart = 0;
		this.visibleScrollableRows = 0;
		this.cursorVisible = true;
	}

	private beginTransition(
		target: "fixed" | "normal-flow",
		failureReason: DisposalReason = "live",
	): void {
		if (this.transitionGuard) return;
		this.transitionTarget = target;
		this.transitionGuard = true;
		this.clearPhysicalTransitionState();
		try {
			if (!this.terminalModesEntered) {
				// Ownership begins before the first byte: a partial write still requires reset recovery.
				this.terminalModesEntered = true;
				this.callOriginalWrite(SYNC_BEGIN + ENTER_ALT_SCREEN + DISABLE_ALT_SCROLL + SYNC_END);
			}
			this.callOriginalWrite(transitionPrelude(target));
			this.capabilities.requestForceRender();
		} catch (error) {
			this.transitionGuard = false;
			this.transitionTarget = null;
			try {
				this.dispose(failureReason);
			} catch {}
			throw error;
		}
	}

	private doRender(): void {
		if (this.disposed) {
			this.callOriginalDoRender();
			return;
		}
		const rows = this.getRawRows();
		if (rows === 0) {
			this.pendingDesiredMode = this.hasVisibleOverlay() ? "normal-flow" : "fixed";
			return;
		}
		if (this.pendingDesiredMode) this.pendingDesiredMode = null;
		this.cachedClusterRender = null;
		const width = Math.max(1, this.capabilities.getColumns() || 80);
		const desired = this.desiredMode(width, rows);
		if (!this.transitionTarget && this.activeMode !== desired) {
			this.beginTransition(desired);
			return;
		}
		this.completingTransition = Boolean(this.transitionTarget);
		try {
			let target = this.transitionTarget ?? desired;
			if (this.transitionTarget && target !== desired) {
				// The materialized layout is authoritative: metadata/height may change while
				// the forced transition render is queued.
				target = desired;
				this.transitionTarget = desired;
				this.clearPhysicalTransitionState();
				this.callOriginalWrite(transitionPrelude(desired));
			}
			this.transactionMode = target;
			this.callOriginalDoRender();
			if (target === "fixed") this.requestRepaint();
			if (this.transitionTarget) this.activeMode = target;
		} catch (error) {
			if (this.transitionTarget) {
				try {
					this.dispose("live");
				} catch {}
			} else throw error;
		} finally {
			this.transactionMode = null;
			this.completingTransition = false;
			this.transitionTarget = null;
			this.transitionGuard = false;
		}
	}

	private withPhase<T>(phase: RenderPhase, operation: () => T): T {
		const previous = this.renderPhase;
		this.renderPhase = phase;
		try {
			return operation();
		} finally {
			this.renderPhase = previous;
		}
	}
	private renderRoot(width: number): string[] {
		if (this.disposed) return this.callOriginalRender(width);
		if (this.hasVisibleOverlay())
			return this.withPhase("normal-flow", () => this.callOriginalRender(width));
		const rows = this.getRawRows();
		const target =
			this.transactionMode ??
			this.transitionTarget ??
			(rows > 0 ? this.desiredMode(Math.max(1, width), rows) : "normal-flow");
		if (target === "normal-flow")
			return this.withPhase("normal-flow", () => this.callOriginalRender(width));
		return this.withPhase("fixed-root", () => this.renderScrollableRoot(width));
	}
	private renderScrollableRoot(width: number): string[] {
		const rows = this.getRawRows();
		const cluster = this.getClusterRender(Math.max(1, width), rows);
		if (cluster.mode !== "fixed")
			return this.withPhase("normal-flow", () => this.callOriginalRender(width));
		const scrollableRows = Math.max(
			1,
			cluster.plan?.mode === "fixed" ? cluster.plan.transcriptRows : rows - cluster.lines.length,
		);
		const lines = this.callOriginalRender(Math.max(1, width));
		if (
			this.scrollOffset > 0 &&
			this.lastRootLineCount > 0 &&
			lines.length > this.lastRootLineCount
		)
			this.scrollOffset += lines.length - this.lastRootLineCount;
		this.lastRootLineCount = lines.length;
		this.maxScrollOffset = Math.max(0, lines.length - scrollableRows);
		this.scrollOffset = clampScrollOffset(this.scrollOffset, this.maxScrollOffset);
		const start = Math.max(0, lines.length - scrollableRows - this.scrollOffset);
		const visible = lines.slice(start, start + scrollableRows);
		while (visible.length < scrollableRows) visible.push("");
		this.rootLines = lines;
		this.visibleRootStart = start;
		this.visibleScrollableRows = scrollableRows;
		return visible.map((line, index) => highlightSelection(line, start + index, this.selection));
	}

	private handleInput(data: string): { consume?: boolean; data?: string } | undefined {
		if (
			this.disposed ||
			this.transitionGuard ||
			this.hasVisibleOverlay() ||
			this.activeMode === "normal-flow"
		)
			return undefined;
		this.onDismissNotice?.();
		if (this.getConfig().mouseScroll) {
			const event = parseMouseEvent(data);
			if (event) {
				this.handleMouseEvent(event);
				return { consume: true };
			}
		}
		const keyboard = parseKeyboardScroll(data);
		if (!keyboard) return undefined;
		if (keyboard.action === "jumpBottom") {
			this.scrollOffset = 0;
			this.selection.clear();
			this.capabilities.requestNormalRender();
			return undefined;
		}
		if (keyboard.action === "pageUp" || keyboard.action === "pageDown") {
			if (this.maxScrollOffset <= 0) return undefined;
			const before = this.scrollOffset;
			const amount = Math.max(1, this.visibleScrollableRows);
			this.selection.clear();
			this.scrollBy(keyboard.action === "pageUp" ? amount : -amount);
			if (before === this.scrollOffset) return { consume: true };
			return { consume: true };
		}
		return { consume: true };
	}

	private handleMouseEvent(event: {
		button: string;
		action: string;
		col: number;
		row: number;
	}): void {
		if (event.button === "wheel-up" && event.action === "press") {
			this.selection.clear();
			this.scrollBy(3);
			return;
		}
		if (event.button === "wheel-down" && event.action === "press") {
			this.selection.clear();
			this.scrollBy(-3);
			return;
		}
		if (event.button === "right" && event.action === "press") {
			const text = this.selection.active ? this.selection.getSelectedText(this.rootLines) : "";
			if (text) void copyToClipboard(text);
			this.selection.clear();
			this.pauseMouseReporting();
			this.capabilities.requestNormalRender();
			return;
		}
		if (event.button !== "left") return;
		if (
			event.action === "release" &&
			this.selection.isDragging &&
			event.row > this.visibleScrollableRows
		) {
			this.selection.clear();
			this.capabilities.requestNormalRender();
			return;
		}
		if (event.row > this.visibleScrollableRows) return;
		const line = this.visibleRootStart + event.row - 1;
		const col = Math.max(0, event.col - 1);
		if (event.action === "press") {
			this.selection.start(line, col);
			this.capabilities.requestNormalRender();
		} else if (event.action === "drag" && this.selection.isDragging) {
			this.selection.extend(line, col + 1);
			this.capabilities.requestNormalRender();
		} else if (event.action === "release" && this.selection.isDragging) {
			this.selection.extend(line, col + 1);
			this.selection.setDragging(false);
			const text = this.selection.getSelectedText(this.rootLines);
			this.selection.clear();
			this.capabilities.requestNormalRender();
			if (text) {
				void copyToClipboard(text);
				if (this.getConfig().copyNotice) this.onCopy?.(text);
			}
		}
	}
	private pauseMouseReporting(): void {
		if (this.mouseResumeTimer) clearTimeout(this.mouseResumeTimer);
		this.callOriginalWrite(SYNC_BEGIN + DISABLE_MOUSE + SYNC_END);
		this.mouseResumeTimer = setTimeout(() => {
			this.mouseResumeTimer = null;
			if (
				!this.disposed &&
				this.installed &&
				!this.transitionGuard &&
				this.activeMode === "fixed" &&
				this.transactionMode !== "normal-flow" &&
				!this.hasVisibleOverlay() &&
				this.getConfig().mouseScroll
			)
				this.callOriginalWrite(SYNC_BEGIN + ENABLE_MOUSE_SGR + SYNC_END);
		}, 1200);
		if (typeof this.mouseResumeTimer === "object" && "unref" in this.mouseResumeTimer)
			(this.mouseResumeTimer as { unref: () => void }).unref();
	}
	private scrollBy(delta: number): void {
		const next = clampScrollOffset(this.scrollOffset + delta, this.maxScrollOffset);
		if (next === this.scrollOffset) return;
		this.scrollOffset = next;
		this.capabilities.requestNormalRender();
	}
	private paintCluster(cluster: ClusterRender, rows: number, width: number): string {
		if (cluster.lines.length === 0) return "";
		const startRow = Math.max(1, rows - cluster.lines.length + 1);
		let buffer = RESET_SCROLL_REGION;
		for (let index = 0; index < cluster.lines.length; index++)
			buffer +=
				cursorTo(startRow + index, 1) +
				CLEAR_LINE +
				sanitizeLine(cluster.lines[index] ?? "", width);
		if (cluster.cursor) {
			buffer += cursorTo(startRow + cluster.cursor.row, Math.max(1, cluster.cursor.col + 1));
			if (!this.cursorVisible) {
				buffer += SHOW_CURSOR;
				this.cursorVisible = true;
			}
		} else if (this.cursorVisible) {
			buffer += HIDE_CURSOR;
			this.cursorVisible = false;
		}
		return buffer;
	}
	private syncTuiCursor(scrollBottom: number): string {
		const { hardwareCursorRow, previousViewportTop } = this.capabilities.getCursorBookkeeping();
		return cursorTo(
			Math.max(1, Math.min(scrollBottom, hardwareCursorRow - previousViewportTop + 1)),
			1,
		);
	}
	private requestRepaint(): void {
		if (this.disposed || this.transactionMode === "normal-flow" || this.hasVisibleOverlay()) return;
		const rows = this.getRawRows();
		if (rows === 0) return;
		const width = Math.max(1, this.capabilities.getColumns() || 80);
		const cluster = this.getClusterRender(width, rows);
		if (cluster.mode !== "fixed" || cluster.lines.length === 0) return;
		this.callOriginalWrite(
			SYNC_BEGIN +
				DISABLE_AUTOWRAP +
				this.paintCluster(cluster, rows, width) +
				ENABLE_AUTOWRAP +
				(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
				DISABLE_ALT_SCROLL +
				SYNC_END,
		);
	}
	private write(data: string): void {
		if (this.disposed || this.writing) {
			this.callOriginalWrite(data);
			return;
		}
		if (this.transitionGuard && !this.completingTransition) return;
		const mode =
			this.transactionMode ??
			this.transitionTarget ??
			(this.activeMode === "fixed" ? "fixed" : "normal-flow");
		if (mode === "normal-flow" || this.hasVisibleOverlay()) {
			this.callOriginalWrite(data);
			return;
		}
		this.writing = true;
		try {
			const rows = this.getRawRows();
			if (rows === 0) return;
			const width = Math.max(1, this.capabilities.getColumns() || 80);
			const cluster = this.getClusterRender(width, rows);
			if (cluster.mode !== "fixed" || cluster.lines.length === 0) {
				this.callOriginalWrite(data);
				return;
			}
			const scrollBottom = Math.max(1, rows - cluster.lines.length);
			this.callOriginalWrite(
				SYNC_BEGIN +
					DISABLE_AUTOWRAP +
					setScrollRegion(1, scrollBottom) +
					this.syncTuiCursor(scrollBottom) +
					data +
					this.paintCluster(cluster, rows, width) +
					ENABLE_AUTOWRAP +
					(this.getConfig().mouseScroll ? ENABLE_MOUSE_SGR : DISABLE_MOUSE) +
					DISABLE_ALT_SCROLL +
					SYNC_END,
			);
		} finally {
			this.writing = false;
		}
	}
}

export { CANONICAL_TERMINAL_RESET as emergencyTerminalReset };
