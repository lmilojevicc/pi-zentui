import { visibleWidth } from "@earendil-works/pi-tui";
import type { ThinkingStepsComponentConfig } from "./config";
import { sanitizeUserMessageSourceText } from "./user-message-osc";

/** Hard limits keep transcript transforms synchronous and bounded. Limits are inclusive. */
export const THINKING_STEPS_MAX_INPUT_LENGTH = 65_536;
export const THINKING_STEPS_MAX_STEPS = 128;
export const THINKING_STEPS_MAX_LABEL_LENGTH = 512;
export const THINKING_STEPS_MAX_LABEL_WIDTH = 160;
export const THINKING_STEPS_MAX_OUTPUT_LENGTH = 65_536;

export type ThinkingStep = Readonly<{
	number: number;
	label: string;
	body: string;
}>;

export type ThinkingTransformContext = Readonly<{
	messageType: string;
	isStreaming: boolean;
	availableWidth: number;
}>;

type ThinkingStepsExtensionApi = {
	registerMarkdownTransformer?: (
		transformer: (markdown: string, context: ThinkingTransformContext) => string,
	) => void;
};

export type ThinkingStepsCapability = Readonly<{ available: boolean }>;

type MutableStep = {
	number: number;
	label: string;
	bodyLines: string[];
};

type StructuralLabel = { label: string };

type OpaqueBlock = { end: number; malformed: boolean };

const meaningfulLabelPattern = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;
const markdownLabelEscapePattern = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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
	if (marker[0] === "`" && info.includes("`")) {
		return { end: start, malformed: true };
	}
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
		!meaningfulLabelPattern.test(trimmed)
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

/** Parse only source-level structure; fenced and display-math blocks remain opaque bodies. */
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

function truncateLabel(label: string, width: number): string | undefined {
	if (width <= 0) return undefined;
	if (visibleWidth(label) <= width) return label;
	const suffix = width > 1 ? "…" : "";
	const contentWidth = width - visibleWidth(suffix);
	let result = "";
	let usedWidth = 0;
	for (const { segment } of graphemeSegmenter.segment(label)) {
		const segmentWidth = visibleWidth(segment);
		if (usedWidth + segmentWidth > contentWidth) break;
		result += segment;
		usedWidth += segmentWidth;
	}
	return result ? `${result}${suffix}` : undefined;
}

function escapeMarkdownLabel(label: string): string {
	return label.replace(markdownLabelEscapePattern, "\\$&");
}

function sizedLabel(
	step: ThinkingStep,
	availableWidth: number,
	prefixWidth: number,
): string | undefined {
	const budget = Math.min(
		THINKING_STEPS_MAX_LABEL_WIDTH,
		Math.max(0, Math.floor(availableWidth) - prefixWidth),
	);
	const label = truncateLabel(step.label, budget);
	return label ? escapeMarkdownLabel(label) : undefined;
}

function boundedOutput(output: string, input: string): string {
	return output.length <= THINKING_STEPS_MAX_OUTPUT_LENGTH ? output : input;
}

/*
 * The visual title/connector language below is adapted from pi-thinking-steps d0a59a4.
 *
 * MIT License
 *
 * Copyright (c) 2026 Marc Mironescu / FluxGear
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const RAIL_TITLE = "│ **Thinking**";
const TREE_TITLE = "┆ **Thinking**";
const TITLE_VISIBLE_WIDTH = visibleWidth("│ Thinking");

function titleCanFit(availableWidth: number): boolean {
	return TITLE_VISIBLE_WIDTH <= Math.floor(availableWidth);
}

/** Transform parsed thinking into ordinary Markdown without changing the source/session content. */
export function transformThinkingSteps(
	markdown: string,
	config: ThinkingStepsComponentConfig,
	context: ThinkingTransformContext,
): string {
	if (
		!config.enabled ||
		config.mode === "streaming-experimental" ||
		context.messageType !== "assistant-thinking" ||
		!Number.isFinite(context.availableWidth) ||
		context.availableWidth < 0
	) {
		return markdown;
	}
	const steps = parseThinkingSteps(markdown);
	if (!steps?.length) return markdown;

	const rail = config.mode === "rail";
	const title = rail ? RAIL_TITLE : TREE_TITLE;
	if (!titleCanFit(context.availableWidth)) return markdown;
	const selectedSteps = rail ? steps : steps.slice(-5);
	const lines: string[] = [title];
	for (const [index, step] of selectedSteps.entries()) {
		const final = index === selectedSteps.length - 1;
		const connector = rail ? "│" : final ? "└─" : "├─";
		const active = context.isStreaming && final;
		const prefix = `${connector} ${active ? "•" : "·"} `;
		const label = sizedLabel(step, context.availableWidth, visibleWidth(prefix));
		if (!label) return markdown;
		lines.push(`${prefix}${active ? `**${label}**` : label}`);
	}
	return boundedOutput(
		lines.map((line, index) => (index < lines.length - 1 ? `${line}  ` : line)).join("\n"),
		markdown,
	);
}

/** Register Zentui's single internal Markdown-dispatch slot when the public Pi API is present. */
export function registerThinkingStepsTransformer(
	pi: unknown,
	getConfig: () => ThinkingStepsComponentConfig,
): ThinkingStepsCapability {
	const api = pi as ThinkingStepsExtensionApi;
	if (typeof api.registerMarkdownTransformer !== "function") {
		return Object.freeze({ available: false });
	}
	try {
		api.registerMarkdownTransformer.call(api, (markdown, context) => {
			const input = markdown;
			try {
				return transformThinkingSteps(input, getConfig(), context);
			} catch {
				return input;
			}
		});
		return Object.freeze({ available: true });
	} catch {
		return Object.freeze({ available: false });
	}
}
