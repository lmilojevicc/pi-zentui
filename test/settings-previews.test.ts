import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	type EditorStyle,
	type PolishedTuiConfig,
	type ThinkingStepsMode,
	type UserMessageStyle,
} from "../extensions/zentui/config";
import {
	renderEditorSettingsPreview,
	renderThinkingStepsSettingsPreview,
	renderUserMessageSettingsPreview,
	SETTINGS_PREVIEW_MAX_ROWS,
	SETTINGS_PREVIEW_MAX_WIDTH,
	THINKING_STEPS_PREVIEW_MARKDOWN,
} from "../extensions/zentui/settings-previews";

function theme(offset = 0): Theme {
	return {
		fg: (color: string, text: string) => {
			const index =
				([...color].reduce((total, character) => total + character.charCodeAt(0), 0) + offset) %
				200;
			return `\x1b[38;5;${index}m${text}\x1b[0m`;
		},
		bg: (_color: string, text: string) => `\x1b[48;5;234m${text}\x1b[49m`,
		getBgAnsi: () => "\x1b[48;5;234m",
		bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
	} as unknown as Theme;
}

function config(): PolishedTuiConfig {
	return structuredClone(defaultConfig);
}

function plain(lines: string[]): string {
	return stripVTControlCharacters(lines.join("\n"));
}

function expectOnlyTrustedSgr(rows: string[], hostileText: readonly string[] = []): void {
	for (const row of rows) {
		expect(row).not.toMatch(/[\r\n]/);
		for (let index = 0; index < row.length; ) {
			const code = row.charCodeAt(index);
			if (code === 0x1b) {
				const sgr = /^\x1b\[[0-9:;]*m/.exec(row.slice(index));
				expect(sgr, `unexpected terminal escape in ${JSON.stringify(row)}`).not.toBeNull();
				index += sgr?.[0].length ?? 1;
				continue;
			}
			expect(
				code >= 0x20 && !(code >= 0x7f && code <= 0x9f),
				`unexpected control U+${code.toString(16).padStart(4, "0")} in ${JSON.stringify(row)}`,
			).toBe(true);
			index += 1;
		}
	}
	const raw = rows.join("");
	for (const text of hostileText) expect(raw).not.toContain(text);
}

const widths = [0, 1, 4, 20, 60, 72, 100];

describe("settings previews", () => {
	it.each(widths)("bounds deterministic Editor output at width %i", (width) => {
		const current = config();
		const first = renderEditorSettingsPreview(current, theme(), width);
		expect(first).toEqual(renderEditorSettingsPreview(current, theme(), width));
		expect(first.length).toBeLessThanOrEqual(SETTINGS_PREVIEW_MAX_ROWS);
		if (width <= 0) expect(first).toEqual([]);
		if (first.length > 0) expect(visibleWidth(first.at(-1) ?? "")).toBeGreaterThan(0);
		for (const row of first)
			expect(visibleWidth(row)).toBeLessThanOrEqual(Math.min(width, SETTINGS_PREVIEW_MAX_WIDTH));
	});

	it.each(widths)("bounds deterministic User-message output at width %i", (width) => {
		const current = config();
		const first = renderUserMessageSettingsPreview(current, theme(), width);
		expect(first).toEqual(renderUserMessageSettingsPreview(current, theme(), width));
		expect(first.length).toBeLessThanOrEqual(SETTINGS_PREVIEW_MAX_ROWS);
		if (width <= 0) expect(first).toEqual([]);
		if (first.length > 0) expect(visibleWidth(first.at(-1) ?? "")).toBeGreaterThan(0);
		for (const row of first)
			expect(visibleWidth(row)).toBeLessThanOrEqual(Math.min(width, SETTINGS_PREVIEW_MAX_WIDTH));
	});

	it("renders the defining structure of all four Editor styles without status cues", () => {
		const outputs = Object.fromEntries(
			(["opencode", "opencode-copy-friendly", "accent-rail", "minimalist"] as EditorStyle[]).map(
				(style) => {
					const current = config();
					current.components.editor.style = style;
					return [style, plain(renderEditorSettingsPreview(current, theme(), 72))];
				},
			),
		) as Record<EditorStyle, string>;
		expect(new Set(Object.values(outputs)).size).toBe(4);
		for (const output of Object.values(outputs)) {
			expect(output).not.toContain("Editor preview");
			expect(output).not.toContain("preview enabled");
			expect(output).not.toContain("preview disabled");
		}
		expect(outputs.opencode).toContain("│ Explain this change safely.");
		expect(outputs.opencode).toContain("─── ↑ 2 more");
		expect(outputs.opencode).toContain("↑↓ Navigate");
		expect(outputs.opencode).not.toContain("→ settings");
		expect(outputs["opencode-copy-friendly"]).toContain("\nExplain this change safely.");
		expect(outputs["opencode-copy-friendly"]).toContain("↑↓ Navigate");
		expect(outputs["opencode-copy-friendly"]).toContain("\n sonnet-4");
		expect(outputs["opencode-copy-friendly"]).not.toContain("│ Explain this change safely.");
		expect(outputs["accent-rail"]).toContain("▎ Explain this change safely.");
		expect(outputs["accent-rail"]).toContain("▎ settings     Open settings");
		expect(outputs["accent-rail"]).toContain("  files        Search files");
		expect(outputs["accent-rail"]).not.toContain("sonnet-4");
		expect(outputs.minimalist).toContain("╭─ ↑ 2 more");
		expect(outputs.minimalist).toContain("╰─ ↓ 3 more");
		expect(outputs.minimalist).toContain("feat/settings-previews");
		const disabled = config();
		disabled.components.editor.enabled = false;
		const disabledOutput = plain(renderEditorSettingsPreview(disabled, theme(), 72));
		expect(disabledOutput).toContain("Explain this change safely.");
		expect(disabledOutput).not.toContain("preview");
	});

	it("previews transparent palette and native completion menus independently for both Opencode styles", () => {
		const current = config();
		const renderRows = () => renderEditorSettingsPreview(current, theme(), 72);
		const render = () => plain(renderRows());
		expect(render()).toContain("↑↓ Navigate");
		expect(render()).not.toContain("→ settings");
		expect(render()).not.toContain("(1/47)");
		expect(renderRows().join("\n")).not.toContain("\x1b[48;5;234m");

		current.components.editor.styles.opencode.completionMenu = "native";
		expect(render()).not.toContain("↑↓ Navigate");
		expect(render()).toContain("→ settings");
		expect(render()).toContain("(1/47)");
		expect(current.components.editor.styles["opencode-copy-friendly"].completionMenu).toBe(
			"palette",
		);

		current.components.editor.style = "opencode-copy-friendly";
		expect(render()).toContain("↑↓ Navigate");
		expect(render()).not.toContain("(1/47)");
		current.components.editor.styles["opencode-copy-friendly"].completionMenu = "native";
		expect(render()).not.toContain("↑↓ Navigate");
		expect(render()).toContain("→ settings");
		expect(render()).toContain("(1/47)");
	});

	it("passes enabled and disabled viewport indicators through the Accent Rail preview", () => {
		const current = config();
		current.components.editor.style = "accent-rail";
		const render = () => plain(renderEditorSettingsPreview(current, theme(), 72));

		current.components.editor.viewportIndicators = true;
		expect(render()).toContain("▎ ↑ 2 more");
		expect(render()).toContain("▎ ↓ 3 more");

		current.components.editor.viewportIndicators = false;
		expect(render()).not.toContain("↑ 2 more");
		expect(render()).not.toContain("↓ 3 more");
		expect(render()).toContain("▎ Explain this change safely.");
	});

	it("previews filled and transparent Accent Rail surfaces", () => {
		const current = config();
		current.components.editor.style = "accent-rail";
		const render = () => renderEditorSettingsPreview(current, theme(), 72).join("\n");
		const filled = render();
		expect(filled).toContain("\x1b[48;5;234m");
		expect(plain(filled.split("\n"))).toContain("▎ settings     Open settings");

		current.components.editor.styles["accent-rail"].transparent = true;
		const transparent = render();
		expect(transparent).not.toContain("\x1b[48;5;234m");
		expect(plain(transparent.split("\n"))).toContain("▎ settings     Open settings");
	});

	it("responds to Editor visible settings and selected metadata format", () => {
		const current = config();
		const render = () => renderEditorSettingsPreview(current, theme(), 72).join("\n");
		const baseline = render();
		current.components.editor.colorSource = "terminal";
		expect(render()).not.toBe(baseline);
		current.components.editor.modelLabel = "name";
		expect(plain(renderEditorSettingsPreview(current, theme(), 72))).toContain("Sonnet 4");
		current.components.editor.styles.opencode.metadataFormat = "$provider";
		expect(plain(renderEditorSettingsPreview(current, theme(), 72))).toContain("Anthropic");
		current.components.editor.viewportIndicators = false;
		expect(plain(renderEditorSettingsPreview(current, theme(), 72))).not.toContain("↑ 2 more");
		current.components.editor.viewportIndicators = true;
		expect(plain(renderEditorSettingsPreview(current, theme(), 72))).toContain("↑ 2 more");
		const staticBorder = render();
		current.components.editor.borderColorMode = "adaptive";
		expect(render()).not.toBe(staticBorder);
	});

	it("responds to every applicable Minimalist setting and thresholds", () => {
		const current = config();
		current.components.editor.style = "minimalist";
		const minimalist = current.components.editor.styles.minimalist;
		const render = () => renderEditorSettingsPreview(current, theme(), 72).join("\n");
		const changes = [
			() => (minimalist.pathDisplay = "full"),
			() => (minimalist.contextFormat = "percent-total"),
			() => (minimalist.contextGauge = !minimalist.contextGauge),
			() => (minimalist.showSessionName = !minimalist.showSessionName),
			() => (minimalist.showTimer = !minimalist.showTimer),
			() => (minimalist.showCost = !minimalist.showCost),
			() => (minimalist.showGit = !minimalist.showGit),
			() => (minimalist.contextThresholds = { warning: 80, error: 90 }),
		];
		for (const [index, change] of changes.entries()) {
			const before = render();
			change();
			expect(render(), `Minimalist change ${index}`).not.toBe(before);
		}
	});

	it("renders the defining structure of all four User-message styles without status cues", () => {
		const outputs = Object.fromEntries(
			(["framed", "framed-copy-friendly", "compact", "labeled"] as UserMessageStyle[]).map(
				(style) => {
					const current = config();
					current.components.userMessages.style = style;
					return [style, plain(renderUserMessageSettingsPreview(current, theme(), 72))];
				},
			),
		) as Record<UserMessageStyle, string>;
		expect(new Set(Object.values(outputs)).size).toBe(4);
		for (const output of Object.values(outputs)) {
			expect(output).not.toContain("User message preview");
			expect(output).not.toContain("preview enabled");
			expect(output).not.toContain("preview disabled");
		}
		expect(outputs.framed).toContain("│ Please review this change safely.");
		expect(outputs.framed).toContain("────────────────");
		const framed = config();
		framed.components.userMessages.style = "framed";
		const framedRows = plain(renderUserMessageSettingsPreview(framed, theme(), 72)).split("\n");
		expect(framedRows.at(-1)).toMatch(/^─+$/);
		expect(framedRows.at(-2)).toMatch(/^│ +$/);
		expect(outputs["framed-copy-friendly"]).toContain("\n Please review this change safely.");
		expect(outputs["framed-copy-friendly"]).not.toContain("│ Please review");
		const copyFriendly = config();
		copyFriendly.components.userMessages.style = "framed-copy-friendly";
		const copyFriendlyRows = plain(
			renderUserMessageSettingsPreview(copyFriendly, theme(), 72),
		).split("\n");
		expect(copyFriendlyRows.at(-1)).toMatch(/^─+$/);
		expect(copyFriendlyRows.at(-2)).toBe("");
		expect(outputs.compact).toContain("│ Please review this change safely.");
		expect(outputs.compact).not.toContain("────────────────");
		expect(outputs.labeled).toContain("╭─ User ─");
		expect(outputs.labeled).toContain("╰────");
		const current = config();
		const terminal = renderUserMessageSettingsPreview(current, theme(), 72).join("\n");
		current.components.userMessages.colorSource = "terminal";
		expect(renderUserMessageSettingsPreview(current, theme(), 72).join("\n")).not.toBe(terminal);
		current.components.userMessages.enabled = false;
		const disabledOutput = plain(renderUserMessageSettingsPreview(current, theme(), 72));
		expect(disabledOutput).toContain("Please review this change safely.");
		expect(disabledOutput).not.toContain("preview");
	});

	it("renders compact streaming Rail and Tree previews through production Pi Markdown", () => {
		const expected: Record<Exclude<ThinkingStepsMode, "streaming-experimental">, string[]> = {
			rail: [
				"│ Thinking",
				"│ · Inspect the change",
				"│ · Map the affected surface",
				"│ · Parse structural labels",
				"│ · Check narrow widths",
				"│ · Preserve native fallback",
				"│ · Validate rendered output",
				"│ • Verify compatibility",
			],
			tree: [
				"┆ Thinking",
				"├─ · Parse structural labels",
				"├─ · Check narrow widths",
				"├─ · Preserve native fallback",
				"├─ · Validate rendered output",
				"└─ • Verify compatibility",
			],
		};
		for (const mode of ["rail", "tree"] as const) {
			const current = config();
			current.components.thinkingSteps.mode = mode;
			const fullRows = renderThinkingStepsSettingsPreview(current, theme(), 72);
			const visibleRows = plain(fullRows)
				.split("\n")
				.map((line) => line.trimEnd());
			expect(visibleRows).toEqual(expected[mode]);
			expect(fullRows).toHaveLength(mode === "rail" ? 8 : 6);
			expect(visibleRows).not.toContain("");
			expect(fullRows.join("\n")).toContain("•");
			expect(fullRows.join("\n")).toContain("·");
			expect(renderThinkingStepsSettingsPreview(current, theme(), 9)).toEqual([]);
			expect(renderThinkingStepsSettingsPreview(current, theme(), 10)).not.toEqual([]);
		}
	});

	it("renders a pure static Streaming (Experimental) preview and mode-aware status", () => {
		const current = config();
		current.components.thinkingSteps.mode = "streaming-experimental";
		current.components.thinkingSteps.enabled = false;
		const saved = plain(
			renderThinkingStepsSettingsPreview(current, theme(), 72, {
				publicAvailable: true,
				experimental: {
					available: true,
					active: false,
					restartRequired: false,
				},
			}),
		);
		expect(saved).toContain("Thinking 7.1s  (configured thinking toggle to expand)");
		expect(saved).toContain("Inspect the host-rendered reasoning tail.");
		expect(saved).toContain("Preserve native Markdown and wrapping.");
		expect(saved).toContain("Experimental renderer supported · restart required");
		const active = plain(
			renderThinkingStepsSettingsPreview(current, theme(), 72, {
				publicAvailable: true,
				experimental: {
					available: true,
					active: true,
					restartRequired: false,
				},
			}),
		);
		expect(active).toContain("Experimental renderer active");
		current.components.thinkingSteps.enabled = true;
		const unavailable = plain(renderThinkingStepsSettingsPreview(current, theme(), 72, false));
		expect(unavailable).toBe("Experimental renderer unavailable · using native thinking");
		expect(unavailable).not.toContain("configured thinking toggle to expand");
		expect(unavailable).not.toContain("host-rendered reasoning tail");
	});

	it("keeps the compact title in native thinking color and bolds only Thinking and the active label", () => {
		const colors: string[] = [];
		const boldText: string[] = [];
		const trackedTheme = {
			...theme(),
			fg: (color: string, text: string) => {
				colors.push(color);
				return text;
			},
			bold: (text: string) => {
				boldText.push(text);
				return text;
			},
		} as unknown as Theme;
		const rows = renderThinkingStepsSettingsPreview(config(), trackedTheme, 72);
		expect(plain(rows)).toContain("┆ Thinking");
		expect(colors).toContain("thinkingText");
		expect(colors).not.toContain("mdHeading");
		expect(boldText).toContain("Thinking");
		expect(boldText).toContain("Verify compatibility");
		expect(boldText).not.toContain("Inspect the change");
		expect(colors).not.toEqual(expect.arrayContaining(["mdListBullet", "mdQuote", "mdCode"]));
	});

	it("keeps unavailable Thinking capability status across the compact preview threshold", () => {
		for (const mode of ["rail", "tree"] as const) {
			const current = config();
			current.components.thinkingSteps.mode = mode;
			const below = renderThinkingStepsSettingsPreview(current, theme(), 9, false);
			const at = renderThinkingStepsSettingsPreview(current, theme(), 10, false);

			expect(plain(below)).toBe("Pi 0.84+ ");
			expect(plain(at)).toContain(mode === "rail" ? "│ Thinking" : "┆ Thinking");
			expect(plain(at.slice(-1))).toBe("Pi 0.84+ r");
			for (const [width, rows] of [
				[9, below],
				[10, at],
			] as const) {
				expect(rows.length).toBeLessThanOrEqual(SETTINGS_PREVIEW_MAX_ROWS);
				expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			}
		}
	});

	it.each([0, 1, 4, 16, 17, 20, 60, 72, 100])(
		"bounds Thinking-step output and never exposes fixture Markdown at width %i",
		(width) => {
			for (const mode of ["rail", "tree"] as const) {
				const current = config();
				current.components.thinkingSteps.mode = mode;
				const rows = renderThinkingStepsSettingsPreview(current, theme(), width);
				expect(rows.length).toBeLessThanOrEqual(SETTINGS_PREVIEW_MAX_ROWS);
				for (const row of rows)
					expect(visibleWidth(row)).toBeLessThanOrEqual(
						Math.min(width, SETTINGS_PREVIEW_MAX_WIDTH),
					);
				expect(plain(rows)).not.toContain(THINKING_STEPS_PREVIEW_MARKDOWN);
				expect(plain(rows)).not.toContain("# Inspect the change");
			}
		},
	);

	it("keeps Thinking-step preview independent of enablement and capability", () => {
		for (const mode of ["rail", "tree"] as const) {
			const current = config();
			current.components.thinkingSteps.mode = mode;
			current.components.thinkingSteps.enabled = false;
			const disabled = renderThinkingStepsSettingsPreview(current, theme(), 72);
			current.components.thinkingSteps.enabled = true;
			expect(renderThinkingStepsSettingsPreview(current, theme(), 72)).toEqual(disabled);
			const unsupported = renderThinkingStepsSettingsPreview(current, theme(), 72, false);
			expect(unsupported.slice(0, -1)).toEqual(disabled);
			expect(plain(unsupported.slice(-1))).toBe("Pi 0.84+ required · Using native thinking");
		}
	});

	it("re-renders Thinking-step preview with current mode and theme immediately", () => {
		const current = config();
		current.components.thinkingSteps.mode = "rail";
		const rail = renderThinkingStepsSettingsPreview(current, theme(0), 72);
		current.components.thinkingSteps.mode = "tree";
		const tree = renderThinkingStepsSettingsPreview(current, theme(37), 72);
		expect(tree).not.toEqual(rail);
		expect(plain(rail)).toContain("│ Thinking");
		expect(plain(tree)).toContain("┆ Thinking");
		expect(plain(rail)).not.toMatch(/Thinking ·|Thinking.*Rail|Thinking.*Tree/);
		expect(plain(tree)).not.toMatch(/Thinking ·|Thinking.*Rail|Thinking.*Tree/);
	});

	it("sanitizes hostile source and configured icons before trusted preview styling", () => {
		const current = config();
		current.icons.rail = "\x1b]2;RAIL-OSC\x07│\u009b31m\u009dRAIL-C1\u009c\u009b0m";
		current.icons.editorPrompt =
			"❯\x1b]8;;https://PROMPT-OSC.evil.invalid\x07\x1b]8;;\x07\x1b]2;TRUNCATED-OSC";
		current.icons.ahead = "↑\x1bP$qARROW-DCS\x1b\\";
		current.icons.behind = "↓\u009dARROW-C1\u009c";

		current.components.editor.styles["accent-rail"].rail =
			"▎\x1b]2;ACCENT-RAIL-OSC\x07\u009b31m\u009dACCENT-RAIL-C1\u009c\u009b0m";

		for (const style of [
			"opencode",
			"opencode-copy-friendly",
			"accent-rail",
			"minimalist",
		] as EditorStyle[]) {
			current.components.editor.style = style;
			expectOnlyTrustedSgr(renderEditorSettingsPreview(current, theme(), 72), [
				"RAIL-OSC",
				"RAIL-C1",
				"PROMPT-OSC",
				"ARROW-DCS",
				"ARROW-C1",
				"evil.invalid",
				"TRUNCATED-OSC",
				"ACCENT-RAIL-OSC",
				"ACCENT-RAIL-C1",
			]);
		}
		current.components.editor.style = "opencode";
		expect(plain(renderEditorSettingsPreview(current, theme(), 72))).toContain("│");
		current.components.editor.style = "opencode-copy-friendly";
		expect(plain(renderEditorSettingsPreview(current, theme(), 72))).toContain("❯");
		expect(current.icons.rail).toContain("RAIL-OSC");
		expect(current.icons.editorPrompt).toContain("TRUNCATED-OSC");

		for (const style of [
			"framed",
			"framed-copy-friendly",
			"compact",
			"labeled",
		] as UserMessageStyle[]) {
			current.components.userMessages.style = style;
			const rows = renderUserMessageSettingsPreview(
				current,
				theme(),
				72,
				"safe \x1b[31mred\x1b[0m \x1b]2;SOURCE-OSC\x07 title \u009b32mgreen\u009b0m\nnext",
			);
			expectOnlyTrustedSgr(rows, ["RAIL-OSC", "RAIL-C1", "SOURCE-OSC"]);
			const rendered = plain(rows);
			expect(rendered).toContain("safe red");
			expect(rendered).toContain("green");
			expect(rendered).toContain("next");
		}
	});

	it("re-renders from the current theme without cached preview rows", () => {
		const current = config();
		const firstEditor = renderEditorSettingsPreview(current, theme(0), 72);
		const secondEditor = renderEditorSettingsPreview(current, theme(37), 72);
		const firstMessage = renderUserMessageSettingsPreview(current, theme(0), 72);
		const secondMessage = renderUserMessageSettingsPreview(current, theme(37), 72);
		expect(secondEditor).not.toEqual(firstEditor);
		expect(secondMessage).not.toEqual(firstMessage);
		expect(plain(secondEditor)).toBe(plain(firstEditor));
		expect(plain(secondMessage)).toBe(plain(firstMessage));
	});
});
