import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderAccentRailEditorFrame } from "../extensions/zentui/accent-rail-editor";
import {
	mergeConfig,
	type PolishedTuiConfig,
	saveEditorComponentPatch,
	saveUserMessagesComponentPatch,
} from "../extensions/zentui/config";
import {
	DEFAULT_ACCENT_RAIL_GLYPH,
	DEFAULT_ASCII_RAIL_GLYPH,
	DEFAULT_RAIL_GLYPH,
	normalizeRailGlyph,
	resolveAccentRailGlyph,
	resolveEditorFrameRailGlyph,
	resolveUserMessageRailGlyph,
} from "../extensions/zentui/rail-glyph";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";
import {
	renderUserMessageStyle,
	userMessageStyleCacheKey,
} from "../extensions/zentui/user-message-styles";

function theme(): Theme {
	return {
		fg: (_color: string, text: string) => `\x1b[38;5;39m${text}\x1b[39m`,
		bg: (_color: string, text: string) => `\x1b[48;5;234m${text}\x1b[49m`,
		getBgAnsi: () => "\x1b[48;5;234m",
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
	} as unknown as Theme;
}

function config(overrides: Record<string, unknown> = {}): PolishedTuiConfig {
	return mergeConfig({ icons: { mode: "nerd" }, ...overrides }, {});
}

function plain(value: string): string {
	return stripVTControlCharacters(value);
}

function withFile(initial: unknown, run: (path: string) => void): void {
	const dir = fs.mkdtempSync(join(tmpdir(), "zentui-rail-"));
	const path = join(dir, "zentui.json");
	try {
		if (initial !== undefined) fs.writeFileSync(path, JSON.stringify(initial));
		run(path);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("rail glyph normalization", () => {
	it("keeps single-cell glyphs and rejects everything else", () => {
		for (const glyph of ["│", "┃", "▎", "▌", "|"]) {
			expect(normalizeRailGlyph(glyph)).toBe(glyph);
		}
		expect(normalizeRailGlyph(undefined)).toBeUndefined();
		expect(normalizeRailGlyph("")).toBeUndefined();
		expect(normalizeRailGlyph("   ")).toBeUndefined();
		// Wide characters never fit the one-cell rail column.
		expect(normalizeRailGlyph("界")).toBeUndefined();
		expect(normalizeRailGlyph("🙂")).toBeUndefined();
	});

	it("strips terminal control sequences from configured glyphs", () => {
		expect(normalizeRailGlyph("\x1b[31m┃\x1b[0m")).toBe("┃");
		expect(normalizeRailGlyph("\x1b]2;title\x07▌")).toBe("▌");
		expect(normalizeRailGlyph("\x1b]8;;https://example.com\x07│")).toBe("│");
		expect(normalizeRailGlyph("\x1b[31m\x1b[0m")).toBeUndefined();
	});

	it("truncates multi-cell glyphs to the single rail cell", () => {
		expect(normalizeRailGlyph("││")).toBe("│");
		expect(normalizeRailGlyph("▌▌")).toBe("▌");
	});

	it("ignores surrounding whitespace instead of rendering a blank rail", () => {
		expect(normalizeRailGlyph(" ┃")).toBe("┃");
		expect(normalizeRailGlyph("┃ ")).toBe("┃");
		expect(normalizeRailGlyph(" │ x ")).toBe("│");
		expect(normalizeRailGlyph(" ")).toBeUndefined();
	});
});

describe("owner-owned rail glyphs", () => {
	it("keeps the editor rail and the user-message rail independent", () => {
		const editor = config({ components: { editor: { rail: "┃" } } });
		expect(editor.components.editor.rail).toBe("┃");
		expect(editor.components.userMessages.rail).toBeUndefined();
		expect(resolveEditorFrameRailGlyph(editor)).toBe("┃");
		expect(resolveUserMessageRailGlyph(editor)).toBe(DEFAULT_RAIL_GLYPH);

		const messages = config({ components: { userMessages: { rail: "▌" } } });
		expect(messages.components.userMessages.rail).toBe("▌");
		expect(messages.components.editor.rail).toBeUndefined();
		expect(resolveUserMessageRailGlyph(messages)).toBe("▌");
		expect(resolveEditorFrameRailGlyph(messages)).toBe(DEFAULT_RAIL_GLYPH);
	});

	it("keeps the shared icon rail as the historical fallback", () => {
		const shared = config({ icons: { mode: "nerd", rail: "!" } });
		expect(resolveEditorFrameRailGlyph(shared)).toBe("!");
		expect(resolveUserMessageRailGlyph(shared)).toBe("!");
	});

	it("falls back safely when the configured glyph is unusable", () => {
		const wide = config({ components: { editor: { rail: "界" } } });
		expect(resolveEditorFrameRailGlyph(wide)).toBe(DEFAULT_RAIL_GLYPH);
		const messages = config({ components: { userMessages: { rail: "🙂" } } });
		expect(resolveUserMessageRailGlyph(messages)).toBe(DEFAULT_RAIL_GLYPH);
	});

	it("uses the ASCII rail glyph in ASCII icon mode", () => {
		const ascii = mergeConfig(
			{ icons: { mode: "ascii" }, components: { editor: { asciiRail: "!" } } },
			{},
		);
		expect(resolveEditorFrameRailGlyph(ascii)).toBe("!");
		const plain = mergeConfig({ icons: { mode: "ascii" } }, {});
		expect(resolveEditorFrameRailGlyph(plain)).toBe(DEFAULT_ASCII_RAIL_GLYPH);
		expect(resolveUserMessageRailGlyph(plain)).toBe(DEFAULT_ASCII_RAIL_GLYPH);
	});

	it("keeps the Nerd and ASCII rail variants independent per icon mode", () => {
		const nerd = mergeConfig(
			{ icons: { mode: "nerd" }, components: { userMessages: { rail: "▌" } } },
			{},
		);
		expect(resolveUserMessageRailGlyph(nerd)).toBe("▌");

		// An explicit canonical rail keeps working when the icon mode is ASCII.
		const ascii = mergeConfig(
			{ icons: { mode: "ascii" }, components: { userMessages: { rail: "▌" } } },
			{},
		);
		expect(resolveUserMessageRailGlyph(ascii)).toBe("▌");

		const asciiOverride = mergeConfig(
			{
				icons: { mode: "ascii" },
				components: { userMessages: { rail: "▌", asciiRail: "!" } },
			},
			{},
		);
		expect(resolveUserMessageRailGlyph(asciiOverride)).toBe("!");
	});

	it("keeps the accent-rail style rail and lets the canonical editor rail win", () => {
		const styled = config();
		styled.components.editor.style = "accent-rail";
		expect(resolveAccentRailGlyph(styled)).toBe(DEFAULT_ACCENT_RAIL_GLYPH);

		styled.components.editor.styles["accent-rail"].rail = "!";
		expect(resolveAccentRailGlyph(styled)).toBe("!");

		styled.components.editor.rail = "┃";
		expect(resolveAccentRailGlyph(styled)).toBe("┃");
	});
});

describe("rail glyph rendering", () => {
	it("renders the configured editor rail in the Opencode frame", () => {
		const current = config({ components: { editor: { rail: "┃" } } });
		const rows = renderPolishedEditorFrame({
			width: 20,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: current,
			modelMeta: {
				modelLabel: "model",
				providerLabel: "provider",
				sessionName: "session",
			},
		});
		const body = rows.map(plain).find((row) => row.includes("draft"));
		expect(body?.startsWith("┃ ")).toBe(true);
		expect(visibleWidth(body ?? "")).toBe(20);
	});

	it("renders the configured rail in previous user messages only", () => {
		const current = config({ components: { userMessages: { rail: "▌" } } });
		const rows = renderUserMessageStyle({ text: "Hello", width: 12, config: current }).map(plain);
		expect(rows).toEqual([
			"────────────",
			"▌           ",
			"▌ Hello     ",
			"▌           ",
			"────────────",
		]);

		const compact = config({ components: { userMessages: { rail: "▌" } } });
		compact.components.userMessages.style = "compact";
		expect(
			renderUserMessageStyle({ text: "Hello", width: 12, config: compact }).map(plain),
		).toEqual(["▌ Hello"]);
	});

	it("keeps the editor rail out of previous user messages", () => {
		const current = config({ components: { editor: { rail: "┃" } } });
		const rows = renderUserMessageStyle({ text: "Hello", width: 12, config: current }).map(plain);
		expect(rows[1]?.startsWith(`${DEFAULT_RAIL_GLYPH} `)).toBe(true);
		expect(rows.join("\n")).not.toContain("┃");
	});

	it("renders the canonical editor rail in the Accent Rail editor", () => {
		const current = config({ components: { editor: { rail: "┃" } } });
		current.components.editor.style = "accent-rail";
		const rows = renderAccentRailEditorFrame({
			width: 12,
			editorLines: ["draft"],
			uiTheme: theme(),
			config: current,
		}).map(plain);
		expect(rows).toEqual(["┃ draft     "]);
	});

	it("invalidates the user-message cache when the rail changes", () => {
		const current = config();
		const before = userMessageStyleCacheKey(current);
		current.components.userMessages.rail = "▌";
		expect(userMessageStyleCacheKey(current)).not.toBe(before);
		current.components.userMessages.rail = undefined;
		expect(userMessageStyleCacheKey(current)).toBe(before);
	});
});

describe("rail glyph persistence", () => {
	it("saves the editor rail without touching user messages", () => {
		withFile({ components: { userMessages: { rail: "▌" } } }, (path) => {
			const saved = saveEditorComponentPatch({ rail: "┃", asciiRail: "┃" }, path);
			expect(saved.components.editor.rail).toBe("┃");
			expect(saved.components.userMessages.rail).toBe("▌");
			const raw = JSON.parse(fs.readFileSync(path, "utf8"));
			expect(raw.components.editor.rail).toBe("┃");
			expect(raw.components.editor.asciiRail).toBe("┃");
			expect(raw.components.userMessages.rail).toBe("▌");
		});
	});

	it("saves the user-message rail without touching the editor", () => {
		withFile({ components: { editor: { rail: "┃" } } }, (path) => {
			const saved = saveUserMessagesComponentPatch({ rail: "▌", asciiRail: "▌" }, path);
			expect(saved.components.userMessages.rail).toBe("▌");
			expect(saved.components.editor.rail).toBe("┃");
			const raw = JSON.parse(fs.readFileSync(path, "utf8"));
			expect(raw.components.userMessages.rail).toBe("▌");
			expect(raw.components.editor.rail).toBe("┃");
		});
	});

	it("removes the rail override and resumes the inherited glyph", () => {
		withFile({ icons: { mode: "nerd" }, components: { editor: { rail: "┃" } } }, (path) => {
			const saved = saveEditorComponentPatch({ rail: null, asciiRail: null }, path);
			expect(saved.components.editor.rail).toBeUndefined();
			expect(resolveEditorFrameRailGlyph(saved)).toBe(DEFAULT_RAIL_GLYPH);
			const raw = JSON.parse(fs.readFileSync(path, "utf8"));
			expect(raw.components.editor.rail).toBeUndefined();
		});
	});

	it("keeps unrelated owners untouched when saving a rail", () => {
		withFile({ components: { footer: { style: "hidden" }, future: { keep: true } } }, (path) => {
			saveUserMessagesComponentPatch({ rail: "▌" }, path);
			const raw = JSON.parse(fs.readFileSync(path, "utf8"));
			expect(raw.components.footer).toEqual({ style: "hidden" });
			expect(raw.components.future).toEqual({ keep: true });
			expect(raw.components.editor).toBeUndefined();
		});
	});
});
