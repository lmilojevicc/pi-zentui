import { SessionManager, type Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	hooks: undefined as undefined | Record<string, (...args: never[]) => unknown>,
	editorEnabled: true,
	config: undefined as import("../extensions/zentui/config").ZentuiConfig | undefined,
}));
vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: vi.fn(() => {
			const config = structuredClone(actual.defaultConfig);
			config.projectRefreshIntervalMs = 0;
			config.components.editor.enabled = runtime.editorEnabled;
			config.components.editor.style = "minimalist";
			config.components.editor.styles.minimalist.showCost = true;
			config.components.editor.styles.minimalist.showGit = false;
			config.components.footer.style = "hidden";
			config.components.userMessages.enabled = false;
			config.components.selectorBorders.enabled = false;
			config.components.workingLine.enabled = false;
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
		readGitStatus: async () => ({ kind: "ok", status: actual.emptyGitStatus() }),
	};
});
vi.mock("../extensions/zentui/runtime", () => ({
	readRuntimeInfo: async () => ({ kind: "ok", runtime: undefined }),
}));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: async () => ({ kind: "ok", result: null }),
}));

import zentui from "../extensions/zentui/index";

type Editor = { render(width: number): string[]; setText(text: string): void };
type Factory = (...args: never[]) => Editor;
type Handler = (event: unknown, ctx: unknown) => unknown;

function message(cost: number) {
	return {
		role: "assistant",
		usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: cost } },
		content: [],
		stopReason: "stop",
		timestamp: 1,
	};
}

function harness() {
	const manager = SessionManager.inMemory("/wrapped-editor-usage");
	manager.appendMessage(message(1) as never);
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
		cwd: "/wrapped-editor-usage",
		model: { id: "wrapped-model", provider: "test", contextWindow: 10_000 },
		getContextUsage: () => undefined,
		sessionManager: manager,
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
		},
	};
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getThinkingLevel: () => "off",
		registerCommand() {},
		registerEntryRenderer() {},
	} as never);
	return {
		ctx,
		manager,
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
		disableEditor() {
			const hook = runtime.hooks?.setEditorComponent as
				| ((patch: object, ctx: unknown) => void)
				| undefined;
			if (!hook) throw new Error("settings hooks were not registered");
			hook({ enabled: false }, ctx);
		},
		render: () => editor?.render(140).join("\n") ?? "",
		async emit(name: string, event: unknown = {}) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

beforeEach(() => {
	runtime.hooks = undefined;
	runtime.editorEnabled = true;
});
afterEach(() => vi.restoreAllMocks());

describe("minimalist editor wrapped by a predecessor-preserving foreign wrapper (#163)", () => {
	it("keeps cost across refresh, updates after agent_end/agent_settled, and repaints", async () => {
		const h = harness();
		await h.emit("session_start");
		const wrapper = h.installForeignWrapper();
		try {
			expect(h.render()).toContain("$1.000");

			// Refresh observes a foreign outer factory and clears installation ownership.
			await h.emit("model_select");
			expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
			expect(h.render()).toContain("$1.000");
			expect(h.render()).not.toContain("$0.000");

			h.manager.appendMessage(message(0.21) as never);
			h.requestRender.mockClear();
			await h.emit("agent_end", { messages: [] });
			expect(h.requestRender).toHaveBeenCalled();
			await h.emit("agent_settled");
			expect(h.render()).toContain("$1.210");
			expect(h.render()).not.toContain("$0.000");
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("shows the replacement session's cost after a session switch", async () => {
		const h = harness();
		await h.emit("session_start");
		h.installForeignWrapper();
		try {
			await h.emit("model_select");
			expect(h.render()).toContain("$1.000");

			await h.emit("session_shutdown");
			h.manager.newSession();
			h.manager.appendMessage(message(7) as never);
			await h.emit("session_start");
			await h.emit("model_select");
			expect(h.render()).toContain("$7.000");
			expect(h.render()).not.toContain("$1.000");
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("drops layered usage demand when the editor is disabled", async () => {
		const h = harness();
		await h.emit("session_start");
		h.installForeignWrapper();
		try {
			await h.emit("model_select");
			const entries = vi.spyOn(h.manager, "getEntries");
			await h.emit("agent_end", { messages: [] });
			expect(entries).toHaveBeenCalled();

			entries.mockClear();
			runtime.editorEnabled = false;
			h.disableEditor();
			await h.emit("agent_end", { messages: [] });
			expect(entries).not.toHaveBeenCalled();
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("never removes or replaces the foreign wrapper during disable or shutdown cleanup", async () => {
		const h = harness();
		await h.emit("session_start");
		const wrapper = h.installForeignWrapper();
		try {
			await h.emit("model_select");
			h.setEditorComponent.mockClear();

			h.disableEditor();
			expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
			expect(h.setEditorComponent).not.toHaveBeenCalled();

			await h.emit("session_shutdown");
			expect(h.ctx.ui.getEditorComponent()).toBe(wrapper);
			expect(h.setEditorComponent).not.toHaveBeenCalled();
		} finally {
			await h.emit("session_shutdown");
		}
	});
});
