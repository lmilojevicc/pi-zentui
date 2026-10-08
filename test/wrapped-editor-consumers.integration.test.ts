import {
	CustomEditor,
	type EventBus,
	SessionManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	hooks: undefined as undefined | Record<string, (...args: never[]) => unknown>,
	editorEnabled: true,
	configure: undefined as
		| undefined
		| ((config: import("../extensions/zentui/config").ZentuiConfig) => void),
	config: undefined as import("../extensions/zentui/config").ZentuiConfig | undefined,
	gitStatusCalls: vi.fn(),
}));
vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: vi.fn(() => {
			const config = structuredClone(actual.defaultConfig);
			config.components.workingLine.colorSource = "theme";
			config.projectRefreshIntervalMs = 5000;
			config.components.editor.enabled = runtime.editorEnabled;
			config.components.editor.codexQuota = false;
			config.components.editor.style = "minimalist";
			config.components.editor.styles.minimalist.showCost = false;
			config.components.editor.styles.minimalist.showGit = false;
			config.components.editor.styles.minimalist.showTimer = false;
			config.components.editor.styles.minimalist.showSessionName = false;
			config.components.footer.style = "hidden";
			config.components.userMessages.enabled = false;
			config.components.selectorBorders.enabled = false;
			config.components.workingLine.enabled = false;
			runtime.configure?.(config);
			runtime.config = config;
			return config;
		}),
		saveEditorComponentPatch: vi.fn((patch: object) => {
			Object.assign(runtime.config?.components.editor ?? {}, patch);
			return runtime.config;
		}),
	};
});
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, hooks: typeof runtime.hooks) {
		runtime.hooks = hooks;
	},
}));
vi.mock("../extensions/zentui/telemetry", () => ({
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
		readGitStatus: async () => {
			runtime.gitStatusCalls();
			return { kind: "ok" as const, status: actual.emptyGitStatus() };
		},
	};
});
vi.mock("../extensions/zentui/runtime", () => ({
	readRuntimeInfo: async () => ({ kind: "ok", runtime: undefined }),
}));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: async () => ({ kind: "ok", result: null }),
}));

import {
	ZENTUI_VARIABLE_CAPABILITY_EVENT,
	ZENTUI_VARIABLE_EVENT,
} from "../extensions/zentui/custom-variables";
import zentui from "../extensions/zentui/index";

type Editor = {
	render(width: number): string[];
	getText(): string;
	setText(text: string): void;
	getExpandedText(): string;
	focused?: boolean;
};
type Factory = (...args: never[]) => Editor;
type Handler = (event: unknown, ctx: unknown) => unknown;

const codexHttp = vi.fn(async () =>
	Response.json({
		rate_limit: {
			primary_window: { used_percent: 20, limit_window_seconds: 18_000 },
			secondary_window: { used_percent: 40, limit_window_seconds: 604_800 },
		},
	}),
);

function flush() {
	return vi.advanceTimersByTimeAsync(0);
}

function harness(options: { model?: object; modelRegistry?: object } = {}) {
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	const events: EventBus = {
		emit(name, value) {
			for (const listener of listeners.get(name) ?? []) listener(value);
		},
		on(name, listener) {
			const list = listeners.get(name) ?? new Set();
			list.add(listener);
			listeners.set(name, list);
			return () => list.delete(listener);
		},
	};
	const requestRender = vi.fn();
	let factory: Factory | undefined;
	let editor: Editor | undefined;
	const theme = {
		fg: (_: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
	const setEditorComponent = vi.fn((value?: Factory) => {
		factory = value;
		// Pi publishes the factory before constructing the editor from it.
		editor = value?.(
			{ requestRender, terminal: { rows: 40, columns: 140 } } as never,
			{
				borderColor: (text: string) => text,
				selectList: {
					selectedPrefix: (text: string) => text,
					selectedText: (text: string) => text,
					description: (text: string) => text,
					scrollInfo: (text: string) => text,
					noMatch: (text: string) => text,
				},
			} as never,
			{} as never,
		);
	});
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: "/wrapped-editor-consumers",
		model: options.model ?? { id: "wrapped-model", provider: "test", contextWindow: 10_000 },
		modelRegistry: options.modelRegistry,
		getContextUsage: () => undefined,
		sessionManager: SessionManager.inMemory("/wrapped-editor-consumers"),
		isIdle: () => true,
		ui: {
			theme,
			setFooter: vi.fn(),
			setEditorComponent,
			getEditorComponent: () => factory,
			getEditorText: () => "",
			getExpandedEditorText: () => "",
			setEditorText: vi.fn(),
			setStatus: vi.fn(),
			// Host Working-row surfaces; spies act as the exclusivity oracle.
			setWorkingMessage: vi.fn(),
			setWorkingIndicator: vi.fn(),
			setWorkingVisible: vi.fn(),
		},
	};
	const handlers = new Map<string, Handler[]>();
	zentui({
		events,
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getThinkingLevel: () => "off",
		registerCommand() {},
		registerEntryRenderer() {},
	} as never);
	return {
		ctx,
		events,
		requestRender,
		setEditorComponent,
		/** Public Pi pattern: wrap whatever is installed without owning or replacing it. */
		installForeignWrapper() {
			const predecessor = ctx.ui.getEditorComponent();
			if (!predecessor) throw new Error("no predecessor editor");
			const wrapper: Factory = (tui, editorTheme, keybindings) =>
				(predecessor as Factory)(tui, editorTheme, keybindings);
			ctx.ui.setEditorComponent(wrapper);
			return wrapper;
		},
		/** Another extension replaces the whole chain, dropping the Zentui editor entirely. */
		replaceChain() {
			ctx.ui.setEditorComponent((() => ({ render: () => [] })) as unknown as Factory);
		},
		disableEditor() {
			const hook = runtime.hooks?.setEditorComponent as
				| ((patch: object, ctx: unknown) => void)
				| undefined;
			if (!hook) throw new Error("settings hooks were not registered");
			runtime.editorEnabled = false;
			hook({ enabled: false }, ctx);
		},
		/** Settings-hook enable path; also reinstalls after a foreign chain replacement. */
		enableEditor() {
			const hook = runtime.hooks?.setEditorComponent as
				| ((patch: object, ctx: unknown) => void)
				| undefined;
			if (!hook) throw new Error("settings hooks were not registered");
			runtime.editorEnabled = true;
			hook({ enabled: true }, ctx);
		},
		/** Pi focus, which the editor must render once before it reports border capability. */
		focusEditor(focused = true) {
			if (!editor) throw new Error("no editor was constructed");
			editor.focused = focused;
		},
		render: (width = 140) => editor?.render(width).join("\n") ?? "",
		probe(key = "@scope/usage:quota") {
			const probe = { supported: false, active: false, key };
			events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, probe);
			return probe;
		},
		publish(text?: string, key = "@scope/usage:quota") {
			events.emit(ZENTUI_VARIABLE_EVENT, { key, text });
		},
		async emit(name: string, event: unknown = {}) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

beforeEach(() => {
	runtime.hooks = undefined;
	runtime.editorEnabled = true;
	runtime.configure = undefined;
	runtime.config = undefined;
	runtime.gitStatusCalls.mockReset();
	codexHttp.mockClear();
	vi.stubGlobal("fetch", codexHttp);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("project/git refresh demand stays live for a layered editor (#163 follow-up)", () => {
	const withGit = (config: import("../extensions/zentui/config").ZentuiConfig) => {
		config.components.editor.styles.minimalist.showGit = true;
		config.components.footer.style = "native";
	};

	it("keeps probing after ownership clears and stops when the editor is disabled", async () => {
		runtime.configure = withGit;
		const h = harness();
		await h.emit("session_start");
		await flush();
		const ownedProbes = runtime.gitStatusCalls.mock.calls.length;
		expect(ownedProbes).toBeGreaterThan(0);

		// A foreign wrapper keeps constructing the Zentui editor; ownership is cleared on refresh.
		const wrapper = h.installForeignWrapper();
		await h.emit("model_select");
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
		await vi.advanceTimersByTimeAsync(5000);
		const layeredProbes = runtime.gitStatusCalls.mock.calls.length;
		expect(layeredProbes).toBeGreaterThan(ownedProbes);

		// Disabling the editor stops demand without removing the foreign wrapper.
		h.disableEditor();
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(runtime.gitStatusCalls.mock.calls.length).toBe(layeredProbes);
	});

	it("stops probing when the wrapper chain is replaced", async () => {
		runtime.configure = withGit;
		const h = harness();
		await h.emit("session_start");
		await flush();
		h.installForeignWrapper();
		await h.emit("model_select");
		const beforePoll = runtime.gitStatusCalls.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5000);
		const layeredProbes = runtime.gitStatusCalls.mock.calls.length;
		expect(layeredProbes).toBeGreaterThan(beforePoll);

		h.replaceChain();
		await h.emit("model_select");
		await vi.advanceTimersByTimeAsync(10_000);
		expect(runtime.gitStatusCalls.mock.calls.length).toBe(layeredProbes);
	});
});

describe("custom variable demand stays live for a layered editor (#163 follow-up)", () => {
	const withVariable = (config: import("../extensions/zentui/config").ZentuiConfig) => {
		config.components.editor.styles.minimalist.formats = {
			topLeft: "",
			topMiddle: "$quota",
			topRight: "",
			bottomLeft: "",
			bottomMiddle: "",
			bottomRight: "",
		};
		config.components.editor.styles.minimalist.variables = { quota: "@scope/usage:quota" };
	};

	it("keeps the value after ownership clears and releases it when the editor is disabled", async () => {
		runtime.configure = withVariable;
		const h = harness();
		await h.emit("session_start");
		h.render();
		expect(h.probe().active).toBe(true);

		const wrapper = h.installForeignWrapper();
		h.render();
		expect(h.probe().active).toBe(true);
		await h.emit("model_select");
		expect(h.probe().active).toBe(true);

		h.publish("CC $459/1200");
		expect(h.render()).toContain("CC $459/1200");

		h.disableEditor();
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
		expect(h.probe().active).toBe(false);
		expect(h.render()).not.toContain("CC $459/1200");
	});

	it("releases the value when the wrapper chain is replaced", async () => {
		runtime.configure = withVariable;
		const h = harness();
		await h.emit("session_start");
		h.render();
		h.installForeignWrapper();
		h.render();
		await h.emit("model_select");
		h.publish("CC $459/1200");
		expect(h.render()).toContain("CC $459/1200");

		h.replaceChain();
		await h.emit("model_select");
		expect(h.probe().active).toBe(false);
		expect(h.render()).not.toContain("CC $459/1200");
	});

	it("requires a fresh render after the session changes", async () => {
		runtime.configure = withVariable;
		const h = harness();
		await h.emit("session_start");
		h.render();
		h.installForeignWrapper();
		h.render();
		await h.emit("model_select");
		h.publish("old quota");
		expect(h.render()).toContain("old quota");

		await h.emit("session_shutdown");
		expect(h.probe().active).toBe(false);

		await h.emit("session_start");
		expect(h.probe().active).toBe(false);
		expect(h.render()).not.toContain("old quota");
		expect(h.probe().active).toBe(true);
	});
});

describe("codex quota demand stays live for a layered editor (#163 follow-up)", () => {
	const model = {
		id: "gpt-codex",
		provider: "openai-codex",
		contextWindow: 200_000,
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
	};
	const modelRegistry = {
		getProviderAuth: vi.fn(async () => ({ auth: { apiKey: "synthetic-token" } })),
		getProvider: () => ({ id: "openai-codex", baseUrl: "https://chatgpt.com/backend-api" }),
	};
	const withQuota = (config: import("../extensions/zentui/config").ZentuiConfig) => {
		config.components.editor.codexQuota = true;
		config.components.editor.styles.minimalist.formats = {
			topLeft: "",
			topMiddle: "",
			topRight: "$codex_quota",
			bottomLeft: "",
			bottomMiddle: "",
			bottomRight: "",
		};
	};

	it("keeps polling after ownership clears and stops when the editor is disabled", async () => {
		runtime.configure = withQuota;
		const h = harness({ model, modelRegistry });
		await h.emit("session_start");
		await flush();
		expect(codexHttp).toHaveBeenCalledTimes(1);

		const wrapper = h.installForeignWrapper();
		await h.emit("model_select");
		await flush();
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexHttp).toHaveBeenCalledTimes(2);

		h.disableEditor();
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(codexHttp).toHaveBeenCalledTimes(2);
	});

	it("stops polling when the wrapper chain is replaced", async () => {
		runtime.configure = withQuota;
		const h = harness({ model, modelRegistry });
		await h.emit("session_start");
		await flush();
		h.installForeignWrapper();
		await h.emit("model_select");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexHttp).toHaveBeenCalledTimes(2);

		h.replaceChain();
		await h.emit("model_select");
		await vi.advanceTimersByTimeAsync(120_000);
		expect(codexHttp).toHaveBeenCalledTimes(2);
	});
});

describe("turn_duration timer stays live for a layered editor (#163 follow-up)", () => {
	const withTimer = (config: import("../extensions/zentui/config").ZentuiConfig) => {
		config.components.editor.styles.minimalist.showTimer = true;
		config.components.editor.styles.minimalist.showGit = false;
	};

	it("keeps repainting the elapsed duration after ownership clears and stops on disable", async () => {
		runtime.configure = withTimer;
		const h = harness();
		await h.emit("session_start");
		await flush();
		h.render();
		const wrapper = h.installForeignWrapper();
		h.render();
		await h.emit("model_select");
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);

		await h.emit("agent_start", {});
		await flush();
		expect(h.render()).toContain("0s");

		// The layered editor still reports decoration, so the elapsed clock keeps repainting it.
		h.requestRender.mockClear();
		await vi.advanceTimersByTimeAsync(1000);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		expect(h.render()).toContain("1s");
		h.requestRender.mockClear();
		await vi.advanceTimersByTimeAsync(1000);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		expect(h.render()).toContain("2s");

		h.disableEditor();
		h.requestRender.mockClear();
		await vi.advanceTimersByTimeAsync(3000);
		expect(h.requestRender).not.toHaveBeenCalled();
	});
});

describe("project/git refresh stops eagerly when layered visibility drops (#163 follow-up)", () => {
	const withGitLongInterval = (config: import("../extensions/zentui/config").ZentuiConfig) => {
		config.components.editor.styles.minimalist.showGit = true;
		config.components.footer.style = "native";
		// Long enough that the periodic interval cannot fire inside this test, so the drop must
		// stop the refresh itself instead of relying on the interval's next self-stop tick.
		config.projectRefreshIntervalMs = 3_600_000;
	};

	it("stops the periodic refresh synchronously and re-arms on demand after a replacement", async () => {
		runtime.configure = withGitLongInterval;
		const h = harness();
		await h.emit("session_start");
		await flush();
		expect(runtime.gitStatusCalls.mock.calls.length).toBeGreaterThan(0);
		const armedTimers = vi.getTimerCount();

		const wrapper = h.installForeignWrapper();
		await h.emit("model_select");
		expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
		// Layered visibility keeps the periodic refresh armed.
		expect(vi.getTimerCount()).toBe(armedTimers);

		h.replaceChain();
		await h.emit("model_select");
		await flush();
		const afterDrop = runtime.gitStatusCalls.mock.calls.length;
		// stopProjectRefresh() ran inside this refresh event, so the interval is already gone; the
		// long interval guarantees no self-stop tick could have produced the same result.
		expect(vi.getTimerCount()).toBe(armedTimers - 1);

		// Demand returning re-arms and probes immediately instead of waiting on a stale interval.
		h.enableEditor();
		await flush();
		expect(runtime.gitStatusCalls.mock.calls.length).toBe(afterDrop + 1);
		expect(vi.getTimerCount()).toBe(armedTimers);
	});
});

describe("working-line border placement through a layered editor", () => {
	const withBorderWorkingLine = (config: import("../extensions/zentui/config").ZentuiConfig) => {
		config.components.workingLine.enabled = true;
		config.components.workingLine.placement = "border";
		config.components.workingLine.messages = { custom: true, values: ["WORKING-PROBE"] };
		config.components.editor.styles.minimalist.showGit = false;
	};

	it.each(
		(["minimalist", "opencode", "opencode-copy-friendly"] as const).flatMap((style) =>
			(["replacement", "shutdown"] as const).map((ending) => ({ style, ending })),
		),
	)(
		"embeds $style only through a focused safe border, releasing on $ending",
		async ({ style, ending }) => {
			runtime.configure = (config) => {
				withBorderWorkingLine(config);
				config.components.editor.style = style;
			};
			const h = harness();
			await h.emit("session_start");
			await flush();
			await h.emit("agent_start");
			const wrapper = h.installForeignWrapper();
			await h.emit("model_select");
			h.focusEditor();
			// Construction and focus alone cannot hide the native row.
			expect(h.ctx.ui.setWorkingVisible).not.toHaveBeenCalled();
			expect(h.render()).toContain("WORKING-PROBE");
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(false);
			h.focusEditor(false);
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			h.focusEditor();
			expect(h.render(12)).not.toContain("WORKING-PROBE");
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			expect(h.render()).toContain("WORKING-PROBE");
			const render = vi.spyOn(CustomEditor.prototype, "render").mockReturnValue(["unsafe"]);
			expect(h.render()).not.toContain("WORKING-PROBE");
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			render.mockRestore();
			expect(h.render()).toContain("WORKING-PROBE");
			if (!runtime.config) throw new Error("config not loaded");
			runtime.config.components.editor.style = "accent-rail";
			expect(h.render()).not.toContain("WORKING-PROBE");
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			runtime.config.components.editor.style = style;
			expect(h.render()).toContain("WORKING-PROBE");
			h.disableEditor();
			expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			expect(h.render()).not.toContain("WORKING-PROBE");
			h.enableEditor();
			const finalWrapper = h.installForeignWrapper();
			h.focusEditor();
			expect(h.render()).toContain("WORKING-PROBE");
			if (ending === "replacement") {
				h.replaceChain();
				await vi.advanceTimersByTimeAsync(300);
				expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			}
			await h.emit("session_shutdown");
			expect(h.ctx.ui.setWorkingVisible).toHaveBeenLastCalledWith(true);
			if (ending === "shutdown") expect(h.ctx.ui.getEditorComponent()).toBe(finalWrapper);
			expect(h.render()).not.toContain("WORKING-PROBE");
		},
	);
});
