/* Adapted from pi-tool-display 0.5.0, commit91cef7580078371f8dc49a8607222807ad6a424d.
 * MIT License
 *
 * Copyright (c) 2026 MasuRii
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { bashCommandHighlighter } from "./host.ts";
import { PresentationText as Text } from "./presentation-text.ts";

const BASH_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BASH_SPINNER_INTERVAL_MS = 200;
const BASH_SPINNER_STATE_KEY = "__piToolDisplayBashSpinner";
const BASH_SPINNER_TOOL_CALL_ID_KEY = "__piToolDisplayBashSpinnerToolCallId";

interface BashCallArgs {
	command?: string;
	commandPrefix?: string;
	shellPath?: string;
	timeout?: number;
}

interface BashCallRenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

interface BashSpinnerState {
	target?: { text: Text; args: BashCallArgs; theme: BashCallRenderTheme; invalidate?: () => void };
	frameIndex: number;
	startedAt?: number;
	timer?: ReturnType<typeof setInterval>;
}

interface BashSpinnerStateCarrier {
	[BASH_SPINNER_STATE_KEY]?: BashSpinnerState;
	[BASH_SPINNER_TOOL_CALL_ID_KEY]?: string;
}

interface BashCallRenderContextLike {
	executionStarted: boolean;
	isPartial: boolean;
	invalidate?: () => void;
	lastComponent?: unknown;
	state?: unknown;
	toolCallId?: string;
}

function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) {
		return `${totalMinutes}m ${seconds}s`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m`;
}

function isDefaultShellPath(shellPath: string): boolean {
	const normalized = shellPath.trim().replace(/\\/g, "/").toLowerCase();
	const basename = normalized.split("/").pop() || normalized;
	return basename === "bash" || basename === "cmd.exe";
}

function buildCommandDisplay(args: BashCallArgs): string {
	const command =
		typeof args.command === "string" && args.command.trim().length > 0 ? args.command : "...";
	const prefix =
		typeof args.commandPrefix === "string" && args.commandPrefix.trim().length > 0
			? args.commandPrefix.trim()
			: "";
	return prefix ? `${prefix} ${command}` : command;
}

function buildBashCallText(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	spinnerFrame?: string,
	elapsedMs?: number,
	commandColors?: (args: BashCallArgs, theme: BashCallRenderTheme) => string,
): string {
	const commandDisplay = buildCommandDisplay(args);
	const shellSuffix =
		typeof args.shellPath === "string" &&
		args.shellPath.trim().length > 0 &&
		!isDefaultShellPath(args.shellPath)
			? theme.fg("muted", ` [shell: ${args.shellPath}]`)
			: "";
	const timeoutSuffix = args.timeout ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
	const spinnerPrefix = spinnerFrame ? `${theme.fg("warning", `${spinnerFrame} `)}` : "";
	const elapsedSuffix =
		spinnerFrame && elapsedMs !== undefined
			? theme.fg("muted", ` · ${formatElapsed(elapsedMs)}`)
			: "";

	return `${spinnerPrefix}${theme.fg("toolTitle", theme.bold("$"))} ${commandColors ? commandColors(args, theme) : theme.fg("accent", commandDisplay)}${shellSuffix}${timeoutSuffix}${elapsedSuffix}`;
}

// Only foreground SGR is permitted: resets/backgrounds/styles could change the host card.
const FOREGROUND_SGR = /\x1b\[(?:3[0-7]|9[0-7]|39|38;5;\d{1,3}|38;2;\d{1,3};\d{1,3};\d{1,3})m/g;
const commandGraphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function preservesGraphemes(display: string, colored: string): boolean {
	const boundaries = new Set([display.length]);
	for (const segment of commandGraphemes.segment(display)) boundaries.add(segment.index);
	let escapes = 0;
	for (const match of colored.matchAll(FOREGROUND_SGR)) {
		if (!boundaries.has(match.index - escapes)) return false;
		escapes += match[0].length;
	}
	return true;
}
const SYNTAX_PALETTE = [
	"accent",
	"muted",
	"syntaxKeyword",
	"syntaxString",
	"syntaxNumber",
	"syntaxComment",
	"syntaxFunction",
	"syntaxType",
	"syntaxVariable",
	"syntaxOperator",
	"syntaxPunctuation",
] as const;

export function createBashProgress(
	highlight: ((text: string) => string[]) | null | undefined = bashCommandHighlighter,
) {
	const highlightedCommands = new Map<string, string>();
	function commandColors(args: BashCallArgs, theme: BashCallRenderTheme): string {
		const display = buildCommandDisplay(args);
		if (args.shellPath !== undefined && typeof args.shellPath !== "string")
			return theme.fg("accent", display);
		const shell = args.shellPath?.trim().replace(/\\/g, "/").split("/").pop()?.toLowerCase();
		if (!highlight || (shell && shell !== "bash" && shell !== "sh"))
			return theme.fg("accent", display);
		// Pi keeps a stable theme proxy across swaps. Sample the live syntax palette,
		// not proxy identity; this cheap check also runs on retained spinner targets.
		const key = JSON.stringify([display, ...SYNTAX_PALETTE.map((token) => theme.fg(token, ""))]);
		let colored = highlightedCommands.get(key);
		if (colored === undefined) {
			colored = display;
			try {
				const lines = highlight(display);
				if (
					Array.isArray(lines) &&
					lines.length === display.split("\n").length &&
					lines.every(
						(line) => typeof line === "string" && line.length <= display.length * 64 + 1024,
					)
				) {
					const candidate = lines.join("\n");
					if (
						candidate.length <= display.length * 64 + 1024 &&
						candidate.replace(FOREGROUND_SGR, (sgr) => {
							const values = sgr.slice(2, -1).split(";").map(Number);
							return values.length > 1 && values.slice(2).some((value) => value > 255) ? sgr : "";
						}) === display &&
						preservesGraphemes(display, candidate)
					) {
						// Pi Text identifies whitespace tokens with raw trim(). Keeping
						// syntax SGR off spaces preserves the original word-wrap geometry.
						const normalized = candidate.replace(/((?:\x1b\[[0-9;]*m)+)([ \t\n]+)/g, "$2$1");
						// Moving an escape over a space can split its combining marks.
						// Validate the final placement too; unsafe spans keep plain accent.
						if (preservesGraphemes(display, normalized)) colored = normalized;
					}
				}
			} catch {
				// Missing/partial/invalid highlighting fails open to the original accent row.
			}
			highlightedCommands.set(key, colored);
			if (highlightedCommands.size > 16)
				highlightedCommands.delete(highlightedCommands.keys().next().value as string);
		}
		return theme.fg("accent", colored);
	}
	const spinnerStatesByToolCallId = new Map<string, BashSpinnerState>();
	let nextSyntheticToolCallId = 0;

	function toStateCarrier(value: unknown): BashSpinnerStateCarrier | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		return value as BashSpinnerStateCarrier;
	}

	function getSyntheticToolCallId(
		carrier: BashSpinnerStateCarrier | undefined,
	): string | undefined {
		if (!carrier) {
			return undefined;
		}

		if (!carrier[BASH_SPINNER_TOOL_CALL_ID_KEY]) {
			carrier[BASH_SPINNER_TOOL_CALL_ID_KEY] = `state:${++nextSyntheticToolCallId}`;
		}
		return carrier[BASH_SPINNER_TOOL_CALL_ID_KEY];
	}

	function getToolCallId(context: BashCallRenderContextLike): string | undefined {
		if (typeof context.toolCallId === "string" && context.toolCallId.trim().length > 0) {
			return context.toolCallId;
		}
		return getSyntheticToolCallId(toStateCarrier(context.state));
	}

	function getOrCreateSpinnerState(
		toolCallId: string | undefined,
		carrier: BashSpinnerStateCarrier | undefined,
	): BashSpinnerState | undefined {
		if (!toolCallId) {
			return undefined;
		}

		let state = spinnerStatesByToolCallId.get(toolCallId);
		if (!state) {
			state = { frameIndex: 0 };
			spinnerStatesByToolCallId.set(toolCallId, state);
			while (spinnerStatesByToolCallId.size > 16) {
				const first = spinnerStatesByToolCallId.entries().next().value;
				if (!first) break;
				stopSpinner(first[0], first[1]);
			}
		}
		if (carrier) {
			carrier[BASH_SPINNER_STATE_KEY] = state;
		}
		return state;
	}

	function stopSpinner(toolCallId: string | undefined, state: BashSpinnerState | undefined): void {
		if (!state) {
			return;
		}

		if (state.timer) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
		state.frameIndex = 0;
		state.startedAt = undefined;
		state.target = undefined;
		if (toolCallId) {
			spinnerStatesByToolCallId.delete(toolCallId);
		}
	}

	function renderBashCall(
		args: BashCallArgs,
		theme: BashCallRenderTheme,
		context: BashCallRenderContextLike,
	): Text {
		const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
		const carrier = toStateCarrier(context.state);
		const toolCallId = getToolCallId(context);
		const spinnerState = getOrCreateSpinnerState(toolCallId, carrier);
		const shouldSpin = context.executionStarted && context.isPartial;

		if (!shouldSpin) {
			stopSpinner(toolCallId, spinnerState);
			text.setText(buildBashCallText(args, theme, undefined, undefined, commandColors));
			return text;
		}

		if (spinnerState) {
			spinnerState.target = { text, args, theme, invalidate: context.invalidate };
			spinnerState.startedAt ??= Date.now();
			if (!spinnerState.timer && typeof context.invalidate === "function") {
				const timer = setInterval(() => {
					spinnerState.frameIndex = (spinnerState.frameIndex + 1) % BASH_SPINNER_FRAMES.length;
					const target = spinnerState.target;
					if (!target) return;
					target.text.setText(
						buildBashCallText(
							target.args,
							target.theme,
							BASH_SPINNER_FRAMES[spinnerState.frameIndex],
							Date.now() - (spinnerState.startedAt ?? Date.now()),
							commandColors,
						),
					);
					target.invalidate?.();
				}, BASH_SPINNER_INTERVAL_MS);
				spinnerState.timer = timer;
			}
		}

		const spinnerFrame = spinnerState ? BASH_SPINNER_FRAMES[spinnerState.frameIndex] : undefined;
		const elapsedMs =
			spinnerState?.startedAt !== undefined ? Date.now() - spinnerState.startedAt : undefined;
		text.setText(buildBashCallText(args, theme, spinnerFrame, elapsedMs, commandColors));
		return text;
	}

	return {
		renderCall: renderBashCall,
		release(context: BashCallRenderContextLike) {
			const id = getToolCallId(context);
			stopSpinner(id, id ? spinnerStatesByToolCallId.get(id) : undefined);
		},
		dispose() {
			for (const [id, state] of spinnerStatesByToolCallId) stopSpinner(id, state);
			highlightedCommands.clear();
		},
	};
}
export type BashProgress = ReturnType<typeof createBashProgress>;
