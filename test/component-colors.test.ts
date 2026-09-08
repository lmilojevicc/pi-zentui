import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { renderAccentRailEditorFrame } from "../extensions/zentui/accent-rail-editor";
import {
	type ColorOwner,
	componentColor,
	componentColorKeys,
} from "../extensions/zentui/component-colors";
import {
	type ColorSource,
	mergeConfig,
	migrateComponentSelections,
	saveComponentColor,
	type ZentuiConfig,
} from "../extensions/zentui/config";
import { renderEditorMetadataFormat } from "../extensions/zentui/editor-metadata-format";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { renderTurnSummaryEntry } from "../extensions/zentui/interaction-summary";
import { renderMinimalistFrame } from "../extensions/zentui/minimalist-editor";
import { patchSelectorBorderStyle } from "../extensions/zentui/selector-border";
import { createInitialState } from "../extensions/zentui/state";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";
import {
	renderUserMessageStyle,
	userMessageStyleCacheKey,
} from "../extensions/zentui/user-message-styles";
import {
	buildWorkingLineFrames,
	snapshotWorkingLineHighStyle,
	WorkingLineController,
} from "../extensions/zentui/working-line";

// Distinct SGR per token: named colors must exercise the theme mapping, not a uniform stub.
const themeTokens =
	"accent border borderAccent borderMuted success error warning muted dim text thinkingText userMessageText customMessageText customMessageLabel toolTitle toolOutput mdHeading mdLink mdLinkUrl mdCode mdCodeBlock mdCodeBlockBorder mdQuote mdQuoteBorder mdHr mdListBullet toolDiffAdded toolDiffRemoved toolDiffContext syntaxComment syntaxKeyword syntaxFunction syntaxVariable syntaxString syntaxNumber syntaxType syntaxOperator syntaxPunctuation thinkingOff thinkingMinimal thinkingLow thinkingMedium thinkingHigh thinkingXhigh thinkingMax bashMode".split(
		" ",
	);
function themePrefix(token: string) {
	const index = themeTokens.indexOf(token);
	if (index < 0) throw new Error(`Unexpected theme token: ${token}`);
	return `\x1b[38;5;${100 + index}m`;
}
const theme = {
	fg: (color: string, text: string) => `${themePrefix(color)}${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	italic: (text: string) => text,
	underline: (text: string) => text,
	strikethrough: (text: string) => text,
} as Theme;
function base(source: ColorSource = "terminal") {
	const config = mergeConfig({ icons: { editorPrompt: ">" } });
	for (const owner of Object.keys(componentColorKeys) as ColorOwner[])
		config.components[owner].colorSource = source;
	return config;
}
function footer(config: ZentuiConfig): string[] {
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	const state = createInitialState(emptyGitStatus());
	state.branch = "main";
	state.costLabel = "$1";
	state.tokenLabel = "100 tokens";
	installFooter(
		{
			cwd: "/tmp/project",
			getContextUsage: () => ({ percent: 10 }),
			sessionManager: { getSessionName: () => "Session" },
			ui: {
				setFooter: (value: typeof factory) => {
					factory = value;
				},
			},
		} as unknown as ExtensionContext,
		state,
		() => config,
		{ setRequestRender() {}, scheduleProjectRefresh() {} },
	);
	const component = factory?.({ requestRender() {} } as never, theme, {
		onBranchChange: () => () => {},
		getExtensionStatuses: () => new Map(),
	} as never);
	try {
		return component?.render(200) ?? [];
	} finally {
		component?.dispose?.();
	}
}
function selectors(config: ZentuiConfig) {
	const prototype = { render: () => ["────", "Body", "────"] };
	const cleanup = patchSelectorBorderStyle(
		prototype,
		() => theme,
		() => config,
	);
	try {
		return Reflect.apply(prototype.render, prototype, [4]);
	} finally {
		cleanup();
	}
}
function editor(config: ZentuiConfig) {
	return [
		...renderPolishedEditorFrame({
			width: 100,
			editorLines: ["draft"],
			uiTheme: theme,
			config,
			modelMeta: { modelLabel: "Model", providerLabel: "Provider" },
			thinkingLevel: "max",
		}),
		...renderMinimalistFrame({
			width: 120,
			editorLines: ["draft"],
			inputText: "draft",
			uiTheme: theme,
			config,
			metadata: {
				cwd: "/tmp/project",
				branch: "main",
				dirty: true,
				sessionName: "Session",
				costLabel: "$1",
				agentDurationMs: 5000,
				modelLabel: "Model",
				thinkingLevel: "max",
				contextPercent: 80,
			},
		}),
		...renderAccentRailEditorFrame({ width: 100, editorLines: ["draft"], uiTheme: theme, config }),
	];
}
const renderers = {
	footer,
	editor,
	selectorBorders: selectors,
	userMessages: (config: ZentuiConfig) =>
		renderUserMessageStyle({ config, text: "Hello", width: 20, theme }),
	workingLine: (config: ZentuiConfig) =>
		buildWorkingLineFrames(config.components.workingLine, config.colors, theme, "Working").frames,
};

function legacyKey(owner: ColorOwner, key: string) {
	if (
		owner === "footer" ||
		(owner === "editor" &&
			[
				"cwd",
				"sessionName",
				"gitStatus",
				"contextNormal",
				"contextWarning",
				"contextError",
				"cost",
				"sessionDuration",
			].includes(key))
	)
		return key;
	return `${owner === "workingLine" ? "workingLine" : "editor"}${key[0]?.toUpperCase()}${key.slice(1)}`;
}

describe("typed component color inheritance", () => {
	it.each(Object.keys(componentColorKeys) as ColorOwner[])(
		"resolves every %s role locally before its historical global role",
		(owner) => {
			for (const key of componentColorKeys[owner]) {
				const global = legacyKey(owner, key);
				const config = mergeConfig({
					colors: { [global]: "red" },
					components: { [owner]: { colors: { [key]: "", future: "cyan" } } },
				});
				expect(componentColor(config, owner, key)).toBe("");
				expect(config.components[owner].colors).toEqual({ [key]: "" });
				delete (config.components[owner].colors as Record<string, string>)[key];
				expect(componentColor(config, owner, key)).toBe(
					owner === "selectorBorders" ? undefined : "red",
				);
				expect(
					componentColor(
						mergeConfig({
							colors: { [global]: "green" },
							components: { [owner]: { colors: { [key]: "not-supported" } } },
						}),
						owner,
						key,
					),
				).toBe(owner === "selectorBorders" ? undefined : "green");
			}
		},
	);
	it("does not invent Footer model/provider/runtime-label or Thinking colors", () => {
		expect(componentColorKeys.footer).not.toEqual(
			expect.arrayContaining(["model", "provider", "runtime"]),
		);
		expect(componentColorKeys).not.toHaveProperty("thinkingSteps");
	});
	it("retains aliases and does not feed generated Footer branch defaults to Minimalist", () => {
		const config = mergeConfig({});
		expect(componentColor(config, "footer", "gitBranch")).toBe("bold purple");
		expect(componentColor(config, "editor", "gitBranch")).toBeUndefined();
		const aliases = mergeConfig({ colors: { cwdText: "", git: "red" } });
		expect(componentColor(aliases, "editor", "cwd")).toBe("");
		expect(componentColor(aliases, "editor", "gitBranch")).toBe("red");
		expect(
			componentColor(
				mergeConfig({ colors: { editorGitBranch: "", git: "red" } }),
				"editor",
				"gitBranch",
			),
		).toBe("");
	});
	describe.each(["theme", "terminal"] as const)("%s rendered color ownership", (source) => {
		const owners = Object.keys(componentColorKeys) as ColorOwner[];
		const cases = owners.flatMap((owner) => ["red", "error"].map((style) => ({ owner, style })));
		function assertOnlyOwnerChanged(before: ZentuiConfig, after: ZentuiConfig, owner: ColorOwner) {
			for (const surface of owners) {
				const expected = renderers[surface](before);
				const actual = renderers[surface](after);
				if (surface === owner) expect(actual, surface).not.toEqual(expected);
				else expect(actual, surface).toEqual(expected);
			}
		}
		it.each(cases)("changes only $owner with $style override", ({ owner, style }) => {
			const before = base(source);
			const config = base(source);
			config.components[owner].colors = Object.fromEntries(
				componentColorKeys[owner].map((key) => [key, style]),
			);
			assertOnlyOwnerChanged(before, config, owner);
			expect(renderers[owner](config).join("\n")).toContain(
				source === "terminal" && style === "red" ? "\x1b[31m" : themePrefix("error"),
			);
			expect(config.colors).toEqual(before.colors);
		});
		it.each(owners)("switches only $owner's source with distinguishable defaults", (owner) => {
			const before = base(source);
			const config = base(source);
			config.components[owner].colorSource = source === "theme" ? "terminal" : "theme";
			assertOnlyOwnerChanged(before, config, owner);
		});
		it.each(cases.filter(({ owner }) => owner !== "selectorBorders"))(
			"renders $owner identically with historical and local $style",
			({ owner, style }) => {
				const old = base(source);
				const local = base(source);
				const palette = Object.fromEntries(componentColorKeys[owner].map((key) => [key, style]));
				Object.assign(
					old.colors,
					Object.fromEntries(
						Object.entries(palette).map(([key, value]) => [legacyKey(owner, key), value]),
					),
				);
				local.components[owner].colors = palette;
				expect(renderers[owner](local)).toEqual(renderers[owner](old));
				expect(renderers[owner](local)).not.toEqual(renderers[owner](base(source)));
			},
		);
		it("never gives selector borders a historical editor-border fallback", () => {
			const before = base(source);
			const config = base(source);
			config.colors.editorBorder = "red";
			expect(selectors(config)).toEqual(selectors(before));
			config.components.selectorBorders.colors = { border: "red" };
			expect(selectors(config)).not.toEqual(selectors(before));
		});
		it.each(cases)(
			"roundtrips migration, $owner $style edit and reset without palette snapshots",
			({ owner, style }) => {
				const dir = mkdtempSync(join(tmpdir(), "zentui-rendered-colors-"));
				const path = join(dir, "zentui.json");
				try {
					const shared = {
						editorAccent: "green",
						editorBorder: "green",
						cwd: "green",
						workingLineHigh: "green",
					};
					writeFileSync(
						path,
						JSON.stringify({
							colors: shared,
							icons: { editorPrompt: ">" },
							components: Object.fromEntries(owners.map((key) => [key, { colorSource: source }])),
						}),
					);
					const before = mergeConfig(JSON.parse(readFileSync(path, "utf8")));
					migrateComponentSelections(path);
					const migrated = mergeConfig(JSON.parse(readFileSync(path, "utf8")));
					for (const surface of owners)
						expect(renderers[surface](migrated), surface).toEqual(renderers[surface](before));
					const saved = JSON.parse(readFileSync(path, "utf8"));
					expect(saved.colors).toEqual(shared);
					for (const surface of owners) expect(saved.components[surface].colors ?? {}).toEqual({});
					// A real owner-local save and reload, not merely an in-memory config comparison.
					const key = owner === "footer" ? "cwd" : owner === "workingLine" ? "high" : "border";
					saveComponentColor(owner, key, style, path);
					const edited = mergeConfig(JSON.parse(readFileSync(path, "utf8")));
					assertOnlyOwnerChanged(migrated, edited, owner);
					expect(JSON.parse(readFileSync(path, "utf8")).components[owner].colors).toEqual({
						[key]: style,
					});
					saveComponentColor(owner, key, undefined, path);
					const reset = mergeConfig(JSON.parse(readFileSync(path, "utf8")));
					for (const surface of owners)
						expect(renderers[surface](reset), surface).toEqual(renderers[surface](before));
					// Migration must not sever live shared fallbacks: editor/messages intentionally share editorBorder.
					const raw = JSON.parse(readFileSync(path, "utf8"));
					raw.colors = {
						editorAccent: "red",
						editorBorder: "red",
						cwd: "red",
						workingLineHigh: "red",
					};
					writeFileSync(path, JSON.stringify(raw));
					const changedShared = mergeConfig(JSON.parse(readFileSync(path, "utf8")));
					const legacyChanged = mergeConfig({
						colors: raw.colors,
						icons: raw.icons,
						components: Object.fromEntries(owners.map((key) => [key, { colorSource: source }])),
					});
					for (const surface of owners) {
						expect(renderers[surface](changedShared), surface).toEqual(
							renderers[surface](legacyChanged),
						);
						if (surface === "selectorBorders")
							expect(renderers[surface](changedShared)).toEqual(renderers[surface](before));
						else
							expect(renderers[surface](changedShared), surface).not.toEqual(
								renderers[surface](before),
							);
					}
				} finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
		);
	});
	it("keeps configured accent out of model and rail constant fallbacks", () => {
		const config = base();
		const before = base();
		config.components.editor.colors = { accent: "red" };
		expect(
			renderAccentRailEditorFrame({ width: 20, editorLines: ["draft"], config, uiTheme: theme }),
		).toEqual(
			renderAccentRailEditorFrame({
				width: 20,
				editorLines: ["draft"],
				config: before,
				uiTheme: theme,
			}),
		);
		const values = {
			model: "Model",
			modelId: "id",
			modelName: "Name",
			provider: "Provider",
			thinking: "max",
			sessionName: "Session",
		};
		expect(renderEditorMetadataFormat("$model", values, theme, config)).toBe(
			renderEditorMetadataFormat("$model", values, theme, before),
		);
		config.components.editor.colors.thinking = "red";
		expect(renderEditorMetadataFormat("$thinking", values, theme, config)).toBe(
			"\x1b[31mmax\x1b[0m",
		);
		config.components.editor.colors.thinkingXhigh = "green";
		expect(renderEditorMetadataFormat("$thinking", values, theme, config)).toBe(
			"\x1b[32mmax\x1b[0m",
		);
		config.components.editor.colors.thinkingMax = "";
		expect(renderEditorMetadataFormat("$thinking", values, theme, config)).toBe("max");
	});
	it("uses explicit prompt, then configured accent, including deliberate empty", () => {
		const config = base();
		config.components.editor.style = "opencode-copy-friendly";
		config.components.editor.colors = { accent: "red" };
		expect(editor(config).join("\n")).toContain("\x1b[31m>\x1b[0m");
		config.components.editor.colors.prompt = "green";
		expect(editor(config).join("\n")).toContain("\x1b[32m>\x1b[0m");
		config.components.editor.colors.prompt = "";
		expect(editor(config).join("\n")).not.toContain("\x1b[31m>\x1b[0m");
	});
	it("keys message caches by local colors and distinguishes inheritance from empty", () => {
		const config = base();
		const original = userMessageStyleCacheKey(config);
		config.components.editor.colors = { accent: "red" };
		expect(userMessageStyleCacheKey(config)).toBe(original);
		config.components.userMessages.colors = { accent: "" };
		expect(userMessageStyleCacheKey(config)).not.toBe(original);
		const unstyled = userMessageStyleCacheKey(config);
		config.components.userMessages.colors.accent = "red";
		expect(userMessageStyleCacheKey(config)).not.toBe(unstyled);
	});
	it("rebuilds the Working row only when effective owned palette changes", () => {
		const config = base();
		config.components.workingLine.enabled = true;
		const indicator = vi.fn();
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: { setWorkingMessage() {}, setWorkingIndicator: indicator },
		};
		const controller = new WorkingLineController(
			() => config,
			() => theme,
		);
		try {
			controller.startSession(ctx);
			const before = indicator.mock.calls.length;
			config.components.editor.colors = { accent: "red" };
			controller.reconcile(ctx);
			expect(indicator).toHaveBeenCalledTimes(before);
			config.components.workingLine.colors = { high: "red" };
			controller.reconcile(ctx);
			expect(indicator).toHaveBeenCalledTimes(before + 1);
			config.colors.workingLineHigh = "green";
			controller.reconcile(ctx);
			expect(indicator).toHaveBeenCalledTimes(before + 1);
			delete config.components.workingLine.colors.high;
			controller.reconcile(ctx);
			expect(indicator).toHaveBeenCalledTimes(before + 2);
		} finally {
			controller.dispose(ctx);
		}
	});
	it("uses local high for persisted and legacy summaries, retaining safe-cyan substitution", () => {
		const config = base();
		config.colors.workingLineHigh = "green";
		config.components.workingLine.colors = { high: "red" };
		const prefix = snapshotWorkingLineHighStyle(
			theme,
			config.components.workingLine,
			config.colors,
		);
		expect(prefix).toBe("\x1b[31m");
		const data = {
			version: 3,
			durationMs: 1000,
			thoughtDurationMs: 0,
			input: 1,
			output: 2,
			stylePrefix: prefix,
		};
		expect(renderTurnSummaryEntry({ data }, {}, theme)?.render(100).join("")).toContain(prefix);
		expect(
			renderTurnSummaryEntry(
				{ data: { version: 1, durationMs: 1000, input: 1, output: 2 } },
				{ colorSource: "terminal", workingLineHigh: componentColor(config, "workingLine", "high") },
				theme,
			)
				?.render(100)
				.join(""),
		).toContain(prefix);
		for (const value of ["", "   "]) {
			config.components.workingLine.colors.high = value;
			expect(
				snapshotWorkingLineHighStyle(theme, config.components.workingLine, config.colors),
			).toBe("\x1b[1;36m");
		}
	});
});
