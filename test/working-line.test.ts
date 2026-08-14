import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Loader, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import {
	AgentDurationClock,
	BUILT_IN_WORKING_LINE_MESSAGES,
	buildWorkingLineFrames,
	buildWorkingLinePreviewFrames,
	buildWorkingLineSpinnerFrames,
	composeWorkingLineRow,
	effectiveWorkingLineMessages,
	formatWorkingLineThought,
	formatWorkingLineTokens,
	MAX_WORKING_LINE_ENTRIES_EXAMINED,
	MAX_WORKING_LINE_FRAME_CELLS,
	MAX_WORKING_LINE_FRAME_CODE_UNITS,
	MAX_WORKING_LINE_FRAMES,
	MAX_WORKING_LINE_MESSAGE_CELLS,
	MAX_WORKING_LINE_NORMALIZED_CODE_UNITS,
	MAX_WORKING_LINE_RAW_CODE_UNITS,
	MAX_WORKING_LINE_ROW_CELLS,
	MAX_WORKING_LINE_STYLE_CODE_UNITS,
	MAX_WORKING_LINE_STYLE_TOKENS,
	normalizeWorkingLineMessage,
	normalizeWorkingLineMessages,
	normalizeWorkingLineStyleSpec,
	normalizeWorkingLineToolLabel,
	remapWorkingLineTextTick,
	selectWorkingLineMessage,
	snapshotWorkingLineHighStyle,
	WORKING_LINE_SPINNERS,
	WorkingLineController,
	workingLineSpinnerWidth,
} from "../extensions/zentui/working-line";

function theme(): Theme {
	return {
		fg(color: string, text: string) {
			const codes: Record<string, number> = { dim: 90, muted: 36, accent: 96 };
			return `\x1b[${codes[color] ?? 37}m${text}\x1b[0m`;
		},
		bold(text: string) {
			return `\x1b[1m${text}\x1b[0m`;
		},
	} as Theme;
}

function config(): PolishedTuiConfig {
	return structuredClone(defaultConfig);
}

const stripTerminalSequences = stripVTControlCharacters;

function strippedFrames(frames: string[]): string[] {
	return frames.map((frame) => stripTerminalSequences(frame));
}

function highTierStart(frame: string): number | undefined {
	const marker = [...frame.matchAll(/\x1b\[96m\x1b\[1m/g)][1];
	if (marker?.index === undefined) return undefined;
	const stripped = stripTerminalSequences(frame);
	const separatorIndex = stripped.indexOf(" ");
	const rowOffset = visibleWidth(stripped.slice(0, separatorIndex + 1));
	return visibleWidth(stripTerminalSequences(frame.slice(0, marker.index))) - rowOffset;
}

function phaseSignature(frame: string): [string, number | undefined] {
	return [stripTerminalSequences(frame).split(" ", 1)[0] ?? "", highTierStart(frame)];
}

function phaseMotionSignature(frames: string[], index: number) {
	const current = phaseSignature(frames[index % frames.length] ?? "");
	const next = phaseSignature(frames[(index + 1) % frames.length] ?? "");
	return {
		spinnerGlyph: current[0],
		textPosition: current[1],
		textDirection:
			current[1] === undefined || next[1] === undefined
				? undefined
				: Math.sign(next[1] - current[1]),
	};
}

function gcdForTest(left: number, right: number): number {
	let a = left;
	let b = right;
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}

describe("working-line token formatting", () => {
	it("formats approximate and exact output identically while validating metadata", () => {
		expect(
			formatWorkingLineTokens({ input: 27_000, output: 1_400, outputApproximate: false }),
		).toBe("↑27k ↓1.4k");
		expect(formatWorkingLineTokens({ input: 27_000, output: 1_400, outputApproximate: true })).toBe(
			"↑27k ↓1.4k",
		);
		expect(
			formatWorkingLineTokens({ input: 1, output: 2, outputApproximate: "yes" } as never),
		).toBeUndefined();
	});

	it("reserves compact maximum-safe tokens within the complete 80-cell row", () => {
		const current = config();
		const composed = composeWorkingLineRow(current.components.workingLine, "x".repeat(43), {
			tokens: {
				input: Number.MAX_SAFE_INTEGER,
				output: Number.MAX_SAFE_INTEGER,
				outputApproximate: true,
			},
		});
		expect(composed.row).toContain("↑9007199255M ↓9007199255M");
		expect(visibleWidth(composed.row)).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAME_CELLS - 2);
	});
});

describe("working-line presets and frame generation", () => {
	it("ships pinned Funky UI Pulse provenance and the required MIT notices", () => {
		const source = readFileSync(
			new URL("../extensions/zentui/working-line-spinners.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain(
			"https://github.com/pi-zza/funky-ui/blob/e9aed319a4de61c2b2a5e99009821efa7b67b178/packages/funky-ui/extensions/funky-ui/animations.ts",
		);
		expect(source).toContain("37d82d565c1f5a9aa9b31d4b1711fa5604eb04a1");
		expect(source).toContain("Copyright (c) FammasMaz/pi-cc-tools contributors");
		expect(source).toContain("Copyright (c) 2026 Marko Nakic");
		expect(source).toContain("Permission is hereby granted, free of charge");
	});

	it("defines the exact fixed-width spinner frames without preset-owned cadences", () => {
		expect(WORKING_LINE_SPINNERS).toEqual({
			braille: {
				frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
			},
			"star-bloom": {
				frames: ["·", "✦", "✧", "✶", "✧", "✦"],
			},
			pinwheel: { frames: ["-", "\\", "|", "/"] },
			"claude-inspired": { frames: ["·", "✢", "✳", "✶", "✻", "✽"] },
			pulse: { frames: ["⠀⠶⠀", "⠰⣿⠆", "⢾⣉⡷", "⣏⠀⣹", "⡁⠀⢈"] },
		});
		for (const [id, preset] of Object.entries(WORKING_LINE_SPINNERS)) {
			const widths = new Set(preset.frames.map((frame) => visibleWidth(frame)));
			expect(widths).toEqual(new Set([id === "pulse" ? 3 : 1]));
			expect(workingLineSpinnerWidth(id as keyof typeof WORKING_LINE_SPINNERS)).toBe(
				id === "pulse" ? 3 : 1,
			);
		}
	});

	it("rejects zero-width and inconsistent spinner definitions defensively", () => {
		const mutable = WORKING_LINE_SPINNERS as unknown as { pulse: { frames: string[] } };
		const original = mutable.pulse.frames;
		try {
			mutable.pulse.frames = ["", ""];
			expect(() => workingLineSpinnerWidth("pulse")).toThrow(/positive fixed width/);
			mutable.pulse.frames = ["⠶", "⠰⣿⠆"];
			expect(() => workingLineSpinnerWidth("pulse")).toThrow(/positive fixed width/);
		} finally {
			mutable.pulse.frames = original;
		}
	});

	it("builds standalone spinner frames for preset validation", () => {
		const current = config();
		current.components.workingLine.messages.custom = false;
		const generated = buildWorkingLineSpinnerFrames(
			current.components.workingLine,
			current.colors,
			theme(),
		);
		expect(strippedFrames(generated.frames)).toEqual(["·", "✦", "✧", "✶", "✧", "✦"]);
		const offset = buildWorkingLineSpinnerFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			7,
		);
		expect(strippedFrames(offset.frames)).toEqual(["✦", "✧", "✶", "✧", "✦", "·"]);
		expect(generated.frames.some((frame) => frame.includes("Working"))).toBe(false);
	});

	it("renders exact owned Pulse frames in preset order", () => {
		const current = config();
		current.components.workingLine.spinner = "pulse";
		current.components.workingLine.spinnerIntervalMs = 180;
		current.components.workingLine.textAnimation = "disabled";
		const expected = ["⠀⠶⠀", "⠰⣿⠆", "⢾⣉⡷", "⣏⠀⣹", "⡁⠀⢈"];
		const generated = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Ready",
		);
		expect(strippedFrames(generated.frames)).toEqual(expected.map((frame) => `${frame} Ready`));
		expect(generated.intervalMs).toBe(180);
	});

	it.each([
		["classic", "braille"],
		["classic", "pulse"],
		["kitt", "braille"],
		["kitt", "pulse"],
	] as const)("keeps the %s %s spinner fixed while text tiers move", (textAnimation, spinner) => {
		const current = config();
		current.components.workingLine.spinner = spinner;
		current.components.workingLine.messages.custom = true;
		current.components.workingLine.textAnimation = textAnimation;
		current.components.workingLine.colorSource = "terminal";
		current.colors.workingLineLow = "bright-black";
		current.colors.workingLineMid = "cyan";
		current.colors.workingLineHigh = "bold green";
		const generated = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Ready",
			{ tool: "read", elapsedMs: 1000, tokens: { input: 12, output: 3 } },
		);
		const preset = WORKING_LINE_SPINNERS[spinner];
		const observedGlyphs = new Set<string>();
		const textHighPositions = new Set<number>();
		for (const [index, frame] of generated.frames.entries()) {
			const state = generated.frameStates[index];
			const glyph = preset.frames[(state?.spinnerTick ?? 0) % preset.frames.length] ?? "";
			const spinnerPrefix = `\x1b[1;32m${glyph}\x1b[0m `;
			expect(frame.startsWith(spinnerPrefix)).toBe(true);
			observedGlyphs.add(glyph);
			const text = frame.slice(spinnerPrefix.length);
			for (const match of text.matchAll(/\x1b\[1;32m/g)) {
				textHighPositions.add(visibleWidth(stripTerminalSequences(text.slice(0, match.index))));
			}
		}
		expect(observedGlyphs).toEqual(new Set(preset.frames));
		expect(generated.frames.some((frame) => frame.includes("\x1b[90m"))).toBe(true);
		expect(generated.frames.some((frame) => frame.includes("\x1b[36m"))).toBe(true);
		expect(textHighPositions.size).toBeGreaterThan(1);
		expect(generated.textWidth).toBe(visibleWidth(generated.row));
		expect(generated.textOrigin).toBe(workingLineSpinnerWidth(spinner) + 1);
	});

	it.each([
		["classic", "braille"],
		["classic", "pulse"],
		["kitt", "braille"],
		["kitt", "pulse"],
	] as const)(
		"includes the %s %s spinner and separator in the color sweep",
		(animation, spinner) => {
			const current = config();
			current.components.workingLine.spinner = spinner;
			current.components.workingLine.textAnimation = animation;
			current.components.workingLine.animateSpinnerColor = true;
			current.components.workingLine.colorSource = "terminal";
			current.colors.workingLineLow = "bright-black";
			current.colors.workingLineMid = "cyan";
			current.colors.workingLineHigh = "bold green";
			const generated = buildWorkingLineFrames(
				current.components.workingLine,
				current.colors,
				theme(),
				"Ready",
			);
			expect(generated.textOrigin).toBe(0);
			expect(generated.textWidth).toBe(
				workingLineSpinnerWidth(spinner) + 1 + visibleWidth(generated.row),
			);
			expect(generated.frames.some((frame) => frame.startsWith("\x1b[90m"))).toBe(true);
			expect(generated.frames.some((frame) => frame.startsWith("\x1b[1;32m"))).toBe(true);
		},
	);

	it("keeps Static rendering identical when spinner-color participation changes", () => {
		const current = config();
		current.components.workingLine.spinner = "pulse";
		current.components.workingLine.textAnimation = "disabled";
		const fixed = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Ready",
		);
		current.components.workingLine.animateSpinnerColor = true;
		const ignored = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Ready",
		);
		expect(ignored.frames).toEqual(fixed.frames);
		expect(ignored.frameStates).toEqual(fixed.frameStates);
	});

	it.each([30, 100, 180, 1000] as const)(
		"keeps the canonical configured %s ms cadence for Pulse",
		(intervalMs) => {
			const current = config();
			current.components.workingLine.spinner = "pulse";
			current.components.workingLine.spinnerIntervalMs = intervalMs;
			const owned = buildWorkingLineFrames(
				{ ...current.components.workingLine, messages: { custom: true, values: [] } },
				current.colors,
				theme(),
				"Ready",
			);
			expect(owned.intervalMs).toBeGreaterThanOrEqual(30);
			expect(owned.scheduler.effectiveSpinnerIntervalMs).toBeCloseTo(intervalMs, 8);
		},
	);

	it.each([
		["classic", 160, 30],
		["kitt", 40, 30],
		["disabled", 6, 100],
	] as const)("generates deterministic %s full-row frames", (textAnimation, count, intervalMs) => {
		const current = config();
		current.components.workingLine.textAnimation = textAnimation;
		const result = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Working…",
		);
		expect(result.frames).toHaveLength(count);
		expect(result.intervalMs).toBe(intervalMs);
		expect(result.frames.every((frame) => frame.endsWith("\x1b[0m"))).toBe(true);
		expect(new Set(strippedFrames(result.frames))).toEqual(
			new Set(["· Working…", "✦ Working…", "✧ Working…", "✶ Working…"]),
		);
		expect(result.frames.some((frame) => frame.includes("\x1b[1m"))).toBe(
			textAnimation !== "disabled",
		);
	});

	it.each([
		[100, 60],
		[60, 40],
		[160, 100],
	] as const)("schedules exact independent %s/%s ms cadences", (spinnerMs, textMs) => {
		const current = config();
		current.components.workingLine.spinnerIntervalMs = spinnerMs;
		current.components.workingLine.textIntervalMs = textMs;
		const generated = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Working…",
		);
		expect(generated.scheduler).toMatchObject({
			effectiveSpinnerIntervalMs: spinnerMs,
			effectiveTextIntervalMs: textMs,
			exact: true,
			spinnerSeamless: true,
			textSeamless: true,
		});
		expect(generated.intervalMs).toBe(Math.max(30, gcdForTest(spinnerMs, textMs)));
	});

	it("regenerates repeated worst-case streaming rows within a bounded budget", () => {
		const current = config();
		const component = current.components.workingLine;
		component.spinner = "star-bloom";
		component.spinnerIntervalMs = 997;
		component.textIntervalMs = 900;
		component.textAnimation = "classic";
		component.animateSpinnerColor = false;
		const started = performance.now();
		let generatedFrames = 0;
		for (let output = 1; output <= 20; output++) {
			const generated = buildWorkingLineFrames(
				component,
				current.colors,
				theme(),
				"m".repeat(MAX_WORKING_LINE_MESSAGE_CELLS),
				{
					tool: "t".repeat(18),
					elapsedMs: 99_999_999,
					thought: { durationMs: 9_999_999, active: true },
					tokens: { input: 999_999_999, output, outputApproximate: true },
				},
			);
			generatedFrames += generated.frames.length;
			expect(generated.frames.length).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAMES);
			expect(generated.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
				MAX_WORKING_LINE_FRAME_CODE_UNITS,
			);
		}
		expect(generatedFrames).toBe(19_940);
		expect(performance.now() - started).toBeLessThan(10_000);
	});

	it("permits one Classic text reset per bounded fallback array cycle", () => {
		const current = config();
		current.components.workingLine.spinner = "star-bloom";
		current.components.workingLine.textAnimation = "classic";
		current.components.workingLine.spinnerIntervalMs = 997;
		current.components.workingLine.textIntervalMs = 900;
		current.components.workingLine.animateSpinnerColor = false;
		const started = performance.now();
		const generated = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"1234567",
		);
		expect(generated.frames).toHaveLength(997);
		expect(generated.frames.length).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAMES);
		expect(generated.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
			MAX_WORKING_LINE_FRAME_CODE_UNITS,
		);
		expect(generated.scheduler).toMatchObject({
			quantumMs: 30,
			effectiveSpinnerIntervalMs: 997,
			exact: false,
			spinnerSeamless: true,
			textSeamless: false,
			spinnerAdvances: 30,
			textAdvances: 33,
		});
		expect(generated.textWidth).toBe(7);
		const textCycle = 15;
		expect(new Set(generated.frameStates.map(({ textTick }) => textTick)).size).toBe(textCycle);
		expect(generated.scheduler.textAdvances % textCycle).toBe(3);
		expect(generated.scheduler.effectiveTextIntervalMs).toBeCloseTo(29910 / 33, 8);
		expect(performance.now() - started).toBeLessThan(2000);
	});

	it.each([
		["braille", 10],
		["star-bloom", 6],
		["pinwheel", 4],
		["claude-inspired", 6],
		["pulse", 5],
	] as const)("uses configured cadence with the %s static frames", (spinner, frameCount) => {
		const current = config();
		current.components.workingLine.spinner = spinner;
		current.components.workingLine.spinnerIntervalMs = 160;
		current.components.workingLine.textAnimation = "disabled";
		const result = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Ready",
		);
		expect(result.intervalMs).toBe(160);
		expect(result.frames).toHaveLength(frameCount);
	});

	it.each([
		[
			"classic",
			{ braille: 170, "star-bloom": 510, pinwheel: 340, "claude-inspired": 510, pulse: 85 },
		],
		[
			"kitt",
			{ braille: 790, "star-bloom": 474, pinwheel: 316, "claude-inspired": 474, pulse: 790 },
		],
	] as const)(
		"keeps every maximum-width %s spinner animated within hard caps",
		(animation, _counts) => {
			const current = config();
			current.components.workingLine.messages.custom = true;
			current.components.workingLine.textAnimation = animation;
			const runtime = {
				tool: "y".repeat(18),
				elapsedMs: 3_600_000,
				tokens: { input: 12, output: 2 },
			};
			for (const spinner of Object.keys(WORKING_LINE_SPINNERS) as Array<
				keyof typeof WORKING_LINE_SPINNERS
			>) {
				current.components.workingLine.spinner = spinner;
				const generated = buildWorkingLineFrames(
					current.components.workingLine,
					current.colors,
					theme(),
					"x".repeat(MAX_WORKING_LINE_MESSAGE_CELLS),
					runtime,
				);
				expect(visibleWidth(stripTerminalSequences(generated.frames[0] ?? ""))).toBe(
					MAX_WORKING_LINE_FRAME_CELLS,
				);
				expect(generated.frames.length).toBeGreaterThan(
					WORKING_LINE_SPINNERS[spinner].frames.length,
				);
				expect(generated.textAnimation).toBe(animation);
				expect(generated.frames.length).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAMES);
				expect(generated.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
					MAX_WORKING_LINE_FRAME_CODE_UNITS,
				);
			}
		},
	);

	it.each([
		["classic", 170],
		["kitt", 790],
	] as const)(
		"keeps maximum-code-unit Braille %s rows grapheme-complete and under the memory cap",
		(animation, _count) => {
			const combiningMessage = `x${"x".repeat(41)}y${"\u0338".repeat(213)}`;
			const zwjMessage = `${"x".repeat(41)}${"👩‍".repeat(71)}💻`;
			for (const message of [combiningMessage, zwjMessage]) {
				expect(message).toHaveLength(MAX_WORKING_LINE_NORMALIZED_CODE_UNITS);
				expect(visibleWidth(message)).toBe(MAX_WORKING_LINE_MESSAGE_CELLS);
				expect(normalizeWorkingLineMessage(`${message}z`)).toBe(message);

				const current = config();
				current.components.workingLine.spinner = "braille";
				current.components.workingLine.messages.custom = true;
				current.components.workingLine.textAnimation = animation;
				current.components.workingLine.colorSource = "terminal";
				const maximumStyle = "underline fg:#ffffff bg:#ffffff";
				current.colors.workingLineLow = maximumStyle;
				current.colors.workingLineMid = maximumStyle;
				current.colors.workingLineHigh = maximumStyle;
				const generated = buildWorkingLineFrames(
					current.components.workingLine,
					current.colors,
					theme(),
					`${message}z`,
					{
						tool: "y".repeat(18),
						elapsedMs: 3_600_000,
						tokens: { input: 1, output: 2 },
					},
				);
				expect(generated.message).toBe(message);
				expect(generated.frames.length).toBeGreaterThan(
					WORKING_LINE_SPINNERS.braille.frames.length,
				);
				expect(generated.textAnimation).toBe(animation);
				expect(visibleWidth(stripTerminalSequences(generated.frames[0] ?? ""))).toBe(
					MAX_WORKING_LINE_FRAME_CELLS,
				);
				expect(generated.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
					MAX_WORKING_LINE_FRAME_CODE_UNITS,
				);
				for (const frame of strippedFrames(generated.frames))
					expect(frame.slice(2)).toBe(generated.row);
			}
		},
	);

	it.each(["classic", "kitt"] as const)(
		"deduplicates adversarial repeated palette tokens without disabling %s animation",
		(animation) => {
			const current = config();
			current.components.workingLine.spinner = "braille";
			current.components.workingLine.messages.custom = true;
			current.components.workingLine.textAnimation = animation;
			current.components.workingLine.colorSource = "terminal";
			current.colors.workingLineLow = "dim ".repeat(1000);
			current.colors.workingLineMid = "cyan ".repeat(1000);
			current.colors.workingLineHigh = "bold ".repeat(1000);
			const generated = buildWorkingLineFrames(
				current.components.workingLine,
				current.colors,
				theme(),
				"x".repeat(MAX_WORKING_LINE_MESSAGE_CELLS),
				{ tool: "y".repeat(18), elapsedMs: 3_600_000, tokens: { input: 1, output: 2 } },
			);
			expect(generated.textAnimation).toBe(animation);
			expect(generated.frames.length).toBeGreaterThan(WORKING_LINE_SPINNERS.braille.frames.length);
			expect(generated.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
				MAX_WORKING_LINE_FRAME_CODE_UNITS,
			);
			expect(generated.frames.some((frame) => frame.includes("\x1b[1m"))).toBe(true);
		},
	);

	it("bounds and canonicalizes Working-line-only palette specs", () => {
		expect(normalizeWorkingLineStyleSpec("bold ".repeat(1000))).toBe("bold");
		expect(normalizeWorkingLineStyleSpec("DIMMED dim fg:202 FG:202 bold bold")).toBe(
			"dim fg:202 bold",
		);
		expect(normalizeWorkingLineStyleSpec("bold italic underline red")).toBe(
			"bold italic underline red",
		);
		expect(normalizeWorkingLineStyleSpec("bold italic underline red dim")).toBeUndefined();
		expect(MAX_WORKING_LINE_STYLE_TOKENS).toBe(4);
		expect(MAX_WORKING_LINE_STYLE_CODE_UNITS).toBe(48);
	});

	it.each([
		["no modifier", [], "\x1b[38;5;202m"],
		["one modifier", ["bold"], "\x1b[38;5;202m\x1b[1m"],
		["two modifiers", ["bold", "italic"], "\x1b[38;5;202m\x1b[3m\x1b[1m"],
		["three modifiers", ["bold", "italic", "underline"], "\x1b[38;5;202m\x1b[4m\x1b[3m\x1b[1m"],
	] as const)("persists theme high style with %s", (_label, modifiers, expected) => {
		const current = config();
		current.components.workingLine.colorSource = "theme";
		current.colors.workingLineHigh = [...modifiers, "accent"].join(" ");
		const separateTheme = {
			fg: (_color: string, text: string) => `\x1b[38;5;202m${text}\x1b[0m`,
			bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
			italic: (text: string) => `\x1b[3m${text}\x1b[0m`,
			underline: (text: string) => `\x1b[4m${text}\x1b[0m`,
		};
		expect(
			snapshotWorkingLineHighStyle(separateTheme, current.components.workingLine, current.colors),
		).toBe(expected);
	});

	it.each([
		["named", "bold italic underline cyan", "\x1b[1;3;4;36m"],
		["256-color", "bold italic underline fg:202", "\x1b[1;3;4;38;5;202m"],
		["truecolor", "bold italic underline #bf5700", "\x1b[1;3;4;38;2;191;87;0m"],
	] as const)("persists combined terminal %s high style", (_label, style, expected) => {
		const current = config();
		current.components.workingLine.colorSource = "terminal";
		current.colors.workingLineHigh = style;
		expect(
			snapshotWorkingLineHighStyle(theme(), current.components.workingLine, current.colors),
		).toBe(expected);
	});

	it("reverses full-row KITT motion without duplicating the wording endpoint", () => {
		const current = config();
		current.components.workingLine.textAnimation = "kitt";
		const { frames } = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"abcdefgh",
		);
		const brightHead = (frame: string) => frame.match(/\x1b\[96m\x1b\[1m([a-h])/)?.[1];
		const movingHeads = frames
			.map(brightHead)
			.filter((value): value is string => value !== undefined)
			.filter((value, index, values) => index === 0 || value !== values[index - 1]);
		expect(movingHeads.slice(0, 9)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "g"]);
	});

	it.each(["你好世界", "e\u0301lan", "👩‍💻 works", "👨‍👩‍👧‍👦 family"])(
		"keeps graphemes and visible text stable for %s",
		(message) => {
			const current = config();
			const result = buildWorkingLineFrames(
				current.components.workingLine,
				current.colors,
				theme(),
				message,
			);
			const stripped = strippedFrames(result.frames);
			const expectedWidth = visibleWidth(
				`${WORKING_LINE_SPINNERS["star-bloom"].frames[0]} ${result.message}`,
			);
			for (const frame of stripped) {
				expect(frame.slice(2)).toBe(result.message);
				expect(visibleWidth(frame)).toBe(expectedWidth);
			}
		},
	);

	it.each(["界", "😀"])("gives every occupied KITT head cell the high tier for %s", (message) => {
		const current = config();
		current.components.workingLine.textAnimation = "kitt";
		const result = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			`${message}a`,
		);
		expect(result.frames.some((frame) => frame.includes(`\x1b[96m\x1b[1m${message}`))).toBe(true);
		const expectedWidth = visibleWidth(`· ${result.message}`);
		for (const frame of strippedFrames(result.frames)) {
			expect(frame.slice(2)).toBe(result.message);
			expect(visibleWidth(frame)).toBe(expectedWidth);
		}
	});

	it.each(["star-bloom", "pulse"] as const)(
		"fits the complete maximum %s row through Pi's real Loader without a wrapped blank row",
		(spinner) => {
			const current = config();
			current.components.workingLine.spinner = spinner;
			current.components.workingLine.textAnimation = "disabled";
			current.components.workingLine.messages.custom = true;
			const generated = buildWorkingLineFrames(
				current.components.workingLine,
				current.colors,
				theme(),
				"x".repeat(MAX_WORKING_LINE_MESSAGE_CELLS),
				{
					tool: "y".repeat(18),
					elapsedMs: 3_600_000,
					tokens: { input: 12, output: 2 },
				},
			);
			const [frame] = generated.frames;
			expect(visibleWidth(stripTerminalSequences(frame))).toBe(MAX_WORKING_LINE_FRAME_CELLS);
			const loader = new Loader(
				{ requestRender() {} } as never,
				(text) => text,
				(text) => text,
				"",
				{ frames: [frame], intervalMs: generated.intervalMs },
			);
			try {
				const rendered = loader.render(MAX_WORKING_LINE_ROW_CELLS);
				expect(rendered).toHaveLength(2);
				expect(stripTerminalSequences(rendered[1] ?? "")).toBe(
					` ${stripTerminalSequences(frame)}  `,
				);
				expect(visibleWidth(rendered[1] ?? "")).toBe(MAX_WORKING_LINE_ROW_CELLS);
			} finally {
				loader.stop();
			}
		},
	);

	it("compensates for the real Loader resetting every installed indicator to frame zero", () => {
		vi.useFakeTimers();
		const loader = new Loader(
			{ requestRender() {} } as never,
			(text) => text,
			(text) => text,
			"",
			{ frames: ["zero", "one", "two"], intervalMs: 30 },
		);
		try {
			vi.advanceTimersByTime(60);
			expect(stripTerminalSequences(loader.render(20)[1] ?? "")).toContain("two");
			loader.setIndicator({ frames: ["sampled-two", "next"], intervalMs: 30 });
			expect(stripTerminalSequences(loader.render(20)[1] ?? "")).toContain("sampled-two");
		} finally {
			loader.stop();
			vi.useRealTimers();
		}
	});

	it("honors independent working-line palette overrides", () => {
		const current = config();
		current.components.workingLine.colorSource = "terminal";
		current.components.workingLine.textAnimation = "disabled";
		current.colors.workingLineMid = "bold red";
		current.colors.workingLineHigh = "bold green";
		const [frame] = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			theme(),
			"Ready",
		).frames;
		expect(frame).not.toContain("\x1b[1;32m");
		expect(frame).toContain("\x1b[1;31m· Ready");
	});

	it.each(["classic", "kitt"] as const)(
		"moves %s color through the complete composed row and preserves phase offsets",
		(animation) => {
			const current = config();
			current.components.workingLine.messages.custom = true;
			current.components.workingLine.textAnimation = animation;
			const runtime = { tool: "read", elapsedMs: 62_000, tokens: { input: 12, output: 3 } };
			const generated = buildWorkingLineFrames(
				current.components.workingLine,
				current.colors,
				theme(),
				"Ready",
				runtime,
			);
			expect(new Set(strippedFrames(generated.frames))).toEqual(
				new Set([
					"· Ready · read · 1m02s · ↑12 ↓3",
					"✦ Ready · read · 1m02s · ↑12 ↓3",
					"✧ Ready · read · 1m02s · ↑12 ↓3",
					"✶ Ready · read · 1m02s · ↑12 ↓3",
				]),
			);
			expect(
				generated.frames.some((frame) =>
					[...frame.matchAll(/\x1b\[96m\x1b\[1m([^\x1b]*)/g)].some((match) =>
						match[1]?.includes("↓"),
					),
				),
			).toBe(true);
			const offset = buildWorkingLineFrames(
				current.components.workingLine,
				current.colors,
				theme(),
				"Ready",
				runtime,
				7,
				7,
			);
			expect(offset.frameStates[0]).toEqual({ spinnerTick: 7, textTick: 7 });
		},
	);

	it("keeps preview mode and configured segment presence stable", () => {
		const current = config();
		current.components.workingLine.messages = { custom: true, values: ["Configured"] };
		current.components.workingLine.segments = {
			tool: true,
			elapsed: false,
			thought: false,
			tokens: true,
		};
		const generated = buildWorkingLinePreviewFrames(
			current.components.workingLine,
			current.colors,
			theme(),
		);
		for (const frame of strippedFrames(generated.frames)) {
			expect(frame).toMatch(/^[·✦✧✶] Configured · read · ↑1.2k ↓56$/);
			expect(frame).not.toContain("1m02s");
		}
		current.components.workingLine.messages.custom = false;
		const fallback = strippedFrames(
			buildWorkingLinePreviewFrames(current.components.workingLine, current.colors, theme()).frames,
		);
		expect(fallback.every((frame) => frame.includes(" Working… · read · ↑1.2k ↓56"))).toBe(true);
	});
});

describe("working-line phase mapping", () => {
	it.each([
		["classic", 5],
		["kitt", 15],
	] as const)(
		"preserves %s position and direction across spinner-color domain changes",
		(animation, tick) => {
			const included = remapWorkingLineTextTick(animation, 10, tick, animation, 12, 2, 0);
			const restored = remapWorkingLineTextTick(animation, 12, included, animation, 10, 0, 2);
			expect(restored).toBe(tick);
		},
	);
});

describe("working-line message normalization and selection", () => {
	it("strips terminal/control/bidi data, normalizes whitespace, and truncates safely", () => {
		const unsafe =
			"\x1b[31m  hello\x1b[0m\tworld\n\x1b]8;;https://bad.test\x07link\x1b]8;;\x07\u202E  ";
		expect(normalizeWorkingLineMessage(unsafe)).toBe("hello world link");
		expect(normalizeWorkingLineMessage(`${"界".repeat(30)}👩‍💻`)).toBe(
			"界".repeat(Math.floor(MAX_WORKING_LINE_MESSAGE_CELLS / 2)),
		);
		expect(visibleWidth(normalizeWorkingLineMessage("a".repeat(100)))).toBe(
			MAX_WORKING_LINE_MESSAGE_CELLS,
		);
	});

	it("removes C1 sequences and embedded invisible controls while preserving grapheme joiners", () => {
		const unsafe =
			"\u009b31mRed\u009b0m \u009d2;title\u0007Visible \u0090secret\u009c Done\u200b\u206a\u206f";
		expect(normalizeWorkingLineMessage(unsafe)).toBe("Red Visible Done");
		expect(normalizeWorkingLineMessage("\u200b\u206a\u206f\u034f")).toBe("");
		expect(normalizeWorkingLineMessage("pay\u034fpal word\u2060joiner bidi\u200emark")).toBe(
			"paypal wordjoiner bidimark",
		);
		expect(normalizeWorkingLineMessage("👩‍💻 ❤️ 👨‍👩‍👧‍👦 क्‍ष")).toBe("👩‍💻 ❤️ 👨‍👩‍👧‍👦 क्‍ष");
	});

	it("bounds raw normalization and invalid-entry examination before output caps", () => {
		expect(
			normalizeWorkingLineMessage(
				`${"\u200b".repeat(MAX_WORKING_LINE_RAW_CODE_UNITS)}Visible beyond the raw cap`,
			),
		).toBe("");
		expect(normalizeWorkingLineMessage("x".repeat(1_000_000))).toBe(
			"x".repeat(MAX_WORKING_LINE_MESSAGE_CELLS),
		);
		expect(
			normalizeWorkingLineMessage(`${"\u200b".repeat(MAX_WORKING_LINE_RAW_CODE_UNITS - 1)}👩‍💻`),
		).toBe("");
		const combiningGrapheme = `x${"\u0338".repeat(20)}`;
		const combiningOutput = normalizeWorkingLineMessage(combiningGrapheme.repeat(43));
		expect(combiningOutput).toBe(
			combiningGrapheme.repeat(
				Math.floor(MAX_WORKING_LINE_NORMALIZED_CODE_UNITS / combiningGrapheme.length),
			),
		);
		expect(combiningOutput.length).toBeLessThanOrEqual(MAX_WORKING_LINE_NORMALIZED_CODE_UNITS);
		const oversizedZwjGrapheme = `${"👩‍".repeat(100)}💻`;
		expect(normalizeWorkingLineMessage(oversizedZwjGrapheme)).toBe("");
		const fallback = buildWorkingLineFrames(
			config().components.workingLine,
			config().colors,
			theme(),
			oversizedZwjGrapheme,
		);
		expect(fallback.message).toBe("Working…");
		expect(fallback.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
			MAX_WORKING_LINE_FRAME_CODE_UNITS,
		);
		const values = [
			...Array.from({ length: 31 }, (_, index) => `valid-${index}`),
			...Array.from({ length: MAX_WORKING_LINE_ENTRIES_EXAMINED - 32 }, () => "\u200b"),
			"last-valid",
			"not-examined",
		];
		const normalized = normalizeWorkingLineMessages(values);
		expect(normalized).toHaveLength(32);
		expect(normalized.at(-1)).toBe("last-valid");
		expect(normalized).not.toContain("not-examined");
	});

	it("deduplicates normalized values, discards empties, and caps the pool", () => {
		const values = [
			" A ",
			"A",
			"\x1b[31mA\x1b[0m",
			"\n",
			...Array.from({ length: 60 }, (_, index) => `m${index}`),
		];
		const normalized = normalizeWorkingLineMessages(values);
		expect(normalized[0]).toBe("A");
		expect(normalized).toHaveLength(48);
		expect(new Set(normalized).size).toBe(48);
	});

	it("supports custom toggle, fallback, and uniform endpoint-safe selection", () => {
		const current = config().components.workingLine;
		expect(BUILT_IN_WORKING_LINE_MESSAGES).toHaveLength(16);
		expect(effectiveWorkingLineMessages(current)).toEqual(BUILT_IN_WORKING_LINE_MESSAGES);
		current.messages = { custom: true, values: ["Custom"] };
		expect(effectiveWorkingLineMessages(current)).toEqual(["Custom"]);
		current.messages.values = [];
		expect(effectiveWorkingLineMessages(current)).toEqual(["Working…"]);
		current.messages.values = ["\u200b\u206a"];
		expect(effectiveWorkingLineMessages(current)).toEqual(["Working…"]);
		current.messages.custom = false;
		const random = vi.fn(() => 0.9);
		expect(selectWorkingLineMessage(current, random)).toBe("Working…");
		expect(random).not.toHaveBeenCalled();
		current.messages.custom = true;
		current.messages.values = ["A", "B"];
		expect(selectWorkingLineMessage(current, () => 0)).toBe("A");
		expect(selectWorkingLineMessage(current, () => 0.999999)).toBe("B");
		expect(selectWorkingLineMessage(current, () => 1)).toBe("B");
	});
});

describe("working-line row composition", () => {
	it("sanitizes tools and applies bounded wording, tool, elapsed, token priority", () => {
		const component = config().components.workingLine;
		component.messages.custom = true;
		expect(
			normalizeWorkingLineToolLabel(
				"\x1b[31mread\x1b[0m \x1b]2;title\x07safe \u009b32mtool\u009b0m \u009dsecret\u009c",
			),
		).toBe("read safe tool");
		expect(normalizeWorkingLineToolLabel("a".repeat(30))).toBe(`${"a".repeat(17)}…`);
		const all = composeWorkingLineRow(component, "Working…", {
			tool: "read",
			elapsedMs: 62_000,
			tokens: { input: 1234, output: 56 },
		});
		expect(all.row).toBe("Working… · read · 1m02s · ↑1.2k ↓56");
		expect(2 + visibleWidth(all.row) + 1 + 2).toBeLessThanOrEqual(MAX_WORKING_LINE_ROW_CELLS);
		component.spinner = "pulse";
		const constrained = composeWorkingLineRow(component, "x".repeat(43), {
			tool: "parallel-tool-label-too-long",
			elapsedMs: 360_000_000,
			tokens: { input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER },
		});
		expect(constrained.row).toBe(`${"x".repeat(43)} · ↑9007199255M ↓9007199255M`);
		expect(workingLineSpinnerWidth("pulse") + 1 + visibleWidth(constrained.row)).toBeLessThan(
			MAX_WORKING_LINE_FRAME_CELLS,
		);
		expect(constrained.row).not.toContain("parallel");
	});

	it("reserves exact Tokens, then allocates Message, Elapsed, and truncated Tool within 80 cells", () => {
		const component = config().components.workingLine;
		const composed = composeWorkingLineRow(component, "x".repeat(43), {
			tool: "parallel-tool-label",
			elapsedMs: 62_000,
			tokens: { input: 12, output: 3 },
		});
		expect(composed.row).toBe(`${"x".repeat(43)} · parallel-to… · 1m02s · ↑12 ↓3`);
		expect(composed.row.indexOf("1m02s")).toBeLessThan(composed.row.indexOf("↑12 ↓3"));
		expect(composed.row).not.toContain("parallel-tool-label");
		expect(workingLineSpinnerWidth(component.spinner) + 1 + visibleWidth(composed.row) + 3).toBe(
			MAX_WORKING_LINE_ROW_CELLS,
		);
	});

	it("honors independent segment toggles for custom and fallback wording", () => {
		const component = config().components.workingLine;
		const runtime = { tool: "read", elapsedMs: 1_000, tokens: { input: 12, output: 3 } };
		component.segments = { tool: false, elapsed: true, thought: false, tokens: false };
		expect(composeWorkingLineRow(component, "Configured", runtime).row).toBe("Configured · 1s");
		component.messages.custom = false;
		expect(composeWorkingLineRow(component, "Working…", runtime).row).toBe("Working… · 1s");
	});
});

describe("working-line thought segment", () => {
	it("formats active zero and floors active/inactive duration consistently", () => {
		expect(formatWorkingLineThought({ durationMs: 0, active: true })).toBe("thinking 0s");
		expect(formatWorkingLineThought({ durationMs: 10_999, active: true })).toBe("thinking 10s");
		expect(formatWorkingLineThought({ durationMs: 10_999, active: false })).toBe("thought for 10s");
		expect(formatWorkingLineThought({ durationMs: 0, active: false })).toBeUndefined();
	});

	it("uses Thought before Elapsed and Tool allocation while preserving token text and row cap", () => {
		const component = config().components.workingLine;
		component.spinner = "pulse";
		const composed = composeWorkingLineRow(component, "Ready", {
			tool: "parallel-tool-label",
			elapsedMs: Number.MAX_SAFE_INTEGER,
			thought: { durationMs: 10_000, active: true },
			tokens: { input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER },
		});
		expect(composed.row).toContain("↑9007199255M ↓9007199255M");
		expect(composed.row).toContain("thinking");
		expect(composed.row).not.toContain("parallel-tool-label");
		expect(
			workingLineSpinnerWidth(component.spinner) + 1 + visibleWidth(composed.row) + 3,
		).toBeLessThanOrEqual(MAX_WORKING_LINE_ROW_CELLS);
	});
});

describe("working-line runtime ownership", () => {
	function runtime(
		enabled: boolean,
		random = () => 0.75,
		now: () => number = Date.now,
		getTheme: () => Theme = theme,
	) {
		const current = config();
		current.components.workingLine.enabled = enabled;
		current.components.workingLine.messages = { custom: true, values: ["A", "B"] };
		const clock = new AgentDurationClock();
		const calls: Array<[string, unknown?]> = [];
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				setWorkingMessage(value?: string) {
					calls.push(["message", value]);
				},
				setWorkingIndicator(value?: unknown) {
					calls.push(["indicator", value]);
				},
			},
		};
		return {
			current,
			clock,
			calls,
			ctx,
			controller: new WorkingLineController(() => current, getTheme, clock, random, now),
		};
	}

	it("makes exactly zero working-row calls while disabled", () => {
		const harness = runtime(false);
		harness.controller.startSession(harness.ctx);
		harness.clock.start();
		harness.controller.startAgent(harness.ctx);
		harness.controller.startTurn(harness.ctx);
		harness.controller.finishAgent(harness.ctx);
		harness.controller.dispose(harness.ctx);
		harness.clock.reset();
		expect(harness.calls).toEqual([]);
	});

	it("fails open when either public capability is missing", () => {
		const harness = runtime(true);
		for (const ui of [{ setWorkingMessage: vi.fn() }, { setWorkingIndicator: vi.fn() }]) {
			const result = harness.controller.startSession({ hasUI: true, mode: "tui", ui });
			expect(result.applied).toBe(false);
			expect(Object.values(ui).every((fn) => !fn.mock.calls.length)).toBe(true);
		}
		expect(harness.calls).toEqual([]);
	});

	it("owns and styles the full fallback row with no RNG when custom messages are off", () => {
		const random = vi.fn(() => 0.75);
		const harness = runtime(true, random);
		harness.current.components.workingLine.spinner = "pulse";
		harness.current.components.workingLine.messages.custom = false;
		harness.controller.startSession(harness.ctx);
		harness.clock.start();
		harness.controller.startAgent(harness.ctx);
		harness.controller.startTurn(harness.ctx);
		harness.controller.updateTokens({ input: 12, output: 3 }, harness.ctx);
		expect(random).not.toHaveBeenCalled();
		expect(harness.calls[0]).toEqual(["message", ""]);
		const indicator = harness.calls.at(-1)?.[1] as { frames: string[] } | undefined;
		expect(
			strippedFrames(indicator?.frames ?? []).every((frame) =>
				frame.includes("Working… · 0s · ↑12 ↓3"),
			),
		).toBe(true);
		harness.controller.dispose(harness.ctx);
		expect(harness.calls.slice(-2)).toEqual([
			["indicator", undefined],
			["message", undefined],
		]);
	});

	it("does not rewrite Static frames for text-speed or spinner-color participation changes", () => {
		const harness = runtime(true);
		harness.current.components.workingLine.textAnimation = "disabled";
		harness.controller.startSession(harness.ctx);
		harness.calls.length = 0;
		harness.current.components.workingLine.textIntervalMs = 40;
		harness.current.components.workingLine.animateSpinnerColor = true;
		expect(harness.controller.reconcile(harness.ctx).applied).toBe(true);
		expect(harness.calls).toEqual([]);
	});

	it("selects exactly once per turn_start and keeps that message through tool activity", () => {
		const random = vi.fn(() => 0.75);
		const harness = runtime(true, random);
		harness.controller.startSession(harness.ctx);
		expect(harness.controller.currentMessage()).toBe("A");
		harness.clock.start();
		harness.controller.startAgent(harness.ctx);
		expect(random).not.toHaveBeenCalled();
		harness.controller.startTurn(harness.ctx);
		expect(random).toHaveBeenCalledTimes(1);
		expect(harness.controller.currentMessage()).toBe("B");
		harness.controller.startTool("one", "read", harness.ctx);
		harness.controller.finishTool("one", harness.ctx);
		harness.current.components.workingLine.spinner = "pinwheel";
		harness.controller.reconcile(harness.ctx);
		expect(random).toHaveBeenCalledTimes(1);
		expect(harness.controller.currentMessage()).toBe("B");
		harness.controller.startTurn(harness.ctx);
		expect(random).toHaveBeenCalledTimes(2);
	});

	it("reconciles live message edits deterministically without rerolling the turn", () => {
		const random = vi.fn(() => 0.75);
		const harness = runtime(true, random);
		harness.controller.startSession(harness.ctx);
		harness.controller.startTurn(harness.ctx);
		expect(harness.controller.currentMessage()).toBe("B");
		harness.current.components.workingLine.messages.values = ["B", "C"];
		harness.controller.reconcile(harness.ctx);
		expect(harness.controller.currentMessage()).toBe("B");
		harness.current.components.workingLine.messages.values = ["C"];
		harness.controller.reconcile(harness.ctx);
		expect(harness.controller.currentMessage()).toBe("C");
		harness.current.components.workingLine.messages.custom = false;
		harness.controller.reconcile(harness.ctx);
		expect(harness.controller.currentMessage()).toBe("Working…");
		harness.current.components.workingLine.messages = { custom: true, values: ["A", "B"] };
		harness.controller.reconcile(harness.ctx);
		expect(harness.controller.currentMessage()).toBe("A");
		expect(random).toHaveBeenCalledTimes(1);
	});

	it("reinstalls full rows only for visible token/tool changes and tracks parallel tools", () => {
		const harness = runtime(true);
		harness.current.components.workingLine.segments.elapsed = false;
		harness.controller.startSession(harness.ctx);
		expect(harness.calls[0]).toEqual(["message", ""]);
		harness.clock.start();
		harness.controller.startAgent(harness.ctx);
		harness.controller.startTurn(harness.ctx);
		harness.calls.length = 0;
		const usage = { role: "assistant" as const, usage: { input: 120, output: 7 } };
		harness.controller.updateTokens(usage.usage, harness.ctx);
		harness.controller.updateTokens(usage.usage, harness.ctx);
		harness.controller.startTool("a", "read", harness.ctx);
		harness.controller.startTool("b", "bash", harness.ctx);
		harness.controller.startTool("b", "bash", harness.ctx);
		const text = () =>
			stripTerminalSequences(
				(harness.calls.at(-1)?.[1] as { frames?: string[] } | undefined)?.frames?.[0] ?? "",
			);
		expect(text()).toMatch(/B · bash · ↑120 ↓7/);
		harness.controller.finishTool("b", harness.ctx);
		expect(text()).toMatch(/B · read · ↑120 ↓7/);
		harness.controller.finishTool("a", harness.ctx);
		expect(text()).toMatch(/B · ↑120 ↓7/);
		expect(harness.calls.every(([name]) => name === "indicator")).toBe(true);
		expect(harness.calls).toHaveLength(5);
		harness.controller.finishTool("missing", harness.ctx);
		expect(harness.calls).toHaveLength(5);
		harness.controller.startTurn(harness.ctx);
		expect(text()).toMatch(/↑120 ↓7/);
		expect(harness.calls).toHaveLength(5);
		harness.current.components.workingLine.segments.tool = false;
		harness.controller.reconcile(harness.ctx);
		expect(harness.calls).toHaveLength(5);
		harness.controller.dispose(harness.ctx);
		harness.clock.reset();
	});

	it.each([
		["classic", "star-bloom", 900],
		["classic", "pulse", 900],
		["kitt", "star-bloom", 1400],
		["kitt", "pulse", 1400],
	] as const)(
		"preserves %s spatial position, KITT direction, and %s phase across token/tool widths",
		(animation, spinner, firstChangeAt) => {
			let now = 0;
			const harness = runtime(
				true,
				() => 0,
				() => now,
			);
			harness.current.components.workingLine.messages.values = ["Stable"];
			harness.current.components.workingLine.spinner = spinner;
			harness.current.components.workingLine.textAnimation = animation;
			harness.current.components.workingLine.segments.elapsed = false;
			harness.controller.startSession(harness.ctx);
			harness.controller.startAgent(harness.ctx);
			harness.controller.startTurn(harness.ctx);
			const activation = harness.calls.at(-1)?.[1] as {
				frames: string[];
				intervalMs: number;
			};

			now = firstChangeAt;
			const activationIndex =
				Math.floor(firstChangeAt / activation.intervalMs) % activation.frames.length;
			harness.controller.updateTokens({ input: 12, output: 3 }, harness.ctx);
			const withTokens = harness.calls.at(-1)?.[1] as { frames: string[] };
			const beforeSignature = phaseSignature(activation.frames[activationIndex] ?? "");
			const afterSignature = phaseSignature(withTokens.frames[0] ?? "");
			expect(afterSignature[0]).toBe(beforeSignature[0]);
			if (beforeSignature[1] !== undefined) expect(afterSignature[1]).toBe(beforeSignature[1]);

			now += 100;
			harness.controller.startTool("one", "read", harness.ctx);
			const withTool = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };
			const carriedRemainder = firstChangeAt % withTool.intervalMs;
			const withTokensIndex = Math.floor((carriedRemainder + 100) / withTool.intervalMs);
			expect(phaseSignature(withTool.frames[0] ?? "")).toEqual(
				phaseSignature(withTokens.frames[withTokensIndex] ?? ""),
			);
		},
	);

	it.each([
		[
			"speed",
			(current: PolishedTuiConfig): void => {
				current.components.workingLine.spinnerIntervalMs = 60;
			},
		],
		[
			"preset",
			(current: PolishedTuiConfig): void => {
				current.components.workingLine.spinner = "pulse";
			},
		],
		[
			"width",
			(current: PolishedTuiConfig): void => {
				current.components.workingLine.messages.values = ["A much wider stable message"];
			},
		],
		[
			"animation",
			(current: PolishedTuiConfig): void => {
				current.components.workingLine.textAnimation = "kitt";
			},
		],
	] as const)("carries fractional phase across a live %s change", (_kind, change) => {
		let now = 0;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["Stable"];
		harness.current.components.workingLine.spinnerIntervalMs = 100;
		harness.current.components.workingLine.textIntervalMs = 100;
		harness.current.components.workingLine.segments.elapsed = false;
		harness.controller.startSession(harness.ctx);
		const before = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };

		now = 250;
		change(harness.current);
		harness.controller.reconcile(harness.ctx);
		const after = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };
		const sampledIndex = Math.floor(250 / before.intervalMs);
		if (_kind !== "preset") {
			expect(phaseSignature(after.frames[0] ?? "")[0]).toBe(
				phaseSignature(before.frames[sampledIndex] ?? "")[0],
			);
		} else {
			expect(after.frames[0]).toBeDefined();
		}

		now = 250 + Math.ceil(after.intervalMs / 2);
		harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
		const carried = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseSignature(carried.frames[0] ?? "")[0]).toBe(
			phaseSignature(after.frames[1] ?? "")[0],
		);
	});

	it("advances logical frame zero on rapid rebuilds without relying on Loader ticks", () => {
		let now = 0;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["Stable"];
		harness.current.components.workingLine.spinner = "pulse";
		harness.current.components.workingLine.spinnerIntervalMs = 100;
		harness.current.components.workingLine.textAnimation = "disabled";
		harness.current.components.workingLine.segments.elapsed = false;
		harness.controller.startSession(harness.ctx);
		const original = harness.calls.at(-1)?.[1] as { frames: string[] };
		for (now = 20; now <= 200; now += 20) {
			harness.controller.updateTokens({ input: now, output: 1 }, harness.ctx);
			const rebuilt = harness.calls.at(-1)?.[1] as { frames: string[] };
			const expectedIndex = Math.floor(now / 100);
			expect(phaseSignature(rebuilt.frames[0] ?? "")[0]).toBe(
				phaseSignature(original.frames[expectedIndex] ?? "")[0],
			);
		}
	});

	it("matches uninterrupted exact independent spinner/text schedules during rapid rebuilds", () => {
		let now = 0;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["Stable"];
		harness.current.components.workingLine.spinnerIntervalMs = 100;
		harness.current.components.workingLine.textIntervalMs = 60;
		harness.current.components.workingLine.textAnimation = "classic";
		harness.current.components.workingLine.segments.elapsed = false;
		harness.controller.startSession(harness.ctx);
		const uninterrupted = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };
		expect(uninterrupted.intervalMs).toBe(30);
		for (now = 30; now <= 600; now += 30) {
			harness.controller.updateTokens({ input: now, output: 1 }, harness.ctx);
			const rebuilt = harness.calls.at(-1)?.[1] as { frames: string[] };
			expect(phaseSignature(rebuilt.frames[0] ?? "")).toEqual(
				phaseSignature(uninterrupted.frames[(now / 30) % uninterrupted.frames.length] ?? ""),
			);
		}
	});

	it("preserves bounded fallback phase across its frame-array wrap", () => {
		let now = 0;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["Stable"];
		harness.current.components.workingLine.spinnerIntervalMs = 997;
		harness.current.components.workingLine.textIntervalMs = 900;
		harness.current.components.workingLine.textAnimation = "classic";
		harness.current.components.workingLine.segments.elapsed = false;
		harness.controller.startSession(harness.ctx);
		const uninterrupted = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };
		const wrapAt = uninterrupted.frames.length * uninterrupted.intervalMs;
		now = wrapAt + uninterrupted.intervalMs;
		harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
		const rebuilt = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseSignature(rebuilt.frames[0] ?? "")).toEqual(
			phaseSignature(uninterrupted.frames[1] ?? ""),
		);
	});

	it("bounds visible Loader reset jitter below one replacement interval", () => {
		vi.useFakeTimers();
		try {
			let now = 0;
			let loader: Loader | undefined;
			const harness = runtime(
				true,
				() => 0,
				() => now,
			);
			harness.current.components.workingLine.messages.values = ["Stable"];
			harness.current.components.workingLine.spinnerIntervalMs = 100;
			harness.current.components.workingLine.textAnimation = "disabled";
			harness.current.components.workingLine.segments.elapsed = false;
			const recordIndicator = harness.ctx.ui.setWorkingIndicator.bind(harness.ctx.ui);
			harness.ctx.ui.setWorkingIndicator = (value?: unknown) => {
				recordIndicator(value);
				if (value !== undefined) {
					const indicator = value as { frames: string[]; intervalMs: number };
					if (loader) loader.setIndicator(indicator);
					else
						loader = new Loader(
							{ requestRender() {} } as never,
							(text) => text,
							(text) => text,
							"",
							indicator,
						);
				}
			};
			harness.controller.startSession(harness.ctx);
			now = 90;
			harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
			const replacement = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };
			const logicalBoundaryAt = 100;
			const visibleReplacementBoundaryAt = now + replacement.intervalMs;
			expect(visibleReplacementBoundaryAt - logicalBoundaryAt).toBeLessThan(replacement.intervalMs);
			expect(stripTerminalSequences(loader?.render(40)[1] ?? "")).toContain(
				stripTerminalSequences(replacement.frames[0] ?? ""),
			);
			now = 100;
			harness.controller.updateTokens({ input: 2, output: 1 }, harness.ctx);
			const corrected = harness.calls.at(-1)?.[1] as { frames: string[] };
			expect(phaseSignature(corrected.frames[0] ?? "")[0]).toBe(
				phaseSignature(replacement.frames[1] ?? "")[0],
			);
			loader?.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rebases frame zero at successful agent_start installation time", () => {
		let now = 0;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["Stable"];
		harness.current.components.workingLine.spinner = "pulse";
		harness.current.components.workingLine.spinnerIntervalMs = 100;
		harness.current.components.workingLine.textAnimation = "disabled";
		harness.current.components.workingLine.segments.elapsed = false;
		harness.controller.startSession(harness.ctx);
		now = 250;
		harness.controller.startAgent(harness.ctx);
		const rebased = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseSignature(rebased.frames[0] ?? "")[0]).toBe("⠀⠶⠀");
		now = 349;
		harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
		const beforeTick = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseSignature(beforeTick.frames[0] ?? "")[0]).toBe("⠀⠶⠀");
		now = 350;
		harness.controller.updateTokens({ input: 2, output: 1 }, harness.ctx);
		const afterTick = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseSignature(afterTick.frames[0] ?? "")[0]).toBe("⠰⣿⠆");
	});

	it.each(["classic", "kitt"] as const)(
		"keeps %s on its logical epoch when frame generation and setters advance the clock",
		(animation) => {
			let now = 0;
			let generationPending = true;
			const delayedTheme = theme();
			const baseFg = delayedTheme.fg.bind(delayedTheme);
			delayedTheme.fg = (color, text) => {
				if (generationPending) {
					now += 250;
					generationPending = false;
				}
				return baseFg(color, text);
			};
			const harness = runtime(
				true,
				() => 0,
				() => now,
				() => delayedTheme,
			);
			const control = runtime(
				true,
				() => 0,
				() => now,
			);
			for (const current of [harness.current, control.current]) {
				current.components.workingLine.messages.values = ["Stable"];
				current.components.workingLine.spinner = "pulse";
				current.components.workingLine.spinnerIntervalMs = 100;
				current.components.workingLine.textIntervalMs = 100;
				current.components.workingLine.textAnimation = animation;
				current.components.workingLine.segments.elapsed = false;
			}
			control.controller.startSession(control.ctx);
			const recordIndicator = harness.ctx.ui.setWorkingIndicator.bind(harness.ctx.ui);
			harness.ctx.ui.setWorkingIndicator = (value?: unknown) => {
				recordIndicator(value);
				now += 40;
				generationPending = true;
			};
			harness.controller.startSession(harness.ctx);
			expect(now).toBe(290);

			now += 560;
			control.controller.updateTokens({ input: 12, output: 3 }, control.ctx);
			harness.controller.updateTokens({ input: 12, output: 3 }, harness.ctx);
			const expected = control.calls.at(-1)?.[1] as { frames: string[] };
			const rebuilt = harness.calls.at(-1)?.[1] as { frames: string[] };
			expect(phaseMotionSignature(rebuilt.frames, 0)).toEqual(
				phaseMotionSignature(expected.frames, 0),
			);

			now += 560;
			control.controller.startTool("one", "read", control.ctx);
			harness.controller.startTool("one", "read", harness.ctx);
			const expectedAgain = control.calls.at(-1)?.[1] as { frames: string[] };
			const rebuiltAgain = harness.calls.at(-1)?.[1] as { frames: string[] };
			expect(phaseMotionSignature(rebuiltAgain.frames, 0)).toEqual(
				phaseMotionSignature(expectedAgain.frames, 0),
			);
		},
	);

	it("recovers the last successful epoch when reconcile mutates then throws and retries on tokens", () => {
		let now = 0;
		let failSetter = false;
		let setterCalls = 0;
		let failedAtMs = 0;
		let indicatorSurface: unknown;
		let failedAttempt: { frames: string[]; intervalMs: number } | undefined;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		const control = runtime(
			true,
			() => 0,
			() => now,
		);
		const recordIndicator = harness.ctx.ui.setWorkingIndicator.bind(harness.ctx.ui);
		harness.ctx.ui.setWorkingIndicator = (value?: unknown) => {
			setterCalls += 1;
			indicatorSurface = value;
			if (failSetter) {
				failSetter = false;
				failedAtMs = now;
				failedAttempt = value as { frames: string[]; intervalMs: number };
				now += 4500;
				throw new Error("setter unavailable");
			}
			recordIndicator(value);
		};
		for (const current of [harness.current, control.current]) {
			current.components.workingLine.messages.values = ["Stable"];
			current.components.workingLine.spinner = "pulse";
			current.components.workingLine.spinnerIntervalMs = 100;
			current.components.workingLine.textIntervalMs = 100;
			current.components.workingLine.textAnimation = "classic";
			current.components.workingLine.segments.elapsed = false;
		}
		harness.controller.startSession(harness.ctx);
		control.controller.startSession(control.ctx);
		const lastSuccessfulSurface = indicatorSurface;

		now = 100;
		for (const current of [harness.current, control.current]) {
			current.components.workingLine.spinnerIntervalMs = 200;
			current.components.workingLine.textIntervalMs = 200;
			current.components.workingLine.textAnimation = "kitt";
		}
		failSetter = true;
		expect(harness.controller.reconcile(harness.ctx).applied).toBe(false);
		expect(indicatorSurface).toBe(lastSuccessfulSurface);
		failSetter = false;
		control.controller.updateTokens({ input: 12, output: 3 }, control.ctx);
		harness.controller.updateTokens({ input: 12, output: 3 }, harness.ctx);

		expect(setterCalls).toBe(4);
		expect(harness.calls.filter(([name]) => name === "indicator")).toHaveLength(3);
		const retried = harness.calls.at(-1)?.[1] as { frames: string[] };
		const expected = control.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseMotionSignature(retried.frames, 0)).toEqual(
			phaseMotionSignature(expected.frames, 0),
		);
		const failed = failedAttempt as unknown as { frames: string[]; intervalMs: number };
		const incorrectlyPublishedIndex =
			Math.floor((now - failedAtMs) / failed.intervalMs) % failed.frames.length;
		expect(phaseMotionSignature(retried.frames, 0)).not.toEqual(
			phaseMotionSignature(failed.frames, incorrectlyPublishedIndex),
		);
	});

	it("preserves the elapsed subscription while recovering a transient reinstall failure", () => {
		vi.useFakeTimers();
		try {
			const harness = runtime(true, () => 0);
			harness.current.components.workingLine.messages.values = ["Stable"];
			let failSetter = false;
			const setter = harness.ctx.ui.setWorkingIndicator.bind(harness.ctx.ui);
			harness.ctx.ui.setWorkingIndicator = (value?: unknown) => {
				if (failSetter) {
					failSetter = false;
					throw new Error("mutated before throwing");
				}
				setter(value);
			};
			harness.controller.startSession(harness.ctx);
			harness.clock.start();
			harness.controller.startAgent(harness.ctx);
			expect(vi.getTimerCount()).toBe(1);
			harness.current.components.workingLine.spinnerIntervalMs += 1;
			failSetter = true;
			expect(harness.controller.reconcile(harness.ctx).applied).toBe(false);
			expect(vi.getTimerCount()).toBe(1);
			harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
			expect(vi.getTimerCount()).toBe(1);
			harness.controller.dispose(harness.ctx);
			harness.clock.reset();
		} finally {
			vi.useRealTimers();
		}
	});

	it("restores the previous message and phase when startTurn installation fails", () => {
		let now = 0;
		let failSetter = false;
		let indicatorSurface: unknown;
		const harness = runtime(
			true,
			() => 0.75,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["A", "B"];
		harness.current.components.workingLine.spinner = "pulse";
		harness.current.components.workingLine.spinnerIntervalMs = 100;
		harness.current.components.workingLine.textAnimation = "disabled";
		harness.current.components.workingLine.segments.elapsed = false;
		const setter = harness.ctx.ui.setWorkingIndicator.bind(harness.ctx.ui);
		harness.ctx.ui.setWorkingIndicator = (value?: unknown) => {
			indicatorSurface = value;
			if (failSetter) {
				failSetter = false;
				now = 250;
				throw new Error("mutated before throwing");
			}
			setter(value);
		};
		harness.controller.startSession(harness.ctx);
		const lastSuccessfulSurface = indicatorSurface;
		expect(harness.controller.currentMessage()).toBe("A");

		failSetter = true;
		expect(harness.controller.startTurn(harness.ctx).applied).toBe(false);
		expect(indicatorSurface).toBe(lastSuccessfulSurface);
		expect(harness.controller.currentMessage()).toBe("A");
		harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
		const retried = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(stripTerminalSequences(retried.frames[0] ?? "")).toContain("A");
		expect(phaseSignature(retried.frames[0] ?? "")[0]).toBe("⢾⣉⡷");
	});

	it("does not publish a failed forced agent-start rebase epoch", () => {
		let now = 0;
		let failSetter = false;
		let indicatorSurface: unknown;
		const harness = runtime(
			true,
			() => 0,
			() => now,
		);
		harness.current.components.workingLine.messages.values = ["Stable"];
		harness.current.components.workingLine.spinner = "pulse";
		harness.current.components.workingLine.spinnerIntervalMs = 100;
		harness.current.components.workingLine.textAnimation = "disabled";
		harness.current.components.workingLine.segments.elapsed = false;
		const setter = harness.ctx.ui.setWorkingIndicator.bind(harness.ctx.ui);
		harness.ctx.ui.setWorkingIndicator = (value?: unknown) => {
			indicatorSurface = value;
			if (failSetter) {
				failSetter = false;
				now = 350;
				throw new Error("mutated before throwing");
			}
			setter(value);
		};
		harness.controller.startSession(harness.ctx);
		const lastSuccessfulSurface = indicatorSurface;
		now = 250;
		failSetter = true;
		harness.controller.startAgent(harness.ctx);
		expect(indicatorSurface).toBe(lastSuccessfulSurface);
		harness.controller.updateTokens({ input: 1, output: 1 }, harness.ctx);
		const retried = harness.calls.at(-1)?.[1] as { frames: string[] };
		expect(phaseSignature(retried.frames[0] ?? "")[0]).toBe("⣏⠀⣹");
	});

	it("releases ownership when recovery also throws and waits for a clean reinstall", () => {
		const current = config();
		current.components.workingLine.enabled = true;
		current.components.workingLine.messages.values = ["Stable"];
		current.components.workingLine.segments.elapsed = false;
		const calls: string[] = [];
		let indicatorSurface: unknown;
		let messageSurface: string | undefined;
		let failureSets = 0;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				setWorkingMessage(value?: string) {
					messageSurface = value;
					calls.push(value === undefined ? "message-reset" : "message-set");
				},
				setWorkingIndicator(value?: unknown) {
					indicatorSurface = value;
					calls.push(value === undefined ? "indicator-reset" : "indicator-set");
					if (value !== undefined && failureSets > 0) {
						failureSets -= 1;
						throw new Error("setter mutated before throwing");
					}
				},
			},
		};
		const controller = new WorkingLineController(() => current, theme);
		expect(controller.startSession(ctx).applied).toBe(true);
		current.components.workingLine.spinnerIntervalMs += 1;
		failureSets = 2;
		expect(controller.reconcile(ctx).applied).toBe(false);
		expect(calls.slice(-4)).toEqual([
			"indicator-set",
			"indicator-set",
			"indicator-reset",
			"message-reset",
		]);
		expect(indicatorSurface).toBeUndefined();
		expect(messageSurface).toBeUndefined();
		const afterRelease = calls.length;
		controller.updateTokens({ input: 1, output: 1 }, ctx);
		expect(calls).toHaveLength(afterRelease);
		expect(controller.reconcile(ctx).applied).toBe(true);
		expect(calls.slice(-2)).toEqual(["message-set", "indicator-set"]);
	});

	it.each(["classic", "kitt"] as const)(
		"preserves %s phase across the 9s to 10s elapsed-width change",
		(animation) => {
			vi.useFakeTimers();
			vi.setSystemTime(0);
			try {
				const harness = runtime(true, () => 0);
				harness.current.components.workingLine.messages.values = ["Stable"];
				harness.current.components.workingLine.textAnimation = animation;
				harness.controller.startSession(harness.ctx);
				harness.clock.start(0);
				harness.controller.startAgent(harness.ctx);
				harness.controller.startTurn(harness.ctx);
				vi.advanceTimersByTime(9000);
				const atNine = harness.calls.at(-1)?.[1] as { frames: string[]; intervalMs: number };
				expect(stripTerminalSequences(atNine.frames[0] ?? "")).toContain(" · 9s");
				vi.advanceTimersByTime(1000);
				const atTen = harness.calls.at(-1)?.[1] as { frames: string[] };
				expect(stripTerminalSequences(atTen.frames[0] ?? "")).toContain(" · 10s");
				const sampledIndex = Math.floor(1000 / atNine.intervalMs) % atNine.frames.length;
				expect(phaseSignature(atTen.frames[0] ?? "")).toEqual(
					phaseSignature(atNine.frames[sampledIndex] ?? ""),
				);
				harness.controller.dispose(harness.ctx);
				harness.clock.reset();
			} finally {
				vi.useRealTimers();
			}
		},
	);

	it("writes elapsed only when its one-second label changes", () => {
		vi.useFakeTimers();
		const harness = runtime(true);
		harness.controller.startSession(harness.ctx);
		harness.clock.start();
		harness.controller.startAgent(harness.ctx);
		harness.controller.startTurn(harness.ctx);
		harness.calls.length = 0;
		vi.advanceTimersByTime(999);
		expect(harness.calls).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0]?.[0]).toBe("indicator");
		expect(
			stripTerminalSequences(
				(harness.calls[0]?.[1] as { frames?: string[] } | undefined)?.frames?.[0] ?? "",
			),
		).toContain(" · 1s");
		vi.advanceTimersByTime(1000);
		expect(harness.calls).toHaveLength(2);
		expect(
			stripTerminalSequences(
				(harness.calls.at(-1)?.[1] as { frames?: string[] } | undefined)?.frames?.[0] ?? "",
			),
		).toContain(" · 2s");
		harness.controller.dispose(harness.ctx);
		harness.clock.reset();
		vi.useRealTimers();
	});

	it("keeps one shared clock subscription through frequent eligible updates", () => {
		vi.useFakeTimers();
		try {
			const harness = runtime(true);
			harness.controller.startSession(harness.ctx);
			harness.clock.start();
			harness.controller.startAgent(harness.ctx);
			harness.controller.startTurn(harness.ctx);
			for (let elapsed = 0; elapsed < 1_000; elapsed += 100) {
				harness.controller.updateMetrics(
					{ input: elapsed, output: 1 },
					{ durationMs: elapsed, active: true },
					harness.ctx,
				);
				harness.controller.reconcile(harness.ctx);
				vi.advanceTimersByTime(100);
				expect(vi.getTimerCount()).toBe(1);
			}
			const latest = stripTerminalSequences(
				(harness.calls.at(-1)?.[1] as { frames?: string[] } | undefined)?.frames?.[0] ?? "",
			);
			expect(latest).toContain(" · 1s");
			harness.controller.dispose(harness.ctx);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("transitions thought-only clock subscription strictly with active thought", () => {
		vi.useFakeTimers();
		try {
			const harness = runtime(true);
			harness.current.components.workingLine.segments.elapsed = false;
			harness.current.components.workingLine.segments.thought = true;
			harness.controller.startSession(harness.ctx);
			harness.clock.start();
			harness.controller.startAgent(harness.ctx);
			expect(vi.getTimerCount()).toBe(0);
			harness.controller.updateMetrics(undefined, { durationMs: 0, active: true }, harness.ctx);
			expect(vi.getTimerCount()).toBe(1);
			harness.controller.updateMetrics(undefined, { durationMs: 1, active: true }, harness.ctx);
			harness.controller.startTurn(harness.ctx);
			expect(vi.getTimerCount()).toBe(1);
			harness.controller.updateMetrics(undefined, { durationMs: 2, active: false }, harness.ctx);
			expect(vi.getTimerCount()).toBe(0);
			harness.current.components.workingLine.enabled = false;
			harness.controller.reconcile(harness.ctx);
			expect(vi.getTimerCount()).toBe(0);
			harness.current.components.workingLine.enabled = true;
			harness.controller.reconcile(harness.ctx);
			harness.controller.updateMetrics(undefined, { durationMs: 3, active: true }, harness.ctx);
			expect(vi.getTimerCount()).toBe(1);
			harness.controller.finishAgent(harness.ctx);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("releases a first message setter that mutates then throws before a clean retry", () => {
		const current = config();
		current.components.workingLine.enabled = true;
		const calls: string[] = [];
		let failFirstMessageSet = true;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				setWorkingMessage(value?: string) {
					calls.push(value === undefined ? "message-reset" : "message-set");
					if (value === "" && failFirstMessageSet) {
						failFirstMessageSet = false;
						throw new Error("message setter mutated before throwing");
					}
				},
				setWorkingIndicator(value?: unknown) {
					calls.push(value === undefined ? "indicator-reset" : "indicator-set");
				},
			},
		};
		const controller = new WorkingLineController(() => current, theme);

		expect(controller.startSession(ctx).applied).toBe(false);
		expect(calls).toEqual(["message-set", "message-reset"]);
		controller.dispose(ctx);
		expect(calls).toEqual(["message-set", "message-reset"]);

		expect(controller.startSession(ctx).applied).toBe(true);
		expect(calls.slice(-2)).toEqual(["message-set", "indicator-set"]);
		const afterRetry = calls.length;
		expect(controller.reconcile(ctx).applied).toBe(true);
		expect(calls).toHaveLength(afterRetry);
		controller.dispose(ctx);
		controller.dispose(ctx);
		expect(calls.slice(-2)).toEqual(["indicator-reset", "message-reset"]);
	});

	it("releases a first indicator setter that mutates then throws before a phase-clean retry", () => {
		const current = config();
		current.components.workingLine.enabled = true;
		current.components.workingLine.messages.values = ["Stable"];
		current.components.workingLine.segments.elapsed = false;
		let now = 0;
		let failFirstIndicatorSet = true;
		const calls: string[] = [];
		let failedFrames: string[] | undefined;
		let retriedFrames: string[] | undefined;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				setWorkingMessage(value?: string) {
					calls.push(value === undefined ? "message-reset" : "message-set");
				},
				setWorkingIndicator(value?: unknown) {
					calls.push(value === undefined ? "indicator-reset" : "indicator-set");
					if (value !== undefined && failFirstIndicatorSet) {
						failedFrames = (value as { frames: string[] }).frames;
						failFirstIndicatorSet = false;
						now = 500;
						throw new Error("indicator setter mutated before throwing");
					}
					if (value !== undefined) retriedFrames = (value as { frames: string[] }).frames;
				},
			},
		};
		const controller = new WorkingLineController(
			() => current,
			theme,
			new AgentDurationClock(),
			() => 0,
			() => now,
		);

		expect(controller.startSession(ctx).applied).toBe(false);
		expect(calls).toEqual(["message-set", "indicator-set", "indicator-reset", "message-reset"]);
		controller.dispose(ctx);
		expect(calls).toHaveLength(4);

		expect(controller.startSession(ctx).applied).toBe(true);
		expect(calls.slice(-2)).toEqual(["message-set", "indicator-set"]);
		expect(retriedFrames).toEqual(failedFrames);
		const afterRetry = calls.length;
		expect(controller.reconcile(ctx).applied).toBe(true);
		expect(calls).toHaveLength(afterRetry);
		controller.dispose(ctx);
		controller.dispose(ctx);
		expect(calls.slice(-2)).toEqual(["indicator-reset", "message-reset"]);
	});

	it("contains cleanup API failures and stays idempotent", () => {
		const current = config();
		current.components.workingLine.enabled = true;
		current.components.workingLine.messages.custom = true;
		const calls: string[] = [];
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				setWorkingMessage(value?: string) {
					calls.push(value === undefined ? "message-reset" : "message-set");
				},
				setWorkingIndicator(value?: unknown) {
					calls.push(value === undefined ? "indicator-reset" : "indicator-set");
					if (value === undefined) throw new Error("reset unavailable");
				},
			},
		};
		const controller = new WorkingLineController(() => current, theme);
		expect(controller.startSession(ctx).applied).toBe(true);
		expect(() => controller.dispose(ctx)).not.toThrow();
		expect(() => controller.dispose(ctx)).not.toThrow();
		expect(calls).toEqual(["message-set", "indicator-set", "indicator-reset", "message-reset"]);
	});

	it("live-enables and resets indicator then message exactly once on disable or cleanup", () => {
		const harness = runtime(false);
		harness.controller.startTurn(harness.ctx);
		harness.current.components.workingLine.enabled = true;
		expect(harness.controller.reconcile(harness.ctx).applied).toBe(true);
		expect(harness.controller.currentMessage()).toBe("B");
		harness.current.components.workingLine.enabled = false;
		harness.controller.reconcile(harness.ctx);
		harness.controller.dispose(harness.ctx);
		harness.controller.dispose(harness.ctx);
		expect(
			harness.calls.map(([name, value]) => [name, value === undefined ? "reset" : "set"]),
		).toEqual([
			["message", "set"],
			["indicator", "set"],
			["indicator", "reset"],
			["message", "reset"],
		]);
	});
});
