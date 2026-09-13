import { stripVTControlCharacters } from "node:util";
import { CustomEditor, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig, type EditorStyle } from "../extensions/zentui/config";
import type { EditorMouseEvent, EditorMouseHandler } from "../extensions/zentui/editor-mouse";
import { PolishedEditor, WrappedPolishedEditor } from "../extensions/zentui/ui";

const identity = (text: string) => text;
const uiTheme = {
	fg: (_: string, text: string) => text,
	bg: (_: string, text: string) => text,
	bold: identity,
	italic: identity,
	underline: identity,
	strikethrough: identity,
} as Theme;
const editorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};
const tui = { requestRender() {}, terminal: { rows: 40, cols: 80 } };
const keys = { matches: () => false };
const meta = () => ({ modelLabel: "model", providerLabel: "provider" });
const styles: EditorStyle[] = ["opencode", "opencode-copy-friendly", "accent-rail", "minimalist"];
function config(style: EditorStyle) {
	const value = structuredClone(defaultConfig);
	value.components.editor.style = style;
	return value;
}
function mouse(editor: object, event: EditorMouseEvent) {
	return (editor as { handleMouse?: EditorMouseHandler }).handleMouse?.(event);
}
function event(x: number, y: number, width: number, height: number, type = "click") {
	return {
		x,
		y,
		width,
		height,
		type,
		button: "left",
		screenX: 20 + x,
		screenY: 30 + y,
		shift: false,
		alt: false,
		ctrl: false,
	};
}
function cell(rows: string[], text: string) {
	const plain = rows.map(stripVTControlCharacters);
	const y = plain.findIndex((row) => row.includes(text));
	expect(y, `missing ${text} in ${plain.join("\n")}`).toBeGreaterThanOrEqual(0);
	return { x: visibleWidth(plain[y].slice(0, plain[y].indexOf(text))), y };
}
function native() {
	return new CustomEditor(tui as never, editorTheme, keys as never, { paddingX: 0 });
}
function editors(style: EditorStyle, wrapped: boolean) {
	const cfg = config(style);
	const base = native();
	const editor = wrapped
		? new WrappedPolishedEditor(
				base as never,
				uiTheme,
				() => cfg,
				meta,
				() => "off",
			)
		: new PolishedEditor(
				tui as never,
				editorTheme,
				keys as never,
				uiTheme,
				() => cfg,
				meta,
				() => "off",
			);
	return { editor, base: (wrapped ? base : editor) as CustomEditor, cfg };
}
const nativeMouse =
	typeof (CustomEditor.prototype as unknown as { handleMouse?: unknown }).handleMouse ===
	"function";

describe("editor mouse capability and delegation", () => {
	it("keeps quota outside the Accent Rail prompt and translates completion rows past it", () => {
		const cfg = config("accent-rail");
		cfg.components.editor.codexQuota = true;
		const handleMouse = vi.fn(() => ({ handled: true }));
		let completing = true;
		const base = {
			autocompleteList: { render: () => ["  completion"] },
			isShowingAutocomplete: () => completing,
			render(width: number) {
				return [
					"─".repeat(width),
					"draft",
					"─".repeat(width),
					...(completing ? this.autocompleteList.render() : []),
				];
			},
			getText: () => "draft",
			setText() {},
			handleInput() {},
			invalidate() {},
			handleMouse,
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			uiTheme,
			() => cfg,
			() => ({ ...meta(), codexQuota: { fiveHour: 80, week: 60, stale: true } }),
			() => "off",
		);
		const rows = editor.render(60);
		expect(rows).toHaveLength(3);
		const quota = cell(rows, "5h");
		const completion = cell(rows, "completion");
		expect(quota.y).toBe(1);
		expect(completion.y).toBe(2);
		mouse(editor, event(completion.x, completion.y, 60, rows.length));
		expect(handleMouse).toHaveBeenLastCalledWith(
			expect.objectContaining({ y: 3, width: 58, height: 4 }),
		);
		handleMouse.mockClear();
		mouse(editor, event(quota.x, quota.y, 60, rows.length));
		expect(handleMouse).not.toHaveBeenCalled();
		expect(editor.getText()).toBe("draft");
		completing = false;
		// Two owned rows, not the special padded one-row rail geometry.
		expect(editor.render(60)).toHaveLength(2);
		cfg.components.editor.codexQuota = false;
		expect(editor.render(60)).toHaveLength(3);
	});
	it("does not invent mouse support on a predecessor without it", () => {
		const base = {
			render: () => ["native"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			uiTheme,
			() => config("opencode"),
			meta,
			() => "off",
		);
		expect(editor.handleMouse).toBeUndefined();
		expect(
			typeof (editors("opencode", false).editor as { handleMouse?: unknown }).handleMouse ===
				"function",
		).toBe(nativeMouse);
	});
	it.each(styles)(
		"delegates %s body coordinates, receiver, original bounds, absolute cells and capture results",
		(style) => {
			const calls: EditorMouseEvent[] = [];
			const result = { handled: true, capture: true, focus: true, render: false };
			const base = {
				focused: false,
				render: (width: number) => [
					`─── ↑ 20 more ${"─".repeat(Math.max(0, width - 14))}`,
					"abcdef",
					"ghijkl",
					"─".repeat(width),
				],
				invalidate() {},
				handleInput() {},
				getText: () => "abcdef\nghijkl",
				setText() {},
				handleMouse(this: unknown, input: EditorMouseEvent) {
					expect(this).toBe(base);
					calls.push(input);
					return result;
				},
			};
			const cfg = config(style);
			const editor = new WrappedPolishedEditor(
				base as never,
				uiTheme,
				() => cfg,
				meta,
				() => "off",
			);
			const rows = editor.render(40);
			const { x, y } = cell(rows, "abcdef");
			const input = event(x + 2, y, 40, rows.length, "press");
			expect(mouse(editor, input)).toBe(result);
			expect(calls[0]).toEqual({
				...input,
				x: 2,
				y: 1,
				width: style === "minimalist" ? 36 : style === "opencode-copy-friendly" ? 40 : 38,
				height: 4,
			});
			expect(mouse(editor, event(x + 3, y, 40, rows.length, "drag"))).toBe(result);
			expect(mouse(editor, event(0, -1, 40, rows.length, "release"))).toBe(result);
			expect(calls).toHaveLength(3);
			editor.focused = true;
			expect(base.focused).toBe(true);
			cfg.components.editor.enabled = false;
			// A config change alone must not move the coordinates of displayed rows.
			mouse(editor, input);
			expect(calls.at(-1)).toEqual(calls[0]);
			const nativeRows = editor.render(20);
			const direct = event(4, 1, 20, nativeRows.length);
			expect(mouse(editor, direct)).toBe(result);
			expect(calls.at(-1)).toEqual(direct);
		},
	);
	it("delegates fail-open output at the completed base render dimensions and narrow renders", () => {
		const handleMouse = vi.fn((_event: EditorMouseEvent) => ({ handled: true }));
		const base = {
			render: (width: number) => [`unfamiliar:${width}`],
			handleMouse,
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			uiTheme,
			() => config("minimalist"),
			meta,
			() => "off",
		);
		editor.render(40);
		mouse(editor, event(3, 0, 40, 1));
		expect(handleMouse.mock.calls[0]?.[0]).toMatchObject({ x: 3, y: 0, width: 36, height: 1 });
		editor.render(2);
		mouse(editor, event(1, 0, 2, 1));
		expect(handleMouse.mock.calls[1]?.[0]).toMatchObject({ x: 1, y: 0, width: 2, height: 1 });
	});
});

describe.skipIf(!nativeMouse)("actual native mouse-capable editor", () => {
	it("allows assignment decoration of the owned handler", () => {
		const { editor } = editors("opencode", false);
		const target = editor as unknown as { handleMouse: EditorMouseHandler };
		const predecessor = target.handleMouse;
		const calls: EditorMouseEvent[] = [];
		const capture = { handled: true, capture: true, focus: true, render: false };
		expect(Object.getOwnPropertyDescriptor(editor, "handleMouse")?.writable).toBe(true);
		target.handleMouse = function (input) {
			expect(this).toBe(editor);
			calls.push(input);
			predecessor.call(this, input);
			return capture;
		};
		editor.setText("abcdef");
		const rows = editor.render(40);
		const start = cell(rows, "abcdef");
		const input = event(start.x + 2, start.y, 40, rows.length);
		expect(mouse(editor, input)).toBe(capture);
		expect(calls).toEqual([input]);
		expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
	});

	it("preserves a resolved subclass override and maps its native super delegation only once", () => {
		const calls: EditorMouseEvent[] = [];
		const capture = { handled: true, capture: true, focus: true, render: false };
		class SubclassEditor extends PolishedEditor {
			handleMouse(input: EditorMouseEvent) {
				expect(this).toBe(editor);
				calls.push(input);
				Reflect.apply(Reflect.get(PolishedEditor.prototype, "handleMouse"), this, [input]);
				return capture;
			}
		}
		const editor = new SubclassEditor(
			tui as never,
			editorTheme,
			keys as never,
			uiTheme,
			() => config("opencode"),
			meta,
			() => "off",
		);
		editor.setText("abcdef");
		const rows = editor.render(40);
		const start = cell(rows, "abcdef");
		const input = event(start.x + 2, start.y, 40, rows.length);
		expect(mouse(editor, input)).toBe(capture);
		expect(calls).toEqual([{ ...input, x: 2, y: 1, width: 38, height: 3 }]);
		expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
		expect(mouse(editor, event(0, -1, 40, rows.length, "release"))).toBe(capture);
		expect(calls).toHaveLength(2);
	});

	for (const wrapped of [false, true]) {
		it.each(styles)(
			`maps rendered %s text on ${wrapped ? "wrapped" : "standalone"} editor after resizing`,
			(style) => {
				const { editor } = editors(style, wrapped);
				for (const width of [60, 20, 8, 2, 60]) {
					editor.setText("abcdef\nghijkl");
					const rows = editor.render(width);
					const { x, y } = cell(rows, "a");
					expect(mouse(editor, event(x, y, width, rows.length))).toMatchObject({
						handled: true,
						focus: true,
					});
					expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
					for (const type of ["press", "drag", "release"])
						expect(mouse(editor, event(x, y, width, rows.length, type))).toBeUndefined();
				}
			},
		);
		it.each(styles)(
			`maps scrolled %s text (including fail-open native borders) on ${wrapped ? "wrapped" : "standalone"}`,
			(style) => {
				const { editor } = editors(style, wrapped);
				editor.setText(Array.from({ length: 100 }, (_, index) => `row${index}`).join("\n"));
				const rows = editor.render(60);
				const firstVisible = rows
					.map(stripVTControlCharacters)
					.map((row) => row.match(/row(\d+)/))
					.find(Boolean);
				expect(firstVisible).toBeTruthy();
				const position = cell(rows, firstVisible?.[0] ?? "missing");
				mouse(editor, event(position.x, position.y, 60, rows.length));
				expect(editor.getCursor()).toEqual({ line: Number(firstVisible?.[1]), col: 0 });
			},
		);
		it.each(styles)(
			`maps Unicode wrapped %s cells on ${wrapped ? "wrapped" : "standalone"} editor`,
			(style) => {
				const { editor } = editors(style, wrapped);
				editor.setText("界🙂é abcdefghijklmnop\nTARGET");
				const rows = editor.render(12);
				const target = cell(rows, "TARG");
				mouse(editor, event(target.x, target.y, 12, rows.length));
				expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
				const wide = cell(editor.render(12), "界");
				mouse(editor, event(wide.x + 2, wide.y, 12, rows.length));
				expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
			},
		);
		it.each(styles)(
			`maps actual autocomplete rows in %s on ${wrapped ? "wrapped" : "standalone"} editor`,
			async (style) => {
				const { editor, base, cfg } = editors(style, wrapped);
				cfg.components.editor.styles.opencode.completionMenu = "palette";
				cfg.components.editor.styles["opencode-copy-friendly"].completionMenu = "palette";
				base.setAutocompleteMaxVisible(3);
				base.setAutocompleteProvider({
					async getSuggestions() {
						return {
							prefix: "/",
							items: Array.from({ length: 8 }, (_, index) => ({
								value: `/item${index}`,
								label: `/item${index}`,
							})),
						};
					},
					applyCompletion(_lines, _line, _col, item) {
						return { lines: [item.value], cursorLine: 0, cursorCol: item.value.length };
					},
				});
				editor.setText("/");
				editor.handleInput("\t");
				await vi.waitFor(() => expect(base.isShowingAutocomplete()).toBe(true));
				const rows = editor.render(40);
				const second = cell(rows, "/item1");
				expect(mouse(editor, event(second.x, second.y, 40, rows.length))).toMatchObject({
					handled: true,
					focus: true,
				});
				expect(editor.getText()).toBe("/item1");
				if (style.startsWith("opencode")) {
					expect(rows.join("\n")).not.toContain("(1/8)");
					const help = cell(rows, "Navigate");
					expect(mouse(editor, event(help.x, help.y, 40, rows.length))).toBeUndefined();
				}
			},
		);
	}
	it("composes mappings through owned editor wrappers", () => {
		const inner = editors("opencode", false).editor;
		const outer = new WrappedPolishedEditor(
			inner as never,
			uiTheme,
			() => config("minimalist"),
			meta,
			() => "off",
		);
		outer.setText("abcdef\nghijkl");
		const rows = outer.render(40);
		const start = cell(rows, "abcdef");
		mouse(outer, event(start.x + 2, start.y, 40, rows.length));
		expect(outer.getCursor()).toEqual({ line: 0, col: 2 });
	});
});
