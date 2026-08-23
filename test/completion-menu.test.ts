import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	applyOwnedSurfaceBackground,
	isNativeCompletionCountRow,
	omitTrailingNativeCompletionCountRow,
	renderCompletionPalette,
	renderCompletionRows,
	replaceNativeSelectedPrefix,
} from "../extensions/zentui/completion-menu";

function theme(): Theme {
	return {
		bg: (_color: string, text: string) => `\x1b[48;5;234m${text}\x1b[49m`,
		getBgAnsi: () => "\x1b[48;5;234m",
	} as unknown as Theme;
}

function plain(value: string): string {
	return stripVTControlCharacters(value);
}

function terminalWidth(value: string): number {
	return visibleWidth(value.replace(/\u009b([0-?]*[ -/]*[@-~])/g, "\x1b[$1"));
}

describe("completion menu surfaces", () => {
	it("renders a transparent full-width palette shell without a results header or native count row", () => {
		const rows = renderCompletionPalette({
			lines: ["\x1b[38;5;39m→ settings\x1b[0m", "  files", "\x1b[90m  (1/47)  \x1b[0m"],
			width: 40,
			theme: theme(),
			renderSeparator: (text) => `\x1b[90m${text}\x1b[0m`,
			ownedBackground: false,
		});
		expect(rows.map(plain)).toEqual([
			"  settings                              ",
			"  files                                 ",
			"────────────────────────────────────────",
			" ↑↓ Navigate   Enter Use   Esc Close    ",
		]);
		expect(rows.join("\n")).not.toContain("Results");
		expect(rows.join("\n")).not.toContain("\x1b[48;5;234m");
		expect(rows[0]).toContain("  \x1b[38;5;39msettings");
		expect(rows.slice(0, 2).every((row) => visibleWidth(row) === 40)).toBe(true);
	});

	it("preserves native embedded row backgrounds in a transparent palette", () => {
		const rows = renderCompletionPalette({
			lines: ["\x1b[48;5;52m→ warning\x1b[49m"],
			width: 24,
			theme: theme(),
			renderSeparator: (text) => text,
			ownedBackground: false,
		});
		expect(rows[0]).toContain("\x1b[48;5;52m");
		expect(rows.join("\n")).not.toContain("\x1b[48;5;234m");
	});

	it.each([
		[
			"ESC CSI",
			"\x1b[48;5;52m  warning\x1b[49m next\x1b[0m",
			"\x1b[48;5;52m",
			"\x1b[49m\x1b[48;5;234m next",
			"\x1b[0m\x1b[48;5;234m",
		],
		[
			"C1 CSI",
			"\u009b48;5;52m  warning\u009b49m next\u009b0m",
			"\u009b48;5;52m",
			"\u009b49m\x1b[48;5;234m next",
			"\u009b0m\x1b[48;5;234m",
		],
	] as const)(
		"restores owned background after %s native resets while retaining embedded backgrounds",
		(_name, embedded, nativeBackground, restoredDefault, restoredReset) => {
			const [row] = renderCompletionRows({
				lines: [embedded],
				width: 24,
				theme: theme(),
				selectedPrefix: "  ",
				ownedBackground: true,
			});
			expect(row).toContain(nativeBackground);
			expect(row).toContain(restoredDefault);
			expect(row).toContain(restoredReset);
			expect(row).toMatch(/(?:\x1b\[0m|\u009b0m)\x1b\[48;5;234m +\x1b\[49m$/);
			expect(terminalWidth(row ?? "")).toBe(24);
		},
	);

	it.each([
		["ESC SGR", "\x1b[1;38;5;39m→ help\x1b[0m", "  \x1b[1;38;5;39mhelp\x1b[0m"],
		["C1 SGR", "\u009b1;38;5;39m→ help\u009b0m", "  \u009b1;38;5;39mhelp\u009b0m"],
	] as const)(
		"changes a native selected prefix preceded by %s only",
		(_name, selected, expected) => {
			expect(replaceNativeSelectedPrefix(selected, "  ")).toBe(expected);
		},
	);

	it.each([
		["cursor movement", "\x1b[1G→ help"],
		["erase", "\x1b[2K→ help"],
		["C1 erase", "\u009b2K→ help"],
		["mode", "\x1b[?25l→ help"],
		["private m-final CSI", "\x1b[>4;2m→ help"],
		["private C1 m-final CSI", "\u009b>4;2m→ help"],
		["SGR followed by private m-final CSI", "\x1b[1m\x1b[>4;2m→ help"],
		["SGR followed by cursor movement", "\x1b[1m\x1b[1G→ help"],
		["OSC", "\x1b]8;;https://example.com\x07→ help\x1b]8;;\x07"],
	] as const)("leaves a selected-looking row with leading %s unchanged", (_name, line) => {
		expect(replaceNativeSelectedPrefix(line, "  ")).toBe(line);
	});

	it.each([
		["ESC reset plus foreground", "\x1b[0;39m", true],
		["ESC foreground plus background reset", "\x1b[31;49m", true],
		["ESC reset then explicit background", "\x1b[0;41m", false],
		["ESC background then reset", "\x1b[41;49m", true],
		["ESC extended black background", "\x1b[0;48;2;0;0;0m", false],
		["ESC colon extended black background", "\x1b[0;48:2::0:0:0m", false],
		["ESC extended background then reset", "\x1b[48;5;0;49m", true],
		["C1 reset plus foreground", "\u009b0;39m", true],
		["C1 reset then explicit background", "\u009b0;101m", false],
		["C1 background then reset", "\u009b101;49m", true],
	] as const)("respects ordered background semantics for %s", (_name, sequence, restores) => {
		const background = "\x1b[48;5;234m";
		const primary = applyOwnedSurfaceBackground(theme(), `before${sequence}tail   `);
		expect(primary).toContain(sequence);
		expect(primary.includes(`${sequence}${background}tail`)).toBe(restores);
		expect(terminalWidth(primary)).toBe(13);

		const fallbackTheme = {
			...theme(),
			getBgAnsi() {
				throw new Error("unavailable");
			},
		} as unknown as Theme;
		const fallback = applyOwnedSurfaceBackground(fallbackTheme, `before${sequence}tail   `);
		expect(fallback).toContain(sequence);
		expect(fallback.includes(`${sequence}${background}tail`)).toBe(restores);
		expect(terminalWidth(fallback)).toBe(13);
	});

	it.each(["\u009b0m", "\u009bm", "\u009b49m"])(
		"reapplies the theme.bg fallback after C1 reset %j through trailing padding",
		(reset) => {
			const fallbackTheme = {
				...theme(),
				getBgAnsi() {
					throw new Error("unavailable");
				},
			} as unknown as Theme;
			const row = applyOwnedSurfaceBackground(fallbackTheme, `item${reset}█   `);
			expect(row).toContain(`${reset}\x1b[48;5;234m█   \x1b[49m`);
		},
	);

	it.each(["\u009b0m", "\u009bm", "\u009b49m"])(
		"reapplies getBgAnsi background after direct C1 reset %j",
		(reset) => {
			const row = applyOwnedSurfaceBackground(theme(), `item${reset}tail`);
			expect(row).toContain(`${reset}\x1b[48;5;234mtail`);
		},
	);

	it("leaves combined C1 resets and embedded backgrounds authoritative in transparent rows", () => {
		const embedded = "\u009b48;5;52m→ warning\u009b31;49m next\u009b0;39m";
		const [row] = renderCompletionRows({
			lines: [embedded],
			width: 20,
			theme: theme(),
			selectedPrefix: "  ",
			ownedBackground: false,
		});
		expect(row).toContain("\u009b48;5;52m");
		expect(row).toContain("\u009b31;49m next\u009b0;39m");
		expect(row).not.toContain("\x1b[48;5;234m");
		expect(terminalWidth(row ?? "")).toBe(20);
	});

	it("preserves SGR-only selection replacement and fails open for control CSI in a palette", () => {
		const c1Selected = "\u009b1;38;5;39m→ settings\u009b0m";
		const cursorControlled = "\x1b[2K→ unsafe";
		const c1CursorControlled = "\u009b2K→ c1-unsafe";
		const rows = renderCompletionPalette({
			lines: [c1Selected, cursorControlled, c1CursorControlled],
			width: 24,
			theme: theme(),
			renderSeparator: (text) => text,
			ownedBackground: false,
		});
		expect(rows[0]).toContain("  \u009b1;38;5;39msettings\u009b0m");
		expect(rows[1]).toContain(cursorControlled);
		expect(rows[1]).not.toContain(`  ${cursorControlled}`);
		expect(rows[2]).toContain(c1CursorControlled);
		expect(rows[2]).not.toContain(`  ${c1CursorControlled}`);
	});

	it("omits only a trailing standalone native count row", () => {
		expect(isNativeCompletionCountRow(" \x1b[90m(6/47)\x1b[0m ")).toBe(true);
		expect(isNativeCompletionCountRow("(6/47) details")).toBe(false);
		expect(isNativeCompletionCountRow("\x1b]8;;https://example.com\x07(6/47)\x1b]8;;\x07")).toBe(
			false,
		);
		expect(
			omitTrailingNativeCompletionCountRow(["  (1/47)", "  item", "\u009b90m (2/47) \u009b0m"]),
		).toEqual(["  (1/47)", "  item"]);
		expect(omitTrailingNativeCompletionCountRow(["  item", "  (1/47) details"])).toEqual([
			"  item",
			"  (1/47) details",
		]);
	});

	it("keeps Unicode and combining rows width-safe", () => {
		const rows = renderCompletionRows({
			lines: ["→ é\u0301dit 😀 界"],
			width: 9,
			theme: theme(),
			selectedPrefix: "  ",
			ownedBackground: true,
		});
		expect(plain(rows[0] ?? "")).toContain("  é\u0301dit");
		expect(visibleWidth(rows[0] ?? "")).toBe(9);
	});

	it("compacts help and fails safely at narrow widths", () => {
		const compact = renderCompletionPalette({
			lines: ["→ item"],
			width: 18,
			theme: theme(),
			renderSeparator: (text) => text,
			ownedBackground: false,
		});
		expect(compact.map(plain)).toEqual([
			"  item            ",
			"──────────────────",
			" ↑↓   Enter   Esc ",
		]);
		const tiny = renderCompletionPalette({
			lines: ["→ item"],
			width: 2,
			theme: theme(),
			renderSeparator: (text) => text,
			ownedBackground: false,
		});
		expect(tiny.map(plain)).toEqual(["  ", "──"]);
	});

	it("falls back without corruption when theme background APIs fail", () => {
		const unavailable = {
			getBgAnsi() {
				throw new Error("unavailable");
			},
			bg() {
				throw new Error("unavailable");
			},
		} as unknown as Theme;
		expect(applyOwnedSurfaceBackground(unavailable, "safe\x1b[0m text")).toBe("safe\x1b[0m text");
	});
});
