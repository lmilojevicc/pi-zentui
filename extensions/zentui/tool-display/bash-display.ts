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
import { PresentationText as Text } from "./presentation-text.js";

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

	return `${spinnerPrefix}${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", commandDisplay)}${shellSuffix}${timeoutSuffix}${elapsedSuffix}`;
}

export function createBashProgress() {
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
			text.setText(buildBashCallText(args, theme));
			return text;
		}

		if (spinnerState) {
			spinnerState.startedAt ??= Date.now();
			if (!spinnerState.timer && typeof context.invalidate === "function") {
				const timer = setInterval(() => {
					spinnerState.frameIndex = (spinnerState.frameIndex + 1) % BASH_SPINNER_FRAMES.length;
					text.setText(
						buildBashCallText(
							args,
							theme,
							BASH_SPINNER_FRAMES[spinnerState.frameIndex],
							Date.now() - (spinnerState.startedAt ?? Date.now()),
						),
					);
					context.invalidate?.();
				}, BASH_SPINNER_INTERVAL_MS);
				spinnerState.timer = timer;
			}
		}

		const spinnerFrame = spinnerState ? BASH_SPINNER_FRAMES[spinnerState.frameIndex] : undefined;
		const elapsedMs =
			spinnerState?.startedAt !== undefined ? Date.now() - spinnerState.startedAt : undefined;
		text.setText(buildBashCallText(args, theme, spinnerFrame, elapsedMs));
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
		},
	};
}
export type BashProgress = ReturnType<typeof createBashProgress>;
