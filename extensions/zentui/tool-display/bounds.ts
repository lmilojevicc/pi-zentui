import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
export type CodeHighlighter = (text: string, path?: string) => string;
export function safeWidth(width: number): number {
	return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}
export const MAX_PREVIEW_LINE_CHARS = 16_384;

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
