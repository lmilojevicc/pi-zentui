import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	ModelSelectorComponent,
	SettingsSelectorComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { type PolishedTuiConfig, defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import zentui from "../extensions/zentui/index";
import { patchSelectorBorderStyle } from "../extensions/zentui/selector-border";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";
import { createInitialState } from "../extensions/zentui/state";
import { PolishedEditor } from "../extensions/zentui/ui";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type FooterFactory = (...args: unknown[]) => {
	render(width: number): string[];
	dispose?: () => void;
};

const originalUserMessageRender = UserMessageComponent.prototype.render;
const originalModelSelectorRender = ModelSelectorComponent.prototype.render;
const originalSettingsSelectorRender = SettingsSelectorComponent.prototype.render;

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

function makeTaggedTheme(prefix = ""): Theme {
	return {
		fg(color: string, text: string) {
			return `[${prefix}${color}]${text}`;
		},
		bold(text: string) {
			return `[${prefix}bold]${text}`;
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
		getThinkingBorderColor(level: string) {
			return (text: string) => `[${prefix}thinking:${level}]${text}`;
		},
	} as unknown as Theme;
}

function makeStrictTheme(): Theme {
	const knownColors = new Set([
		"accent",
		"border",
		"borderMuted",
		"error",
		"mdCode",
		"mdCodeBlock",
		"mdCodeBlockBorder",
		"mdHeading",
		"mdHr",
		"mdLink",
		"mdLinkUrl",
		"mdListBullet",
		"mdQuote",
		"mdQuoteBorder",
		"muted",
		"success",
		"syntaxFunction",
		"syntaxKeyword",
		"text",
		"userMessageText",
		"warning",
	]);

	return {
		fg(color: string, text: string) {
			if (!knownColors.has(color)) {
				throw new Error(`Unknown theme color: ${color}`);
			}
			return `[${color}]${text}`;
		},
		bold(text: string) {
			return `[bold]${text}`;
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

function makeUi(prefix = "") {
	return {
		theme: makeTaggedTheme(prefix),
		setFooter() {},
		setEditorComponent() {},
	};
}

function configWithColorSources(
	colorSources: Partial<PolishedTuiConfig["colorSources"]>,
): PolishedTuiConfig {
	return {
		...defaultConfig,
		colorSources: {
			...defaultConfig.colorSources,
			...colorSources,
		},
	};
}

function configWithColors(
	colors: Partial<PolishedTuiConfig["colors"]>,
	colorSources: Partial<PolishedTuiConfig["colorSources"]> = {},
): PolishedTuiConfig {
	return {
		...defaultConfig,
		colors: {
			...defaultConfig.colors,
			...colors,
		},
		colorSources: {
			...defaultConfig.colorSources,
			...colorSources,
		},
	};
}

function stripPromptMarks(line: string): string {
	return line.replaceAll(/\x1b]133;[ABC]\x07/g, "").replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function stripTestTags(line: string): string {
	return stripPromptMarks(line).replaceAll(/\[[^\]]+\]/g, "");
}

function loadExtension(options: { thinkingLevel?: string; commands?: Map<string, unknown> } = {}) {
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
		},
		registerCommand(name: string, command: unknown) {
			options.commands?.set(name, command);
		},
		getThinkingLevel() {
			return options.thinkingLevel ?? "off";
		},
	} as never);
	return handlers;
}

async function emit(handlers: Map<string, Handler[]>, eventName: string, ctx: unknown) {
	for (const handler of handlers.get(eventName) ?? []) {
		await handler({}, ctx);
	}
}

function makeContext(overrides: Record<string, unknown> = {}) {
	const theme = makeTheme();
	return {
		hasUI: true,
		cwd: process.cwd(),
		model: { id: "claude-sonnet", provider: "anthropic", contextWindow: 200_000 },
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 }),
		ui: {
			theme,
			setFooter() {},
			setEditorComponent() {},
		},
		...overrides,
	};
}

afterEach(() => {
	UserMessageComponent.prototype.render = originalUserMessageRender;
	const prototype = UserMessageComponent.prototype as unknown as Record<string, unknown>;
	prototype.__zentuiUserMessageOriginalRender = undefined;
	prototype.__zentuiUserMessagePatched = undefined;
	prototype.__zentuiUserMessageWrapper = undefined;
	prototype.__zentuiUserMessageActive = undefined;
	prototype.__zentuiUserMessageGetTheme = undefined;
	prototype.__zentuiUserMessageGetConfig = undefined;

	ModelSelectorComponent.prototype.render = originalModelSelectorRender;
	SettingsSelectorComponent.prototype.render = originalSettingsSelectorRender;
	for (const selectorPrototype of [
		ModelSelectorComponent.prototype,
		SettingsSelectorComponent.prototype,
	]) {
		const patchable = selectorPrototype as unknown as Record<string, unknown>;
		patchable.__zentuiSelectorBorderOriginalRender = undefined;
		patchable.__zentuiSelectorBorderPatched = undefined;
		patchable.__zentuiSelectorBorderWrapper = undefined;
		patchable.__zentuiSelectorBorderActive = undefined;
		patchable.__zentuiSelectorBorderGetTheme = undefined;
		patchable.__zentuiSelectorBorderGetConfig = undefined;
	}
});

describe("Pi docs compliance", () => {
	it("uses the current @earendil-works Pi packages instead of the old @mariozechner scope", () => {
		const files = [
			"package.json",
			"extensions/zentui/config.ts",
			"extensions/zentui/index.ts",
			"extensions/zentui/ui.ts",
		];
		const content = files.map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");

		expect(content).not.toContain("@mariozechner/");
		expect(content).toContain("@earendil-works/");
	});

	it("does not install interactive TUI components when ctx.hasUI is false", async () => {
		const handlers = loadExtension();
		const throwingUi = {
			theme: makeTheme(),
			setFooter() {
				throw new Error("setFooter should not be called without UI");
			},
			setEditorComponent() {
				throw new Error("setEditorComponent should not be called without UI");
			},
		};
		const ctx = makeContext({ hasUI: false, ui: throwingUi });

		await expect(emit(handlers, "session_start", ctx)).resolves.toBeUndefined();
	});

	it("does not install user-message rendering when ctx.hasUI is false", async () => {
		const handlers = loadExtension();
		const ctx = makeContext({ hasUI: false });

		await emit(handlers, "session_start", ctx);

		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
	});

	it("renders user messages like the ZentUI prompt box", async () => {
		const handlers = loadExtension();
		const ctx = makeContext({ ui: makeUi() });

		await emit(handlers, "session_start", ctx);

		const lines = new UserMessageComponent("hello **zentui**").render(80).map(stripPromptMarks);
		const rendered = lines.join("\n");

		expect(stripTestTags(lines[0])).toMatch(/^─+$/);
		expect(stripTestTags(lines.at(-1) ?? "")).toMatch(/^─+$/);
		const raw = new UserMessageComponent("hello").render(80).join("\n");
		expect(raw).toMatch(/\[accent\]│|\u001b\[34m│\u001b\[0m/);
		expect(raw).toMatch(/\[borderMuted\]────|\u001b\[90m────/);
		expect(rendered).toContain("[userMessageText]");
		expect(rendered).toContain("[bold]");
		expect(rendered).not.toContain("**zentui**");
		expect(rendered).not.toContain("claude-sonnet");
		expect(rendered).not.toContain("Anthropic");
		expect(rendered).not.toContain("xhigh");
	});

	it("renders selector top and bottom borders from the editor color source", () => {
		const prototype = {
			render(width: number) {
				return ["─".repeat(width), "body", "─".repeat(width)];
			},
		};

		patchSelectorBorderStyle(
			prototype,
			() => makeTaggedTheme(),
			() => defaultConfig,
		);
		const lines = prototype.render(8);

		expect(lines[0]).toContain("[borderMuted]────────");
		expect(stripTestTags(lines[0])).toBe("────────");
		expect(lines[1]).toBe("body");
		expect(lines.at(-1)).toContain("[borderMuted]────────");

		const terminalPrototype = {
			render(width: number) {
				return ["─".repeat(width), "body", "─".repeat(width)];
			},
		};

		patchSelectorBorderStyle(
			terminalPrototype,
			() => makeTaggedTheme(),
			() => configWithColorSources({ editor: "terminal" }),
		);
		const terminalLines = terminalPrototype.render(8);

		expect(terminalLines[0]).toContain("\u001b[90m────────");
		expect(stripPromptMarks(terminalLines[0])).toBe("────────");
		expect(terminalLines[1]).toBe("body");
		expect(terminalLines.at(-1)).toContain("\u001b[90m────────");
	});

	it("does not clobber selector lines that are not borders", () => {
		const prototype = {
			render(width: number) {
				return ["Selector title", "─".repeat(width), "help text"];
			},
		};

		patchSelectorBorderStyle(
			prototype,
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

		expect(prototype.render(8)).toEqual(["Selector title", "────────", "help text"]);
	});

	it("selector cleanup disables patched border styling", () => {
		const prototype = {
			render(width: number) {
				return ["─".repeat(width), "body", "─".repeat(width)];
			},
		};

		const cleanup = patchSelectorBorderStyle(
			prototype,
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

		expect(prototype.render(8)[0]).toContain("[borderMuted]────────");
		cleanup();
		expect(prototype.render(8)).toEqual(["────────", "body", "────────"]);
	});

	it("renders user-message borders from the user-message color source", () => {
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => configWithColorSources({ userMessages: "theme" }),
		);
		const themeRendered = new UserMessageComponent("hello").render(80).join("\n");
		expect(themeRendered).toContain("[borderMuted]────");

		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => configWithColorSources({ userMessages: "terminal" }),
		);
		const terminalRendered = new UserMessageComponent("hello").render(80).join("\n");
		expect(terminalRendered).toContain("\u001b[90m────");
	});

	it("user-message cleanup disables patched rendering", () => {
		const cleanup = installUserMessageStyle(
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

		expect(new UserMessageComponent("hello").render(80).join("\n")).toContain("[borderMuted]────");
		const prototype = UserMessageComponent.prototype as unknown as Record<string, unknown>;
		prototype.__zentuiUserMessageOriginalRender = (width: number) => [`original:${width}`];
		cleanup();
		expect(new UserMessageComponent("hello").render(80)).toEqual(["original:80"]);
	});

	it("falls back to the original user-message render when text cannot be found", () => {
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => defaultConfig,
		);
		const prototype = UserMessageComponent.prototype as unknown as Record<string, unknown>;
		prototype.__zentuiUserMessageOriginalRender = (width: number) => [`fallback:${width}`];

		const lines = UserMessageComponent.prototype.render.call({ children: [] }, 42);

		expect(lines).toEqual(["fallback:42"]);
	});

	it("preserves OSC 133 prompt-zone markers around user-message output", async () => {
		const handlers = loadExtension();
		await emit(handlers, "session_start", makeContext({ ui: makeUi() }));

		const lines = new UserMessageComponent("hello").render(40);

		expect(lines[0].startsWith("\x1b]133;A\x07")).toBe(true);
		expect(lines.at(-1)).toContain("\x1b]133;B\x07\x1b]133;C\x07");
	});

	it("keeps user-message output within the requested render width", async () => {
		const handlers = loadExtension();
		await emit(handlers, "session_start", makeContext());

		const lines = new UserMessageComponent("hello ".repeat(20)).render(12).map(stripPromptMarks);

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 12)).toBe(true);
	});

	it("refreshes user-message render state after extension reload", async () => {
		const first = loadExtension();
		await emit(first, "session_start", makeContext({ ui: makeUi("first:") }));
		const firstRender = new UserMessageComponent("hello").render(80).join("\n");
		expect(firstRender).toMatch(/\[first:accent\]│|\u001b\[34m│\u001b\[0m/);

		const second = loadExtension();
		await emit(second, "session_start", makeContext({ ui: makeUi("second:") }));
		const secondRender = new UserMessageComponent("hello").render(80).join("\n");
		expect(secondRender).not.toContain("[first:accent]│");
		expect(secondRender).toMatch(/\[second:accent\]│|\u001b\[34m│\u001b\[0m/);
	});

	it("keeps custom footer output within the requested render width", async () => {
		const handlers = loadExtension();
		let footerFactory: FooterFactory | undefined;
		const ui = {
			theme: makeTheme(),
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent() {},
		};
		const ctx = makeContext({ ui });

		await emit(handlers, "session_start", ctx);

		expect(footerFactory).toBeTypeOf("function");
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
		});
		const lines = footer?.render(1) ?? [];

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 1)).toBe(true);
		footer?.dispose?.();
		await emit(handlers, "session_shutdown", ctx);
	});

	it("does not crash when config colors contain Starship modifiers", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			ui: {
				theme: makeStrictTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.contextLabel = "1%/200k";
		state.tokenLabel = "↑1 ↓2";
		state.costLabel = "$0.001";

		installFooter(ctx as never, state, () => defaultConfig, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});

		const footer = footerFactory?.({ requestRender() {} }, makeStrictTheme(), {
			onBranchChange: () => () => {},
		});

		expect(() => footer?.render(120)).not.toThrow();
		expect(footer?.render(120).join("\n")).toContain("[muted]");
	});

	it("does not leave an extra branch gap when the git icon is empty", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.branch = "main";
		state.contextLabel = "1%/200k";
		state.tokenLabel = "↑1 ↓2";
		state.costLabel = "$0.001";
		const config: PolishedTuiConfig = {
			...defaultConfig,
			icons: { ...defaultConfig.icons, git: "" },
		};

		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});

		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
		});
		const rendered = footer?.render(120).join("\n") ?? "";

		expect(rendered).toContain("on main");
		expect(rendered).not.toContain("on  main");
	});

	it("keeps custom editor output within the requested render width", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "off",
		);

		const lines = editor.render(1);

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 1)).toBe(true);
	});

	it("renders editor rails with theme accent and borderMuted borders", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "high",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered).toContain("[borderMuted]────");
		expect(rendered).toContain("[muted]high");
		expect(rendered).toContain("[accent]│");
		expect(rendered).toContain("[accent]claude-sonnet");
		expect(rendered).toContain("[text]Anthropic");
	});

	it("keeps terminal editor chrome available when configured", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => configWithColorSources({ editor: "terminal" }),
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "high",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered).toContain("\u001b[90m────");
		expect(rendered).toContain("\u001b[34m│\u001b[0m");
		expect(rendered).toContain("\u001b[34mclaude-sonnet\u001b[0m");
		expect(rendered).toContain("[text]Anthropic");
	});

	it("renders custom editor accent, border, model, provider, and thinking colors", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() =>
				configWithColors({
					editorAccent: "warning",
					editorBorder: "error",
					editorModel: "success",
					editorProvider: "syntaxKeyword",
					editorThinking: "thinkingText",
					editorThinkingHigh: "thinkingHigh",
				}),
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "high",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered).toContain("[warning]│");
		expect(rendered).toContain("[error]────");
		expect(rendered).toContain("[success]claude-sonnet");
		expect(rendered).toContain("[syntaxKeyword]Anthropic");
		expect(rendered).toContain("[thinkingHigh]high");
	});

	it("uses the shared editorThinking color when a level-specific color is absent", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => configWithColors({ editorThinking: "thinkingText" }),
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "low",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered).toContain("[thinkingText]low");
	});

	it("applies custom editor accent and border colors to previous user messages", () => {
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() =>
				configWithColors({
					editorAccent: "warning",
					editorBorder: "error",
				}),
		);

		const rendered = new UserMessageComponent("hello").render(80).join("\n");

		expect(rendered).toContain("[warning]│");
		expect(rendered).toContain("[error]────");
	});

	it("registers the Zentui settings command", () => {
		const commands = new Map<string, unknown>();
		loadExtension({ commands });

		expect(commands.has("zentui")).toBe(true);
	});

	it("does not use interactive UI when the Zentui settings command has no UI", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		let notified = false;
		let customOpened = false;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				requestRender() {},
			},
		);

		await command?.handler("", {
			hasUI: false,
			ui: {
				notify() {
					notified = true;
				},
				custom() {
					customOpened = true;
				},
			},
		});

		expect(notified).toBe(false);
		expect(customOpened).toBe(false);
	});

	it("renders Zentui settings with mode-aware top and bottom borders", async () => {
		async function renderSettings(config: PolishedTuiConfig) {
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			let lines: string[] = [];

			registerZentuiSettingsCommand(
				{
					registerCommand(_name: string, options: unknown) {
						command = options as typeof command;
					},
				} as never,
				{
					getConfig: () => config,
					setColorSources() {},
					requestRender() {},
					settingsListTheme: {
						label: (text) => text,
						value: (text) => text,
						description: (text) => text,
						cursor: "> ",
						hint: (text) => text,
					},
				},
			);

			await command?.handler("", {
				hasUI: true,
				ui: {
					theme: makeTaggedTheme(),
					notify() {},
					async custom(factory: (...args: unknown[]) => unknown) {
						const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
							render?: (width: number) => string[];
						};
						lines = component.render?.(40) ?? [];
					},
				},
			});

			return lines;
		}

		const themeLines = await renderSettings(defaultConfig);
		expect(themeLines[0]).toContain("[borderMuted]────");
		expect(themeLines.at(-1)).toContain("[borderMuted]────");
		expect(themeLines.every((line) => visibleWidth(stripTestTags(line)) <= 40)).toBe(true);

		const terminalLines = await renderSettings(configWithColorSources({ editor: "terminal" }));
		expect(terminalLines[0]).toContain("\u001b[90m────");
		expect(terminalLines.at(-1)).toContain("\u001b[90m────");
		expect(terminalLines.every((line) => visibleWidth(stripPromptMarks(line)) <= 40)).toBe(true);
	});

	it("renders Zentui settings without using invalid theme color tokens", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await expect(
			command?.handler("", {
				hasUI: true,
				ui: {
					theme: makeStrictTheme(),
					notify() {},
					async custom(factory: (...args: unknown[]) => unknown) {
						const component = factory({ requestRender() {} }, makeStrictTheme(), {}, () => {}) as {
							render?: (width: number) => string[];
						};
						component.render?.(40);
					},
				},
			}),
		).resolves.toBeUndefined();
	});

	it("keeps the Zentui settings command open after applying a change", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const changes: Partial<PolishedTuiConfig["colorSources"]>[] = [];
		let dependencyRenderRequests = 0;
		let tuiRenderRequests = 0;
		let doneCalls = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources(patch) {
					changes.push(patch);
				},
				requestRender() {
					dependencyRenderRequests += 1;
				},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			ui: {
				theme: makeTaggedTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory(
						{
							requestRender() {
								tuiRenderRequests += 1;
							},
						},
						makeTaggedTheme(),
						{},
						() => {
							doneCalls += 1;
						},
					) as { handleInput?: (data: string) => void };
					component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
				},
			},
		});

		expect(changes).toEqual([{ editor: "terminal", userMessages: "terminal" }]);
		expect(dependencyRenderRequests).toBe(1);
		expect(tuiRenderRequests).toBe(1);
		expect(doneCalls).toBe(0);
	});

	it("shows mixed editor/message sources and cycles them together", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const changes: Partial<PolishedTuiConfig["colorSources"]>[] = [];
		let rendered = "";

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => configWithColorSources({ editor: "theme", userMessages: "terminal" }),
				setColorSources(patch) {
					changes.push(patch);
				},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			ui: {
				theme: makeTaggedTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
						render?: (width: number) => string[];
						handleInput?: (data: string) => void;
					};
					rendered = component.render?.(80).join("\n") ?? "";
					component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
				},
			},
		});

		expect(rendered).toContain("Editor + previous messages");
		expect(rendered).toContain("mixed");
		expect(changes).toEqual([{ editor: "theme", userMessages: "theme" }]);
	});
});
