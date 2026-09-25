import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capabilities = vi.hoisted(() => ({
	subscription: undefined as boolean | undefined,
	autoCompaction: undefined as boolean | undefined,
	throwSubscription: false,
	throwAutoCompaction: false,
	settingsCreate: vi.fn(),
	footerFormat: "",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		SettingsManager: {
			create(...args: unknown[]) {
				capabilities.settingsCreate(...args);
				if (capabilities.throwAutoCompaction) throw new Error("unsupported settings");
				return {
					drainErrors: () => [],
					getCompactionEnabled: () => capabilities.autoCompaction,
				};
			},
		},
	};
});

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: vi.fn(() => {
			const footer = actual.defaultConfig.components.footer;
			return {
				...actual.defaultConfig,
				projectRefreshIntervalMs: 0,
				components: {
					...actual.defaultConfig.components,
					editor: { ...actual.defaultConfig.components.editor, enabled: false },
					footer: {
						...footer,
						enabled: true,
						styles: {
							starship: {
								...footer.styles.starship,
								format: capabilities.footerFormat,
								segments: { ...footer.styles.starship.segments, modelInfo: true },
							},
						},
					},
				},
			};
		}),
	};
});

vi.mock("../extensions/zentui/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/git")>();
	return {
		...actual,
		readGitStatus: async () => ({ kind: "ok" as const, status: actual.emptyGitStatus() }),
	};
});
vi.mock("../extensions/zentui/runtime", () => ({
	readRuntimeInfo: async () => ({ kind: "ok" as const, runtime: undefined }),
}));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: async () => ({ kind: "ok" as const, result: null }),
}));

import { loadConfig } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type Footer = { render(width: number): string[]; dispose?: () => void };
type FooterFactory = (...args: unknown[]) => Footer;

function makeTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
}

function usageEntry(
	id: string,
	options: { input: number; output: number; read?: number; write?: number },
) {
	return {
		type: "message",
		id,
		message: {
			role: "assistant",
			usage: {
				input: options.input,
				output: options.output,
				cacheRead: options.read ?? 0,
				cacheWrite: options.write ?? 0,
				cost: { total: 0 },
			},
		},
	};
}

function createHarness(name: string) {
	let footerFactory: FooterFactory | undefined;
	const entries = [usageEntry(`${name}-initial`, { input: 10, output: 2 })];
	const state = { model: { id: `${name}-model`, provider: "test", contextWindow: 10_000 } };
	const theme = makeTheme();
	const requestRender = vi.fn();
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: `/tmp/${name}`,
		get model() {
			return state.model;
		},
		modelRegistry: {
			isUsingOAuth() {
				if (capabilities.throwSubscription) throw new Error("unsupported OAuth lookup");
				return capabilities.subscription;
			},
		},
		isProjectTrusted: () => true,
		getContextUsage: () => ({ tokens: 1_000, contextWindow: 10_000, percent: 10 }),
		sessionManager: {
			getBranch: () => entries,
			getEntries: () => entries,
			getSessionName: () => undefined,
		},
		ui: {
			theme,
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent: vi.fn(),
			getEditorComponent: () => undefined,
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

function loadExtension(getThinkingLevel: () => string = () => "off") {
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel,
	} as never);
	return handlers;
}

async function emit(handlers: Map<string, Handler[]>, name: string, ctx: unknown, event = {}) {
	for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
}

function rendered(footer: Footer): string {
	return footer.render(160).join("\n");
}

beforeEach(() => {
	capabilities.subscription = undefined;
	capabilities.autoCompaction = undefined;
	capabilities.throwSubscription = false;
	capabilities.throwAutoCompaction = false;
	capabilities.settingsCreate.mockClear();
	capabilities.footerFormat = "";
	vi.mocked(loadConfig).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("telemetry lifecycle integration", () => {
	it("refreshes footer thinking levels with the editor disabled without changing its settings", async () => {
		capabilities.footerFormat = "$model $provider( $thinkingLevel)";
		let level = "high";
		const handlers = loadExtension(() => level);
		const harness = createHarness("thinking-events");
		await emit(handlers, "session_start", harness.ctx);
		const config = vi.mocked(loadConfig).mock.results.at(-1)?.value;
		const editorConfig = structuredClone(config.components.editor);
		const footer = harness.createFooter();
		try {
			expect(rendered(footer)).toContain("thinking-events-model Test high");
			harness.requestRender.mockClear();
			level = "medium";
			await emit(handlers, "thinking_level_select", harness.ctx, { thinkingLevel: level });
			expect(harness.requestRender).toHaveBeenCalled();
			expect(rendered(footer)).toContain("thinking-events-model Test medium");
			expect(rendered(footer)).not.toContain("high");

			harness.requestRender.mockClear();
			harness.state.model = { ...harness.state.model, id: "unsupported-model" };
			level = "off";
			await emit(handlers, "model_select", harness.ctx);
			expect(harness.requestRender).toHaveBeenCalled();
			expect(rendered(footer).trim()).toBe("unsupported-model Test");
			expect(config.components.editor).toEqual(editorConfig);
			expect(config.components.editor.enabled).toBe(false);
			expect(harness.ctx.ui.setEditorComponent).not.toHaveBeenCalled();
		} finally {
			footer.dispose?.();
			await emit(handlers, "session_shutdown", harness.ctx);
		}
	});

	it("initializes, refreshes, clears unsupported values, and reconciles at agent_end", async () => {
		const handlers = loadExtension();
		const harness = createHarness("telemetry-events");
		capabilities.subscription = true;
		capabilities.autoCompaction = false;

		await emit(handlers, "session_start", harness.ctx);
		const footer = harness.createFooter();
		expect(rendered(footer)).toContain("telemetry-events-model Test");
		expect(rendered(footer)).toContain("$0.000 (sub)");
		expect(rendered(footer)).not.toContain("(auto)");

		harness.state.model = {
			...harness.state.model,
			id: "selected-model",
			provider: "changed-provider",
		};
		capabilities.subscription = false;
		capabilities.autoCompaction = false;
		await emit(handlers, "model_select", harness.ctx);
		expect(rendered(footer)).toContain("selected-model Changed Provider");
		expect(rendered(footer)).not.toContain("telemetry-events-model Test");
		expect(rendered(footer)).not.toContain("(sub)");

		capabilities.subscription = false;
		capabilities.autoCompaction = true;
		await emit(handlers, "tool_execution_end", harness.ctx);
		expect(rendered(footer)).toContain("10.0%/10k (auto)");

		capabilities.subscription = true;
		capabilities.autoCompaction = true;
		await emit(handlers, "session_info_changed", harness.ctx);
		expect(rendered(footer)).toContain("$0.000 (sub)");
		expect(rendered(footer)).toContain("10.0%/10k (auto)");

		capabilities.throwSubscription = true;
		capabilities.throwAutoCompaction = true;
		await expect(emit(handlers, "session_info_changed", harness.ctx)).resolves.toBeUndefined();
		expect(rendered(footer)).not.toMatch(/\(sub\)|\(auto\)/);

		capabilities.throwSubscription = false;
		capabilities.throwAutoCompaction = false;
		capabilities.subscription = true;
		capabilities.autoCompaction = true;
		await emit(handlers, "message_end", harness.ctx, {
			message: { role: "assistant", usage: { input: 5, output: 3 } },
		});
		harness.entries.push(
			usageEntry("persisted-final", { input: 5, output: 3, read: 1_200, write: 300 }),
		);
		await emit(handlers, "agent_end", harness.ctx);
		const final = rendered(footer);
		expect(final).toContain("↑15 ↓5");
		expect(final).toContain("R1.2k W300");
		expect(final).toContain("$0.000 (sub)");
		expect(final).toContain("10.0%/10k (auto)");

		footer.dispose?.();
		await emit(handlers, "session_shutdown", harness.ctx);
	});

	it("does not leak telemetry across shutdown and replacement session start", async () => {
		const handlers = loadExtension();
		const first = createHarness("telemetry-first");
		capabilities.subscription = true;
		capabilities.autoCompaction = true;
		await emit(handlers, "session_start", first.ctx);
		const firstFooter = first.createFooter();
		expect(rendered(firstFooter)).toMatch(/\(sub\).*\(auto\)|\(auto\).*\(sub\)/);
		await emit(handlers, "session_shutdown", first.ctx);
		expect(() => first.createFooter()).toThrow("footer was not installed");

		const replacement = createHarness("telemetry-replacement");
		capabilities.subscription = undefined;
		capabilities.autoCompaction = undefined;
		await emit(handlers, "session_start", replacement.ctx);
		const replacementFooter = replacement.createFooter();
		expect(rendered(replacementFooter)).not.toMatch(/\(sub\)|\(auto\)|R1\.2k|W300/);
		expect(capabilities.settingsCreate).toHaveBeenLastCalledWith(
			"/tmp/telemetry-replacement",
			undefined,
			{ projectTrusted: true },
		);

		replacementFooter.dispose?.();
		await emit(handlers, "session_shutdown", replacement.ctx);
	});
});
