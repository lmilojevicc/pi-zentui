import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	initTheme,
	ModelSelectorComponent,
	SettingsSelectorComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultConfig,
	type ExtensionStatusPlacement,
	type PolishedTuiConfig,
	type SeparatorStyle,
} from "../extensions/zentui/config";
import { installFooter as installFooterProduction } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import zentui, { activeFooterReferences } from "../extensions/zentui/index";
import { ZENTUI_PROTOTYPE_PATCH_REGISTRY } from "../extensions/zentui/prototype-patch-registry";
import {
	installSelectorBorderStyle as installSelectorBorderStyleProduction,
	patchSelectorBorderStyle as patchSelectorBorderStyleProduction,
} from "../extensions/zentui/selector-border";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";
import { createInitialState } from "../extensions/zentui/state";
import {
	PolishedEditor as PolishedEditorProduction,
	WrappedPolishedEditor as WrappedPolishedEditorProduction,
} from "../extensions/zentui/ui";
import { installUserMessageStyle as installUserMessageStyleProduction } from "../extensions/zentui/user-message";

const isolatedAgentDir = vi.hoisted(() => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	const path = `/tmp/pi-zentui-extension-compliance-${process.pid}`;
	const fs = process.getBuiltinModule("node:fs");
	fs.rmSync(path, { recursive: true, force: true });
	fs.mkdirSync(path, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = path;
	return { path, previous };
});

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type FooterFactory = (...args: unknown[]) => {
	render(width: number): string[];
	dispose?: () => void;
};

const originalUserMessageRender = UserMessageComponent.prototype.render;
const originalUserMessageInvalidate = UserMessageComponent.prototype.invalidate;
const originalModelSelectorRender = ModelSelectorComponent.prototype.render;
const originalSettingsSelectorRender = SettingsSelectorComponent.prototype.render;
const inactiveSessionLifecycle = new SessionLifecycle();

function canonicalizeTestConfig(config: PolishedTuiConfig): PolishedTuiConfig {
	const editor = config.components.editor;
	const messages = config.components.userMessages;
	const selectors = config.components.selectorBorders;
	const footer = config.components.footer;
	const starship = footer.styles.starship;
	const flatChanged = <K extends keyof PolishedTuiConfig>(key: K) =>
		config[key] !== defaultConfig[key];
	return {
		...config,
		components: {
			editor: {
				...editor,
				enabled: flatChanged("features") ? config.features.editor : editor.enabled,
				style: flatChanged("editorStyle") ? config.editorStyle : editor.style,
				colorSource: flatChanged("colorSources") ? config.colorSources.editor : editor.colorSource,
				borderColorMode: flatChanged("editorBorderColorMode")
					? config.editorBorderColorMode
					: editor.borderColorMode,
				modelLabel: flatChanged("editorModelLabel") ? config.editorModelLabel : editor.modelLabel,
				viewportIndicators: flatChanged("features")
					? config.features.viewportIndicators
					: editor.viewportIndicators,
				styles: {
					...editor.styles,
					opencode: {
						...editor.styles.opencode,
						metadataFormat: flatChanged("editorMetadataFormat")
							? config.editorMetadataFormat
							: editor.styles.opencode.metadataFormat,
					},
					minimalist: flatChanged("editorStyles")
						? { ...editor.styles.minimalist, ...config.editorStyles.minimalist }
						: editor.styles.minimalist,
				},
			},
			userMessages: {
				...messages,
				enabled: flatChanged("features") ? config.features.editor : messages.enabled,
				colorSource: flatChanged("colorSources")
					? config.colorSources.userMessages
					: messages.colorSource,
				styles: { ...messages.styles },
			},
			selectorBorders: {
				...selectors,
				enabled: flatChanged("features") ? config.features.editor : selectors.enabled,
				colorSource: flatChanged("colorSources")
					? config.colorSources.editor
					: selectors.colorSource,
			},
			footer: {
				...footer,
				style: flatChanged("features")
					? config.features.statusLine
						? "starship"
						: "native"
					: footer.style,
				colorSource: flatChanged("colorSources")
					? config.colorSources.starship
					: footer.colorSource,
				modelLabel: flatChanged("editorModelLabel") ? config.editorModelLabel : footer.modelLabel,
				styles: {
					starship: {
						...starship,
						format: flatChanged("footerFormat") ? config.footerFormat : starship.format,
						responsive: flatChanged("responsiveFooter")
							? config.responsiveFooter
							: starship.responsive,
						compactFormat: flatChanged("compactFooterFormat")
							? config.compactFooterFormat
							: starship.compactFormat,
						compactMaxLines: flatChanged("compactFooterMaxLines")
							? config.compactFooterMaxLines
							: starship.compactMaxLines,
						separator: flatChanged("separator") ? config.separator : starship.separator,
						contextStyle: flatChanged("contextStyle") ? config.contextStyle : starship.contextStyle,
						contextThresholds: flatChanged("contextThresholds")
							? config.contextThresholds
							: starship.contextThresholds,
						pathDisplay: flatChanged("pathDisplay") ? config.pathDisplay : starship.pathDisplay,
						segments: flatChanged("footerSegments") ? config.footerSegments : starship.segments,
						gitBranch: flatChanged("gitBranch") ? config.gitBranch : starship.gitBranch,
						gitCommit: flatChanged("gitCommit") ? config.gitCommit : starship.gitCommit,
						gitMetrics: flatChanged("gitMetrics") ? config.gitMetrics : starship.gitMetrics,
						extensionStatuses: flatChanged("extensionStatuses")
							? config.extensionStatuses
							: starship.extensionStatuses,
					},
				},
			},
		},
		layout: {
			...config.layout,
			fixedEditor: flatChanged("fixedEditor") ? config.fixedEditor : config.layout.fixedEditor,
		},
	};
}

function installFooter(...args: Parameters<typeof installFooterProduction>) {
	const getConfig = args[2];
	return installFooterProduction(
		args[0],
		args[1],
		() => canonicalizeTestConfig(getConfig() as PolishedTuiConfig),
		args[3],
	);
}

function installUserMessageStyle(...args: Parameters<typeof installUserMessageStyleProduction>) {
	return installUserMessageStyleProduction(args[0], () =>
		canonicalizeTestConfig(args[1]() as PolishedTuiConfig),
	);
}

function installSelectorBorderStyle(
	...args: Parameters<typeof installSelectorBorderStyleProduction>
) {
	return installSelectorBorderStyleProduction(
		args[0],
		args[1]
			? () => canonicalizeTestConfig((args[1]?.() ?? defaultConfig) as PolishedTuiConfig)
			: undefined,
	);
}

function patchSelectorBorderStyle(...args: Parameters<typeof patchSelectorBorderStyleProduction>) {
	return patchSelectorBorderStyleProduction(
		args[0],
		args[1],
		args[2]
			? () => canonicalizeTestConfig((args[2]?.() ?? defaultConfig) as PolishedTuiConfig)
			: undefined,
	);
}

class PolishedEditor extends PolishedEditorProduction {
	constructor(...args: ConstructorParameters<typeof PolishedEditorProduction>) {
		const getConfig = args[4];
		super(
			args[0],
			args[1],
			args[2],
			args[3],
			() => canonicalizeTestConfig(getConfig() as PolishedTuiConfig),
			args[5],
			args[6],
			args[7],
			args[8],
		);
	}
}

class WrappedPolishedEditor extends WrappedPolishedEditorProduction {
	constructor(...args: ConstructorParameters<typeof WrappedPolishedEditorProduction>) {
		const getConfig = args[2];
		super(
			args[0],
			args[1],
			() => canonicalizeTestConfig(getConfig() as PolishedTuiConfig),
			args[3],
			args[4],
			args[5],
			args[6],
		);
	}
}

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

function _makeUi(prefix = "") {
	let editorComponent: unknown;
	let editorText = "";
	return {
		theme: makeTaggedTheme(prefix),
		setFooter() {},
		getEditorText() {
			return editorText;
		},
		setEditorText(text: string) {
			editorText = text;
		},
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
	const merged = { ...defaultConfig.colorSources, ...colorSources };
	return {
		...defaultConfig,
		colorSources: merged,
		components: {
			...defaultConfig.components,
			editor: { ...defaultConfig.components.editor, colorSource: merged.editor },
			selectorBorders: {
				...defaultConfig.components.selectorBorders,
				colorSource: merged.editor,
			},
			userMessages: {
				...defaultConfig.components.userMessages,
				colorSource: merged.userMessages,
			},
			footer: { ...defaultConfig.components.footer, colorSource: merged.starship },
		},
	};
}

function configWithColors(
	colors: Partial<PolishedTuiConfig["colors"]>,
	colorSources: Partial<PolishedTuiConfig["colorSources"]> = {},
): PolishedTuiConfig {
	return {
		...configWithColorSources(colorSources),
		colors: {
			...defaultConfig.colors,
			...colors,
		},
	};
}

function configWithExtensionStatuses(
	extensionStatuses: Partial<PolishedTuiConfig["extensionStatuses"]>,
): PolishedTuiConfig {
	const merged = {
		...defaultConfig.extensionStatuses,
		...extensionStatuses,
		placements: {
			...defaultConfig.extensionStatuses.placements,
			...(extensionStatuses.placements ?? {}),
		},
	};
	const footer = defaultConfig.components.footer;
	return {
		...defaultConfig,
		extensionStatuses: merged,
		components: {
			...defaultConfig.components,
			footer: {
				...footer,
				styles: { starship: { ...footer.styles.starship, extensionStatuses: merged } },
			},
		},
	};
}

function configWithLowRailStyle(lowRail: boolean): PolishedTuiConfig {
	return {
		...defaultConfig,
		components: {
			...defaultConfig.components,
			editor: {
				...defaultConfig.components.editor,
				style: lowRail ? "opencode-copy-friendly" : "opencode",
			},
		},
	};
}

function stripPromptMarks(line: string): string {
	return line.replaceAll(/\x1b]133;[ABC]\x07/g, "").replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function expectSinglePromptZone(rendered: string): void {
	expect(rendered.match(/\x1b\]133;A\x07/g)).toHaveLength(1);
	expect(rendered.match(/\x1b\]133;B\x07/g)).toHaveLength(1);
	expect(rendered.match(/\x1b\]133;C\x07/g)).toHaveLength(1);
	expect(rendered).not.toContain("\x9d133;");
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
	let editorText = "";
	const ui = {
		theme,
		setFooter() {},
		getEditorText() {
			return editorText;
		},
		setEditorText(text: string) {
			editorText = text;
		},
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
		sessionManager: { getBranch: () => [], getSessionName: () => undefined },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 }),
		ui: overrideUi ? { ...ui, ...overrideUi } : ui,
		...overrides,
		...(overrideUi ? { ui: { ...ui, ...overrideUi } } : {}),
	};
}

afterAll(() => {
	rmSync(isolatedAgentDir.path, { recursive: true, force: true });
	if (isolatedAgentDir.previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = isolatedAgentDir.previous;
});

afterEach(() => {
	rmSync(join(isolatedAgentDir.path, "zentui.json"), { force: true });
	UserMessageComponent.prototype.render = originalUserMessageRender;
	UserMessageComponent.prototype.invalidate = originalUserMessageInvalidate;
	delete (UserMessageComponent.prototype as unknown as Record<PropertyKey, unknown>)[
		ZENTUI_PROTOTYPE_PATCH_REGISTRY
	];

	ModelSelectorComponent.prototype.render = originalModelSelectorRender;
	SettingsSelectorComponent.prototype.render = originalSettingsSelectorRender;
	for (const selectorPrototype of [
		ModelSelectorComponent.prototype,
		SettingsSelectorComponent.prototype,
	]) {
		delete (selectorPrototype as unknown as Record<PropertyKey, unknown>)[
			ZENTUI_PROTOTYPE_PATCH_REGISTRY
		];
	}
});

describe("Pi docs compliance", () => {
	it("derives lazy data requirements from only the active wide and compact candidates", () => {
		const starship = defaultConfig.components.footer.styles.starship;
		const customWide = {
			...defaultConfig,
			components: {
				...defaultConfig.components,
				footer: {
					...defaultConfig.components.footer,
					styles: {
						starship: {
							...starship,
							format: "$cwd",
							compactFormat: "$package $git_tag $git_metrics $time",
							segments: { ...starship.segments, packageVersion: true, gitCommit: true },
						},
					},
				},
			},
		};
		expect(activeFooterReferences(customWide)).toEqual(
			new Set(["cwd", "package", "git_tag", "git_metrics", "time"]),
		);
		expect(
			activeFooterReferences({
				...customWide,
				components: {
					...customWide.components,
					footer: {
						...customWide.components.footer,
						styles: {
							starship: {
								...customWide.components.footer.styles.starship,
								responsive: false,
							},
						},
					},
				},
			}),
		).toEqual(new Set(["cwd"]));
	});
	it("installs message and selector surfaces while the editor is canonically disabled", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: {
					editor: { enabled: false },
					userMessages: { enabled: true },
					selectorBorders: { enabled: true },
					footer: { enabled: false },
				},
			}),
		);
		const handlers = loadExtension();
		const existingFactory = () => ({ render: () => ["native"] });
		let editorFactory: unknown = existingFactory;
		let footerFactory: unknown = "untouched";
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					footerFactory = factory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		expect(editorFactory).toBe(existingFactory);
		expect(footerFactory).toBe("untouched");
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
		await emit(handlers, "session_shutdown", ctx);
	});

	it("installs only the editor and footer when message and selector surfaces are disabled", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: {
					editor: { enabled: true },
					userMessages: { enabled: false },
					selectorBorders: { enabled: false },
					footer: { enabled: true },
				},
			}),
		);
		const handlers = loadExtension();
		let editorFactory: unknown;
		let footerFactory: unknown;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					footerFactory = factory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		expect(editorFactory).toBeTypeOf("function");
		expect(footerFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).toBe(originalModelSelectorRender);
		await emit(handlers, "session_shutdown", ctx);
	});

	it("reconciles footer and fixed layout independently of all chrome surfaces", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: {
					editor: { enabled: false },
					userMessages: { enabled: false },
					selectorBorders: { enabled: false },
					footer: { enabled: true },
				},
				layout: { fixedEditor: { enabled: true } },
			}),
		);
		const handlers = loadExtension();
		const existingFactory = () => ({ render: () => ["native"] });
		let editorFactory: unknown = existingFactory;
		let footerFactory: unknown;
		let probeFactory: unknown;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					footerFactory = factory;
				},
				setWidget(key: string, factory: unknown) {
					if (key === "zentui-fixed-editor-probe") probeFactory = factory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		expect(editorFactory).toBe(existingFactory);
		expect(footerFactory).toBeTypeOf("function");
		expect(probeFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).toBe(originalModelSelectorRender);
		await emit(handlers, "session_shutdown", ctx);
		expect(probeFactory).toBeUndefined();
	});

	it("keeps every surface active when fixed-layout compatibility inspection fails", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({ layout: { fixedEditor: { enabled: true } } }),
		);
		const handlers = loadExtension();
		let editorFactory: unknown;
		let footerFactory: unknown;
		let probeFactory: ((tui: unknown) => { render(): string[] }) | undefined;
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					footerFactory = factory;
				},
				setWidget(key: string, factory: unknown) {
					if (key === "zentui-fixed-editor-probe") {
						probeFactory =
							typeof factory === "function" ? (factory as typeof probeFactory) : undefined;
					}
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		const tui = new Proxy(
			{
				terminal: { columns: 80, rows: 24, write() {} },
				render: () => [],
				doRender() {},
				addInputListener: () => () => {},
				removeInputListener() {},
			},
			{
				get(target, property, receiver) {
					if (property === "children") throw new Error("private shape changed");
					return Reflect.get(target, property, receiver);
				},
			},
		);
		probeFactory?.(tui).render();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(warning).toHaveBeenCalledTimes(1);
		expect(editorFactory).toBeTypeOf("function");
		expect(footerFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
		await emit(handlers, "session_shutdown", ctx);
	});

	it("removes the fixed-layout probe and other surfaces when disposal cleanup throws", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({ layout: { fixedEditor: { enabled: true } } }),
		);
		const handlers = loadExtension();
		const existingFactory = () => ({
			render: () => ["native"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		});
		let editorFactory: unknown = existingFactory;
		let footerFactory: unknown;
		let throwCopyNoticeCleanup = false;
		let probeRemovals = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				getEditorText: () => "",
				setEditorText() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					footerFactory = factory;
				},
				setWidget(key: string, factory: unknown) {
					if (key === "zentui-copy-notice" && factory === undefined && throwCopyNoticeCleanup) {
						throw new Error("copy notice cleanup failed");
					}
					if (key === "zentui-fixed-editor-probe" && factory === undefined) probeRemovals += 1;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		expect(editorFactory).not.toBe(existingFactory);
		expect(footerFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		const removalsBeforeShutdown = probeRemovals;
		throwCopyNoticeCleanup = true;

		await expect(emit(handlers, "session_shutdown", ctx)).resolves.toBeUndefined();
		expect(probeRemovals).toBe(removalsBeforeShutdown + 1);
		expect(editorFactory).toBe(existingFactory);
		expect(footerFactory).toBeUndefined();
		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).toBe(originalModelSelectorRender);
	});

	it("isolates footer installation failure from editor and prototype surfaces", async () => {
		const handlers = loadExtension();
		let editorFactory: unknown;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					if (factory) throw new Error("footer unavailable");
				},
			},
		});

		await expect(emit(handlers, "session_start", ctx)).resolves.toBeUndefined();
		expect(editorFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
		await emit(handlers, "session_shutdown", ctx);
	});

	it("isolates selector installation failure from editor, messages, and footer", async () => {
		const settingsPrototype = SettingsSelectorComponent.prototype as unknown as {
			render: typeof originalSettingsSelectorRender | undefined;
		};
		settingsPrototype.render = undefined;
		try {
			const handlers = loadExtension();
			let editorFactory: unknown;
			let footerFactory: unknown;
			const ctx = makeContext({
				ui: {
					theme: makeTheme(),
					setEditorComponent(factory: unknown) {
						editorFactory = factory;
					},
					getEditorComponent: () => editorFactory,
					setFooter(factory: unknown) {
						footerFactory = factory;
					},
				},
			});

			await emit(handlers, "session_start", ctx);
			expect(editorFactory).toBeTypeOf("function");
			expect(footerFactory).toBeTypeOf("function");
			expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
			expect(ModelSelectorComponent.prototype.render).toBe(originalModelSelectorRender);
			await emit(handlers, "session_shutdown", ctx);
		} finally {
			settingsPrototype.render = originalSettingsSelectorRender;
		}
	});

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

	it("expands collapsed paste content across install, reload, toggle, and cleanup replacements", async () => {
		const firstHandlers = loadExtension();
		const marker = "[paste #1 +12 lines]";
		const expanded = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
		let editorFactory: unknown;
		let editorText = marker;
		const transferred: string[] = [];
		const operations: string[] = [];
		const patchPresenceDuringReplacements: boolean[] = [];
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				getEditorText() {
					operations.push("getEditorText");
					return editorText === marker ? expanded : editorText;
				},
				setEditorText(text: string) {
					operations.push("setEditorText");
					editorText = text;
				},
				setEditorComponent(factory: unknown) {
					operations.push("setEditorComponent");
					patchPresenceDuringReplacements.push(
						UserMessageComponent.prototype.render !== originalUserMessageRender ||
							ModelSelectorComponent.prototype.render !== originalModelSelectorRender,
					);
					transferred.push(editorText);
					editorFactory = factory;
				},
				getEditorComponent() {
					return editorFactory;
				},
				notify() {},
			},
		});

		await emit(firstHandlers, "session_start", ctx);
		expect(patchPresenceDuringReplacements).toEqual([false]);
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
		await new Promise((resolve) => setTimeout(resolve, 1));

		editorText = marker;
		const commands = new Map<string, unknown>();
		const reloadedHandlers = loadExtension({ commands });
		await emit(reloadedHandlers, "session_start", ctx);
		await new Promise((resolve) => setTimeout(resolve, 1));
		const command = commands.get("zentui") as {
			handler(args: string, ctx: unknown): Promise<void>;
		};

		editorText = marker;
		await command.handler("editor disable", ctx);
		editorText = marker;
		await command.handler("editor enable", ctx);
		editorText = marker;
		await emit(reloadedHandlers, "session_shutdown", ctx);

		expect(operations).toEqual(
			Array.from({ length: 5 }, () => [
				"getEditorText",
				"setEditorText",
				"setEditorComponent",
			]).flat(),
		);
		expect(transferred).toEqual(Array.from({ length: 5 }, () => expanded));
		expect(transferred).not.toContain(marker);
		expect(patchPresenceDuringReplacements).toEqual([false, false, true, true, true]);
	});

	it("keeps the active factory when expanded editor text cannot be read", async () => {
		const commands = new Map<string, unknown>();
		const handlers = loadExtension({ commands });
		const existingFactory = () => ({
			render: () => ["third-party"],
			invalidate() {},
			handleInput() {},
			getText: () => "draft",
			setText() {},
		});
		const editorFactory: unknown = existingFactory;
		let footerFactory: unknown;
		let setEditorCalls = 0;
		const notifications: string[] = [];
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter(factory: unknown) {
					footerFactory = factory;
				},
				getEditorText() {
					throw new Error("unavailable");
				},
				setEditorText() {},
				setEditorComponent() {
					setEditorCalls += 1;
				},
				getEditorComponent() {
					return editorFactory;
				},
				notify(message: string) {
					notifications.push(message);
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		const command = commands.get("zentui") as {
			handler(args: string, ctx: unknown): Promise<void>;
		};
		await command.handler("editor enable", ctx);

		expect(setEditorCalls).toBe(0);
		expect(editorFactory).toBe(existingFactory);
		expect(footerFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
		expect(notifications.at(-1)).toContain("expanded editor text could not be read safely");
	});

	it("isolates user-message patch failure from editor and selector activation", async () => {
		const handlers = loadExtension();
		let editorFactory: unknown;
		let setEditorCalls = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				getEditorText: () => "draft",
				setEditorText() {},
				setEditorComponent(factory: unknown) {
					setEditorCalls += 1;
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
			},
		});
		const userPrototype = UserMessageComponent.prototype as unknown as {
			render: typeof originalUserMessageRender | undefined;
		};
		userPrototype.render = undefined;
		try {
			await emit(handlers, "session_start", ctx);
			expect(editorFactory).toBeTypeOf("function");
			expect(setEditorCalls).toBe(1);
			expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
			expect(SettingsSelectorComponent.prototype.render).not.toBe(originalSettingsSelectorRender);
			expect(UserMessageComponent.prototype.invalidate).toBe(originalUserMessageInvalidate);
			expect(
				(UserMessageComponent.prototype as unknown as Record<PropertyKey, unknown>)[
					ZENTUI_PROTOTYPE_PATCH_REGISTRY
				],
			).toBeUndefined();
			await emit(handlers, "session_shutdown", ctx);
		} finally {
			userPrototype.render = originalUserMessageRender;
		}
	});

	it("tracks the active Zentui factory after nested patch-rollback failure", async () => {
		const commands = new Map<string, unknown>();
		const handlers = loadExtension({ commands });
		const existingFactory = () => ({
			render: () => ["existing"],
			invalidate() {},
			handleInput() {},
			getText: () => "draft",
			setText() {},
		});
		let editorFactory: unknown = existingFactory;
		const assignedFactories: unknown[] = [];
		let failedPreviousFactoryRestore = false;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				getEditorText: () => "draft",
				setEditorText() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
					assignedFactories.push(factory);
					if (factory === existingFactory && !failedPreviousFactoryRestore) {
						failedPreviousFactoryRestore = true;
						throw new Error("previous factory construction failed after assignment");
					}
				},
				getEditorComponent: () => editorFactory,
				notify() {},
			},
		});
		const userPrototype = UserMessageComponent.prototype as unknown as {
			render: typeof originalUserMessageRender | undefined;
		};
		userPrototype.render = undefined;
		try {
			await emit(handlers, "session_start", ctx);
			expect(editorFactory).toBeTypeOf("function");
			expect(editorFactory).not.toBe(existingFactory);
			expect(assignedFactories).toHaveLength(1);
			userPrototype.render = originalUserMessageRender;

			const command = commands.get("zentui") as {
				handler(args: string, ctx: unknown): Promise<void>;
			};
			await command.handler("editor disable", ctx);
			expect(editorFactory).not.toBe(existingFactory);
			expect(assignedFactories).toHaveLength(3);
			await emit(handlers, "session_shutdown", ctx);
			expect(editorFactory).toBe(existingFactory);
			expect(assignedFactories).toHaveLength(4);
		} finally {
			userPrototype.render = originalUserMessageRender;
		}
	});

	it("retains shutdown ownership when restoration fails and rollback leaves Zentui active", async () => {
		const commands = new Map<string, unknown>();
		const handlers = loadExtension({ commands });
		let editorFactory: unknown;
		const assignedFactories: unknown[] = [];
		let failNextDefaultRestore = false;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				getEditorText: () => "draft",
				setEditorText() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
					assignedFactories.push(factory);
					if (factory === undefined && failNextDefaultRestore) {
						failNextDefaultRestore = false;
						throw new Error("default restoration failed after assignment");
					}
				},
				getEditorComponent: () => editorFactory,
				notify() {},
			},
		});

		await emit(handlers, "session_start", ctx);
		const zentuiFactory = editorFactory;
		expect(zentuiFactory).toBeTypeOf("function");
		failNextDefaultRestore = true;
		await emit(handlers, "session_shutdown", ctx);
		expect(editorFactory).toBe(zentuiFactory);
		expect(assignedFactories).toHaveLength(3);

		const command = commands.get("zentui") as {
			handler(args: string, ctx: unknown): Promise<void>;
		};
		await command.handler("editor disable", ctx);
		expect(editorFactory).toBeUndefined();
		expect(assignedFactories).toHaveLength(4);
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
		expect(editorFactory).not.toBe(existingEditorFactory);

		await emit(handlers, "session_shutdown", ctx);
		await emit(handlers, "session_shutdown", ctx);

		expect(editorFactory).toBe(existingEditorFactory);
		expect(setEditorCalls).toBe(2);
	});

	it("cleans up when start and shutdown use distinct context wrappers", async () => {
		const handlers = loadExtension();
		const runner = {
			editorFactory: undefined as unknown,
			setEditorCalls: 0,
			footerClears: 0,
		};
		let startContextStale = false;
		const makeUiWrapper = (isStale: () => boolean) => ({
			theme: makeTheme(),
			setFooter(factory: unknown) {
				if (isStale()) throw new Error("stale start ctx setFooter");
				if (factory === undefined) runner.footerClears += 1;
			},
			setEditorComponent(factory: unknown) {
				if (isStale()) throw new Error("stale start ctx setEditorComponent");
				runner.setEditorCalls += 1;
				runner.editorFactory = factory;
			},
			getEditorComponent() {
				if (isStale()) throw new Error("stale start ctx getEditorComponent");
				return runner.editorFactory;
			},
		});
		const startCtx = makeContext({ ui: makeUiWrapper(() => startContextStale) });
		const shutdownCtx = makeContext({ ui: makeUiWrapper(() => false) });
		expect(shutdownCtx).not.toBe(startCtx);
		expect(shutdownCtx.ui).not.toBe(startCtx.ui);

		await emit(handlers, "session_start", startCtx);
		expect(runner.editorFactory).toBeTypeOf("function");
		startContextStale = true;
		await expect(emit(handlers, "session_shutdown", shutdownCtx)).resolves.toBeUndefined();
		await emit(handlers, "session_shutdown", shutdownCtx);

		expect(runner.editorFactory).toBeUndefined();
		expect(runner.setEditorCalls).toBe(2);
		// A distinct ui wrapper carries no ownership token, so shutdown must not clobber it.
		expect(runner.footerClears).toBe(0);
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

	it("cleans every stale owned surface on an enabled-to-disabled extension reload", async () => {
		const firstHandlers = loadExtension();
		const existingFactory = () => ({
			render: () => ["native"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		});
		let editorFactory: unknown = existingFactory;
		let footerFactory: unknown;
		let setEditorCalls = 0;
		let setFooterCalls = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				getEditorText: () => "",
				setEditorText() {},
				setEditorComponent(factory: unknown) {
					setEditorCalls += 1;
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: unknown) {
					setFooterCalls += 1;
					footerFactory = factory;
				},
			},
		});

		await emit(firstHandlers, "session_start", ctx);
		expect(editorFactory).not.toBe(existingFactory);
		expect(footerFactory).toBeTypeOf("function");
		expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
		expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);

		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: {
					editor: { enabled: false },
					userMessages: { enabled: false },
					selectorBorders: { enabled: false },
					footer: { style: "native" },
				},
			}),
		);
		const secondHandlers = loadExtension();
		await emit(secondHandlers, "session_start", ctx);

		expect(editorFactory).toBe(existingFactory);
		expect(footerFactory).toBeUndefined();
		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
		expect(UserMessageComponent.prototype.invalidate).toBe(originalUserMessageInvalidate);
		expect(ModelSelectorComponent.prototype.render).toBe(originalModelSelectorRender);
		expect(SettingsSelectorComponent.prototype.render).toBe(originalSettingsSelectorRender);
		expect(setEditorCalls).toBe(2);
		expect(setFooterCalls).toBe(2);
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

	it.each([
		["the default editor", undefined],
		[
			"a non-Zentui editor",
			() => ({
				render: () => ["external editor"],
				invalidate() {},
				handleInput() {},
				getText: () => "",
				setText() {},
			}),
		],
	] as const)(
		"preserves post-start takeover by %s through reconciliation, disable, and shutdown",
		async (_label, takeoverFactory) => {
			const commands = new Map<string, unknown>();
			const handlers = loadExtension({ commands });
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
					notify() {},
				},
			});

			await emit(handlers, "session_start", ctx);
			expect(editorFactory).toBeTypeOf("function");
			expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
			expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
			editorFactory = takeoverFactory;

			await new Promise((resolve) => setTimeout(resolve, 1));
			expect(editorFactory).toBe(takeoverFactory);
			expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
			expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);

			const command = commands.get("zentui") as {
				handler(args: string, ctx: unknown): Promise<void>;
			};
			await command.handler("editor enable", ctx);
			expect(editorFactory).toBeTypeOf("function");
			expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
			editorFactory = takeoverFactory;
			await command.handler("editor disable", ctx);
			expect(editorFactory).toBe(takeoverFactory);
			// Editor enablement is component-local; messages and selector borders stay installed.
			expect(UserMessageComponent.prototype.render).not.toBe(originalUserMessageRender);
			expect(ModelSelectorComponent.prototype.render).not.toBe(originalModelSelectorRender);
			await emit(handlers, "session_shutdown", ctx);
			expect(editorFactory).toBe(takeoverFactory);
			expect(setEditorCalls).toBe(2);
		},
	);

	it("routes fixed-editor aliases through layout without retaking a third-party editor", async () => {
		const commands = new Map<string, unknown>();
		const handlers = loadExtension({ commands });
		const notifications: string[] = [];
		let editorFactory: unknown;
		let setEditorCalls = 0;
		const takeoverFactory = () => ({
			render: () => ["takeover"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		});
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
				setWidget() {},
				notify(message: string) {
					notifications.push(message);
				},
			},
		});
		await emit(handlers, "session_start", ctx);
		expect(setEditorCalls).toBe(1);
		editorFactory = takeoverFactory;
		await new Promise((resolve) => setTimeout(resolve, 1));

		const command = commands.get("zentui") as {
			handler(args: string, ctx: unknown): Promise<void>;
		};
		for (const args of ["fixed-editor enable", "fixed_editor disable", "fixed editor toggle"])
			await command.handler(args, ctx);

		expect(editorFactory).toBe(takeoverFactory);
		expect(setEditorCalls).toBe(1);
		expect(notifications).toEqual([
			"Fixed editor: enabled",
			"Fixed editor: disabled",
			"Fixed editor: enabled",
		]);
		const persisted = JSON.parse(
			readFileSync(join(isolatedAgentDir.path, "zentui.json"), "utf8"),
		) as {
			layout: { fixedEditor: { enabled: boolean } };
		};
		expect(persisted.layout.fixedEditor.enabled).toBe(true);
		await emit(handlers, "session_shutdown", ctx);
		expect(editorFactory).toBe(takeoverFactory);
	});

	it("routes removed copy commands through the ordinary usage warning without mutation", async () => {
		const path = join(isolatedAgentDir.path, "zentui.json");
		writeFileSync(path, JSON.stringify({ components: { editor: { style: "minimalist" } } }));
		const before = readFileSync(path, "utf8");
		const commands = new Map<string, unknown>();
		const handlers = loadExtension({ commands });
		const notifications: string[] = [];
		const ctx = makeContext({ ui: { notify: (message: string) => notifications.push(message) } });
		await emit(handlers, "session_start", ctx);
		const command = commands.get("zentui") as {
			handler(args: string, ctx: unknown): Promise<void>;
		};

		for (const args of [
			"copy-friendly disable",
			"editor-copy-friendly enable",
			"message-copy-friendly disable",
		]) {
			await command.handler(args, ctx);
		}
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(notifications).toHaveLength(3);
		expect(notifications.every((message) => message.startsWith("Usage: /zentui"))).toBe(true);
		await emit(handlers, "session_shutdown", ctx);
	});

	it("does not reconcile an editor after its session shuts down", async () => {
		vi.useFakeTimers();
		try {
			const handlers = loadExtension();
			const laterEditorFactory = () => ({
				render: () => ["later"],
				invalidate() {},
				handleInput() {},
				getText: () => "",
				setText() {},
			});
			let editorFactory: unknown;
			let stale = false;
			const ctx = makeContext({
				ui: {
					theme: makeTheme(),
					setFooter() {
						if (stale) throw new Error("stale setFooter");
					},
					setEditorComponent(factory: unknown) {
						if (stale) throw new Error("stale setEditorComponent");
						editorFactory = factory;
					},
					getEditorComponent() {
						if (stale) throw new Error("stale getEditorComponent");
						return editorFactory;
					},
				},
			});

			await emit(handlers, "session_start", ctx);
			editorFactory = laterEditorFactory;
			await emit(handlers, "session_shutdown", ctx);
			stale = true;

			expect(() => vi.runAllTimers()).not.toThrow();
			expect(editorFactory).toBe(laterEditorFactory);
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders editor and message style selections independently", () => {
		let config: PolishedTuiConfig = {
			...defaultConfig,
			components: {
				...defaultConfig.components,
				editor: {
					...defaultConfig.components.editor,
					style: "opencode-copy-friendly",
				},
				userMessages: {
					...defaultConfig.components.userMessages,
					style: "framed",
				},
			},
		};
		const cleanup = installUserMessageStyleProduction(
			() => makeTheme(),
			() => config,
		);
		try {
			const editor = new PolishedEditorProduction(
				{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
				{ borderColor: (text: string) => text, selectList: {} } as never,
				{} as never,
				makeTheme(),
				() => config,
				() => ({ modelLabel: "model", providerLabel: "provider" }),
				() => "off",
			);
			editor.setText("draft");
			expect(editor.render(80).join("\n")).not.toContain("│");
			expect(new UserMessageComponent("message").render(80).join("\n")).toContain("│");

			config = {
				...config,
				components: {
					...config.components,
					editor: { ...config.components.editor, style: "opencode" },
					userMessages: { ...config.components.userMessages, style: "labeled" },
				},
			};
			expect(editor.render(80).join("\n")).toContain("│");
			expect(new UserMessageComponent("message 2").render(80).join("\n")).toContain("User");
		} finally {
			cleanup();
		}
	});

	it.each([
		["opencode", "framed"],
		["opencode", "compact"],
		["opencode", "labeled"],
		["opencode-copy-friendly", "framed"],
		["opencode-copy-friendly", "compact"],
		["opencode-copy-friendly", "labeled"],
		["minimalist", "framed"],
		["minimalist", "compact"],
		["minimalist", "labeled"],
	] as const)("composes %s Editor with %s messages independently", (editorStyle, messageStyle) => {
		const config = structuredClone(defaultConfig);
		config.components.editor.style = editorStyle;
		config.components.userMessages.style = messageStyle;
		installUserMessageStyleProduction(
			() => makeTheme(),
			() => config,
		);
		const messageWrapper = UserMessageComponent.prototype.render;
		const editor = new PolishedEditorProduction(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTheme(),
			() => config,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/project" }),
		);
		editor.setText("draft");
		const editorRendered = editor.render(80).join("\n");
		const messageRendered = new UserMessageComponent("message").render(40).join("\n");

		if (editorStyle === "opencode") expect(editorRendered).toContain("│");
		else if (editorStyle === "opencode-copy-friendly") expect(editorRendered).not.toContain("│");
		else expect(editorRendered).toContain("╭");
		if (messageStyle === "framed") expect(stripPromptMarks(messageRendered)).toContain("────");
		else if (messageStyle === "compact") {
			expect(stripPromptMarks(messageRendered)).toContain("│ message");
			expect(stripPromptMarks(messageRendered)).not.toContain("────");
		} else expect(stripPromptMarks(messageRendered)).toContain("User");
		expect(config.components.editor.style).toBe(editorStyle);
		expect(config.components.userMessages).toMatchObject({ enabled: true, style: messageStyle });
		expect(config.components.footer.style).toBe("starship");
		expect(UserMessageComponent.prototype.render).toBe(messageWrapper);
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

	it("renders compact user messages without horizontal borders", () => {
		const config = structuredClone(defaultConfig);
		config.components.userMessages.style = "compact";
		installUserMessageStyle(
			() => makeTaggedTheme(),
			() => config,
		);

		const lines = new UserMessageComponent("hello").render(80).map(stripPromptMarks);
		const rendered = lines.join("\n");

		expect(rendered).toContain("│");
		expect(rendered).toContain("hello");
		expect(stripTestTags(lines[0])).not.toMatch(/^─+$/);
		expect(stripTestTags(lines.at(-1) ?? "")).not.toMatch(/^─+$/);
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

	it("restyles cached history when message style or relevant chrome changes", () => {
		let config = structuredClone(defaultConfig);
		const fg = vi.fn((color: string, text: string) => `[${color}]${text}`);
		const theme = { ...makeTaggedTheme(), fg } as unknown as Theme;
		const wrapperBefore = UserMessageComponent.prototype.render;
		installUserMessageStyle(
			() => theme,
			() => config,
		);
		const installedWrapper = UserMessageComponent.prototype.render;
		const message = new UserMessageComponent("hello");

		const framed = message.render(30).join("\n");
		const callsAfterFramed = fg.mock.calls.length;
		expect(framed).toContain("────");

		config = structuredClone(config);
		config.components.footer.style = "hidden";
		expect(message.render(30).join("\n")).toBe(framed);
		expect(fg).toHaveBeenCalledTimes(callsAfterFramed);

		config = structuredClone(config);
		config.components.userMessages.style = "compact";
		const compact = message.render(30).join("\n");
		expect(compact).toContain("│");
		expect(compact).not.toContain("────");

		config = structuredClone(config);
		config.components.userMessages.style = "labeled";
		const labeled = message.render(30).join("\n");
		expect(labeled).toContain("User");
		expect(UserMessageComponent.prototype.render).toBe(installedWrapper);
		expect(installedWrapper).not.toBe(wrapperBefore);
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

	it("renders selector borders from their independent canonical color source", () => {
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

		patchSelectorBorderStyleProduction(
			terminalPrototype,
			() => makeTaggedTheme(),
			() => ({
				...defaultConfig,
				components: {
					...defaultConfig.components,
					editor: { ...defaultConfig.components.editor, colorSource: "theme" },
					selectorBorders: {
						...defaultConfig.components.selectorBorders,
						colorSource: "terminal",
					},
				},
			}),
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

	it("selector cleanup restores its exact predecessor and is idempotent", () => {
		const prototype = {
			render(width: number) {
				return ["─".repeat(width), "body", "─".repeat(width)];
			},
		};
		const predecessor = prototype.render;
		const cleanup = patchSelectorBorderStyle(
			prototype,
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

		expect(prototype.render(8)[0]).toContain("[borderMuted]────────");
		cleanup();
		cleanup();
		expect(prototype.render).toBe(predecessor);
	});

	it("does not stack selector wrappers and ignores stale cleanup", () => {
		const predecessor = vi.fn((width: number) => ["─".repeat(width), "body", "─".repeat(width)]);
		const prototype = { render: predecessor };
		const firstCleanup = patchSelectorBorderStyle(
			prototype,
			() => makeTaggedTheme("first:"),
			() => defaultConfig,
		);
		const wrapper = prototype.render;
		const secondCleanup = patchSelectorBorderStyle(
			prototype,
			() => makeTaggedTheme("second:"),
			() => defaultConfig,
		);

		expect(prototype.render).toBe(wrapper);
		firstCleanup();
		const rendered = prototype.render(8);
		expect(rendered[0]).toContain("[second:borderMuted]────────");
		expect(rendered[0]).not.toContain("first:");
		expect(predecessor).toHaveBeenCalledTimes(1);
		secondCleanup();
		expect(prototype.render).toBe(predecessor);
	});

	it("preserves a later selector replacement and its predecessor chain", () => {
		const predecessor = (width: number) => ["─".repeat(width), "body", "─".repeat(width)];
		const prototype = { render: predecessor };
		const getTheme = vi.fn(() => makeTaggedTheme());
		const cleanup = patchSelectorBorderStyle(prototype, getTheme, () => defaultConfig);
		const zentuiWrapper = prototype.render;
		const thirdParty = function thirdParty(this: unknown, width: number): string[] {
			return ["third-party", ...zentuiWrapper.call(this, width)];
		};
		prototype.render = thirdParty;

		cleanup();
		getTheme.mockClear();

		expect(prototype.render).toBe(thirdParty);
		expect(prototype.render(4)).toEqual(["third-party", "────", "body", "────"]);
		expect(getTheme).not.toHaveBeenCalled();
	});

	it("deactivates an older selector record hidden inside a third-party predecessor chain", () => {
		const predecessor = (width: number) => ["─".repeat(width), "body", "─".repeat(width)];
		const prototype = { render: predecessor };
		const firstTheme = vi.fn(() => makeTaggedTheme("first:"));
		const secondTheme = vi.fn(() => makeTaggedTheme("second:"));
		patchSelectorBorderStyle(prototype, firstTheme, () => defaultConfig);
		const firstWrapper = prototype.render;
		const thirdParty = function thirdParty(this: unknown, width: number): string[] {
			return ["third-party", ...firstWrapper.call(this, width)];
		};
		prototype.render = thirdParty;
		const cleanupSecond = patchSelectorBorderStyle(prototype, secondTheme, () => defaultConfig);

		cleanupSecond();
		firstTheme.mockClear();
		secondTheme.mockClear();

		expect(prototype.render).toBe(thirdParty);
		expect(prototype.render(4)).toEqual(["third-party", "────", "body", "────"]);
		expect(firstTheme).not.toHaveBeenCalled();
		expect(secondTheme).not.toHaveBeenCalled();
	});

	it("restores model and settings selector prototypes independently", () => {
		const modelPredecessor = ModelSelectorComponent.prototype.render;
		const settingsPredecessor = SettingsSelectorComponent.prototype.render;
		const cleanup = installSelectorBorderStyle(
			() => makeTaggedTheme(),
			() => defaultConfig,
		);
		const modelZentuiWrapper = ModelSelectorComponent.prototype.render;
		const thirdPartyModelRender = function thirdPartyModelRender(
			this: unknown,
			width: number,
		): string[] {
			return modelZentuiWrapper.call(this as never, width);
		};
		ModelSelectorComponent.prototype.render = thirdPartyModelRender;

		cleanup();

		expect(ModelSelectorComponent.prototype.render).toBe(thirdPartyModelRender);
		expect(SettingsSelectorComponent.prototype.render).toBe(settingsPredecessor);
		expect(ModelSelectorComponent.prototype.render).not.toBe(modelPredecessor);
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

	it("user-message cleanup restores exact render and invalidate predecessors", () => {
		const predecessorRender = UserMessageComponent.prototype.render;
		const predecessorInvalidate = UserMessageComponent.prototype.invalidate;
		const cleanup = installUserMessageStyle(
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

		expect(UserMessageComponent.prototype.render).not.toBe(predecessorRender);
		expect(UserMessageComponent.prototype.invalidate).not.toBe(predecessorInvalidate);
		expect(new UserMessageComponent("hello").render(80).join("\n")).toContain("[borderMuted]────");
		cleanup();
		cleanup();

		expect(UserMessageComponent.prototype.render).toBe(predecessorRender);
		expect(UserMessageComponent.prototype.invalidate).toBe(predecessorInvalidate);
	});

	it("falls back to the predecessor user-message render when text cannot be found", () => {
		const predecessor = (width: number) => [`fallback:${width}`];
		UserMessageComponent.prototype.render = predecessor;
		const cleanup = installUserMessageStyle(
			() => makeTaggedTheme(),
			() => defaultConfig,
		);

		const lines = UserMessageComponent.prototype.render.call({ children: [] }, 42);

		expect(lines).toEqual(["fallback:42"]);
		cleanup();
		expect(UserMessageComponent.prototype.render).toBe(predecessor);
	});

	it.each(["framed", "compact", "labeled"] as const)(
		"preserves exactly one OSC 133 prompt zone for %s messages",
		(style) => {
			const config = structuredClone(defaultConfig);
			config.components.userMessages.style = style;
			installUserMessageStyle(
				() => makeTheme(),
				() => config,
			);

			const rendered = new UserMessageComponent("hello").render(40).join("\n");
			expect(rendered.match(/\x1b\]133;A\x07/g)).toHaveLength(1);
			expect(rendered.match(/\x1b\]133;B\x07\x1b\]133;C\x07/g)).toHaveLength(1);
		},
	);

	it("removes BEL, ST, and C1-ST terminated OSC 133 zones without removing user text", () => {
		installUserMessageStyle(
			() => makeTheme(),
			() => defaultConfig,
		);
		const hostile = "before \x1b]133;A\x07middle \x1b]133;B\x1b\\after \x9d133;C\x9c final";
		const rendered = new UserMessageComponent(hostile).render(80).join("\n");

		expectSinglePromptZone(rendered);
		expect(rendered).toContain("before middle after  final");
	});

	it.each([
		["unterminated ESC OSC", "before \x1b]133;Atail", "before tail", "\x1b]133"],
		["unterminated C1 OSC", "before \x9d133;Btail", "before tail", "\x9d133"],
		["partial ESC boundary", "before \x1b]13", "before ", "\x1b]13"],
		["partial C1 boundary", "before \x9d1", "before ", "\x9d1"],
		["complete command boundary", "before \x1b]133", "before ", "\x1b]133"],
	] as const)(
		"neutralizes %s while preserving trailing text",
		(_name, hostile, visibleText, hostileFragment) => {
			installUserMessageStyle(
				() => makeTheme(),
				() => defaultConfig,
			);
			const rendered = new UserMessageComponent(hostile).render(80).join("\n");

			expectSinglePromptZone(rendered);
			expect(rendered).toContain(visibleText);
			expect(stripPromptMarks(rendered)).not.toContain(hostileFragment);
		},
	);

	it("neutralizes multiple complete and incomplete OSC 133 sequences", () => {
		installUserMessageStyle(
			() => makeTheme(),
			() => defaultConfig,
		);
		const hostile = "one \x1b]133;A\x07two \x9d133;B\x9cthree \x1b]133;Cfour";
		const rendered = new UserMessageComponent(hostile).render(80).join("\n");

		expectSinglePromptZone(rendered);
		expect(rendered).toContain("one two three four");
	});

	it.each([
		["7-bit then C1", "\x1b]9;payload ", "\x9d133;A\x9c", "\x1b]9;"],
		["C1 then 7-bit", "\x9d9;payload ", "\x1b]133;A\x07", "\x9d9;"],
	] as const)(
		"bounds an unterminated unrelated OSC before a nested OSC 133 (%s)",
		(_name, unrelated, hostile, openIntroducer) => {
			installUserMessageStyle(
				() => makeTheme(),
				() => defaultConfig,
			);
			const rendered = new UserMessageComponent(`before ${unrelated}${hostile}after`)
				.render(80)
				.join("\n");
			const visible = stripPromptMarks(rendered);

			expectSinglePromptZone(rendered);
			expect(visible).toContain("before 9;payload after");
			expect(visible).not.toContain(openIntroducer);
			expect(visible).not.toContain(hostile);
		},
	);

	it.each([
		[
			"C1 then 7-bit",
			"\x9d133;Btail ",
			"\x1b]8;;https://example.com\x1b\\",
			"\x1b]8;;\x1b\\",
			"\x9d133",
		],
		["7-bit", "\x1b]133;Btail ", "\x1b]8;;https://example.com\x1b\\", "\x1b]8;;\x1b\\", "\x1b]133"],
	] as const)(
		"preserves a complete OSC 8 after an incomplete OSC 133 (%s)",
		(_name, hostile, open, close, hostileFragment) => {
			installUserMessageStyle(
				() => makeTheme(),
				() => defaultConfig,
			);
			const rendered = new UserMessageComponent(`before ${hostile}${open}link${close} after`)
				.render(100)
				.join("\n");
			const visible = stripPromptMarks(rendered);

			expectSinglePromptZone(rendered);
			expect(rendered).toContain(`${open}link${close}`);
			expect(visible).toContain("before tail ");
			expect(visible).not.toContain(hostileFragment);
		},
	);

	it("processes multiple nested OSC boundaries without overconsuming later sequences", () => {
		installUserMessageStyle(
			() => makeTheme(),
			() => defaultConfig,
		);
		const open = "\x1b]8;;https://example.com\x1b\\";
		const close = "\x1b]8;;\x1b\\";
		const hostile = `one \x1b]9;alpha \x9d133;A${open}link${close} two \x1b]133;Btail`;
		const rendered = new UserMessageComponent(hostile).render(120).join("\n");
		const visible = stripPromptMarks(rendered);

		expectSinglePromptZone(rendered);
		expect(rendered).toContain(`${open}link${close}`);
		expect(visible).toContain("one 9;alpha ");
		expect(visible).toContain(" two tail");
		expect(visible).not.toContain("\x1b]9;");
		expect(visible).not.toContain("\x9d133");
		expect(visible).not.toContain("\x1b]133");
	});

	it("preserves unrelated complete OSC 8 sequences byte-for-byte", () => {
		installUserMessageStyle(
			() => makeTheme(),
			() => defaultConfig,
		);
		const open = "\x1b]8;;https://example.com\x1b\\";
		const close = "\x1b]8;;\x1b\\";
		const rendered = new UserMessageComponent(`before ${open}link${close} after`)
			.render(80)
			.join("\n");

		expectSinglePromptZone(rendered);
		expect(rendered).toContain(`${open}link${close}`);
	});

	it.each(["framed", "compact", "labeled"] as const)(
		"preserves mixed 7-bit/C1 OSC 8 through sanitization and Markdown for %s",
		(style) => {
			const config = structuredClone(defaultConfig);
			config.components.userMessages.style = style;
			installUserMessageStyle(
				() => makeTheme(),
				() => config,
			);
			const starts = ["\x1b]", "\x9d"];
			const terminators = ["\x07", "\x1b\\", "\x9c"];
			const preserved: string[] = [];
			let source = "before \x9d133;Atail ";
			for (const [index, start] of starts.entries()) {
				for (const [terminatorIndex, terminator] of terminators.entries()) {
					const id = `${index}-${terminatorIndex}`;
					const open = `${start}8;;https://example.com/${id}${terminator}`;
					const close = `${start}8;;${terminator}`;
					const sequence = `${open}link-${id}${close}`;
					preserved.push(sequence);
					source += `${sequence} `;
				}
			}
			source += `${preserved[0]} [markdown](https://markdown.example) \x1b]133;Btail`;

			const rendered = new UserMessageComponent(source).render(240).join("\n");
			expectSinglePromptZone(rendered);
			for (const sequence of preserved) expect(rendered).toContain(sequence);
			expect(rendered.split(preserved[0])).toHaveLength(3);
			expect(rendered).toContain("markdown");
			const visible = stripPromptMarks(rendered);
			expect(visible).not.toContain("\x9d133");
			expect(visible).not.toContain("\x1b]133");
		},
	);

	it("delegates byte-for-byte when message theme rendering throws", () => {
		const predecessor = (width: number) => [`native:${width}`];
		UserMessageComponent.prototype.render = predecessor;
		const failingTheme = {
			...makeTheme(),
			fg() {
				throw new Error("theme failed");
			},
		} as unknown as Theme;
		installUserMessageStyle(
			() => failingTheme,
			() => defaultConfig,
		);

		const rendered = UserMessageComponent.prototype.render.call(
			{ children: [{ text: "hello" }] },
			42,
		);
		expect(rendered).toEqual(["native:42"]);
		expect(rendered.join("\n")).not.toContain("\x1b]133;");
	});

	it("delegates byte-for-byte when message cache-key construction throws", () => {
		const predecessor = (width: number) => [`native:${width}`];
		UserMessageComponent.prototype.render = predecessor;
		const config = structuredClone(defaultConfig);
		Object.defineProperty(config, "components", {
			get() {
				throw new Error("cache key failed");
			},
		});
		installUserMessageStyle(
			() => makeTheme(),
			() => config,
		);

		const rendered = UserMessageComponent.prototype.render.call(
			{ children: [{ text: "hello" }] },
			42,
		);
		expect(rendered).toEqual(["native:42"]);
		expect(rendered.join("\n")).not.toContain("\x1b]133;");
	});

	it("keeps zero-width output marker-safe", () => {
		installUserMessageStyle(
			() => makeTheme(),
			() => defaultConfig,
		);
		const rendered = new UserMessageComponent("hello").render(0).join("\n");
		expect(rendered).toBe("\x1b]133;A\x07\x1b]133;B\x07\x1b]133;C\x07");
	});

	it.each(["theme", "config"] as const)(
		"fails open byte-for-byte when the %s getter throws",
		(failure) => {
			const predecessor = (width: number) => [`fallback:${width}`];
			UserMessageComponent.prototype.render = predecessor;
			installUserMessageStyle(
				() => {
					if (failure === "theme") throw new Error("theme failed");
					return makeTheme();
				},
				() => {
					if (failure === "config") throw new Error("config failed");
					return defaultConfig;
				},
			);
			const lines = UserMessageComponent.prototype.render.call(
				{ children: [{ text: "hello" }] },
				42,
			);
			expect(lines).toEqual(["fallback:42"]);
			expect(lines.join("\n")).not.toContain("\x1b]133;");
		},
	);

	it("keeps user-message output within the requested render width", async () => {
		const handlers = loadExtension();
		await emit(handlers, "session_start", makeContext());

		const lines = new UserMessageComponent("hello ".repeat(20)).render(12).map(stripPromptMarks);

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 12)).toBe(true);
	});

	it("reuses user-message wrappers while stale cleanup leaves the new registration active", () => {
		const predecessorRender = UserMessageComponent.prototype.render;
		const predecessorInvalidate = UserMessageComponent.prototype.invalidate;
		const firstCleanup = installUserMessageStyle(
			() => makeTaggedTheme("first:"),
			() => defaultConfig,
		);
		const renderWrapper = UserMessageComponent.prototype.render;
		const invalidateWrapper = UserMessageComponent.prototype.invalidate;
		const firstRender = new UserMessageComponent("hello").render(80).join("\n");
		expect(firstRender).toMatch(/\[first:accent\]│|\u001b\[34m│\u001b\[0m/);

		const secondCleanup = installUserMessageStyle(
			() => makeTaggedTheme("second:"),
			() => defaultConfig,
		);
		expect(UserMessageComponent.prototype.render).toBe(renderWrapper);
		expect(UserMessageComponent.prototype.invalidate).toBe(invalidateWrapper);
		firstCleanup();
		const secondRender = new UserMessageComponent("hello").render(80).join("\n");
		expect(secondRender).not.toContain("[first:accent]│");
		expect(secondRender).toMatch(/\[second:accent\]│|\u001b\[34m│\u001b\[0m/);

		secondCleanup();
		expect(UserMessageComponent.prototype.render).toBe(predecessorRender);
		expect(UserMessageComponent.prototype.invalidate).toBe(predecessorInvalidate);
	});

	it("deactivates an older user-message record hidden inside a third-party predecessor chain", () => {
		const prototype = UserMessageComponent.prototype;
		const predecessorRender = (width: number) => [`base:${width}`];
		const predecessorInvalidate = vi.fn();
		prototype.render = predecessorRender;
		prototype.invalidate = predecessorInvalidate;
		const firstTheme = vi.fn(() => makeTaggedTheme("first:"));
		const secondTheme = vi.fn(() => makeTaggedTheme("second:"));
		installUserMessageStyle(firstTheme, () => defaultConfig);
		const firstWrapper = prototype.render;
		const thirdParty = function thirdParty(this: unknown, width: number): string[] {
			return ["third-party", ...firstWrapper.call(this as never, width)];
		};
		prototype.render = thirdParty;
		const cleanupSecond = installUserMessageStyle(secondTheme, () => defaultConfig);

		cleanupSecond();
		firstTheme.mockClear();
		secondTheme.mockClear();

		expect(prototype.render).toBe(thirdParty);
		expect(prototype.invalidate).toBe(predecessorInvalidate);
		expect(prototype.render.call({ children: [{ text: "hello" }] } as never, 12)).toEqual([
			"third-party",
			"base:12",
		]);
		expect(firstTheme).not.toHaveBeenCalled();
		expect(secondTheme).not.toHaveBeenCalled();
	});

	it("keeps a later user-message replacement and releases old theme closures", () => {
		const prototype = UserMessageComponent.prototype;
		const predecessorRender = (width: number) => [`base:${width}`];
		const predecessorInvalidate = vi.fn();
		prototype.render = predecessorRender;
		prototype.invalidate = predecessorInvalidate;
		const getTheme = vi.fn(() => makeTaggedTheme("old:"));
		const cleanup = installUserMessageStyle(getTheme, () => defaultConfig);
		const zentuiWrapper = prototype.render;
		const thirdParty = function thirdParty(this: unknown, width: number): string[] {
			return ["third-party", ...zentuiWrapper.call(this as never, width)];
		};
		prototype.render = thirdParty;

		cleanup();
		getTheme.mockClear();

		expect(prototype.render).toBe(thirdParty);
		expect(prototype.invalidate).toBe(predecessorInvalidate);
		expect(prototype.render.call({ children: [{ text: "hello" }] } as never, 12)).toEqual([
			"third-party",
			"base:12",
		]);
		expect(getTheme).not.toHaveBeenCalled();
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

	it("renders editor and footer model labels from independent canonical owners", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: {
					editor: { modelLabel: "name" },
					userMessages: { enabled: false },
					selectorBorders: { enabled: false },
					footer: {
						modelLabel: "id",
						styles: { starship: { format: "$model", responsive: false } },
					},
				},
			}),
		);
		const handlers = loadExtension();
		let editorFactory: unknown;
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			model: { id: "model-id", name: "Model Name", provider: "provider", contextWindow: 1000 },
			ui: {
				theme: makeTheme(),
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
			},
		});

		await emit(handlers, "session_start", ctx);
		const editor = (editorFactory as (...args: unknown[]) => { render(width: number): string[] })(
			{ requestRender() {}, terminal: { rows: 24, cols: 100 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
		);
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
		expect(editor.render(100).join("\n")).toContain("Model Name");
		expect(footer?.render(100).join("\n")).toContain("model-id");
		expect(footer?.render(100).join("\n")).not.toContain("Model Name");
		footer?.dispose?.();
		await emit(handlers, "session_shutdown", ctx);
	});

	it("renders footer rows independently of editor decoration", () => {
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
		installFooter(ctx as never, createInitialState(emptyGitStatus()), () => defaultConfig, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
		expect(footer?.render(80).length).toBeGreaterThan(0);
	});

	it("keeps the production footer visible while the minimalist editor decorates", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: { editor: { style: "minimalist" } },
				projectRefreshIntervalMs: 0,
			}),
		);
		const handlers = loadExtension();
		let editorFactory: unknown;
		let footerFactory: FooterFactory | undefined;
		const tui = { requestRender: vi.fn(), terminal: { rows: 24, cols: 80 } };
		let sessionName = "release prep";
		const ui = {
			theme: makeTheme(),
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			getEditorComponent: () => editorFactory,
		};
		const ctx = makeContext({
			ui,
			sessionManager: {
				getBranch: () => [],
				getSessionName: () => sessionName,
			},
		});

		await emit(handlers, "session_start", ctx);
		await new Promise((resolve) => setTimeout(resolve, 20));
		const editor = (
			editorFactory as (...args: unknown[]) => {
				render(width: number): string[];
				setText(text: string): void;
			}
		)(tui as never, { borderColor: (text: string) => text, selectList: {} } as never, {} as never);
		editor.setText("draft");
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
		expect(footer?.render(80).length).toBeGreaterThan(0);

		const namedFrame = editor.render(80)[0];
		expect(namedFrame).toMatch(/^╭.*╮$/);
		expect(namedFrame).toContain("release prep");
		expect(footer?.render(80).length).toBeGreaterThan(0);
		const rendersBeforeRename = tui.requestRender.mock.calls.length;
		sessionName = "ship it";
		await handlers.get("session_info_changed")?.[0]?.(
			{ type: "session_info_changed", name: sessionName },
			ctx,
		);
		expect(tui.requestRender).toHaveBeenCalledTimes(rendersBeforeRename + 1);
		expect(editor.render(80)[0]).toContain("ship it");
		expect(editor.render(80)[0]).not.toContain("release prep");
		expect(editor.render(4)[0]).not.toContain("╭");
		expect(footer?.render(80).length).toBeGreaterThan(0);
		expect(editor.render(80)[0]).toMatch(/^╭.*╮$/);
		expect(footer?.render(80).length).toBeGreaterThan(0);

		const nativeEditorPrototype = Object.getPrototypeOf(PolishedEditor.prototype) as {
			render(width: number): string[];
		};
		const nativeRender = vi.spyOn(nativeEditorPrototype, "render").mockImplementation(() => {
			throw new Error("native render failed");
		});
		try {
			expect(() => editor.render(80)).toThrow("native render failed");
			expect(footer?.render(80).length).toBeGreaterThan(0);
		} finally {
			nativeRender.mockRestore();
		}

		expect(editor.render(80)[0]).toMatch(/^╭.*╮$/);
		expect(footer?.render(80).length).toBeGreaterThan(0);
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
		await emit(handlers, "agent_start", ctx);
		const thirdPartyFactory = () => ({ render: () => ["third-party"] });
		ui.setEditorComponent(thirdPartyFactory);
		expect(footer?.render(80).length).toBeGreaterThan(0);
		await emit(handlers, "model_select", ctx);
		expect(clearIntervalSpy).toHaveBeenCalled();
		clearIntervalSpy.mockRestore();

		footer?.dispose?.();
		await emit(handlers, "session_shutdown", ctx);
	});

	it("updates session names through a wrapped minimalist editor", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: { editor: { style: "minimalist" } },
				projectRefreshIntervalMs: 0,
			}),
		);
		const handlers = loadExtension();
		const existingEditorFactory = () => ({
			render: (width: number) => ["─".repeat(width), "base editor", "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		});
		let editorFactory: unknown = existingEditorFactory;
		let sessionName = "release prep";
		const tui = { requestRender: vi.fn(), terminal: { rows: 24, cols: 80 } };
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
			},
			sessionManager: {
				getBranch: () => [],
				getSessionName: () => sessionName,
			},
		});

		await emit(handlers, "session_start", ctx);
		expect(editorFactory).not.toBe(existingEditorFactory);
		const editor = (
			editorFactory as (...args: unknown[]) => ReturnType<typeof existingEditorFactory>
		)(tui as never, { borderColor: (text: string) => text, selectList: {} } as never, {} as never);
		expect(editor.render(80)[0]).toContain("release prep");

		const rendersBeforeRename = tui.requestRender.mock.calls.length;
		sessionName = "ship it";
		await handlers.get("session_info_changed")?.[0]?.(
			{ type: "session_info_changed", name: sessionName },
			ctx,
		);
		expect(tui.requestRender).toHaveBeenCalledTimes(rendersBeforeRename + 1);
		expect(editor.render(80)[0]).toContain("ship it");
		expect(editor.render(80)[0]).not.toContain("release prep");

		await emit(handlers, "session_shutdown", ctx);
		expect(editorFactory).toBe(existingEditorFactory);
	});

	it("keeps the production footer for unsupported wrapped minimalist output", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: { editor: { style: "minimalist" } },
				projectRefreshIntervalMs: 0,
			}),
		);
		const handlers = loadExtension();
		const existingFactory = () => ({
			render: (width: number) => [`third-party-${width}`, "draft", "help"],
			invalidate() {},
			handleInput() {},
			getText: () => "draft",
			setText() {},
		});
		let editorFactory: unknown = existingFactory;
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
			},
		});
		await emit(handlers, "session_start", ctx);
		const editor = (editorFactory as (...args: unknown[]) => ReturnType<typeof existingFactory>)(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
		);
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});

		expect(editor.render(80)).toEqual(["third-party-80", "draft", "help"]);
		expect(footer?.render(80).length).toBeGreaterThan(0);

		footer?.dispose?.();
		await emit(handlers, "session_shutdown", ctx);
	});

	it("forces an initial project refresh for minimalist mode without a status line or polling", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "zentui-minimalist-project-"));
		mkdirSync(join(cwd, ".git", "objects", "info"), { recursive: true });
		mkdirSync(join(cwd, ".git", "objects", "pack"), { recursive: true });
		mkdirSync(join(cwd, ".git", "refs", "heads"), { recursive: true });
		mkdirSync(join(cwd, ".git", "refs", "tags"), { recursive: true });
		writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/minimalist-test\n");
		writeFileSync(
			join(cwd, ".git", "config"),
			"[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
		);
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: { editor: { style: "minimalist" } },
				projectRefreshIntervalMs: 0,
				features: { statusLine: false },
			}),
		);
		const handlers = loadExtension();
		let editorFactory: unknown;
		const ctx = makeContext({
			cwd,
			ui: {
				theme: makeTheme(),
				setFooter() {},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
			},
		});
		try {
			await emit(handlers, "session_start", ctx);
			const editor = (editorFactory as (...args: unknown[]) => { render(width: number): string[] })(
				{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
				{ borderColor: (text: string) => text, selectList: {} } as never,
				{} as never,
			);

			await vi.waitFor(() => {
				expect(editor.render(120).join("\n")).toContain("minimalist-test");
			});
		} finally {
			await emit(handlers, "session_shutdown", ctx);
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("ticks only a decorated minimalist turn and freezes or stops on lifecycle changes", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: { editor: { style: "minimalist" } },
				projectRefreshIntervalMs: 0,
				features: { statusLine: false },
			}),
		);
		const commands = new Map<string, unknown>();
		const handlers = loadExtension({ commands });
		let editorFactory: unknown;
		const tui = { requestRender: vi.fn(), terminal: { rows: 24, cols: 80 } };
		const notifications: string[] = [];
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter() {},
				notify(message: string) {
					notifications.push(message);
				},
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				getEditorComponent: () => editorFactory,
			},
		});
		await emit(handlers, "session_start", ctx);
		const editor = (
			editorFactory as (...args: unknown[]) => {
				render(width: number): string[];
				setText(text: string): void;
			}
		)(tui as never, { borderColor: (text: string) => text, selectList: {} } as never, {} as never);
		editor.setText("draft");
		editor.render(80);

		let now = Date.now();
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
		try {
			await emit(handlers, "agent_start", ctx);
			expect(vi.getTimerCount()).toBe(1);
			now += 2500;
			vi.advanceTimersByTime(2500);
			expect(editor.render(80)[0]).toContain("2s");

			await emit(handlers, "agent_end", ctx);
			expect(vi.getTimerCount()).toBe(0);
			const frozen = editor.render(80)[0];
			vi.advanceTimersByTime(5000);
			expect(editor.render(80)[0]).toBe(frozen);

			await emit(handlers, "agent_start", ctx);
			expect(vi.getTimerCount()).toBe(1);
			const command = commands.get("zentui") as {
				handler(args: string, ctx: unknown): Promise<void>;
			};
			await command.handler("editor disable", ctx);
			expect(notifications).toEqual(["Editor: disabled"]);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			dateNow.mockRestore();
			vi.useRealTimers();
			await emit(handlers, "session_shutdown", ctx);
		}
	});

	it("stops minimalist timer and project work after a genuinely late editor takeover", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({
				components: { editor: { style: "minimalist" } },
				projectRefreshIntervalMs: 5_000,
				features: { statusLine: false },
			}),
		);
		const handlers = loadExtension();
		let editorFactory: unknown;
		const ui = {
			theme: makeTheme(),
			setFooter() {},
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			getEditorComponent: () => editorFactory,
		};
		const ctx = makeContext({ ui });
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		try {
			await emit(handlers, "session_start", ctx);
			await new Promise((resolve) => setTimeout(resolve, 20));
			const editor = (
				editorFactory as (...args: unknown[]) => {
					render(width: number): string[];
					setText(text: string): void;
				}
			)(
				{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
				{ borderColor: (text: string) => text, selectList: {} } as never,
				{} as never,
			);
			editor.setText("draft");
			editor.render(80);
			await emit(handlers, "agent_start", ctx);
			expect(vi.getTimerCount()).toBe(2);
			const thirdPartyFactory = () => ({
				render: () => ["third-party"],
				invalidate() {},
				handleInput() {},
				getText: () => "",
				setText() {},
			});
			ui.setEditorComponent(thirdPartyFactory);
			vi.advanceTimersByTime(5_000);
			expect(editorFactory).toBe(thirdPartyFactory);
			expect(vi.getTimerCount()).toBe(0);

			await emit(handlers, "agent_start", ctx);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			await emit(handlers, "session_shutdown", ctx);
			vi.useRealTimers();
		}
	});

	it("does not start turn intervals in polished or non-TUI sessions", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({ projectRefreshIntervalMs: 0, features: { statusLine: false } }),
		);
		const polishedHandlers = loadExtension();
		const polishedCtx = makeContext();
		await emit(polishedHandlers, "session_start", polishedCtx);
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
		await emit(polishedHandlers, "agent_start", polishedCtx);
		expect(setIntervalSpy).not.toHaveBeenCalled();
		await emit(polishedHandlers, "session_shutdown", polishedCtx);

		const rpcHandlers = loadExtension();
		const rpcCtx = makeContext({ hasUI: false, mode: "rpc" });
		await emit(rpcHandlers, "session_start", rpcCtx);
		await emit(rpcHandlers, "agent_start", rpcCtx);
		expect(setIntervalSpy).not.toHaveBeenCalled();
		await emit(rpcHandlers, "session_shutdown", rpcCtx);
		setIntervalSpy.mockRestore();
	});

	it("does not crash when config colors contain Starship modifiers", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			ui: {
				theme: makeStrictTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.contextLabel = "0.5%/200k";
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

	it("composes telemetry only into built-in wide segments and explicit atomic variables", () => {
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
		state.tokenLabel = "↑100 ↓20 󰆼 80.0%";
		state.cacheReadLabel = "R1.2k";
		state.cacheWriteLabel = "W300";
		state.costLabel = "$1.000";
		state.subscription = true;
		state.autoCompaction = true;
		const createFooter = () =>
			footerFactory?.({ requestRender() {} }, makeTheme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map<string, string>(),
			});

		installFooter(ctx as never, state, () => ({ ...defaultConfig, responsiveFooter: false }), {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const builtIn = createFooter()?.render(200).join("\n") ?? "";
		expect(builtIn).toContain("0.5%/200k (auto)");
		expect(builtIn).toContain("↑100 ↓20 󰆼 80.0% R1.2k W300");
		expect(builtIn).toContain("$1.000 (sub)");

		const customConfig = {
			...defaultConfig,
			responsiveFooter: false,
			footerFormat:
				"$tokens $cache_read $cache_write $cost $subscription $context $auto_compaction",
		};
		installFooter(ctx as never, state, () => customConfig, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const custom = createFooter()?.render(200).join("\n") ?? "";
		expect(custom).toContain("↑100 ↓20 󰆼 80.0% R1.2k W300 $1.000 (sub) 0.5%/200k (auto)");
		expect(custom.match(/R1\.2k/g)).toHaveLength(1);

		const compactConfig = {
			...defaultConfig,
			footerFormat: "X".repeat(200),
		};
		installFooter(ctx as never, state, () => compactConfig, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const compact = createFooter()?.render(40).join("\n") ?? "";
		expect(compact).not.toContain("R1.2k");
		expect(compact).not.toContain("W300");
		expect(compact).not.toContain("(sub)");
		expect(compact).not.toContain("(auto)");
	});

	it("renders opt-in model info, independent variables, and omits it from compact fallback", () => {
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
		state.modelLabel = "GPT-5.6 Terra";
		state.modelId = "GPT-5.6 Terra";
		state.modelName = "GPT-5.6 Terra";
		state.providerLabel = "OpenAI";
		state.contextLabel = "0.5%/200k";
		state.tokenLabel = "↑1 ↓2";
		state.costLabel = "$0.001";
		const createFooter = () =>
			footerFactory?.({ requestRender() {} }, makeTheme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map<string, string>(),
			});

		installFooter(ctx as never, state, () => ({ ...defaultConfig, responsiveFooter: false }), {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		expect(createFooter()?.render(200).join("\n")).not.toContain("GPT-5.6 Terra");

		const enabled = {
			...defaultConfig,
			footerSegments: { ...defaultConfig.footerSegments, modelInfo: true },
		};
		installFooter(ctx as never, state, () => enabled, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const aligned = createFooter()?.render(200) ?? [];
		expect(aligned).toHaveLength(1);
		expect(aligned.join("\n")).toContain("GPT-5.6 Terra OpenAI");
		expect(aligned.every((line) => visibleWidth(line) <= 200)).toBe(true);

		installFooter(ctx as never, state, () => enabled, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const reflowed = createFooter()?.render(55) ?? [];
		expect(reflowed).toHaveLength(2);
		expect(reflowed.join("\n")).toContain("GPT-5.6 Terra OpenAI");
		expect(reflowed.every((line) => visibleWidth(line) <= 55)).toBe(true);

		installFooter(ctx as never, state, () => enabled, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		state.modelLabel = "openai/gpt-5";
		state.modelId = "openai/gpt-5";
		expect(createFooter()?.render(200).join("\n")).toContain("openai/gpt-5 | 0.5%/200k");
		expect(createFooter()?.render(200).join("\n")).not.toContain("openai/gpt-5 OpenAI");
		state.providerLabel = "";
		expect(createFooter()?.render(200).join("\n")).toContain("openai/gpt-5 | 0.5%/200k");

		state.modelLabel = "custom-model";
		state.modelId = "custom-model";
		state.providerLabel = "Provider X";
		installFooter(
			ctx as never,
			state,
			() => ({
				...defaultConfig,
				responsiveFooter: false,
				footerFormat: "$model|$provider",
			}),
			{ setRequestRender() {}, scheduleProjectRefresh() {} },
		);
		expect(createFooter()?.render(200).join("\n")).toContain("custom-model|Provider X");
		for (const [format, expected, omitted] of [
			["$model", "custom-model", "Provider X"],
			["$provider", "Provider X", "custom-model"],
			["$provider$fill$model", "Provider X", ""],
		] as const) {
			installFooter(
				ctx as never,
				state,
				() => ({ ...defaultConfig, responsiveFooter: false, footerFormat: format }),
				{ setRequestRender() {}, scheduleProjectRefresh() {} },
			);
			const custom = createFooter()?.render(200).join("\n") ?? "";
			expect(custom).toContain(expected);
			if (omitted) expect(custom).not.toContain(omitted);
			if (format.includes("$fill")) {
				expect(custom.indexOf("Provider X")).toBeLessThan(custom.indexOf("custom-model"));
			}
		}

		installFooter(ctx as never, state, () => enabled, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const compact = createFooter()?.render(40) ?? [];
		expect(compact.join("\n")).not.toContain("custom-model");
		expect(compact.join("\n")).not.toContain("Provider X");
		expect(compact.every((line) => visibleWidth(line) <= 40)).toBe(true);
	});

	it("keeps built-in telemetry controlled by parent segment enablement", () => {
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
		state.cacheReadLabel = "R10";
		state.cacheWriteLabel = "W20";
		state.subscription = true;
		state.autoCompaction = true;
		const config = {
			...defaultConfig,
			responsiveFooter: false,
			footerSegments: {
				...defaultConfig.footerSegments,
				context: false,
				tokens: false,
				cost: false,
			},
		};
		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
		const rendered = footer?.render(160).join("\n") ?? "";
		expect(rendered).not.toMatch(/R10|W20|\(sub\)|\(auto\)/);
	});

	it("bounds ANSI-styled compact output with explicitly opted-in telemetry atoms", () => {
		let footerFactory: FooterFactory | undefined;
		const theme = makeTheme();
		const ctx = makeContext({
			ui: {
				theme,
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.cacheReadLabel = "R1.2k";
		state.cacheWriteLabel = "W300";
		state.subscription = true;
		state.autoCompaction = true;
		const config = {
			...defaultConfig,
			footerFormat: "X".repeat(200),
			compactFooterFormat:
				"$cache_read$wrap_sep$cache_write$wrap_sep$subscription$wrap_sep$auto_compaction",
			compactFooterMaxLines: 2 as const,
			colorSources: { ...defaultConfig.colorSources, starship: "terminal" as const },
		};
		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, theme, {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
		const lines = footer?.render(18) ?? [];
		const output = lines.join("\n");

		expect(output).toContain("R1.2k");
		expect(output).toContain("W300");
		expect(output).toContain("(sub)");
		expect(output).toContain("(auto)");
		expect(output).toContain("\u001b[");
		expect(lines).toHaveLength(2);
		expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
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
		state.contextLabel = "0.5%/200k";
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
		expect(rendered.indexOf("Z")).toBeLessThan(rendered.indexOf("0.5%/200k"));
		expect(rendered).toContain("↑1 ↓2");
		expect(rendered).toContain("$0.001");
	});

	it.each([
		["pipe", " | "],
		["dot", " · "],
		["chevron", " › "],
		["none", " "],
	] as Array<[SeparatorStyle, string]>)(
		"renders %s separators between extension statuses and built-in right segments",
		(separator, expectedSeparator) => {
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
			state.tokenLabel = "tokens";
			state.costLabel = "cost";
			const config = { ...defaultConfig, separator };

			installFooter(ctx as never, state, () => config, {
				setRequestRender() {},
				scheduleProjectRefresh() {},
			});

			const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () =>
					new Map<string, string>([
						["beta", "B"],
						["alpha", "A"],
					]),
			});
			const rendered = footer?.render(160).join("\n") ?? "";

			expect(rendered).toContain(["A", "B", "0.5%/200k", "tokens", "cost"].join(expectedSeparator));
		},
	);

	it("keeps custom footer format $sep as a pipe", () => {
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
		state.tokenLabel = "tokens";
		const config = {
			...defaultConfig,
			separator: "dot" as const,
			footerFormat: "$cwd$fill$context$sep$tokens",
		};

		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});

		expect(footer?.render(120).join("\n") ?? "").toContain("0.5%/200k | tokens");
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
		state.contextLabel = "0.5%/200k";
		state.tokenLabel = "↑1 ↓2";
		state.costLabel = "$0.001";
		const config = {
			...configWithExtensionStatuses({
				placements: {
					alpha: "left",
					alpha2: "left",
					beta: "middle",
					beta2: "middle",
					gamma: "right",
					hidden: "off",
				},
			}),
			separator: "chevron" as const,
		};

		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});

		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () =>
				new Map<string, string>([
					["alpha", "left-status"],
					["alpha2", "left-status-2"],
					["beta", "middle-status"],
					["beta2", "middle-status-2"],
					["gamma", "right-status"],
					["hidden", "hidden-status"],
				]),
		});
		const rendered = footer?.render(180).join("\n") ?? "";

		expect(rendered).toContain(" › left-status › left-status-2");
		expect(rendered).toContain("middle-status › middle-status-2");
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
		state.contextLabel = "0.5%/200k";
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
		state.contextLabel = "0.5%/200k";
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
		state.contextLabel = "0.5%/200k";
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
		const lines = footer?.render(44) ?? [];
		const rendered = lines.join("\n");

		expect(rendered).toContain("0.5%/200k");
		expect(rendered).toContain("↑1 ↓2");
		expect(rendered).toContain("$0.001");
		expect(lines.every((line) => visibleWidth(line) <= 44)).toBe(true);
	});

	it("selects aligned, full reflow, and compact stages at exact target widths", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			getContextUsage: () => ({ percent: 48, tokens: 96_000, contextWindow: 200_000 }),
			sessionManager: { getBranch: () => [], getSessionName: () => "responsive-layout-long" },
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState({ ...emptyGitStatus(), branch: "main" });
		state.tokenLabel = "↑466k ↓54k 󰆼 99.3%";
		const fillToken = `\${fill}`;
		const left = "L".repeat(70);
		const middle = "M".repeat(20);
		const right = "R".repeat(48);
		const config: PolishedTuiConfig = {
			...defaultConfig,
			footerFormat: `${left}${fillToken}${middle}${fillToken}${right}`,
			icons: { ...defaultConfig.icons, cwd: "", git: "" },
		};
		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});

		const at145 = footer?.render(145) ?? [];
		const at139 = footer?.render(139) ?? [];
		const at122 = footer?.render(122) ?? [];
		const at47 = footer?.render(47) ?? [];
		expect(at145).toEqual([` ${left}  ${middle}   ${right} `]);
		expect(at139).toEqual([` ${left} `, ` ${middle} ${right} `]);
		expect(at122).toEqual([` ${left} `, ` ${middle} ${right} `]);
		expect(at47.length).toBeLessThanOrEqual(2);
		expect(at47.join("\n")).toContain("project");
		expect(at47.join("\n")).toContain("responsive");
		expect(at47.join("\n")).toContain("main");
		expect(at47.join("\n")).toContain("48.0%/200k | ↑466k ↓54k 󰆼 99.3%");
		for (const [width, lines] of [
			[145, at145],
			[139, at139],
			[122, at122],
			[47, at47],
		] as const) {
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		for (const [width, expected] of [
			[145, at145],
			[139, at139],
			[122, at122],
			[47, at47],
			[122, at122],
			[139, at139],
			[145, at145],
		] as const) {
			expect(footer?.render(width)).toEqual(expected);
		}

		const legacyConfig = { ...config, responsiveFooter: false };
		installFooter(ctx as never, state, () => legacyConfig, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const legacy = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
		expect(legacy?.render(145)).toEqual(at145);
		expect(legacy?.render(139)).toEqual([
			` ${left}${middle.slice(0, 18)}\u001b[0m…\u001b[0m${right} `,
		]);
	});

	it("keeps compact context when the row cap omits token metrics", () => {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/x",
			getContextUsage: () => ({ percent: 48, tokens: 96_000, contextWindow: 200_000 }),
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const state = createInitialState(emptyGitStatus());
		state.tokenLabel = "↑466k ↓54k 󰆼 99.3%";
		const config: PolishedTuiConfig = {
			...defaultConfig,
			footerFormat: "X".repeat(100),
			compactFooterFormat: "$context$wrap_sep$tokens",
			compactFooterMaxLines: 1,
		};
		installFooter(ctx as never, state, () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});

		const rendered = footer?.render(15).join("\n") ?? "";
		expect(rendered).toContain("48.0%/200k…");
		expect(rendered).not.toContain("↑466k");
		expect(rendered).not.toContain("|");
	});

	it("expands compact extension statuses once in placement order and excludes off", () => {
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
		const config = configWithExtensionStatuses({
			placements: { alpha: "left", beta: "middle", gamma: "right", hidden: "off" },
		});
		config.footerFormat = "X".repeat(100);
		config.compactFooterFormat = "$cwd$wrap$extensions$wrap$context";
		installFooter(ctx as never, createInitialState(emptyGitStatus()), () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () =>
				new Map([
					["gamma", "RIGHT"],
					["hidden", "HIDDEN"],
					["beta", "MIDDLE"],
					["alpha", "LEFT"],
				]),
		});
		const lines = footer?.render(80) ?? [];
		const rendered = lines.join("\n");
		expect(rendered.indexOf("LEFT")).toBeLessThan(rendered.indexOf("MIDDLE"));
		expect(rendered.indexOf("MIDDLE")).toBeLessThan(rendered.indexOf("RIGHT"));
		expect(rendered).not.toContain("HIDDEN");
		expect(rendered.match(/LEFT/g)).toHaveLength(1);
		expect(rendered.match(/MIDDLE/g)).toHaveLength(1);
		expect(rendered.match(/RIGHT/g)).toHaveLength(1);
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("truncates built-in and template branch aliases with the shared branch length", () => {
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
		state.branch = "feature/very-long";
		const baseConfig: PolishedTuiConfig = {
			...defaultConfig,
			gitBranch: { maxLength: 6 },
			icons: { ...defaultConfig.icons, git: "" },
		};
		const render = (footerFormat: string) => {
			installFooter(ctx as never, state, () => ({ ...baseConfig, footerFormat }), {
				setRequestRender() {},
				scheduleProjectRefresh() {},
			});
			const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map<string, string>(),
			});
			return footer?.render(160).join("\n") ?? "";
		};

		expect(render("")).toContain("on featu…");
		expect(render("$git_branch|$branch")).toContain("featu…|featu…");
		expect(render("$git_branch|$branch")).not.toContain("feature/very-long");
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
		state.contextLabel = "0.5%/200k";
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
			state.contextLabel = "0.5%/200k";
			state.tokenLabel = "↑1 ↓2";
			state.costLabel = "$0.001";
			const config: PolishedTuiConfig = {
				...defaultConfig,
				footerSegments: {
					...defaultConfig.footerSegments,
					packageVersion: enabled,
					runtime: false,
				},
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
		// Starship `package` shape: `is <glyph> <version>`.
		expect(withPackage).toContain("is");
		expect(withPackage).toContain("\u{f487}");
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
		state.contextLabel = "0.5%/200k";
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

	it("git commit segment shows hash on detached HEAD and hides it on a branch", () => {
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
		const OID = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
		const renderFor = (detached: boolean, onlyDetached: boolean) => {
			const state = createInitialState(emptyGitStatus());
			state.branch = detached ? undefined : "main";
			state.commit = { oid: OID, detached, tag: null };
			state.contextLabel = "0.5%/200k";
			state.tokenLabel = "↑1 ↓2";
			state.costLabel = "$0";
			const config: PolishedTuiConfig = {
				...defaultConfig,
				footerSegments: { ...defaultConfig.footerSegments, gitCommit: true },
				gitBranch: { maxLength: 1 },
				gitCommit: { hashLength: 7, onlyDetached, showTag: true },
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

		// Detached → HEAD + green (hash) in branch display.
		expect(renderFor(true, true)).toContain("HEAD");
		expect(renderFor(true, true)).toContain(`(${OID.slice(0, 7)})`);
		// On branch with onlyDetached → hidden.
		expect(renderFor(false, true)).not.toContain(OID.slice(0, 7));
		// On branch with onlyDetached=false → hash appears standalone.
		expect(renderFor(false, false)).toContain(OID.slice(0, 7));
	});

	it("git metrics segment renders +added −deleted and hides at 0/0", () => {
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
		const renderFor = (added: number, deleted: number) => {
			const state = createInitialState(emptyGitStatus());
			state.metrics = { added, deleted };
			state.contextLabel = "0.5%/200k";
			state.tokenLabel = "↑1 ↓2";
			state.costLabel = "$0";
			const config: PolishedTuiConfig = {
				...defaultConfig,
				footerSegments: { ...defaultConfig.footerSegments, gitMetrics: true },
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

		expect(renderFor(12, 3)).toContain("+12");
		expect(renderFor(12, 3)).toContain("−3");
		// 0/0 → hidden (onlyNonzero default).
		expect(renderFor(0, 0)).not.toContain("+0");
		expect(renderFor(0, 0)).not.toContain("−0");
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

	it("hides editor rails in the low-rail polished style", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => configWithLowRailStyle(true),
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

	it("renders custom editor metadata variables", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => ({
				...defaultConfig,
				editorMetadataFormat: "$model|$model_id|$model_name|$provider|$thinking|$session_name",
			}),
			() => ({
				modelLabel: "selected-model",
				modelId: "model-id",
				modelName: "Model Name",
				providerLabel: "Provider",
				sessionName: "Session",
			}),
			() => "high",
		);

		const rendered = editor.render(240).join("\n");
		expect(rendered).toContain("[accent]selected-model");
		expect(rendered).toContain("[accent]model-id");
		expect(rendered).toContain("[accent]Model Name");
		expect(rendered).toContain("[text]Provider");
		expect(rendered).toContain("[muted]high");
		expect(rendered).toContain("[border]Session");
	});

	it("keeps custom metadata output identical in standalone and wrapped editors", () => {
		const config = {
			...defaultConfig,
			editorMetadataFormat: "meta:$model|$provider|$thinking|$session_name",
		};
		const getMeta = () => ({
			modelLabel: "parity-model",
			providerLabel: "parity-provider",
			sessionName: "parity-session",
		});
		const standalone = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 200 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			getMeta,
			() => "medium",
		);
		const wrapped = new WrappedPolishedEditor(
			{
				render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
				invalidate() {},
				handleInput() {},
				getText: () => "",
				setText() {},
			},
			makeTaggedTheme(),
			() => config,
			getMeta,
			() => "medium",
		);

		const standaloneMeta = standalone.render(200).find((line) => line.includes("parity-model"));
		const wrappedMeta = wrapped.render(200).find((line) => line.includes("parity-model"));
		expect(standaloneMeta).toBe(wrappedMeta);
	});

	it("renders Unicode and sanitized ANSI metadata safely at narrow widths", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 16 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTheme(),
			() => ({ ...defaultConfig, editorMetadataFormat: "界🙂:$model" }),
			() => ({
				modelLabel: "\u001b]8;;https://example.com\u001b\\表示\u001b]8;;\u001b\\\u001b[31m危険",
				providerLabel: "provider",
			}),
			() => "off",
		);

		const lines = editor.render(16);
		const metadata = lines.find((line) => line.includes("界")) ?? "";
		expect(metadata).toContain("表示");
		expect(metadata).not.toContain("\u001b]");
		expect(lines.every((line) => visibleWidth(line) <= 16)).toBe(true);
	});

	it("keeps Vim status when long custom metadata collides in both polished modes", () => {
		for (const lowRail of [false, true]) {
			const config = {
				...configWithLowRailStyle(lowRail),
				editorMetadataFormat: "very-long-custom-metadata-$model-$provider",
			};
			const editor = new WrappedPolishedEditor(
				{
					render: (width: number) => ["─".repeat(width), "", "─".repeat(width)],
					invalidate() {},
					handleInput() {},
					getText: () => "",
					setText() {},
					getMode: () => "insert",
				},
				makeTheme(),
				() => config,
				() => ({ modelLabel: "model-with-long-name", providerLabel: "provider-with-long-name" }),
				() => "off",
			);

			const lines = editor.render(32);
			const metadata = lines.find((line) => line.includes("INSERT")) ?? "";
			expect(metadata.trimEnd().endsWith("INSERT")).toBe(true);
			expect(metadata).not.toContain("provider-with-long-name");
			expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
		}
	});

	it("keeps blank structural metadata rows in the low-rail polished style", () => {
		const config = configWithLowRailStyle(true);
		config.components.editor.styles["opencode-copy-friendly"].metadataFormat = "($unknown)";
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
		);

		const lines = editor.render(120);
		expect(stripTestTags(lines.at(-2) ?? "").trim()).toBe("");
		expect(stripTestTags(lines.at(-3) ?? "").trim()).toBe("");
		expect(lines.at(-2)).toBe(" ");
	});

	it("uses the custom low-rail Editor prompt icon and color", () => {
		const config = configWithLowRailStyle(true);
		config.icons = { ...config.icons, editorPrompt: "›" };
		config.colors = { ...config.colors, editorPrompt: "warning" };
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
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

	it("delegates vim input and leaves an unrecognized vim frame untouched", () => {
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
		expect(rendered).toContain("NORMAL");
		expect(rendered).not.toContain("[success]INSERT");
		expect(rendered).not.toContain("[accent]claude-sonnet");
	});

	it("unwraps a branded nested editor without duplicating literal-only metadata", () => {
		const config = { ...defaultConfig, editorMetadataFormat: "literal-only" };
		const inner = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "old-model", providerLabel: "old-provider" }),
			() => "off",
		);
		inner.setText("typed text");
		const editor = new WrappedPolishedEditor(
			inner as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "new-model", providerLabel: "new-provider" }),
			() => "off",
		);

		const lines = editor.render(120);
		const rendered = lines.join("\n");

		expect(rendered.match(/literal-only/g)).toHaveLength(1);
		expect(rendered).toContain("typed text");
		expect(lines.filter((line) => /^─+$/.test(stripTestTags(line).trim()))).toHaveLength(2);
	});

	it("unwraps branded low-rail polished frames without duplicating metadata", () => {
		const config = configWithLowRailStyle(true);
		config.components.editor.styles["opencode-copy-friendly"].metadataFormat = "copy-meta";
		const inner = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "old-model", providerLabel: "old-provider" }),
			() => "off",
		);
		inner.setText("typed text");
		const editor = new WrappedPolishedEditor(
			inner as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "new-model", providerLabel: "new-provider" }),
			() => "off",
		);

		const rendered = editor.render(120).join("\n");
		expect(rendered.match(/copy-meta/g)).toHaveLength(1);
		expect(rendered.match(/typed text/g)).toHaveLength(1);
		expect(rendered).not.toContain("│");
	});

	it("unwraps branded frames when metadata resolves blank", () => {
		const config = { ...defaultConfig, editorMetadataFormat: "($unknown)" };
		const inner = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "old-model", providerLabel: "old-provider" }),
			() => "off",
		);
		const editor = new WrappedPolishedEditor(
			inner as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "new-model", providerLabel: "new-provider" }),
			() => "off",
		);

		const lines = editor.render(120);
		expect(lines).toHaveLength(6);
		expect(lines.filter((line) => /^─+$/.test(stripTestTags(line).trim()))).toHaveLength(2);
		expect(lines.slice(1, -1).every((line) => stripTestTags(line).trim() === "│")).toBe(true);
	});

	it("preserves a user blank line while unwrapping branded editor chrome", () => {
		const inner = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "old-model", providerLabel: "old-provider" }),
			() => "off",
		);
		inner.setText("\ntyped text");
		const editor = new WrappedPolishedEditor(
			inner as never,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "new-model", providerLabel: "new-provider" }),
			() => "off",
		);

		const lines = editor.render(120);
		const textIndex = lines.findIndex((line) => line.includes("typed text"));

		expect(textIndex).toBe(3);
		expect(stripTestTags(lines[textIndex - 2] ?? "").trim()).toBe("│");
		expect(stripTestTags(lines[textIndex - 1] ?? "").trim()).toBe("│");
	});

	it("does not accumulate stale metadata or chrome across repeated nested renders", () => {
		let config = { ...defaultConfig, editorMetadataFormat: "first:$model:$session_name" };
		let meta = {
			modelLabel: "model-one",
			providerLabel: "provider-one",
			sessionName: "session-one",
		};
		let thinking = "low";
		const inner = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			() => meta,
			() => thinking,
		);
		const editor = new WrappedPolishedEditor(
			inner as never,
			makeTaggedTheme(),
			() => config,
			() => meta,
			() => thinking,
		);
		const assertSingleFrame = (lines: string[]) => {
			expect(lines.filter((line) => /^─+$/.test(stripTestTags(line).trim()))).toHaveLength(2);
		};

		const first = editor.render(120);
		expect(first.join("\n")).toContain("first:");
		expect(first.join("\n")).toContain("model-one");
		assertSingleFrame(first);

		config = { ...config, editorMetadataFormat: "second:$provider:$thinking:$session_name" };
		meta = {
			modelLabel: "model-two",
			providerLabel: "provider-two",
			sessionName: "session-two",
		};
		thinking = "xhigh";
		const second = editor.render(120);
		const secondText = second.join("\n");
		expect(secondText).toContain("second:");
		expect(secondText).toContain("provider-two");
		expect(secondText).toContain("xhigh");
		expect(secondText).toContain("session-two");
		expect(secondText).not.toContain("first:");
		expect(secondText).not.toContain("model-one");
		expect(secondText).not.toContain("session-one");
		assertSingleFrame(second);

		config = { ...config, editorMetadataFormat: "$model($model_name)($session_name)" };
		meta = { modelLabel: "model-three", providerLabel: "", sessionName: "" };
		thinking = "off";
		const third = editor.render(120);
		const thirdText = third.join("\n");
		expect(thirdText.match(/model-three/g)).toHaveLength(1);
		expect(thirdText).not.toContain("second:");
		expect(thirdText).not.toContain("provider-two");
		expect(thirdText).not.toContain("session-two");
		assertSingleFrame(third);
	});

	it("preserves every autocomplete row outside multiply wrapped branded frames", () => {
		const config = { ...defaultConfig, editorMetadataFormat: "autocomplete-meta" };
		const base = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 120 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
		);
		base.setText("typed");
		const autocomplete = base as unknown as {
			autocompleteState: string;
			autocompleteList: { render: (width: number) => string[] };
		};
		autocomplete.autocompleteState = "force";
		autocomplete.autocompleteList = {
			render: () => ["suggestion-one", "suggestion-two", "suggestion-three"],
		};
		const inner = new WrappedPolishedEditor(
			base as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
		);
		const outer = new WrappedPolishedEditor(
			inner as never,
			makeTaggedTheme(),
			() => config,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
		);

		const lines = outer.render(120);
		const rendered = lines.join("\n");
		const bottom = lines.findLastIndex((line) => /^─+$/.test(stripTestTags(line).trim()));
		expect(rendered.match(/autocomplete-meta/g)).toHaveLength(1);
		expect(lines.filter((line) => /^─+$/.test(stripTestTags(line).trim()))).toHaveLength(2);
		expect(lines.some((line) => stripTestTags(line).includes("├"))).toBe(false);
		expect(bottom).toBe(lines.length - 4);
		for (const suggestion of ["suggestion-one", "suggestion-two", "suggestion-three"]) {
			expect(rendered.match(new RegExp(suggestion, "g"))).toHaveLength(1);
			const row = lines.findIndex((line) => line.includes(suggestion));
			expect(row).toBeGreaterThan(bottom);
		}
	});

	it("does not delete metadata-like content from an unbranded third-party editor", () => {
		const staleMeta = "claude-sonnet  Anthropic  xhigh";
		const base = {
			render: (width: number) => ["─".repeat(width), staleMeta, "─".repeat(width)],
			invalidate() {},
			handleInput() {},
			getText: () => staleMeta,
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base,
			makeTaggedTheme(),
			() => defaultConfig,
			() => ({ modelLabel: "claude-sonnet", providerLabel: "Anthropic" }),
			() => "xhigh",
		);

		const rendered = editor.render(120).join("\n");
		expect(rendered.match(/claude-sonnet/g)).toHaveLength(2);
		expect(rendered.match(/Anthropic/g)).toHaveLength(2);
		expect(rendered.match(/xhigh/g)).toHaveLength(2);
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setEditorComponent(patch) {
					featureChanges.push(patch as never);
					return { applied: true };
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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

		expect(featureChanges).toEqual([{ enabled: false }]);
		expect(renderRequests).toBe(1);
		expect(notifications).toEqual([{ message: "Editor: disabled", level: "info" }]);
	});

	it("toggles the status line from direct Zentui slash-command arguments", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const featureChanges: Array<Record<string, unknown>> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setFooterComponent(patch) {
					featureChanges.push(patch);
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
			},
		);

		await command?.handler("status line off", { hasUI: false });

		expect(featureChanges).toEqual([{ style: "native" }]);
	});

	it("treats removed copy commands as unknown arguments", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const notifications: Array<{ message: string; level: string }> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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

		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.message).toMatch(/^Usage: \/zentui/);
		expect(notifications[0]?.level).toBe("warning");
	});

	it("toggles viewport indicators from direct Zentui slash-command arguments", async () => {
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setEditorComponent(patch) {
					featureChanges.push(patch as never);
					return { applied: true };
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
			},
		);

		await command?.handler("viewport-indicators toggle", {
			hasUI: true,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		});

		expect(featureChanges).toEqual([{ viewportIndicators: false }]);
		expect(notifications).toEqual([
			{ message: "Editor viewport indicators: disabled", level: "info" },
		]);
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setEditorComponent: () => ({
					applied: false,
					reason:
						"another extension is currently managing the editor; reload Pi to apply this change",
				}),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
			const sessionLifecycle = new SessionLifecycle();
			sessionLifecycle.start();

			registerZentuiSettingsCommand(
				{
					registerCommand(_name: string, options: unknown) {
						command = options as typeof command;
					},
				} as never,
				{
					sessionLifecycle,
					getConfig: () => defaultConfig,
					setColorSources() {},
					setEditorComponent() {
						doneCallsAtFeatureChange.push(doneCalls);
						return { applied: true };
					},
					setFooterSegments() {},
					setFooterFormat() {},
					setIconMode() {},
					setContextStyle() {},
					setPathDisplay() {},
					setGitBranch() {},
					setSeparator() {},
					getActiveExtensionStatuses: () => new Map<string, string>(),
					setExtensionStatusPlacement() {},
					setExtensionStatusColorMode() {},
					setFixedEditor() {},
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

	it("does not update a settings value when persistence fails", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const attemptedPatches: Array<Record<string, unknown>> = [];
		const notifications: string[] = [];
		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUserMessagesComponent(patch) {
					attemptedPatches.push(patch);
					throw new Error("config is corrupt");
				},
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
				notify(message: string) {
					notifications.push(message);
				},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
						handleInput?: (data: string) => void;
					};
					component.handleInput?.("\t");
					component.handleInput?.("\t");
					component.handleInput?.(" ");
					component.handleInput?.(" ");
				},
			},
		});

		expect(attemptedPatches).toEqual([{ enabled: false }, { enabled: false }]);
		expect(notifications).toEqual([
			"Could not update Zentui settings: config is corrupt",
			"Could not update Zentui settings: config is corrupt",
		]);
	});

	it("drops a deferred settings editor swap after session shutdown", async () => {
		vi.useFakeTimers();
		try {
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			let featureChanges = 0;
			let stale = false;
			const sessionLifecycle = new SessionLifecycle();
			sessionLifecycle.start();
			registerZentuiSettingsCommand(
				{
					registerCommand(_name: string, options: unknown) {
						command = options as typeof command;
					},
				} as never,
				{
					sessionLifecycle,
					getConfig: () => defaultConfig,
					setColorSources() {},
					setEditorComponent() {
						featureChanges += 1;
						return { applied: true };
					},
					setFooterSegments() {},
					setFooterFormat() {},
					setIconMode() {},
					setContextStyle() {},
					setPathDisplay() {},
					setGitBranch() {},
					setSeparator() {},
					getActiveExtensionStatuses: () => new Map<string, string>(),
					setExtensionStatusPlacement() {},
					setExtensionStatusColorMode() {},
					setFixedEditor() {},
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
			const ctx = {
				hasUI: true,
				mode: "tui",
				ui: {
					theme: makeTaggedTheme(),
					notify() {
						if (stale) throw new Error("stale notify");
					},
					async custom(factory: (...args: unknown[]) => unknown) {
						const component = factory({ requestRender() {} }, makeTaggedTheme(), {}, () => {}) as {
							handleInput?: (data: string) => void;
						};
						component.handleInput?.("\t");
						component.handleInput?.(" ");
					},
				},
			};

			await command?.handler("", ctx);
			sessionLifecycle.shutdown();
			stale = true;

			expect(() => vi.runAllTimers()).not.toThrow();
			expect(featureChanges).toBe(0);
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
					sessionLifecycle: inactiveSessionLifecycle,
					getConfig: () => config,
					setColorSources() {},
					setUiFeatures: () => ({ applied: true }),
					setFooterSegments() {},
					setFooterFormat() {},
					setIconMode() {},
					setContextStyle() {},
					setPathDisplay() {},
					setGitBranch() {},
					setSeparator() {},
					getActiveExtensionStatuses: () => new Map<string, string>(),
					setExtensionStatusPlacement() {},
					setExtensionStatusColorMode() {},
					setFixedEditor() {},
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
		expect(themeLines.join("\n")).toContain("Appearance");
		expect(themeLines.join("\n")).toContain("(1/8)");
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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

	it("changes responsive footer enablement and compact rows from layout settings", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const patches: Array<
			Partial<Pick<PolishedTuiConfig, "responsiveFooter" | "compactFooterMaxLines">>
		> = [];
		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setResponsiveFooter(patch) {
					patches.push(patch);
				},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
				theme: makeTheme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
						handleInput?: (data: string) => void;
					};
					for (let index = 0; index < 4; index += 1) component.handleInput?.("\t");
					for (let index = 0; index < 3; index += 1) component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
					component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
				},
			},
		});
		expect(patches).toEqual([{ responsiveFooter: false }, { compactFooterMaxLines: 3 }]);
	});

	it("cycles the separator from the Zentui layout settings", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const changes: SeparatorStyle[] = [];
		const notifications: string[] = [];
		let dependencyRenderRequests = 0;
		let tuiRenderRequests = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator(separator) {
					changes.push(separator);
				},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
				theme: makeTheme(),
				notify(message: string) {
					notifications.push(message);
				},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory(
						{
							requestRender() {
								tuiRenderRequests += 1;
							},
						},
						makeTheme(),
						{},
						() => {},
					) as { handleInput?: (data: string) => void };
					for (let index = 0; index < 4; index += 1) component.handleInput?.("\t");
					for (let index = 0; index < 6; index += 1) component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
					component.handleInput?.(" ");
					component.handleInput?.(" ");
					component.handleInput?.(" ");
				},
			},
		});

		expect(changes).toEqual(["dot", "chevron", "none", "pipe"]);
		expect(notifications).toEqual([
			"Separator: dot",
			"Separator: chevron",
			"Separator: none",
			"Separator: pipe",
		]);
		expect(dependencyRenderRequests).toBe(4);
		expect(tuiRenderRequests).toBe(8);
	});

	it("cycles branch length presets and returns custom JSON values to full", async () => {
		const run = async (maxLength: PolishedTuiConfig["gitBranch"]["maxLength"], presses: number) => {
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			const changes: Array<PolishedTuiConfig["gitBranch"]["maxLength"]> = [];
			const config = structuredClone(defaultConfig);
			config.components.footer.styles.starship.gitBranch.maxLength = maxLength;
			registerZentuiSettingsCommand(
				{
					registerCommand(_name: string, options: unknown) {
						command = options as typeof command;
					},
				} as never,
				{
					sessionLifecycle: inactiveSessionLifecycle,
					getConfig: () => config,
					setColorSources() {},
					setUiFeatures: () => ({ applied: true }),
					setFooterSegments() {},
					setFooterFormat() {},
					setIconMode() {},
					setContextStyle() {},
					setPathDisplay() {},
					setGitBranch(patch) {
						if (patch.maxLength !== undefined) changes.push(patch.maxLength);
					},
					setSeparator() {},
					getActiveExtensionStatuses: () => new Map<string, string>(),
					setExtensionStatusPlacement() {},
					setExtensionStatusColorMode() {},
					setFixedEditor() {},
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
					theme: makeTheme(),
					notify() {},
					async custom(factory: (...args: unknown[]) => unknown) {
						const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
							handleInput?: (data: string) => void;
						};
						for (let index = 0; index < 6; index += 1) component.handleInput?.("\t");
						component.handleInput?.("\x1b[B");
						for (let index = 0; index < presses; index += 1) component.handleInput?.(" ");
					},
				},
			});
			return changes;
		};

		expect(await run("full", 6)).toEqual([10, 20, 30, 40, 50, "full"]);
		expect(await run(17, 1)).toEqual(["full"]);
	});

	it("keeps the Zentui settings command open after applying a change", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const changes: Array<Record<string, unknown>> = [];
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setSelectorBordersComponent(patch) {
					changes.push(patch);
				},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
				},
			},
		});

		expect(changes).toEqual([{ colorSource: "terminal" }]);
		expect(dependencyRenderRequests).toBe(1);
		expect(tuiRenderRequests).toBe(1);
		expect(doneCalls).toBe(0);
	});

	it("shows selector color sources independently", async () => {
		let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
		const changes: Array<Record<string, unknown>> = [];
		let rendered = "";

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => configWithColorSources({ editor: "theme", userMessages: "terminal" }),
				setColorSources() {},
				setSelectorBordersComponent(patch) {
					changes.push(patch);
				},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
				},
			},
		});

		expect(rendered).toContain("Selector border colors");
		expect(rendered).not.toContain("Editor + previous messages");
		expect(changes).toEqual([{ colorSource: "terminal" }]);
	});

	function navigateToSettingsSection(
		component: { handleInput?: (data: string) => void },
		section:
			| "Appearance"
			| "Editor"
			| "User messages"
			| "Layout"
			| "Footer"
			| "Segments"
			| "Git"
			| "Extensions",
	) {
		const sections = [
			"Appearance",
			"Editor",
			"User messages",
			"Layout",
			"Footer",
			"Segments",
			"Git",
			"Extensions",
		];
		for (let index = 0; index < sections.indexOf(section); index += 1) {
			component.handleInput?.("\t");
		}
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					navigateToSettingsSection(component, "Extensions");
					component.handleInput?.("\x1b[Z");
					rendered = component.render?.(120).join("\n") ?? "";
				},
			},
		});

		expect(rendered).toContain("Git branch");
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () =>
					new Map<string, string>([
						["alpha", "A"],
						["beta", "B"],
					]),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					navigateToSettingsSection(component, "Extensions");
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>(),
				setExtensionStatusPlacement(key, placement) {
					placements.push({ key, placement });
				},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					navigateToSettingsSection(component, "Extensions");
					component.handleInput?.("\x1b[B");
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
				sessionLifecycle: inactiveSessionLifecycle,
				getConfig: () => defaultConfig,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setPathDisplay() {},
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>([["alpha", "ok"]]),
				setExtensionStatusPlacement(key, placement) {
					placements.push({ key, placement });
				},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					navigateToSettingsSection(component, "Extensions");
					component.handleInput?.("\x1b[B");
					component.handleInput?.(" ");
				},
			},
		});

		expect(placements).toEqual([{ key: "alpha", placement: "off" }]);
		expect(dependencyRenderRequests).toBe(1);
		expect(tuiRenderRequests).toBe(8);
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
				sessionLifecycle: inactiveSessionLifecycle,
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
				setGitBranch() {},
				setSeparator() {},
				getActiveExtensionStatuses: () => new Map<string, string>([["active", "ok"]]),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
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
					navigateToSettingsSection(component, "Extensions");
					rendered = component.render?.(80).join("\n") ?? "";
				},
			},
		});

		expect(rendered).toContain("active");
		expect(rendered).toContain("middle");
		expect(rendered).not.toContain("inactive");
	});
	type SessionNameFooterOptions = {
		name?: string;
		getSessionName?: () => string | undefined;
		theme?: Theme;
		footerFormat?: string;
		segmentEnabled?: boolean;
		sessionNameColor?: string;
		branch?: string;
		branchEnabled?: boolean;
		responsiveFooter?: boolean;
	};

	function createSessionNameFooter({
		name,
		getSessionName = () => name,
		theme = makeTheme(),
		footerFormat = "",
		segmentEnabled = true,
		sessionNameColor = "success",
		branch,
		branchEnabled = false,
		responsiveFooter = true,
	}: SessionNameFooterOptions) {
		let footerFactory: FooterFactory | undefined;
		const ctx = makeContext({
			cwd: "/tmp/project",
			sessionManager: { getBranch: () => [], getSessionName },
			ui: {
				theme,
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		const config: PolishedTuiConfig = {
			...defaultConfig,
			footerFormat,
			responsiveFooter,
			colors: { ...defaultConfig.colors, sessionName: sessionNameColor },
			footerSegments: {
				...defaultConfig.footerSegments,
				cwd: true,
				sessionName: segmentEnabled,
				gitBranch: branchEnabled,
				gitStatus: false,
				runtime: false,
				context: false,
				tokens: false,
				cost: false,
			},
		};
		installFooter(ctx as never, createInitialState({ ...emptyGitStatus(), branch }), () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		return footerFactory?.({ requestRender() {} }, theme, {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map<string, string>(),
		});
	}

	function renderSessionNameFooter({
		width,
		...options
	}: SessionNameFooterOptions & { width: number }): string[] {
		return createSessionNameFooter(options)?.render(width) ?? [];
	}

	it("renders the default session name as 'in <name>' between cwd and branch", () => {
		const rendered = renderSessionNameFooter({
			name: "release prep",
			width: 500,
			theme: makeTaggedTheme(),
			branch: "feat/session-name-footer",
			branchEnabled: true,
		}).join("\n");
		expect(rendered).toContain("project in [success]release prep on");
		expect(rendered.indexOf("project")).toBeLessThan(rendered.indexOf("release prep"));
		expect(rendered.indexOf("release prep")).toBeLessThan(
			rendered.indexOf("feat/session-name-footer"),
		);
	});

	it("omits absent names and keeps Unicode names within narrow footer widths", () => {
		const absent = renderSessionNameFooter({
			name: undefined,
			width: 120,
			theme: makeTaggedTheme(),
		}).join("\n");
		expect(absent).not.toContain("undefined");
		expect(absent).not.toContain("[success]");
		expect(absent).not.toContain(" in ");
		const lines = renderSessionNameFooter({ name: "研究 🚀 ".repeat(20), width: 18 });
		expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
	});

	it("sanitizes terminal controls while preserving ordinary Unicode session names", () => {
		const rendered = renderSessionNameFooter({
			name: "\x1b[31mrelease\x1b[0m\tprep\x07\x1b]0;owned\x07研究 🚀",
			width: 120,
			theme: makeTaggedTheme(),
		}).join("\n");
		expect(rendered).toContain("release prep研究 🚀");
		expect(rendered).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
		expect(rendered).not.toContain("owned");

		const controlsOnly = renderSessionNameFooter({
			name: "\x1b[2J\x1b]0;owned\x07\t\x07",
			width: 120,
			theme: makeTaggedTheme(),
		}).join("\n");
		expect(controlsOnly).not.toContain("[success]");
		expect(controlsOnly).not.toContain("owned");
		expect(controlsOnly).not.toContain(" in ");
	});

	it("respects an explicit disabled setting and skips unused session-name lookups", () => {
		const getSessionName = vi.fn(() => "hidden");
		const disabled = renderSessionNameFooter({
			getSessionName,
			width: 120,
			segmentEnabled: false,
			responsiveFooter: false,
		}).join("\n");
		expect(disabled).not.toContain("hidden");
		expect(disabled).not.toContain(" in ");
		expect(getSessionName).not.toHaveBeenCalled();

		renderSessionNameFooter({
			getSessionName,
			width: 120,
			footerFormat: "$cwd",
			segmentEnabled: true,
			responsiveFooter: false,
		});
		expect(getSessionName).not.toHaveBeenCalled();

		renderSessionNameFooter({
			getSessionName,
			width: 120,
			footerFormat: "${" + "session_name}",
			segmentEnabled: false,
			responsiveFooter: false,
		});
		expect(getSessionName).toHaveBeenCalledOnce();
	});

	it("renders raw session-name tokens in custom formats without the built-in prefix", () => {
		const named = renderSessionNameFooter({
			name: "release prep",
			width: 120,
			footerFormat: "$cwd($sep$session_name)",
			segmentEnabled: false,
		}).join("\n");
		expect(named).toContain("release prep");
		expect(named).not.toContain("in release prep");
		const braced = renderSessionNameFooter({
			name: "release prep",
			width: 120,
			footerFormat: "$cwd ${" + "session_name}",
			segmentEnabled: false,
		}).join("\n");
		expect(braced).toContain("project release prep");
		expect(braced).not.toContain("in release prep");
		const unnamed = renderSessionNameFooter({
			name: undefined,
			width: 120,
			footerFormat: "$cwd$sep$session_name",
			segmentEnabled: false,
		}).join("\n");
		expect(unnamed).toContain("project");
		expect(unnamed).not.toContain(" | ");
	});

	it("reads an updated session name on the next footer render", () => {
		let sessionName = "draft";
		const footer = createSessionNameFooter({ getSessionName: () => sessionName });
		expect(footer?.render(120).join("\n")).toContain("draft");

		sessionName = "release prep";
		const renamed = footer?.render(120).join("\n") ?? "";
		expect(renamed).toContain("release prep");
		expect(renamed).not.toContain("draft");
	});

	it("requests one footer render on session_info_changed", async () => {
		const handlers = loadExtension();
		let footerFactory: FooterFactory | undefined;
		let renderRequests = 0;
		const ctx = makeContext({
			ui: {
				theme: makeTheme(),
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
				setEditorComponent() {},
			},
		});
		await emit(handlers, "session_start", ctx);
		footerFactory?.(
			{
				requestRender() {
					renderRequests += 1;
				},
			},
			makeTheme(),
			{
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			},
		);
		const handler = handlers.get("session_info_changed")?.[0];
		const before = renderRequests;
		expect(handler?.({ type: "session_info_changed", name: "release prep" }, ctx)).toBeUndefined();
		expect(renderRequests).toBe(before + 1);
		await emit(handlers, "session_shutdown", ctx);
	});
});

describe("three-state Footer lifecycle", () => {
	function createFooterHarness() {
		let factory: FooterFactory | undefined;
		let component: ReturnType<FooterFactory> | undefined;
		const factories: Array<FooterFactory | undefined> = [];
		const branchSubscriptions = vi.fn(() => () => {});
		const probeTransitions: unknown[] = [];
		const tui = { requestRender: vi.fn() };
		const footerData = {
			onBranchChange: branchSubscriptions,
			getExtensionStatuses: () => new Map<string, string>(),
		};
		const ui = {
			theme: makeTheme(),
			notify() {},
			setFooter(next: FooterFactory | undefined) {
				component?.dispose?.();
				component = undefined;
				factory = next;
				factories.push(next);
				if (next) component = next(tui, makeTheme(), footerData, () => {});
			},
			setEditorComponent() {},
			getEditorComponent: () => undefined,
			setWidget(key: string, next: unknown) {
				if (key === "zentui-fixed-editor-probe") probeTransitions.push(next);
			},
		};
		return {
			ui,
			factories,
			branchSubscriptions,
			probeTransitions,
			get factory() {
				return factory;
			},
			get component() {
				return component;
			},
		};
	}

	it("installs Hidden as an owned zero-row component without Starship timers or subscriptions", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({ projectRefreshIntervalMs: 0, components: { footer: { style: "hidden" } } }),
		);
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
		const harness = createFooterHarness();
		const handlers = loadExtension();
		const ctx = makeContext({ ui: harness.ui });
		await emit(handlers, "session_start", ctx);
		expect(harness.component?.render(80)).toEqual([]);
		expect(harness.branchSubscriptions).not.toHaveBeenCalled();
		expect(setIntervalSpy).not.toHaveBeenCalled();
		await emit(handlers, "session_shutdown", ctx);
	});

	it("does not replace an unrelated Footer on initial Native reconciliation", async () => {
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({ components: { footer: { style: "native" } } }),
		);
		const setFooter = vi.fn();
		const handlers = loadExtension();
		const ctx = makeContext({ ui: { theme: makeTheme(), setFooter } });
		await emit(handlers, "session_start", ctx);
		expect(setFooter).not.toHaveBeenCalled();
		await emit(handlers, "session_shutdown", ctx);
		expect(setFooter).not.toHaveBeenCalled();
	});

	it("clears ownership after Pi-style external disposal and leaves the replacement on shutdown", async () => {
		const harness = createFooterHarness();
		const handlers = loadExtension();
		const ctx = makeContext({ ui: harness.ui });
		await emit(handlers, "session_start", ctx);
		const replacement: FooterFactory = () => ({
			invalidate() {},
			render: () => ["third-party"],
		});
		harness.ui.setFooter(replacement);
		expect(harness.component?.render(80)).toEqual(["third-party"]);
		const callsBeforeShutdown = harness.factories.length;
		await emit(handlers, "session_shutdown", ctx);
		expect(harness.factories).toHaveLength(callsBeforeShutdown);
		expect(harness.factory).toBe(replacement);
	});

	it("rebinds Footer and reprobes fixed layout across every live style transition", async () => {
		initTheme(undefined, false);
		writeFileSync(
			join(isolatedAgentDir.path, "zentui.json"),
			JSON.stringify({ layout: { fixedEditor: { enabled: true } } }),
		);
		const commands = new Map<string, unknown>();
		const harness = createFooterHarness();
		const handlers = loadExtension({ commands });
		(
			harness.ui as typeof harness.ui & {
				custom: (factory: (...args: unknown[]) => unknown) => Promise<void>;
			}
		).custom = async (factory) => {
			const settings = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput(data: string): void;
			};
			for (let index = 0; index < 4; index++) settings.handleInput("\t");
			settings.handleInput(" ");
		};
		const ctx = makeContext({ ui: harness.ui });
		const chooseFooterStyle = async () => {
			await (
				commands.get("zentui") as { handler(args: string, ctx: unknown): Promise<void> }
			).handler("", ctx);
		};
		await emit(handlers, "session_start", ctx);
		expect(harness.component?.render(80).length).toBeGreaterThan(0);
		expect(harness.probeTransitions.map((value) => typeof value)).toEqual([
			"undefined",
			"function",
		]);
		await chooseFooterStyle();
		expect(harness.component?.render(80)).toEqual([]);
		expect(harness.probeTransitions.slice(-2).map((value) => typeof value)).toEqual([
			"undefined",
			"function",
		]);
		await chooseFooterStyle();
		expect(harness.factory).toBeUndefined();
		expect(harness.probeTransitions.slice(-2).map((value) => typeof value)).toEqual([
			"undefined",
			"function",
		]);
		await chooseFooterStyle();
		expect(harness.component?.render(80).length).toBeGreaterThan(0);
		expect(harness.probeTransitions.slice(-2).map((value) => typeof value)).toEqual([
			"undefined",
			"function",
		]);
		expect(harness.probeTransitions).toHaveLength(8);
		expect(
			new Set(harness.probeTransitions.filter((value) => typeof value === "function")).size,
		).toBe(4);
		expect(harness.factories).toHaveLength(4);
		expect(harness.branchSubscriptions).toHaveBeenCalledTimes(2);
		await emit(handlers, "session_shutdown", ctx);
		expect(harness.probeTransitions.at(-1)).toBeUndefined();
	});
});
