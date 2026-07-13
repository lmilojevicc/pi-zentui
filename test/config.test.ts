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
	defaultConfig,
	mergeConfig,
	saveColorSourcesPatch,
	saveContextThresholdsPatch,
	saveExtensionStatusColorMode,
	saveExtensionStatusPlacement,
	saveFixedEditorPatch,
	saveFooterFormatPatch,
	saveFooterSegmentsPatch,
	saveGitBranchPatch,
	savePathDisplayPatch,
	saveSeparatorPatch,
	saveUiFeaturesPatch,
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
			copyFriendly: false,
		});
		expect(config.footerSegments).toEqual({
			cwd: true,
			sessionName: false,
			gitBranch: true,
			gitStatus: true,
			runtime: true,
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

	it("defaults footerFormat to empty string", () => {
		expect(mergeConfig({}).footerFormat).toBe("");
		expect(defaultConfig.footerFormat).toBe("");
	});

	it("accepts a custom footerFormat string", () => {
		expect(mergeConfig({ footerFormat: "$cwd on $git_branch $fill $cost" }).footerFormat).toBe(
			"$cwd on $git_branch $fill $cost",
		);
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
			expect(raw).toEqual({
				unknown: true,
				contextStyle: "gauge",
				separator: "chevron",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses corrupt config without changing its bytes", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		const original = "{ invalid json\n";
		try {
			writeFileSync(path, original);

			expect(() => saveSeparatorPatch("dot", path)).toThrow(
				/Refusing to save Zentui config.*corrupt/,
			);
			expect(readFileSync(path, "utf8")).toBe(original);
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates missing config atomically and returns the config written to disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			expect(existsSync(path)).toBe(false);
			const config = saveFooterFormatPatch("$cwd $fill $context", path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(raw).toEqual({ footerFormat: "$cwd $fill $context" });
			expect(config).toEqual(mergeConfig(raw));
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("preserves the existing destination mode during atomic replacement", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(path, `${JSON.stringify({ separator: "pipe" }, null, 2)}\n`);
			chmodSync(path, 0o600);

			saveSeparatorPatch("dot", path);

			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(JSON.parse(readFileSync(path, "utf8")).separator).toBe("dot");
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("updates a symlink target atomically without replacing the symlink", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
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
			const raw = JSON.parse(readFileSync(targetPath, "utf8"));

			expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
			expect(readlinkSync(linkPath)).toBe(originalLink);
			expect(raw).toEqual({ unknown: true, separator: "chevron" });
			expect(config).toEqual(mergeConfig(raw));
			expect(statSync(targetPath).mode & 0o777).toBe(0o600);
			expect(configTempFiles(targetDir, "actual.json")).toEqual([]);
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses a dangling symlink without changing it", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
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

	it("preserves scalar and nested unknown keys through the shared mutation path", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(
				path,
				`${JSON.stringify(
					{
						futureScalar: "keep",
						pathDisplay: { mode: "basename", depth: 2, futureNested: { keep: true } },
					},
					null,
					2,
				)}\n`,
			);

			saveSeparatorPatch("dot", path);
			const config = savePathDisplayPatch({ mode: "full" }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(raw.futureScalar).toBe("keep");
			expect(raw.separator).toBe("dot");
			expect(raw.pathDisplay).toEqual({
				mode: "full",
				depth: 2,
				futureNested: { keep: true },
			});
			expect(config).toEqual(mergeConfig(raw));
			expect(configTempFiles(dir)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps the destination and removes the temp file when serialization fails", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		const path = join(dir, "zentui.json");
		const original = `${JSON.stringify({ unknown: true }, null, 2)}\n`;
		try {
			writeFileSync(path, original);

			expect(() => saveContextThresholdsPatch({ warning: 1n as never }, path)).toThrow();
			expect(readFileSync(path, "utf8")).toBe(original);
			expect(configTempFiles(dir)).toEqual([]);
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
				mode: "full",
				depth: 3,
				futureKey: "future",
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
			expect(raw).toEqual({
				unknown: true,
				gitBranch: { maxLength: 30, future: true },
			});
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

	it("accepts valid footer segment preferences and ignores invalid values", () => {
		expect(mergeConfig({ footerSegments: { cwd: false, tokens: false } }).footerSegments).toEqual({
			cwd: false,
			sessionName: false,
			gitBranch: true,
			gitStatus: true,
			runtime: true,
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
			mergeConfig({ footerSegments: { cost: "off", gitBranch: false, gitStatus: false } })
				.footerSegments,
		).toEqual({
			cwd: true,
			sessionName: false,
			gitBranch: false,
			gitStatus: false,
			runtime: true,
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
		expect(mergeConfig({ footerSegments: { sessionName: true } }).footerSegments.sessionName).toBe(
			true,
		);
		expect(mergeConfig({ colors: { sessionName: "not-a-color" } }).colors.sessionName).toBe(
			"bold green",
		);
		expect(mergeConfig({ footerSegments: { sessionName: "on" } }).footerSegments.sessionName).toBe(
			false,
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

			const config = saveFooterSegmentsPatch({ tokens: false, cost: false }, path);
			const raw = JSON.parse(readFileSync(path, "utf8"));

			expect(config.footerSegments).toEqual({
				cwd: true,
				sessionName: false,
				gitBranch: true,
				gitStatus: true,
				runtime: true,
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
			expect(raw.footerSegments).toEqual({
				cwd: true,
				futureKey: "future",
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
				sessionName: false,
				gitBranch: true,
				gitStatus: true,
				runtime: false,
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
			expect(raw).toEqual({ footerSegments: { runtime: false } });
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
			expect(raw.footerSegments).toEqual({ packageVersion: true });

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
			expect(raw.footerSegments).toEqual({ gitCommit: true, gitMetrics: true });

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
			expect(raw).toEqual({ footerFormat: "$cwd on $git_branch $fill $cost" });
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

describe("saveFixedEditorPatch", () => {
	it("saves enabled flag and round-trips", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-cfg-"));
		const path = join(dir, "zentui.json");
		try {
			const config = saveFixedEditorPatch({ enabled: true }, path);
			expect(config.fixedEditor.enabled).toBe(true);

			const raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.fixedEditor.enabled).toBe(true);
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
