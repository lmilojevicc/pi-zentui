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
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { PolishedTuiConfig } from "../config";
import { TerminalSplitCompositor } from "./compositor";
import type { TuiLike } from "./types";

let compositor: TerminalSplitCompositor | null = null;
let didWarnUnsupported = false;
let copyNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const COPY_NOTICE_KEY = "zentui-copy-notice";
const COPY_NOTICE_MS = 2500;

function showCopyNotice(ctx: ExtensionContext, _message: string): void {
	if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") return;
	ctx.ui.setWidget(COPY_NOTICE_KEY, ["  Copied to clipboard"]);
	if (copyNoticeTimer) clearTimeout(copyNoticeTimer);
	copyNoticeTimer = setTimeout(() => {
		ctx.ui.setWidget(COPY_NOTICE_KEY, undefined);
		copyNoticeTimer = null;
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
			queueMicrotask(this.onInstall);
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

	const tuiLike = tui as unknown as TuiLike;
	const terminal = tuiLike.terminal;
	if (!terminal || typeof terminal.write !== "function") {
		warnUnsupported(ctx);
		return;
	}

	const next = new TerminalSplitCompositor(
		tuiLike,
		terminal,
		() => ({
			enabled: getConfig().fixedEditor?.enabled ?? false,
			mouseScroll: getConfig().fixedEditor?.mouseScroll ?? false,
		}),
		ctx.hasUI ? (msg) => showCopyNotice(ctx, msg) : undefined,
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
): void {
	if (!ctx.hasUI) return;
	if (typeof ctx.ui.setWidget !== "function") return;
	didWarnUnsupported = false;

	ctx.ui.setWidget(
		WIDGET_KEY,
		(tui: TUI) =>
			new ProbeComponent(() => {
				queueMicrotask(() => installFromProbe(ctx, tui, getConfig));
			}),
		{ placement: "aboveEditor" },
	);
}

/**
 * Dispose the compositor if active.
 * Call from session_shutdown and cleanupUi.
 */
export function disposeFixedEditor(): void {
	compositor?.dispose();
	compositor = null;
	if (copyNoticeTimer) {
		clearTimeout(copyNoticeTimer);
		copyNoticeTimer = null;
	}
}

/**
 * Remove the probe widget without disposing an active compositor.
 * Useful for full UI cleanup.
 */
export function removeFixedEditorProbe(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (typeof ctx.ui.setWidget !== "function") return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}
