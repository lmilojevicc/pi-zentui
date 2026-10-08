import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import type { ThemeLike } from "../extensions/zentui/style";
import {
	buildWorkingLineFrames,
	MAX_WORKING_LINE_FRAME_CELLS,
	MAX_WORKING_LINE_FRAME_CODE_UNITS,
	MAX_WORKING_LINE_FRAMES,
	WorkingLineController,
} from "../extensions/zentui/working-line";

const theme: ThemeLike = {
	fg(color, text) {
		const codes: Record<string, number> = { dim: 90, muted: 36, accent: 96 };
		return `\x1b[${codes[color] ?? 37}m${text}\x1b[0m`;
	},
	bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

/** Active SGR prefixes at a plain-text code-unit offset, including nested theme styles. */
function styleAt(frame: string, offset: number): string {
	let plainOffset = 0;
	let style = "";
	for (const part of frame.split(/(\x1b\[[\d;]*m)/)) {
		if (part.startsWith("\x1b[")) {
			style = part === "\x1b[0m" ? "" : style + part;
		} else {
			if (plainOffset + part.length > offset) return style;
			plainOffset += part.length;
		}
	}
	throw new Error("Offset is outside frame");
}

const variants = ["classic", "kitt"].flatMap((textAnimation) =>
	[false, true].flatMap((animateSpinnerColor) =>
		["theme", "terminal"].flatMap((colorSource) =>
			[false, true].flatMap((capped) =>
				["Go", "界 👩🏽‍💻 é "].map((message) => ({
					textAnimation: textAnimation as "classic" | "kitt",
					animateSpinnerColor,
					colorSource: colorSource as "theme" | "terminal",
					capped,
					message,
				})),
			),
		),
	),
);

function checkAnimatedRows(
	build: typeof buildWorkingLineFrames,
	variant: (typeof variants)[number],
) {
	const current = structuredClone(defaultConfig);
	const component = current.components.workingLine;
	Object.assign(component, {
		textAnimation: variant.textAnimation,
		animateSpinnerColor: variant.animateSpinnerColor,
		colorSource: variant.colorSource,
		spinner: "pulse",
		spinnerIntervalMs: variant.capped ? 997 : 60,
		textIntervalMs: 60,
		segments: { tool: true, elapsed: true, thought: true, tokens: true, tokenRate: true },
		colors:
			variant.colorSource === "theme"
				? { low: "dim", mid: "muted", high: "bold accent" }
				: { low: "bright-black", mid: "cyan", high: "bold green" },
	});
	for (const tokenRate of ["48 tok/s", "~48 tok/s", "— tok/s"]) {
		for (const override of [undefined, "fg:202", "", "invalid"] as const) {
			component.colors = { ...component.colors, tokenRate: override };
			const runtime = {
				tool: "read",
				elapsedMs: 1000,
				thought: { durationMs: 1000, active: true },
				tokens: { input: 12, output: 3 },
				extensions: ["queue 2"],
			};
			const generated = build(component, current.colors, theme, variant.message, {
				...runtime,
				tokenRate,
			});
			// The same visible row, but TPS supplied as ordinary extension text, is the oracle.
			const normal = build(component, current.colors, theme, variant.message, {
				...runtime,
				extensions: [tokenRate, ...runtime.extensions],
			});
			expect(generated.row).toBe(normal.row);
			expect(generated).toEqual(normal);
			expect(generated.scheduler.exact).toBe(!variant.capped);
			expect(generated.frames.length).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAMES);
			expect(generated.frames.reduce((sum, frame) => sum + frame.length, 0)).toBeLessThanOrEqual(
				MAX_WORKING_LINE_FRAME_CODE_UNITS,
			);
			for (const frame of generated.frames) {
				expect(visibleWidth(frame)).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAME_CELLS);
				expect(frame).not.toContain("\x1b[38;5;202m");
			}
			// The wave must reach every built-in segment, all TPS forms, and extension content.
			const high = variant.colorSource === "theme" ? "\x1b[96m\x1b[1m" : "\x1b[1;32m";
			for (const label of [
				generated.row.split(" · ")[0] ?? "",
				"read",
				"1s",
				"thinking",
				"↑12",
				"↓3",
				tokenRate,
				"queue 2",
			]) {
				const styles = new Set(
					generated.frames.map((frame) => {
						const offset = stripVTControlCharacters(frame).indexOf(label);
						expect(offset).toBeGreaterThanOrEqual(0);
						return styleAt(frame, offset);
					}),
				);
				expect(styles.has(high)).toBe(true);
				expect(styles.size).toBeGreaterThan(1);
			}
		}
	}
}

describe("working-line whole-row metric animation", () => {
	it.each(variants)("animates TPS like normal text: %j", (variant) => {
		checkAnimatedRows(buildWorkingLineFrames, variant);
	});

	it.each(["classic", "kitt"] as const)(
		"renders retained TPS during active tools in the shared %s animation and stops at idle",
		(textAnimation) => {
			vi.useFakeTimers();
			const current = structuredClone(defaultConfig);
			current.components.workingLine.colorSource = "theme";
			const component = current.components.workingLine;
			Object.assign(component, {
				enabled: true,
				placement: "border",
				textAnimation,
				messages: { custom: false, values: [] },
				segments: { tool: true, tokenRate: true },
				colors: { tokenRate: "fg:202" },
			});
			const ui = {
				setWorkingMessage: vi.fn(),
				setWorkingIndicator: vi.fn(),
				setWorkingVisible: vi.fn(),
			};
			const ctx = { ui };
			const controller = new WorkingLineController(
				() => current,
				() => theme,
				undefined,
				undefined,
				() => 0,
				undefined,
				undefined,
				undefined,
				() => true,
			);
			try {
				controller.startSession(ctx);
				controller.startAgent(ctx);
				controller.updateTokenRate("~48 tok/s", ctx);
				controller.startTool("tool", "read", ctx);
				const frames = (
					ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as { frames?: string[] } | undefined
				)?.frames;
				if (!frames) throw new Error("missing Working frames");
				const styles = new Set(
					frames.map((frame) => {
						const plain = stripVTControlCharacters(frame);
						expect(plain).toContain("read");
						expect(plain).toContain("~48 tok/s");
						expect(frame).not.toContain("\x1b[38;5;202m");
						return styleAt(frame, plain.indexOf("~48 tok/s"));
					}),
				);
				expect(styles.size).toBeGreaterThan(1);
				expect(styles.has("\x1b[96m\x1b[1m")).toBe(true);
				expect(controller.currentWorkingLineFrame()).toBeDefined();
				expect(vi.getTimerCount()).toBe(1);
				controller.finishTool("tool", ctx);
				expect(stripVTControlCharacters(controller.currentWorkingLineFrame() ?? "")).toContain(
					"~48 tok/s",
				);
				controller.finishAgent(ctx);
				expect(controller.currentWorkingLineFrame()).toBeUndefined();
				expect(vi.getTimerCount()).toBe(0);
			} finally {
				controller.dispose(ctx);
				vi.useRealTimers();
			}
		},
	);

	it.each(["classic", "kitt"] as const)(
		"reserves atomic Tokens/TPS before fitting other content (%s)",
		(textAnimation) => {
			const current = structuredClone(defaultConfig);
			const component = current.components.workingLine;
			Object.assign(component, {
				textAnimation,
				spinner: "pulse",
				segments: { tool: true, elapsed: true, thought: true, tokens: true, tokenRate: true },
			});
			const generated = buildWorkingLineFrames(component, current.colors, theme, "x".repeat(43), {
				tool: "read",
				elapsedMs: 1000,
				thought: { durationMs: 1000, active: true },
				tokens: { input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER },
				tokenRate: "~123456789 tok/s",
				extensions: ["queue ".repeat(10)],
			});
			expect(generated.row).toContain("↑9007199255M ↓9007199255M · ~123456789 tok/s · queue");
			expect(generated.row).not.toContain("read");
			for (const frame of generated.frames) {
				expect(stripVTControlCharacters(frame)).toContain("~123456789 tok/s");
				expect(visibleWidth(frame)).toBeLessThanOrEqual(MAX_WORKING_LINE_FRAME_CELLS);
			}
		},
	);

	it("uses the same whole-row renderer for TPS without Intl.Segmenter", async () => {
		vi.resetModules();
		const fresh = await import("../extensions/zentui/working-line");
		// biome-ignore lint/complexity/useArrowFunction: Intl.Segmenter is invoked as a constructor.
		const segmenter = vi.spyOn(Intl, "Segmenter").mockImplementation(function () {
			throw new Error("unavailable");
		});
		try {
			for (const variant of variants.filter(({ message }) => message !== "Go")) {
				checkAnimatedRows(fresh.buildWorkingLineFrames, variant);
			}
		} finally {
			segmenter.mockRestore();
			vi.resetModules();
		}
	});

	it.each(["theme", "terminal"] as const)(
		"preserves Static TPS override, empty style and mid inheritance (%s)",
		(colorSource) => {
			const current = structuredClone(defaultConfig);
			const component = current.components.workingLine;
			Object.assign(component, {
				textAnimation: "disabled",
				colorSource,
				segments: { tokenRate: true },
			});
			for (const tokenRate of ["48 tok/s", "~48 tok/s", "— tok/s"]) {
				for (const override of [
					undefined,
					"fg:202",
					"",
					"invalid",
					"red blue green cyan purple",
				] as const) {
					for (const animateSpinnerColor of [false, true]) {
						component.animateSpinnerColor = animateSpinnerColor;
						component.colors = { mid: "purple", tokenRate: override };
						const generated = buildWorkingLineFrames(component, current.colors, theme, "Go", {
							tokenRate,
						});
						for (const frame of generated.frames) {
							const plain = stripVTControlCharacters(frame);
							const rateStyle = styleAt(frame, plain.indexOf(tokenRate));
							expect(rateStyle).toBe(
								override === ""
									? ""
									: override === "fg:202"
										? "\x1b[38;5;202m"
										: styleAt(frame, plain.indexOf("Go")),
							);
						}
					}
				}
			}
		},
	);
});
