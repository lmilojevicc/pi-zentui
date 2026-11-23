import type { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { type EditorStyle, mergeConfig } from "../extensions/zentui/config.ts";
import { PolishedEditor } from "../extensions/zentui/ui.ts";

const esc = "\x1b";
const keyboard = {
	selectAll: `${esc}[97;9u`,
	undo: `${esc}[122;9u`,
	redo: `${esc}[122;10u`,
	wordLeft: `${esc}[1;4D`,
	documentStart: `${esc}[1;10A`,
	deleteToStart: `${esc}[117;9u`,
};

function editor(style: EditorStyle = "minimalist", macEditing = true) {
	const config = mergeConfig({ components: { editor: { style } } }, {});
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => `${esc}[48;5;24m${text}${esc}[49m`,
		bold: (text: string) => text,
	} as Theme;
	const result = new PolishedEditor(
		{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
		{ borderColor: (text: string) => text, selectList: {} } as never,
		getKeybindings() as never,
		theme,
		() => config,
		() => ({ modelLabel: "model", providerLabel: "provider" }),
		() => "off",
		undefined,
		undefined,
		undefined,
		undefined,
		macEditing,
	);
	result.focused = true;
	return result;
}

const styles = [
	"minimalist",
	"opencode",
	"opencode-copy-friendly",
	"accent-rail",
] as const satisfies readonly EditorStyle[];

describe("macOS prompt editing inside Zentui's frame", () => {
	it.each(styles)("replaces a selected word and undoes/redoes the whole edit in %s", (style) => {
		const input = editor(style);
		input.setText("one two three");
		input.render(80);
		input.handleInput(keyboard.wordLeft);
		for (const ch of "four") input.handleInput(ch);
		expect(input.getText()).toBe("one two four");
		input.handleInput(keyboard.undo);
		expect(input.getText()).toBe("one two three");
		input.handleInput(keyboard.redo);
		expect(input.getText()).toBe("one two four");
	});

	it("replaces a multiline selection with pasted text as one undo step", () => {
		const input = editor();
		input.setText("first line\nsecond line");
		input.render(80);
		input.handleInput(keyboard.documentStart);
		input.handleInput(`${esc}[200~café 👩‍💻${esc}[201~`);
		expect(input.getText()).toBe("café 👩‍💻");
		input.handleInput(keyboard.undo);
		expect(input.getText()).toBe("first line\nsecond line");
		input.handleInput(`${esc}[1;9B`); // Cmd+Down: move to the end first.
		input.handleInput(keyboard.deleteToStart);
		expect(input.getText()).toBe("first line\n");
	});

	it.each(styles)("keeps the %s styling and renders themed selection within the frame", (style) => {
		const native = editor(style, false);
		const input = editor(style);
		for (const item of [native, input]) item.setText("alpha界 beta");
		expect(input.render(72)).toEqual(native.render(72));
		input.handleInput(keyboard.selectAll);
		const selected = input.render(72);
		expect(selected.some((row) => row.includes(`${esc}[48;5;24m`))).toBe(true);
		expect(selected.every((row) => visibleWidth(row) <= 72)).toBe(true);
	});

	it("keeps Enter as submit and Shift+Enter as newline", () => {
		const input = editor();
		input.setText("abc");
		input.handleInput("\n");
		input.handleInput("d");
		let submitted = "";
		input.onSubmit = (text) => {
			submitted = text;
		};
		input.handleInput("\r");
		expect(submitted).toBe("abc\nd");
	});
});
