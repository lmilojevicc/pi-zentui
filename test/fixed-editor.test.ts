import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	buildCluster,
	capEditorLines,
	findEditorContainerIndex,
	hideRenderable,
	renderCluster,
	restoreRenderable,
} from "../extensions/zentui/fixed-editor/cluster";
import {
	clampScrollOffset,
	parseKeyboardScroll,
	parseMouseEvent,
	parseMouseScroll,
} from "../extensions/zentui/fixed-editor/input";
import { highlightSelection, SelectionState } from "../extensions/zentui/fixed-editor/selection";
import {
	DISABLE_MOUSE,
	ENABLE_ALT_SCROLL,
	EXIT_ALT_SCREEN,
	emergencyTerminalReset,
	RESET_SCROLL_REGION,
	SHOW_CURSOR,
} from "../extensions/zentui/fixed-editor/terminal-modes";

describe("input", () => {
	describe("parseMouseScroll", () => {
		it("parses SGR wheel up", () => {
			expect(parseMouseScroll("\x1b[<64;10;5M")).toEqual({ direction: "up", amount: 3 });
		});

		it("parses SGR wheel down", () => {
			expect(parseMouseScroll("\x1b[<65;10;5M")).toEqual({ direction: "down", amount: 3 });
		});

		it("parses wheel with modifiers (shift bit)", () => {
			// 64 | 4 = 68 (wheel up with shift)
			expect(parseMouseScroll("\x1b[<68;10;5M")).toEqual({ direction: "up", amount: 3 });
		});

		it("returns undefined for non-mouse input", () => {
			expect(parseMouseScroll("\x1b[A")).toBeUndefined();
		});

		it("returns undefined for non-wheel mouse (button 0)", () => {
			expect(parseMouseScroll("\x1b[<0;10;5M")).toBeUndefined();
		});
	});

	describe("parseKeyboardScroll", () => {
		it("parses PgUp", () => {
			expect(parseKeyboardScroll("\x1b[5~")).toEqual({ action: "pageUp" });
		});

		it("parses PgDn", () => {
			expect(parseKeyboardScroll("\x1b[6~")).toEqual({ action: "pageDown" });
		});

		it("parses Enter as jumpBottom", () => {
			expect(parseKeyboardScroll("\r")).toEqual({ action: "jumpBottom" });
		});

		it("parses Ctrl+Shift+Up", () => {
			expect(parseKeyboardScroll("\x1b[1;6A")).toEqual({ action: "pageUp" });
		});

		it("parses Ctrl+Shift+Down", () => {
			expect(parseKeyboardScroll("\x1b[1;6B")).toEqual({ action: "pageDown" });
		});

		it("returns undefined for regular keys", () => {
			expect(parseKeyboardScroll("a")).toBeUndefined();
		});

		it("returns undefined for key release", () => {
			expect(parseKeyboardScroll("\x1b[5;2~")).toBeUndefined();
		});
	});

	describe("parseMouseEvent", () => {
		it("parses left button press", () => {
			const ev = parseMouseEvent("\x1b[<0;5;3M");
			expect(ev).toEqual({ button: "left", action: "press", col: 5, row: 3 });
		});

		it("parses left button drag (motion bit set)", () => {
			const ev = parseMouseEvent("\x1b[<32;10;5M");
			expect(ev).toEqual({ button: "left", action: "drag", col: 10, row: 5 });
		});

		it("parses left button release (lowercase m)", () => {
			const ev = parseMouseEvent("\x1b[<0;10;5m");
			expect(ev).toEqual({ button: "left", action: "release", col: 10, row: 5 });
		});

		it("parses right button press", () => {
			const ev = parseMouseEvent("\x1b[<2;7;4M");
			expect(ev).toEqual({ button: "right", action: "press", col: 7, row: 4 });
		});

		it("parses wheel up", () => {
			const ev = parseMouseEvent("\x1b[<64;1;1M");
			expect(ev).toEqual({ button: "wheel-up", action: "press", col: 1, row: 1 });
		});

		it("parses wheel down", () => {
			const ev = parseMouseEvent("\x1b[<65;1;1M");
			expect(ev).toEqual({ button: "wheel-down", action: "press", col: 1, row: 1 });
		});

		it("returns undefined for non-mouse input", () => {
			expect(parseMouseEvent("\x1b[A")).toBeUndefined();
		});
	});

	describe("clampScrollOffset", () => {
		it("clamps within range", () => {
			expect(clampScrollOffset(5, 10)).toBe(5);
		});

		it("clamps negative to 0", () => {
			expect(clampScrollOffset(-3, 10)).toBe(0);
		});

		it("clamps above max", () => {
			expect(clampScrollOffset(15, 10)).toBe(10);
		});

		it("handles maxOffset of 0", () => {
			expect(clampScrollOffset(5, 0)).toBe(0);
		});
	});
});

describe("terminal-modes", () => {
	describe("emergencyTerminalReset", () => {
		it("contains all reset sequences", () => {
			const reset = emergencyTerminalReset();
			expect(reset).toContain(EXIT_ALT_SCREEN);
			expect(reset).toContain(DISABLE_MOUSE);
			expect(reset).toContain(RESET_SCROLL_REGION);
			expect(reset).toContain(ENABLE_ALT_SCROLL);
			expect(reset).toContain(SHOW_CURSOR);
		});
	});
});

describe("cluster", () => {
	function makeComponent(lines: string[] = ["line"]) {
		return { render: () => lines, invalidate: () => {} };
	}

	function makeContainer(children: unknown[]) {
		return { render: () => [], invalidate: () => {}, children };
	}

	function makeEditor() {
		return {
			render: () => ["editor"],
			invalidate: () => {},
			getText: () => "",
			setText: () => {},
			handleInput: () => {},
		};
	}

	describe("findEditorContainerIndex", () => {
		it("finds the container with an editor-like child", () => {
			const children = [makeComponent(), makeContainer([makeEditor()]), makeComponent()];
			expect(findEditorContainerIndex(children)).toBe(1);
		});

		it("returns undefined when no editor found", () => {
			const children = [makeComponent(), makeComponent()];
			expect(findEditorContainerIndex(children)).toBeUndefined();
		});

		it("prefers focused component's parent", () => {
			const editor = makeEditor();
			const containerA = makeContainer([editor]);
			const containerB = makeContainer([makeEditor()]);
			const children = [containerA, containerB];
			expect(findEditorContainerIndex(children, editor)).toBe(0);
		});
	});

	describe("buildCluster", () => {
		it("builds the 5-component cluster", () => {
			const status = makeComponent(["status"]);
			const above = makeComponent(["above"]);
			const editor = makeContainer([makeEditor()]);
			const below = makeComponent(["below"]);
			const footer = makeComponent(["footer"]);
			const children = [status, above, editor, below, footer];
			const cluster = buildCluster(children, 2);
			expect(cluster).not.toBeNull();
			expect(cluster?.status).toBe(status);
			expect(cluster?.aboveWidget).toBe(above);
			expect(cluster?.editor).toBe(editor);
			expect(cluster?.belowWidget).toBe(below);
			expect(cluster?.footer).toBe(footer);
		});

		it("handles missing neighbors gracefully", () => {
			const editor = makeContainer([makeEditor()]);
			const children = [editor];
			const cluster = buildCluster(children, 0);
			expect(cluster).not.toBeNull();
			expect(cluster?.status).toBeNull();
			expect(cluster?.aboveWidget).toBeNull();
			expect(cluster?.editor).toBe(editor);
			expect(cluster?.belowWidget).toBeNull();
			expect(cluster?.footer).toBeNull();
		});
	});

	describe("capEditorLines", () => {
		it("keeps last N lines when no cursor marker", () => {
			const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
			const result = capEditorLines(lines, 5);
			expect(result).toHaveLength(5);
			expect(result[0]).toBe("line 5");
		});

		it("centers window on cursor row", () => {
			const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
			lines[15] = `line 15${CURSOR_MARKER}`;
			const result = capEditorLines(lines, 5);
			expect(result).toHaveLength(5);
			expect(result[4]).toContain("line 15");
		});

		it("returns all lines when under max", () => {
			const lines = ["a", "b", "c"];
			expect(capEditorLines(lines, 5)).toBe(lines);
		});
	});

	describe("renderCluster", () => {
		it("renders and concatenates all cluster components", () => {
			const cluster = {
				status: makeComponent(["status"]),
				aboveWidget: makeComponent(["above"]),
				editor: makeComponent(["editor-line"]),
				belowWidget: makeComponent(["below"]),
				footer: makeComponent(["footer"]),
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.lines).toEqual(["status", "above", "editor-line", "below", "footer"]);
		});

		it("extracts cursor position", () => {
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeComponent([`hello${CURSOR_MARKER}world`]),
				belowWidget: null,
				footer: null,
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.cursor).toEqual({ row: 0, col: 5 });
			expect(result.lines[0]).toBe("helloworld");
		});

		it("caps editor lines when total exceeds maxHeight", () => {
			const manyLines = Array.from({ length: 30 }, (_, i) => `ed-${i}`);
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeComponent(manyLines),
				belowWidget: null,
				footer: null,
			};
			// maxHeight = 10, maxRows = 9, so editor gets max 9 lines
			const result = renderCluster(cluster, 80, 10);
			expect(result.lines.length).toBeLessThanOrEqual(9);
		});

		it("preserves internal blank lines (copy-friendly editor padding)", () => {
			// In copy-friendly mode the editor renders truly empty strings as
			// padding: [border, "", text, "", meta, border]. These must survive.
			const editorFrame = ["border", "", "input text", "", "model provider", "border"];
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeComponent(editorFrame),
				belowWidget: null,
				footer: null,
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.lines).toEqual(editorFrame);
		});

		it("strips trailing blank lines from components", () => {
			const cluster = {
				status: makeComponent(["status", "", ""]),
				aboveWidget: null,
				editor: makeComponent(["editor"]),
				belowWidget: null,
				footer: makeComponent(["footer", ""]),
			};
			const result = renderCluster(cluster, 80, 24);
			// Trailing blanks stripped, but content preserved
			expect(result.lines).toEqual(["status", "editor", "footer"]);
		});
	});

	describe("hideRenderable / restoreRenderable", () => {
		it("patches render to return [] and saves original", () => {
			const comp: {
				render(width: number): string[];
				__zentuiOriginalRender?: (w: number) => string[];
			} = {
				render: () => ["real", "lines"],
			};
			hideRenderable(comp);
			expect(comp.render(80)).toEqual([]);
			expect(comp.__zentuiOriginalRender).toBeDefined();
			expect(comp.__zentuiOriginalRender?.(80)).toEqual(["real", "lines"]);
		});

		it("restores original render on restoreRenderable", () => {
			const comp: {
				render(width: number): string[];
				__zentuiOriginalRender?: (w: number) => string[];
			} = {
				render: () => ["real", "lines"],
			};
			hideRenderable(comp);
			restoreRenderable(comp);
			expect(comp.render(80)).toEqual(["real", "lines"]);
			expect(comp.__zentuiOriginalRender).toBeUndefined();
		});

		it("is idempotent (double-hide does not overwrite original)", () => {
			const comp: {
				render(width: number): string[];
				__zentuiOriginalRender?: (w: number) => string[];
			} = {
				render: () => ["real"],
			};
			hideRenderable(comp);
			hideRenderable(comp);
			expect(comp.__zentuiOriginalRender?.(80)).toEqual(["real"]);
		});

		it("handles null gracefully", () => {
			hideRenderable(null);
			restoreRenderable(null);
		});
	});
});

describe("selection", () => {
	describe("SelectionState", () => {
		it("starts and tracks selection", () => {
			const sel = new SelectionState();
			expect(sel.active).toBe(false);
			sel.start(5, 3);
			expect(sel.active).toBe(true);
			sel.extend(7, 10);
			expect(sel.active).toBe(true);
		});

		it("clears selection", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.clear();
			expect(sel.active).toBe(false);
		});

		it("getRangeForLine returns correct range", () => {
			const sel = new SelectionState();
			sel.start(2, 3);
			sel.extend(5, 8);
			// Line 1 is before selection
			expect(sel.getRangeForLine(1)).toBeNull();
			// Line 2 is start: cols 3..inf
			const r2 = sel.getRangeForLine(2);
			expect(r2?.startCol).toBe(3);
			expect(r2?.endCol).toBe(Number.POSITIVE_INFINITY);
			// Line 3 is middle: cols 0..inf
			const r3 = sel.getRangeForLine(3);
			expect(r3?.startCol).toBe(0);
			expect(r3?.endCol).toBe(Number.POSITIVE_INFINITY);
			// Line 5 is end: cols 0..8
			const r5 = sel.getRangeForLine(5);
			expect(r5?.startCol).toBe(0);
			expect(r5?.endCol).toBe(8);
			// Line 6 is after selection
			expect(sel.getRangeForLine(6)).toBeNull();
		});

		it("getSelectedText extracts text from lines", () => {
			const sel = new SelectionState();
			const lines = ["hello world", "foo bar baz", "qux"];
			sel.start(0, 2);
			sel.extend(1, 7);
			expect(sel.getSelectedText(lines)).toBe("llo world\nfoo bar");
		});

		it("getSelectedText returns empty for single point", () => {
			const sel = new SelectionState();
			sel.start(0, 3);
			sel.extend(0, 3);
			expect(sel.getSelectedText(["hello"])).toBe("");
		});

		it("getSelectedText strips ANSI codes", () => {
			const sel = new SelectionState();
			const lines = ["\x1b[32mhello\x1b[0m world"];
			sel.start(0, 0);
			sel.extend(0, 8);
			expect(sel.getSelectedText(lines)).toBe("hello wo");
		});

		it("handles reverse selection (drag upward)", () => {
			const sel = new SelectionState();
			const lines = ["line0", "line1", "line2"];
			sel.start(2, 3);
			sel.extend(0, 2);
			// Normalized: start=(0,2) end=(2,3)
			expect(sel.getSelectedText(lines)).toBe("ne0\nline1\nlin");
		});
	});

	describe("highlightSelection", () => {
		it("applies inverse video to selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 2);
			sel.extend(0, 5);
			const result = highlightSelection("hello world", 0, sel);
			expect(result).toContain("\x1b[7m");
			expect(result).toContain("\x1b[27m");
			expect(result).toBe("he\x1b[7mllo\x1b[27m world");
		});

		it("does not modify non-selected lines", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 3);
			const result = highlightSelection("hello", 5, sel);
			expect(result).toBe("hello");
		});

		it("highlights full line for middle lines", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(2, 5);
			// Line 1 is a middle line — full highlight
			const result = highlightSelection("middle line", 1, sel);
			expect(result).toBe("\x1b[7mmiddle line\x1b[27m");
		});

		it("preserves ANSI colors in selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 5);
			const result = highlightSelection("\x1b[32mhello\x1b[0m world", 0, sel);
			expect(result).toContain("\x1b[32m"); // green preserved
			expect(result).toContain("\x1b[7m"); // inverse added
			expect(result).toContain("\x1b[27m"); // inverse off
			expect(result).toContain("\x1b[0m"); // original reset preserved
			expect(result).toContain("hello");
			expect(result).toContain("world");
		});

		it("preserves ANSI colors outside selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 6);
			sel.extend(0, 11);
			const result = highlightSelection("\x1b[32mhello\x1b[0m world", 0, sel);
			expect(result).toContain("\x1b[32mhello\x1b[0m"); // before selection unchanged
			expect(result).toContain("\x1b[7m"); // inverse on selected part
		});

		it("handles multiple SGR codes within selection", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 11);
			const input = "\x1b[1m\x1b[31mhello\x1b[0m world";
			const result = highlightSelection(input, 0, sel);
			expect(result).toContain("\x1b[1m"); // bold preserved
			expect(result).toContain("\x1b[31m"); // red preserved
			expect(result).toContain("\x1b[7m"); // inverse added
			expect(result).toContain("\x1b[27m"); // inverse off
		});
	});

	describe("getSelectedText edge cases", () => {
		it("extracts URL from OSC 8 hyperlink", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://pi.dev/changelog\x1b\\Changelog:\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://pi.dev/changelog");
			expect(result).toContain("Changelog:");
		});

		it("handles OSC 8 with BEL terminator", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://example.com");
		});

		it("handles OSC 8 with id parameter", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;id=42;https://example.com\x1b\\link\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://example.com");
			expect(result).not.toContain("id=42");
		});

		it("does not duplicate URL when visible text is the URL", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://example.com\x1b\\https://example.com\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toBe("https://example.com");
		});

		it("handles OSC 8 with empty params (no URL)", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;\x1b\\plain text\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toBe("plain text");
		});

		it("handles multiple OSC 8 links on one line", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line =
				"\x1b]8;;https://a.com\x1b\\A\x1b]8;;\x1b\\ and \x1b]8;;https://b.com\x1b\\B\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://a.com");
			expect(result).toContain("https://b.com");
		});

		it("preserves ANSI colors inside OSC 8 text", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://example.com\x1b\\\x1b[32mClick\x1b[0m\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("Click");
			expect(result).toContain("https://example.com");
			expect(result).not.toContain("\x1b[32m");
		});
	});
});
