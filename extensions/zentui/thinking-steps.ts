import { sanitizeSgrOnlySourceText } from "./user-message-osc";

/**
 * Parsing is line-incremental: complete lines are committed once and only the open last line is
 * re-read per update, so limits bound memory and per-update work rather than parse validity.
 */
/** Source text a cache may retain to verify append-only growth; shared across runs, never parsed. */
export const THINKING_STEPS_MAX_RETAINED_SOURCE_LENGTH = 65_536;
/** Unparsed source a single update may add; longer jumps fail open instead of stalling the TUI. */
export const THINKING_STEPS_MAX_CHUNK_LENGTH = 1_048_576;
/** Steps kept for display: the first few plus the most recent; the rest are counted as omitted. */
export const THINKING_STEPS_MAX_RETAINED_STEPS = 32;
export const THINKING_STEPS_RETAINED_HEAD_STEPS = 4;
/** Labels beyond this length are clamped with an ellipsis; they never reject a run. */
export const THINKING_STEPS_MAX_LABEL_LENGTH = 512;
/** The open line is classified from this many leading characters; the rest is checked when it commits. */
const OPEN_LINE_WORK_LENGTH = 2_048;
const PARTIAL_ESCAPE_SUFFIX = /\x1b(?:\[[0-9;]*)?$/;

export type ThinkingStep = Readonly<{
	number: number;
	label: string;
}>;

export type ThinkingStepsRejection =
	| "empty"
	| "unsafe-control"
	| "malformed-fence"
	| "orphan-content"
	| "unlabeled-step"
	| "chunk-too-large";

export type ThinkingStepsParseResult = Readonly<{
	/** The first retained steps and the most recent ones; numbers expose the omitted gap. */
	steps: readonly ThinkingStep[];
	/** Parsed steps not retained in `steps`. */
	omittedSteps: number;
	/** Labels shortened to the label limit since the run began. */
	clampedLabels: number;
	/** Only an unclosed recognized fence/math body; all source/label limits still passed. */
	unfinished: boolean;
}>;

export type ThinkingStepsAdvance =
	| Readonly<{ result: ThinkingStepsParseResult }>
	| Readonly<{ rejection: ThinkingStepsRejection }>;

type StructuralLabel = { label: string };

type ParserState = {
	retained: ThinkingStep[];
	stepCount: number;
	clampedLabels: number;
	paragraphBoundary: boolean;
	/** Closing-line pattern while inside a fence or display-math body. */
	opaqueClose: RegExp | undefined;
};

const meaningfulLabelPattern = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;
const fenceOpeningPattern = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/;

function headingLabel(line: string): StructuralLabel | undefined {
	const match = /^(#{1,6})[\t ]+(.+?)\s*$/.exec(line);
	if (!match) return undefined;
	const label = (match[2] ?? "").replace(/[\t ]+#+[\t ]*$/, "").trim();
	return label ? { label } : undefined;
}

function listLabel(line: string): StructuralLabel | undefined {
	const match = /^(?:[-+*]|\d{1,9}[.)])[\t ]+(.+?)\s*$/.exec(line);
	const label = match?.[1]?.trim() ?? "";
	return label ? { label } : undefined;
}

function structuralLabel(line: string): StructuralLabel | undefined {
	return headingLabel(line) ?? listLabel(line);
}

function isTopLevelProse(line: string): boolean {
	if (!line.trim() || /^[\t ]/.test(line)) return false;
	if (/^(?: {0,3})(?:`{3,}|~{3,}|\$\$|\\\[|>)/.test(line)) return false;
	return !/^(?:#{1,6}(?:[\t ]|$)|[-+*](?:[\t ]|$)|\d{1,9}[.)](?:[\t ]|$))/.test(line);
}

/** Pattern that ends the fence/math body opened by `line`, or undefined for any other line. */
function opaqueClosePattern(line: string): RegExp | "single-line" | "malformed" | undefined {
	const fence = fenceOpeningPattern.exec(line);
	if (fence) {
		const marker = fence[1] ?? "";
		if (marker[0] === "`" && (fence[2] ?? "").includes("`")) return "malformed";
		return new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[\\t ]*$`);
	}
	if (/^ {0,3}\$\$.+\$\$[\t ]*$/.test(line)) return "single-line";
	if (/^ {0,3}\$\$[\t ]*$/.test(line)) return /^(?: {0,3})\$\$[\t ]*$/;
	if (/^ {0,3}\\\[[\t ]*$/.test(line)) return /^(?: {0,3})\\\][\t ]*$/;
	return undefined;
}

function clampLabel(label: string): { label: string; clamped: boolean } {
	if (label.length <= THINKING_STEPS_MAX_LABEL_LENGTH) return { label, clamped: false };
	let end = THINKING_STEPS_MAX_LABEL_LENGTH - 1;
	const last = label.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1; // never split a surrogate pair
	return { label: `${label.slice(0, end).trimEnd()}…`, clamped: true };
}

/** An over-long paragraph-derived label is its first sentence, when that sentence is a label. */
function firstSentence(paragraph: string): string {
	const end = /[.!?](?=\s)/.exec(paragraph)?.index;
	const sentence = end === undefined ? paragraph : paragraph.slice(0, end + 1);
	return meaningfulLabelPattern.test(sentence) ? sentence : paragraph;
}

function startStep(
	state: ParserState,
	label: string,
	prose: boolean,
): ThinkingStepsRejection | undefined {
	let text = label.trim();
	if (prose) {
		if (text.length > THINKING_STEPS_MAX_LABEL_LENGTH) text = firstSentence(text);
		text = text.replace(/\t/g, " ");
	}
	if (!meaningfulLabelPattern.test(text) || text.includes("\t")) return "unlabeled-step";
	const clamped = clampLabel(text);
	if (clamped.clamped) state.clampedLabels += 1;
	state.stepCount += 1;
	state.retained.push(Object.freeze({ number: state.stepCount, label: clamped.label }));
	if (state.retained.length > THINKING_STEPS_MAX_RETAINED_STEPS) {
		state.retained.splice(THINKING_STEPS_RETAINED_HEAD_STEPS, 1);
	}
	state.paragraphBoundary = false;
	return undefined;
}

function feedLine(state: ParserState, line: string): ThinkingStepsRejection | undefined {
	if (state.opaqueClose) {
		if (state.opaqueClose.test(line)) state.opaqueClose = undefined;
		return undefined;
	}
	if (!line.trim()) {
		state.paragraphBoundary = true;
		return undefined;
	}
	const opaque = opaqueClosePattern(line);
	if (opaque) {
		if (opaque === "malformed") return "malformed-fence";
		if (state.stepCount === 0) return "orphan-content";
		if (opaque !== "single-line") state.opaqueClose = opaque;
		return undefined;
	}
	const structural = structuralLabel(line);
	if (structural) {
		// Separators such as `- - -` carry no label; they are body text inside an existing step.
		if (state.stepCount > 0 && !meaningfulLabelPattern.test(structural.label)) return undefined;
		return startStep(state, structural.label, false);
	}
	if (isTopLevelProse(line) && (state.stepCount === 0 || state.paragraphBoundary)) {
		if (state.stepCount > 0 && !meaningfulLabelPattern.test(line)) return undefined;
		return startStep(state, line, true);
	}
	return state.stepCount === 0 ? "orphan-content" : undefined;
}

function cloneState(state: ParserState): ParserState {
	return { ...state, retained: [...state.retained] };
}

/**
 * Parses an append-only source. `advance` may be called with each longer version of the same
 * source: lines committed earlier are never read again, so work is proportional to the new text
 * plus the open line. Fenced and display-math blocks remain opaque.
 */
export class ThinkingStepsParser {
	private readonly state: ParserState = {
		retained: [],
		stepCount: 0,
		clampedLabels: 0,
		paragraphBoundary: true,
		opaqueClose: undefined,
	};
	private committed = 0;
	private poisoned: ThinkingStepsRejection | undefined;

	/** Raw source offset before which the source is trusted to be unchanged. */
	get committedLength(): number {
		return this.committed;
	}

	advance(source: string): ThinkingStepsAdvance {
		if (this.poisoned) return { rejection: this.poisoned };
		if (source.length - this.committed > THINKING_STEPS_MAX_CHUNK_LENGTH) {
			return this.poison("chunk-too-large");
		}
		const pending = source.slice(this.committed);
		const lineEnd = pending.lastIndexOf("\n");
		const complete = pending.slice(0, lineEnd + 1);
		if (complete) {
			const sanitized = sanitizeSgrOnlySourceText(complete.replace(/\r\n/g, "\n"));
			if (sanitized === undefined) return this.poison("unsafe-control");
			const lines = sanitized.split("\n");
			lines.pop();
			for (const line of lines) {
				const rejection = feedLine(this.state, line);
				if (rejection) return this.poison(rejection);
			}
			this.committed += complete.length;
		}
		const open = pending.slice(lineEnd + 1);
		// A trailing CR is the first half of a CRLF split across updates.
		const windowed = open.length > OPEN_LINE_WORK_LENGTH;
		const openLine = (
			windowed
				? open.slice(0, OPEN_LINE_WORK_LENGTH)
				: open.endsWith("\r")
					? open.slice(0, -1)
					: open
		).replace(PARTIAL_ESCAPE_SUFFIX, ""); // A chunk may split an SGR sequence; it is rechecked whole.
		const work = openLine ? cloneState(this.state) : this.state;
		if (openLine) {
			const sanitized = sanitizeSgrOnlySourceText(openLine);
			if (sanitized === undefined) return { rejection: "unsafe-control" };
			const rejection = feedLine(work, sanitized);
			if (rejection) return { rejection };
		}
		if (work.stepCount === 0) return { rejection: "empty" };
		return {
			result: {
				steps: work.retained.slice(),
				omittedSteps: work.stepCount - work.retained.length,
				clampedLabels: work.clampedLabels,
				unfinished: work.opaqueClose !== undefined,
			},
		};
	}

	/** Committed content is immutable, so a rejection there holds for every longer source. */
	private poison(rejection: ThinkingStepsRejection): ThinkingStepsAdvance {
		this.poisoned = rejection;
		return { rejection };
	}
}

/** Parse source-level structure; fenced and display-math blocks remain opaque bodies. */
export function parseThinkingStepsResult(markdown: string): ThinkingStepsParseResult | undefined {
	const advance = new ThinkingStepsParser().advance(markdown);
	return "result" in advance ? advance.result : undefined;
}

/** Finalized/standalone parsing never accepts an unfinished opaque block. */
export function parseThinkingSteps(markdown: string): readonly ThinkingStep[] | undefined {
	const result = parseThinkingStepsResult(markdown);
	return result && !result.unfinished ? result.steps : undefined;
}
