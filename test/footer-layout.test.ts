import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	compactChunkBudget,
	fullFooterFitsAligned,
	packCompactChunks,
	packCompactZones,
	reflowFullFooter,
} from "../extensions/zentui/footer-layout";

const chunk = (text: string, boundary: "space" | "separator" = "space") => ({
	text,
	boundary,
});

describe("responsive footer layout", () => {
	it("models centered-middle placement and its floor bias", () => {
		expect(fullFooterFitsAligned({ left: "LLLLL", middle: "MMMM", right: "" }, 10)).toBe(false);
		expect(fullFooterFitsAligned({ left: "LLLLL", middle: "MMMM", right: "" }, 11)).toBe(true);
		expect(fullFooterFitsAligned({ left: "", middle: "MMMM", right: "RRRRR" }, 10)).toBe(true);
		expect(fullFooterFitsAligned({ left: "LLLL", middle: "MMM", right: "RRRR" }, 13)).toBe(true);
		expect(fullFooterFitsAligned({ left: "LLLL", middle: "MMM", right: "RRRR" }, 12)).toBe(false);
	});

	it("measures ANSI and Nerd Font content by visible terminal cells", () => {
		const zones = { left: "\u001b[31mLL\u001b[0m", middle: "\ue0a0", right: "RR" };
		expect(fullFooterFitsAligned(zones, 7)).toBe(true);
		expect(fullFooterFitsAligned(zones, 6)).toBe(false);
	});

	it("prefers left / middle+right and falls back to left+middle / right", () => {
		expect(reflowFullFooter({ left: "LLLL", middle: "MM", right: "RR" }, 5)).toEqual([
			"LLLL",
			"MM RR",
		]);
		expect(reflowFullFooter({ left: "L", middle: "MMMM", right: "RRRR" }, 6)).toEqual([
			"L MMMM",
			"RRRR",
		]);
		expect(reflowFullFooter({ left: "LLLLLL", middle: "MMMM", right: "RRRR" }, 6)).toBeUndefined();
	});

	it("collapses empty reflow zones without blank rows or stray spaces", () => {
		expect(reflowFullFooter({ left: "L", middle: "", right: "R" }, 2)).toEqual(["L", "R"]);
		expect(reflowFullFooter({ left: "", middle: "M", right: "R" }, 3)).toEqual(["M R"]);
		expect(reflowFullFooter({ left: "L", middle: "M", right: "" }, 3)).toEqual(["L", "M"]);
	});

	it("uses the exact half-row compact budget", () => {
		expect(compactChunkBudget(47)).toBe(23);
		expect(compactChunkBudget(19)).toBe(9);
		expect(compactChunkBudget(17)).toBe(8);
		expect(compactChunkBudget(8)).toBe(8);
		expect(compactChunkBudget(5)).toBe(8);
	});

	it("packs chunks with boundary-aware same-row joins and no divider at breaks", () => {
		expect(packCompactChunks([chunk("one"), chunk("two")], 7, 2, " | ")).toEqual(["one two"]);
		expect(packCompactChunks([chunk("one"), chunk("two", "separator")], 9, 2, " | ")).toEqual([
			"one | two",
		]);
		expect(packCompactChunks([chunk("one"), chunk("two", "separator")], 8, 2, " | ")).toEqual([
			"one",
			"two",
		]);
		expect(
			packCompactChunks([chunk("one"), chunk(""), chunk("  "), chunk("two")], 7, 2, " | "),
		).toEqual(["one two"]);
	});

	it("retains the next surviving chunk's incoming boundary", () => {
		expect(
			packCompactChunks([chunk("A"), chunk("", "separator"), chunk("B", "space")], 5, 2, " | "),
		).toEqual(["A B"]);
		expect(
			packCompactChunks([chunk("A"), chunk("", "space"), chunk("B", "separator")], 5, 2, " | "),
		).toEqual(["A | B"]);
	});

	it("supports every finite line limit and unlimited rows", () => {
		const chunks = [chunk("one"), chunk("two"), chunk("three")];
		expect(packCompactChunks(chunks, 5, 1, " | ")).toEqual(["one…"]);
		expect(packCompactChunks(chunks, 7, 2, " | ")).toEqual(["one two", "three"]);
		expect(packCompactChunks(chunks, 5, 3, " | ")).toEqual(["one", "two", "three"]);
		expect(packCompactChunks(chunks, 5, "unlimited", " | ")).toEqual(["one", "two", "three"]);
	});

	it("marks finite-cap omissions with exactly one ellipsis", () => {
		expect(
			packCompactChunks([chunk("12345"), chunk("later")], 5, 1, " | ").map(
				stripVTControlCharacters,
			),
		).toEqual(["1234…"]);
		expect(
			packCompactChunks([chunk("123456789"), chunk("later")], 5, 1, " | ").map(
				stripVTControlCharacters,
			),
		).toEqual(["1234…"]);
	});

	it("keeps every ANSI and wide-glyph row within width, even below the compact budget", () => {
		const rows = packCompactChunks(
			[chunk("\u001b[31mabcdef\u001b[0m"), chunk("界界界"), chunk("\ue0a0")],
			5,
			3,
			" | ",
		);
		expect(rows.every((row) => visibleWidth(row) <= 5)).toBe(true);
		expect(
			packCompactChunks([chunk("abcdefgh")], 5, 1, " | ").every((row) => visibleWidth(row) <= 5),
		).toBe(true);
	});
});

describe("right-aligned footer zones", () => {
	it("pads only the right-bearing row in both full reflow arrangements", () => {
		expect(reflowFullFooter({ left: "LLLL", middle: "M", right: "R" }, 5, true)).toEqual([
			"LLLL",
			"  M R",
		]);
		expect(reflowFullFooter({ left: "L", middle: "MMMM", right: "RRRR" }, 6, true)).toEqual([
			"L MMMM",
			"  RRRR",
		]);
		expect(reflowFullFooter({ left: "L", middle: "M", right: "" }, 5, true)).toEqual(["L", "M"]);
		expect(reflowFullFooter({ left: "", middle: "", right: "R" }, 5, true)).toEqual(["    R"]);
	});
	it("reserves separate metadata chunks before variable left budgets", () => {
		const rows = packCompactZones(
			[chunk("directory"), chunk("branch")],
			[
				chunk("gpt-6-astra"),
				chunk("OpenAI", "separator"),
				chunk("high", "separator"),
				chunk("telemetry", "separator"),
			],
			18,
			2,
			" | ",
		);
		expect(rows.map(stripVTControlCharacters)).toEqual([
			"direc… gpt-6-astra",
			"br… OpenAI | high…",
		]);
		expect(rows.map(visibleWidth)).toEqual([18, 18]);
	});
	it("follows right template order rather than content names", () => {
		const rows = packCompactZones(
			[chunk("left")],
			[chunk("usage"), chunk("model"), chunk("thinking")],
			6,
			1,
			" | ",
		);
		expect(rows).toEqual(["usage…"]);
	});
	it("preserves empty-right behavior and avoids dangling boundary separators", () => {
		const left = [chunk("one"), chunk("two", "separator")];
		expect(packCompactZones(left, [], 7, 2, " | ")).toEqual(packCompactChunks(left, 7, 2, " | "));
		expect(
			packCompactZones(
				[],
				[chunk("one", "separator"), chunk(""), chunk("two", "separator")],
				5,
				2,
				" | ",
			),
		).toEqual(["  one", "  two"]);
	});
	it.each([1, 2, 3, "unlimited"] as const)(
		"respects %s rows and cell bounds with ANSI, links and wide glyphs",
		(limit) => {
			const link = "\u001b]8;;https://example.test\u0007界界\u001b]8;;\u0007";
			for (let width = 0; width < 32; width++) {
				const rows = packCompactZones(
					[chunk("left…"), chunk(link), chunk("last")],
					[
						chunk("\u001b[31m model\u001b[0m"),
						chunk("provider", "separator"),
						chunk("high", "separator"),
					],
					width,
					limit,
					" | ",
				);
				if (limit !== "unlimited") expect(rows.length).toBeLessThanOrEqual(limit);
				expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
				expect(rows.map(stripVTControlCharacters).join("\n")).not.toContain("……");
			}
		},
	);
});
