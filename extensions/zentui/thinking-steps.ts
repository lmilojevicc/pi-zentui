import { sanitizeUserMessageSourceText } from "./user-message-osc";

/** Hard limits keep private transcript parsing synchronous and bounded. Limits are inclusive. */
export const THINKING_STEPS_MAX_INPUT_LENGTH = 65_536;
export const THINKING_STEPS_MAX_STEPS = 128;
export const THINKING_STEPS_MAX_LABEL_LENGTH = 512;

export type ThinkingStep = Readonly<{
	number: number;
	label: string;
	body: string;
}>;

type MutableStep = {
	number: number;
	label: string;
	bodyLines: string[];
};

type StructuralLabel = { label: string };
type OpaqueBlock = { end: number; malformed: boolean };

const meaningfulLabelPattern = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

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

function fenceBlock(lines: readonly string[], start: number): OpaqueBlock | undefined {
	const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(lines[start] ?? "");
	if (!opening) return undefined;
	const marker = opening[1] ?? "";
	const info = opening[2] ?? "";
	if (marker[0] === "`" && info.includes("`")) return { end: start, malformed: true };
	const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[\\t ]*$`);
	for (let index = start + 1; index < lines.length; index += 1) {
		if (closing.test(lines[index] ?? "")) return { end: index, malformed: false };
	}
	return { end: lines.length - 1, malformed: true };
}

function mathBlock(lines: readonly string[], start: number): OpaqueBlock | undefined {
	const line = lines[start] ?? "";
	if (/^ {0,3}\$\$.+\$\$[\t ]*$/.test(line)) return { end: start, malformed: false };
	const close = /^ {0,3}\$\$[\t ]*$/.test(line)
		? /^(?: {0,3})\$\$[\t ]*$/
		: /^ {0,3}\\\[[\t ]*$/.test(line)
			? /^(?: {0,3})\\\][\t ]*$/
			: undefined;
	if (!close) return undefined;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (close.test(lines[index] ?? "")) return { end: index, malformed: false };
	}
	return { end: lines.length - 1, malformed: true };
}

function isTopLevelProse(line: string): boolean {
	if (!line.trim() || /^[\t ]/.test(line)) return false;
	if (/^(?: {0,3})(?:`{3,}|~{3,}|\$\$|\\\[|>)/.test(line)) return false;
	return !/^(?:#{1,6}(?:[\t ]|$)|[-+*](?:[\t ]|$)|\d{1,9}[.)](?:[\t ]|$))/.test(line);
}

function safeLabel(label: string): string | undefined {
	const trimmed = label.trim();
	if (
		!trimmed ||
		trimmed.length > THINKING_STEPS_MAX_LABEL_LENGTH ||
		!meaningfulLabelPattern.test(trimmed) ||
		trimmed.includes("\t")
	) {
		return undefined;
	}
	return trimmed;
}

function finishSteps(steps: MutableStep[]): ThinkingStep[] | undefined {
	const finished: ThinkingStep[] = [];
	for (const step of steps) {
		const label = safeLabel(step.label);
		if (!label) return undefined;
		let first = 0;
		let last = step.bodyLines.length;
		while (first < last && !(step.bodyLines[first] ?? "").trim()) first += 1;
		while (last > first && !(step.bodyLines[last - 1] ?? "").trim()) last -= 1;
		finished.push(
			Object.freeze({
				number: step.number,
				label,
				body: step.bodyLines.slice(first, last).join("\n"),
			}),
		);
	}
	return finished;
}

/** Parse source-level structure; fenced and display-math blocks remain opaque bodies. */
export function parseThinkingSteps(markdown: string): readonly ThinkingStep[] | undefined {
	if (!markdown || markdown.length > THINKING_STEPS_MAX_INPUT_LENGTH) return undefined;
	const source = markdown.replace(/\r\n/g, "\n");
	const sanitized = sanitizeUserMessageSourceText(source);
	if (sanitized !== source || !source.trim()) return undefined;

	const lines = source.split("\n");
	const steps: MutableStep[] = [];
	let current: MutableStep | undefined;
	let paragraphBoundary = true;
	const startStep = (label: string) => {
		if (steps.length >= THINKING_STEPS_MAX_STEPS) return false;
		current = { number: steps.length + 1, label, bodyLines: [] };
		steps.push(current);
		paragraphBoundary = false;
		return true;
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			if (current) current.bodyLines.push(line);
			paragraphBoundary = true;
			continue;
		}
		const opaque = fenceBlock(lines, index) ?? mathBlock(lines, index);
		if (opaque) {
			if (opaque.malformed || !current) return undefined;
			current.bodyLines.push(...lines.slice(index, opaque.end + 1));
			index = opaque.end;
			continue;
		}
		const structural = structuralLabel(line);
		if (structural) {
			if (!startStep(structural.label)) return undefined;
			continue;
		}
		if (isTopLevelProse(line) && (!current || paragraphBoundary)) {
			if (!startStep(line.trim())) return undefined;
			continue;
		}
		if (!current) return undefined;
		current.bodyLines.push(line);
	}
	if (steps.length === 0) return undefined;
	return finishSteps(steps);
}
