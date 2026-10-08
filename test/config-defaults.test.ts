import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	ensureConfigExists,
	mergeConfig,
	saveComponentPreset,
	saveMinimalistTemplatePatch,
} from "../extensions/zentui/config";
import {
	componentPresets,
	getComponentPreset,
	matchingComponentPreset,
} from "../extensions/zentui/presets";

const colorOwners = ["editor", "userMessages", "footer", "selectorBorders", "workingLine"] as const;
const minimalistDefaults = {
	formats: { bottomLeft: "$session_name$join_sep($git_branch)" },
	pathDisplay: "compact",
	contextFormat: "percent-total",
	contextGauge: false,
	showSessionName: false,
	showTimer: false,
	showCost: true,
	showCacheHit: false,
	showGit: true,
	contextThresholds: { warning: 70, error: 90 },
	separator: "dash",
};

function withConfig(run: (path: string) => void) {
	const directory = mkdtempSync(join(tmpdir(), "zentui-defaults-"));
	try {
		run(join(directory, "zentui.json"));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function minimalistPreset() {
	const preset = getComponentPreset("minimalist");
	if (!preset) throw new Error("Missing Minimalist preset");
	return preset;
}

describe("unsaved config defaults", () => {
	it.each([undefined, null, [], {}, { components: false }])(
		"keeps fresh selections and resolves Minimalist options without writing: %j",
		(raw) => {
			const config = mergeConfig(raw);
			expect(matchingComponentPreset(config)?.id).toBe("opencode");
			expect(config.components.editor).toMatchObject({
				enabled: true,
				style: "opencode",
				borderColorMode: "static",
				modelLabel: "id",
				viewportIndicators: true,
			});
			expect(config.components.userMessages).toMatchObject({ enabled: true, style: "framed" });
			expect(config.components.footer.style).toBe("starship");
			expect(config.components.workingLine.enabled).toBe(true);
			expect(config.components.thinkingSteps.enabled).toBe(false);
			expect(config.components.editor.styles.minimalist).toEqual(minimalistDefaults);
			expect(config.editorStyles.minimalist).toEqual(minimalistDefaults);
			for (const owner of colorOwners)
				expect(config.components[owner].colorSource).toBe("terminal");
			expect(config.colorSources).toEqual({
				editor: "terminal",
				userMessages: "terminal",
				starship: "terminal",
			});
			withConfig((path) => {
				ensureConfigExists(path);
				expect(existsSync(path)).toBe(false);
			});
		},
	);

	it.each([undefined, null, 7, "invalid"])(
		"uses independent defaults for invalid leaves: %j",
		(invalid) => {
			const config = mergeConfig({
				colorSources: { editor: invalid, userMessages: invalid, starship: invalid },
				components: {
					...Object.fromEntries(colorOwners.map((owner) => [owner, { colorSource: invalid }])),
					workingLine: { colorSource: invalid, enabled: invalid, placement: invalid },
					editor: {
						colorSource: invalid,
						styles: {
							minimalist: Object.fromEntries(
								Object.keys(minimalistDefaults).map((key) => [key, invalid]),
							),
						},
					},
				},
			});
			for (const owner of colorOwners)
				expect(config.components[owner].colorSource).toBe("terminal");
			expect(config.components.editor.styles.minimalist).toEqual(minimalistDefaults);
			expect(config.components.workingLine).toMatchObject({ enabled: true, placement: "border" });
		},
	);

	it.each([undefined, null, "false", false, true])(
		"defaults Tokens/s on and preserves explicit choices: %j",
		(tokenRate) => {
			const config = mergeConfig({
				components: { workingLine: { segments: { tokenRate } } },
			});
			expect(config.components.workingLine.segments.tokenRate).toBe(tokenRate !== false);
			expect(config.components.workingLine.enabled).toBe(true);
			expect(config.components.thinkingSteps.enabled).toBe(false);
		},
	);

	it("preserves explicit theme sources for every owner and legacy projections", () => {
		const config = mergeConfig({
			components: Object.fromEntries(colorOwners.map((owner) => [owner, { colorSource: "theme" }])),
		});
		for (const owner of colorOwners) expect(config.components[owner].colorSource).toBe("theme");
		expect(config.colorSources).toEqual({
			editor: "theme",
			userMessages: "theme",
			starship: "theme",
		});
		const legacy = mergeConfig({ colorSources: config.colorSources });
		for (const owner of ["editor", "userMessages", "footer", "selectorBorders"] as const)
			expect(legacy.components[owner].colorSource).toBe("theme");
		expect(legacy.components.workingLine.colorSource).toBe("terminal");
	});

	it("allocates independent nested runtime defaults", () => {
		const first = mergeConfig({}).components.editor.styles.minimalist;
		const second = mergeConfig({}).components.editor.styles.minimalist;
		if (!first.formats) throw new Error("Missing default Minimalist formats");
		first.formats.bottomLeft = "changed";
		first.contextThresholds.warning = 10;
		expect(second).toEqual(minimalistDefaults);
		expect(defaultConfig.components.editor.styles.minimalist).toEqual(minimalistDefaults);
	});

	it("selects Minimalist without enabling Footer or Thinking steps or persisting defaults", () => {
		withConfig((path) => {
			const preset = minimalistPreset();
			const result = saveComponentPreset(preset, path);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ components: preset.components });
			expect(result.components.editor.style).toBe("minimalist");
			expect(result.components.footer.style).toBe("hidden");
			expect(result.components.userMessages.enabled).toBe(false);
			expect(result.components.workingLine).toMatchObject({
				enabled: true,
				placement: "border",
				segments: { elapsed: true, tokenRate: true },
			});
			expect(result.components.thinkingSteps.enabled).toBe(false);
			expect(result.components.editor.styles.minimalist).toEqual(minimalistDefaults);
		});
	});

	it.each(
		componentPresets.flatMap((preset) =>
			[false, true].flatMap((enabled) =>
				["above", "border"].map((placement) => ({ preset, enabled, placement })),
			),
		),
	)(
		"preserves saved options and enabled=$enabled placement=$placement under $preset.id",
		({ preset, enabled, placement }) => {
			withConfig((path) => {
				const savedStyle = {
					...minimalistDefaults,
					pathDisplay: "full",
					contextFormat: "percent",
					contextGauge: true,
					showSessionName: true,
					showTimer: true,
					showCost: false,
					showCacheHit: true,
					showGit: false,
					contextThresholds: { warning: 40, error: 80 },
					separator: "dot",
					formats: { bottomLeft: "", topLeft: "$session_name", bottomRight: "$cwd custom" },
				};
				const original = {
					components: {
						...Object.fromEntries(colorOwners.map((owner) => [owner, { colorSource: "theme" }])),
						editor: { colorSource: "theme", styles: { minimalist: savedStyle } },
						workingLine: {
							colorSource: "theme",
							enabled,
							placement,
							segments: { tokenRate: false },
						},
						thinkingSteps: { enabled, mode: "rail" },
					},
				};
				writeFileSync(path, JSON.stringify(original));
				const before = readFileSync(path, "utf8");
				expect(mergeConfig(original).components.editor.styles.minimalist).toEqual(savedStyle);
				expect(readFileSync(path, "utf8")).toBe(before);
				const result = saveComponentPreset(preset, path);
				expect(result.components.editor.styles.minimalist).toEqual(savedStyle);
				for (const owner of colorOwners) expect(result.components[owner].colorSource).toBe("theme");
				expect(result.components.workingLine.enabled).toBe(enabled);
				expect(result.components.workingLine.placement).toBe(placement);
				expect(result.components.workingLine.segments.tokenRate).toBe(false);
				expect(result.components.thinkingSteps.enabled).toBe(enabled);
				const expected = structuredClone(original);
				for (const [owner, selection] of Object.entries(preset.components))
					Object.assign(expected.components[owner as keyof typeof expected.components], selection);
				expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(expected);
			});
		},
	);

	it("preserves blank/custom formats and resets bottomLeft by deletion to the new runtime default", () => {
		withConfig((path) => {
			for (const bottomLeft of ["", "$git_branch $git_status", "$session_name custom"])
				expect(
					saveMinimalistTemplatePatch({ formats: { bottomLeft } }, path).components.editor.styles
						.minimalist.formats?.bottomLeft,
				).toBe(bottomLeft);
			const result = saveMinimalistTemplatePatch({ formats: { bottomLeft: null } }, path);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
				components: { editor: { styles: { minimalist: {} } } },
			});
			expect(result.components.editor.styles.minimalist.formats).toEqual(
				minimalistDefaults.formats,
			);
		});
	});
});
