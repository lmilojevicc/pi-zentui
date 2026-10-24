import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as bounds from "../extensions/zentui/tool-display/bounds.js";
import { PresentationText } from "../extensions/zentui/tool-display/presentation-text.js";

// PresentationText also clips native rows that overflow very narrow widths.
const nativeRows = (text: Text, width: number) =>
	text
		.render(width)
		.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));

// Older supported Pi hosts do not expose this optional public setter.
const nativeSetPaddingX = (Text.prototype as Text & { setPaddingX?: (paddingX: number) => void })
	.setPaddingX;

afterEach(() => vi.restoreAllMocks());

describe("PresentationText layout cache", () => {
	it("skips safety scans, wrapping and native layout on unchanged paints", () => {
		const scan = vi.spyOn(bounds, "boundedContentLines");
		const wrap = vi.spyOn(bounds, "boundedWrap");
		const render = vi.spyOn(Text.prototype, "render");
		const setText = vi.spyOn(Text.prototype, "setText");
		const text = new PresentationText("stable text");
		const first = text.render(80);
		// Unbounded rows take the single native wrap; the bounded pre-pass is skipped.
		expect(scan).toHaveBeenCalledTimes(1);
		expect(wrap).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(1);
		expect(setText).toHaveBeenCalledTimes(1);
		for (let paint = 0; paint < 100; paint++) expect(text.render(80)).toEqual(first);
		// Negative control: the uncached implementation repeats all four operations
		// 101 times, despite producing identical rows. No timing threshold is needed.
		expect(scan).toHaveBeenCalledTimes(1);
		expect(wrap).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(1);
		expect(setText).toHaveBeenCalledTimes(1);
	});

	it("rebuilds on setters, width changes and explicit invalidation", () => {
		const render = vi.spyOn(Text.prototype, "render");
		const text = new PresentationText("alpha beta");
		let layouts = 0;
		const rebuilt = (width = 80) => {
			const rows = text.render(width);
			expect(render).toHaveBeenCalledTimes(++layouts);
			expect(text.render(width)).toEqual(rows);
			expect(render).toHaveBeenCalledTimes(layouts);
			return rows;
		};
		rebuilt();
		text.setSafetyRows(20_001); // Clamps to the unchanged default budget.
		text.render(80.9); // Same normalized width.
		expect(render).toHaveBeenCalledTimes(layouts);
		text.setSafetyRows(2);
		rebuilt();
		rebuilt(10);
		rebuilt(); // Only the most recent width is retained.
		text.invalidate();
		rebuilt();
		for (const source of ["changed", "", "same", "same"]) {
			text.setText(source);
			expect(rebuilt().map((line) => line.trimEnd())).toEqual(source ? [source] : []);
		}
	});

	it.each([
		"",
		" \n\t",
		"alpha\nbeta\n",
		"a\tb\r\nc",
		"漢字 😀 e\u0301 👨‍👩‍👧‍👦 ".repeat(8),
		"\x1b[38;2;120;180;200mcolored\x1b[0m plain\nnext line",
		"\x1b]8;;https://example.com/text\x1b\\local link\x1b]8;;\x1b\\",
	])("matches native rows for %j across padding and widths", (source) => {
		for (const padding of [0, 1, 3]) {
			const text = new PresentationText(source, padding, padding ? 1 : 0);
			const native = new Text(source, padding, padding ? 1 : 0);
			for (const width of [120, 80, 10, 2, 1, 80]) {
				const expected = nativeRows(native, width);
				expect(text.render(width)).toEqual(expected);
				expect(text.render(width)).toEqual(expected);
				for (const row of expected) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
			}
		}
	});

	it("returns no rows for invalid widths without replacing a valid cached layout", () => {
		const render = vi.spyOn(Text.prototype, "render");
		const text = new PresentationText("valid");
		const first = text.render(80);
		for (const width of [0, 0.9, -1, Number.NaN, Infinity, -Infinity])
			expect(text.render(width)).toEqual([]);
		expect(text.render(80)).toEqual(first);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ name: "long logical line", source: "x".repeat(20_000), row: "x".repeat(80) },
		{ name: "logical line count", source: "x\n".repeat(20_001), row: "x" },
	])("keeps safety budgets and recovers from capped $name", ({ source, row }) => {
		const text = new PresentationText(source);
		for (const rows of [2, 4, 1, 0]) {
			text.setSafetyRows(rows);
			const expected = nativeRows(
				new Text(`${`${row}\n`.repeat(Math.max(1, rows))}… (preview output omitted)`, 0, 0),
				80,
			);
			expect(text.render(80)).toEqual(expected);
			expect(text.render(80)).toEqual(expected);
		}
		text.setText("short again");
		expect(text.render(80)).toEqual(nativeRows(new Text("short again", 0, 0), 80));
		expect(text.render(80).join("\n")).not.toContain("omitted");
	});

	it.each([
		{ name: "2,600 x 600", rows: 2_600, chars: 600, width: 80, expected: 20_001 },
		{ name: "2,000 x 2,000", rows: 2_000, chars: 2_000, width: 120, expected: 20_001 },
		{ name: "1,500 x 600", rows: 1_500, chars: 600, width: 80, expected: 12_000 },
	])("caps the fast path on $name instead of trusting the estimate", (spec) => {
		const source = Array.from({ length: spec.rows }, () => "x".repeat(spec.chars)).join("\n");
		const text = new PresentationText(source);
		const rows = text.render(spec.width);
		expect(rows).toHaveLength(spec.expected);
		const last = rows[rows.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim();
		if (spec.expected > 20_000) expect(last).toBe("… (preview output omitted)");
		else expect(last).not.toContain("omitted");
		for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(spec.width);
		// The row count is stable on the warm path.
		expect(text.render(spec.width)).toHaveLength(spec.expected);
	});
	it("keeps the single native wrap for ordinary multi-line output", () => {
		const scan = vi.spyOn(bounds, "boundedContentLines");
		const wrap = vi.spyOn(bounds, "boundedWrap");
		const render = vi.spyOn(Text.prototype, "render");
		const source = Array.from(
			{ length: 40 },
			(_, index) => `line ${index} ${"word ".repeat(8)}`,
		).join("\n");
		const text = new PresentationText(source);
		const rows = text.render(80);
		expect(rows.length).toBeGreaterThanOrEqual(40);
		expect(wrap).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledTimes(1);
		expect(text.render(80)).toEqual(rows);
		expect(render).toHaveBeenCalledTimes(1);
		expect(scan).toHaveBeenCalledTimes(1);
	});
	it.skipIf(!nativeSetPaddingX)("honors invalidation from inherited setPaddingX", () => {
		if (!nativeSetPaddingX) throw new Error("Native padding setter unavailable");
		const text = new PresentationText("alpha beta\ngamma", 0, 1);
		const native = new Text("alpha beta\ngamma", 0, 1);
		const first = text.render(20);
		nativeSetPaddingX.call(text, 2);
		nativeSetPaddingX.call(native, 2);
		const expected = nativeRows(native, 20);
		expect(expected).not.toEqual(first);
		expect(text.render(20)).toEqual(expected);
		expect(text.render(20)).toEqual(expected);
	});

	it("refreshes changed background callbacks and theme state on explicit invalidation", () => {
		const text = new PresentationText("alpha\nbeta", 1, 1);
		const native = new Text("alpha\nbeta", 1, 1);
		const plain = text.render(30);
		let color = "41";
		const background = (line: string) => `\x1b[${color}m${line}\x1b[0m`;
		text.setCustomBgFn(background);
		native.setCustomBgFn(background);
		const red = nativeRows(native, 30);
		expect(red).not.toEqual(plain);
		expect(text.render(30)).toEqual(red);
		color = "44";
		text.invalidate();
		native.invalidate();
		const blue = nativeRows(native, 30);
		expect(blue).not.toEqual(red);
		expect(text.render(30)).toEqual(blue);
		expect(text.render(30)).toEqual(blue);
		text.setCustomBgFn();
		expect(text.render(30)).toEqual(plain);
	});

	it("returns defensive row-array copies on both cache misses and hits", () => {
		const text = new PresentationText("alpha\nbeta");
		const expected = nativeRows(new Text("alpha\nbeta", 0, 0), 80);
		const miss = text.render(80);
		miss[0] = "corrupted miss";
		miss.push("extra");
		const hit = text.render(80);
		expect(hit).toEqual(expected);
		expect(hit).not.toBe(miss);
		hit[0] = "corrupted hit";
		hit.pop();
		expect(text.render(80)).toEqual(expected);
	});

	it("does not cache a failed render and retries successfully", () => {
		const text = new PresentationText("retry");
		let fail = true;
		const background = vi.fn((line: string) => {
			if (fail) throw new Error("background failed");
			return line;
		});
		text.setCustomBgFn(background);
		expect(() => text.render(80)).toThrow("background failed");
		fail = false;
		const expected = nativeRows(new Text("retry", 0, 0), 80);
		expect(text.render(80)).toEqual(expected);
		const calls = background.mock.calls.length;
		expect(text.render(80)).toEqual(expected);
		expect(background).toHaveBeenCalledTimes(calls);
	});
});
