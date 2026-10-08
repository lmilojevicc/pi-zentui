import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
	AgentSession,
	SessionManager,
	SettingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const options = vi.hoisted(() => ({
	style: "starship" as "starship" | "native" | "hidden",
	format: "$tokens $cost $cache_read $cache_write",
	compactFormat: "",
	editor: false,
	hooks: undefined as undefined | Record<string, (...args: never[]) => unknown>,
}));
vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: vi.fn(() => {
			const config = structuredClone(actual.defaultConfig);
			config.projectRefreshIntervalMs = 0;
			config.components.editor.enabled = options.editor;
			// Editor usage is demanded by its authoritative metadata template.
			if (options.editor) config.components.editor.styles.opencode.metadataFormat = "$tokens";
			config.components.footer.style = options.style;
			config.components.footer.styles.starship.format = options.format;
			config.components.footer.styles.starship.compactFormat = options.compactFormat;
			return config;
		}),
		saveStarshipFooterStylePatch: vi.fn((patch) => {
			const config = vi.mocked(loadConfig).mock.results.at(-1)?.value;
			Object.assign(config.components.footer.styles.starship, patch);
			return config;
		}),
	};
});
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, hooks: typeof options.hooks) {
		options.hooks = hooks;
	},
}));
vi.mock("../extensions/zentui/telemetry", () => ({
	// Keep the same fixture usable against the pre-controller ba40c53 baseline.
	resolveFooterTelemetry: () => ({}),
	FooterTelemetryController: class {
		resolve() {
			return {};
		}
		reset() {}
	},
}));
vi.mock("../extensions/zentui/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/git")>();
	return {
		...actual,
		readGitStatus: async () => ({ kind: "ok", status: actual.emptyGitStatus() }),
	};
});
vi.mock("../extensions/zentui/runtime", () => ({
	readRuntimeInfo: async () => ({ kind: "ok", runtime: undefined }),
}));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: async () => ({ kind: "ok", result: null }),
}));

import { loadConfig } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Footer = { render(width: number): string[]; dispose?: () => void };
type FooterFactory = (...args: unknown[]) => Footer;
function usage(input = 10, cost = 1): Usage {
	return {
		input,
		output: 2,
		cacheRead: 30,
		cacheWrite: 5,
		totalTokens: input + 37,
		cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}
function message(input = 10, cost = 1): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-completions",
		provider: "test",
		model: "usage-model",
		usage: usage(input, cost),
		content: [],
		stopReason: "stop",
		timestamp: 1,
	};
}
function harness(count = 1) {
	const manager = SessionManager.inMemory("/usage-test");
	for (let i = 0; i < count; i++) manager.appendMessage(message() as never);
	const entries = manager.getEntries();
	const counters = { copies: 0, inputReads: 0, fingerprintReads: 0 };
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		let input = entry.message.usage.input;
		Object.defineProperty(entry.message.usage, "input", {
			get() {
				counters.inputReads++;
				return input;
			},
			set(value: number) {
				input = value;
			},
		});
		const timestamp = entry.timestamp;
		Object.defineProperty(entry, "timestamp", {
			get() {
				counters.fingerprintReads++;
				return timestamp;
			},
		});
	}
	const originalGetEntries = manager.getEntries.bind(manager);
	const getEntries = vi.spyOn(manager, "getEntries").mockImplementation(() => {
		const result = originalGetEntries();
		counters.copies += result.length;
		return result;
	});
	let factory: FooterFactory | undefined;
	let editorFactory: unknown;
	const requestRender = vi.fn();
	const theme = {
		fg: (_: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: "/usage-test",
		model: { id: "usage-model", provider: "test", contextWindow: 10_000 },
		getContextUsage: () => undefined,
		sessionManager: manager,
		isIdle: () => true,
		ui: {
			theme,
			setFooter(value: FooterFactory | undefined) {
				factory = value;
			},
			setEditorComponent: vi.fn((value: unknown) => {
				editorFactory = value;
			}),
			getEditorComponent: () => editorFactory,
			getEditorText: () => "",
			setEditorText: vi.fn(),
		},
	};
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getThinkingLevel: () => "off",
		registerCommand() {},
	} as never);
	const emit = async (name: string, event: unknown = {}, context = ctx) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, context);
	};
	return {
		ctx,
		manager,
		entries,
		getEntries,
		counters,
		emit,
		handlers,
		requestRender,
		footer() {
			if (!factory) throw new Error("no footer");
			return factory({ requestRender }, theme, {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			});
		},
	};
}
function rendered(footer: Footer) {
	return footer.render(200).join("\n");
}
function config() {
	return vi.mocked(loadConfig).mock.results.at(-1)?.value;
}

beforeEach(() => {
	options.style = "starship";
	options.format = "$tokens $cost $cache_read $cache_write";
	options.compactFormat = "";
	options.editor = false;
	options.hooks = undefined;
	vi.mocked(loadConfig).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("event-owned usage production lifecycle", () => {
	it.each(["model_select", "thinking_level_select", "tool_execution_start", "tool_execution_end"])(
		"does no history copying, usage reads or fingerprint visits across 100 unchanged %s events (10k entries)",
		async (name) => {
			const h = harness(10_000);
			await h.emit("session_start");
			const footer = h.footer();
			try {
				const before = { ...h.counters };
				const calls = h.getEntries.mock.calls.length;
				for (let i = 0; i < 100; i++) await h.emit(name, { toolCallId: "tool", toolName: "read" });
				expect.soft(h.getEntries.mock.calls.length - calls).toBe(0);
				expect.soft(h.counters.copies - before.copies).toBe(0);
				expect.soft(h.counters.inputReads - before.inputReads).toBe(0);
				expect.soft(h.counters.fingerprintReads - before.fingerprintReads).toBe(0);
				expect(rendered(footer)).toContain("↑100k ↓20k");
				expect(rendered(footer)).toContain("$10000.000");
			} finally {
				footer.dispose?.();
				await h.emit("session_shutdown");
			}
		},
	);

	it("reconciles pre-persist message_end, persisted agent_end, and later end-handler usage at settlement", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		try {
			const final = message(20, 2);
			// Exercise installed Pi's actual subscribed persistence handler, not a local copy.
			// Runtime tool/resource installation is unrelated to persistence and needs no disk setup.
			vi.spyOn(
				AgentSession.prototype as unknown as { _buildRuntime(): void },
				"_buildRuntime",
			).mockImplementation(() => {});
			let dispatch: (event: unknown) => Promise<void> = async () => {
				throw new Error("not subscribed");
			};
			const host = new AgentSession({
				agent: {
					state: { messages: [], model: h.ctx.model },
					subscribe(handler: typeof dispatch) {
						dispatch = handler;
						return () => {};
					},
				},
				sessionManager: h.manager,
				settingsManager: SettingsManager.inMemory(),
				initialActiveToolNames: [],
			} as never);
			Object.assign(host, {
				_extensionRunner: {
					emit: (event: { type: string }) => h.emit(event.type, event),
					emitMessageEnd: async (event: { type: string }) => {
						await h.emit(event.type, event);
						expect(rendered(footer)).toContain("↑10 ↓2");
					},
				},
			});
			h.handlers.get("agent_end")?.push(() => {
				// Pi awaits all end handlers before settlement. This runs AFTER Zentui's handler.
				expect(rendered(footer)).toContain("↑30 ↓4");
				expect(rendered(footer)).toContain("$3.000");
				final.usage.input = 50;
				final.usage.cost.total = 5;
			});
			await dispatch({ type: "message_end", message: final });
			await dispatch({ type: "agent_end", messages: [final] });
			h.requestRender.mockClear();
			await (host as unknown as { _emitAgentSettled(): Promise<void> })._emitAgentSettled();
			expect(h.requestRender).toHaveBeenCalled();
			expect(rendered(footer)).toContain("↑60 ↓4");
			expect(rendered(footer)).toContain("$6.000");
		} finally {
			footer.dispose?.();
			await h.emit("session_shutdown");
		}
	});

	it("detects intervening append and persisted model/thinking records without losing full-session totals", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		try {
			h.manager.appendMessage(message(20, 2) as never);
			await h.emit("tool_execution_end");
			expect(rendered(footer)).toContain("↑30 ↓4");
			let calls = h.getEntries.mock.calls.length;
			// Pi persists these records before notifying extensions.
			h.manager.appendModelChange("test", "new-model");
			h.ctx.model.id = "new-model";
			await h.emit("model_select");
			expect(h.getEntries.mock.calls.length).toBe(calls + 1);
			calls++;
			h.manager.appendThinkingLevelChange("high");
			await h.emit("thinking_level_select");
			expect(h.getEntries.mock.calls.length).toBe(calls + 1);
			h.manager.branch(h.entries[0].id);
			await h.emit("session_tree");
			expect(rendered(footer)).toContain("↑30 ↓4");
			expect(rendered(footer)).toContain("$3.000");
		} finally {
			footer.dispose?.();
			await h.emit("session_shutdown");
		}
	});

	it.each(["message_end", "agent_end", "session_compact", "session_tree"])(
		"refreshes late same-leaf tool/summary usage and renders at %s",
		async (event) => {
			const h = harness();
			const tool = { ...message(20, 2), role: "toolResult", toolCallId: "t", toolName: "nested" };
			h.manager.appendMessage(tool as never);
			const compactionUsage = usage(30, 3);
			const branchUsage = usage(40, 4);
			const compactionId = h.manager.appendCompaction(
				"summary",
				h.entries[0].id,
				100,
				undefined,
				undefined,
				compactionUsage as never,
			);
			const branchId = h.manager.branchWithSummary(
				h.entries[0].id,
				"branch",
				undefined,
				undefined,
				branchUsage as never,
			);
			for (const [id, type, expectedUsage] of [
				[compactionId, "compaction", compactionUsage],
				[branchId, "branch_summary", branchUsage],
			] as const) {
				const entry = h.manager.getEntry(id);
				expect(entry).toHaveProperty("type", type);
				expect(entry).toHaveProperty("usage", expectedUsage);
			}
			await h.emit("session_start");
			const footer = h.footer();
			try {
				expect(rendered(footer)).toContain("↑100 ↓8");
				expect(rendered(footer)).toContain("$10.000");
				const leafId = h.manager.getLeafId();
				const reads = h.getEntries.mock.calls.length;
				tool.usage.input = 50;
				tool.usage.cost.total = 5;
				h.requestRender.mockClear();
				await h.emit(event, { message: tool });
				expect(h.manager.getLeafId()).toBe(leafId);
				expect(h.getEntries).toHaveBeenCalledTimes(reads + 1);
				expect(h.requestRender).toHaveBeenCalled();
				expect(rendered(footer)).toContain("↑130 ↓8");
				expect(rendered(footer)).toContain("$13.000");
			} finally {
				footer.dispose?.();
				await h.emit("session_shutdown");
			}
		},
	);

	it.each(["native", "hidden", "unused"] as const)(
		"does zero usage work with %s footer and disabled editor",
		async (mode) => {
			if (mode === "unused") options.format = "$model";
			else options.style = mode;
			const h = harness(1000);
			await h.emit("session_start");
			try {
				for (let i = 0; i < 100; i++) await h.emit("tool_execution_end");
				expect.soft(h.getEntries).not.toHaveBeenCalled();
				expect.soft(h.counters.inputReads).toBe(0);
				expect(h.ctx.ui.setEditorComponent).not.toHaveBeenCalled();
			} finally {
				await h.emit("session_shutdown");
			}
		},
	);

	it("activates compact demand, settings demand immediately, and stops on ownership loss", async () => {
		options.format = "$model";
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		try {
			expect(h.getEntries).not.toHaveBeenCalled();
			config().components.footer.styles.starship.compactFormat = "$cost";
			await h.emit("tool_execution_end");
			expect(h.getEntries).toHaveBeenCalledTimes(1);
			config().components.footer.styles.starship.compactFormat = "";
			await h.emit("tool_execution_end");
			h.manager.appendMessage(message(50, 5) as never);
			options.hooks?.setFooterFormat("$tokens $cost" as never, h.ctx as never);
			expect(rendered(footer)).toContain("↑60 ↓4");
			expect(rendered(footer)).toContain("$6.000");
			footer.dispose?.();
			h.getEntries.mockClear();
			await h.emit("tool_execution_end");
			expect(h.getEntries).not.toHaveBeenCalled();
		} finally {
			footer.dispose?.();
			await h.emit("session_shutdown");
		}
	});

	it("keeps editor usage available with a native footer and resets on replacement session", async () => {
		options.editor = true;
		options.style = "native";
		const h = harness();
		await h.emit("session_start");
		try {
			expect(h.getEntries).toHaveBeenCalledTimes(1);
			h.getEntries.mockClear();
			await h.emit("model_select");
			expect(h.getEntries).not.toHaveBeenCalled();
			await h.emit("session_shutdown");
			h.manager.newSession();
			h.manager.appendMessage(message(99, 9) as never);
			await h.emit("session_start");
			expect(h.getEntries).toHaveBeenCalledTimes(1);
		} finally {
			await h.emit("session_shutdown");
		}
	});
});
