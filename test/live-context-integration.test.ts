import { CustomEditor, type Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: vi.fn(() => ({
			...actual.defaultConfig,
			projectRefreshIntervalMs: 0,
			components: {
				...actual.defaultConfig.components,
				editor: {
					...actual.defaultConfig.components.editor,
					styles: {
						...actual.defaultConfig.components.editor.styles,
						opencode: {
							...actual.defaultConfig.components.editor.styles.opencode,
							metadataFormat: "$context $tokens $cache_hit",
						},
					},
				},
			},
			features: { ...actual.defaultConfig.features, editor: false, statusLine: true },
		})),
	};
});

vi.mock("../extensions/zentui/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/git")>();
	return {
		...actual,
		readGitStatus: async () => ({ kind: "ok" as const, status: actual.emptyGitStatus() }),
	};
});

vi.mock("../extensions/zentui/runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/runtime")>();
	return { ...actual, readRuntimeInfo: async () => ({ kind: "ok" as const, runtime: undefined }) };
});

vi.mock("../extensions/zentui/package-version", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/package-version")>();
	return {
		...actual,
		readPackageVersionResult: async () => ({ kind: "ok" as const, result: null }),
	};
});

import { loadConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type Footer = { render(width: number): string[]; dispose?: () => void };
type FooterFactory = (...args: unknown[]) => Footer;
type Editor = { render(width: number): string[]; setText(text: string): void };
type EditorFactory = (...args: unknown[]) => Editor;

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
			input: totalTokens === 0 ? 0 : 101,
			output: totalTokens === 0 ? 0 : 202,
			cacheRead: totalTokens === 0 ? 0 : 303,
			cacheWrite: totalTokens === 0 ? 0 : 404,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

function persistedEntry(
	id: string,
	input: number,
	output: number,
	cost: number,
	cacheRead = 0,
	cacheWrite = 0,
) {
	return {
		type: "message",
		id,
		message: {
			role: "assistant",
			usage: {
				input,
				output,
				cacheRead,
				cacheWrite,
				totalTokens: input + output,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
			},
		},
	};
}

function loadExtension(config?: PolishedTuiConfig) {
	if (config) vi.mocked(loadConfig).mockReturnValueOnce(config);
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
		wrapped?: boolean;
		contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } | null;
	} = {},
) {
	let footerFactory: FooterFactory | undefined;
	let editorFactory: EditorFactory | undefined = options.wrapped
		? (...args) => new CustomEditor(...(args as ConstructorParameters<typeof CustomEditor>))
		: undefined;
	let editorText = "";
	const requestRender = vi.fn();
	const editorRequestRender = vi.fn();
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
			getSessionName: () => undefined,
		},
		getContextUsage: vi.fn(() => state.contextUsage),
		ui: {
			theme,
			getEditorText() {
				return editorText;
			},
			setEditorText(text: string) {
				editorText = text;
			},
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent(factory: EditorFactory | undefined) {
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
		editorRequestRender,
		createFooter() {
			if (!footerFactory) throw new Error("footer was not installed");
			return footerFactory({ requestRender }, theme, {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map<string, string>(),
			});
		},
		createEditor() {
			if (!editorFactory) throw new Error("editor was not installed");
			const editor = editorFactory(
				{ requestRender: editorRequestRender, terminal: { rows: 24, cols: 160 } },
				{ borderColor: (text: string) => text, selectList: {} },
				{},
			);
			editor.setText("typed text");
			return editor;
		},
	};
}

function rendered(footer: Footer): string {
	return footer.render(160).join("\n");
}

function renderedEditor(editor: Editor): string {
	return editor.render(160).join("\n");
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
		const editor = harness.createEditor();
		expect(renderedEditor(editor)).toContain("10.0%/10k ↑5 ↓6 0.0%");
		harness.requestRender.mockClear();
		harness.editorRequestRender.mockClear();

		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_000) });
		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
		vi.advanceTimersByTime(249);
		expect(harness.requestRender).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(harness.requestRender).toHaveBeenCalledTimes(1);
		expect(harness.editorRequestRender).toHaveBeenCalledTimes(1);
		expect(rendered(footer)).toContain("11.0%/10k");
		expect(rendered(footer)).toContain("↑5 ↓6");
		expect(rendered(footer)).toContain("$0.123");
		expect(renderedEditor(editor)).toContain("11.0%/10k ↑5 ↓6 0.0%");

		await emit(handlers, "message_end", harness.ctx, { message: assistant(1_100) });
		expect(rendered(footer)).toContain("11.0%/10k");
		expect(rendered(footer)).toContain("↑5 ↓6");
		expect(rendered(footer)).toContain("$0.123");
		expect(renderedEditor(editor)).toContain("11.0%/10k ↑5 ↓6 0.0%");

		harness.state.contextUsage = { tokens: 1_200, contextWindow: 10_000, percent: 12 };
		harness.entries.push(persistedEntry("new", 7, 8, 0.2, 21, 2));
		await emit(handlers, "agent_end", harness.ctx);
		const finalized = rendered(footer);
		expect(finalized).toContain("12.0%/10k");
		expect(finalized).toContain("↑12 ↓14");
		expect(finalized).toContain("$0.323");
		const finalizedEditor = renderedEditor(editor);
		expect(finalizedEditor).toContain("12.0%/10k ↑12 ↓14 70.0%");
		expect(finalizedEditor.match(/70\.0%/g)).toHaveLength(1);

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
		expect(rendered(footer)).toContain("11.0%/10k");

		await emit(handlers, "agent_start", harness.ctx);
		harness.requestRender.mockClear();
		await emit(handlers, "message_update", harness.ctx, { message: assistant(0) });
		vi.advanceTimersByTime(250);
		expect(harness.requestRender).not.toHaveBeenCalled();
		expect(rendered(footer)).toContain("10.0%/10k");

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
			expect(rendered(footer)).toContain(`${(tokens / 100).toFixed(1)}%/10k`);
		};

		await seedLive();
		await emit(handlers, "agent_start", harness.ctx);
		expect(rendered(footer)).toContain("10.0%/10k");

		await seedLive();
		await emit(handlers, "model_select", harness.ctx);
		expect(rendered(footer)).toContain("10.0%/10k");

		await seedLive();
		await emit(handlers, "tool_execution_start", harness.ctx);
		expect(rendered(footer)).toContain("10.0%/10k");

		await seedLive();
		await emit(handlers, "session_tree", harness.ctx);
		expect(rendered(footer)).toContain("10.0%/10k");

		await emit(handlers, "turn_start", harness.ctx);
		await seedLive();
		await emit(handlers, "message_end", harness.ctx, { message: assistant(1_100, "error") });
		expect(rendered(footer)).toContain("10.0%/10k");

		await emit(handlers, "turn_start", harness.ctx);
		await seedLive();
		await emit(handlers, "message_end", harness.ctx, { message: assistant(1_100, "aborted") });
		expect(rendered(footer)).toContain("10.0%/10k");

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
		expect(rendered(footer)).toContain("10.0%/10k");
	});
});

describe("context query demand", () => {
	for (const wrapped of [false, true]) {
		it.each(["opencode", "opencode-copy-friendly", "minimalist"] as const)(
			`resolves %s metadata once per render (wrapped=${wrapped})`,
			async (style) => {
				vi.useFakeTimers();
				const config = structuredClone(loadConfig());
				config.components.editor.style = style;
				if (style !== "minimalist")
					config.components.editor.styles[style].metadataFormat = "$context";
				config.components.footer.style = "native";
				const handlers = loadExtension(config);
				const harness = createHarness({ wrapped });
				await emit(handlers, "session_start", harness.ctx);
				await settleProjectRefresh();
				const editor = harness.createEditor();
				harness.ctx.getContextUsage.mockClear();
				for (let i = 0; i < 100; i++) renderedEditor(editor);
				expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(100);
				harness.ctx.getContextUsage.mockClear();
				await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
				for (let i = 0; i < 100; i++) renderedEditor(editor);
				expect(harness.ctx.getContextUsage).not.toHaveBeenCalled();
				await emit(handlers, "session_shutdown", harness.ctx);
			},
		);

		it.each(["accent-rail", "opencode", "opencode-copy-friendly"] as const)(
			`skips context for quota-only %s metadata (wrapped=${wrapped})`,
			async (style) => {
				vi.useFakeTimers();
				const config = structuredClone(loadConfig());
				config.components.editor.style = style;
				config.components.editor.styles.opencode.metadataFormat = "$model $codex_quota";
				config.components.editor.styles["opencode-copy-friendly"].metadataFormat =
					"$model $codex_quota";
				config.components.footer.style = "native";
				const handlers = loadExtension(config);
				const harness = createHarness({ wrapped });
				await emit(handlers, "session_start", harness.ctx);
				await settleProjectRefresh();
				const editor = harness.createEditor();
				for (let i = 0; i < 100; i++) renderedEditor(editor);
				expect(harness.ctx.getContextUsage).not.toHaveBeenCalled();
				if (style !== "accent-rail") {
					config.components.editor.styles[style].metadataFormat = "$context";
					expect(renderedEditor(editor)).toContain("10.0%/10k");
					expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(1);
				}
				await emit(handlers, "session_shutdown", harness.ctx);
			},
		);
	}

	it("publishes changed streaming context only and clears it across model/session boundaries", async () => {
		vi.useFakeTimers();
		const handlers = loadExtension();
		const harness = createHarness();
		await emit(handlers, "session_start", harness.ctx);
		await settleProjectRefresh();
		const footer = harness.createFooter();
		const editor = harness.createEditor();
		harness.requestRender.mockClear();
		harness.editorRequestRender.mockClear();
		harness.ctx.getContextUsage.mockClear();
		for (let i = 0; i < 100; i++) {
			await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
			vi.advanceTimersByTime(250);
			expect(rendered(footer)).toContain("11.0%/10k");
			expect(renderedEditor(editor)).toContain("11.0%/10k");
		}
		expect(harness.ctx.getContextUsage).not.toHaveBeenCalled();
		expect(harness.requestRender).toHaveBeenCalledTimes(1);
		expect(harness.editorRequestRender).toHaveBeenCalledTimes(1);
		harness.state.model = { id: "new", provider: "anthropic", contextWindow: 20_000 };
		harness.state.contextUsage = { tokens: null, contextWindow: 20_000, percent: null };
		await emit(handlers, "model_select", harness.ctx);
		expect(rendered(footer)).toContain("?/20k");
		expect(renderedEditor(editor)).toContain("?/20k");
		expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(2);
		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
		expect(rendered(footer)).toContain("5.5%/20k");
		await emit(handlers, "session_start", harness.ctx);
		expect(renderedEditor(harness.createEditor())).toContain("?/20k");
		footer.dispose?.();
		await emit(handlers, "session_shutdown", harness.ctx);
	});

	it("skips unused compatibility context and footer estimates, then observes format changes", async () => {
		vi.useFakeTimers();
		const config = structuredClone(loadConfig());
		config.components.editor.enabled = false;
		const starship = config.components.footer.styles.starship;
		starship.format = "$model";
		starship.compactFormat = "$model";
		const handlers = loadExtension(config);
		const harness = createHarness();
		await emit(handlers, "session_start", harness.ctx);
		await settleProjectRefresh();
		const footer = harness.createFooter();
		for (let i = 0; i < 100; i++) {
			await emit(handlers, "thinking_level_select", harness.ctx);
			rendered(footer);
		}
		expect(harness.ctx.getContextUsage).not.toHaveBeenCalled();
		starship.compactFormat = "$context";
		footer.render(8);
		expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(1);
		starship.responsive = false;
		rendered(footer);
		expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(1);
		starship.format = "$context";
		expect(rendered(footer)).toContain("10.0%/10k");
		expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(2);
		starship.format = "";
		starship.segments.context = false;
		rendered(footer);
		expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(2);
		starship.segments.context = true;
		expect(rendered(footer)).toContain("10.0%/10k");
		expect(harness.ctx.getContextUsage).toHaveBeenCalledTimes(3);
		harness.ctx.getContextUsage.mockClear();
		await emit(handlers, "message_update", harness.ctx, { message: assistant(1_100) });
		for (let i = 0; i < 100; i++) expect(rendered(footer)).toContain("11.0%/10k");
		expect(harness.ctx.getContextUsage).not.toHaveBeenCalled();
		footer.dispose?.();
		await emit(handlers, "session_shutdown", harness.ctx);
	});
});
