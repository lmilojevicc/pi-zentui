import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { capEditorLines, renderCluster } from "../extensions/zentui/fixed-editor/cluster";
import { TerminalSplitCompositor } from "../extensions/zentui/fixed-editor/compositor";
import {
	clampScrollOffset,
	parseKeyboardScroll,
	parseMouseEvent,
	parseMouseScroll,
} from "../extensions/zentui/fixed-editor/input";
import {
	findEditorContainerIndex,
	inspectPiTui,
	type PiRenderableCapability,
} from "../extensions/zentui/fixed-editor/pi-compat";
import { highlightSelection, SelectionState } from "../extensions/zentui/fixed-editor/selection";
import {
	DISABLE_MOUSE,
	ENABLE_ALT_SCROLL,
	EXIT_ALT_SCREEN,
	emergencyTerminalReset,
	RESET_SCROLL_REGION,
	SHOW_CURSOR,
} from "../extensions/zentui/fixed-editor/terminal-modes";

function makeValidPiFixture() {
	let rawRows = 24;
	let inputListener:
		| ((data: string) => { consume?: boolean; data?: string } | undefined)
		| undefined;
	const removeInputListener = vi.fn();
	const terminalWrite = vi.fn();
	const makeRenderable = (label: string) => ({
		render(width: number) {
			return [`${label}:${width}`];
		},
	});
	const editorComponent = {
		getText: () => "",
		setText() {},
		handleInput() {},
	};
	const status = makeRenderable("status");
	const above = makeRenderable("above");
	const editor = { ...makeRenderable("editor"), children: [editorComponent] };
	const below = makeRenderable("below");
	const footer = makeRenderable("footer");
	const terminal = {
		columns: 80,
		rows: rawRows,
		write: terminalWrite,
	};
	Object.defineProperty(terminal, "rows", {
		configurable: true,
		enumerable: true,
		get: () => rawRows,
	});
	const rootRender = vi.fn((width: number) =>
		Array.from({ length: 30 }, (_, index) => `root-${index}:${width}`),
	);
	const doRender = vi.fn();
	const requestRender = vi.fn();
	const addInputListener = vi.fn(
		(listener: (data: string) => { consume?: boolean; data?: string } | undefined) => {
			inputListener = listener;
			return removeInputListener;
		},
	);
	const tui = {
		children: [status, above, editor, below, footer],
		focusedComponent: editorComponent,
		terminal,
		render: rootRender,
		doRender,
		requestRender,
		addInputListener,
		hasOverlay: () => false,
		overlayStack: [] as { hidden?: boolean }[],
		hardwareCursorRow: 4,
		previousViewportTop: 1,
	};
	return {
		tui,
		terminal,
		cluster: [status, above, editor, below, footer],
		terminalWrite,
		rootRender,
		doRender,
		requestRender,
		addInputListener,
		removeInputListener,
		getInputListener: () => inputListener,
		setRows: (rows: number) => {
			rawRows = rows;
		},
	};
}

describe("Pi fixed-editor compatibility", () => {
	it.each([
		[
			"terminal",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "terminal"),
		],
		[
			"terminal write",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "write"),
		],
		[
			"terminal rows",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "rows"),
		],
		[
			"terminal columns",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "columns"),
		],
		[
			"input listener",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "addInputListener"),
		],
		[
			"children",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "children"),
		],
		[
			"editor layout",
			(fixture: ReturnType<typeof makeValidPiFixture>) => {
				Reflect.set(fixture.tui.children[2], "children", []);
			},
		],
		[
			"render",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "render"),
		],
		[
			"doRender",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "doRender"),
		],
		[
			"overlay visibility",
			(fixture: ReturnType<typeof makeValidPiFixture>) => {
				Reflect.deleteProperty(fixture.tui, "hasOverlay");
				Reflect.deleteProperty(fixture.tui, "overlayStack");
			},
		],
		[
			"hardware cursor row",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "hardwareCursorRow"),
		],
		[
			"viewport top",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "previousViewportTop"),
		],
	] as const)("rejects a missing %s capability without side effects", (_name, removeCapability) => {
		const fixture = makeValidPiFixture();
		removeCapability(fixture);
		const render = fixture.tui.render;
		const doRender = fixture.tui.doRender;
		const write = fixture.terminal.write;

		expect(inspectPiTui(fixture.tui)).toBeUndefined();
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
		expect(fixture.addInputListener).not.toHaveBeenCalled();
		expect(fixture.tui.render).toBe(render);
		expect(fixture.tui.doRender).toBe(doRender);
		expect(fixture.terminal.write).toBe(write);
	});

	it("rejects non-configurable rows and non-writable render methods before writes", () => {
		const rowsFixture = makeValidPiFixture();
		const rowsDescriptor = Object.getOwnPropertyDescriptor(rowsFixture.terminal, "rows");
		Object.defineProperty(rowsFixture.terminal, "rows", { ...rowsDescriptor, configurable: false });
		expect(inspectPiTui(rowsFixture.tui)).toBeUndefined();
		expect(rowsFixture.terminalWrite).not.toHaveBeenCalled();

		const renderFixture = makeValidPiFixture();
		Object.defineProperty(renderFixture.tui, "render", {
			value: renderFixture.tui.render,
			configurable: true,
			writable: false,
		});
		expect(inspectPiTui(renderFixture.tui)).toBeUndefined();
		expect(renderFixture.terminalWrite).not.toHaveBeenCalled();

		const doRenderFixture = makeValidPiFixture();
		Object.defineProperty(doRenderFixture.tui, "doRender", {
			value: doRenderFixture.tui.doRender,
			configurable: true,
			writable: false,
		});
		expect(inspectPiTui(doRenderFixture.tui)).toBeUndefined();
		expect(doRenderFixture.terminalWrite).not.toHaveBeenCalled();

		const writeFixture = makeValidPiFixture();
		Object.defineProperty(writeFixture.terminal, "write", {
			value: writeFixture.terminal.write,
			configurable: true,
			writable: false,
		});
		expect(inspectPiTui(writeFixture.tui)).toBeUndefined();
		expect(writeFixture.terminalWrite).not.toHaveBeenCalled();

		const frozenFixture = makeValidPiFixture();
		Object.freeze(frozenFixture.tui.children[0]);
		expect(inspectPiTui(frozenFixture.tui)).toBeUndefined();
		expect(frozenFixture.terminalWrite).not.toHaveBeenCalled();
	});

	it("installs from verified capabilities and restores exact identities and descriptors", () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		expect(capabilities).toBeDefined();
		if (!capabilities) return;
		const render = fixture.tui.render;
		const doRender = fixture.tui.doRender;
		const write = fixture.terminal.write;
		const rowsDescriptor = Object.getOwnPropertyDescriptor(fixture.terminal, "rows");
		const clusterDescriptors = fixture.cluster.map((component) =>
			Object.getOwnPropertyDescriptor(component, "render"),
		);
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));

		expect(compositor.install()).toBe(true);
		expect(fixture.tui.render).not.toBe(render);
		expect(fixture.tui.doRender).not.toBe(doRender);
		expect(fixture.terminal.write).not.toBe(write);
		expect(fixture.cluster.every((component) => component.render(80).length === 0)).toBe(true);
		expect(fixture.addInputListener).toHaveBeenCalledTimes(1);
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(1);

		compositor.dispose();
		compositor.dispose();

		expect(fixture.tui.render).toBe(render);
		expect(fixture.tui.doRender).toBe(doRender);
		expect(fixture.terminal.write).toBe(write);
		expect(Object.getOwnPropertyDescriptor(fixture.terminal, "rows")).toEqual(rowsDescriptor);
		expect(
			fixture.cluster.map((component) => Object.getOwnPropertyDescriptor(component, "render")),
		).toEqual(clusterDescriptors);
		expect(fixture.removeInputListener).toHaveBeenCalledTimes(1);
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(2);
	});

	it("rolls back patches when listener registration does not return cleanup", () => {
		const fixture = makeValidPiFixture();
		Reflect.set(
			fixture.tui,
			"addInputListener",
			vi.fn(() => undefined),
		);
		const capabilities = inspectPiTui(fixture.tui);
		expect(capabilities).toBeDefined();
		if (!capabilities) return;
		const render = fixture.tui.render;
		const write = fixture.terminal.write;
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));

		expect(compositor.install()).toBe(false);
		expect(fixture.tui.render).toBe(render);
		expect(fixture.terminal.write).toBe(write);
		expect(fixture.cluster.every((component) => component.render(80).length > 0)).toBe(true);
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
	});

	it("keeps overlays visible and responds to rows, cursor, and wheel input", () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		const patchedRender = fixture.tui.render;
		const narrowRows = fixture.terminal.rows;
		fixture.setRows(40);
		expect(fixture.terminal.rows).toBeGreaterThan(narrowRows);

		fixture.tui.overlayStack = [{}];
		expect(patchedRender(80)).toEqual(fixture.rootRender(80));
		fixture.tui.overlayStack = [];
		fixture.setRows(12);
		patchedRender(80);
		fixture.terminal.write("update");
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toContain("\u001b[4;1H");
		fixture.requestRender.mockClear();
		fixture.getInputListener()?.("\u001b[<64;1;1M");
		expect(fixture.requestRender).toHaveBeenCalled();
		compositor.dispose();
	});

	it("clears the right-click mouse-resume timer on disposal", () => {
		vi.useFakeTimers();
		try {
			const fixture = makeValidPiFixture();
			const capabilities = inspectPiTui(fixture.tui);
			if (!capabilities) throw new Error("expected valid fixture");
			const compositor = new TerminalSplitCompositor(capabilities, () => ({
				enabled: true,
				mouseScroll: true,
				copyNotice: true,
			}));
			expect(compositor.install()).toBe(true);
			fixture.getInputListener()?.("\u001b[<2;1;1M");
			expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toContain(DISABLE_MOUSE);

			compositor.dispose();
			const writesAfterDispose = fixture.terminalWrite.mock.calls.length;
			vi.advanceTimersByTime(1_200);
			expect(fixture.terminalWrite).toHaveBeenCalledTimes(writesAfterDispose);
		} finally {
			vi.useRealTimers();
		}
	});
});

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

	function makeCapability(lines: string[]): PiRenderableCapability {
		const target = makeComponent(lines);
		return {
			target,
			render: target.render,
			ownDescriptor: Object.getOwnPropertyDescriptor(target, "render"),
		};
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
				status: makeCapability(["status"]),
				aboveWidget: makeCapability(["above"]),
				editor: makeCapability(["editor-line"]),
				belowWidget: makeCapability(["below"]),
				footer: makeCapability(["footer"]),
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.lines).toEqual(["status", "above", "editor-line", "below", "footer"]);
		});

		it("extracts cursor position", () => {
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeCapability([`hello${CURSOR_MARKER}world`]),
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
				editor: makeCapability(manyLines),
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
				editor: makeCapability(editorFrame),
				belowWidget: null,
				footer: null,
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.lines).toEqual(editorFrame);
		});

		it("strips trailing blank lines from components", () => {
			const cluster = {
				status: makeCapability(["status", "", ""]),
				aboveWidget: null,
				editor: makeCapability(["editor"]),
				belowWidget: null,
				footer: makeCapability(["footer", ""]),
			};
			const result = renderCluster(cluster, 80, 24);
			// Trailing blanks stripped, but content preserved
			expect(result.lines).toEqual(["status", "editor", "footer"]);
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
			expect(result).toContain("\x1b[48;5;238m");
			expect(result).toContain("\x1b[49m");
			expect(result).toBe("he\x1b[48;5;238mllo\x1b[49m world");
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
			expect(result).toBe("\x1b[48;5;238mmiddle line\x1b[49m");
		});

		it("preserves ANSI colors in selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 5);
			const result = highlightSelection("\x1b[32mhello\x1b[0m world", 0, sel);
			expect(result).toContain("\x1b[32m"); // green preserved
			expect(result).toContain("\x1b[48;5;238m"); // inverse added
			expect(result).toContain("\x1b[49m"); // inverse off
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
			expect(result).toContain("\x1b[48;5;238m"); // inverse on selected part
		});

		it("handles multiple SGR codes within selection", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 11);
			const input = "\x1b[1m\x1b[31mhello\x1b[0m world";
			const result = highlightSelection(input, 0, sel);
			expect(result).toContain("\x1b[1m"); // bold preserved
			expect(result).toContain("\x1b[31m"); // red preserved
			expect(result).toContain("\x1b[48;5;238m"); // inverse added
			expect(result).toContain("\x1b[49m"); // inverse off
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
