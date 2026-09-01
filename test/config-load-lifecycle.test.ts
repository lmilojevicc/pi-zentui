import type { Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { PolishedTuiConfig } from "../extensions/zentui/config";

const mocks = vi.hoisted(() => ({
	config: undefined as unknown as PolishedTuiConfig,
	loadConfig: vi.fn(() => mocks.config),
}));

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return { ...actual, loadConfig: mocks.loadConfig };
});

import { defaultConfig } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

initTheme("dark", false);

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type Command = { handler(args: string, ctx: unknown): Promise<void> };
type SettingsComponent = { render(width: number): string[]; handleInput(data: string): void };

function config(enabled: boolean): PolishedTuiConfig {
	const value = structuredClone(defaultConfig);
	value.projectRefreshIntervalMs = 0;
	value.components.editor.enabled = false;
	value.components.userMessages.enabled = false;
	value.components.selectorBorders.enabled = false;
	value.components.footer.style = "native";
	value.components.workingLine.enabled = false;
	value.components.thinkingSteps = { enabled, mode: "rail" };
	return value;
}

function theme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
}

function context() {
	let editor: unknown;
	let settings: SettingsComponent | undefined;
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: process.cwd(),
		ui: {
			theme: theme(),
			setFooter() {},
			setEditorComponent(value: unknown) {
				editor = value;
			},
			getEditorComponent: () => editor,
			getEditorText: () => "",
			setEditorText() {},
			onTerminalInput: () => () => {},
			notify() {},
			async custom(factory: (...args: unknown[]) => unknown) {
				settings = factory({ requestRender() {} }, theme(), {}, () => {}) as SettingsComponent;
			},
		},
		sessionManager: {
			getBranch: () => [],
			getEntries: () => [],
			getSessionName: () => undefined,
		},
		getContextUsage: () => undefined,
	};
	return { ctx, settings: () => settings };
}

async function emit(handlers: Map<string, Handler[]>, event: string, ctx: unknown) {
	for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
}

describe("session config loading", () => {
	it("does not read at registration, loads exactly once per start, and observes external changes", async () => {
		mocks.loadConfig.mockClear();
		mocks.config = config(false);
		const handlers = new Map<string, Handler[]>();
		let command: Command | undefined;
		zentui({
			on(event: string, handler: Handler) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			registerCommand(name: string, value: Command) {
				if (name === "zentui") command = value;
			},
			registerEntryRenderer() {},
			getThinkingLevel: () => "off",
		} as never);
		expect(mocks.loadConfig).not.toHaveBeenCalled();

		const harness = context();
		const native = AssistantMessageComponent.prototype.updateContent;
		await emit(handlers, "session_start", harness.ctx);
		expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
		expect(AssistantMessageComponent.prototype.updateContent).toBe(native);
		await emit(handlers, "session_shutdown", harness.ctx);

		mocks.config = config(true);
		await emit(handlers, "session_start", harness.ctx);
		expect(mocks.loadConfig).toHaveBeenCalledTimes(2);
		expect(AssistantMessageComponent.prototype.updateContent).not.toBe(native);
		expect(command).toBeDefined();
		await command?.handler("", harness.ctx);
		const settingsComponent = harness.settings();
		for (let index = 0; index < 3; index += 1) settingsComponent?.handleInput("\t");
		const settings = settingsComponent?.render(160).join("\n") ?? "";
		expect(settings).toContain("Thinking (Experimental)");
		expect(settings).toMatch(/Enabled.*enabled/);
		expect(settings).toMatch(/Mode.*Rail/);
		await emit(handlers, "session_shutdown", harness.ctx);
		expect(AssistantMessageComponent.prototype.updateContent).toBe(native);
	});
});
