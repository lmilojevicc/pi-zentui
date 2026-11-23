/**
 * Editing behavior adapted from pi-ghostty-native-editor v0.1.1.
 * Copyright (c) 2026 Kaspars Dancis. See mac-prompt-editor.LICENSE.
 * Zentui owns the frame, theme and mouse-coordinate translation.
 */
import { CustomEditor, copyToClipboard } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	decodeKittyPrintable,
	getKeybindings,
	type KeyId,
	matchesKey,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	visibleWidth,
} from "@earendil-works/pi-tui";

type Pos = { line: number; col: number };
type VisualLine = { logicalLine: number; startCol: number; length: number };
type Snapshot = { state: EditorState; pastes: Map<number, string>; pasteCounter: number };
type EditorState = { lines: string[]; cursorLine: number; cursorCol: number };

/** Base Editor internals (TypeScript-private, but reachable at runtime). */
interface Internals {
	state: EditorState;
	pastes: Map<number, string>;
	pasteCounter: number;
	lastWidth: number;
	scrollOffset: number;
	renderedVisibleLineCount: number;
	paddingX: number;
	isInPaste: boolean;
	jumpMode: "forward" | "backward" | null;
	lastAction: string | null;
	preferredVisualCol: number | null;
	autocompleteState: unknown;
	undoStack: { push(s: Snapshot): void; pop(): Snapshot | undefined; length: number };
	pushUndoSnapshot(): void;
	undo(): void;
	submitValue(): void;
	addNewLine(): void;
	setCursorCol(col: number): void;
	moveCursor(dLine: number, dCol: number): void;
	moveWordBackwards(): void;
	moveWordForwards(): void;
	exitHistoryBrowsing(): void;
	cancelAutocomplete(): void;
	updateAutocomplete(): void;
	expandPasteMarkers(text: string): string;
	buildVisualLineMap(width: number): VisualLine[];
	findVisualLineAt(vls: VisualLine[], line: number, col: number): number;
	segment(text: string, mode: "grapheme" | "word"): Iterable<Intl.SegmentData>;
}

const cmp = (a: Pos, b: Pos) => a.line - b.line || a.col - b.col;

export class MacPromptEditor extends CustomEditor {
	private anchor: Pos | null = null;
	/** Text at the time the selection was last updated; any other change drops the selection. */
	private anchorText = "";
	private redoStack: Snapshot[] = [];
	private suppressUndo = false;
	/** Skip the snapshot handlePaste pushes when the paste replaces a selection (one undo step). */
	private skipNextPasteSnapshot = false;
	private dragging = false;
	private readonly macEditing: boolean;
	private readonly I = this as unknown as Internals;

	constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		theme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		private readonly highlight?: (text: string) => string,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		const I = this.I;
		this.macEditing =
			Boolean(highlight) &&
			Boolean(I.state?.lines) &&
			typeof I.pushUndoSnapshot === "function" &&
			typeof I.submitValue === "function" &&
			typeof I.buildVisualLineMap === "function" &&
			typeof I.findVisualLineAt === "function" &&
			typeof I.segment === "function" &&
			typeof I.setCursorCol === "function";
		if (!this.macEditing) return;

		// Hook undo snapshots: support one-shot suppression (atomic replace) and clear redo on new edits.
		const basePush = I.pushUndoSnapshot.bind(this);
		I.pushUndoSnapshot = () => {
			if (this.suppressUndo) return;
			if (this.skipNextPasteSnapshot) {
				this.skipNextPasteSnapshot = false;
				return;
			}
			basePush();
			this.redoStack.length = 0;
		};
		const baseUndo = I.undo.bind(this);
		I.undo = () => {
			if (I.undoStack.length > 0) this.redoStack.push(this.snapshot());
			baseUndo();
			this.anchor = null;
		};
		const baseSubmit = I.submitValue.bind(this);
		I.submitValue = () => {
			this.anchor = null;
			this.redoStack.length = 0;
			baseSubmit();
		};
	}

	// ── selection model ────────────────────────────────────────────────

	private cursor(): Pos {
		return { line: this.I.state.cursorLine, col: this.I.state.cursorCol };
	}

	private setCursor(p: Pos): void {
		this.I.state.cursorLine = p.line;
		this.I.setCursorCol(p.col);
	}

	private selection(): { start: Pos; end: Pos } | null {
		if (!this.anchor) return null;
		if (this.getText() !== this.anchorText) {
			this.anchor = null;
			return null;
		}
		const c = this.cursor();
		const d = cmp(this.anchor, c);
		if (d === 0) return null;
		return d < 0 ? { start: this.anchor, end: c } : { start: c, end: this.anchor };
	}

	private setAnchor(p: Pos | null): void {
		this.anchor = p ? { ...p } : null;
		this.anchorText = this.getText();
	}

	private selectedText(): string {
		const sel = this.selection();
		if (!sel) return "";
		const { lines } = this.I.state;
		const { start, end } = sel;
		const text =
			start.line === end.line
				? (lines[start.line] ?? "").slice(start.col, end.col)
				: [
						(lines[start.line] ?? "").slice(start.col),
						...lines.slice(start.line + 1, end.line),
						(lines[end.line] ?? "").slice(0, end.col),
					].join("\n");
		return this.I.expandPasteMarkers(text);
	}

	/** Delete the selection as one undo step. Returns false when nothing is selected. */
	private deleteSelection(): boolean {
		const sel = this.selection();
		if (!sel) return false;
		const I = this.I;
		I.exitHistoryBrowsing();
		I.pushUndoSnapshot();
		const { start, end } = sel;
		const lines = I.state.lines;
		const merged =
			(lines[start.line] ?? "").slice(0, start.col) + (lines[end.line] ?? "").slice(end.col);
		lines.splice(start.line, end.line - start.line + 1, merged);
		this.setCursor(start);
		I.lastAction = null;
		this.anchor = null;
		this.onChange?.(this.getText());
		if (I.autocompleteState) I.updateAutocomplete();
		return true;
	}

	/** Replace the selection with whatever `insert` inserts, as one undo step. */
	private replaceSelection(insert: () => void): void {
		this.deleteSelection();
		this.suppressUndo = true;
		try {
			insert();
		} finally {
			this.suppressUndo = false;
		}
	}

	private snapshot(): Snapshot {
		return structuredClone({
			state: this.I.state,
			pastes: this.I.pastes,
			pasteCounter: this.I.pasteCounter,
		});
	}

	private redo(): void {
		const snap = this.redoStack.pop();
		if (!snap) return;
		const I = this.I;
		I.undoStack.push(this.snapshot());
		Object.assign(I.state, snap.state);
		I.pastes = snap.pastes;
		I.pasteCounter = snap.pasteCounter;
		I.lastAction = null;
		I.preferredVisualCol = null;
		this.anchor = null;
		this.onChange?.(this.getText());
	}

	private copy(cut: boolean): void {
		const text = this.selectedText();
		if (!text) return;
		copyToClipboard(text).catch(() => {});
		if (cut) this.deleteSelection();
	}

	private docEnd(): Pos {
		const lines = this.I.state.lines;
		return { line: lines.length - 1, col: lines.at(-1)?.length ?? 0 };
	}

	// ── cursor motions (shared by plain and shift variants) ────────────

	private motions(): Record<string, () => void> {
		const I = this.I;
		const vertical = (dir: -1 | 1) => () => {
			const vls = I.buildVisualLineMap(I.lastWidth);
			const cur = I.findVisualLineAt(vls, I.state.cursorLine, I.state.cursorCol);
			if (dir < 0 && cur === 0) this.setCursor({ line: 0, col: 0 });
			else if (dir > 0 && cur === vls.length - 1) this.setCursor(this.docEnd());
			else I.moveCursor(dir, 0);
		};
		return {
			left: () => I.moveCursor(0, -1),
			right: () => I.moveCursor(0, 1),
			up: vertical(-1),
			down: vertical(1),
			wordLeft: () => I.moveWordBackwards(),
			wordRight: () => I.moveWordForwards(),
			lineStart: () => this.moveToVisualEdge(false),
			lineEnd: () => this.moveToVisualEdge(true),
			paragraphUp: () => this.moveToParagraphEdge(false),
			paragraphDown: () => this.moveToParagraphEdge(true),
			docStart: () => this.setCursor({ line: 0, col: 0 }),
			docEnd: () => this.setCursor(this.docEnd()),
		};
	}

	/** Move to a screen line edge, not the edge of the unwrapped paragraph. */
	private moveToVisualEdge(end: boolean): void {
		const I = this.I;
		const rows = I.buildVisualLineMap(I.lastWidth);
		const index = I.findVisualLineAt(rows, I.state.cursorLine, I.state.cursorCol);
		const row = rows[index];
		if (!row) return;
		this.setCursor({ line: row.logicalLine, col: row.startCol + (end ? row.length : 0) });
	}

	private moveToParagraphEdge(end: boolean): void {
		const { lines, cursorLine, cursorCol } = this.I.state;
		const lineEnd = lines[cursorLine]?.length ?? 0;
		const adjacent = end ? cursorCol === lineEnd : cursorCol === 0;
		const line = adjacent
			? Math.max(0, Math.min(lines.length - 1, cursorLine + (end ? 1 : -1)))
			: cursorLine;
		this.setCursor({ line, col: end ? (lines[line]?.length ?? 0) : 0 });
	}

	private static readonly EXTEND_KEYS: [KeyId, string][] = [
		["shift+left", "left"],
		["shift+right", "right"],
		["shift+up", "up"],
		["shift+down", "down"],
		["alt+shift+left", "wordLeft"],
		["alt+shift+right", "wordRight"],
		["alt+shift+up", "paragraphUp"],
		["alt+shift+down", "paragraphDown"],
		["ctrl+shift+left", "wordLeft"],
		["ctrl+shift+right", "wordRight"],
		["shift+home", "lineStart"],
		["shift+end", "lineEnd"],
		["super+shift+left", "lineStart"],
		["super+shift+right", "lineEnd"],
		["super+shift+up", "docStart"],
		["super+shift+down", "docEnd"],
		["ctrl+shift+home", "docStart"],
		["ctrl+shift+end", "docEnd"],
	];

	private static readonly MOVE_KEYS: [KeyId, string][] = [
		["super+left", "lineStart"],
		["super+right", "lineEnd"],
		["ctrl+a", "lineStart"], // Herdr sends this for Cmd+Left.
		["ctrl+e", "lineEnd"], // Herdr sends this for Cmd+Right.
		["alt+up", "paragraphUp"],
		["alt+down", "paragraphDown"],
		["super+up", "docStart"],
		["super+down", "docEnd"],
	];

	// ── keyboard ───────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (!this.macEditing) {
			super.handleInput(data);
			return;
		}
		this.handleKey(data);
	}

	private handleKey(data: string): void {
		const I = this.I;
		const kb = getKeybindings();

		// Paste: replace the selection with the pasted text.
		if (I.isInPaste || I.jumpMode !== null) {
			super.handleInput(data);
			return;
		}
		if (data.includes("\x1b[200~")) {
			// Bracketed paste may arrive in several chunks. The snapshot taken by deleteSelection
			// covers the whole replacement, so skip the one handlePaste pushes when it completes.
			if (this.deleteSelection()) this.skipNextPasteSnapshot = true;
			this.anchor = null;
			super.handleInput(data);
			return;
		}

		const motions = this.motions();
		const finishMove = () => {
			I.lastAction = null;
			if (I.autocompleteState) I.cancelAutocomplete();
			this.tui.requestRender();
		};

		// Extend selection.
		for (const [key, motion] of MacPromptEditor.EXTEND_KEYS) {
			if (matchesKey(data, key)) {
				if (!this.selection()) this.setAnchor(this.cursor());
				motions[motion]?.();
				this.anchorText = this.getText();
				finishMove();
				return;
			}
		}

		// Cmd motions (no selection).
		for (const [key, motion] of MacPromptEditor.MOVE_KEYS) {
			if (matchesKey(data, key)) {
				this.anchor = null;
				motions[motion]?.();
				finishMove();
				return;
			}
		}

		const sel = this.selection();

		// Commands.
		if (matchesKey(data, "super+a")) {
			this.setAnchor({ line: 0, col: 0 });
			this.setCursor(this.docEnd());
			finishMove();
			return;
		}
		if (matchesKey(data, "super+c") || (sel && kb.matches(data, "tui.input.copy"))) {
			this.copy(false);
			return;
		}
		if (matchesKey(data, "super+x")) {
			this.copy(true);
			return;
		}
		if (matchesKey(data, "super+z")) {
			I.undo();
			return;
		}
		if (matchesKey(data, "super+shift+z") || matchesKey(data, "super+y")) {
			this.redo();
			return;
		}
		if (matchesKey(data, "super+backspace") || matchesKey(data, "super+u")) {
			if (!this.deleteSelection()) super.handleInput("\x15"); // ctrl+u
			return;
		}

		if (matchesKey(data, "super+delete")) {
			if (!this.deleteSelection()) super.handleInput("\x0b"); // ctrl+k
			return;
		}
		if (!sel) {
			super.handleInput(data);
			return;
		}

		// ── there is a non-empty selection ──

		if (matchesKey(data, "escape")) {
			this.anchor = null;
			this.tui.requestRender();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLeft") || kb.matches(data, "tui.editor.cursorRight")) {
			this.setCursor(kb.matches(data, "tui.editor.cursorLeft") ? sel.start : sel.end);
			this.anchor = null;
			finishMove();
			return;
		}

		const deletes = [
			"tui.editor.deleteCharBackward",
			"tui.editor.deleteCharForward",
			"tui.editor.deleteWordBackward",
			"tui.editor.deleteWordForward",
			"tui.editor.deleteToLineStart",
			"tui.editor.deleteToLineEnd",
		] as const;
		if (
			deletes.some((id) => kb.matches(data, id)) ||
			matchesKey(data, "shift+backspace") ||
			matchesKey(data, "shift+delete")
		) {
			this.deleteSelection();
			return;
		}

		if (this.isInsertion(data, kb)) {
			this.replaceSelection(() => super.handleInput(data));
			return;
		}

		// Anything else (submit, history, app shortcuts, …): drop the selection and pass through.
		this.anchor = null;
		super.handleInput(data);
	}

	private isInsertion(data: string, kb: ReturnType<typeof getKeybindings>): boolean {
		if (kb.matches(data, "tui.input.submit")) return false;
		if (
			kb.matches(data, "tui.input.newLine") ||
			data === "\x1b\r" ||
			data === "\x1b[13;2~" ||
			data === "\n" ||
			matchesKey(data, "shift+space")
		)
			return true;
		if (decodeKittyPrintable(data) !== undefined) return true;
		const c = data.charCodeAt(0);
		return c >= 32 && c !== 127 && !data.includes("\x1b");
	}

	// ── mouse ──────────────────────────────────────────────────────────

	private paddingFor(width: number): number {
		return Math.min(this.I.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
	}

	/** Map local mouse coordinates (y = 1 is the first text row) to a text position. */
	private posAt(x: number, y: number, width: number): Pos {
		const I = this.I;
		const vls = I.buildVisualLineMap(I.lastWidth);
		const idx = Math.max(0, Math.min(vls.length - 1, I.scrollOffset + y - 1));
		const vl = vls[idx];
		if (!vl) return this.cursor();
		const line = I.state.lines[vl.logicalLine] ?? "";
		const chunk = line.slice(vl.startCol, vl.startCol + vl.length);
		const target = Math.max(0, x - this.paddingFor(width));
		let column = 0;
		let index = chunk.length;
		let lastIndex = 0;
		for (const g of I.segment(chunk, "grapheme")) {
			const w = visibleWidth(g.segment);
			lastIndex = g.index;
			if (target < column + w) {
				// Snap to the nearer edge of the grapheme, like native text fields.
				index = target - column >= w / 2 && w > 1 ? g.index + g.segment.length : g.index;
				break;
			}
			column += w;
		}
		const isLastSegment = idx === vls.length - 1 || vls[idx + 1]?.logicalLine !== vl.logicalLine;
		if (!isLastSegment && index >= chunk.length && chunk.length > 0) index = lastIndex;
		return { line: vl.logicalLine, col: vl.startCol + index };
	}

	private selectWordAt(p: Pos): void {
		const line = this.I.state.lines[p.line] ?? "";
		for (const s of this.I.segment(line, "word")) {
			const end = s.index + s.segment.length;
			if (p.col >= s.index && (p.col < end || end === line.length)) {
				this.setAnchor({ line: p.line, col: s.index });
				this.setCursor({ line: p.line, col: end });
				return;
			}
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const I = this.I;
		if (!this.macEditing) return super.handleMouse?.(event);
		const textRows = I.renderedVisibleLineCount;
		const inText = event.y >= 1 && event.y <= textRows;

		if (event.type === "press" && event.button === "left" && inText) {
			const p = this.posAt(event.x, event.y, event.width);
			I.exitHistoryBrowsing();
			I.lastAction = null;
			if (I.autocompleteState) I.cancelAutocomplete();
			if (event.shift) {
				if (!this.selection()) this.setAnchor(this.cursor());
			} else {
				this.setAnchor(p);
			}
			this.setCursor(p);
			this.anchorText = this.getText();
			this.dragging = true;
			return { capture: true, focus: true };
		}

		if (this.dragging && event.type === "drag") {
			// Rows above/below the visible text extend one line past it, so the view scrolls.
			const y = Math.max(0, Math.min(textRows + 1, event.y));
			this.setCursor(this.posAt(event.x, y, event.width));
			return { handled: true };
		}

		if (this.dragging && event.type === "release") {
			this.dragging = false;
			if (!this.selection()) this.anchor = null;
			return { handled: true, render: true };
		}

		if (event.type === "click" && event.button === "left" && inText) {
			const p = this.posAt(event.x, event.y, event.width);
			if (event.clickCount === 2) this.selectWordAt(p);
			else if (event.clickCount === 3) {
				const lines = I.state.lines;
				this.setAnchor({ line: p.line, col: 0 });
				this.setCursor(
					p.line < lines.length - 1
						? { line: p.line + 1, col: 0 }
						: { line: p.line, col: lines[p.line]?.length ?? 0 },
				);
			}
			return { handled: true, focus: true };
		}

		return super.handleMouse(event);
	}

	// ── rendering ──────────────────────────────────────────────────────

	render(width: number): string[] {
		const base = super.render(width);
		const highlight = this.highlight;
		if (!this.macEditing || !highlight) return base;
		const sel = this.selection();
		if (!sel) return base;
		const out = [...base];

		const I = this.I;
		const vls = I.buildVisualLineMap(I.lastWidth);
		const cursorVl = I.findVisualLineAt(vls, I.state.cursorLine, I.state.cursorCol);
		const paddingX = this.paddingFor(width);
		const contentWidth = Math.max(1, width - paddingX * 2);
		const pad = " ".repeat(paddingX);

		for (let row = 0; row < I.renderedVisibleLineCount; row++) {
			const idx = I.scrollOffset + row;
			const vl = vls[idx];
			if (!vl) continue;
			const L = vl.logicalLine;
			if (L < sel.start.line || L > sel.end.line) continue;

			const line = I.state.lines[L] ?? "";
			const text = line.slice(vl.startCol, vl.startCol + vl.length);
			const selFrom = Math.max(0, (L === sel.start.line ? sel.start.col : 0) - vl.startCol);
			const selTo = Math.min(
				text.length,
				(L === sel.end.line ? sel.end.col : Number.POSITIVE_INFINITY) - vl.startCol,
			);
			const isLastSegment = idx === vls.length - 1 || vls[idx + 1]?.logicalLine !== L;
			const newlineSelected = isLastSegment && L < sel.end.line;
			const hasCursor = idx === cursorVl;
			const cursorPos = hasCursor ? Math.min(I.state.cursorCol - vl.startCol, text.length) : -1;
			const marker = this.focused ? CURSOR_MARKER : "";

			let display = "";
			let run = "";
			const flush = () => {
				if (run) display += highlight(run);
				run = "";
			};
			for (const g of I.segment(text, "grapheme")) {
				const selected = g.index >= selFrom && g.index < selTo;
				if (g.index === cursorPos) {
					// Like native text fields, show no caret inside a selection; keep the marker for IME placement.
					flush();
					display += marker;
					if (selected) run += g.segment;
					else display += g.segment;
				} else if (selected) run += g.segment;
				else {
					flush();
					display += g.segment;
				}
			}
			flush();

			let w = visibleWidth(text);
			if (cursorPos === text.length) display += marker;
			if (newlineSelected && w < contentWidth) {
				display += highlight(" ");
				w += 1;
			}
			out[row + 1] = `${pad}${display}${" ".repeat(Math.max(0, contentWidth - w))}${pad}`;
		}
		return out;
	}
}
