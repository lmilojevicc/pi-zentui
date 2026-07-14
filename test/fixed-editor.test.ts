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
	parseMouseScroll,
} from "../extensions/zentui/fixed-editor/input";
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
