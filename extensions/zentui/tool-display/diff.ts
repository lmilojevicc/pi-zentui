// Compact/adaptive presentation follows pi-tool-display 0.5.0 (MIT); see attribution.
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { renderEditDiffResult } from "./diff-renderer.js";
import type { ToolDisplayConfig } from "./types.js";

export interface DiffLine {
	kind: "add" | "remove" | "context" | "meta";
	text: string;
	old?: string;
	next?: string;
}
export type DiffPresentation = "split" | "unified" | "compact" | "summary";
export type CodeHighlighter = (text: string, path?: string) => string;
export function safeWidth(width: number): number {
	return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}
export function cleanText(text: string): string {
	// Output is data, not terminal instructions. Host-owned theme/highlight ANSI is added later.
	return text
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
		.replace(/\t/g, "    ");
}

import { MAX_PREVIEW_LINE_CHARS } from "./source-bounds.js";

export { MAX_PREVIEW_LINE_CHARS } from "./source-bounds.js";
export function boundedContentLines(
	text: string,
	limit: number,
): { lines: string[]; capped: boolean } {
	const lines: string[] = [];
	let start = 0;
	while (start < text.length && lines.length < limit) {
		const end = text.indexOf("\n", start);
		lines.push(text.slice(start, end < 0 ? text.length : end).replace(/\r/g, ""));
		start = end < 0 ? text.length : end + 1;
	}
	return { lines, capped: start < text.length };
}
/** Bound input before the host wrapper allocates visual rows. */
export function boundedWrap(
	text: string,
	width: number,
	maxRows: number,
	wrap: boolean,
): { lines: string[]; capped: boolean } {
	if (width <= 0 || maxRows <= 0) return { lines: [], capped: text.length > 0 };
	const input = text.slice(0, 65_536);
	const columns = Math.min(MAX_PREVIEW_LINE_CHARS, width * (wrap ? maxRows : 1));
	const clipped = truncateToWidth(input, columns, "");
	const wrapped = wrap ? wrapTextWithAnsi(clipped, width) : [clipped];
	const capped =
		input.length < text.length ||
		visibleWidth(input) > columns ||
		(wrap && wrapped.length > maxRows);
	const lines = wrap ? wrapped.slice(0, maxRows) : wrapped;
	return { lines: lines.length ? lines : [""], capped };
}
export function contentLines(text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}
export function parseDiff(diff: string): DiffLine[] {
	let old: number | undefined;
	let next: number | undefined;
	let delta = 0;
	const input = boundedContentLines(diff.slice(0, 1024 * 1024), 8000);
	const parsed: DiffLine[] = input.lines.map((raw) => {
		const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(raw);
		if (hunk) {
			old = Number(hunk[1]);
			next = Number(hunk[2]);
			delta = next - old;
			return { kind: "meta", text: cleanText(raw) };
		}
		if (/^(---|\+\+\+|diff |index |\\)/.test(raw)) {
			if (/^(---|\+\+\+|diff )/.test(raw)) {
				old = undefined;
				next = undefined;
				delta = 0;
			}
			return { kind: "meta", text: cleanText(raw) };
		}
		const match = /^([+\- ])(?:\s*(\d+)(?:#([A-Za-z0-9]+| {2}):|\|| ))?(.*)$/.exec(raw);
		if (!match) return { kind: "meta", text: cleanText(raw) };
		const sign = match[1];
		const number = match[2] === undefined ? undefined : Number(match[2]);
		if (number !== undefined) {
			if (sign === "+") next ??= number;
			else {
				old = number;
				next = number + delta;
			}
		}
		old ??= 1;
		next ??= old + delta;
		const label = (cursor: number) => `${cursor}${match[3] ? `#${match[3]}` : ""}`;
		const line: DiffLine = {
			kind: sign === "+" ? "add" : sign === "-" ? "remove" : "context",
			text: cleanText(match[4]),
			old: sign !== "+" ? label(old) : undefined,
			next: sign !== "-" ? label(next) : undefined,
		};
		if (sign !== "+") old++;
		if (sign !== "-") next++;
		if (sign === "+") delta++;
		if (sign === "-") delta--;
		return line;
	});
	if (input.capped || diff.length > 1024 * 1024)
		parsed.push({ kind: "meta", text: "Diff preview capped; remaining input omitted." });
	return parsed;
}
/** Exact line transformation with bounded LCS work; larger changes use remove/add blocks. */
export function diffContents(before: string, after: string): DiffLine[] {
	const left = boundedContentLines(before, 4000);
	const right = boundedContentLines(after, 4000);
	if (left.capped || right.capped)
		return [{ kind: "meta", text: "Diff preview omitted (file exceeds 4000 lines)." }];
	const a = left.lines;
	const b = right.lines;
	const output: DiffLine[] = [];
	let i = 0;
	let j = 0;
	const push = (kind: DiffLine["kind"]) => {
		output.push({
			kind,
			text: cleanText(kind === "add" ? b[j] : a[i]),
			old: kind !== "add" ? String(i + 1) : undefined,
			next: kind !== "remove" ? String(j + 1) : undefined,
		});
		if (kind !== "add") i++;
		if (kind !== "remove") j++;
	};
	while (i < a.length && j < b.length && a[i] === b[j]) push("context");
	let endA = a.length;
	let endB = b.length;
	while (endA > i && endB > j && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const startI = i;
	const startJ = j;
	const n = endA - i;
	const m = endB - j;
	if ((n + 1) * (m + 1) <= 250_000) {
		const table = new Uint32Array((n + 1) * (m + 1));
		for (let x = n - 1; x >= 0; x--)
			for (let y = m - 1; y >= 0; y--)
				table[x * (m + 1) + y] =
					a[startI + x] === b[startJ + y]
						? 1 + table[(x + 1) * (m + 1) + y + 1]
						: Math.max(table[(x + 1) * (m + 1) + y], table[x * (m + 1) + y + 1]);
		while (i < endA && j < endB) {
			if (a[i] === b[j]) push("context");
			else if (
				table[(i - startI + 1) * (m + 1) + j - startJ] >=
				table[(i - startI) * (m + 1) + j - startJ + 1]
			)
				push("remove");
			else push("add");
		}
	}
	while (i < endA) push("remove");
	while (j < endB) push("add");
	while (i < a.length && j < b.length) push("context");
	return output;
}
/** Keep three context lines around generated changes instead of hiding edits below a long prefix. */
export function focusDiffContext(lines: readonly DiffLine[]): DiffLine[] {
	const selected = new Set<number>();
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].kind === "context") continue;
		for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) selected.add(j);
	}
	if (!selected.size) return [{ kind: "meta", text: "No content changes." }];
	const output: DiffLine[] = [];
	let last = -1;
	for (const index of [...selected].sort((a, b) => a - b)) {
		if (index > last + 1 && index > 0)
			output.push({ kind: "meta", text: `@@ ${index - last - 1} unchanged lines omitted @@` });
		output.push(lines[index]);
		last = index;
	}
	if (last < lines.length - 1)
		output.push({ kind: "meta", text: `@@ ${lines.length - last - 1} unchanged lines omitted @@` });
	return output;
}
export function resolveDiffPresentation(
	config: ToolDisplayConfig,
	width: number,
): DiffPresentation {
	const w = safeWidth(width);
	if (w < 8) return "summary";
	if (w < 18) return "compact";
	if (
		w >= 60 &&
		(config.diffViewMode === "split" ||
			(config.diffViewMode === "auto" && w >= config.diffSplitMinWidth))
	)
		return "split";
	return "unified";
}
/** Compatibility adapter for structured fixture rows; presentation is the actual upstream engine. */
export function diffComponent(
	lines: readonly DiffLine[],
	getConfig: () => ToolDisplayConfig,
	theme: Theme,
	expanded: boolean,
	options: { label?: string; path?: string; highlighter?: CodeHighlighter } = {},
): Component {
	const serialized = lines
		.map((line) => {
			if (line.kind === "meta") return line.text;
			const label = line.kind === "add" ? line.next : line.old;
			const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
			return `${marker}${label ?? ""}${label?.includes("#") ? ":" : "|"}${line.text}`;
		})
		.join("\n");
	return {
		invalidate() {},
		render(width) {
			return renderEditDiffResult(
				{ diff: serialized },
				{ expanded, filePath: options.path, highlighter: options.highlighter },
				getConfig(),
				theme,
				"",
			).render(width);
		},
	};
}
