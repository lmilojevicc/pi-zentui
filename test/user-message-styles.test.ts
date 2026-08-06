import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	type PolishedTuiConfig,
	type UserMessageStyle,
} from "../extensions/zentui/config";
import {
	sanitizeRenderedUserMessageText,
	sanitizeUserMessageSourceText,
} from "../extensions/zentui/user-message-osc";
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

	it("strips every raw OSC 8 control while preserving visible text", () => {
		const pairs = [
			["\x1b]8;;https://example.com\x07", "\x1b]8;;\x07"],
			["\x1b]8;;https://example.com\x1b\\", "\x1b]8;;\x1b\\"],
			["\x9d8;;https://example.com\x9c", "\x9d8;;\x9c"],
		] as const;
		for (const style of userMessageStyles) {
			for (const [open, close] of pairs) {
				const output = render(style, `before ${open}VISIBLE${close}\nafter`, 80).join("\n");
				expect(output).not.toContain(open);
				expect(output).not.toContain(close);
				expect(plain(output).replaceAll(/[^\p{L}]/gu, "")).toContain("beforeVISIBLEafter");
			}
		}
	});

	it("strips raw OSC 8 independently of Markdown source context", () => {
		const open = "\x1b]8;;https://raw.example\x07";
		const close = "\x1b]8;;\x07";
		const contexts = [
			`${open}VISIBLE${close}`,
			`[docs](https://markdown.example/${open}VISIBLE${close})`,
			`![image](https://markdown.example/${open}VISIBLE${close})`,
			`\` ${open}VISIBLE${close} \``,
			`\`\`foo \`\`\` bar \` ${open}VISIBLE${close} \`\``,
			`~~~\n${open}VISIBLE${close}\n~~~`,
			`[foo\nbar]: ${open}VISIBLE${close}\n\n[foo bar]`,
			`<https://markdown.example/${open}VISIBLE${close}>`,
			`See,https://markdown.example/a_(b)/${open}VISIBLE${close}!`,
			`[broken](https://markdown.example/${open}VISIBLE${close}`,
			`（https://markdown.example/${open}VISIBLE${close}）`,
		];
		for (const style of userMessageStyles) {
			for (const source of contexts) {
				const output = render(style, `${source} TAIL`, 160).join("\n");
				expect(output).not.toContain(open);
				expect(output).not.toContain(close);
				expect(output).toContain("TAIL");
			}
		}
	});

	it("preserves Pi Markdown link rendering after raw-source sanitization", () => {
		const markdown = "[docs](https://markdown.example) <https://autolink.example>";
		const hostile = "\x1b]52;c;c2VjcmV0\x07";
		expect(sanitizeUserMessageSourceText(markdown)).toBe(markdown);
		for (const style of userMessageStyles) {
			const clean = render(style, markdown, 160).join("\n");
			const mixed = render(style, `${hostile}${markdown}`, 160).join("\n");
			expect(mixed).toBe(clean);
			expect(stripVTControlCharacters(mixed)).toContain("docs");
			expect(mixed).toContain("https://markdown.example");
			expect(mixed).toContain("https://autolink.example");
			if (clean.includes("\x1b]8;")) expect(sanitizeRenderedUserMessageText(clean)).toBe(clean);
			expect(mixed).not.toContain("\x1b]52");
			expect(mixed).not.toContain("c2VjcmV0");
		}
	});

	it.each([
		["unmatched open", "\x1b]8;;https://example.com\x07raw"],
		["stray close", "raw\x1b]8;;\x07"],
		["C1 unmatched open", "\x9d8;;https://example.com\x9craw"],
		[
			"nested open",
			"\x1b]8;;https://first.example\x07one \x1b]8;;https://second.example\x07two\x1b]8;;\x07",
		],
	] as const)("strips raw %s OSC 8 streams", (_name, source) => {
		for (const style of userMessageStyles) {
			const output = render(style, source, 80).join("\n");
			expect(output).not.toContain("\x1b]8;");
			expect(output).not.toContain("\x9d");
			expect(output).toMatch(/raw|one/);
		}
	});

	it("removes raw non-OSC terminal controls before Markdown", () => {
		const hostile = [
			"\x1b[2J",
			"\x9b2J",
			"\x1bPsecret\x1b\\",
			"\x90secret\x9c",
			"\x1bXsecret\x1b\\",
			"\x1b^secret\x1b\\",
			"\x1b_secret\x1b\\",
			"\x07",
			"\x01",
			"\x7f",
		].join("");
		for (const style of userMessageStyles) {
			const output = render(style, `before${hostile}after`, 80).join("\n");
			expect(output).toContain("beforeafter");
			expect(output).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
			expect(output).not.toContain("secret");
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
