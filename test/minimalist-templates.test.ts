import { stripVTControlCharacters as plain } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { codexQuotaText } from "../extensions/zentui/codex-quota-display";
import { type MinimalistEditorStyleConfig, mergeConfig } from "../extensions/zentui/config";
import {
	type MinimalistEditorMetadata,
	renderMinimalistFrame,
} from "../extensions/zentui/minimalist-editor";
import {
	effectiveMinimalistFormats,
	MINIMALIST_FORMAT_SLOTS,
	type MinimalistFormats,
	minimalistDemandsCustomVariable,
	minimalistTemplateReferences,
} from "../extensions/zentui/minimalist-template";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
const emptySlots = Object.fromEntries(
	MINIMALIST_FORMAT_SLOTS.map((slot) => [slot, ""]),
) as MinimalistFormats;
function config(
	style: Partial<MinimalistEditorStyleConfig> = {},
	colorSource = "theme",
	quota = false,
) {
	return mergeConfig({
		components: {
			editor: {
				style: "minimalist",
				colorSource,
				codexQuota: quota,
				styles: { minimalist: style },
			},
		},
	});
}
function render(
	style: Partial<MinimalistEditorStyleConfig> = {},
	metadata: Partial<MinimalistEditorMetadata> = {},
	width = 100,
	colorSource = "theme",
	extra = {},
) {
	return renderMinimalistFrame({
		width,
		editorLines: ["draft"],
		inputText: "draft",
		metadata: { cwd: "/repo", ...metadata },
		uiTheme: theme,
		config: config(style, colorSource),
		...extra,
	});
}

describe("Minimalist six-slot templates", () => {
	it.each(MINIMALIST_FORMAT_SLOTS)("positions named values in %s", (slot) => {
		const rows = render(
			{ formats: { ...emptySlots, [slot]: "<$build>" }, variables: { build: "pkg.build" } },
			{ customVariables: new Map([["pkg.build", "READY"]]) },
		);
		expect(rows).toHaveLength(3);
		const border = slot.startsWith("top") ? rows[0] : rows[2];
		expect(border).toContain("<READY>");
		expect(rows[1]).toMatch(/^│ draft\s+│$/);
		if (slot.endsWith("Left")) expect(border).toMatch(/^[╭╰]─ <READY>/);
		if (slot.endsWith("Right")) expect(border).toMatch(/<READY> ─[╮╯]$/);
		if (slot.endsWith("Middle")) expect(border.indexOf("<READY>")).toBe(Math.floor((100 - 7) / 2));
	});

	it("centers independently of side lengths, clamps safely, and omits an oversized center", () => {
		const center = {
			formats: { ...emptySlots, topLeft: "LEFT", topMiddle: "CENTER", topRight: "R" },
		};
		expect(render(center)[0].indexOf("CENTER")).toBe(47);
		const clamped = render(
			{ formats: { ...emptySlots, topLeft: "L".repeat(28), topMiddle: "CENTER", topRight: "R" } },
			{},
			45,
		)[0];
		expect(clamped).toContain("CENTER");
		expect(clamped.indexOf("CENTER")).toBeGreaterThan(28);
		const narrow = render(center, {}, 20)[0];
		expect(narrow).not.toContain("CENTER");
		expect(narrow).toContain("LEFT");
		expect(narrow).toContain(" R ");
	});

	it("uses missing slots as defaults, and empty slots hide only configurable metadata", () => {
		const metadata = {
			costLabel: "$1",
			modelLabel: "model",
			branch: "main",
			sessionName: "session",
			agentDurationMs: 5000,
			workingLineFrame: "Working",
		};
		const rows = render(
			{ formats: { topLeft: "", topRight: "", bottomLeft: "" } },
			metadata,
			100,
			"theme",
			{ inputText: "!pwd", viewport: { above: "7", below: "8" } },
		);
		expect(rows[0]).toContain("↑ 7 more · $ · Working");
		expect(rows[2]).toContain("↓ 8 more");
		expect(rows[2]).toContain("repo");
		expect(rows.join("\n")).not.toMatch(/session|5s|model|main|\$1/);
	});

	it("keeps operational viewport counts atomic and preserves Bash/Working content with empty custom formats", () => {
		for (const width of [18, 24, 40, 80]) {
			const rows = render(
				{ formats: { ...emptySlots } },
				{ workingLineFrame: "Working" },
				width,
				"theme",
				{ inputText: "!pwd", viewport: { above: "123456789", below: "987654321" } },
			);
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			expect(rows[0]).toContain("$ · Working");
			if (rows[0].includes("more")) expect(rows[0]).toContain("↑ 123456789 more");
			if (rows[2].includes("more")) expect(rows[2]).toContain("↓ 987654321 more");
		}
	});

	it("respects nested conditional grammar and strips terminal controls from literal formats", () => {
		const style = {
			formats: { ...emptySlots, topLeft: "\x1b[31mSAFE\x1b[2J\n($build( / $missing))" },
			variables: { build: "pkg.build" },
		};
		expect(render(style)[0]).toContain("SAFE");
		expect(render(style)[0]).not.toContain("/");
		const row = render(style, { customVariables: new Map([["pkg.build", "OK"]]) })[0];
		expect(row).toContain("SAFE OK");
		expect(row).not.toContain("\x1b[2J");
		expect(row).not.toContain("/");
	});

	it("explicit builtin references override visibility toggles and preserve local formats", () => {
		const rows = render(
			{
				showTimer: false,
				showSessionName: false,
				showCost: false,
				showGit: false,
				showCacheHit: false,
				contextFormat: "percent-total",
				pathDisplay: "full",
				formats: {
					...emptySlots,
					topLeft: "$turn_duration · $session_name",
					topRight: "$cost / $cache_hit / $context",
					bottomLeft: "$git_branch $git_status",
					bottomRight: "$cwd",
				},
			},
			{
				agentDurationMs: 5000,
				sessionName: "session",
				costLabel: "$1",
				cacheHitRate: 75,
				contextPercent: 42,
				contextWindow: 100000,
				branch: "main",
				dirty: true,
				cwd: "/repo/src",
			},
			140,
		);
		expect(rows[0]).toContain("5s · session");
		expect(rows[0]).toContain("$1 / Cache 75.0% / 42%/100k");
		expect(rows[2]).toContain("main *");
		expect(rows[2]).toContain("/repo/src");
	});

	it("exposes model variants, provider, thinking, and supplied token counts", () => {
		const rows = render(
			{
				formats: {
					...emptySlots,
					topLeft: "$model $model_id $model_name $provider $thinking",
					topRight: "$tokens $input_tokens $output_tokens",
				},
			},
			{
				modelLabel: "chosen",
				modelId: "id",
				modelName: "name",
				provider: "provider",
				thinkingLevel: "high",
				inputTokens: 1200,
				outputTokens: 300,
			},
			140,
		);
		expect(rows[0]).toContain("chosen id name provider high");
		expect(rows[0]).toContain("1.2k");
		expect(rows[0]).toContain("300");
		expect(
			render({ formats: { ...emptySlots, topRight: "($thinking)" } }, { thinkingLevel: "off" })[0],
		).not.toContain("off");
	});
});

describe("Minimalist custom values and width safety", () => {
	it("inserts the default aggregate after cost in deterministic key order", () => {
		const row = render(
			{},
			{
				costLabel: "$1",
				modelLabel: "model",
				thinkingLevel: "high",
				contextPercent: 42,
				customVariables: new Map([
					["z.value", "Z"],
					["a.value", "A"],
				]),
			},
		)[0];
		expect(row).toContain("$1 – A – Z – model – high – 42%");
	});

	it("skips explicitly referenced keys from the aggregate across all six effective slots", () => {
		const rows = render(
			{ formats: { bottomMiddle: "$build" }, variables: { build: "pkg.build", same: "pkg.build" } },
			{
				costLabel: "$1",
				modelLabel: "model",
				customVariables: new Map([
					["pkg.build", "READY"],
					["pkg.other", "OTHER"],
				]),
			},
		);
		expect(rows[0]).toContain("$1 – OTHER – model");
		expect(rows.join("\n").match(/READY/g)).toHaveLength(1);
	});

	it("never appends values to explicit templates", () => {
		const rows = render(
			{ formats: { topRight: "$model" } },
			{ modelLabel: "model", customVariables: new Map([["pkg.value", "VALUE"]]) },
		);
		expect(rows[0]).toContain("model");
		expect(rows.join("\n")).not.toContain("VALUE");
	});

	it.each(["theme", "terminal"])(
		"preserves Original SGR/link closures and applies Zentui color mode with %s colors",
		(source) => {
			const value = "\x1b[31mRED\x1b]8;;https://example.com\x1b\\LINK\x1b[2J\n界 e\u0301 👩‍💻";
			const metadata = { customVariables: new Map([["pkg.value", value]]) };
			const original = render(
				{ formats: { ...emptySlots, topRight: "$value" }, variables: { value: "pkg.value" } },
				metadata,
				100,
				source,
			)[0];
			expect(original).toContain("\x1b[31m");
			expect(original).toMatch(/\x1b\]8;;(?:\x07|\x1b\\)/);
			expect(original).not.toContain("\x1b[2J");
			expect(original).toContain("\x1b[0m");
			const zentui = render(
				{
					extensionColorMode: "zentui",
					formats: { ...emptySlots, topRight: "$value" },
					variables: { value: "pkg.value" },
				},
				metadata,
				100,
				source,
			)[0];
			expect(zentui).not.toContain("\x1b[31m");
			expect(zentui).not.toContain("\x1b]8;");
			expect(plain(zentui)).toContain("REDLINK 界 e\u0301 👩‍💻");
		},
	);

	it("drops custom values whole before builtin sides and never clips Unicode values", () => {
		const value = "界👩‍💻e\u0301-BUILD-READY";
		for (let width = 5; width <= 100; width++) {
			const rows = render(
				{
					formats: {
						...emptySlots,
						topLeft: "($value)",
						topRight: "$model",
						bottomRight: "($value)",
					},
					variables: { value: "pkg.value" },
				},
				{ modelLabel: "MODEL", customVariables: new Map([["pkg.value", `\x1b[31m${value}`]]) },
				width,
			);
			for (const row of rows) {
				expect(visibleWidth(row)).toBeLessThanOrEqual(width);
				if (plain(row).includes("BUILD") || plain(row).includes("界"))
					expect(plain(row)).toContain(value);
			}
			if (width >= 12) expect(rows[0]).toContain("MODEL");
		}
	});

	it("keeps default builtin narrow fallbacks/gauges identical with oversized extensions", () => {
		const metadata = {
			costLabel: "$1",
			modelLabel: "model".repeat(20),
			thinkingLevel: "high",
			contextPercent: 99,
			contextWindow: 200000,
			sessionName: "long session ".repeat(10),
			agentDurationMs: 12000,
		};
		for (const width of [16, 20, 30, 40, 60]) {
			const style = { contextGauge: true, contextFormat: "percent-total" as const };
			expect(
				render(
					style,
					{ ...metadata, customVariables: new Map([["pkg.value", "VALUE".repeat(40)]]) },
					width,
				),
			).toEqual(render(style, metadata, width));
		}
	});

	it("retains exact default output with no values or overrides", () => {
		const metadata = {
			costLabel: "$1",
			modelLabel: "model",
			thinkingLevel: "high",
			contextPercent: 42,
			sessionName: "session",
			agentDurationMs: 5000,
			branch: "main",
		};
		for (const source of ["theme", "terminal"])
			for (const width of [1, 4, 5, 12, 20, 40, 80, 140]) {
				expect(
					render(
						{ formats: {}, variables: {}, extensionColorMode: "original" },
						{ ...metadata, customVariables: new Map() },
						width,
						source,
					),
				).toEqual(render({}, metadata, width, source));
			}
	});

	it("retains default top-row narrow fallbacks when only an empty center slot is overridden", () => {
		const metadata = {
			costLabel: "$1",
			modelLabel: "model".repeat(20),
			thinkingLevel: "high",
			contextPercent: 99,
			contextWindow: 200000,
			sessionName: "long session ".repeat(10),
			agentDurationMs: 12000,
		};
		for (const width of [16, 20, 30, 40, 60, 100]) {
			const style = { contextGauge: true, contextFormat: "percent-total" as const };
			expect(render({ ...style, formats: { topMiddle: "" } }, metadata, width)[0]).toEqual(
				render(style, metadata, width)[0],
			);
		}
	});

	it("requires quota consent even when referenced and keeps the entire quota atomic", () => {
		const quota = { fiveHour: 80, week: 60 };
		const style = {
			formats: { ...emptySlots, topRight: "($codex_quota)($value)" },
			variables: { value: "pkg.value" },
		};
		expect(render(style, { codexQuota: quota })[0]).not.toContain("5h");
		for (let width = 5; width <= 100; width++) {
			const rows = renderMinimalistFrame({
				width,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: {
					cwd: "",
					codexQuota: quota,
					customVariables: new Map([["pkg.value", "CUSTOM"]]),
				},
				uiTheme: theme,
				config: config(style, "terminal", true),
			});
			for (const row of rows) {
				expect(visibleWidth(row)).toBeLessThanOrEqual(width);
				if (plain(row).includes("5h")) expect(plain(row)).toContain(codexQuotaText(quota));
			}
		}
	});
});

describe("Minimalist effective template demand", () => {
	it("reports generated defaults and honours explicit empty slots", () => {
		const style = config().components.editor.styles.minimalist;
		expect(effectiveMinimalistFormats(style).topRight).toContain("$cost$sep$extensions$sep$model");
		expect(minimalistDemandsCustomVariable(style, "any.key")).toBe(true);
		const noDemand = { ...style, formats: { ...emptySlots } };
		expect(minimalistTemplateReferences(noDemand).size).toBe(0);
		expect(minimalistDemandsCustomVariable(noDemand)).toBe(false);
	});
	it("reports nested aliases without executing publishers or conflating dormant config with ownership", () => {
		const style = config({
			showGit: false,
			formats: { ...emptySlots, topLeft: "(($build))", bottomRight: "$cwd" },
			variables: { build: "pkg.build", unused: "pkg.unused" },
		}).components.editor.styles.minimalist;
		expect([...minimalistTemplateReferences(style)]).toEqual(["build", "cwd"]);
		expect(minimalistDemandsCustomVariable(style)).toBe(true);
		expect(minimalistDemandsCustomVariable(style, "pkg.build")).toBe(true);
		expect(minimalistDemandsCustomVariable(style, "pkg.unused")).toBe(false);
	});
});

describe("Minimalist conditional joins", () => {
	it.each(["dash", "dot"] as const)(
		"joins actual bottomLeft fields with %s only when populated",
		(separator) => {
			const style = {
				separator,
				showSessionName: false,
				showGit: false,
				formats: { ...emptySlots, bottomLeft: "$session_name$join_sep($git_branch $git_status)" },
			};
			for (const [sessionName, branch, expected] of [
				["Session", "", "Session"],
				["", "branch", "branch"],
				["Session", "branch", `Session ${separator === "dash" ? "–" : "·"} branch`],
				["", "", ""],
			]) {
				const rows = render(style, { sessionName, branch });
				if (expected) expect(plain(rows[2])).toMatch(new RegExp(`^╰─ ${expected} ─+╯$`));
				else expect(rows).toEqual(render({ ...style, formats: { ...emptySlots } }));
			}
			expect(render(style, { sessionName: "Session", branch: "branch", dirty: true })[2]).toContain(
				`Session ${separator === "dash" ? "–" : "·"} branch *`,
			);
			expect(render(style, { sessionName: "Session", dirty: true })[2]).toContain(
				`Session ${separator === "dash" ? "–" : "·"}  *`,
			);
		},
	);

	it("preserves colored values and regenerates joins when custom values or quota yield", () => {
		const style = {
			formats: { ...emptySlots, bottomLeft: "$session_name$join_sep$value$join_sep$git_branch" },
			variables: { value: "pkg.value" },
		};
		const metadata = {
			sessionName: "S",
			branch: "B",
			customVariables: new Map([["pkg.value", "\x1b[31mCUSTOM\x1b[0m"]]),
		};
		const wide = render(style, metadata, 100, "terminal")[2];
		expect(wide).toContain("\x1b[31mCUSTOM\x1b[0m");
		expect(plain(wide)).toContain("S – CUSTOM – B");
		for (const width of [15, 18, 22]) {
			const rows = render(
				style,
				{ ...metadata, customVariables: new Map([["pkg.value", "CUSTOM".repeat(30)]]) },
				width,
				"terminal",
			);
			expect(plain(rows[2])).toContain("S – B");
			expect(plain(rows[2])).not.toContain("– –");
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
		}
		const quotaStyle = {
			formats: {
				...emptySlots,
				bottomLeft: "$session_name$join_sep$codex_quota$join_sep$git_branch",
			},
		};
		const rows = renderMinimalistFrame({
			width: 18,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", sessionName: "S", branch: "B", codexQuota: { fiveHour: 80, week: 60 } },
			uiTheme: theme,
			config: config(quotaStyle, "terminal", true),
		});
		expect(plain(rows[2])).toContain("S – B");
		expect(plain(rows[2])).not.toContain("5h");
	});
});
