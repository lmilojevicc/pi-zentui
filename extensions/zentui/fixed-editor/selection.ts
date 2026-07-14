/**
 * Drag-to-select state, highlight rendering, and text extraction.
 *
 * The selection operates on raw transcript lines (ANSI-styled strings).
 * Highlight uses SGR 7 (inverse video) / SGR 27 (inverse off).
 *
 * @internal
 */

import { visibleWidth } from "@earendil-works/pi-tui";

/** ANSI / OSC escape sequence patterns for stripping. */
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_RE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

function stripAnsi(line: string): string {
	return line.replace(OSC_RE, "").replace(ANSI_RE, "");
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Slice text by visible column boundaries (grapheme-aware). */
function sliceColumns(text: string, startCol: number, endCol: number): string {
	let col = 0;
	let result = "";
	for (const { segment } of graphemeSegmenter.segment(text)) {
		const width = Math.max(0, visibleWidth(segment));
		if (col >= startCol && col < endCol) result += segment;
		col += width;
	}
	return result;
}

function comparePoints(a: { line: number; col: number }, b: { line: number; col: number }): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

/** Track an in-progress drag selection over transcript lines. */
export class SelectionState {
	private anchor: { line: number; col: number } | null = null;
	private focus: { line: number; col: number } | null = null;
	private dragging = false;

	start(line: number, col: number): void {
		this.anchor = { line, col };
		this.focus = { line, col };
		this.dragging = true;
	}

	extend(line: number, col: number): void {
		this.focus = { line, col };
	}

	clear(): void {
		this.anchor = null;
		this.focus = null;
		this.dragging = false;
	}

	get active(): boolean {
		return this.anchor !== null && this.focus !== null;
	}

	get isDragging(): boolean {
		return this.dragging;
	}

	setDragging(value: boolean): void {
		this.dragging = value;
	}

	/** Get the normalized (start ≤ end) selection bounds. */
	private get bounds(): {
		start: { line: number; col: number };
		end: { line: number; col: number };
	} | null {
		if (!this.anchor || !this.focus) return null;
		return comparePoints(this.anchor, this.focus) <= 0
			? { start: this.anchor, end: this.focus }
			: { start: this.focus, end: this.anchor };
	}

	/** Get column range for a given line index, or null if line is not selected. */
	getRangeForLine(lineIndex: number): { startCol: number; endCol: number } | null {
		const b = this.bounds;
		if (!b) return null;
		if (lineIndex < b.start.line || lineIndex > b.end.line) return null;
		return {
			startCol: lineIndex === b.start.line ? b.start.col : 0,
			endCol: lineIndex === b.end.line ? b.end.col : Number.POSITIVE_INFINITY,
		};
	}

	/**
	 * Extract selected text from raw lines.
	 * @param lines Full array of transcript lines (ANSI-styled).
	 * @returns Stripped text, or "" if selection is empty.
	 */
	getSelectedText(lines: string[]): string {
		const b = this.bounds;
		if (!b) return "";
		if (b.start.line === b.end.line && b.start.col === b.end.col) return "";

		const selected: string[] = [];
		for (let i = b.start.line; i <= b.end.line; i++) {
			const plain = stripAnsi(lines[i] ?? "");
			const startCol = i === b.start.line ? b.start.col : 0;
			const endCol = i === b.end.line ? b.end.col : Number.POSITIVE_INFINITY;
			selected.push(sliceColumns(plain, startCol, endCol));
		}
		return selected
			.join("\n")
			.replace(/[ \t]+$/gm, "")
			.trimEnd();
	}
}

/**
 * Apply inverse-video highlight to a rendered line for the current selection.
 * Preserves all original ANSI styling (colors, bold, etc.) — only layers
 * SGR 7 (inverse) / SGR 27 (inverse off) on top of the selected range.
 *
 * @param line The raw ANSI-styled line.
 * @param lineIndex The absolute transcript line index.
 * @param selection Current selection state.
 */
export function highlightSelection(
	line: string,
	lineIndex: number,
	selection: SelectionState,
): string {
	const range = selection.getRangeForLine(lineIndex);
	if (!range) return line;

	const maxCol = visibleWidth(line);
	const startCol = Math.max(0, Math.min(range.startCol, maxCol));
	const endCol = Math.max(startCol + 1, Math.min(range.endCol, maxCol));
	if (startCol >= endCol) return line;

	let result = "";
	let col = 0;
	let inverseOn = false;
	let i = 0;

	while (i < line.length) {
		// Escape sequence — pass through, does not consume visible columns.
		if (line[i] === "\x1b") {
			if (line[i + 1] === "[") {
				// CSI: \x1b[...final-byte
				let j = i + 2;
				while (j < line.length && !/[@-~]/.test(line[j] ?? "")) j++;
				j++;
				result += line.slice(i, j);
				i = j;
				continue;
			}
			if (line[i + 1] === "]") {
				// OSC: \x1b]...BEL or \x1b]...ST
				let j = i + 2;
				while (
					j < line.length &&
					line[j] !== "\x07" &&
					!(line[j] === "\x1b" && line[j + 1] === "\\")
				)
					j++;
				if (line[j] === "\x07") j++;
				else j += 2;
				result += line.slice(i, j);
				i = j;
				continue;
			}
			// Other escape: ESC + single char
			result += line.slice(i, i + 2);
			i += 2;
			continue;
		}

		// Visible character.
		const char = line[i] ?? "";
		const w = visibleWidth(char);
		if (!inverseOn && col < endCol && col + w > startCol) {
			result += "\x1b[7m";
			inverseOn = true;
		}
		if (inverseOn && col >= endCol) {
			result += "\x1b[27m";
			inverseOn = false;
		}
		result += char;
		col += w;
		i++;
	}

	if (inverseOn) result += "\x1b[27m";
	return result;
}
