import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	type PolishedTuiConfig,
	type UserMessageStyle,
} from "../extensions/zentui/config";
import {
	renderUserMessageStyle,
	userMessageStyleCacheKey,
} from "../extensions/zentui/user-message-styles";

const userMessageStyles = ["framed", "framed-copy-friendly", "compact", "labeled"] as const;

function config(style: UserMessageStyle): PolishedTuiConfig {
	const value = structuredClone(defaultConfig);
	value.components.userMessages.style = style;
	return value;
}

function render(style: UserMessageStyle, text: string, width: number, theme?: Theme): string[] {
	return renderUserMessageStyle({ text, width, theme, config: config(style) });
}

function plain(value: string): string {
	return value.replaceAll(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function ansiTheme(): Theme {
	return {
		fg: (_color: string, text: string) => `\x1b[34m${text}\x1b[0m`,
		bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
	} as Theme;
}

describe("pure user-message styles", () => {
	it("preserves exact framed chrome and padding", () => {
		expect(render("framed", "Hello", 12)).toEqual([
			"────────────",
			"│           ",
			"│ Hello     ",
			"│           ",
			"────────────",
		]);
	});

	it("adds one leading space to copy-friendly framed message text", () => {
		expect(render("framed-copy-friendly", "Hello", 12)).toEqual([
			"────────────",
			"",
			" Hello      ",
			"",
			"────────────",
		]);
	});

	it("keeps copy-friendly ANSI and wide-Unicode body rows padded within width", () => {
		for (let width = 2; width <= 24; width += 1) {
			const lines = render("framed-copy-friendly", "界🙂 \x1b[31mwide\x1b[0m", width, ansiTheme());
			const body = lines.slice(2, -2);
			expect(body.length).toBeGreaterThan(0);
			expect(body.every((line) => visibleWidth(line) === width)).toBe(true);
		}
	});

	it("renders compact multiline and blank Markdown rows with an unpadded rail", () => {
		const lines = render("compact", "First\n\nFinal", 16);
		expect(lines).toEqual(["│ First", "│ ", "│ Final"]);
		expect(lines.every((line) => !line.endsWith("  "))).toBe(true);
	});

	it("renders a fixed User label and no extra body padding", () => {
		expect(render("labeled", "Hello\nContinued", 20)).toEqual([
			"╭─ User ───────────╮",
			"│ Hello            │",
			"│ Continued        │",
			"╰──────────────────╯",
		]);
	});

	it("preserves Markdown rendering across all styles", () => {
		for (const style of userMessageStyles) {
			const output = plain(
				render(style, "**bold**\n\n- item\n\n> quote\n\n```ts\ncode\n```", 40).join("\n"),
			);
			expect(output).toContain("bold");
			expect(output).toContain("item");
			expect(output).toContain("quote");
			expect(output).toContain("code");
			expect(output).not.toContain("**bold**");
		}
	});

	it("degrades atomically at compact and labeled narrow thresholds", () => {
		expect(render("compact", "界a", 2)).toEqual(["界", "a"]);
		expect(render("compact", "abc", 3)[0]).toBe("│ a");
		for (const width of [3, 4, 5, 6, 7, 8]) {
			const lines = render("labeled", "abc", width);
			const body = lines.slice(1, -1);
			expect(lines[0]).toMatch(/^╭─*╮$/);
			expect(lines.at(-1)).toMatch(/^╰─*╯$/);
			expect(lines.join("\n")).not.toContain("User");
			expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
			expect(body.every((line) => line.startsWith("│") && line.endsWith("│"))).toBe(true);
			expect(body.map((line) => line.slice(1, -1).trim()).join("")).toContain("abc");
		}
		for (const width of [1, 2]) {
			const joined = render("labeled", "abc", width).join("\n");
			expect(joined).not.toMatch(/[╭╮╰╯│]/);
		}
		expect(render("labeled", "abc", 9)[0]).toBe("╭─ User ╮");
	});

	it("returns a marker-safe row at non-positive widths and clamps ANSI/wide Unicode", () => {
		for (const style of userMessageStyles) {
			expect(render(style, "hello", 0)).toEqual([""]);
			for (let width = 1; width <= 24; width += 1) {
				const lines = render(style, "界🙂 \x1b[31mwide\x1b[0m", width, ansiTheme());
				expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			}
		}
	});

	it("throws rendering failures for the shared adapter to handle", () => {
		const failingTheme = {
			...ansiTheme(),
			fg() {
				throw new Error("theme failed");
			},
		} as unknown as Theme;
		for (const style of userMessageStyles) {
			expect(() => render(style, "hello", 20, failingTheme)).toThrow("theme failed");
		}
	});

	it("preserves complete 7-bit and C1 OSC 8 controls byte-for-byte", () => {
		const starts = ["\x1b]", "\x9d"];
		const terminators = ["\x07", "\x1b\\", "\x9c"];
		for (const style of userMessageStyles) {
			for (const start of starts) {
				for (const terminator of terminators) {
					const open = `${start}8;;https://example.com${terminator}`;
					const close = `${start}8;;${terminator}`;
					const output = render(style, `${open}raw${close}`, 80).join("\n");
					expect(output.split(open)).toHaveLength(2);
					expect(output.split(close)).toHaveLength(2);
					expect(output).toContain(`${open}raw${close}`);
				}
			}
		}
	});

	it("preserves duplicate and mixed OSC 8 ordering alongside Markdown links", () => {
		const firstOpen = "\x1b]8;;https://first.example\x07";
		const firstClose = "\x1b]8;;\x07";
		const secondOpen = "\x9d8;;https://second.example\x9c";
		const secondClose = "\x9d8;;\x9c";
		const text = `${firstOpen}one${firstClose} ${secondOpen}two${secondClose} ${firstOpen}three${firstClose} [markdown](https://markdown.example)`;
		for (const style of userMessageStyles) {
			const output = render(style, text, 160).join("\n");
			expect(output.split(firstOpen)).toHaveLength(3);
			expect(output.split(firstClose)).toHaveLength(3);
			expect(output.split(secondOpen)).toHaveLength(2);
			expect(output.split(secondClose)).toHaveLength(2);
			expect(output.indexOf(`${firstOpen}one${firstClose}`)).toBeLessThan(
				output.indexOf(`${secondOpen}two${secondClose}`),
			);
			expect(output.indexOf(`${secondOpen}two${secondClose}`)).toBeLessThan(
				output.indexOf(`${firstOpen}three${firstClose}`),
			);
			expect(output).toContain("markdown");
		}
	});

	it("supports theme and terminal color sources", () => {
		const themed = config("labeled");
		const themeLines = renderUserMessageStyle({
			text: "hello",
			width: 20,
			theme: ansiTheme(),
			config: themed,
		});
		expect(themeLines.join("\n")).toContain("\x1b[");

		const terminal = config("compact");
		terminal.components.userMessages.colorSource = "terminal";
		terminal.colors.editorAccent = "fg:202";
		const terminalLines = renderUserMessageStyle({
			text: "hello",
			width: 20,
			theme: ansiTheme(),
			config: terminal,
		});
		expect(terminalLines.join("\n")).toContain("\x1b[");
	});

	it("uses only style-relevant cache-key inputs", () => {
		for (const style of userMessageStyles) {
			const base = config(style);
			const key = userMessageStyleCacheKey(base);
			const unrelated = structuredClone(base);
			unrelated.components.footer.style =
				unrelated.components.footer.style === "hidden" ? "native" : "hidden";
			unrelated.layout.fixedEditor.enabled = !unrelated.layout.fixedEditor.enabled;
			expect(userMessageStyleCacheKey(unrelated)).toBe(key);

			const accent = structuredClone(base);
			accent.colors.editorAccent = "red";
			expect(userMessageStyleCacheKey(accent) === key).toBe(style === "framed-copy-friendly");

			const border = structuredClone(base);
			border.colors.editorBorder = "blue";
			expect(userMessageStyleCacheKey(border) === key).toBe(style === "compact");

			const rail = structuredClone(base);
			rail.icons.rail = "┃";
			expect(userMessageStyleCacheKey(rail) === key).toBe(
				style === "labeled" || style === "framed-copy-friendly",
			);
		}

		expect(userMessageStyleCacheKey(config("framed-copy-friendly"))).not.toBe(
			userMessageStyleCacheKey(config("framed")),
		);
	});
});
