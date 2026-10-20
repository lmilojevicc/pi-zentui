import { sanitizeTerminalControls } from "./render-utils.ts";

export const MAX_PRESENTATION_SOURCE_BYTES = 1024 * 1024;

import { MAX_PREVIEW_LINE_CHARS } from "./bounds.ts";

export { MAX_PREVIEW_LINE_CHARS } from "./bounds.ts";

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

export interface PresentationMetadata {
	lineCount: number;
	sizeBytes: number;
	capped: boolean;
}

/** Numeric display metadata only: no normalization, full split or payload allocation. */
export function boundedContentMetadata(
	value: unknown,
	preserveTerminalEmpty = false,
): PresentationMetadata {
	if (typeof value !== "string" || !value) return { lineCount: 0, sizeBytes: 0, capped: false };
	let sizeBytes = 0;
	let lineFeeds = 0;
	let lineChars = 0;
	let last = "";
	let index = 0;
	while (index < value.length) {
		const point = value.codePointAt(index) as number;
		const units = point > 0xffff ? 2 : 1;
		const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
		const nextFeeds = lineFeeds + Number(point === 10);
		const nextChars = point === 10 ? 0 : point === 13 ? lineChars : lineChars + units;
		const nextLast = point === 13 ? last : point === 10 ? "\n" : "text";
		const nextLines = preserveTerminalEmpty
			? nextFeeds + 1
			: nextFeeds + Number(nextLast === "text");
		if (
			sizeBytes + bytes > MAX_PRESENTATION_SOURCE_BYTES ||
			nextChars > MAX_PREVIEW_LINE_CHARS ||
			nextLines > 4000
		)
			break;
		sizeBytes += bytes;
		lineFeeds = nextFeeds;
		lineChars = nextChars;
		last = nextLast;
		index += units;
	}
	return {
		lineCount: preserveTerminalEmpty ? lineFeeds + 1 : lineFeeds + Number(last === "text"),
		sizeBytes,
		capped: index < value.length,
	};
}
