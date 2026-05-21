import { describe, expect, it } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { colorize, renderTerminalStyle } from "../extensions/zentui/style";

describe("mergeConfig", () => {
	it("defaults project refresh polling to 30 seconds", () => {
		expect(mergeConfig({}).projectRefreshIntervalMs).toBe(30_000);
	});

	it("accepts custom project refresh intervals and 0 to disable polling", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: 60_000 }).projectRefreshIntervalMs).toBe(60_000);
		expect(mergeConfig({ projectRefreshIntervalMs: 0 }).projectRefreshIntervalMs).toBe(0);
	});

	it("ignores invalid project refresh intervals", () => {
		expect(mergeConfig({ projectRefreshIntervalMs: "30000" }).projectRefreshIntervalMs).toBe(
			30_000,
		);
		expect(mergeConfig({ projectRefreshIntervalMs: 100 }).projectRefreshIntervalMs).toBe(30_000);
		expect(
			mergeConfig({ projectRefreshIntervalMs: Number.POSITIVE_INFINITY }).projectRefreshIntervalMs,
		).toBe(30_000);
	});
});

describe("renderTerminalStyle", () => {
	it("renders Starship bold green with terminal palette ANSI codes", () => {
		expect(renderTerminalStyle("bold green", " v22.0.0")).toBe("\u001b[1;32m v22.0.0\u001b[0m");
	});

	it("supports 256-color, fg aliases, dimmed, and Starship hex styles", () => {
		expect(renderTerminalStyle("bold 149", "C")).toBe("\u001b[1;38;5;149mC\u001b[0m");
		expect(renderTerminalStyle("bold fg:202", "Haxe")).toBe("\u001b[1;38;5;202mHaxe\u001b[0m");
		expect(renderTerminalStyle("red dimmed", "Java")).toBe("\u001b[31;2mJava\u001b[0m");
		expect(renderTerminalStyle("bold #FFAFF3", "Gleam")).toBe(
			"\u001b[1;38;2;255;175;243mGleam\u001b[0m",
		);
	});
});

describe("colorize", () => {
	const theme = {
		fg(token: string, text: string) {
			return `<${token}>${text}</${token}>`;
		},
	};

	it("uses theme tokens when provided", () => {
		expect(colorize(theme, "accent", "hello")).toBe("<accent>hello</accent>");
	});

	it("supports hex colors", () => {
		expect(colorize(theme, "#89b4fa", "hello")).toBe("\u001b[38;2;137;180;250mhello\u001b[39m");
	});

	it("passes unknown colors through theme.fg directly", () => {
		expect(colorize(theme, "wat", "hello")).toBe("<wat>hello</wat>");
	});
});
