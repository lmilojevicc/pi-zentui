import { stripVTControlCharacters } from "node:util";
import {
	CustomEditor,
	type EventBus,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Focusable, Loader, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripTerminalSequences = stripVTControlCharacters;

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Expected initialized test state");
	return value;
}

const runtime = vi.hoisted(() => ({
	enabled: true,
	freshWorkingDefaults: false,
	custom: true,
	message: "Stable",
	spinner: "star-bloom" as "star-bloom" | "pulse",
	spinnerIntervalMs: 100,
	textIntervalMs: 60,
	editorEnabled: false,
	editorStyle: "minimalist" as import("../extensions/zentui/config").EditorStyle,
	placement: "above" as "above" | "border",
	config: undefined as import("../extensions/zentui/config").ZentuiConfig | undefined,
}));

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists() {},
		loadConfig: () => {
			const config = structuredClone(actual.defaultConfig);
			config.components.workingLine.colorSource = "theme";
			// Test message/indicator ownership without rate-driven refreshes.
			if (!runtime.freshWorkingDefaults) config.components.workingLine.segments.tokenRate = false;
			config.projectRefreshIntervalMs = 0;
			config.components.editor.enabled = runtime.editorEnabled;
			config.components.editor.style = runtime.editorStyle;
			if (!runtime.freshWorkingDefaults)
				config.components.editor.styles.minimalist.showTimer = false;
			config.components.editor.styles.minimalist.showGit = false;
			config.components.editor.styles.minimalist.pathDisplay = "full";
			if (!runtime.freshWorkingDefaults)
				config.components.workingLine.placement = runtime.placement;
			config.components.userMessages.enabled = false;
			config.components.selectorBorders.enabled = false;
			config.components.footer.style = "native";
			if (!runtime.freshWorkingDefaults) config.components.workingLine.enabled = runtime.enabled;
			config.components.workingLine.spinner = runtime.spinner;
			config.components.workingLine.spinnerIntervalMs = runtime.spinnerIntervalMs;
			config.components.workingLine.textIntervalMs = runtime.textIntervalMs;
			config.components.workingLine.messages = {
				custom: runtime.custom,
				values: [runtime.message],
			};
			runtime.config = config;
			return config;
		},
		saveEditorComponentPatch(patch: object) {
			Object.assign(required(runtime.config).components.editor, patch);
			return required(runtime.config);
		},
		saveWorkingLineComponentPatch(patch: object) {
			Object.assign(required(runtime.config).components.workingLine, patch);
			return required(runtime.config);
		},
	};
});

const settings = vi.hoisted(() => ({
	actions: undefined as
		| Parameters<
				typeof import("../extensions/zentui/settings-command").registerZentuiSettingsCommand
		  >[1]
		| undefined,
}));
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, actions: NonNullable<typeof settings.actions>) {
		settings.actions = actions;
	},
}));

import zentui from "../extensions/zentui/index";
import { WORKING_LINE_METRIC_UPDATE_INTERVAL_MS } from "../extensions/zentui/working-line";
import {
	ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT,
	ZENTUI_WORKING_LINE_SEGMENT_EVENT,
	ZENTUI_WORKING_LINE_SEGMENT_PROTOCOL_VERSION,
} from "../extensions/zentui/working-line-extension-segments";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function theme(): Theme {
	return {
		fg(color: string, text: string) {
			const codes: Record<string, number> = { dim: 90, muted: 36, accent: 96 };
			return `\x1b[${codes[color] ?? 37}m${text}\x1b[0m`;
		},
		bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	} as Theme;
}

function loaderPhase(rendered: string): [string, number | undefined] {
	const stripped = stripTerminalSequences(rendered);
	const plain = stripped.trimStart();
	const separatorIndex = plain.indexOf(" ");
	if (separatorIndex < 0) throw new Error("Expected a spinner separator in the working row");
	const spinner = plain.slice(0, separatorIndex);
	const textOffset =
		visibleWidth(stripped) - visibleWidth(plain) + visibleWidth(plain.slice(0, separatorIndex + 1));
	const marker = [...rendered.matchAll(/\x1b\[96m\x1b\[1m/g)].find((match) => {
		if (match.index === undefined) return false;
		return visibleWidth(stripTerminalSequences(rendered.slice(0, match.index))) >= textOffset;
	});
	return [
		spinner,
		marker?.index === undefined
			? undefined
			: visibleWidth(stripTerminalSequences(rendered.slice(0, marker.index))) - textOffset,
	];
}

type LoadedHandlers = Map<string, Handler[]> & { events: EventBus };

function loadExtension(): LoadedHandlers {
	const handlers = new Map<string, Handler[]>() as LoadedHandlers;
	const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
	const events: EventBus = {
		emit(channel, data) {
			for (const handler of eventHandlers.get(channel) ?? []) handler(data);
		},
		on(channel, handler) {
			const current = eventHandlers.get(channel) ?? new Set();
			current.add(handler);
			eventHandlers.set(channel, current);
			return () => current.delete(handler);
		},
	};
	handlers.events = events;
	zentui({
		registerEntryRenderer() {},
		appendEntry() {},
		events,
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel: () => "off",
	} as never);
	return handlers;
}

async function emit(
	handlers: Map<string, Handler[]>,
	name: string,
	ctx: unknown,
	event: unknown = {},
) {
	for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
}

function capability(handlers: LoadedHandlers) {
	const result = { supported: false, active: false };
	handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT, result);
	return result as typeof result & { version: number };
}

function harness() {
	const calls: Array<[string, unknown?]> = [];
	const forbidden = vi.fn();
	let indicator: { frames?: string[]; intervalMs?: number } | undefined;
	let message = "";
	let loader: Loader | undefined;
	const ui = {
		theme: theme(),
		getEditorComponent: () => undefined,
		setEditorComponent: forbidden,
		setFooter: forbidden,
		setWidget: forbidden,
		setWorkingVisible: forbidden,
		setWorkingMessage(value?: string) {
			calls.push(["message", value]);
			message = value ?? "Working...";
			loader?.setMessage(message);
		},
		setWorkingIndicator(value?: unknown) {
			calls.push(["indicator", value]);
			indicator = value as typeof indicator;
			loader?.setIndicator(indicator);
		},
	};
	return {
		calls,
		forbidden,
		activateLoader() {
			loader = new Loader(
				{ requestRender() {} } as never,
				(text) => text,
				(text) => text,
				message,
				indicator,
			);
			return loader;
		},
		ctx: {
			hasUI: true,
			mode: "tui",
			cwd: process.cwd(),
			model: undefined,
			getContextUsage: () => null,
			sessionManager: { getBranch: () => [], getSessionName: () => undefined },
			ui,
		},
	};
}

beforeEach(() => {
	runtime.enabled = true;
	runtime.freshWorkingDefaults = false;
	runtime.custom = true;
	runtime.message = "Stable";
	runtime.spinner = "star-bloom";
	runtime.spinnerIntervalMs = 100;
	runtime.textIntervalMs = 60;
	runtime.editorEnabled = false;
	runtime.editorStyle = "minimalist";
	runtime.placement = "above";
	runtime.config = undefined;
	settings.actions = undefined;
});

afterEach(() => vi.restoreAllMocks());

describe("working-line extension lifecycle integration", () => {
	it("wires full-row rebuilds, authoritative usage, parallel tools, and isolated cleanup", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		try {
			const handlers = loadExtension();
			const current = harness();
			const row = () => {
				const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
					| { frames?: string[] }
					| undefined;
				return stripTerminalSequences(indicator?.frames?.[0] ?? "");
			};
			await emit(handlers, "session_start", current.ctx);
			expect(current.calls.slice(0, 2).map(([name, value]) => [name, value])).toEqual([
				["message", ""],
				["indicator", expect.any(Object)],
			]);
			await emit(handlers, "agent_start", current.ctx);
			await emit(handlers, "turn_start", current.ctx, { turnIndex: 0, timestamp: Date.now() });
			const partialAssistant = {
				role: "assistant",
				usage: { input: 100, output: 4 },
				content: [],
				api: "google-generative-ai",
				provider: "google",
				model: "test",
				stopReason: "toolUse",
				timestamp: Date.now(),
			};
			const laterPartialAssistant = { ...partialAssistant, usage: { input: 120, output: 7 } };
			const finalAssistant = { ...partialAssistant, usage: { input: 150, output: 9 } };
			await emit(handlers, "message_update", current.ctx, { message: partialAssistant });
			expect(row()).toMatch(/Stable · \d+s · ↑100 ↓4/);
			const beforeDuplicate = current.calls.length;
			await emit(handlers, "message_update", current.ctx, { message: partialAssistant });
			expect(current.calls).toHaveLength(beforeDuplicate);
			await emit(handlers, "message_update", current.ctx, { message: laterPartialAssistant });
			// Streaming metrics stay coalesced before the deadline, then publish the latest snapshot.
			const writesBeforeDeadline = current.calls.length;
			vi.advanceTimersByTime(WORKING_LINE_METRIC_UPDATE_INTERVAL_MS - 1);
			expect(current.calls).toHaveLength(writesBeforeDeadline);
			expect(row()).toMatch(/Stable · \d+s · ↑100 ↓4/);
			vi.advanceTimersByTime(1);
			expect(current.calls).toHaveLength(writesBeforeDeadline + 2);
			expect(row()).toMatch(/Stable · \d+s · ↑120 ↓7/);
			await emit(handlers, "message_end", current.ctx, { message: finalAssistant });
			expect(row()).toMatch(/Stable · \d+s · ↑150 ↓9/);
			await emit(handlers, "tool_execution_start", current.ctx, {
				toolCallId: "one",
				toolName: "read",
			});
			expect(row()).toMatch(/Stable · read · \d+s · ↑150 ↓9/);
			await emit(handlers, "tool_execution_start", current.ctx, {
				toolCallId: "two",
				toolName: "bash",
			});
			expect(row()).toMatch(/Stable · bash · \d+s · ↑150 ↓9/);
			await emit(handlers, "tool_execution_end", current.ctx, { toolCallId: "two" });
			expect(row()).toMatch(/Stable · read · \d+s · ↑150 ↓9/);
			await emit(handlers, "tool_execution_end", current.ctx, { toolCallId: "one" });
			expect(row()).toMatch(/Stable · \d+s · ↑150 ↓9/);
			await emit(handlers, "turn_start", current.ctx, {
				turnIndex: 1,
				timestamp: Date.now(),
			});
			expect(row()).toContain("↑150 ↓9");
			await emit(handlers, "agent_end", current.ctx);
			expect(
				current.calls.filter(([name]) => name === "message").every(([, value]) => value === ""),
			).toBe(true);
			for (const [index, [name]] of current.calls.entries()) {
				if (name === "indicator") expect(current.calls[index - 1]).toEqual(["message", ""]);
			}
			expect(current.forbidden).not.toHaveBeenCalled();
			const beforeLateEnds = current.calls.length;
			await emit(handlers, "message_end", current.ctx, {
				message: { role: "user", usage: { input: 99, output: 99 } },
			});
			await emit(handlers, "message_end", current.ctx, {
				message: { ...finalAssistant, responseId: "late-after-agent" },
			});
			expect(current.calls).toHaveLength(beforeLateEnds);
			await emit(handlers, "session_shutdown", current.ctx);
			expect(current.calls.slice(-2).map(([name, value]) => [name, value])).toEqual([
				["indicator", undefined],
				["message", undefined],
			]);
			expect(current.forbidden).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it.each(["before", "after"])(
		"repairs an external message_end reset %s Zentui's handler at the next owned refresh",
		async (ordering) => {
			vi.useFakeTimers();
			const handlers = loadExtension();
			const current = harness();
			let loader: Loader | undefined;
			try {
				await emit(handlers, "session_start", current.ctx);
				const config = required(runtime.config).components.workingLine;
				config.textAnimation = "disabled";
				config.segments.elapsed = false;
				config.segments.thought = false;
				await emit(handlers, "agent_start", current.ctx);
				await emit(handlers, "turn_start", current.ctx, { turnIndex: 0, timestamp: Date.now() });
				loader = current.activateLoader();
				const row = () => stripTerminalSequences(required(loader).render(120).join("\n")).trim();
				const message = {
					role: "assistant",
					usage: { input: 12, output: 3 },
					content: [],
					api: "google-generative-ai",
					provider: "google",
					model: "test",
					stopReason: "stop",
					timestamp: Date.now(),
				};
				await emit(handlers, "message_update", current.ctx, { message });
				const writes = current.calls.filter(([name]) => name === "indicator").length;
				const reset = () => current.ctx.ui.setWorkingMessage();
				const finalHandlers = required(handlers.get("message_end"));
				if (ordering === "before") finalHandlers.unshift(reset);
				else finalHandlers.push(reset);
				await emit(handlers, "message_end", current.ctx, { message });
				if (ordering === "after") {
					expect(row()).toContain("Working...");
					// No polling or setter interception: native animation alone cannot repair this.
					vi.advanceTimersByTime(1000);
					expect(row()).toContain("Working...");
					await emit(handlers, "agent_end", current.ctx);
				}
				expect(row()).toMatch(/Stable · ↑12 ↓3$/);
				expect(current.calls.filter(([name]) => name === "indicator")).toHaveLength(writes);
				expect(current.forbidden).not.toHaveBeenCalled();
			} finally {
				await emit(handlers, "session_shutdown", current.ctx);
				loader?.stop();
				vi.useRealTimers();
			}
		},
	);

	it("composes keyed extension segments into the owned animated row", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		await emit(handlers, "session_start", current.ctx);
		expect(capability(handlers)).toEqual({
			supported: true,
			active: true,
			version: ZENTUI_WORKING_LINE_SEGMENT_PROTOCOL_VERSION,
		});
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "tps",
			text: "24.3 tok/s · TTFT 820ms",
		});
		expect(row()).toContain("Stable · 24.3 tok/s · TTFT 820ms");
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "queue",
			text: "queue 2",
		});
		expect(row()).toContain("queue 2 · 24.3 tok/s · TTFT 820ms");
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "tps" });
		expect(row()).toContain("Stable · queue 2");
		expect(row()).not.toContain("tok/s");
		await emit(handlers, "session_shutdown", current.ctx);
		expect(capability(handlers).active).toBe(false);
	});

	it("resets capability and routing when a replacement session starts", async () => {
		const handlers = loadExtension();
		const first = harness();
		await emit(handlers, "session_start", first.ctx);
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "@scope/publisher:session",
			text: "session A",
		});
		expect(capability(handlers).active).toBe(true);

		const second = harness();
		await emit(handlers, "session_start", second.ctx);
		expect(capability(handlers).active).toBe(true);
		const installed = second.calls
			.filter(([name, value]) => name === "indicator" && value !== undefined)
			.at(-1)?.[1] as { frames?: string[] } | undefined;
		expect(stripTerminalSequences(installed?.frames?.[0] ?? "")).not.toContain("session A");
		const firstCallsAfterRestart = first.calls.length;
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "@scope/publisher:session",
			text: "session B",
		});
		expect(first.calls).toHaveLength(firstCallsAfterRestart);
		const updated = second.calls
			.filter(([name, value]) => name === "indicator" && value !== undefined)
			.at(-1)?.[1] as { frames?: string[] } | undefined;
		expect(stripTerminalSequences(updated?.frames?.[0] ?? "")).toContain("session B");
		expect(stripTerminalSequences(updated?.frames?.[0] ?? "")).not.toContain("session A");
		await emit(handlers, "session_shutdown", second.ctx);
	});

	it("reports inactive across missing APIs, disable, re-enable, and session boundaries", async () => {
		const handlers = loadExtension();
		const missingApi = harness();
		(missingApi.ctx.ui as { setWorkingIndicator?: unknown }).setWorkingIndicator = undefined;
		await emit(handlers, "session_start", missingApi.ctx);
		expect(capability(handlers)).toEqual({
			supported: true,
			active: false,
			version: ZENTUI_WORKING_LINE_SEGMENT_PROTOCOL_VERSION,
		});
		await emit(handlers, "session_shutdown", missingApi.ctx);
		expect(capability(handlers).active).toBe(false);

		const enabled = harness();
		await emit(handlers, "session_start", enabled.ctx);
		expect(capability(handlers).active).toBe(true);
		await emit(handlers, "session_shutdown", enabled.ctx);
		expect(capability(handlers).active).toBe(false);

		runtime.enabled = false;
		const disabled = harness();
		await emit(handlers, "session_start", disabled.ctx);
		expect(capability(handlers).active).toBe(false);
		await emit(handlers, "session_shutdown", disabled.ctx);

		runtime.enabled = true;
		const reenabled = harness();
		await emit(handlers, "session_start", reenabled.ctx);
		expect(capability(handlers).active).toBe(true);
		await emit(handlers, "session_shutdown", reenabled.ctx);
		expect(capability(handlers).active).toBe(false);
	});

	it("reports inactive when the initial indicator setter fails", async () => {
		const handlers = loadExtension();
		const current = harness();
		const setIndicator = current.ctx.ui.setWorkingIndicator.bind(current.ctx.ui);
		let fail = true;
		current.ctx.ui.setWorkingIndicator = (value?: unknown) => {
			if (value !== undefined && fail) {
				fail = false;
				throw new Error("indicator unavailable");
			}
			setIndicator(value);
		};
		await emit(handlers, "session_start", current.ctx);
		expect(capability(handlers).active).toBe(false);
		await emit(handlers, "session_shutdown", current.ctx);
	});

	it("invalidates released state, ignores inactive updates, and accepts a current republish", async () => {
		const handlers = loadExtension();
		const current = harness();
		await emit(handlers, "session_start", current.ctx);
		expect(capability(handlers).active).toBe(true);
		const setIndicator = current.ctx.ui.setWorkingIndicator.bind(current.ctx.ui);
		let failures = 2;
		current.ctx.ui.setWorkingIndicator = (value?: unknown) => {
			if (value !== undefined && failures > 0) {
				failures -= 1;
				throw new Error("indicator unavailable");
			}
			setIndicator(value);
		};
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "@scope/publisher:queue",
			text: "stale queue 2",
		});
		expect(capability(handlers).active).toBe(false);
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "@scope/publisher:queue",
			text: "current queue 3",
		});

		await emit(handlers, "agent_start", current.ctx);
		expect(capability(handlers).active).toBe(true);
		const reinstalled = current.calls
			.filter(([name, value]) => name === "indicator" && value !== undefined)
			.at(-1)?.[1] as { frames?: string[] } | undefined;
		expect(stripTerminalSequences(reinstalled?.frames?.[0] ?? "")).not.toContain("stale queue");
		expect(stripTerminalSequences(reinstalled?.frames?.[0] ?? "")).not.toContain("current queue");

		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
			key: "@scope/publisher:queue",
			text: "current queue 3",
		});
		const republished = current.calls
			.filter(([name, value]) => name === "indicator" && value !== undefined)
			.at(-1)?.[1] as { frames?: string[] } | undefined;
		expect(stripTerminalSequences(republished?.frames?.[0] ?? "")).toContain("current queue 3");
		await emit(handlers, "session_shutdown", current.ctx);
	});

	it("renders an identical keyed replay after a transient segment update failure", async () => {
		const handlers = loadExtension();
		const current = harness();
		await emit(handlers, "session_start", current.ctx);
		const setIndicator = current.ctx.ui.setWorkingIndicator.bind(current.ctx.ui);
		let fail = true;
		current.ctx.ui.setWorkingIndicator = (value?: unknown) => {
			if (value !== undefined && fail) {
				fail = false;
				throw new Error("transient indicator failure");
			}
			setIndicator(value);
		};
		const update = { key: "@scope/publisher:queue", text: "queue 2" };
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, update);
		const afterFailure = current.calls
			.filter(([name, value]) => name === "indicator" && value !== undefined)
			.at(-1)?.[1] as { frames?: string[] } | undefined;
		expect(stripTerminalSequences(afterFailure?.frames?.[0] ?? "")).not.toContain("queue 2");
		handlers.events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, update);
		const afterReplay = current.calls
			.filter(([name, value]) => name === "indicator" && value !== undefined)
			.at(-1)?.[1] as { frames?: string[] } | undefined;
		expect(stripTerminalSequences(afterReplay?.frames?.[0] ?? "")).toContain("queue 2");
		expect(capability(handlers).active).toBe(true);
		await emit(handlers, "session_shutdown", current.ctx);
	});

	it("compacts live provider usage", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const message = (input: number, output: number) => ({
			role: "assistant",
			usage: { input, output },
			content: [],
			responseId: "reported",
		});

		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_update", current.ctx, { message: message(27_000, 1_400) });
		expect(row()).toContain("↑27k ↓1.4k");
		await emit(handlers, "message_end", current.ctx, { message: message(27_000, 1_400) });
		expect(row()).toContain("↑27k ↓1.4k");
	});

	it("coalesces an estimated boundary change and flushes exact final usage", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		try {
			const handlers = loadExtension();
			const current = harness();
			const row = () => {
				const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
					| { frames?: string[] }
					| undefined;
				return stripTerminalSequences(indicator?.frames?.[0] ?? "");
			};
			const message = (output: number) => ({
				role: "assistant",
				usage: { input: 0, output },
				content: [],
				responseId: "estimated-boundary",
			});

			await emit(handlers, "session_start", current.ctx);
			await emit(handlers, "agent_start", current.ctx);
			await emit(handlers, "turn_start", current.ctx);
			const partial = message(998);
			await emit(handlers, "message_update", current.ctx, { message: partial });
			await emit(handlers, "message_update", current.ctx, {
				message: partial,
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "abcdefgh",
					partial: { content: [{ type: "text", text: "abcdefgh" }] },
				},
			});
			expect(row()).toContain("↑0 ↓998");
			await emit(handlers, "message_end", current.ctx, { message: message(999) });
			expect(row()).toContain("↑0 ↓999");
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps cumulative billion-scale totals compact across continuations", async () => {
		runtime.message = "Response usage stays visible here";
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const assistant = (input: number, output: number, responseId: string) => ({
			role: "assistant",
			usage: { input, output },
			content: [],
			api: "openai-completions",
			provider: "openai-compatible",
			model: "test",
			stopReason: "toolUse",
			timestamp: Date.now(),
			responseId,
		});

		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_end", current.ctx, {
			message: assistant(1_000_000_000, 1_000_000_000, "first"),
		});
		expect(row()).toContain("↑1000M ↓1000M");

		await emit(handlers, "turn_start", current.ctx);
		expect(row()).toContain("↑1000M ↓1000M");
		await emit(handlers, "tool_execution_start", current.ctx, {
			toolCallId: "wide",
			toolName: "123456789012345678",
		});
		const writesBeforeLiveUsage = current.calls.length;
		await emit(handlers, "message_update", current.ctx, {
			message: assistant(12, 3, "second"),
		});
		expect(row()).toContain("↑1000M ↓1000M");
		expect(current.calls.slice(writesBeforeLiveUsage)).toEqual([["message", ""]]);

		await emit(handlers, "tool_execution_end", current.ctx, { toolCallId: "wide" });
		await emit(handlers, "message_end", current.ctx, {
			message: assistant(14, 5, "second"),
		});
		expect(row()).toContain("↑1000M ↓1000M");

		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_end", current.ctx, {
			message: assistant(499_986, 499_995, "third"),
		});
		expect(row()).toContain("↑1001M ↓1001M");
	});

	it("keeps committed tokens through retry lifecycle and initial zero usage, then accumulates final usage", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const assistant = (input: number, output: number, responseId: string) => ({
			role: "assistant",
			usage: { input, output },
			provider: "mistral",
			responseId,
		});

		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_end", current.ctx, {
			message: assistant(20, 4, "committed"),
		});
		expect(row()).toContain("↑20 ↓4");

		await emit(handlers, "agent_end", current.ctx);
		expect(row()).toContain("↑20 ↓4");
		await emit(handlers, "agent_start", current.ctx);
		expect(row()).toContain("↑20 ↓4");
		await emit(handlers, "turn_start", current.ctx);
		expect(row()).toContain("↑20 ↓4");
		await emit(handlers, "message_update", current.ctx, {
			message: assistant(0, 0, "retry"),
		});
		expect(row()).toContain("↑20 ↓4");
		await emit(handlers, "message_end", current.ctx, {
			message: assistant(5, 2, "retry"),
		});
		expect(row()).toContain("↑25 ↓6");
	});

	it("shows OpenAI Codex Responses placeholder usage as a zero estimate until exact final usage", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const partial = {
			role: "assistant",
			content: [{ type: "text", text: "streaming" }],
			// Codex Responses reports exact usage only on terminal response.completed.
			usage: { input: 0, output: 0 },
			provider: "openai-codex",
			model: "gpt-5.4",
			responseId: "terminal-only",
		};
		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		const writesBeforeUpdates = current.calls.length;
		await emit(handlers, "message_update", current.ctx, { message: partial });
		await emit(handlers, "message_update", current.ctx, { message: partial });
		await emit(handlers, "message_update", current.ctx, {
			message: { role: "assistant", usage: { input: 2.5, output: 1 } },
		});
		await emit(handlers, "message_update", current.ctx, {
			message: { role: "user", usage: { input: 99, output: 99 } },
		});
		expect(current.calls).toHaveLength(writesBeforeUpdates + 2);
		expect(row()).toContain("↑0 ↓0");
		await emit(handlers, "message_end", current.ctx, {
			message: { ...partial, usage: { input: 42, output: 6 } },
		});
		expect(row()).toContain("↑42 ↓6");
	});

	it("preserves approximation across rejected finals and ignores late messages", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const assistantMessage = (input: number, output: number, responseId: string) => ({
			role: "assistant",
			usage: { input, output },
			content: [],
			responseId,
		});
		const partial = assistantMessage(0, 0, "active");
		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_end", current.ctx, {
			message: assistantMessage(1, 1, "already-committed"),
		});
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_update", current.ctx, { message: partial });
		expect(row()).toContain("↑1 ↓1");
		const beforeRejected = current.calls.length;
		await emit(handlers, "message_end", current.ctx, {
			message: assistantMessage(90, 9, "mismatched"),
		});
		expect(current.calls).toHaveLength(beforeRejected);
		expect(row()).toContain("↑1 ↓1");
		await emit(handlers, "message_end", current.ctx, {
			message: assistantMessage(90, 9, "already-committed"),
		});
		expect(current.calls).toHaveLength(beforeRejected);
		expect(row()).toContain("↑1 ↓1");
		const beforeLateMessages = current.calls.length;
		await emit(handlers, "message_end", current.ctx, {
			message: { role: "user", usage: { input: 99, output: 99 } },
		});
		await emit(handlers, "message_end", current.ctx, {
			message: assistantMessage(99, 99, "late-unmatched"),
		});
		expect(current.calls).toHaveLength(beforeLateMessages);
		expect(row()).toContain("↑1 ↓1");
		await emit(handlers, "message_end", current.ctx, {
			message: assistantMessage(7, 2, "active"),
		});
		expect(row()).toContain("↑8 ↓3");
		const beforeDuplicate = current.calls.length;
		await emit(handlers, "message_end", current.ctx, {
			message: assistantMessage(99, 99, "active"),
		});
		expect(current.calls).toHaveLength(beforeDuplicate);
		expect(row()).toContain("↑8 ↓3");
	});

	it("streams OpenCode tool-call arguments immediately and reconciles whole-interaction totals", async () => {
		const handlers = loadExtension();
		const current = harness();
		const rows = () =>
			current.calls
				.filter(([name, value]) => name === "indicator" && value !== undefined)
				.map(([, value]) =>
					stripTerminalSequences((value as { frames?: string[] }).frames?.[0] ?? ""),
				);
		const message = (
			input: number,
			output: number,
			responseId: string,
			content: unknown[] = [],
		) => ({
			role: "assistant",
			usage: { input, output },
			content,
			api: "openai-completions",
			provider: "opencode",
			model: "openai/gpt-5",
			stopReason: "toolUse",
			timestamp: Date.now(),
			responseId,
		});
		const toolCall = { type: "toolCall", id: "call-1", name: "bash", arguments: {} };

		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_end", current.ctx, { message: message(10, 2, "first") });
		await emit(handlers, "turn_start", current.ctx);
		const partial = message(0, 0, "tool-response", [toolCall]);
		await emit(handlers, "message_update", current.ctx, {
			message: partial,
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 0,
				partial,
			},
		});
		const beforeDeltas = current.calls.length;
		await emit(handlers, "message_update", current.ctx, {
			message: partial,
			assistantMessageEvent: {
				type: "toolcall_delta",
				contentIndex: 0,
				delta: '{"command":',
				partial,
			},
		});
		await emit(handlers, "message_update", current.ctx, {
			message: partial,
			assistantMessageEvent: {
				type: "toolcall_delta",
				contentIndex: 0,
				delta: '{"command":',
				partial,
			},
		});
		expect(current.calls).toHaveLength(beforeDeltas);
		expect(rows().at(-1)).toContain("↑10 ↓2");
		expect(rows().at(-1)).not.toMatch(/thinking|thought for/);
		const beforeEnd = current.calls.length;
		await emit(handlers, "message_update", current.ctx, {
			message: partial,
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall,
				partial,
			},
		});
		expect(current.calls).toHaveLength(beforeEnd);
		await emit(handlers, "message_end", current.ctx, {
			message: message(15, 4, "tool-response", [toolCall]),
		});
		expect(rows().at(-1)).toContain("↑25 ↓6");
		expect(rows().at(-1)).not.toMatch(/thinking|thought for/);
	});

	it("preserves estimated values on malformed finals and reconciles exact finals", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const message = (input: number, output: number, responseId: string) => ({
			role: "assistant",
			usage: { input, output },
			content: [],
			responseId,
		});

		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_update", current.ctx, {
			message: message(0, 0, "malformed"),
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "abcdefghijkl",
				partial: { content: [{ type: "text", text: "abcdefghijkl" }] },
			},
		});
		expect(row()).toContain("↑0 ↓3");
		await emit(handlers, "message_end", current.ctx, {
			message: message(-1, 9, "malformed"),
		});
		expect(row()).toContain("↑0 ↓3");

		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_update", current.ctx, {
			message: message(0, 0, "exact"),
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "abcdefgh",
				partial: { content: [{ type: "text", text: "abcdefgh" }] },
			},
		});
		expect(row()).toContain("↑0 ↓2");
		await emit(handlers, "message_end", current.ctx, {
			message: message(4, 1, "exact"),
		});
		expect(row()).toContain("↑4 ↓1");
	});

	it("ignores an all-zero placeholder after nonzero live usage", async () => {
		const handlers = loadExtension();
		const current = harness();
		const row = () => {
			const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
				| { frames?: string[] }
				| undefined;
			return stripTerminalSequences(indicator?.frames?.[0] ?? "");
		};
		const message = (input: number, output: number) => ({
			role: "assistant",
			usage: { input, output },
			provider: "mistral",
			responseId: "zero-snapshot",
		});
		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx);
		await emit(handlers, "message_update", current.ctx, { message: message(20, 4) });
		expect(row()).toContain("↑20 ↓4");
		await emit(handlers, "message_update", current.ctx, { message: message(0, 0) });
		expect(row()).toContain("↑20 ↓4");
		await emit(handlers, "message_end", current.ctx, { message: message(25, 7) });
		expect(row()).toContain("↑25 ↓7");
	});

	it.each(["star-bloom", "pulse"] as const)(
		"rebases the %s spinner and animated text on delayed Loader activation and later rebuilds",
		async (spinner) => {
			runtime.spinner = spinner;
			vi.useFakeTimers();
			vi.setSystemTime(0);
			const handlers = loadExtension();
			const current = harness();
			let loader: Loader | undefined;
			try {
				await emit(handlers, "session_start", current.ctx);
				vi.advanceTimersByTime(5000);
				loader = current.activateLoader();
				const activatedAtFrameZero = loader.render(80)[1] ?? "";
				await emit(handlers, "agent_start", current.ctx);
				await emit(handlers, "turn_start", current.ctx, { turnIndex: 0, timestamp: Date.now() });
				expect(current.calls.filter(([name]) => name === "indicator")).toHaveLength(2);
				expect(loaderPhase(loader.render(80)[1] ?? "")).toEqual(loaderPhase(activatedAtFrameZero));

				vi.advanceTimersByTime(900);
				const beforeRebuild = loader.render(80)[1] ?? "";
				const beforePhase = loaderPhase(beforeRebuild);
				expect(beforePhase[1], "expected animated-text high tier before rebuild").toBeDefined();
				const assistant = {
					role: "assistant",
					usage: { input: 12, output: 3 },
					content: [],
					api: "google-generative-ai",
					provider: "google",
					model: "test",
					stopReason: "toolUse",
					timestamp: Date.now(),
				};
				await emit(handlers, "message_update", current.ctx, { message: assistant });
				const afterRebuild = loader.render(80)[1] ?? "";
				expect(stripTerminalSequences(afterRebuild)).toContain("↑12 ↓3");
				const afterPhase = loaderPhase(afterRebuild);
				expect(afterPhase[1], "expected animated-text high tier after rebuild").toBeDefined();
				expect(afterPhase).toEqual(beforePhase);
				const writesAfterRebuild = current.calls.length;
				await emit(handlers, "message_update", current.ctx, { message: assistant });
				expect(current.calls).toHaveLength(writesAfterRebuild);
			} finally {
				loader?.stop();
				await emit(handlers, "session_shutdown", current.ctx);
				vi.useRealTimers();
			}
		},
	);

	it("bounds repeated meaningful streaming rows and converges on schedule", async () => {
		vi.useFakeTimers();
		try {
			runtime.message = "m".repeat(43);
			runtime.spinnerIntervalMs = 997;
			runtime.textIntervalMs = 900;
			const handlers = loadExtension();
			const current = harness();
			const row = () => {
				const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as
					| { frames?: string[] }
					| undefined;
				return stripTerminalSequences(indicator?.frames?.[0] ?? "");
			};
			await emit(handlers, "session_start", current.ctx);
			await emit(handlers, "agent_start", current.ctx);
			await emit(handlers, "turn_start", current.ctx);
			const callsBeforeStreaming = current.calls.length;
			for (let output = 1; output <= 20; output++) {
				await emit(handlers, "message_update", current.ctx, {
					message: {
						role: "assistant",
						usage: { input: 999_999_999, output },
						responseId: "performance-stream",
					},
				});
			}
			expect(current.calls).toHaveLength(callsBeforeStreaming + 2);
			vi.advanceTimersByTime(WORKING_LINE_METRIC_UPDATE_INTERVAL_MS);
			expect(current.calls).toHaveLength(callsBeforeStreaming + 4);
			expect(row()).toContain("↑1000M ↓20");
			await emit(handlers, "session_shutdown", current.ctx);
		} finally {
			vi.useRealTimers();
		}
	});

	it("owns the full fallback row while custom messages are off and releases both APIs", async () => {
		runtime.custom = false;
		const handlers = loadExtension();
		const current = harness();
		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "turn_start", current.ctx, { turnIndex: 0, timestamp: Date.now() });
		await emit(handlers, "agent_end", current.ctx);
		expect(current.calls[0]).toEqual(["message", ""]);
		const indicator = current.calls.findLast(([name]) => name === "indicator")?.[1] as {
			frames?: string[];
		};
		expect(stripTerminalSequences(indicator.frames?.[0] ?? "")).toContain("Working…");
		await emit(handlers, "session_shutdown", current.ctx);
		expect(current.calls.slice(-2)).toEqual([
			["indicator", undefined],
			["message", undefined],
		]);
	});

	it("makes zero working-row calls when startup is disabled", async () => {
		runtime.enabled = false;
		const handlers = loadExtension();
		const current = harness();
		await emit(handlers, "session_start", current.ctx);
		await emit(handlers, "agent_start", current.ctx);
		await emit(handlers, "agent_end", current.ctx);
		await emit(handlers, "session_shutdown", current.ctx);
		expect(current.calls).toEqual([]);
		expect(current.forbidden).not.toHaveBeenCalled();
	});
});

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

function editorHarness(wrapped = false) {
	const current = harness();
	const requestRender = vi.fn();
	const tui = { requestRender, terminal: { rows: 24, cols: 100 } };
	const editorTheme = { borderColor: (text: string) => text, selectList: {} };
	const keybindings = { matches: () => false };
	const native = () => new CustomEditor(tui as never, editorTheme as never, keybindings as never);
	let factory: EditorFactory | undefined = wrapped ? native : undefined;
	let editor: ReturnType<EditorFactory> & Partial<Focusable> = native();
	editor.focused = true;
	const visible = vi.fn();
	const ui = {
		...current.ctx.ui,
		getEditorComponent: () => factory,
		setEditorComponent(next: EditorFactory | undefined) {
			factory = next;
			const text = editor.getText();
			editor = next?.(tui as never, editorTheme as never, keybindings as never) ?? native();
			editor.setText(text);
			// Public host focus transfer occurs after installing the new editor.
			editor.focused = true;
		},
		getEditorText: () => editor.getText(),
		setEditorText: (text: string) => editor.setText(text),
		setWorkingVisible: visible,
	};
	return {
		...current,
		ctx: { ...current.ctx, ui },
		visible,
		requestRender,
		get editor() {
			return editor;
		},
		get factory() {
			return factory;
		},
		invokeFactory(value: EditorFactory) {
			const instance: ReturnType<EditorFactory> & Partial<Focusable> = value(
				tui as never,
				editorTheme as never,
				keybindings as never,
			);
			instance.focused = true;
			return instance;
		},
		render: (width = 100) => editor.render(width).map(stripTerminalSequences),
	};
}

describe("working-line owned editor border integration", () => {
	beforeEach(() => {
		runtime.editorEnabled = true;
		runtime.placement = "border";
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it.each(["minimalist", "opencode", "opencode-copy-friendly", "accent-rail"] as const)(
		"uses fresh Working defaults with %s and releases all owned timers",
		async (style) => {
			runtime.freshWorkingDefaults = true;
			runtime.editorStyle = style;
			const handlers = loadExtension();
			const h = editorHarness();
			try {
				await emit(handlers, "session_start", h.ctx);
				const config = required(runtime.config);
				expect(config.components.workingLine).toMatchObject({
					enabled: true,
					placement: "border",
					segments: { elapsed: true, tokenRate: true },
				});
				expect(config.components.thinkingSteps.enabled).toBe(false);
				expect(config.components.editor.styles.minimalist.showTimer).toBe(false);
				await emit(handlers, "agent_start", h.ctx);
				h.editor.setText("retained draft");
				const rows = h.render();
				expect(capability(handlers).active).toBe(true);
				if (style === "accent-rail") {
					const indicator = h.calls.findLast(([name]) => name === "indicator")?.[1] as
						| { frames?: string[] }
						| undefined;
					expect(stripTerminalSequences(indicator?.frames?.[0] ?? "")).toMatch(/Stable · 0s/);
					expect(rows.join("\n")).not.toContain("Stable");
					expect(h.visible).not.toHaveBeenCalled();
				} else {
					expect(rows[0]).toMatch(/Stable · 0s/);
					expect(rows.slice(1).join("\n")).not.toContain("Stable");
					expect(h.visible).toHaveBeenLastCalledWith(false);
				}
				expect(h.editor.getText()).toBe("retained draft");
				expect(config.components.workingLine.placement).toBe("border");
				await emit(handlers, "agent_end", h.ctx);
				if (style !== "accent-rail") expect(h.visible).toHaveBeenLastCalledWith(true);
			} finally {
				await emit(handlers, "session_shutdown", h.ctx);
			}
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	for (const wrapped of [false, true]) {
		it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
			`releases %s immediately for a native dialog in the ${wrapped ? "wrapped" : "standalone"} factory`,
			async (style) => {
				runtime.editorStyle = style;
				const handlers = loadExtension();
				const h = editorHarness(wrapped);
				await emit(handlers, "session_start", h.ctx);
				await emit(handlers, "agent_start", h.ctx);
				const choices = structuredClone(required(runtime.config).components);
				const factory = h.factory;
				const aboveTimers = vi.getTimerCount();
				h.editor.setText("steering prompt");
				expect(h.render()[0]).toContain("Stable");
				expect(vi.getTimerCount()).toBe(aboveTimers + 1);
				// Native select/input/editor dialogs transfer focus but retain this factory.
				h.editor.focused = false;
				expect(h.factory).toBe(factory);
				expect(h.visible.mock.calls).toEqual([[false], [true]]);
				expect(vi.getTimerCount()).toBe(aboveTimers);
				h.requestRender.mockClear();
				vi.advanceTimersByTime(300);
				expect(h.requestRender).not.toHaveBeenCalled();
				const refocusTimers = vi.getTimerCount();
				h.editor.focused = true;
				expect(h.visible.mock.calls).toEqual([[false], [true]]);
				expect(vi.getTimerCount()).toBe(refocusTimers);
				vi.advanceTimersByTime(300);
				expect(h.visible).toHaveBeenLastCalledWith(true);
				expect(h.render()[0]).toContain("Stable");
				expect(h.visible.mock.calls).toEqual([[false], [true], [false]]);
				expect(vi.getTimerCount()).toBe(refocusTimers + 1);
				expect(h.editor.getText()).toBe("steering prompt");
				expect(required(runtime.config).components).toEqual(choices);
				await emit(handlers, "session_shutdown", h.ctx);
				expect(vi.getTimerCount()).toBe(0);
			},
		);

		it(`ignores stale focus callbacks from a replaced ${wrapped ? "wrapped" : "standalone"} instance`, async () => {
			const handlers = loadExtension();
			const h = editorHarness(wrapped);
			await emit(handlers, "session_start", h.ctx);
			await emit(handlers, "agent_start", h.ctx);
			expect(h.render()[0]).toContain("Stable");
			const old = h.editor;
			const factory = h.factory;
			h.ctx.ui.setEditorComponent(factory);
			expect(h.render()[0]).toContain("Stable");
			const calls = h.visible.mock.calls.length;
			const timers = vi.getTimerCount();
			old.focused = false;
			old.focused = true;
			expect(old.render(100).map(stripTerminalSequences).join("\n")).not.toContain("Stable");
			expect(h.factory).toBe(factory);
			expect(h.visible).toHaveBeenCalledTimes(calls);
			expect(vi.getTimerCount()).toBe(timers);
			expect(h.render()[0]).toContain("Stable");
			await emit(handlers, "session_shutdown", h.ctx);
			old.focused = false;
			old.focused = true;
			old.render(100);
			expect(h.visible).toHaveBeenLastCalledWith(true);
			expect(vi.getTimerCount()).toBe(0);
		});

		it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
			`bootstraps %s in the ${wrapped ? "wrapped" : "standalone"} factory and releases on resize, failure and finish`,
			async (style) => {
				runtime.editorStyle = style;
				const handlers = loadExtension();
				const h = editorHarness(wrapped);
				await emit(handlers, "session_start", h.ctx);
				await emit(handlers, "agent_start", h.ctx);
				expect(h.visible).not.toHaveBeenCalled();
				h.editor.setText("steering prompt");
				expect(h.render()[0]).toContain("Stable");
				expect(h.render().slice(1).join("\n")).toContain("steering prompt");
				expect(h.visible.mock.calls).toEqual([[false]]);
				const renders = h.requestRender.mock.calls.length;
				vi.advanceTimersByTime(300);
				expect(h.requestRender.mock.calls.length).toBeGreaterThan(renders);

				expect(h.render(12).join("\n")).not.toContain("Stable");
				expect(h.visible.mock.calls).toEqual([[false], [true]]);
				expect(h.render()[0]).toContain("Stable");
				const nativeRender = vi.spyOn(CustomEditor.prototype, "render").mockReturnValue(["unsafe"]);
				expect(h.render()).toEqual(["unsafe"]);
				expect(h.visible).toHaveBeenLastCalledWith(true);
				nativeRender.mockRestore();
				expect(h.render()[0]).toContain("Stable");
				await emit(handlers, "agent_end", h.ctx);
				expect(h.visible).toHaveBeenLastCalledWith(true);
				expect(h.render().join("\n")).not.toContain("Stable");
				await emit(handlers, "session_shutdown", h.ctx);
				expect(vi.getTimerCount()).toBe(0);
			},
		);
	}

	it("reconciles Above/Border, styles and disabled/native without rewriting independent choices", async () => {
		const handlers = loadExtension();
		const h = editorHarness();
		await emit(handlers, "session_start", h.ctx);
		await emit(handlers, "agent_start", h.ctx);
		expect(h.render()[0]).toContain("Stable");
		const actions = required(settings.actions);
		const ctx = h.ctx as unknown as ExtensionContext;
		const working = structuredClone(actions.getConfig().components.workingLine);
		const editor = structuredClone(actions.getConfig().components.editor);
		actions.setWorkingLineComponent({ placement: "above" }, ctx);
		expect(h.visible).toHaveBeenLastCalledWith(true);
		expect(h.render().join("\n")).not.toContain("Stable");
		actions.setWorkingLineComponent({ placement: "border" }, ctx);
		expect(h.visible).toHaveBeenLastCalledWith(false);
		expect(actions.getConfig().components.editor).toEqual(editor);
		for (const style of [
			"accent-rail",
			"opencode",
			"opencode-copy-friendly",
			"minimalist",
		] as const) {
			actions.setEditorComponent({ style }, ctx);
			if (style === "accent-rail") {
				expect(h.visible).toHaveBeenLastCalledWith(true);
				expect(h.render().join("\n")).not.toContain("Stable");
			} else {
				expect(h.render()[0]).toContain("Stable");
				expect(h.visible).toHaveBeenLastCalledWith(false);
			}
		}
		actions.setEditorComponent({ enabled: false }, ctx);
		expect(h.factory).toBeUndefined();
		expect(h.visible).toHaveBeenLastCalledWith(true);
		expect(h.render().join("\n")).not.toContain("Stable");
		actions.setEditorComponent({ enabled: true }, ctx);
		expect(h.render()[0]).toContain("Stable");
		expect(actions.getConfig().components.workingLine).toEqual(working);
		await emit(handlers, "session_shutdown", h.ctx);
	});

	it.each(["native", "foreign", "throwing-getter"] as const)(
		"detects %s ownership loss on animation ticks without metric changes and ignores stale instances/factories",
		async (replacement) => {
			const handlers = loadExtension();
			const h = editorHarness();
			await emit(handlers, "session_start", h.ctx);
			await emit(handlers, "agent_start", h.ctx);
			expect(h.render()[0]).toContain("Stable");
			const oldEditor = h.editor;
			const oldFactory = required(h.factory);
			if (replacement === "throwing-getter") {
				h.ctx.ui.getEditorComponent = () => {
					throw new Error("unobservable");
				};
			} else {
				h.ctx.ui.setEditorComponent(
					replacement === "native"
						? undefined
						: () => ({
								render: () => ["foreign"],
								getText: () => "",
								setText() {},
								handleInput() {},
								invalidate() {},
							}),
				);
			}
			vi.advanceTimersByTime(300);
			expect(h.visible).toHaveBeenLastCalledWith(true);
			const calls = h.visible.mock.calls.length;
			oldEditor.render(12);
			expect(oldEditor.render(100).map(stripTerminalSequences).join("\n")).not.toContain("Stable");
			const detached = h.invokeFactory(oldFactory);
			// A foreign factory rendering this new instance is indistinguishable from delegation.
			// Construction alone must not claim the row; native/unknown factories stay definitive.
			if (replacement !== "foreign")
				expect(detached.render(100).map(stripTerminalSequences).join("\n")).not.toContain("Stable");
			vi.advanceTimersByTime(300);
			expect(h.visible).toHaveBeenCalledTimes(calls);
			expect(required(settings.actions).getConfig().components.workingLine.placement).toBe(
				"border",
			);
			await emit(handlers, "session_shutdown", h.ctx);
		},
	);

	it.each(["visibility", "editor-getter", "editor-transfer"] as const)(
		"falls above with missing %s APIs, preserving canonical Border",
		async (missing) => {
			const handlers = loadExtension();
			const h = editorHarness();
			const method = {
				visibility: "setWorkingVisible",
				"editor-getter": "getEditorComponent",
				"editor-transfer": "getEditorText",
			}[missing];
			Object.defineProperty(h.ctx.ui, method, { value: undefined, configurable: true });
			await emit(handlers, "session_start", h.ctx);
			await emit(handlers, "agent_start", h.ctx);
			expect(h.render().join("\n")).not.toContain("Stable");
			expect(h.visible).not.toHaveBeenCalled();
			expect(h.calls.some(([name]) => name === "indicator")).toBe(true);
			expect(required(settings.actions).getConfig().components.workingLine.placement).toBe(
				"border",
			);
			await emit(handlers, "session_shutdown", h.ctx);
		},
	);

	it.each(["disabled", "accent-rail"] as const)(
		"keeps saved Border above at %s startup",
		async (mode) => {
			runtime.editorEnabled = mode !== "disabled";
			if (mode === "accent-rail") runtime.editorStyle = "accent-rail";
			const handlers = loadExtension();
			const h = editorHarness();
			await emit(handlers, "session_start", h.ctx);
			await emit(handlers, "agent_start", h.ctx);
			expect(h.render().join("\n")).not.toContain("Stable");
			expect(h.visible).not.toHaveBeenCalled();
			expect(required(settings.actions).getConfig().components.workingLine.placement).toBe(
				"border",
			);
			await emit(handlers, "session_shutdown", h.ctx);
		},
	);

	it("releases on a late metadata exception and ignores a replaced instance of the same factory", async () => {
		const handlers = loadExtension();
		const h = editorHarness();
		await emit(handlers, "session_start", h.ctx);
		await emit(handlers, "agent_start", h.ctx);
		expect(h.render()[0]).toContain("Stable");
		const getName = h.ctx.sessionManager.getSessionName;
		h.ctx.sessionManager.getSessionName = () => {
			throw new Error("metadata unavailable");
		};
		expect(h.render().join("\n")).not.toContain("Stable");
		expect(h.visible).toHaveBeenLastCalledWith(true);
		h.ctx.sessionManager.getSessionName = getName;
		expect(h.render()[0]).toContain("Stable");
		const old = h.editor;
		h.ctx.ui.setEditorComponent(h.factory);
		expect(h.render()[0]).toContain("Stable");
		const calls = h.visible.mock.calls.length;
		old.render(12);
		expect(old.render(100).map(stripTerminalSequences).join("\n")).not.toContain("Stable");
		expect(h.visible).toHaveBeenCalledTimes(calls);
		expect(h.render()[0]).toContain("Stable");
		await emit(handlers, "session_shutdown", h.ctx);
	});

	it("detects ownership replacement during rendering before the next timer tick", async () => {
		const handlers = loadExtension();
		const h = editorHarness();
		await emit(handlers, "session_start", h.ctx);
		await emit(handlers, "agent_start", h.ctx);
		expect(h.render()[0]).toContain("Stable");
		const old = h.editor;
		h.ctx.ui.setEditorComponent(undefined);
		expect(old.render(100).map(stripTerminalSequences).join("\n")).not.toContain("Stable");
		expect(h.visible).toHaveBeenLastCalledWith(true);
		await emit(handlers, "session_shutdown", h.ctx);
	});

	it("ignores old generation callbacks during restart and uses the current session", async () => {
		const handlers = loadExtension();
		const first = editorHarness();
		await emit(handlers, "session_start", first.ctx);
		await emit(handlers, "agent_start", first.ctx);
		expect(first.render()[0]).toContain("Stable");
		const oldEditor = first.editor;
		const oldFactory = required(first.factory);
		const second = editorHarness();
		const starting = emit(handlers, "session_start", second.ctx);
		expect(first.visible).toHaveBeenLastCalledWith(true);
		oldEditor.render(12);
		expect(oldEditor.render(100).map(stripTerminalSequences).join("\n")).not.toContain("Stable");
		await starting;
		await emit(handlers, "agent_start", second.ctx);
		expect(second.render()[0]).toContain("Stable");
		const calls = second.visible.mock.calls.length;
		first.invokeFactory(oldFactory).render(100);
		oldEditor.render(12);
		oldEditor.render(100);
		expect(second.visible).toHaveBeenCalledTimes(calls);
		expect(second.render()[0]).toContain("Stable");
		const fresh = {
			...second.ctx,
			sessionManager: { ...second.ctx.sessionManager, getSessionName: () => "CURRENT SESSION" },
		};
		await emit(handlers, "session_info_changed", fresh);
		expect(second.render().join("\n")).toContain("CURRENT SESSION");
		await emit(handlers, "session_shutdown", fresh);
		expect(second.visible).toHaveBeenLastCalledWith(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});
