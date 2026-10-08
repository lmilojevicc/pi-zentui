import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	mergeConfig,
	saveComponentColor,
	saveWorkingLineComponentPatch,
} from "../extensions/zentui/config";
import {
	createTurnSummaryData,
	formatTurnSummary,
	isTurnSummaryData,
	renderTurnSummaryEntry,
} from "../extensions/zentui/interaction-summary";
import {
	DEFAULT_TURN_SUMMARY_FORMAT,
	normalizeTurnSummaryFormat,
	renderTurnSummaryFormat,
} from "../extensions/zentui/turn-summary-format";
import { buildWorkingLineFrames } from "../extensions/zentui/working-line";

const metrics = { durationMs: 56000, thoughtDurationMs: 10000, input: 7100, output: 779 };
const theme = {
	fg: (_: string, text: string) => `\x1b[36m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};
const record = () =>
	createTurnSummaryData(metrics, 42.4, theme, mergeConfig({}).components.workingLine, {} as never);

describe("persisted turn summary format and v4 validation", () => {
	it("renders the default with whole labels, optional thought and known zero", () => {
		expect(formatTurnSummary(record())).toBe(
			" Turn took 56s · thought for 10s · ↑7.1k ↓779 · 42 tok/s avg",
		);
		expect(
			renderTurnSummaryFormat(DEFAULT_TURN_SUMMARY_FORMAT, {
				...metrics,
				thoughtDurationMs: 0,
				input: 0,
				output: 0,
			}),
		).toBe(" Turn took 56s · ↑0 ↓0");
		expect(renderTurnSummaryFormat("$token_rate", { ...metrics, averageTokenRate: 0 })).toBe(
			" 0 tok/s avg",
		);
	});
	it("reuses optional/join/braced grammar and empties unknown names without execution", () => {
		expect(
			renderTurnSummaryFormat(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Exercise the shared braced-variable grammar.
				"${output_tokens}$join_sep($missing)$join_sep($separator$thought_duration)$join_sep$token_rate",
				{ ...metrics, thoughtDurationMs: 0 },
			),
		).toBe(" 779");
		expect(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Exercise the shared braced-variable grammar.
			renderTurnSummaryFormat(" ${input_tokens}$sep$output_tokens$separator${token_rate}", {
				...metrics,
				averageTokenRate: 42,
			}),
		).toBe(" 7.1k · 779 · 42 tok/s avg");
		expect(renderTurnSummaryFormat("($constructor)($toString)($unknown)literal", metrics)).toBe(
			" literal",
		);
	});
	it.each([undefined, null, false, 42, "", " \n\t ", "x".repeat(2049)])(
		"defaults missing/invalid/empty format %s",
		(format) => {
			expect(normalizeTurnSummaryFormat(format)).toBe(DEFAULT_TURN_SUMMARY_FORMAT);
			expect(
				mergeConfig({ components: { workingLine: { turnSummaryFormat: format } } }).components
					.workingLine.turnSummaryFormat,
			).toBe(DEFAULT_TURN_SUMMARY_FORMAT);
		},
	);
	it("fails open on deeply nested joined groups instead of amplifying untrusted template work", () => {
		const format = `${"($join_sep".repeat(100)}$input_tokens${")".repeat(100)}`;
		expect(normalizeTurnSummaryFormat(format)).toBe(DEFAULT_TURN_SUMMARY_FORMAT);
		expect(isTurnSummaryData({ ...record(), format })).toBe(false);
		expect(renderTurnSummaryFormat(format, metrics)).toBe(
			" Turn took 56s · thought for 10s · ↑7.1k ↓779",
		);
	});
	it("sanitizes terminal controls and line breaks before saving or rendering", () => {
		const unsafe = "safe\x1b]52;c;evil\x07\x1b[31m\n$input_tokens\r\x00";
		expect(normalizeTurnSummaryFormat(unsafe)).toBe("safe $input_tokens ");
		expect(renderTurnSummaryFormat(unsafe, metrics)).toBe(" safe 7.1k ");
		expect(isTurnSummaryData({ ...record(), format: unsafe })).toBe(false);
	});
	it("validates exact keys, bounded safe format/style and finite nonnegative optional average", () => {
		expect(isTurnSummaryData(record())).toBe(true);
		const { averageTokenRate: _, ...unknown } = record();
		expect(isTurnSummaryData(unknown)).toBe(true);
		expect(formatTurnSummary(unknown)).not.toContain("tok/s");
		for (const patch of [
			{ version: 5 },
			{ extra: true },
			{ format: "" },
			{ format: "x".repeat(2049) },
			{ stylePrefix: "\x1b]0;evil\x07" },
			{ thoughtDurationMs: -1 },
			...[undefined, -1, NaN, Infinity, "42"].map((averageTokenRate) => ({ averageTokenRate })),
		]) {
			expect(isTurnSummaryData({ ...record(), ...patch })).toBe(false);
		}
		expect(isTurnSummaryData({ ...record(), stylePrefix: "" })).toBe(true);
		for (const version of [2, 3])
			expect(
				isTurnSummaryData({
					version,
					durationMs: 0,
					input: 0,
					output: 0,
					...(version === 3 ? { thoughtDurationMs: 0 } : {}),
					stylePrefix: "",
				}),
			).toBe(false);
	});
	it("snapshots format and style independently of live animation and later configuration", () => {
		const config = mergeConfig({
			colors: { workingLineHigh: "fg:202" },
			components: {
				workingLine: {
					colorSource: "terminal",
					textAnimation: "disabled",
					colors: { high: "fg:203" },
				},
			},
		});
		const frames = buildWorkingLineFrames(
			config.components.workingLine,
			config.colors,
			theme,
			"Working",
		).frames;
		expect(
			createTurnSummaryData(metrics, undefined, theme, config.components.workingLine, config.colors)
				.stylePrefix,
		).toBe("\x1b[38;5;203m");
		config.components.workingLine.colors = { high: "fg:203", turnSummary: "fg:204" };
		config.components.workingLine.turnSummaryFormat = "$output_tokens$join_sep$token_rate";
		const saved = createTurnSummaryData(
			metrics,
			42,
			theme,
			config.components.workingLine,
			config.colors,
		);
		expect(saved.stylePrefix).toBe("\x1b[38;5;204m");
		expect(
			buildWorkingLineFrames(config.components.workingLine, config.colors, theme, "Working").frames,
		).toEqual(frames);
		config.components.workingLine.turnSummaryFormat = "new";
		config.components.workingLine.colors.turnSummary = " ";
		expect(
			createTurnSummaryData(metrics, undefined, theme, config.components.workingLine, config.colors)
				.stylePrefix,
		).toBe("");
		expect(renderTurnSummaryEntry({ data: saved }, {}, theme)?.render(100).join("")).toContain(
			"\x1b[38;5;204m 779 · 42 tok/s avg",
		);
	});
	it("preserves other owners/unknown raw data and deletes only reset overrides", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-summary-config-"));
		const path = join(dir, "zentui.json");
		const other = { editor: { future: 1 }, footer: { style: "native", future: 2 } };
		try {
			writeFileSync(
				path,
				JSON.stringify({
					future: { keep: true },
					components: {
						...other,
						workingLine: { turnSummary: false, future: 3, colors: { high: "red", future: "keep" } },
					},
				}),
			);
			expect(
				saveWorkingLineComponentPatch({ turnSummaryFormat: 123 } as never, path).components
					.workingLine.turnSummaryFormat,
			).toBe(DEFAULT_TURN_SUMMARY_FORMAT);
			saveWorkingLineComponentPatch({ turnSummaryFormat: "$output_tokens" }, path);
			saveComponentColor("workingLine", "turnSummary", "", path);
			let raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.components.workingLine).toMatchObject({
				turnSummary: false,
				turnSummaryFormat: "$output_tokens",
				future: 3,
				colors: { high: "red", turnSummary: "", future: "keep" },
			});
			saveWorkingLineComponentPatch({ turnSummaryFormat: " " }, path);
			expect(JSON.parse(readFileSync(path, "utf8")).components.workingLine).not.toHaveProperty(
				"turnSummaryFormat",
			);
			saveComponentColor("workingLine", "turnSummary", undefined, path);
			raw = JSON.parse(readFileSync(path, "utf8"));
			expect(raw.components.workingLine.turnSummaryFormat).toBe(DEFAULT_TURN_SUMMARY_FORMAT); // Ordinary saves snapshot the edited owner.
			expect(raw.components.workingLine.colors).toEqual({ high: "red", future: "keep" });
			expect(raw.components.editor).toEqual(other.editor);
			expect(raw.components.footer).toEqual(other.footer);
			expect(raw.future).toEqual({ keep: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
