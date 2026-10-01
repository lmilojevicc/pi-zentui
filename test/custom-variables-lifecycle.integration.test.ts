import { type EventBus, SessionManager, type Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	config: undefined as import("../extensions/zentui/config").PolishedTuiConfig | undefined,
	hooks: undefined as Record<string, (...args: never[]) => unknown> | undefined,
}));
vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		loadConfig() {
			return runtime.config;
		},
		saveEditorComponentPatch(patch: object) {
			Object.assign(runtime.config?.components.editor ?? {}, patch);
			return runtime.config;
		},
		saveMinimalistEditorStylePatch(patch: object) {
			Object.assign(runtime.config?.components.editor.styles.minimalist ?? {}, patch);
			return runtime.config;
		},
	};
});
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, hooks: typeof runtime.hooks) {
		runtime.hooks = hooks;
	},
}));

import { mergeConfig } from "../extensions/zentui/config";
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
};
type Factory = (...args: never[]) => Editor;
type Handler = (event: unknown, ctx: unknown) => unknown;
function harness(mode = "tui") {
	const handlers = new Map<string, Handler[]>();
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
	let factory: Factory | undefined;
	let editor: Editor | undefined;
	let text = "retained draft";
	const requestRender = vi.fn();
	const theme = {
		fg: (_color: string, value: string) => value,
		bold: (value: string) => value,
		italic: (value: string) => value,
		getThinkingBorderColor: () => (value: string) => value,
	} as unknown as Theme;
	const ui = {
		theme,
		getEditorComponent: () => factory,
		setEditorComponent(value?: Factory) {
			// The real public Pi setter transfers the current editor text to its replacement.
			const draft = editor?.getText() ?? text;
			factory = value;
			editor = value?.(
				{ requestRender, terminal: { rows: 40, columns: 140 } } as never,
				{
					borderColor: (value: string) => value,
					selectList: {
						selectedPrefix: (value: string) => value,
						selectedText: (value: string) => value,
						description: (value: string) => value,
						scrollInfo: (value: string) => value,
						noMatch: (value: string) => value,
					},
				} as never,
				{} as never,
			);
			editor?.setText(draft);
			text = draft;
		},
		getEditorText: () => editor?.getText() ?? text,
		getExpandedEditorText: () => editor?.getExpandedText() ?? text,
		setEditorText(value: string) {
			text = value;
			editor?.setText(value);
		},
		setFooter: vi.fn(),
		setStatus: vi.fn(),
	};
	const ctx = {
		mode,
		hasUI: mode === "tui",
		cwd: "/tmp/zentui-variable-test",
		ui,
		sessionManager: SessionManager.inMemory("/tmp/zentui-variable-test"),
		model: { id: "test-model", provider: "test", contextWindow: 100_000 },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 100_000, percent: 1 }),
		isIdle: () => true,
	};
	zentui({
		events,
		registerCommand() {},
		registerEntryRenderer() {},
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getThinkingLevel: () => "off",
	} as never);
	return {
		ctx,
		ui,
		events,
		requestRender,
		render: (width = 140) => editor?.render(width).join("\n") ?? "",
		editorText: () => editor?.getText() ?? text,
		async emit(name: string) {
			for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
		},
		capability(key = "@scope/usage:quota") {
			const probe = { supported: false, active: false, key };
			events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, probe);
			return probe;
		},
		publish(value?: string) {
			events.emit(ZENTUI_VARIABLE_EVENT, { key: "@scope/usage:quota", text: value });
		},
		hook(name: string, patch: object) {
			runtime.hooks?.[name]?.(patch as never, ctx as never);
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	runtime.config = mergeConfig({
		projectRefreshIntervalMs: 0,
		components: {
			editor: {
				style: "minimalist",
				styles: {
					minimalist: {
						formats: {
							topLeft: "",
							topMiddle: "$quota",
							topRight: "",
							bottomLeft: "",
							bottomMiddle: "",
							bottomRight: "",
						},
						variables: { quota: "@scope/usage:quota" },
					},
				},
			},
			footer: { style: "native" },
			userMessages: { enabled: false },
			selectorBorders: { enabled: false },
			workingLine: { enabled: false },
		},
	});
});
afterEach(() => {
	vi.useRealTimers();
	runtime.hooks = undefined;
});

describe("custom variable editor lifecycle", () => {
	it("gates on actual owned decoration, updates idle slots, preserves the draft, and clears on shutdown", async () => {
		const h = harness();
		expect(h.capability()).toMatchObject({ supported: true, active: false });
		await h.emit("session_start");
		h.render();
		expect(h.capability()).toMatchObject({ active: true });
		expect(h.capability("@other/unused:value").active).toBe(false);
		h.publish("CC $459/1200");
		expect(h.render()).toContain("CC $459/1200");
		expect(h.requestRender).toHaveBeenCalled();
		expect(h.editorText()).toBe("retained draft");
		await h.emit("session_shutdown");
		expect(h.capability().active).toBe(false);
	});
	it("discards values on disable and requires republishing after re-enable", async () => {
		const h = harness();
		await h.emit("session_start");
		h.render();
		h.publish("old quota");
		h.hook("setEditorComponent", { enabled: false });
		expect(h.capability().active).toBe(false);
		h.hook("setEditorComponent", { enabled: true });
		h.render();
		expect(h.capability().active).toBe(true);
		expect(h.render()).not.toContain("old quota");
		h.publish("new quota");
		expect(h.render()).toContain("new quota");
		await h.emit("session_shutdown");
	});
	it("clears on a new session and releases demand when templates no longer reference the key", async () => {
		const h = harness();
		await h.emit("session_start");
		h.render();
		h.publish("old quota");
		await h.emit("session_start");
		expect(h.render()).not.toContain("old quota");
		h.publish("new quota");
		h.hook("setMinimalist", {
			formats: {
				topLeft: "",
				topMiddle: "",
				topRight: "",
				bottomLeft: "",
				bottomMiddle: "",
				bottomRight: "",
			},
		});
		expect(h.capability().active).toBe(false);
		expect(h.render()).not.toContain("new quota");
		await h.emit("session_shutdown");
	});
	it("fails open after editor ownership is displaced and remains inactive outside TUI", async () => {
		const h = harness();
		await h.emit("session_start");
		h.render();
		h.publish("old quota");
		h.ui.setEditorComponent(undefined);
		expect(h.capability().active).toBe(false);
		await h.emit("model_select");
		expect(h.capability().active).toBe(false);
		await h.emit("session_shutdown");
		const headless = harness("json");
		await headless.emit("session_start");
		expect(headless.capability().active).toBe(false);
		await headless.emit("session_shutdown");
	});
});
