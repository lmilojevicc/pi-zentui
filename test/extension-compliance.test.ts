import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	ModelSelectorComponent,
	SettingsSelectorComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultConfig,
	type ExtensionStatusPlacement,
	type PolishedTuiConfig,
} from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import zentui from "../extensions/zentui/index";
import { patchSelectorBorderStyle } from "../extensions/zentui/selector-border";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";
import { createInitialState } from "../extensions/zentui/state";
import { PolishedEditor, WrappedPolishedEditor } from "../extensions/zentui/ui";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type FooterFactory = (...args: unknown[]) => {
	render(width: number): string[];
	dispose?: () => void;
};

const originalUserMessageRender = UserMessageComponent.prototype.render;
const originalUserMessageInvalidate = UserMessageComponent.prototype.invalidate;
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
	let editorComponent: unknown;
	return {
		theme: makeTaggedTheme(prefix),
		setFooter() {},
		setEditorComponent(factory: unknown) {
			editorComponent = factory;
		},
		getEditorComponent() {
			return editorComponent;
		},
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

function configWithExtensionStatuses(
	extensionStatuses: Partial<PolishedTuiConfig["extensionStatuses"]>,
): PolishedTuiConfig {
	return {
		...defaultConfig,
		extensionStatuses: {
			...defaultConfig.extensionStatuses,
			...extensionStatuses,
			placements: {
				...defaultConfig.extensionStatuses.placements,
				...(extensionStatuses.placements ?? {}),
			},
		},
	};
}

function configWithFeatures(features: Partial<PolishedTuiConfig["features"]>): PolishedTuiConfig {
	return {
		...defaultConfig,
		features: {
			...defaultConfig.features,
			...features,
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
	let editorComponent: unknown;
	const ui = {
		theme,
		setFooter() {},
		setEditorComponent(factory: unknown) {
			editorComponent = factory;
		},
		getEditorComponent() {
			return editorComponent;
		},
	};
	const overrideUi = overrides.ui && typeof overrides.ui === "object" ? overrides.ui : undefined;
	return {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		model: { id: "claude-sonnet", provider: "anthropic", contextWindow: 200_000 },
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 }),
		ui: overrideUi ? { ...ui, ...overrideUi } : ui,
		...overrides,
		...(overrideUi ? { ui: { ...ui, ...overrideUi } } : {}),
	};
}

afterEach(() => {
	UserMessageComponent.prototype.render = originalUserMessageRender;
	UserMessageComponent.prototype.invalidate = originalUserMessageInvalidate;
	const prototype = UserMessageComponent.prototype as unknown as Record<string, unknown>;
	prototype.__zentuiUserMessageOriginalRender = undefined;
	prototype.__zentuiUserMessageOriginalInvalidate = undefined;
	prototype.__zentuiUserMessagePatched = undefined;
	prototype.__zentuiUserMessageInvalidatePatched = undefined;
	prototype.__zentuiUserMessageWrapper = undefined;
	prototype.__zentuiUserMessageInvalidateWrapper = undefined;
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

	it("does not install interactive TUI components in non-TUI UI modes", async () => {
		const handlers = loadExtension();
		let footerInstalled = false;
		let editorInstalled = false;
		const ctx = makeContext({
			mode: "rpc",
			ui: {
				theme: makeTheme(),
				setFooter() {
					footerInstalled = true;
				},
				setEditorComponent() {
					editorInstalled = true;
				},
				getEditorComponent() {
					return undefined;
				},
			},
		});

		await emit(handlers, "session_start", ctx);

		expect(footerInstalled).toBe(false);
		expect(editorInstalled).toBe(false);
	});

	it("treats missing ctx.mode as legacy TUI for older Pi runtimes", async () => {
		const handlers = loadExtension();
		let editorFactory: unknown;
		const ctx = makeContext({
			mode: undefined,
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);

		expect(editorFactory).toBeTypeOf("function");
	});

	it("does not install user-message rendering when ctx.hasUI is false", async () => {
		const handlers = loadExtension();
		const ctx = makeContext({ hasUI: false });

		await emit(handlers, "session_start", ctx);

		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
	});

	it("wraps an editor component already installed by another extension", async () => {
		const handlers = loadExtension();
		const existingEditorFactory = () => ({
			render: (width: number) => ["─".repeat(width), "base editor", "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		});
		let editorFactory: unknown = existingEditorFactory;
		let setEditorCalls = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					setEditorCalls += 1;
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);

		expect(setEditorCalls).toBe(1);
		expect(editorFactory).not.toBe(existingEditorFactory);
		expect(editorFactory).toBeTypeOf("function");
		const editor = (
			editorFactory as (...args: unknown[]) => ReturnType<typeof existingEditorFactory>
		)(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
		);
		expect(editor.render(80).join("\n")).toContain("base editor");
	});

	it("restores a wrapped editor component on shutdown", async () => {
		const handlers = loadExtension();
		const existingEditorFactory = () => ({
			render: (width: number) => ["─".repeat(width), "base editor", "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		});
		let editorFactory: unknown = existingEditorFactory;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		expect(editorFactory).not.toBe(existingEditorFactory);

		await emit(handlers, "session_shutdown", ctx);

		expect(editorFactory).toBe(existingEditorFactory);
	});

	it("refreshes a stale Zentui editor factory on extension reload instead of adopting old closures", async () => {
		const firstHandlers = loadExtension();
		let editorFactory: unknown;
		let setEditorCalls = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					setEditorCalls += 1;
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
			},
		});

		await emit(firstHandlers, "session_start", ctx);
		const firstFactory = editorFactory;

		const secondHandlers = loadExtension();
		await emit(secondHandlers, "session_start", ctx);

		expect(setEditorCalls).toBe(2);
		expect(editorFactory).not.toBe(firstFactory);
		expect(editorFactory).toBeTypeOf("function");
	});

	it("refreshes a stale wrapped Zentui editor without wrapping the old Zentui wrapper", async () => {
		const firstHandlers = loadExtension();
		let baseFactoryCalls = 0;
		const existingEditorFactory = () => {
			baseFactoryCalls += 1;
			return {
				render: (width: number) => ["─".repeat(width), "base editor", "─".repeat(width)],
				invalidate() {},
				handleInput() {},
				getText: () => "",
				setText() {},
			};
		};
		let editorFactory: unknown = existingEditorFactory;
		let setEditorCalls = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					setEditorCalls += 1;
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
			},
		});

		await emit(firstHandlers, "session_start", ctx);
		const firstWrappedFactory = editorFactory;

		const secondHandlers = loadExtension();
		await emit(secondHandlers, "session_start", ctx);

		expect(setEditorCalls).toBe(2);
		expect(editorFactory).not.toBe(firstWrappedFactory);
		expect(editorFactory).not.toBe(existingEditorFactory);
		const editor = (
			editorFactory as (...args: unknown[]) => ReturnType<typeof existingEditorFactory>
		)(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
		);
		const rendered = editor.render(80).join("\n");

		expect(baseFactoryCalls).toBe(1);
		expect(rendered).toContain("base editor");
		expect(rendered.match(/claude-sonnet/g)).toHaveLength(1);
		expect(rendered.match(/Anthropic/g)).toHaveLength(1);
	});

	it("re-wraps an editor component that loads after Zentui", async () => {
		const handlers = loadExtension();
		const laterEditorFactory = () => ({
			render: (width: number) => ["─".repeat(width), "late vim editor", "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
			getMode: () => "normal",
		});
		let editorFactory: unknown;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		const originalZentuiFactory = editorFactory;
		editorFactory = laterEditorFactory;

		await new Promise((resolve) => setTimeout(resolve, 1));

		expect(editorFactory).not.toBe(originalZentuiFactory);
		expect(editorFactory).not.toBe(laterEditorFactory);
		expect(editorFactory).toBeTypeOf("function");
		const editor = (editorFactory as (...args: unknown[]) => ReturnType<typeof laterEditorFactory>)(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
		);
		expect(editor.render(80).join("\n")).toContain("late vim editor");
		expect(editor.render(80).join("\n")).toContain("NORMAL");
	});

	it("renders user messages like the ZentUI prompt box", () => {
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

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

	it("hides previous user-message rails in copy-friendly mode", () => {
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => configWithFeatures({ copyFriendly: true }),
		);

		const lines = new UserMessageComponent("hello").render(80).map(stripPromptMarks);
		const rendered = lines.join("\n");

		expect(rendered).not.toContain("│");
		expect(rendered).not.toContain("❯");
		expect(rendered).toContain("hello");
		expect(stripTestTags(lines[0])).toMatch(/^─+$/);
		expect(stripTestTags(lines.at(-1) ?? "")).toMatch(/^─+$/);
	});

	it("renders the configured rail glyph on user messages", () => {
		const config: PolishedTuiConfig = {
			...defaultConfig,
			icons: { ...defaultConfig.icons, rail: "┃" },
		};
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => config,
		);

		const raw = new UserMessageComponent("hello").render(80).join("\n");

		expect(raw).toContain("[accent]┃");
		expect(raw).not.toContain("│");
	});

	it("caches rendered user messages across repeated renders", () => {
		const getChildren = vi.fn(() => [{ text: "hello ".repeat(2000) }]);
		const fg = vi.fn((color: string, text: string) => `[${color}]${text}`);
		const theme = { ...makeTaggedTheme(), fg } as unknown as Theme;
		installUserMessageStyle(
			() => theme,
			() => defaultConfig,
		);
		const instance = {
			get children() {
				return getChildren();
			},
		};
		const renderMessage = (width: number) =>
			UserMessageComponent.prototype.render.call(instance, width);

		const firstRender = renderMessage(80);
		const fgCallsAfterFirstRender = fg.mock.calls.length;
		const secondRender = renderMessage(80);

		expect(secondRender).toEqual(firstRender);
		expect(getChildren).toHaveBeenCalledTimes(1);
		expect(fg).toHaveBeenCalledTimes(fgCallsAfterFirstRender);

		renderMessage(79);
		expect(getChildren).toHaveBeenCalledTimes(1);
		expect(fg.mock.calls.length).toBeGreaterThan(fgCallsAfterFirstRender);
	});

	it("clears cached user-message rendering on invalidate", () => {
		let colorPrefix = "first";
		const theme = {
			...makeTaggedTheme(),
			fg(color: string, text: string) {
				return `[${colorPrefix}:${color}]${text}`;
			},
		} as unknown as Theme;
		const originalInvalidate = UserMessageComponent.prototype.invalidate;
		const invalidate = vi.fn(function invalidate(this: UserMessageComponent) {
			return originalInvalidate.call(this);
		});
		UserMessageComponent.prototype.invalidate = invalidate;
		installUserMessageStyle(
			() => theme,
			() => defaultConfig,
		);
		const message = new UserMessageComponent("hello");

		const firstRender = message.render(80).join("\n");
		colorPrefix = "second";
		const cachedRender = message.render(80).join("\n");
		message.invalidate();
		const invalidatedRender = message.render(80).join("\n");

		expect(cachedRender).toBe(firstRender);
		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(invalidatedRender).toContain("[second:userMessageText]hello");
		expect(invalidatedRender).not.toContain("[first:userMessageText]hello");
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

	it("refreshes user-message render state after extension reload", () => {
		installUserMessageStyle(
			() => makeTaggedTheme("first:"),
			() => defaultConfig,
		);
		const firstRender = new UserMessageComponent("hello").render(80).join("\n");
		expect(firstRender).toMatch(/\[first:accent\]│|\u001b\[34m│\u001b\[0m/);

		installUserMessageStyle(
			() => makeTaggedTheme("second:"),
			() => defaultConfig,
		);
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
			getExtensionStatuses: () => new Map<string, string>(),
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
			getExtensionStatuses: () => new Map<string, string>(),
		});

		expect(() => footer?.render(120)).not.toThrow();
		expect(footer?.render(120).join("\n")).toContain("[muted]");
	});

	it("renders third-party statuses on the right by default in sorted order", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeTheme(),
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

		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () =>
				new Map<string, string>([
					["zeta", "Z"],
					["alpha", "A"],
				]),
		});
		const rendered = footer?.render(160).join("\n") ?? "";

		expect(rendered.indexOf("A")).toBeLessThan(rendered.indexOf("Z"));
		expect(rendered.indexOf("Z")).toBeLessThan(rendered.indexOf("1%/200k"));
		expect(rendered).toContain("↑1 ↓2");
		expect(rendered).toContain("$0.001");
	});

	it("honors third-party status placements and hides off statuses", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeTheme(),
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
		const config = configWithExtensionStatuses({
			placements: {
				alpha: "left",
				beta: "middle",
				gamma: "right",
				hidden: "off",
			},
		});

		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});

		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () =>
				new Map<string, string>([
					["alpha", "left-status"],
					["beta", "middle-status"],
					["gamma", "right-status"],
					["hidden", "hidden-status"],
				]),
		});
		const rendered = footer?.render(180).join("\n") ?? "";

		expect(rendered).toContain("left-status");
		expect(rendered).toContain(" | left-status");
		expect(rendered).toContain("middle-status");
		expect(rendered).toContain("right-status");
		expect(rendered).not.toContain("hidden-status");
	});

	it("strips plugin ANSI and control sequences before rendering third-party statuses", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeTheme(),
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

		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () =>
				new Map<string, string>([["ansi", "\x1b[31mred\x1b[0m\nnext\tline"]]),
		});
		const rendered = footer?.render(160).join("\n") ?? "";

		expect(rendered).toContain("red next line");
		expect(rendered).not.toContain("\x1b[31m");
		expect(rendered).not.toContain("\nnext\tline");
	});

	it("styles third-party statuses with colors.extensionStatus", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeTaggedTheme(),
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

		installFooter(ctx as never, state, () => configWithColors({ extensionStatus: "warning" }), {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});

		const footer = footerFactory?.({ requestRender() {} }, makeTaggedTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>([["alpha", "ok"]]),
		});
		const rendered = footer?.render(160).join("\n") ?? "";

		expect(rendered).toContain("[warning]ok");
	});

	it("protects built-in right labels when third-party middle statuses are too wide", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/x",
			ui: {
				theme: makeTheme(),
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
		const config = configWithExtensionStatuses({ placements: { long: "middle" } });

		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});

		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () =>
				new Map<string, string>([["long", "middle-status-is-far-too-long"]]),
		});
		const line = footer?.render(44)[0] ?? "";

		expect(line).toContain("1%/200k");
		expect(line).toContain("↑1 ↓2");
		expect(line).toContain("$0.001");
		expect(visibleWidth(line)).toBeLessThanOrEqual(44);
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
			getExtensionStatuses: () => new Map<string, string>(),
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

	it("renders the package version segment when toggled on and hides it when off", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});

		const renderWithPackage = (enabled: boolean) => {
			const state = createInitialState(emptyGitStatus());
			state.runtime = {
				name: "nodejs",
				symbol: "",
				style: "bold green",
				version: "v22",
			};
			state.packageVersion = enabled ? { ecosystem: "nodejs", version: "1.2.3" } : undefined;
			state.contextLabel = "1%/200k";
			state.tokenLabel = "↑1 ↓2";
			state.costLabel = "$0.001";
			const config: PolishedTuiConfig = {
				...defaultConfig,
				footerSegments: { ...defaultConfig.footerSegments, packageVersion: enabled },
			};
			installFooter(ctx as never, state, () => config, {
				setRequestRender() {},
				scheduleProjectRefresh() {},
			});
			const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			});
			return footer?.render(200).join("\n") ?? "";
		};

		const withPackage = renderWithPackage(true);
		const withoutPackage = renderWithPackage(false);
		expect(withPackage).toContain("1.2.3");
		expect(withoutPackage).not.toContain("1.2.3");
	});

	it("does not rewrite a non-empty footerFormat when packageVersion is on", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.packageVersion = { ecosystem: "nodejs", version: "1.2.3" };
		state.contextLabel = "1%/200k";
		state.tokenLabel = "↑1 ↓2";
		state.costLabel = "$0.001";
		const config: PolishedTuiConfig = {
			...defaultConfig,
			footerSegments: { ...defaultConfig.footerSegments, packageVersion: true },
			footerFormat: "$cwd $fill $context",
		};
		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map(),
		});
		const rendered = footer?.render(200).join("\n") ?? "";
		expect(rendered).not.toContain("1.2.3");
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

	it("hides editor rails in copy-friendly mode", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => configWithFeatures({ copyFriendly: true }),
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "high",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered).not.toContain("│");
		expect(rendered).not.toContain("❯");
		expect(rendered).toContain("[borderMuted]────");
		expect(rendered).toContain("\n [accent]claude-sonnet");
		expect(rendered).toContain("[accent]claude-sonnet");
		expect(rendered).toContain("[text]Anthropic");
	});

	it("uses custom copy-friendly editor prompt icon and color", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => ({
				...defaultConfig,
				icons: { ...defaultConfig.icons, editorPrompt: "›" },
				colors: { ...defaultConfig.colors, editorPrompt: "warning" },
				features: { ...defaultConfig.features, copyFriendly: true },
			}),
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "off",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered).toContain("[warning]›");
		expect(rendered).not.toContain("❯");
		expect(rendered).not.toContain("│");
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

	it("wraps a vim editor by delegating input and rendering a mode segment", () => {
		const inputs: string[] = [];
		let text = "hello";
		let mode = "normal";
		const base = {
			render(width: number) {
				return ["─".repeat(width), text, `${"─".repeat(Math.max(0, width - 8))} NORMAL `];
			},
			invalidate() {},
			handleInput(data: string) {
				inputs.push(data);
				if (data === "i") mode = "insert";
			},
			getText() {
				return text;
			},
			setText(next: string) {
				text = next;
			},
			getMode() {
				return mode;
			},
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "off",
		);

		editor.handleInput("i");
		editor.handleInput("j");
		editor.handleInput("k");
		editor.setText("changed");
		const rendered = editor.render(120).join("\n");

		expect(inputs).toEqual(["i", "j", "k"]);
		expect(editor.getText()).toBe("changed");
		expect(rendered).toContain("changed");
		expect(rendered).toContain("[success]INSERT");
		expect(rendered).toMatch(/ {2,}\[success\]INSERT/);
		expect(rendered).toContain("[accent]claude-sonnet");
	});

	it("does not add another model line when wrapping an editor that already includes Zentui chrome", () => {
		const meta = "[accent]claude-sonnet  [text]Anthropic  [muted]medium";
		const base = {
			render: (width: number) => ["─".repeat(width), "", meta, meta, "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "medium",
		);

		const lines = editor.render(120);
		const rendered = lines.join("\n");

		expect(rendered.match(/claude-sonnet/g)).toHaveLength(1);
		expect(rendered.match(/Anthropic/g)).toHaveLength(1);
		expect(rendered.match(/medium/g)).toHaveLength(1);
		expect(lines).toHaveLength(5);
	});

	it("drops the stale leading spacer when wrapping an already-polished editor with text", () => {
		const staleMeta = "claude-sonnet  Anthropic  xhigh";
		const base = {
			render: (width: number) => [
				"─".repeat(width),
				"",
				"typed text",
				"",
				staleMeta,
				"─".repeat(width),
			],
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "xhigh",
		);

		const lines = editor.render(120);
		const textIndex = lines.findIndex((line) => line.includes("typed text"));

		expect(textIndex).toBe(2);
		expect(lines).toHaveLength(6);
		expect(stripTestTags(lines[textIndex - 2] ?? "").trim()).toMatch(/^─+$/);
		expect(stripTestTags(lines[textIndex - 1] ?? "").trim()).toBe("│");
	});

	it("preserves a user blank line after removing stale polished editor spacing", () => {
		const staleMeta = "claude-sonnet  Anthropic  xhigh";
		const base = {
			render: (width: number) => [
				"─".repeat(width),
				"",
				"",
				"typed text",
				"",
				staleMeta,
				"─".repeat(width),
			],
			invalidate() {},
			handleInput() {},
			getText: () => "\ntyped text",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "xhigh",
		);

		const lines = editor.render(120);
		const textIndex = lines.findIndex((line) => line.includes("typed text"));

		expect(textIndex).toBe(3);
		expect(lines).toHaveLength(7);
		expect(stripTestTags(lines[textIndex - 3] ?? "").trim()).toMatch(/^─+$/);
		expect(stripTestTags(lines[textIndex - 2] ?? "").trim()).toBe("│");
		expect(stripTestTags(lines[textIndex - 1] ?? "").trim()).toBe("│");
	});

	it("collapses accumulated model and vim status lines from a nested polished editor", () => {
		const staleMeta = "claude-sonnet  Anthropic  xhigh                               INSERT";
		const base = {
			render: (width: number) => [
				"─".repeat(width),
				"",
				staleMeta,
				"",
				staleMeta,
				"",
				staleMeta,
				"─".repeat(width),
			],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
			getMode: () => "insert",
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "xhigh",
		);

		const lines = editor.render(120);
		const rendered = lines.join("\n");

		expect(rendered.match(/claude-sonnet/g)).toHaveLength(1);
		expect(rendered.match(/Anthropic/g)).toHaveLength(1);
		expect(rendered.match(/xhigh/g)).toHaveLength(1);
		expect(rendered.match(/INSERT/g)).toHaveLength(1);
		expect(lines).toHaveLength(5);
	});

	it("replaces nested model lines with the current model and vim status line", () => {
		const staleMeta = "claude-sonnet  Anthropic  xhigh                               INSERT";
		const base = {
			render: () => ["not a plain border", staleMeta, "not a plain border"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
			getMode: () => "insert",
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "xhigh",
		);

		const rendered = editor.render(120).join("\n");

		expect(rendered.match(/claude-sonnet/g)).toHaveLength(1);
		expect(rendered.match(/Anthropic/g)).toHaveLength(1);
		expect(rendered.match(/xhigh/g)).toHaveLength(1);
		expect(rendered.match(/INSERT/g)).toHaveLength(1);
	});

	it("proxies mutable editor callbacks and app-action state to the wrapped editor", () => {
		const base = {
			render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		} as {
			render: (width: number) => string[];
			invalidate: () => void;
			handleInput: (data: string) => void;
			getText: () => string;
			setText: (text: string) => void;
			onSubmit?: (text: string) => void;
			onEscape?: () => void;
			actionHandlers?: Map<unknown, () => void>;
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
		);
		const onSubmit = vi.fn();
		const onEscape = vi.fn();
		const actionHandlers = new Map<unknown, () => void>();

		editor.onSubmit = onSubmit;
		editor.onEscape = onEscape;
		editor.actionHandlers = actionHandlers;

		expect(base.onSubmit).toBe(onSubmit);
		expect(base.onEscape).toBe(onEscape);
		expect(base.actionHandlers).toBe(actionHandlers);
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
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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

	it("does not open interactive Zentui settings outside TUI mode", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
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
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				requestRender() {},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "rpc",
			ui: {
				notify() {},
				custom() {
					customOpened = true;
				},
			},
		});

		expect(customOpened).toBe(false);
	});

	it("toggles the editor from direct Zentui slash-command arguments", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const featureChanges: Partial<PolishedTuiConfig["features"]>[] = [];
		const notifications: Array<{ message: string; level: string }> = [];
		let renderRequests = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures(patch) {
					featureChanges.push(patch);
					return { applied: true };
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				requestRender() {
					renderRequests += 1;
				},
			},
		);

		await command?.handler("editor disable", {
			hasUI: true,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		});

		expect(featureChanges).toEqual([{ editor: false }]);
		expect(renderRequests).toBe(1);
		expect(notifications).toEqual([{ message: "Editor: disabled", level: "info" }]);
	});

	it("toggles the status line from direct Zentui slash-command arguments", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const featureChanges: Partial<PolishedTuiConfig["features"]>[] = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures(patch) {
					featureChanges.push(patch);
					return { applied: true };
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				requestRender() {},
			},
		);

		await command?.handler("status line off", { hasUI: false });

		expect(featureChanges).toEqual([{ statusLine: false }]);
	});

	it("toggles copy-friendly mode from direct Zentui slash-command arguments", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const featureChanges: Partial<PolishedTuiConfig["features"]>[] = [];
		const notifications: Array<{ message: string; level: string }> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures(patch) {
					featureChanges.push(patch);
					return { applied: true };
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				requestRender() {},
			},
		);

		await command?.handler("copy-friendly enable", {
			hasUI: true,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		});

		expect(featureChanges).toEqual([{ copyFriendly: true }]);
		expect(notifications).toEqual([{ message: "Copy-friendly mode: enabled", level: "info" }]);
	});

	it("shows when an editor toggle needs reload because another extension owns the editor", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const notifications: Array<{ message: string; level: string }> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({
					applied: false,
					reason:
						"another extension is currently managing the editor; reload Pi to apply this change",
				}),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				requestRender() {},
			},
		);

		await command?.handler("editor disable", {
			hasUI: true,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		});

		expect(notifications).toEqual([
			{
				message:
					"Editor: disabled (another extension is currently managing the editor; reload Pi to apply this change)",
				level: "info",
			},
		]);
	});

	it("closes the Zentui settings UI before applying an editor feature change", async () => {
		vi.useFakeTimers();
		try {
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			let doneCalls = 0;
			const doneCallsAtFeatureChange: number[] = [];

			registerZentuiSettingsCommand(
				{
					registerCommand(_name: string, options: unknown) {
						command = options as typeof command;
					},
				} as never,
				{
					getConfig: () => defaultConfig,
					setColorSources() {},
					setUiFeatures() {
						doneCallsAtFeatureChange.push(doneCalls);
						return { applied: true };
					},
					setFooterSegments() {},
					setFooterFormat() {},
					setIconMode() {},
					setContextStyle() {},
					setPathDisplay() {},
					getActiveExtensionStatuses: () => new Map<string, string>(),
					setExtensionStatusPlacement() {},
					setExtensionStatusColorMode() {},
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
				mode: "tui",
				ui: {
					theme: makeTaggedTheme(),
					notify() {},
					async custom(factory: (...args: unknown[]) => unknown) {
						const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {
							doneCalls += 1;
						}) as { handleInput?: (data: string) => void };
						component.handleInput?.("\t");
						component.handleInput?.(" ");
					},
				},
			});

			expect(doneCalls).toBe(1);
			expect(doneCallsAtFeatureChange).toEqual([]);

			vi.runAllTimers();

			expect(doneCallsAtFeatureChange).toEqual([1]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders Zentui settings with mode-aware top and bottom borders", async () => {
		const settingsWidth = 160;
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
					setUiFeatures: () => ({ applied: true }),
					setFooterSegments() {},
					setFooterFormat() {},
					setIconMode() {},
					setContextStyle() {},
					setPathDisplay() {},
					getActiveExtensionStatuses: () => new Map<string, string>(),
					setExtensionStatusPlacement() {},
					setExtensionStatusColorMode() {},
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
				mode: "tui",
				ui: {
					theme: makeTaggedTheme(),
					notify() {},
					async custom(factory: (...args: unknown[]) => unknown) {
						const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
							render?: (width: number) => string[];
						};
						lines = component.render?.(settingsWidth) ?? [];
					},
				},
			});

			return lines;
		}

		const themeLines = await renderSettings(defaultConfig);
		expect(themeLines[0]).toContain("[borderMuted]────");
		expect(themeLines.join("\n")).toContain("Coloring");
		expect(themeLines.join("\n")).toContain("Features");
		expect(themeLines.join("\n")).toContain("Layout");
		expect(themeLines.join("\n")).toContain("Built-in segments");
		expect(themeLines.join("\n")).toContain("Extension segments");
		expect(themeLines.join("\n")).toContain("Tab/Shift+Tab to switch sections");
		expect(themeLines.at(-1)).toContain("[borderMuted]────");
		expect(themeLines.every((line) => visibleWidth(stripTestTags(line)) <= settingsWidth)).toBe(
			true,
		);

		const terminalLines = await renderSettings(configWithColorSources({ editor: "terminal" }));
		expect(terminalLines[0]).toContain("\u001b[90m────");
		expect(terminalLines.at(-1)).toContain("\u001b[90m────");
		expect(
			terminalLines.every((line) => visibleWidth(stripPromptMarks(line)) <= settingsWidth),
		).toBe(true);
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
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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
				mode: "tui",
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
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
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
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
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

	function navigateToExtensionSegmentsSection(component: { handleInput?: (data: string) => void }) {
		// Coloring → Features → Layout → Built-in segments → Extension segments
		component.handleInput?.("\t");
		component.handleInput?.("\t");
		component.handleInput?.("\t");
		component.handleInput?.("\t");
	}

	it("cycles extension segments tabs backward with shift+tab", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		let rendered = "";

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
			ui: {
				theme: makeTaggedTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
						render?: (width: number) => string[];
						handleInput?: (data: string) => void;
					};
					navigateToExtensionSegmentsSection(component);
					component.handleInput?.("\x1b[Z");
					rendered = component.render?.(120).join("\n") ?? "";
				},
			},
		});

		expect(rendered).toContain("Current directory");
		expect(rendered).not.toContain("No active statuses");
	});

	it("renders active third-party statuses in the extension segments tab", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		let rendered = "";

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () =>
					new Map<string, string>([
						["alpha", "A"],
						["beta", "B"],
					]),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
			ui: {
				theme: makeTaggedTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
						render?: (width: number) => string[];
						handleInput?: (data: string) => void;
					};
					navigateToExtensionSegmentsSection(component);
					rendered = component.render?.(80).join("\n") ?? "";
				},
			},
		});

		expect(rendered).toContain("alpha");
		expect(rendered).toContain("beta");
		expect(rendered).toContain("right");
	});

	it("shows a read-only empty extension segments tab", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		let rendered = "";
		const placements: Array<{ key: string; placement: ExtensionStatusPlacement }> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement(key, placement) {
					placements.push({ key, placement });
				},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
			ui: {
				theme: makeTaggedTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
						render?: (width: number) => string[];
						handleInput?: (data: string) => void;
					};
					navigateToExtensionSegmentsSection(component);
					rendered = component.render?.(120).join("\n") ?? "";
					component.handleInput?.("\x1b");
				},
			},
		});

		expect(rendered).toContain("No active statuses");
		expect(rendered).toContain("ctx.ui.setStatus()");
		expect(placements).toEqual([]);
	});

	it("cycles active third-party status placement from the extension segments tab", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const placements: Array<{ key: string; placement: ExtensionStatusPlacement }> = [];
		let dependencyRenderRequests = 0;
		let tuiRenderRequests = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>([["alpha", "ok"]]),
				setExtensionStatusPlacement(key, placement) {
					placements.push({ key, placement });
				},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
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
						() => {},
					) as { handleInput?: (data: string) => void };
					navigateToExtensionSegmentsSection(component);
					component.handleInput?.(" ");
				},
			},
		});

		expect(placements).toEqual([{ key: "alpha", placement: "off" }]);
		expect(dependencyRenderRequests).toBe(1);
		expect(tuiRenderRequests).toBe(5);
	});

	it("does not show inactive saved placements in the extension segments tab", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		let rendered = "";

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				getConfig: () =>
					configWithExtensionStatuses({
						placements: { active: "middle", inactive: "left" },
					}),
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				getActiveExtensionStatuses: () => new Map<string, string>([["active", "ok"]]),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
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
			mode: "tui",
			ui: {
				theme: makeTaggedTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
						render?: (width: number) => string[];
						handleInput?: (data: string) => void;
					};
					navigateToExtensionSegmentsSection(component);
					rendered = component.render?.(80).join("\n") ?? "";
				},
			},
		});

		expect(rendered).toContain("active");
		expect(rendered).toContain("middle");
		expect(rendered).not.toContain("inactive");
	});
});
