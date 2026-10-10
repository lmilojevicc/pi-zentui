import { sanitizeTerminalControls } from "./render-utils.js";

export const MAX_PRESENTATION_SOURCE_BYTES = 1024 * 1024;
export const MAX_PREVIEW_LINE_CHARS = 16_384;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Inspect only the bounded prefix and one complete lookahead scalar. */
export function graphemePrefix(text: string, limit: number, start = 0, end = text.length): string {
	let cut = Math.min(end, start + Math.max(0, limit));
	if (cut >= end) return text.slice(start, end);
	if (cut > start && /[\ud800-\udbff]/.test(text[cut - 1]) && /[\udc00-\udfff]/.test(text[cut]))
		cut--;
	const prefix = text.slice(start, cut);
	if (!prefix) return "";
	const next = text.codePointAt(cut);
	const probe = prefix + (next === undefined ? "" : String.fromCodePoint(next));
	const part = graphemes.segment(probe).containing(prefix.length - 1);
	return part && part.index + part.segment.length > prefix.length
		? prefix.slice(0, part.index)
		: prefix;
}

export interface BoundedPresentationSource {
	lines: string[];
	capped: boolean;
}

/** No full split, normalization or highlighting occurs before source/line bounds. */
export function boundedPresentationSource(
	text: string,
	lineLimit: number,
	preserveTerminalEmpty: boolean,
): BoundedPresentationSource {
	const scalarPrefix = graphemePrefix(text, MAX_PRESENTATION_SOURCE_BYTES);
	const buffer = Buffer.alloc(Math.min(MAX_PRESENTATION_SOURCE_BYTES, scalarPrefix.length * 3));
	const written = buffer.write(scalarPrefix, "utf8");
	const encodedPrefix = buffer.subarray(0, written).toString("utf8");
	const sourcePrefix =
		encodedPrefix.length < text.length ? graphemePrefix(text, encodedPrefix.length) : encodedPrefix;
	let capped = sourcePrefix.length < text.length;
	const input = sanitizeTerminalControls(sourcePrefix).replace(/\r/g, "");
	const lines: string[] = [];
	let start = 0;
	while (start < input.length || (preserveTerminalEmpty && start === input.length)) {
		if (lines.length >= lineLimit) {
			capped = true;
			break;
		}
		const newline = input.indexOf("\n", start);
		const end = newline < 0 ? input.length : newline;
		const line = graphemePrefix(input, MAX_PREVIEW_LINE_CHARS, start, end);
		capped ||= line.length < end - start;
		lines.push(line);
		if (newline < 0) break;
		start = newline + 1;
	}
	return { lines, capped };
}
