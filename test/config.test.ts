import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_COMPACT_FOOTER_FORMAT,
	DEFAULT_EDITOR_METADATA_FORMAT,
	defaultConfig,
	ensureConfigExists,
	FOOTER_FORMAT_VARIABLES,
	getExtensionStatusColorMode,
	getExtensionStatusPlacement,
	hasUnsupportedComponentStyle,
	mergeConfig,
	saveColorSourcesPatch,
	saveContextStylePatch,
	saveContextThresholdsPatch,
	saveEditorBorderColorMode,
	saveEditorComponentPatch,
	saveEditorModelLabel,
	saveEditorStyle,
	saveExtensionStatusColorMode,
	saveExtensionStatusDefaultPlacement,
	saveExtensionStatusPlacement,
	saveFixedEditorPatch,
	saveFooterComponentPatch,
	saveFooterFormatPatch,
	saveFooterSegmentsPatch,
	saveGitBranchPatch,
	saveGitCommitPatch,
	saveGitMetricsPatch,
	saveLayoutFixedEditorPatch,
	saveMinimalistEditorStylePatch,
	saveMinimalistPatch,
	savePathDisplayPatch,
	savePolishedCopyFriendlyEditorStylePatch,
	savePolishedEditorStylePatch,
	saveResponsiveFooterPatch,
	saveSelectorBordersComponentPatch,
	saveSeparatorPatch,
	saveStarshipFooterStylePatch,
	saveUiFeaturesPatch,
	saveUserMessagesComponentPatch,
} from "../extensions/zentui/config";
import {
	colorize,
	renderChromeBorder,
	renderStyle,
	renderStyleForSource,
	renderTerminalStyle,
} from "../extensions/zentui/style";

function configTempFiles(dir: string, filename = "zentui.json"): string[] {
	return readdirSync(dir).filter(
		(name) => name.startsWith(`.${filename}.`) && name.endsWith(".tmp"),
	);
}

function withConfig(
	initial: Record<string, unknown> | undefined,
	assertions: (path: string, dir: string) => void,
): void {
	const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
	const path = join(dir, "zentui.json");
	try {
		if (initial !== undefined) writeFileSync(path, `${JSON.stringify(initial, null, 2)}\n`);
		assertions(path, dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// biome-ignore lint/suspicious/noExplicitAny: Tests intentionally inspect arbitrary JSON fixture shapes.
function readRaw(path: string): Record<string, any> {
	return JSON.parse(readFileSync(path, "utf8"));
}

describe("canonical config resolution", () => {
	it("provides complete canonical defaults and the established palette defaults", () => {
		const config = mergeConfig({});
		expect(config.components).toEqual({
			editor: {
				enabled: true,
				style: "opencode",
				colorSource: "theme",
				borderColorMode: "static",
				modelLabel: "id",
				viewportIndicators: true,
				styles: {
					opencode: {
						metadataFormat: DEFAULT_EDITOR_METADATA_FORMAT,
					},
					"opencode-copy-friendly": {
						metadataFormat: DEFAULT_EDITOR_METADATA_FORMAT,
					},
					minimalist: {
						pathDisplay: "compact",
						contextFormat: "percent",
						contextGauge: false,
						showSessionName: true,
						showTimer: true,
						showCost: true,
						showGit: true,
						contextThresholds: { warning: 70, error: 90 },
					},
				},
			},
			userMessages: {
				enabled: true,
				style: "framed",
				colorSource: "theme",
				styles: { framed: {}, "framed-copy-friendly": {}, compact: {}, labeled: {} },
			},
			selectorBorders: { enabled: true, style: "zentui", colorSource: "theme" },
			footer: {
				style: "starship",
				colorSource: "theme",
				modelLabel: "id",
				styles: {
					starship: {
						format: "",
						responsive: true,
						compactFormat: DEFAULT_COMPACT_FOOTER_FORMAT,
						compactMaxLines: 2,
						separator: "pipe",
						contextStyle: "text",
						contextThresholds: { warning: 70, error: 90 },
						pathDisplay: { mode: "basename", depth: 0 },
						segments: defaultConfig.footerSegments,
						gitBranch: { maxLength: "full" },
						gitCommit: { hashLength: 7, onlyDetached: true, showTag: true },
						gitMetrics: { onlyNonzero: true, ignoreSubmodules: false },
						extensionStatuses: {
							defaultPlacement: "right",
							placements: {},
							colorModes: {},
						},
					},
				},
			},
		});
		expect(config.layout).toEqual({
			fixedEditor: { enabled: false, mouseScroll: true, copyNotice: true },
		});
		expect(config.projectRefreshIntervalMs).toBe(30_000);
		expect(config.icons.cacheHit).toBe("󰆼");
		expect(config.colors).toEqual(defaultConfig.colors);
		expect(defaultConfig.components).toEqual(config.components);
		expect(defaultConfig.layout).toEqual(config.layout);
	});

	it("migrates every released legacy field leaf-by-leaf", () => {
		const config = mergeConfig({
			features: {
				editor: false,
				statusLine: false,
				viewportIndicators: false,
				copyFriendly: true,
			},
			colorSources: { editor: "terminal", userMessages: "terminal", starship: "terminal" },
			editorBorderColorMode: "adaptive",
			editorModelLabel: "name",
			editorMetadataFormat: "$model",
			contextThresholds: { warning: 55, error: 88 },
			footerFormat: "$cwd",
			responsiveFooter: false,
			compactFooterFormat: "$context",
			compactFooterMaxLines: 3,
			separator: "dot",
			contextStyle: "gauge",
			pathDisplay: { mode: "full", depth: 2 },
			footerSegments: { cwd: false, modelInfo: true },
			gitBranch: { maxLength: 18 },
			gitCommit: { hashLength: 12, onlyDetached: false, showTag: false },
			gitMetrics: { onlyNonzero: false, ignoreSubmodules: true },
			extensionStatuses: {
				defaultPlacement: "middle",
				placements: { alpha: "left" },
				colorModes: { alpha: "original" },
			},
			fixedEditor: { enabled: true, mouseScroll: false, copyNotice: false },
		});
		const { editor, userMessages, selectorBorders, footer } = config.components;
		const starship = footer.styles.starship;
		expect([editor.enabled, userMessages.enabled, selectorBorders.enabled]).toEqual([
			false,
			false,
			false,
		]);
		expect(editor.viewportIndicators).toBe(false);
		expect(editor.style).toBe("opencode-copy-friendly");
		expect(userMessages).toMatchObject({ enabled: false, style: "framed-copy-friendly" });
		expect([editor.colorSource, selectorBorders.colorSource]).toEqual(["terminal", "terminal"]);
		expect(userMessages.colorSource).toBe("terminal");
		expect(footer.colorSource).toBe("terminal");
		expect(editor.borderColorMode).toBe("adaptive");
		expect([editor.modelLabel, footer.modelLabel]).toEqual(["name", "name"]);
		expect(editor.styles.opencode.metadataFormat).toBe("$model");
		expect(editor.styles.minimalist.contextThresholds).toEqual({ warning: 55, error: 88 });
		expect(starship).toMatchObject({
			format: "$cwd",
			responsive: false,
			compactFormat: "$context",
			compactMaxLines: 3,
			separator: "dot",
			contextStyle: "gauge",
			contextThresholds: { warning: 55, error: 88 },
			pathDisplay: { mode: "full", depth: 2 },
			gitBranch: { maxLength: 18 },
			gitCommit: { hashLength: 12, onlyDetached: false, showTag: false },
			gitMetrics: { onlyNonzero: false, ignoreSubmodules: true },
			extensionStatuses: {
				defaultPlacement: "middle",
				placements: { alpha: "left" },
				colorModes: { alpha: "original" },
			},
		});
		expect(starship.segments).toMatchObject({ cwd: false, modelInfo: true });
		expect(config.layout.fixedEditor).toEqual({
			enabled: true,
			mouseScroll: false,
			copyNotice: false,
		});
	});

	it("gives canonical leaves precedence, including false and invalid-but-present values", () => {
		const config = mergeConfig({
			features: { editor: true, copyFriendly: true, viewportIndicators: false },
			colorSources: { editor: "terminal" },
			editorBorderColorMode: "adaptive",
			editorMetadataFormat: "$legacy",
			components: {
				editor: {
					enabled: false,
					style: "unknown",
					colorSource: "unknown",
					styles: {
						polished: { copyFriendly: "yes" },
					},
				},
			},
		});
		expect(config.components.editor.enabled).toBe(false);
		expect(config.components.editor.style).toBe("opencode");
		expect(config.components.editor.colorSource).toBe("theme");
		// Missing canonical siblings still migrate independently.
		expect(config.components.editor.viewportIndicators).toBe(false);
		expect(config.components.editor.borderColorMode).toBe("adaptive");
		expect(config.components.editor.styles.opencode.metadataFormat).toBe("$legacy");
	});

	it("normalizes every canonical minimalist leaf without reviving branch-only inputs", () => {
		for (const pathDisplay of ["compact", "project", "full"]) {
			expect(
				mergeConfig({
					components: { editor: { styles: { minimalist: { pathDisplay } } } },
				}).components.editor.styles.minimalist.pathDisplay,
			).toBe(pathDisplay);
		}
		for (const pathDisplay of ["basename", "", 1, null, true]) {
			expect(
				mergeConfig({
					editorStyles: { minimalist: { pathDisplay: "full" } },
					components: { editor: { styles: { minimalist: { pathDisplay } } } },
				}).components.editor.styles.minimalist.pathDisplay,
			).toBe("compact");
		}

		for (const contextFormat of ["percent", "percent-total"]) {
			expect(
				mergeConfig({
					components: { editor: { styles: { minimalist: { contextFormat } } } },
				}).components.editor.styles.minimalist.contextFormat,
			).toBe(contextFormat);
		}
		for (const contextFormat of ["tokens", "", 1, null, true]) {
			expect(
				mergeConfig({
					editorStyles: { minimalist: { contextFormat: "percent-total" } },
					components: { editor: { styles: { minimalist: { contextFormat } } } },
				}).components.editor.styles.minimalist.contextFormat,
			).toBe("percent");
		}

		const valid = mergeConfig({
			components: {
				editor: {
					styles: {
						minimalist: {
							contextGauge: true,
							showSessionName: false,
							showTimer: false,
							showCost: false,
							showGit: false,
						},
					},
				},
			},
		}).components.editor.styles.minimalist;
		expect(valid).toMatchObject({
			contextGauge: true,
			showSessionName: false,
			showTimer: false,
			showCost: false,
			showGit: false,
		});

		const invalid = mergeConfig({
			editorStyles: {
				minimalist: {
					contextGauge: true,
					showSessionName: false,
					showTimer: false,
					showCost: false,
					showGit: false,
				},
			},
			components: {
				editor: {
					styles: {
						minimalist: {
							contextGauge: "yes",
							showSessionName: "yes",
							showTimer: null,
							showCost: 0,
							showGit: "no",
						},
					},
				},
			},
		}).components.editor.styles.minimalist;
		expect(invalid).toEqual(defaultConfig.components.editor.styles.minimalist);
	});

	it("ignores branch-only editorStyle/editorStyles and safely defaults closed style IDs", () => {
		const config = mergeConfig({
			editorStyle: "minimalist",
			editorStyles: { minimalist: { showGit: false } },
			components: {
				editor: { style: "future" },
				userMessages: { style: "future" },
				selectorBorders: { style: "future" },
				footer: { style: "future" },
			},
		});
		expect(config.components.editor.style).toBe("opencode");
		expect(config.components.editor.styles.minimalist.showGit).toBe(true);
		expect(config.components.userMessages.style).toBe("framed");
		expect(config.components.selectorBorders.style).toBe("zentui");
		expect(config.components.footer.style).toBe("starship");
	});

	it("does not treat native as a User-message style", () => {
		expect(
			mergeConfig({ components: { userMessages: { style: "native" } } }).components.userMessages
				.style,
		).toBe("framed");
	});

	it("normalizes nested canonical leaves without falling through to contradictory legacy leaves", () => {
		const config = mergeConfig({
			contextThresholds: { warning: 20, error: 80 },
			pathDisplay: { mode: "full", depth: 4 },
			components: {
				editor: {
					styles: { minimalist: { contextThresholds: { warning: "bad" } } },
				},
				footer: {
					styles: {
						starship: {
							contextThresholds: { warning: "bad" },
							pathDisplay: { mode: "bad" },
						},
					},
				},
			},
		});
		expect(config.components.editor.styles.minimalist.contextThresholds).toEqual({
			warning: 70,
			error: 80,
		});
		expect(config.components.footer.styles.starship.contextThresholds).toEqual({
			warning: 70,
			error: 80,
		});
		expect(config.components.footer.styles.starship.pathDisplay).toEqual({
			mode: "basename",
			depth: 4,
		});
	});

	it("projects the intentionally lossy flat compatibility view from canonical sources", () => {
		const config = mergeConfig({
			components: {
				editor: {
					enabled: false,
					style: "minimalist",
					colorSource: "terminal",
					modelLabel: "name",
					styles: { opencode: { copyFriendly: true, metadataFormat: "$model" } },
				},
				userMessages: {
					enabled: true,
					colorSource: "theme",
					styles: { framed: { copyFriendly: false } },
				},
				selectorBorders: { enabled: true, colorSource: "theme" },
				footer: {
					modelLabel: "id",
					colorSource: "terminal",
					styles: { starship: { contextThresholds: { warning: 40, error: 60 } } },
				},
			},
		});
		const starship = config.components.footer.styles.starship;
		expect(config.footerFormat).toBe(starship.format);
		expect(config.responsiveFooter).toBe(starship.responsive);
		expect(config.compactFooterFormat).toBe(starship.compactFormat);
		expect(config.compactFooterMaxLines).toBe(starship.compactMaxLines);
		expect(config.separator).toBe(starship.separator);
		expect(config.contextStyle).toBe(starship.contextStyle);
		expect(config.contextThresholds).toBe(starship.contextThresholds);
		expect(config.pathDisplay).toBe(starship.pathDisplay);
		expect(config.footerSegments).toBe(starship.segments);
		expect(config.gitBranch).toBe(starship.gitBranch);
		expect(config.gitCommit).toBe(starship.gitCommit);
		expect(config.gitMetrics).toBe(starship.gitMetrics);
		expect(config.extensionStatuses).toBe(starship.extensionStatuses);
		expect(config.features).toEqual({
			editor: false,
			statusLine: true,
			viewportIndicators: true,
		});
		expect(config.colorSources).toEqual({
			starship: "terminal",
			editor: "terminal",
			userMessages: "theme",
		});
		expect(config.editorModelLabel).toBe("name");
		expect(config.contextThresholds).toEqual({ warning: 40, error: 60 });
	});

	it("does not mutate the parsed record", () => {
		const parsed = {
			features: { editor: false },
			components: { editor: { styles: { opencode: { copyFriendly: true } } } },
		};
		const before = structuredClone(parsed);
		mergeConfig(parsed);
		expect(parsed).toEqual(before);
	});

	it("retains root parsing behavior for intervals, icons, colors, and telemetry variables", () => {
		const config = mergeConfig({
			projectRefreshIntervalMs: 100,
			icons: { mode: "ascii", cwd: "DIR" },
			colors: { gitBranch: "syntaxKeyword", editorAccent: "accent" },
		});
		expect(config.projectRefreshIntervalMs).toBe(5_000);
		expect(config.icons.cwd).toBe("DIR");
		expect(config.colors.gitBranch).toBe("syntaxKeyword");
		expect(config.colors.editorAccent).toBe("accent");
		expect(FOOTER_FORMAT_VARIABLES).toEqual(
			expect.arrayContaining(["cache_read", "cache_write", "subscription", "auto_compaction"]),
		);
	});
});

describe("Phase 4 style migration", () => {
	it.each([
		[true, "opencode-copy-friendly"],
		[false, "opencode"],
		["invalid", "opencode"],
	] as const)("maps a present nested Editor flag %s deterministically", (copyFriendly, style) => {
		const config = mergeConfig({
			features: { copyFriendly: true },
			components: {
				editor: { style: "polished", styles: { polished: { copyFriendly } } },
			},
		});
		expect(config.components.editor.style).toBe(style);
	});

	it.each([
		[true, "framed-copy-friendly"],
		[false, "framed"],
		["invalid", "framed"],
	] as const)("maps a present nested message flag %s deterministically", (copyFriendly, style) => {
		const config = mergeConfig({
			features: { editor: true, copyFriendly: true },
			components: {
				userMessages: {
					enabled: true,
					style: "framed",
					styles: { framed: { copyFriendly } },
				},
			},
		});
		expect(config.components.userMessages).toMatchObject({ style, enabled: true });
	});

	it("maps the released feature flag to copy-friendly Editor and messages", () => {
		const migrated = mergeConfig({ features: { copyFriendly: true } });
		expect(migrated.components.editor.style).toBe("opencode-copy-friendly");
		expect(migrated.components.userMessages).toMatchObject({
			style: "framed-copy-friendly",
			enabled: true,
		});

		const regular = mergeConfig({ features: { copyFriendly: false } });
		expect(regular.components.editor.style).toBe("opencode");
		expect(regular.components.userMessages).toMatchObject({ style: "framed", enabled: true });
		expect(migrated.features).not.toHaveProperty("copyFriendly");
	});

	it.each([
		[undefined, true, "opencode-copy-friendly"],
		[undefined, false, "opencode"],
		[undefined, "invalid", "opencode"],
		["future", true, "opencode-copy-friendly"],
		["future", false, "opencode"],
		["future", "invalid", "opencode"],
	] as const)(
		"resolves absent or invalid Editor style %s from nested flag %s",
		(rawStyle, copyFriendly, expected) => {
			const config = mergeConfig({
				features: { copyFriendly: copyFriendly !== true },
				components: {
					editor: {
						...(rawStyle === undefined ? {} : { style: rawStyle }),
						styles: { polished: { copyFriendly } },
					},
				},
			});
			expect(config.components.editor.style).toBe(expected);
		},
	);

	it.each([
		[undefined, true, "framed-copy-friendly"],
		[undefined, false, "framed"],
		[undefined, "invalid", "framed"],
		["future", true, "framed-copy-friendly"],
		["future", false, "framed"],
		["future", "invalid", "framed"],
	] as const)(
		"resolves absent or invalid message style %s from nested flag %s",
		(rawStyle, copyFriendly, expectedStyle) => {
			const config = mergeConfig({
				features: { editor: true, copyFriendly: copyFriendly !== true },
				components: {
					userMessages: {
						enabled: true,
						...(rawStyle === undefined ? {} : { style: rawStyle }),
						styles: { framed: { copyFriendly } },
					},
				},
			});
			expect(config.components.userMessages).toMatchObject({
				style: expectedStyle,
				enabled: true,
			});
		},
	);

	it("treats ambiguous explicit styles without nested flags as authoritative", () => {
		const config = mergeConfig({
			features: { editor: true, copyFriendly: true },
			components: {
				editor: { style: "opencode" },
				userMessages: { enabled: true, style: "framed" },
			},
		});
		expect(config.components.editor.style).toBe("opencode");
		expect(config.components.userMessages).toMatchObject({ style: "framed", enabled: true });
	});

	it("uses released flags for absent or invalid styles without nested flags", () => {
		for (const style of [undefined, "future"] as const) {
			const config = mergeConfig({
				features: { editor: true, copyFriendly: true },
				components: {
					editor: style === undefined ? {} : { style },
					userMessages: style === undefined ? { enabled: true } : { enabled: true, style },
				},
			});
			expect(config.components.editor.style).toBe("opencode-copy-friendly");
			expect(config.components.userMessages).toMatchObject({
				style: "framed-copy-friendly",
				enabled: true,
			});
		}
	});

	it.each([
		["minimalist", "compact"],
		["opencode-copy-friendly", "labeled"],
		["opencode", "framed-copy-friendly"],
	] as const)("preserves unambiguous explicit styles %s and %s", (editorStyle, messageStyle) => {
		const config = mergeConfig({
			features: { copyFriendly: true },
			components: {
				editor: {
					style: editorStyle,
					styles: { opencode: { copyFriendly: true } },
				},
				userMessages: {
					enabled: true,
					style: messageStyle,
					styles: { framed: { copyFriendly: true } },
				},
			},
		});
		expect(config.components.editor.style).toBe(editorStyle);
		expect(config.components.userMessages).toMatchObject({ style: messageStyle, enabled: true });
	});

	it("seeds and parses polished metadata independently", () => {
		const seeded = mergeConfig({ editorMetadataFormat: "$legacy" });
		expect(seeded.components.editor.styles.opencode.metadataFormat).toBe("$legacy");
		expect(seeded.components.editor.styles["opencode-copy-friendly"].metadataFormat).toBe(
			"$legacy",
		);
		const independent = mergeConfig({
			editorMetadataFormat: "$flat",
			components: {
				editor: {
					styles: {
						polished: { metadataFormat: "$regular" },
						"opencode-copy-friendly": { metadataFormat: "$low" },
					},
				},
			},
		});
		expect(independent.components.editor.styles.opencode.metadataFormat).toBe("$regular");
		expect(independent.components.editor.styles["opencode-copy-friendly"].metadataFormat).toBe(
			"$low",
		);
	});

	it("deletes only obsolete owning leaves on explicit style saves", () => {
		withConfig(
			{
				features: { copyFriendly: true },
				components: {
					editor: {
						styles: {
							polished: { copyFriendly: true, sibling: "keep" },
							future: { keep: true },
						},
					},
					userMessages: {
						styles: { framed: { copyFriendly: true, sibling: "keep" }, future: { keep: true } },
					},
				},
			},
			(path) => {
				saveEditorComponentPatch({ style: "opencode" }, path);
				const afterEditor = readRaw(path);
				expect(afterEditor.components.editor.styles.polished).toMatchObject({ sibling: "keep" });
				expect(afterEditor.components.editor.styles.polished).not.toHaveProperty("copyFriendly");
				expect(afterEditor.components.editor.styles.opencode).toHaveProperty("metadataFormat");
				expect(afterEditor.components.userMessages.styles.framed).toMatchObject({
					copyFriendly: true,
					sibling: "keep",
				});

				saveUserMessagesComponentPatch({ style: "framed" }, path);
				const raw = readRaw(path);
				expect(raw.components.editor.styles.polished).toMatchObject({ sibling: "keep" });
				expect(raw.components.editor.styles.polished).not.toHaveProperty("copyFriendly");
				expect(raw.components.userMessages.styles.framed).toMatchObject({ sibling: "keep" });
				expect(raw.components.userMessages.styles.framed).not.toHaveProperty("copyFriendly");
				expect(raw.components.editor.styles.future).toEqual({ keep: true });
				expect(raw.components.userMessages.styles.future).toEqual({ keep: true });
				expect(raw.features.copyFriendly).toBe(true);
				const reloaded = mergeConfig(raw);
				expect(reloaded.components.editor.style).toBe("opencode");
				expect(reloaded.components.userMessages).toMatchObject({ style: "framed", enabled: true });
			},
		);
	});

	it.each(["framed", "framed-copy-friendly"] as const)(
		"cleans only the obsolete nested flag when explicitly saving %s",
		(style) => {
			withConfig(
				{
					features: { copyFriendly: true },
					components: {
						userMessages: {
							styles: {
								framed: { copyFriendly: true, sibling: "keep" },
								future: { keep: true },
							},
							futureComponent: "keep",
						},
					},
				},
				(path) => {
					saveUserMessagesComponentPatch({ style }, path);
					const raw = readRaw(path);
					expect(raw.components.userMessages.style).toBe(style);
					expect(raw.components.userMessages.styles.framed).toEqual({ sibling: "keep" });
					expect(raw.components.userMessages.styles.future).toEqual({ keep: true });
					expect(raw.components.userMessages.futureComponent).toBe("keep");
					expect(raw.features.copyFriendly).toBe(true);
					expect(mergeConfig(raw).components.userMessages.style).toBe(style);
				},
			);
		},
	);

	it.each([
		[
			"Editor",
			"editor",
			(path: string) => saveEditorComponentPatch({ enabled: false }, path),
			(path: string) => saveEditorComponentPatch({ style: "opencode" }, path),
			"opencode",
		],
		[
			"User messages",
			"userMessages",
			(path: string) => saveUserMessagesComponentPatch({ enabled: false }, path),
			(path: string) => saveUserMessagesComponentPatch({ style: "framed" }, path),
			"framed",
		],
		[
			"Selector borders",
			"selectorBorders",
			(path: string) => saveSelectorBordersComponentPatch({ enabled: false }, path),
			(path: string) => saveSelectorBordersComponentPatch({ style: "zentui" }, path),
			"zentui",
		],
		[
			"Footer",
			"footer",
			(path: string) => saveFooterComponentPatch({ colorSource: "terminal" }, path),
			(path: string) => saveFooterComponentPatch({ style: "starship" }, path),
			"starship",
		],
	] as const)(
		"preserves an unknown raw %s style until its owning style is explicitly selected",
		(_label, owner, saveUnrelated, saveStyle, expectedStyle) => {
			withConfig(
				{
					components: {
						[owner]: {
							style: `future-${owner}`,
							futureOption: "keep",
							styles: { future: { keep: true } },
						},
					},
				},
				(path) => {
					const unrelatedConfig = saveUnrelated(path);
					expect(hasUnsupportedComponentStyle(unrelatedConfig, owner)).toBe(true);
					const preserved = readRaw(path);
					expect(preserved.components[owner].style).toBe(`future-${owner}`);
					expect(preserved.components[owner].futureOption).toBe("keep");
					expect(preserved.components[owner].styles.future).toEqual({ keep: true });

					const replacedConfig = saveStyle(path);
					expect(hasUnsupportedComponentStyle(replacedConfig, owner)).toBe(false);
					const replaced = readRaw(path);
					expect(replaced.components[owner].style).toBe(expectedStyle);
					expect(replaced.components[owner].futureOption).toBe("keep");
					expect(replaced.components[owner].styles.future).toEqual({ keep: true });
				},
			);
		},
	);
});

describe("canonical snapshot persistence", () => {
	it("materializes every component from legacy inputs and preserves unknown data", () => {
		withConfig(
			{
				unknownTop: { keep: true },
				features: { editor: false, copyFriendly: true },
				colorSources: { editor: "terminal" },
				components: {
					futureDomain: { keep: true },
					editor: {
						futureComponent: true,
						styles: {
							futureStyle: { keep: true },
							polished: { futurePolished: true },
						},
					},
					footer: {
						styles: {
							starship: {
								futureStarship: true,
								pathDisplay: { futurePath: true },
								extensionStatuses: { futureStatuses: true },
							},
						},
					},
				},
			},
			(path) => {
				const config = saveEditorComponentPatch({ enabled: true }, path);
				const raw = readRaw(path);
				expect(Object.keys(raw.components)).toEqual(
					expect.arrayContaining([
						"editor",
						"userMessages",
						"selectorBorders",
						"footer",
						"futureDomain",
					]),
				);
				expect(raw.components.editor.enabled).toBe(true);
				expect(raw.components.userMessages.enabled).toBe(false);
				expect(raw.components.selectorBorders.enabled).toBe(false);
				expect(raw.components.editor.style).toBe("opencode-copy-friendly");
				expect(raw.components.userMessages.enabled).toBe(false);
				expect(raw.components.editor.colorSource).toBe("terminal");
				expect(raw.components.selectorBorders.colorSource).toBe("terminal");
				expect(raw.features).toEqual({ editor: false, copyFriendly: true });
				expect(raw.unknownTop).toEqual({ keep: true });
				expect(raw.components.futureDomain).toEqual({ keep: true });
				expect(raw.components.editor.futureComponent).toBe(true);
				expect(raw.components.editor.styles.futureStyle).toEqual({ keep: true });
				expect(raw.components.editor.styles.polished.futurePolished).toBe(true);
				expect(raw.components.footer.styles.starship.futureStarship).toBe(true);
				expect(raw.components.footer.styles.starship.pathDisplay.futurePath).toBe(true);
				expect(raw.components.footer.styles.starship.extensionStatuses.futureStatuses).toBe(true);
				expect(config).toEqual(mergeConfig(raw));
			},
		);
	});

	it("prevents legacy edits from recoupling surfaces after the first save", () => {
		withConfig({ features: { editor: false, copyFriendly: true } }, (path) => {
			saveEditorComponentPatch({ enabled: true }, path);
			const raw = readRaw(path);
			expect(raw.components.editor.enabled).toBe(true);
			expect(raw.components.userMessages.enabled).toBe(false);
			expect(raw.components.selectorBorders.enabled).toBe(false);
			expect(raw.components.editor.style).toBe("opencode-copy-friendly");
			expect(raw.components.userMessages.enabled).toBe(false);
			raw.features.editor = true;
			raw.features.copyFriendly = false;
			writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
			const reloaded = mergeConfig(readRaw(path));
			expect(reloaded.components.editor.enabled).toBe(true);
			expect(reloaded.components.userMessages.enabled).toBe(false);
			expect(reloaded.components.selectorBorders.enabled).toBe(false);
			expect(reloaded.components.editor.style).toBe("opencode-copy-friendly");
			expect(reloaded.components.userMessages.enabled).toBe(false);
		});
	});

	it("supports every typed component saver without discarding inactive styles", () => {
		withConfig(undefined, (path) => {
			savePolishedEditorStylePatch({ metadataFormat: "$provider" }, path);
			savePolishedCopyFriendlyEditorStylePatch({ metadataFormat: "$model" }, path);
			saveMinimalistEditorStylePatch({ showGit: false, contextGauge: true }, path);
			saveUserMessagesComponentPatch({ enabled: false, colorSource: "terminal" }, path);
			saveSelectorBordersComponentPatch({ enabled: false, colorSource: "terminal" }, path);
			saveFooterComponentPatch({ style: "native", modelLabel: "name" }, path);
			saveStarshipFooterStylePatch(
				{ separator: "chevron", pathDisplay: { mode: "full", depth: 2 } },
				path,
			);
			const config = mergeConfig(readRaw(path));
			expect(config.components.editor.styles.opencode).toEqual({
				metadataFormat: "$provider",
			});
			expect(config.components.editor.styles["opencode-copy-friendly"]).toEqual({
				metadataFormat: "$model",
			});
			expect(config.components.editor.styles.minimalist).toMatchObject({
				showGit: false,
				contextGauge: true,
			});
			expect(config.components.userMessages).toMatchObject({
				enabled: false,
				colorSource: "terminal",
			});
			expect(config.components.selectorBorders).toMatchObject({
				enabled: false,
				colorSource: "terminal",
			});
			expect(config.components.footer).toMatchObject({ style: "native", modelLabel: "name" });
			expect(config.components.footer.styles.starship).toMatchObject({
				separator: "chevron",
				pathDisplay: { mode: "full", depth: 2 },
			});
		});
	});

	it("materializes layout.fixedEditor while preserving layout and legacy data", () => {
		withConfig(
			{
				fixedEditor: { enabled: true, mouseScroll: false, legacyUnknown: true },
				layout: { futureLayout: true, fixedEditor: { futureFixed: true } },
			},
			(path) => {
				const config = saveLayoutFixedEditorPatch({ copyNotice: false }, path);
				const raw = readRaw(path);
				expect(raw.layout).toEqual({
					futureLayout: true,
					fixedEditor: {
						futureFixed: true,
						enabled: true,
						mouseScroll: false,
						copyNotice: false,
					},
				});
				expect(raw.fixedEditor).toEqual({
					enabled: true,
					mouseScroll: false,
					legacyUnknown: true,
				});
				expect(config.fixedEditor).toEqual({
					enabled: true,
					mouseScroll: false,
					copyNotice: false,
				});
			},
		);
	});
});

describe("compatibility saver recipes", () => {
	it("writes canonical paths only and updates all historically coupled destinations", () => {
		withConfig(
			{
				features: { editor: true, statusLine: true, copyFriendly: false },
				colorSources: { editor: "theme", starship: "theme", userMessages: "theme" },
				editorModelLabel: "id",
				footerFormat: "$legacy",
				unknown: true,
			},
			(path) => {
				const legacyBefore = structuredClone(readRaw(path));
				saveColorSourcesPatch(
					{ editor: "terminal", starship: "terminal", userMessages: "terminal" },
					path,
				);
				saveUiFeaturesPatch({ editor: false, statusLine: false, viewportIndicators: false }, path);
				saveEditorModelLabel("name", path);
				saveEditorStyle("minimalist", path);
				saveMinimalistPatch({ showTimer: false, showGit: false }, path);
				saveEditorBorderColorMode("adaptive", path);
				saveFooterFormatPatch("$cwd", path);
				saveResponsiveFooterPatch(
					{ responsiveFooter: false, compactFooterFormat: "$context", compactFooterMaxLines: 3 },
					path,
				);
				saveSeparatorPatch("dot", path);
				saveContextStylePatch("text+gauge", path);
				saveContextThresholdsPatch({ warning: 45, error: 75 }, path);
				savePathDisplayPatch({ mode: "full", depth: 3 }, path);
				saveFooterSegmentsPatch({ modelInfo: true, tokens: false }, path);
				saveGitBranchPatch({ maxLength: 24 }, path);
				saveGitCommitPatch({ onlyDetached: false, showTag: false }, path);
				saveGitMetricsPatch({ onlyNonzero: false, ignoreSubmodules: true }, path);
				saveExtensionStatusDefaultPlacement("middle", path);
				saveExtensionStatusPlacement("alpha", "left", path);
				saveExtensionStatusColorMode("alpha", "original", path);
				const raw = readRaw(path);
				const config = mergeConfig(raw);
				expect(raw.features).toEqual(legacyBefore.features);
				expect(raw.colorSources).toEqual(legacyBefore.colorSources);
				expect(raw.editorModelLabel).toBe("id");
				expect(raw.footerFormat).toBe("$legacy");
				expect(raw.unknown).toBe(true);
				expect(raw).not.toHaveProperty("editorStyle");
				expect(raw).not.toHaveProperty("editorStyles");
				expect(config.components.editor).toMatchObject({
					enabled: false,
					style: "minimalist",
					colorSource: "terminal",
					borderColorMode: "adaptive",
					modelLabel: "name",
					viewportIndicators: false,
				});
				expect(config.components.userMessages).toMatchObject({
					enabled: false,
					colorSource: "terminal",
				});
				expect(config.components.selectorBorders).toMatchObject({
					enabled: false,
					colorSource: "terminal",
				});
				expect(config.components.editor.styles.minimalist).toMatchObject({
					showTimer: false,
					showGit: false,
					contextThresholds: { warning: 45, error: 75 },
				});
				expect(config.components.footer).toMatchObject({
					style: "native",
					colorSource: "terminal",
					modelLabel: "name",
				});
				expect(config.components.footer.styles.starship).toMatchObject({
					format: "$cwd",
					responsive: false,
					compactFormat: "$context",
					compactMaxLines: 3,
					separator: "dot",
					contextStyle: "text+gauge",
					contextThresholds: { warning: 45, error: 75 },
					pathDisplay: { mode: "full", depth: 3 },
					segments: { modelInfo: true, tokens: false },
					gitBranch: { maxLength: 24 },
					gitCommit: { onlyDetached: false, showTag: false },
					gitMetrics: { onlyNonzero: false, ignoreSubmodules: true },
					extensionStatuses: {
						defaultPlacement: "middle",
						placements: { alpha: "left" },
						colorModes: { alpha: "original" },
					},
				});
			},
		);
	});

	it("materializes a complete snapshot when a compatibility saver creates the file", () => {
		withConfig(undefined, (path) => {
			saveUiFeaturesPatch({ editor: false }, path);
			const raw = readRaw(path);
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(Object.keys(raw.components).sort()).toEqual([
				"editor",
				"footer",
				"selectorBorders",
				"userMessages",
			]);
			expect(raw.components.editor.enabled).toBe(false);
			expect(raw.components.userMessages.enabled).toBe(false);
			expect(raw.components.selectorBorders.enabled).toBe(false);
			expect(raw).not.toHaveProperty("features");
		});
	});

	it("routes saveFixedEditorPatch to canonical layout only", () => {
		withConfig(undefined, (path) => {
			const config = saveFixedEditorPatch({ enabled: true }, path);
			const raw = readRaw(path);
			expect(raw).toEqual({
				layout: { fixedEditor: { enabled: true, mouseScroll: true, copyNotice: true } },
			});
			expect(config.fixedEditor.enabled).toBe(true);
			expect(raw).not.toHaveProperty("fixedEditor");
		});
	});
});

describe("mergeConfig", () => {
	it("defaults project refresh polling to 30 seconds and Starship styles", () => {
		const config = mergeConfig({});
		expect(config.projectRefreshIntervalMs).toBe(30_000);
		expect(config.icons.cacheHit).toBe("󰆼");
		expect(config.icons.editorPrompt).toBe("");
		expect(config.colors.gitBranch).toBe("bold purple");
		expect(config.colors.packageVersion).toBe("208");
		expect(config.colors.gitCommit).toBe("bold green");
		expect(config.colors.gitMetricsAdded).toBe("bold green");
		expect(config.colors.gitMetricsDeleted).toBe("bold red");
		expect(config.colors.sessionName).toBe("bold green");
		expect(config.colors.contextNormal).toBe("bright-black");
		expect(config.colors.tokens).toBe("bright-black");
		expect(config.colors.extensionStatus).toBe("bright-black");
		expect(config.colors.editorAccent).toBeUndefined();
		expect(config.colors.editorPrompt).toBeUndefined();
		expect(config.colors.editorBorder).toBeUndefined();
		expect(config.colorSources).toEqual({
			starship: "theme",
			editor: "theme",
			userMessages: "theme",
		});
		expect(config.features).toEqual({
			editor: true,
			statusLine: true,
			viewportIndicators: true,
		});
		expect(config.footerSegments).toEqual({
			cwd: true,
			sessionName: true,
			gitBranch: true,
			gitStatus: true,
			runtime: true,
			modelInfo: false,
			context: true,
			gitCounts: false,
			sessionDuration: false,
			username: false,
			time: false,
			os: false,
			packageVersion: false,
			gitCommit: false,
			gitMetrics: false,
			tokens: true,
			cost: true,
		});
		expect(config.extensionStatuses).toEqual({
			defaultPlacement: "right",
			placements: {},
			colorModes: {},
		});
	});

	it("defaults fixedEditor to disabled with mouse scroll on", () => {
		expect(mergeConfig({}).fixedEditor).toEqual({
			enabled: false,
			mouseScroll: true,
			copyNotice: true,
		});
		expect(defaultConfig.fixedEditor).toEqual({
			enabled: false,
			mouseScroll: true,
			copyNotice: true,
		});
	});

	it("accepts fixedEditor config", () => {
		expect(mergeConfig({ fixedEditor: { enabled: true, mouseScroll: false } }).fixedEditor).toEqual(
			{
				enabled: true,
				mouseScroll: false,
				copyNotice: true,
			},
		);
	});

	it("normalizes invalid fixedEditor values", () => {
		expect(mergeConfig({ fixedEditor: { enabled: "yes" } }).fixedEditor).toEqual({
			enabled: false,
			mouseScroll: true,
			copyNotice: true,
		});
	});

	it("registers the canonical telemetry variables without aliases", () => {
		expect(FOOTER_FORMAT_VARIABLES).toEqual(
			expect.arrayContaining(["cache_read", "cache_write", "subscription", "auto_compaction"]),
		);
		expect(FOOTER_FORMAT_VARIABLES).not.toContain("experimental");
	});

	it("defaults footerFormat to empty string", () => {
		expect(mergeConfig({}).footerFormat).toBe("");
		expect(defaultConfig.footerFormat).toBe("");
	});

	it("accepts a custom footerFormat string", () => {
		expect(mergeConfig({ footerFormat: "$cwd on $git_branch $fill $cost" }).footerFormat).toBe(
			"$cwd on $git_branch $fill $cost",
		);
	});

	it("defaults and normalizes responsive footer settings", () => {
		expect(DEFAULT_COMPACT_FOOTER_FORMAT).toBe(
			"$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$wrap$context$wrap_sep$tokens",
		);
		expect(mergeConfig({})).toMatchObject({
			responsiveFooter: true,
			compactFooterFormat: DEFAULT_COMPACT_FOOTER_FORMAT,
			compactFooterMaxLines: 2,
		});
		expect(
			mergeConfig({
				responsiveFooter: false,
				compactFooterFormat: "$cwd$wrap$context",
				compactFooterMaxLines: "unlimited",
			}),
		).toMatchObject({
			responsiveFooter: false,
			compactFooterFormat: "$cwd$wrap$context",
			compactFooterMaxLines: "unlimited",
		});
		for (const compactFooterMaxLines of [1, 2, 3, "unlimited"] as const) {
			expect(mergeConfig({ compactFooterMaxLines }).compactFooterMaxLines).toBe(
				compactFooterMaxLines,
			);
		}
		for (const value of [0, 4, "2", null, false]) {
			expect(mergeConfig({ compactFooterMaxLines: value }).compactFooterMaxLines).toBe(2);
		}
		expect(mergeConfig({ responsiveFooter: "false" }).responsiveFooter).toBe(true);
		expect(mergeConfig({ compactFooterFormat: "" }).compactFooterFormat).toBe(
			DEFAULT_COMPACT_FOOTER_FORMAT,
		);
	});

	it("persists responsive footer patches without replacing unrelated keys", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-responsive-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(path, JSON.stringify({ unknown: { keep: true }, footerFormat: "$cwd" }));
			const config = saveResponsiveFooterPatch(
				{ responsiveFooter: false, compactFooterMaxLines: 3 },
				path,
			);
			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.unknown).toEqual({ keep: true });
			expect(raw.footerFormat).toBe("$cwd");
			expect(raw.components.footer.styles.starship).toMatchObject({
				format: "$cwd",
				responsive: false,
				compactMaxLines: 3,
			});
			expect(config.responsiveFooter).toBe(false);
			expect(config.compactFooterMaxLines).toBe(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defaults editorMetadataFormat and preserves non-empty strings", () => {
		expect(defaultConfig.editorMetadataFormat).toBe(DEFAULT_EDITOR_METADATA_FORMAT);
		for (const value of [undefined, null, 123, true, ""]) {
			expect(mergeConfig({ editorMetadataFormat: value }).editorMetadataFormat).toBe(
				DEFAULT_EDITOR_METADATA_FORMAT,
			);
		}
		expect(mergeConfig({ editorMetadataFormat: "$model · $provider" }).editorMetadataFormat).toBe(
			"$model · $provider",
		);
		expect(mergeConfig({ editorMetadataFormat: "   " }).editorMetadataFormat).toBe("   ");
	});

	it("ignores non-string footerFormat values", () => {
		expect(mergeConfig({ footerFormat: 123 }).footerFormat).toBe("");
		expect(mergeConfig({ footerFormat: null }).footerFormat).toBe("");
		expect(mergeConfig({ footerFormat: true }).footerFormat).toBe("");
	});

	it("accepts custom project refresh intervals and 0 to disable polling", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 60_000 }).projectRefreshIntervalMs).toBe(60_000);
		expect(mergeConfig({ projectRefreshIntervalMs: 0 }).projectRefreshIntervalMs).toBe(0);
	});

	it("clamps short project refresh intervals up to 5 seconds", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 100 }).projectRefreshIntervalMs).toBe(5_000);
		expect(mergeConfig({ projectRefreshIntervalMs: 4_999 }).projectRefreshIntervalMs).toBe(5_000);
		expect(mergeConfig({ projectRefreshIntervalMs: 5_000 }).projectRefreshIntervalMs).toBe(5_000);
	});

	it("ignores invalid project refresh intervals", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: "30000" }).projectRefreshIntervalMs).toBe(
			30_000,
		);
		expect(
			mergeConfig({ projectRefreshIntervalMs: Number.POSITIVE_INFINITY }).projectRefreshIntervalMs,
		).toBe(30_000);
	});

	it("defaults separator style to pipe and accepts supported values", () => {
		expect(mergeConfig({}).separator).toBe("pipe");
		expect(defaultConfig.separator).toBe("pipe");
		for (const separator of ["pipe", "dot", "chevron", "none"] as const) {
			expect(mergeConfig({ separator }).separator).toBe(separator);
		}
	});

	it("falls back to pipe for invalid separator styles", () => {
		for (const separator of ["arrow", "", 123, null, true]) {
			expect(mergeConfig({ separator }).separator).toBe("pipe");
		}
	});

	it("saves separator style without erasing unknown config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(path, `${JSON.stringify({ unknown: true, contextStyle: "gauge" }, null, 2)}\n`);

			const config = saveSeparatorPatch("chevron", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.separator).toBe("chevron");
			expect(raw.unknown).toBe(true);
			expect(raw.contextStyle).toBe("gauge");
			expect(raw.separator).toBeUndefined();
			expect(raw.components.footer.styles.starship).toMatchObject({
				contextStyle: "gauge",
				separator: "chevron",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defaults context style/thresholds and accepts valid overrides", () => {
		expect(mergeConfig({}).contextStyle).toBe("text");
		expect(mergeConfig({}).contextThresholds).toEqual({ warning: 70, error: 90 });
		expect(mergeConfig({ contextStyle: "gauge" }).contextStyle).toBe("gauge");
		expect(mergeConfig({ contextStyle: "text+gauge" }).contextStyle).toBe("text+gauge");
		expect(mergeConfig({ contextStyle: "bars" }).contextStyle).toBe("text");
		expect(
			mergeConfig({ contextThresholds: { warning: 50, error: 80 } }).contextThresholds,
		).toEqual({ warning: 50, error: 80 });
		expect(
			mergeConfig({ contextThresholds: { warning: 90, error: 70 } }).contextThresholds,
		).toEqual({ warning: 70, error: 90 });
	});

	it("defaults editorModelLabel to id and accepts valid overrides", () => {
		expect(mergeConfig({}).editorModelLabel).toBe("id");
		expect(mergeConfig({ editorModelLabel: "name" }).editorModelLabel).toBe("name");
		expect(mergeConfig({ editorModelLabel: "id" }).editorModelLabel).toBe("id");
		expect(mergeConfig({ editorModelLabel: "title" }).editorModelLabel).toBe("id");
	});

	it("saves minimalist patches while preserving unknown nested config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				JSON.stringify({
					unknownTop: true,
					editorStyles: {
						unknownStyle: { keep: true },
						minimalist: { unknownNested: "keep", showGit: true },
					},
				}),
			);
			const config = saveMinimalistPatch(
				{
					pathDisplay: "full",
					contextFormat: "percent-total",
					showSessionName: false,
					showGit: false,
				},
				path,
			);
			expect(config.editorStyles.minimalist.pathDisplay).toBe("full");
			expect(config.editorStyles.minimalist.contextFormat).toBe("percent-total");
			expect(config.editorStyles.minimalist.showSessionName).toBe(false);
			expect(config.editorStyles.minimalist.showGit).toBe(false);
			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw).toMatchObject({
				unknownTop: true,
				editorStyles: {
					unknownStyle: { keep: true },
					minimalist: { unknownNested: "keep", showGit: true },
				},
			});
			expect(raw.components.editor.styles.minimalist).toMatchObject({
				pathDisplay: "full",
				contextFormat: "percent-total",
				showSessionName: false,
				showGit: false,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves editor style without erasing sibling config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(path, JSON.stringify({ unknown: { keep: true }, editorModelLabel: "name" }));
			const minimalist = saveEditorStyle("minimalist", path);
			let raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.unknown).toEqual({ keep: true });
			expect(raw.editorModelLabel).toBe("name");
			expect(raw.editorStyle).toBeUndefined();
			expect(raw.components.editor.style).toBe("minimalist");
			expect(minimalist.editorStyle).toBe("minimalist");

			const polished = saveEditorStyle("opencode", path);
			raw = JSON.parse(readFileSync(path, "utf8"));
			expect(polished.editorStyle).toBe("opencode");
			expect(raw.unknown).toEqual({ keep: true });
			expect(raw.editorModelLabel).toBe("name");
			expect(raw.components.editor.style).toBe("opencode");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defaults and normalizes editor border color mode", () => {
		expect(defaultConfig.editorBorderColorMode).toBe("static");
		expect(mergeConfig({}).editorBorderColorMode).toBe("static");
		expect(mergeConfig({ editorBorderColorMode: "static" }).editorBorderColorMode).toBe("static");
		expect(mergeConfig({ editorBorderColorMode: "adaptive" }).editorBorderColorMode).toBe(
			"adaptive",
		);
		for (const value of ["dynamic", "", 1, null, true]) {
			expect(mergeConfig({ editorBorderColorMode: value }).editorBorderColorMode).toBe("static");
		}
	});

	it("saves editor border color mode without erasing sibling config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify({ unknown: { keep: true }, editorModelLabel: "name" }, null, 2)}\n`,
			);

			const config = saveEditorBorderColorMode("adaptive", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.unknown).toEqual({ keep: true });
			expect(raw.editorModelLabel).toBe("name");
			expect(raw.editorBorderColorMode).toBeUndefined();
			expect(raw.components.editor.borderColorMode).toBe("adaptive");
			expect(config.editorBorderColorMode).toBe("adaptive");
			expect(config.editorModelLabel).toBe("name");
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defaults pathDisplay and accepts mode/depth overrides", () => {
		expect(mergeConfig({}).pathDisplay).toEqual({ mode: "basename", depth: 0 });
		expect(mergeConfig({ pathDisplay: { mode: "full" } }).pathDisplay).toEqual({
			mode: "full",
			depth: 0,
		});
		expect(mergeConfig({ pathDisplay: { mode: "full", depth: 3 } }).pathDisplay).toEqual({
			mode: "full",
			depth: 3,
		});
		expect(mergeConfig({ pathDisplay: { mode: "fish", depth: -3 } }).pathDisplay).toEqual({
			mode: "basename",
			depth: 0,
		});
		expect(mergeConfig({ pathDisplay: { depth: 12.8 } }).pathDisplay).toEqual({
			mode: "basename",
			depth: 5,
		});
		expect(mergeConfig({ pathDisplay: "full" }).pathDisplay).toEqual({
			mode: "basename",
			depth: 0,
		});
		expect(
			mergeConfig({ pathDisplay: { mode: "full", depth: Number.POSITIVE_INFINITY } }).pathDisplay,
		).toEqual({ mode: "full", depth: 0 });
	});

	it("saves pathDisplay patches and keeps unknown keys", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						unknown: true,
						pathDisplay: {
							mode: "basename",
							depth: 3,
							futureKey: "future",
						},
					},
					null,
					2,
				)}
`,
			);

			const config = savePathDisplayPatch({ mode: "full" }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.pathDisplay).toEqual({ mode: "full", depth: 3 });
			expect(raw.unknown).toBe(true);
			expect(raw.pathDisplay).toEqual({
				mode: "basename",
				depth: 3,
				futureKey: "future",
			});
			expect(raw.components.footer.styles.starship.pathDisplay).toEqual({
				mode: "full",
				depth: 3,
			});

			const depthConfig = savePathDisplayPatch({ depth: 1 }, path);
			expect(depthConfig.pathDisplay).toEqual({ mode: "full", depth: 1 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defaults git branch length to full and accepts positive integer values", () => {
		expect(mergeConfig({}).gitBranch).toEqual({ maxLength: "full" });
		expect(defaultConfig.gitBranch).toEqual({ maxLength: "full" });
		for (const maxLength of [1, 10, 17, 20, 30, 40, 50, 10_000]) {
			expect(mergeConfig({ gitBranch: { maxLength } }).gitBranch).toEqual({ maxLength });
		}
		expect(mergeConfig({ gitBranch: { maxLength: "full" } }).gitBranch).toEqual({
			maxLength: "full",
		});
	});

	it("falls back to full for invalid git branch lengths", () => {
		for (const maxLength of [0, -1, 1.5, "10", "short", null, true]) {
			expect(mergeConfig({ gitBranch: { maxLength } }).gitBranch).toEqual({
				maxLength: "full",
			});
		}
		expect(mergeConfig({ gitBranch: 20 }).gitBranch).toEqual({ maxLength: "full" });
	});

	it("saves git branch length without erasing unknown config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify({ unknown: true, gitBranch: { maxLength: 17, future: true } }, null, 2)}\n`,
			);

			const config = saveGitBranchPatch({ maxLength: 30 }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(config.gitBranch).toEqual({ maxLength: 30 });
			expect(raw.unknown).toBe(true);
			expect(raw.gitBranch).toEqual({ maxLength: 17, future: true });
			expect(raw.components.footer.styles.starship.gitBranch).toEqual({ maxLength: 30 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defaults icon mode to auto and accepts nerd/ascii", () => {
		expect(mergeConfig({}).icons.mode).toBe("auto");
		expect(mergeConfig({ icons: { mode: "ascii" } }).icons.mode).toBe("ascii");
		expect(mergeConfig({ icons: { mode: "nerd" } }).icons.mode).toBe("nerd");
		expect(mergeConfig({ icons: { mode: "emoji" } }).icons.mode).toBe("auto");
		expect(mergeConfig({ icons: { mode: "ascii" } }).icons.cwd).toBe("");
		expect(mergeConfig({ icons: { mode: "ascii", cwd: "DIR" } }).icons.cwd).toBe("DIR");
	});

	it("accepts Starship colors and old color key aliases", () => {
		expect(mergeConfig({ colors: { gitBranch: "bold purple" } }).colors.gitBranch).toBe(
			"bold purple",
		);
		expect(mergeConfig({ colors: { packageVersion: "bold green" } }).colors.packageVersion).toBe(
			"bold green",
		);
		expect(mergeConfig({ colors: { gitCommit: "bold yellow" } }).colors.gitCommit).toBe(
			"bold yellow",
		);
		expect(mergeConfig({ colors: { gitMetricsAdded: "green" } }).colors.gitMetricsAdded).toBe(
			"green",
		);
		expect(mergeConfig({ colors: { gitMetricsDeleted: "red" } }).colors.gitMetricsDeleted).toBe(
			"red",
		);
		expect(mergeConfig({ colors: { git: "syntaxKeyword" } }).colors.gitBranch).toBe(
			"syntaxKeyword",
		);
		expect(mergeConfig({ colors: { extensionStatus: "warning" } }).colors.extensionStatus).toBe(
			"warning",
		);
		expect(mergeConfig({ colors: { extensionStatus: "neon" } }).colors.extensionStatus).toBe(
			defaultConfig.colors.extensionStatus,
		);
	});

	it("accepts extension status placement and color mode config", () => {
		const config = mergeConfig({
			extensionStatuses: {
				defaultPlacement: "middle",
				placements: {
					alpha: "left",
					beta: "off",
					gamma: "right",
				},
				colorModes: {
					alpha: "original",
					beta: "zentui",
				},
			},
		});

		expect(config.extensionStatuses).toEqual({
			defaultPlacement: "middle",
			placements: {
				alpha: "left",
				beta: "off",
				gamma: "right",
			},
			colorModes: {
				alpha: "original",
				beta: "zentui",
			},
		});
	});

	it("normalizes invalid extension status placement config", () => {
		expect(
			mergeConfig({
				extensionStatuses: {
					defaultPlacement: "center",
					placements: {
						alpha: "left",
						beta: "center",
						gamma: 1,
					},
					colorModes: {
						alpha: "original",
						beta: "muted",
						gamma: 1,
					},
				},
			}).extensionStatuses,
		).toEqual({
			defaultPlacement: "right",
			placements: { alpha: "left" },
			colorModes: { alpha: "original" },
		});
		expect(mergeConfig({ extensionStatuses: { placements: "none" } }).extensionStatuses).toEqual({
			defaultPlacement: "right",
			placements: {},
			colorModes: {},
		});
	});

	it("accepts optional editor and user-message chrome color overrides", () => {
		const config = mergeConfig({
			colors: {
				editorAccent: "bold purple",
				editorBorder: "#89b4fa",
				editorModel: "accent",
				editorProvider: "text",
				editorThinking: "muted",
				editorThinkingMinimal: "thinkingMinimal",
				editorThinkingLow: "thinkingLow",
				editorThinkingMedium: "thinkingMedium",
				editorThinkingHigh: "thinkingHigh",
				editorThinkingXhigh: "thinkingXhigh",
			},
		});

		expect(config.colors.editorAccent).toBe("bold purple");
		expect(config.colors.editorBorder).toBe("#89b4fa");
		expect(config.colors.editorModel).toBe("accent");
		expect(config.colors.editorProvider).toBe("text");
		expect(config.colors.editorThinking).toBe("muted");
		expect(config.colors.editorThinkingMinimal).toBe("thinkingMinimal");
		expect(config.colors.editorThinkingLow).toBe("thinkingLow");
		expect(config.colors.editorThinkingMedium).toBe("thinkingMedium");
		expect(config.colors.editorThinkingHigh).toBe("thinkingHigh");
		expect(config.colors.editorThinkingXhigh).toBe("thinkingXhigh");
	});

	it("ignores invalid known values at runtime instead of trusting zentui.json", () => {
		const config = mergeConfig({
			projectRefreshIntervalMs: "fast",
			icons: {
				cwd: 42,
				git: "git",
				cacheHit: "CH",
				editorPrompt: ">",
			},
			colors: {
				cwd: 123,
				gitStatus: "not-a-color",
				separator: "dimmed",
				editorAccent: "neon",
				editorPrompt: "accent",
				editorBorder: "also-neon",
				editorThinkingHigh: "thinkingHigh",
			},
			colorSources: {
				starship: "neon",
				editor: "terminal",
			},
		});

		expect(config.projectRefreshIntervalMs).toBe(defaultConfig.projectRefreshIntervalMs);
		expect(config.icons.cwd).toBe(defaultConfig.icons.cwd);
		expect(config.icons.git).toBe("git");
		expect(config.icons.cacheHit).toBe("CH");
		expect(config.icons.editorPrompt).toBe(">");
		expect(config.colors.cwd).toBe(defaultConfig.colors.cwd);
		expect(config.colors.gitStatus).toBe(defaultConfig.colors.gitStatus);
		expect(config.colors.separator).toBe("dimmed");
		expect(config.colors.editorAccent).toBeUndefined();
		expect(config.colors.editorPrompt).toBe("accent");
		expect(config.colors.editorBorder).toBeUndefined();
		expect(config.colors.editorThinkingHigh).toBe("thinkingHigh");
		expect(config.colorSources).toEqual({
			starship: "theme",
			editor: "terminal",
			userMessages: "theme",
		});
	});

	it("accepts valid color source preferences and ignores invalid values", () => {
		expect(
			mergeConfig({ colorSources: { starship: "terminal", editor: "theme" } }).colorSources,
		).toEqual({ starship: "terminal", editor: "theme", userMessages: "theme" });
		expect(
			mergeConfig({ colorSources: { starship: "neon", userMessages: "terminal" } }).colorSources,
		).toEqual({ starship: "theme", editor: "theme", userMessages: "terminal" });
	});

	it("accepts valid UI feature preferences and ignores invalid values", () => {
		expect(mergeConfig({ features: { editor: false } }).features).toEqual({
			editor: false,
			statusLine: true,
			viewportIndicators: true,
		});
		expect(
			mergeConfig({
				features: {
					editor: "off",
					statusLine: false,
					copyFriendly: true,
					viewportIndicators: false,
				},
			}).features,
		).toEqual({
			editor: true,
			statusLine: false,
			viewportIndicators: false,
		});
		expect(
			mergeConfig({ features: { copyFriendly: "on", viewportIndicators: "off" } }).features,
		).toEqual({ editor: true, statusLine: true, viewportIndicators: true });
	});

	it("accepts valid footer segment preferences and ignores invalid values", () => {
		expect(
			mergeConfig({ footerSegments: { cwd: false, modelInfo: true, tokens: false } })
				.footerSegments,
		).toEqual({
			cwd: false,
			sessionName: true,
			gitBranch: true,
			gitStatus: true,
			runtime: true,
			modelInfo: true,
			context: true,
			gitCounts: false,
			sessionDuration: false,
			username: false,
			time: false,
			os: false,
			packageVersion: false,
			gitCommit: false,
			gitMetrics: false,
			tokens: false,
			cost: true,
		});
		expect(
			mergeConfig({
				footerSegments: { cost: "off", gitBranch: false, gitStatus: false, modelInfo: "on" },
			}).footerSegments,
		).toEqual({
			cwd: true,
			sessionName: true,
			gitBranch: false,
			gitStatus: false,
			runtime: true,
			modelInfo: false,
			context: true,
			gitCounts: false,
			sessionDuration: false,
			username: false,
			time: false,
			os: false,
			packageVersion: false,
			gitCommit: false,
			gitMetrics: false,
			tokens: true,
			cost: true,
		});
	});

	it("normalizes session-name preferences", () => {
		expect(mergeConfig({ colors: { sessionName: "success" } }).colors.sessionName).toBe("success");
		expect(mergeConfig({ footerSegments: { sessionName: false } }).footerSegments.sessionName).toBe(
			false,
		);
		expect(mergeConfig({ colors: { sessionName: "not-a-color" } }).colors.sessionName).toBe(
			"bold green",
		);
		expect(mergeConfig({ footerSegments: { sessionName: "on" } }).footerSegments.sessionName).toBe(
			true,
		);
	});

	it("saves color source patches without erasing unknown user config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						unknown: true,
						icons: { git: "git" },
						colors: {
							futureKey: "future",
							cwd: "bold cyan",
							gitBranch: "syntaxKeyword",
							cost: "success",
						},
						colorSources: { editor: "terminal" },
					},
					null,
					2,
				)}\n`,
			);

			const config = saveColorSourcesPatch({ starship: "terminal" }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.colorSources).toEqual({
				starship: "terminal",
				editor: "terminal",
				userMessages: "theme",
			});
			expect(raw.unknown).toBe(true);
			expect(raw.icons.git).toBe("git");
			expect(raw.colors.cwd).toBe("bold cyan");
			expect(raw.colors.futureKey).toBe("future");
			expect(raw.colors.gitBranch).toBe("syntaxKeyword");
			expect(raw.colors.cost).toBe("success");
			expect(raw.colorSources).toEqual({ editor: "terminal" });
			expect(raw.components.footer.colorSource).toBe("terminal");
			expect(raw.components.editor.colorSource).toBe("terminal");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("preserves invalid and unknown color source data on disk while normalizing runtime", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						colorSources: {
							starship: "neon",
							editor: "terminal",
							userMessages: "invalid",
							extra: "terminal",
						},
					},
					null,
					2,
				)}\n`,
			);

			const config = saveColorSourcesPatch({ userMessages: "terminal" }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.colorSources).toEqual({
				starship: "theme",
				editor: "terminal",
				userMessages: "terminal",
			});
			expect(raw.colorSources).toEqual({
				starship: "neon",
				editor: "terminal",
				userMessages: "invalid",
				extra: "terminal",
			});
			expect(raw.components.userMessages.colorSource).toBe("terminal");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes only the requested settings when creating zentui.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveColorSourcesPatch({ starship: "terminal" }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.colorSources).toEqual({
				starship: "terminal",
				editor: "theme",
				userMessages: "theme",
			});
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(raw.components.footer.colorSource).toBe("terminal");
			expect(raw.components.editor.colorSource).toBe("theme");
			expect(raw.components.userMessages.colorSource).toBe("theme");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves UI feature patches without erasing unknown user config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						unknown: true,
						features: {
							editor: true,
							futureKey: "future",
						},
					},
					null,
					2,
				)}\n`,
			);

			const config = saveUiFeaturesPatch({ statusLine: false, viewportIndicators: false }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.features).toEqual({
				editor: true,
				statusLine: false,
				viewportIndicators: false,
			});
			expect(raw.unknown).toBe(true);
			expect(raw.features).toEqual({ editor: true, futureKey: "future" });
			expect(raw.components.editor.enabled).toBe(true);
			expect(raw.components.editor.viewportIndicators).toBe(false);
			expect(raw.components.footer.style).toBe("native");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes only the requested UI feature setting when creating zentui.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveUiFeaturesPatch({ editor: false }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.features).toEqual({
				editor: false,
				statusLine: true,
				viewportIndicators: true,
			});
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(raw.components.editor.enabled).toBe(false);
			expect(raw.components.userMessages.enabled).toBe(false);
			expect(raw.components.selectorBorders.enabled).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves footer segment patches without erasing unknown user config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						unknown: true,
						footerSegments: {
							cwd: true,
							futureKey: "future",
						},
					},
					null,
					2,
				)}\n`,
			);

			const config = saveFooterSegmentsPatch({ modelInfo: true, tokens: false, cost: false }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.footerSegments).toEqual({
				cwd: true,
				sessionName: true,
				gitBranch: true,
				gitStatus: true,
				runtime: true,
				modelInfo: true,
				context: true,
				gitCounts: false,
				sessionDuration: false,
				username: false,
				time: false,
				os: false,
				packageVersion: false,
				gitCommit: false,
				gitMetrics: false,
				tokens: false,
				cost: false,
			});
			expect(raw.unknown).toBe(true);
			expect(raw.footerSegments).toEqual({ cwd: true, futureKey: "future" });
			expect(raw.components.footer.styles.starship.segments).toMatchObject({
				cwd: true,
				modelInfo: true,
				tokens: false,
				cost: false,
			});
			expect(mergeConfig(raw).footerSegments.modelInfo).toBe(true);

			const disabled = saveFooterSegmentsPatch({ modelInfo: false }, path);
			const disabledRaw = JSON.parse(readFileSync(path, "utf8"));
			expect(disabled.footerSegments.modelInfo).toBe(false);
			expect(mergeConfig(disabledRaw).footerSegments.modelInfo).toBe(false);
			expect(disabledRaw.unknown).toBe(true);
			expect(disabledRaw.footerSegments).toEqual({ cwd: true, futureKey: "future" });
			expect(disabledRaw.components.footer.styles.starship.segments).toMatchObject({
				modelInfo: false,
				tokens: false,
				cost: false,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes only the requested footer segment setting when creating zentui.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFooterSegmentsPatch({ runtime: false }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.footerSegments).toEqual({
				cwd: true,
				sessionName: true,
				gitBranch: true,
				gitStatus: true,
				runtime: false,
				modelInfo: false,
				context: true,
				gitCounts: false,
				sessionDuration: false,
				username: false,
				time: false,
				os: false,
				packageVersion: false,
				gitCommit: false,
				gitMetrics: false,
				tokens: true,
				cost: true,
			});
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(raw.components.footer.styles.starship.segments.runtime).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("toggles and persists the packageVersion footer segment", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFooterSegmentsPatch({ packageVersion: true }, path);
			expect(config.footerSegments.packageVersion).toBe(true);

			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.components.footer.styles.starship.segments.packageVersion).toBe(true);

			const reloaded = mergeConfig(raw);
			expect(reloaded.footerSegments.packageVersion).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("toggles and persists gitCommit and gitMetrics footer segments", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFooterSegmentsPatch({ gitCommit: true, gitMetrics: true }, path);
			expect(config.footerSegments.gitCommit).toBe(true);
			expect(config.footerSegments.gitMetrics).toBe(true);

			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.components.footer.styles.starship.segments).toMatchObject({
				gitCommit: true,
				gitMetrics: true,
			});

			const reloaded = mergeConfig(raw);
			expect(reloaded.footerSegments.gitCommit).toBe(true);
			expect(reloaded.footerSegments.gitMetrics).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("gitCommit config defaults and normalizes hashLength", () => {
		expect(defaultConfig.gitCommit).toEqual({ hashLength: 7, onlyDetached: true, showTag: true });
		expect(mergeConfig({ gitCommit: { hashLength: 3 } }).gitCommit.hashLength).toBe(4);
		expect(mergeConfig({ gitCommit: { hashLength: 100 } }).gitCommit.hashLength).toBe(40);
		expect(mergeConfig({ gitCommit: { hashLength: 10 } }).gitCommit.hashLength).toBe(10);
		expect(mergeConfig({ gitCommit: { onlyDetached: false } }).gitCommit.onlyDetached).toBe(false);
		expect(mergeConfig({ gitCommit: { showTag: false } }).gitCommit.showTag).toBe(false);
		// Missing fields fall back to defaults.
		expect(mergeConfig({ gitCommit: {} }).gitCommit).toEqual({
			hashLength: 7,
			onlyDetached: true,
			showTag: true,
		});
	});

	it("gitMetrics config defaults", () => {
		expect(defaultConfig.gitMetrics).toEqual({ onlyNonzero: true, ignoreSubmodules: false });
		expect(mergeConfig({ gitMetrics: { onlyNonzero: false } }).gitMetrics.onlyNonzero).toBe(false);
		expect(
			mergeConfig({ gitMetrics: { ignoreSubmodules: true } }).gitMetrics.ignoreSubmodules,
		).toBe(true);
	});

	it("writes and reads back footerFormat", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFooterFormatPatch("$cwd on $git_branch $fill $cost", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.footerFormat).toBe("$cwd on $git_branch $fill $cost");
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(raw.components.footer.styles.starship.format).toBe("$cwd on $git_branch $fill $cost");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("clears footerFormat when saving empty string", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFooterFormatPatch("", path);
			expect(config.footerFormat).toBe("");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves extension status placement when creating zentui.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveExtensionStatusPlacement("plugin.key", "middle", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.extensionStatuses.placements).toEqual({ "plugin.key": "middle" });
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(raw.components.footer.styles.starship.extensionStatuses.placements).toEqual({
				"plugin.key": "middle",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves extension status color mode when creating zentui.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveExtensionStatusColorMode("plugin.key", "original", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.extensionStatuses.colorModes).toEqual({ "plugin.key": "original" });
			expect(Object.keys(raw)).toEqual(["components"]);
			expect(raw.components.footer.styles.starship.extensionStatuses.colorModes).toEqual({
				"plugin.key": "original",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves extension status color mode without erasing placement config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						unknown: true,
						colors: { futureKey: "future" },
						extensionStatuses: {
							defaultPlacement: "left",
							futureKey: "future",
							placements: {
								alpha: "right",
								invalid: "center",
							},
							colorModes: {
								alpha: "zentui",
								invalid: "muted",
							},
						},
					},
					null,
					2,
				)}\n`,
			);

			const config = saveExtensionStatusColorMode("beta", "original", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.extensionStatuses).toEqual({
				defaultPlacement: "left",
				placements: { alpha: "right" },
				colorModes: { alpha: "zentui", beta: "original" },
			});
			expect(raw.unknown).toBe(true);
			expect(raw.colors.futureKey).toBe("future");
			expect(raw.extensionStatuses.futureKey).toBe("future");
			expect(raw.extensionStatuses.placements).toEqual({
				alpha: "right",
				invalid: "center",
			});
			expect(raw.extensionStatuses.colorModes).toEqual({
				alpha: "zentui",
				invalid: "muted",
			});
			expect(raw.components.footer.styles.starship.extensionStatuses.colorModes).toEqual({
				alpha: "zentui",
				beta: "original",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("saves extension status placement without erasing unknown user config", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						unknown: true,
						colors: { futureKey: "future" },
						extensionStatuses: {
							defaultPlacement: "left",
							futureKey: "future",
							placements: {
								alpha: "right",
								invalid: "center",
							},
						},
					},
					null,
					2,
				)}\n`,
			);

			const config = saveExtensionStatusPlacement("beta", "off", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.extensionStatuses).toEqual({
				defaultPlacement: "left",
				placements: { alpha: "right", beta: "off" },
				colorModes: {},
			});
			expect(raw.unknown).toBe(true);
			expect(raw.colors.futureKey).toBe("future");
			expect(raw.extensionStatuses.futureKey).toBe("future");
			expect(raw.extensionStatuses.placements).toEqual({
				alpha: "right",
				invalid: "center",
			});
			expect(raw.components.footer.styles.starship.extensionStatuses.placements).toEqual({
				alpha: "right",
				beta: "off",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("renderTerminalStyle", () => {
	it("renders Starship bold green with terminal palette ANSI codes", () => {
		expect(renderTerminalStyle("bold green", " v22.0.0")).toBe("\u001b[1;32m v22.0.0\u001b[0m");
	});

	it("supports 256-color, fg/bg aliases, dimmed, and Starship hex styles", () => {
		expect(renderTerminalStyle("bold 149", "C")).toBe("\u001b[1;38;5;149mC\u001b[0m");
		expect(renderTerminalStyle("bold fg:202", "Haxe")).toBe("\u001b[1;38;5;202mHaxe\u001b[0m");
		expect(renderTerminalStyle("red dimmed", "Java")).toBe("\u001b[31;2mJava\u001b[0m");
		expect(renderTerminalStyle("bg:blue fg:bright-green", "ok")).toBe("\u001b[44;92mok\u001b[0m");
		expect(renderTerminalStyle("bold #FFAFF3", "Gleam")).toBe(
			"\u001b[1;38;2;255;175;243mGleam\u001b[0m",
		);
	});
});

describe("style rendering", () => {
	const theme = {
		fg(token: string, text: string) {
			return `<${token}>${text}</${token}>`;
		},
	};

	it("uses theme tokens when provided to colorize", () => {
		expect(colorize(theme, "accent", "hello")).toBe("<accent>hello</accent>");
	});

	it("falls back to plain text for invalid theme tokens", () => {
		const throwingTheme = {
			fg(token: string, text: string) {
				if (token === "text") return `<text>${text}</text>`;
				throw new Error(`Unknown color: ${token}`);
			},
		};

		expect(colorize(throwingTheme, "doesNotExist", "hello")).toBe("hello");
		expect(renderStyle(throwingTheme, "doesNotExist", "hello")).toBe("hello");
		expect(renderStyleForSource(throwingTheme, "theme", "doesNotExist", "hello")).toBe("hello");
	});

	it("maps Starship modifiers to safe theme colors when the theme rejects unknown tokens", () => {
		const strictTheme = {
			fg(token: string, text: string) {
				if (!["muted", "syntaxKeyword", "text"].includes(token)) {
					throw new Error(`Unknown theme color: ${token}`);
				}
				return `<${token}>${text}</${token}>`;
			},
			bold(text: string) {
				return `<bold>${text}</bold>`;
			},
		};

		expect(renderStyleForSource(strictTheme, "theme", "dimmed", "tokens")).toBe(
			"<muted>tokens</muted>",
		);
		expect(renderStyleForSource(strictTheme, "theme", "bold purple", "git")).toBe(
			"<syntaxKeyword><bold>git</bold></syntaxKeyword>",
		);
		expect(renderStyleForSource(strictTheme, "theme", "unknownColor", "text")).toBe("text");
	});

	it("supports hex colors", () => {
		expect(colorize(theme, "#89b4fa", "hello")).toBe("\u001b[38;2;137;180;250mhello\u001b[39m");
	});

	it("supports short #rgb hex colors by expanding to rrggbb", () => {
		expect(colorize(theme, "#89b", "hello")).toBe("\u001b[38;2;136;153;187mhello\u001b[39m");
		expect(renderTerminalStyle("bold #89b", "x")).toBe("\u001b[1;38;2;136;153;187mx\u001b[0m");
	});

	it("renders Starship styles before falling back to theme tokens", () => {
		expect(renderStyle(theme, "bold purple", "git")).toBe("\u001b[1;35mgit\u001b[0m");
		expect(renderStyle(theme, "syntaxKeyword", "git")).toBe("<syntaxKeyword>git</syntaxKeyword>");
	});

	it("renders theme-source Starship colors through Pi theme tokens", () => {
		expect(renderStyleForSource(theme, "theme", "bold cyan", "cwd")).toBe(
			"<syntaxFunction>cwd</syntaxFunction>",
		);
		expect(renderStyleForSource(theme, "theme", "bold purple", "git")).toBe(
			"<syntaxKeyword>git</syntaxKeyword>",
		);
		expect(renderStyleForSource(theme, "theme", "bold red", "!")).toBe("<error>!</error>");
		expect(renderStyleForSource(theme, "theme", "dimmed", "tokens")).toBe("<muted>tokens</muted>");
		expect(renderStyleForSource(theme, "theme", "bold green", "cost")).toBe(
			"<success>cost</success>",
		);
		expect(renderStyleForSource(theme, "theme", "syntaxKeyword", "git")).toBe(
			"<syntaxKeyword>git</syntaxKeyword>",
		);
	});

	it("keeps explicit terminal styles available for terminal source", () => {
		expect(renderStyleForSource(theme, "terminal", "bold purple", "git")).toBe(
			"\u001b[1;35mgit\u001b[0m",
		);
		expect(renderStyleForSource(theme, "theme", "fg:202", "git")).toBe(
			"\u001b[38;5;202mgit\u001b[0m",
		);
	});

	it("renders theme borders with borderMuted and terminal borders with bright black", () => {
		const thinkingTheme = {
			fg(token: string, text: string) {
				return `<${token}>${text}</${token}>`;
			},
		};

		expect(renderChromeBorder(thinkingTheme, "theme", "bright-black", "────")).toBe(
			"<borderMuted>────</borderMuted>",
		);
		expect(renderChromeBorder(thinkingTheme, "terminal", "bright-black", "────")).toBe(
			"\u001b[90m────\u001b[0m",
		);
	});
});

describe("bounded settings persistence", () => {
	function withConfig(initial: Record<string, unknown>, assertions: (path: string) => void): void {
		const dir = mkdtempSync(join(tmpdir(), "zentui-bounded-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(path, `${JSON.stringify(initial, null, 2)}\n`);
			assertions(path);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it("saves editorModelLabel while preserving unrelated root config", () => {
		withConfig({ editorModelLabel: "id", unknown: { keep: true } }, (path) => {
			const config = saveEditorModelLabel("name", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(config.editorModelLabel).toBe("name");
			expect(raw.editorModelLabel).toBe("id");
			expect(raw.unknown).toEqual({ keep: true });
			expect(raw.components.editor.modelLabel).toBe("name");
			expect(raw.components.footer.modelLabel).toBe("name");
		});
	});

	it("saves git commit booleans while preserving hashLength and unknown siblings", () => {
		withConfig(
			{
				unknown: true,
				gitCommit: { hashLength: 12, onlyDetached: true, showTag: true, future: "keep" },
			},
			(path) => {
				const config = saveGitCommitPatch({ onlyDetached: false, showTag: false }, path);
				const raw = JSON.parse(readFileSync(path, "utf8"));
				expect(config.gitCommit).toEqual({ hashLength: 12, onlyDetached: false, showTag: false });
				expect(raw.gitCommit).toEqual({
					hashLength: 12,
					onlyDetached: true,
					showTag: true,
					future: "keep",
				});
				expect(raw.components.footer.styles.starship.gitCommit).toEqual({
					hashLength: 12,
					onlyDetached: false,
					showTag: false,
				});
				expect(raw.unknown).toBe(true);
			},
		);
	});

	it("saves git metrics booleans while preserving unknown siblings", () => {
		withConfig(
			{ unknown: true, gitMetrics: { onlyNonzero: true, ignoreSubmodules: false, future: 1 } },
			(path) => {
				const config = saveGitMetricsPatch({ onlyNonzero: false, ignoreSubmodules: true }, path);
				const raw = JSON.parse(readFileSync(path, "utf8"));
				expect(config.gitMetrics).toEqual({ onlyNonzero: false, ignoreSubmodules: true });
				expect(raw.gitMetrics).toEqual({
					onlyNonzero: true,
					ignoreSubmodules: false,
					future: 1,
				});
				expect(raw.components.footer.styles.starship.gitMetrics).toEqual({
					onlyNonzero: false,
					ignoreSubmodules: true,
				});
				expect(raw.unknown).toBe(true);
			},
		);
	});

	it("saves default extension placement while preserving keyed and unknown config", () => {
		withConfig(
			{
				unknown: true,
				extensionStatuses: {
					defaultPlacement: "right",
					placements: { alpha: "left" },
					colorModes: { alpha: "original" },
					future: "keep",
				},
			},
			(path) => {
				const config = saveExtensionStatusDefaultPlacement("middle", path);
				const raw = JSON.parse(readFileSync(path, "utf8"));
				expect(config.extensionStatuses).toEqual({
					defaultPlacement: "middle",
					placements: { alpha: "left" },
					colorModes: { alpha: "original" },
				});
				expect(raw.extensionStatuses.future).toBe("keep");
				expect(raw.extensionStatuses.placements).toEqual({ alpha: "left" });
				expect(raw.extensionStatuses.colorModes).toEqual({ alpha: "original" });
				expect(raw.components.footer.styles.starship.extensionStatuses.defaultPlacement).toBe(
					"middle",
				);
				expect(raw.unknown).toBe(true);
			},
		);
	});
});

describe("saveFixedEditorPatch", () => {
	it("saves enabled flag and round-trips", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-cfg-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFixedEditorPatch({ enabled: true }, path);
			expect(config.fixedEditor.enabled).toBe(true);

			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.fixedEditor).toBeUndefined();
			expect(raw.layout.fixedEditor.enabled).toBe(true);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("saves mouseScroll flag alongside existing enabled", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-cfg-"));
		const path = join(dir, "zentui.json");
		try {
			saveFixedEditorPatch({ enabled: true }, path);
			const config = saveFixedEditorPatch({ mouseScroll: true }, path);
			expect(config.fixedEditor).toEqual({ enabled: true, mouseScroll: true, copyNotice: true });
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
describe("startup and file safety", () => {
	it("does not create, rewrite, or materialize config at startup", () => {
		withConfig(undefined, (path) => {
			ensureConfigExists(path);
			expect(existsSync(path)).toBe(false);
		});
		withConfig({ features: { editor: false }, unknown: true }, (path) => {
			const before = readFileSync(path, "utf8");
			ensureConfigExists(path);
			expect(readFileSync(path, "utf8")).toBe(before);
			expect(readRaw(path)).not.toHaveProperty("components");
		});
	});

	it("refuses corrupt config without changing bytes or leaving a temporary file", () => {
		withConfig(undefined, (path, dir) => {
			const original = "{ invalid json\n";
			writeFileSync(path, original);
			expect(() => saveSeparatorPatch("dot", path)).toThrow(
				/Refusing to save Zentui config.*corrupt/,
			);
			expect(readFileSync(path, "utf8")).toBe(original);
			expect(configTempFiles(dir)).toEqual([]);
		});
	});

	it("creates a missing config atomically and returns the re-merged file", () => {
		withConfig(undefined, (path, dir) => {
			const config = saveFooterFormatPatch("$cwd", path);
			const raw = readRaw(path);
			expect(raw.components.footer.styles.starship.format).toBe("$cwd");
			expect(config).toEqual(mergeConfig(raw));
			expect(configTempFiles(dir)).toEqual([]);
		});
	});

	it("preserves destination mode during atomic replacement", () => {
		withConfig({ separator: "pipe" }, (path, dir) => {
			chmodSync(path, 0o600);
			saveSeparatorPatch("dot", path);
			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(readRaw(path).components.footer.styles.starship.separator).toBe("dot");
			expect(configTempFiles(dir)).toEqual([]);
		});
	});

	it("updates a symlink target atomically without replacing the symlink", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-symlink-config-"));
		const targetDir = join(dir, "target");
		const targetPath = join(targetDir, "actual.json");
		const linkPath = join(dir, "zentui.json");
		try {
			mkdirSync(targetDir);
			writeFileSync(targetPath, `${JSON.stringify({ unknown: true }, null, 2)}\n`);
			chmodSync(targetPath, 0o600);
			symlinkSync(targetPath, linkPath);
			const originalLink = readlinkSync(linkPath);
			const config = saveSeparatorPatch("chevron", linkPath);
			const raw = readRaw(targetPath);
			expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
			expect(readlinkSync(linkPath)).toBe(originalLink);
			expect(raw.unknown).toBe(true);
			expect(raw.components.footer.styles.starship.separator).toBe("chevron");
			expect(config).toEqual(mergeConfig(raw));
			expect(statSync(targetPath).mode & 0o777).toBe(0o600);
			expect(configTempFiles(targetDir, "actual.json")).toEqual([]);
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses a dangling symlink without changing it", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-dangling-config-"));
		const targetDir = join(dir, "target");
		const missingTarget = join(targetDir, "missing.json");
		const linkPath = join(dir, "zentui.json");
		try {
			mkdirSync(targetDir);
			symlinkSync(missingTarget, linkPath);
			const originalLink = readlinkSync(linkPath);
			expect(() => saveSeparatorPatch("dot", linkPath)).toThrow(/Refusing to save Zentui config/);
			expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
			expect(readlinkSync(linkPath)).toBe(originalLink);
			expect(existsSync(missingTarget)).toBe(false);
			expect(configTempFiles(targetDir, "missing.json")).toEqual([]);
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps the destination and leaves no temp file when serialization input is invalid", () => {
		withConfig({ unknown: true }, (path, dir) => {
			const original = readFileSync(path, "utf8");
			expect(() => saveContextThresholdsPatch({ warning: 1n as never }, path)).toThrow();
			expect(readFileSync(path, "utf8")).toBe(original);
			expect(configTempFiles(dir)).toEqual([]);
		});
	});
});

describe("Opencode and Footer follow-up migration", () => {
	it("resolves canonical and alias editor metadata in documented precedence", () => {
		const config = mergeConfig({
			editorMetadataFormat: "$flat",
			components: {
				editor: {
					styles: {
						opencode: { metadataFormat: "$canonical" },
						polished: { metadataFormat: "$alias" },
						"polished-copy-friendly": { metadataFormat: "$alias-copy" },
					},
				},
			},
		});
		expect(config.components.editor.styles.opencode.metadataFormat).toBe("$canonical");
		expect(config.components.editor.styles["opencode-copy-friendly"].metadataFormat).toBe(
			"$alias-copy",
		);
		expect(
			mergeConfig({
				editorMetadataFormat: "$flat",
				components: { editor: { styles: { polished: { metadataFormat: "$alias" } } } },
			}).components.editor.styles.opencode.metadataFormat,
		).toBe("$alias");
	});

	it("resolves Footer style from valid style, enabled, released statusLine, then default", () => {
		expect(
			mergeConfig({
				features: { statusLine: false },
				components: { footer: { style: "hidden", enabled: true } },
			}).components.footer.style,
		).toBe("hidden");
		expect(
			mergeConfig({
				features: { statusLine: true },
				components: { footer: { style: "future", enabled: false } },
			}).components.footer.style,
		).toBe("native");
		expect(mergeConfig({ features: { statusLine: false } }).components.footer.style).toBe("native");
		expect(mergeConfig({}).components.footer.style).toBe("starship");
		expect(mergeConfig({ components: { footer: { style: "hidden" } } }).features.statusLine).toBe(
			false,
		);
	});

	it("saves Footer styles canonically and removes only obsolete enabled", () => {
		withConfig(
			{
				features: { statusLine: true, future: "keep" },
				components: {
					footer: {
						enabled: true,
						future: "keep",
						styles: { starship: { format: "$cwd", future: "keep" }, future: { keep: true } },
					},
				},
			},
			(path) => {
				saveFooterComponentPatch({ style: "hidden" }, path);
				const raw = readRaw(path);
				expect(raw.components.footer.style).toBe("hidden");
				expect(raw.components.footer).not.toHaveProperty("enabled");
				expect(raw.components.footer.future).toBe("keep");
				expect(raw.components.footer.styles.starship).toMatchObject({
					format: "$cwd",
					future: "keep",
				});
				expect(raw.components.footer.styles.future).toEqual({ keep: true });
				expect(raw.features).toEqual({ statusLine: true, future: "keep" });
			},
		);
	});

	it("keeps saveUiFeaturesPatch as a Starship/Native compatibility API", () => {
		withConfig({ components: { footer: { style: "hidden" } } }, (path) => {
			expect(saveUiFeaturesPatch({ statusLine: true }, path).components.footer.style).toBe(
				"starship",
			);
			expect(saveUiFeaturesPatch({ statusLine: false }, path).components.footer.style).toBe(
				"native",
			);
		});
	});

	it("ignores inherited extension-status overrides and validates runtime mutations", () => {
		const config = structuredClone(defaultConfig);
		const statuses = config.components.footer.styles.starship.extensionStatuses;
		statuses.placements = Object.create({ constructor: "left" }) as Record<
			string,
			(typeof statuses.placements)[string]
		>;
		statuses.colorModes = Object.create({ constructor: "original" }) as Record<
			string,
			(typeof statuses.colorModes)[string]
		>;
		expect(getExtensionStatusPlacement(config, "constructor")).toBe("right");
		expect(getExtensionStatusColorMode(config, "constructor")).toBe("zentui");

		Object.defineProperty(statuses.placements, "constructor", {
			value: "left",
			enumerable: true,
			configurable: true,
		});
		Object.defineProperty(statuses.colorModes, "constructor", {
			value: "original",
			enumerable: true,
			configurable: true,
		});
		expect(getExtensionStatusPlacement(config, "constructor")).toBe("left");
		expect(getExtensionStatusColorMode(config, "constructor")).toBe("original");

		(statuses as unknown as { defaultPlacement: string }).defaultPlacement = "center";
		(statuses.placements as unknown as Record<string, string>).alpha = "explode";
		(statuses.colorModes as unknown as Record<string, string>).alpha = "rainbow";
		expect(getExtensionStatusPlacement(config, "missing")).toBe("right");
		expect(getExtensionStatusPlacement(config, "alpha")).toBe("right");
		expect(getExtensionStatusColorMode(config, "alpha")).toBe("zentui");
	});

	it("marks only explicit non-empty unknown canonical component styles", () => {
		const future = mergeConfig({
			components: {
				editor: { style: "future-editor" },
				userMessages: { style: "future-messages" },
				selectorBorders: { style: "future-selectors" },
				footer: { style: "future-footer" },
			},
		});
		for (const owner of ["editor", "userMessages", "selectorBorders", "footer"] as const) {
			expect(hasUnsupportedComponentStyle(future, owner)).toBe(true);
		}

		for (const style of [undefined, "", "   ", null, false, {}, []]) {
			const ordinary = mergeConfig({ components: { editor: { style } } });
			expect(hasUnsupportedComponentStyle(ordinary, "editor")).toBe(false);
		}
		expect(
			hasUnsupportedComponentStyle(
				mergeConfig({ components: { editor: { style: "polished" } } }),
				"editor",
			),
		).toBe(false);
	});

	it.each([
		[true, "starship"],
		[false, "native"],
	] as const)(
		"makes compatibility statusLine=%s authoritative over unknown Footer state",
		(statusLine, expectedStyle) => {
			withConfig(
				{
					features: { statusLine: !statusLine, future: "keep" },
					components: {
						footer: {
							style: "future-footer",
							enabled: true,
							future: "keep",
							styles: {
								starship: { format: "$cwd" },
								future: { keep: true },
							},
						},
					},
				},
				(path) => {
					const config = saveUiFeaturesPatch({ statusLine }, path);
					const raw = readRaw(path);
					expect(config.components.footer.style).toBe(expectedStyle);
					expect(raw.components.footer.style).toBe(expectedStyle);
					expect(raw.components.footer).not.toHaveProperty("enabled");
					expect(raw.components.footer.future).toBe("keep");
					expect(raw.components.footer.styles.future).toEqual({ keep: true });
					expect(raw.features).toEqual({ statusLine: !statusLine, future: "keep" });
				},
			);
		},
	);
});
