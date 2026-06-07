import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	mergeConfig,
	saveColorSourcesPatch,
	saveExtensionStatusColorMode,
	saveExtensionStatusPlacement,
	saveUiFeaturesPatch,
} from "../extensions/zentui/config";
import {
	colorize,
	renderChromeBorder,
	renderStyle,
	renderStyleForSource,
	renderTerminalStyle,
} from "../extensions/zentui/style";

describe("mergeConfig", () => {
	it("defaults project refresh polling to 30 seconds and Starship styles", () => {
		const config = mergeConfig({});
		expect(config.projectRefreshIntervalMs).toBe(30_000);
		expect(config.icons.cacheHit).toBe("󰆼");
		expect(config.icons.editorPrompt).toBe("");
		expect(config.colors.gitBranch).toBe("bold purple");
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
			copyFriendly: false,
		});
		expect(config.extensionStatuses).toEqual({
			defaultPlacement: "right",
			placements: {},
			colorModes: {},
		});
	});

	it("accepts custom project refresh intervals and 0 to disable polling", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 60_000 }).projectRefreshIntervalMs).toBe(60_000);
		expect(mergeConfig({ projectRefreshIntervalMs: 0 }).projectRefreshIntervalMs).toBe(0);
	});

	it("ignores invalid project refresh intervals", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: "30000" }).projectRefreshIntervalMs).toBe(
			30_000,
		);
		expect(mergeConfig({ projectRefreshIntervalMs: 100 }).projectRefreshIntervalMs).toBe(30_000);
		expect(
			mergeConfig({ projectRefreshIntervalMs: Number.POSITIVE_INFINITY }).projectRefreshIntervalMs,
		).toBe(30_000);
	});

	it("accepts Starship colors and old color key aliases", () => {
		expect(mergeConfig({ colors: { gitBranch: "bold purple" } }).colors.gitBranch).toBe(
			"bold purple",
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
			copyFriendly: false,
		});
		expect(
			mergeConfig({ features: { editor: "off", statusLine: false, copyFriendly: true } }).features,
		).toEqual({
			editor: true,
			statusLine: false,
			copyFriendly: true,
		});
		expect(mergeConfig({ features: { copyFriendly: "on" } }).features.copyFriendly).toBe(false);
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
			expect(raw.colorSources).toEqual({
				starship: "terminal",
				editor: "terminal",
			});
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
				userMessages: "terminal",
				extra: "terminal",
			});
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
			expect(raw).toEqual({ colorSources: { starship: "terminal" } });
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

			const config = saveUiFeaturesPatch({ statusLine: false }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.features).toEqual({
				editor: true,
				statusLine: false,
				copyFriendly: false,
			});
			expect(raw.unknown).toBe(true);
			expect(raw.features).toEqual({
				editor: true,
				futureKey: "future",
				statusLine: false,
			});
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
				copyFriendly: false,
			});
			expect(raw).toEqual({ features: { editor: false } });
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
			expect(raw).toEqual({
				extensionStatuses: {
					placements: {
						"plugin.key": "middle",
					},
				},
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
			expect(raw).toEqual({
				extensionStatuses: {
					colorModes: {
						"plugin.key": "original",
					},
				},
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
