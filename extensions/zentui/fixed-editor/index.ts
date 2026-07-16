/**
 * Probe widget and lifecycle for the fixed editor compositor.
 *
 * A "probe" widget is registered via `ctx.ui.setWidget` with
 * `placement: "aboveEditor"`. On first render it provides the TUI instance,
 * which the compositor needs to patch internal methods.
 *
 * @internal
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";

import type { PolishedTuiConfig } from "../config";
import type { SessionLifecycle } from "../session-lifecycle";
import { renderStyleForSourceOrFallback } from "../style";
import { TerminalSplitCompositor } from "./compositor";
import { inspectPiTui } from "./pi-compat";

let compositor: TerminalSplitCompositor | null = null;
let didWarnUnsupported = false;
let copyNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let storedCtx: ExtensionContext | null = null;
let cancelProbeInstall: (() => void) | null = null;
const COPY_NOTICE_KEY = "zentui-copy-notice";
const COPY_NOTICE_MS = 2500;

function clearCopyNotice(ctx: ExtensionContext): void {
	if (copyNoticeTimer) {
		clearTimeout(copyNoticeTimer);
		copyNoticeTimer = null;
	}
	if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") return;
	ctx.ui.setWidget(COPY_NOTICE_KEY, undefined);
}

/** Centered bordered box showing the copy notice. */
class CopyNoticeComponent implements Component {
	private readonly text: string;
	private readonly border: string;

	constructor(text: string, border: string) {
		this.text = text;
		this.border = border;
	}

	render(width: number): string[] {
		const inner = " ".repeat(2) + this.text + " ".repeat(2);
		const innerWidth = visibleWidth(inner);
		const leftPad = Math.max(0, Math.floor((width - innerWidth - 2) / 2));
		const pad = " ".repeat(leftPad);
		const bar = "─".repeat(innerWidth);
		return [
			`${pad}${this.border}┌${bar}┐`,
			`${pad}${this.border}│${inner}│`,
			`${pad}${this.border}└${bar}┘`,
		];
	}

	invalidate(): void {}
}

function showCopyNotice(ctx: ExtensionContext, getConfig: () => PolishedTuiConfig): void {
	if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") return;
	const config = getConfig();
	ctx.ui.setWidget(COPY_NOTICE_KEY, (_tui, theme) => {
		const text = renderStyleForSourceOrFallback(
			theme,
			config.colorSources.editor,
			undefined,
			{ terminal: "yellow", theme: "warning" },
			"Copied to clipboard",
		);
		const border = renderStyleForSourceOrFallback(
			theme,
			config.colorSources.editor,
			config.colors.editorBorder,
			{ terminal: "yellow", theme: "border" },
			"",
		);
		return new CopyNoticeComponent(text, border);
	});
	if (copyNoticeTimer) clearTimeout(copyNoticeTimer);
	copyNoticeTimer = setTimeout(() => {
		copyNoticeTimer = null;
		if (storedCtx !== ctx) return;
		if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") return;
		ctx.ui.setWidget(COPY_NOTICE_KEY, undefined);
	}, COPY_NOTICE_MS);
}

/**
 * Minimal component that triggers a callback on first render, then returns [].
 */
class ProbeComponent implements Component {
	private readonly onInstall: () => void;
	private hasQueuedInstall = false;

	constructor(onInstall: () => void) {
		this.onInstall = onInstall;
	}

	render(): string[] {
		if (!this.hasQueuedInstall) {
			this.hasQueuedInstall = true;
			this.onInstall();
		}
		return [];
	}

	invalidate(): void {
		this.hasQueuedInstall = false;
	}
}

function warnUnsupported(ctx: ExtensionContext): void {
	if (didWarnUnsupported || !ctx.hasUI) return;
	didWarnUnsupported = true;
	console.warn(
		"[zentui] Fixed editor: unsupported Pi TUI layout — falling back to normal rendering.",
	);
}

function installFromProbe(
	ctx: ExtensionContext,
	tui: TUI,
	getConfig: () => PolishedTuiConfig,
): void {
	if (compositor) return;
	const config = getConfig();
	if (!config.fixedEditor?.enabled) return;

	const capabilities = inspectPiTui(tui);
	if (!capabilities) {
		warnUnsupported(ctx);
		return;
	}

	const next = new TerminalSplitCompositor(
		capabilities,
		() => ({
			enabled: getConfig().fixedEditor?.enabled ?? false,
			mouseScroll: getConfig().fixedEditor?.mouseScroll ?? false,
			copyNotice: getConfig().fixedEditor?.copyNotice ?? true,
		}),
		ctx.hasUI ? () => showCopyNotice(ctx, getConfig) : undefined,
		ctx.hasUI ? () => clearCopyNotice(ctx) : undefined,
	);

	if (!next.install()) {
		warnUnsupported(ctx);
		return;
	}

	compositor = next;
}

const WIDGET_KEY = "zentui-fixed-editor-probe";

/**
 * Register the fixed-editor probe widget.
 * Call from session_start after editor + footer install.
 * Only activates when `fixedEditor.enabled` is true.
 */
export function installFixedEditorProbe(
	ctx: ExtensionContext,
	getConfig: () => PolishedTuiConfig,
	lifecycle: SessionLifecycle,
): void {
	if (!lifecycle.isCurrent() || !ctx.hasUI) return;
	if (typeof ctx.ui.setWidget !== "function") return;
	didWarnUnsupported = false;
	storedCtx = ctx;
	cancelProbeInstall?.();
	cancelProbeInstall = null;

	ctx.ui.setWidget(
		WIDGET_KEY,
		(tui: TUI) =>
			new ProbeComponent(() => {
				cancelProbeInstall = lifecycle.queueMicrotask(() => {
					cancelProbeInstall = lifecycle.queueMicrotask(() => {
						cancelProbeInstall = null;
						installFromProbe(ctx, tui, getConfig);
					});
				});
			}),
		{ placement: "aboveEditor" },
	);
}

/**
 * Dispose the compositor if active.
 * Call from session_shutdown and cleanupUi.
 */
export function disposeFixedEditor(): void {
	cancelProbeInstall?.();
	cancelProbeInstall = null;
	compositor?.dispose();
	compositor = null;
	if (copyNoticeTimer) {
		clearTimeout(copyNoticeTimer);
		copyNoticeTimer = null;
	}
	if (storedCtx) {
		const ctx = storedCtx;
		storedCtx = null;
		clearCopyNotice(ctx);
	}
}

/**
 * Remove the probe widget without disposing an active compositor.
 * Useful for full UI cleanup.
 */
export function removeFixedEditorProbe(ctx: ExtensionContext): void {
	cancelProbeInstall?.();
	cancelProbeInstall = null;
	if (!ctx.hasUI) return;
	if (typeof ctx.ui.setWidget !== "function") return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}
