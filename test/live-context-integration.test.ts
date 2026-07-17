import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: () => ({
			...actual.defaultConfig,
			projectRefreshIntervalMs: 0,
			features: { ...actual.defaultConfig.features, editor: false, statusLine: true },
		}),
	};
});

vi.mock("../extensions/zentui/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/git")>();
	return { ...actual, readGitStatus: async () => actual.emptyGitStatus() };
});

vi.mock("../extensions/zentui/runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/runtime")>();
	return { ...actual, readRuntimeInfo: async () => undefined };
});

vi.mock("../extensions/zentui/package-version", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/package-version")>();
	return { ...actual, readPackageVersionResult: async () => undefined };
});

import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type Footer = { render(width: number): string[]; dispose?: () => void };
type FooterFactory = (...args: unknown[]) => Footer;

function makeTheme(): Theme {
	return {
		fg(_color: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
		italic(text: string) {
			return text;
		},
		underline(text: string) {
			return text;
		},
		strikethrough(text: string) {
			return text;
		},
		getThinkingBorderColor() {
			return (text: string) => text;
		},
	} as unknown as Theme;
}

function assistant(totalTokens: number, stopReason = "stop") {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

function persistedEntry(id: string, input: number, output: number, cost: number) {
	return {
		type: "message",
		id,
		message: {
			role: "assistant",
			usage: {
				input,
				output,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: input + output,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
			},
		},
	};
}

function loadExtension() {
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel() {
			return "off";
		},
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

function createHarness(
	options: {
		model?: { id: string; provider: string; contextWindow: number };
		contextUsage?: { tokens: number; contextWindow: number; percent: number } | null;
	} = {},
) {
	let footerFactory: FooterFactory | undefined;
	let editorFactory: unknown;
	const requestRender = vi.fn();
	const entries = [persistedEntry("old", 5, 6, 0.123)];
	const state = {
		model:
			"model" in options
				? options.model
				: { id: "test", provider: "anthropic", contextWindow: 10_000 },
		contextUsage:
			"contextUsage" in options
				? options.contextUsage
				: { tokens: 1_000, contextWindow: 10_000, percent: 10 },
	};
	const theme = makeTheme();
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		get model() {
			return state.model;
		},
		sessionManager: {
			getBranch: () => entries,
			getEntries: () => entries,
		},
		getContextUsage: () => state.contextUsage,
		ui: {
			theme,
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			getEditorComponent() {
				return editorFactory;
			},
		},
	};
	return {
		ctx,
		entries,
		state,
		requestRender,
		createFooter() {
			if (!footerFactory) throw new Error("footer was not installed");
			return footerFactory({ requestRender }, theme, {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map<string, string>(),
			});
		},
	};
}

function rendered(footer: Footer): string {
	return footer.render(160).join("\n");
}

async function settleProjectRefresh(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("live streaming context event integration", () => {
	it("coalesces registered updates, uses the newest cumulative total, and finalizes canonically", async () => {
		vi.useFakeTimers();
		const handlers = loadExtension();
		const harness = createHarness();
		await emit(handlers, "session_start", harness.ctx);
		await settleProjectRefresh();
		const footer = harness.createFooter();
		harness.requestRender.mockClear();

		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_000) });
		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
		vi.advanceTimersByTime(249);
		expect(harness.requestRender).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(harness.requestRender).toHaveBeenCalledTimes(1);
		expect(rendered(footer)).toContain("11%/10k");
		expect(rendered(footer)).toContain("↑5 ↓6");
		expect(rendered(footer)).toContain("$0.123");

		await emit(handlers, "message_end", harness.ctx, { message: assistant(1_100) });
		expect(rendered(footer)).toContain("11%/10k");
		expect(rendered(footer)).toContain("↑5 ↓6");
		expect(rendered(footer)).toContain("$0.123");

		harness.state.contextUsage = { tokens: 1_200, contextWindow: 10_000, percent: 12 };
		harness.entries.push(persistedEntry("new", 7, 8, 0.2));
		await emit(handlers, "agent_end", harness.ctx);
		const finalized = rendered(footer);
		expect(finalized).toContain("12%/10k");
		expect(finalized).toContain("↑12 ↓14");
		expect(finalized).toContain("$0.323");

		footer.dispose?.();
		await emit(handlers, "session_shutdown", harness.ctx);
	});

	it("uses the official context window when the current model is absent and ignores zero usage", async () => {
		vi.useFakeTimers();
		const handlers = loadExtension();
		const harness = createHarness({ model: undefined });
		await emit(handlers, "session_start", harness.ctx);
		await settleProjectRefresh();
		const footer = harness.createFooter();

		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
		vi.advanceTimersByTime(250);
		expect(rendered(footer)).toContain("11%/10k");

		await emit(handlers, "agent_start", harness.ctx);
		harness.requestRender.mockClear();
		await emit(handlers, "message_update", harness.ctx, { message: assistant(0) });
		vi.advanceTimersByTime(250);
		expect(harness.requestRender).not.toHaveBeenCalled();
		expect(rendered(footer)).toContain("10%/10k");

		footer.dispose?.();
		await emit(handlers, "session_shutdown", harness.ctx);
	});

	it("clears live usage at wired boundaries and recovers after null compaction", async () => {
		vi.useFakeTimers();
		const handlers = loadExtension();
		const harness = createHarness();
		await emit(handlers, "session_start", harness.ctx);
		await settleProjectRefresh();
		const footer = harness.createFooter();
		const seedLive = async (tokens = 1_100) => {
			await emit(handlers, "message_update", harness.ctx, { message: assistant(tokens) });
			vi.advanceTimersByTime(250);
			expect(rendered(footer)).toContain(`${Math.round(tokens / 100)}%/10k`);
		};

		await seedLive();
		await emit(handlers, "agent_start", harness.ctx);
		expect(rendered(footer)).toContain("10%/10k");

		await seedLive();
		await emit(handlers, "model_select", harness.ctx);
		expect(rendered(footer)).toContain("10%/10k");

		await seedLive();
		await emit(handlers, "tool_execution_start", harness.ctx);
		expect(rendered(footer)).toContain("10%/10k");

		await seedLive();
		await emit(handlers, "session_tree", harness.ctx);
		expect(rendered(footer)).toContain("10%/10k");

		await seedLive();
		await emit(handlers, "message_end", harness.ctx, { message: assistant(1_100, "error") });
		expect(rendered(footer)).toContain("10%/10k");

		await seedLive();
		await emit(handlers, "message_end", harness.ctx, { message: assistant(1_100, "aborted") });
		expect(rendered(footer)).toContain("10%/10k");

		await seedLive();
		harness.state.contextUsage = null;
		await emit(handlers, "session_compact", harness.ctx);
		expect(rendered(footer)).toContain("?/10k");
		await seedLive(1_500);

		harness.state.contextUsage = { tokens: 1_000, contextWindow: 10_000, percent: 10 };
		await emit(handlers, "agent_start", harness.ctx);
		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_200) });
		harness.requestRender.mockClear();
		await emit(handlers, "session_shutdown", harness.ctx);
		vi.advanceTimersByTime(250);
		expect(harness.requestRender).not.toHaveBeenCalled();
		expect(rendered(footer)).toContain("10%/10k");
	});
});
