import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Text } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_SUMMARY_ENTRY_TYPE } from "../extensions/zentui/interaction-summary";

const stripTerminalSequences = stripVTControlCharacters;

const runtime = vi.hoisted(() => ({
	enabled: true,
	turnSummary: true,
	tokens: true,
	thought: true,
}));

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists() {},
		loadConfig: () => {
			const config = structuredClone(actual.defaultConfig);
			config.projectRefreshIntervalMs = 0;
			config.components.editor.enabled = false;
			config.components.userMessages.enabled = false;
			config.components.selectorBorders.enabled = false;
			config.components.footer.style = "native";
			config.components.workingLine.enabled = runtime.enabled;
			config.components.workingLine.turnSummary = runtime.turnSummary;
			config.components.workingLine.segments.tokens = runtime.tokens;
			config.components.workingLine.segments.thought = runtime.thought;
			config.components.workingLine.messages = { custom: true, values: ["Stable"] };
			return config;
		},
	};
});

import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

function assistant(input: number, output: number, timestamp: number) {
	return {
		role: "assistant",
		usage: { input, output },
		content: [],
		api: "test",
		provider: "provider",
		model: "model",
		stopReason: "stop",
		timestamp,
	};
}

function harness(options: { renderer?: boolean; appendError?: boolean } = {}) {
	const handlers = new Map<string, Handler[]>();
	const appended: Array<[string, unknown]> = [];
	const appendEntry = vi.fn((type: string, data: unknown) => {
		if (options.appendError) throw new Error("append failed");
		appended.push([type, data]);
	});
	const renderers = new Map<string, unknown>();
	const workingIndicators: Array<{ frames?: string[] }> = [];
	const sendMessage = vi.fn();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand() {},
		...(options.renderer === false
			? {}
			: {
					registerEntryRenderer(type: string, renderer: unknown) {
						renderers.set(type, renderer);
					},
				}),
		appendEntry,
		sendMessage,
		getThinkingLevel: () => "off",
	} as never);
	let idle = true;
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		model: undefined,
		isIdle: () => idle,
		getContextUsage: () => null,
		sessionManager: { getBranch: () => [], getSessionName: () => undefined },
		ui: {
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			} as Theme,
			getEditorComponent: () => undefined,
			setWorkingMessage() {},
			setWorkingIndicator(indicator?: { frames?: string[] }) {
				if (indicator) workingIndicators.push(indicator);
			},
		},
	};
	const emit = async (name: string, event: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return {
		appended,
		appendEntry,
		renderers,
		workingIndicators,
		sendMessage,
		ctx,
		emit,
		setIdle: (value: boolean) => (idle = value),
	};
}

beforeEach(() => {
	runtime.enabled = true;
	runtime.turnSummary = true;
	runtime.tokens = true;
	runtime.thought = true;
	vi.useRealTimers();
});

describe("turn summary lifecycle integration", () => {
	it("appends exactly once at full settlement, never at agent_end, using only appendEntry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const current = harness();
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("turn_start");
		await current.emit("message_end", { message: assistant(1000, 10, 1) });
		await current.emit("agent_end");
		expect(current.appended).toEqual([]);
		vi.setSystemTime(43_000);
		await current.emit("agent_settled");
		expect(current.appended).toEqual([
			[
				TURN_SUMMARY_ENTRY_TYPE,
				{
					version: 3,
					durationMs: 42_000,
					thoughtDurationMs: 0,
					input: 1000,
					output: 10,
					stylePrefix: "\x1b[1;36m",
				},
			],
		]);
		await current.emit("agent_settled");
		expect(current.appended).toHaveLength(1);
		expect(current.sendMessage).not.toHaveBeenCalled();
		expect(current.renderers.has(TURN_SUMMARY_ENTRY_TYPE)).toBe(true);
	});

	it("persists thought in v3 even when the live Thinking segment is disabled", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		runtime.thought = false;
		const current = harness();
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("turn_start");
		const message = assistant(7_100, 779, 1);
		await current.emit("message_update", {
			message,
			assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: message },
		});
		const activeThoughtFrames = current.workingIndicators.at(-1)?.frames ?? [];
		expect(activeThoughtFrames.length).toBeGreaterThan(0);
		for (const frame of activeThoughtFrames) {
			const liveText = stripTerminalSequences(frame);
			expect(liveText).not.toMatch(/(?:^| · )thinking \d+s(?: · |$)/);
			expect(liveText).not.toMatch(/(?:^| · )thought for \d+s(?: · |$)/);
		}
		vi.setSystemTime(11_999);
		await current.emit("message_update", {
			message,
			assistantMessageEvent: {
				type: "thinking_end",
				contentIndex: 0,
				content: "done",
				partial: message,
			},
		});
		await current.emit("message_end", { message });
		await current.emit("agent_end");
		vi.setSystemTime(57_999);
		await current.emit("agent_settled");
		expect(current.appended[0]?.[1]).toEqual(
			expect.objectContaining({ version: 3, thoughtDurationMs: 10_999, input: 7_100, output: 779 }),
		);
		const renderer = current.renderers.get(TURN_SUMMARY_ENTRY_TYPE) as
			| ((entry: { data: unknown }, options: unknown, theme: Theme) => Text | undefined)
			| undefined;
		const rendered = renderer?.({ data: current.appended[0]?.[1] }, {}, current.ctx.ui.theme)
			?.render(100)
			.join("\n");
		expect(stripTerminalSequences(rendered ?? "")).toContain("thought for 10s");
	});

	it.each([
		[false, true],
		[true, false],
	] as const)(
		"gates append by Working-line enabled=%s and summary=%s",
		async (enabled, summary) => {
			runtime.enabled = enabled;
			runtime.turnSummary = summary;
			const current = harness();
			await current.emit("session_start");
			await current.emit("agent_start");
			await current.emit("agent_end");
			await current.emit("agent_settled");
			expect(current.appended).toEqual([]);
		},
	);

	it("initializes and settles without registerEntryRenderer", async () => {
		const current = harness({ renderer: false });
		await expect(current.emit("session_start")).resolves.toBeUndefined();
		await current.emit("agent_start");
		await current.emit("agent_end");
		await expect(current.emit("agent_settled")).resolves.toBeUndefined();
		expect(current.appended).toHaveLength(1);
	});

	it("contains append failures after atomic settlement and handles the next interaction", async () => {
		const current = harness({ appendError: true });
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("agent_end");
		await expect(current.emit("agent_settled")).resolves.toBeUndefined();
		expect(current.appendEntry).toHaveBeenCalledTimes(1);
		await current.emit("agent_settled");
		expect(current.appendEntry).toHaveBeenCalledTimes(1);

		await current.emit("agent_start");
		await current.emit("agent_end");
		await current.emit("agent_settled");
		expect(current.appendEntry).toHaveBeenCalledTimes(2);
	});

	it("partitions a completed run from concurrent live usage on non-idle settlement", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const current = harness();
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("turn_start");
		await current.emit("message_end", { message: assistant(10, 1, 1) });
		await current.emit("agent_end");

		vi.setSystemTime(5_000);
		await current.emit("agent_start");
		await current.emit("turn_start");
		await current.emit("message_update", { message: assistant(7, 2, 2) });
		current.setIdle(false);
		vi.setSystemTime(6_000);
		await current.emit("agent_settled");
		expect(current.appended).toEqual([
			[
				TURN_SUMMARY_ENTRY_TYPE,
				expect.objectContaining({
					version: 3,
					durationMs: 5_000,
					thoughtDurationMs: 0,
					input: 10,
					output: 1,
				}),
			],
		]);

		await current.emit("message_end", { message: assistant(9, 3, 2) });
		await current.emit("agent_end");
		current.setIdle(true);
		vi.setSystemTime(9_000);
		await current.emit("agent_settled");
		expect(current.appended[1]).toEqual([
			TURN_SUMMARY_ENTRY_TYPE,
			expect.objectContaining({
				version: 3,
				durationMs: 4_000,
				thoughtDurationMs: 0,
				input: 9,
				output: 3,
			}),
		]);
		await current.emit("agent_settled");
		expect(current.appended).toHaveLength(2);
	});

	it("commits and settles zero-only final usage exactly once", async () => {
		const current = harness();
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("turn_start");
		await current.emit("message_update", { message: assistant(0, 0, 1) });
		await current.emit("message_update", { message: assistant(0, 0, 1) });
		await current.emit("message_end", { message: assistant(0, 0, 1) });
		await current.emit("agent_end");
		await current.emit("agent_settled");
		await current.emit("agent_settled");
		expect(current.appended).toEqual([
			[TURN_SUMMARY_ENTRY_TYPE, expect.objectContaining({ input: 0, output: 0 })],
		]);
	});

	it("includes zero totals when live Tokens is disabled", async () => {
		runtime.tokens = false;
		const current = harness();
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("agent_end");
		await current.emit("agent_settled");
		expect(current.appended[0]?.[1]).toMatchObject({ input: 0, output: 0 });
	});

	it("does not synthesize a summary on shutdown", async () => {
		const current = harness();
		await current.emit("session_start");
		await current.emit("agent_start");
		await current.emit("session_shutdown");
		expect(current.appended).toEqual([]);
	});
});
