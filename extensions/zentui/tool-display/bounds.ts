import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
export type CodeHighlighter = (text: string, path?: string) => string;
export function safeWidth(width: number): number {
	return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}
export const MAX_PREVIEW_LINE_CHARS = 16_384;
/** Row chrome (prompt, shell/timeout suffix) is capped separately; leave room for it. */
const ROW_CHROME_ALLOWANCE = 128;

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
/** Cut a colored row without ever splitting an ANSI escape sequence. */
export function safeAnsiSlice(text: string, limit: number): string {
	if (text.length <= limit) return text;
	let cut = Math.max(0, limit);
	const escapeIndex = text.lastIndexOf("\x1b", cut - 1);
	// Only a sequence opening just before the cut can be split by it.
	if (escapeIndex >= 0 && cut - escapeIndex < 32) {
		const body = text.slice(escapeIndex, Math.min(text.length, escapeIndex + 32));
		const sequence = /^\x1b\[[0-9;]*[A-Za-z]/.exec(body);
		if (!sequence || escapeIndex + sequence[0].length > cut) cut = escapeIndex;
	}
	return text.slice(0, cut);
}
/** Bound input before the host wrapper allocates visual rows. */
export function boundedWrap(
	text: string,
	width: number,
	maxRows: number,
	wrap: boolean,
): { lines: string[]; capped: boolean } {
	if (width <= 0 || maxRows <= 0) return { lines: [], capped: text.length > 0 };
	const columns = Math.min(
		MAX_PREVIEW_LINE_CHARS + ROW_CHROME_ALLOWANCE,
		width * (wrap ? maxRows : 1),
	);
	// Every visible byte may carry an SGR run; budget bytes per visible column so a
	// dense colored row is bounded by visible width, never by an escape mid-sequence.
	const input = safeAnsiSlice(text, Math.max(65_536, columns * 64));
	const clipped = truncateToWidth(input, columns, "");
	const wrapped = wrap ? wrapTextWithAnsi(clipped, width) : [clipped];
	const capped =
		input.length < text.length ||
		visibleWidth(input) > columns ||
		(wrap && wrapped.length > maxRows);
	const lines = wrap ? wrapped.slice(0, maxRows) : wrapped;
	return { lines: lines.length ? lines : [""], capped };
}
