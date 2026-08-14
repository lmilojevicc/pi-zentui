import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
	ColorSpec,
	PolishedTuiColors,
	WorkingLineComponentConfig,
	WorkingLineTextAnimation,
	ZentuiConfig,
} from "./config";
import { formatCount } from "./format";
import {
	isSafeSgrStylePrefix,
	isSupportedColorSpec,
	renderStyleForSourceOrFallback,
	type SourceStyleFallback,
	type ThemeLike,
} from "./style";
import { PI_WORKING_LINE_MESSAGES } from "./working-line-messages";
import { WORKING_LINE_SPINNERS } from "./working-line-spinners";

export { WORKING_LINE_SPINNERS } from "./working-line-spinners";

export const BUILT_IN_WORKING_LINE_MESSAGES = PI_WORKING_LINE_MESSAGES;
export const WORKING_LINE_FALLBACK_MESSAGE = "Working…";

export const MAX_WORKING_LINE_MESSAGES = 48;
/** Complete Loader row, including its two margins and Pi's indicator separator. */
export const MAX_WORKING_LINE_ROW_CELLS = 80;
/** Indicator payload budget inside the complete Loader row. */
export const MAX_WORKING_LINE_FRAME_CELLS = MAX_WORKING_LINE_ROW_CELLS - 3;
export const MAX_WORKING_LINE_MESSAGE_CELLS = 43;
export const MAX_WORKING_LINE_TOOL_CELLS = 18;
export const MAX_WORKING_LINE_FRAMES = 1024;
export const MAX_WORKING_LINE_FRAME_CODE_UNITS = 512 * 1024;
export const MAX_WORKING_LINE_RAW_CODE_UNITS = 4096;
/** Keeps combining-rich visible text bounded before it is copied into every animation frame. */
export const MAX_WORKING_LINE_NORMALIZED_CODE_UNITS = 256;
/** Three modifiers plus one color are sufficient for each Working-line tier. */
export const MAX_WORKING_LINE_STYLE_TOKENS = 4;
export const MAX_WORKING_LINE_STYLE_CODE_UNITS = 48;
export const MAX_WORKING_LINE_ENTRIES_EXAMINED = 256;

const WORKING_LINE_FALLBACKS: Record<"low" | "mid" | "high", SourceStyleFallback> = {
	low: { theme: "dim", terminal: "bright-black" },
	mid: { theme: "muted", terminal: "cyan" },
	high: { theme: "bold accent", terminal: "bold cyan" },
};
const CLASSIC_PADDING_CELLS = 4;
const CLASSIC_HIGHLIGHT_HALF_WIDTH = 4;
const KITT_TRAIL_CELLS = 4;
const SGR_RESET = "\x1b[0m";

type Tier = "low" | "mid" | "high";
type GraphemeCell = { text: string; start: number; width: number };

type WorkingLineUi = {
	setWorkingMessage(message?: string): void;
	setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
};

type WorkingLineContext = {
	hasUI?: boolean;
	mode?: string;
	ui: object;
};

type AgentDurationListener = (durationMs: number) => void;

/** One agent-duration clock shared by minimalist Editor and Working-line consumers. */
export class AgentDurationClock {
	private startedAt: number | undefined;
	private completedMs: number | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly listeners = new Set<AgentDurationListener>();

	start(now = Date.now()): void {
		this.stopTimer();
		this.startedAt = now;
		this.completedMs = 0;
		this.notify();
		this.reconcileTimer();
	}

	finish(now = Date.now()): void {
		if (this.startedAt !== undefined) this.completedMs = Math.max(0, now - this.startedAt);
		this.startedAt = undefined;
		this.notify();
		this.stopTimer();
	}

	reset(): void {
		this.stopTimer();
		this.startedAt = undefined;
		this.completedMs = undefined;
	}

	isActive(): boolean {
		return this.startedAt !== undefined;
	}

	elapsedMs(now = Date.now()): number | undefined {
		return this.startedAt === undefined ? this.completedMs : Math.max(0, now - this.startedAt);
	}

	subscribe(listener: AgentDurationListener): () => void {
		this.listeners.add(listener);
		this.reconcileTimer();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.listeners.delete(listener);
			this.reconcileTimer();
		};
	}

	private notify(): void {
		const elapsed = this.elapsedMs();
		if (elapsed === undefined) return;
		for (const listener of this.listeners) listener(elapsed);
	}

	private reconcileTimer(): void {
		if (!this.isActive() || this.listeners.size === 0) {
			this.stopTimer();
			return;
		}
		if (this.timer !== undefined) return;
		this.timer = setInterval(() => this.notify(), 1000);
	}

	private stopTimer(): void {
		if (this.timer === undefined) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}
}

function segmentGraphemes(value: string): Iterable<string> {
	try {
		const Segmenter = Intl.Segmenter;
		if (typeof Segmenter === "function") {
			const segments = new Segmenter(undefined, { granularity: "grapheme" }).segment(value);
			return {
				*[Symbol.iterator]() {
					for (const part of segments) yield part.segment;
				},
			};
		}
	} catch {
		// Without Intl.Segmenter, treat the complete value as one conservative grapheme.
	}
	return [value];
}

function truncateGraphemes(
	value: string,
	maximumCells: number,
	maximumCodeUnits = Number.POSITIVE_INFINITY,
): string {
	let width = 0;
	let codeUnits = 0;
	const output: string[] = [];
	for (const grapheme of segmentGraphemes(value)) {
		if (width >= maximumCells) break;
		const nextWidth = visibleWidth(grapheme);
		if (width + nextWidth > maximumCells) break;
		if (codeUnits + grapheme.length > maximumCodeUnits) break;
		output.push(grapheme);
		width += nextWidth;
		codeUnits += grapheme.length;
	}
	while (output.length > 0 && /^\s+$/u.test(output.at(-1) ?? "")) output.pop();
	return output.join("");
}

function boundRawWorkingLineInput(value: string): string {
	if (value.length <= MAX_WORKING_LINE_RAW_CODE_UNITS) return value;
	const prefix = value.slice(0, MAX_WORKING_LINE_RAW_CODE_UNITS);
	const graphemes = [...segmentGraphemes(prefix)];
	// The last segmented item may be only the prefix of a grapheme that crosses the raw bound.
	graphemes.pop();
	return graphemes.join("");
}

function trimGraphemeWhitespace(value: string): string {
	const graphemes = [...segmentGraphemes(value)];
	while (graphemes.length > 0 && /^\s+$/u.test(graphemes[0] ?? "")) graphemes.shift();
	while (graphemes.length > 0 && /^\s+$/u.test(graphemes.at(-1) ?? "")) graphemes.pop();
	return graphemes.join("");
}

function stripC1TerminalSequences(value: string): string {
	return value
		.replaceAll(/[\u0090\u0098\u009d\u009e\u009f][\s\S]*?(?:\u0007|\u009c|\x1b\\|$)/g, "")
		.replaceAll(/\u009b[0-?]*[ -/]*[@-~]/g, "");
}

/** Normalize untrusted user-authored text before it can reach Pi's working row. */
export function normalizeWorkingLineMessage(value: unknown): string {
	if (typeof value !== "string") return "";
	const bounded = boundRawWorkingLineInput(value);
	const withoutTerminalSequences = stripVTControlCharacters(stripC1TerminalSequences(bounded));
	const withoutControls = withoutTerminalSequences
		.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replaceAll(/[\u034f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u206f]/g, "");
	const normalized = trimGraphemeWhitespace(
		withoutControls.normalize("NFC").replaceAll(/\s+/gu, " "),
	);
	const truncated = truncateGraphemes(
		normalized,
		MAX_WORKING_LINE_MESSAGE_CELLS,
		MAX_WORKING_LINE_NORMALIZED_CODE_UNITS,
	);
	return visibleWidth(truncated) > 0 ? truncated : "";
}

export function normalizeWorkingLineMessages(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const output: string[] = [];
	const seen = new Set<string>();
	const examined = Math.min(values.length, MAX_WORKING_LINE_ENTRIES_EXAMINED);
	for (let index = 0; index < examined; index += 1) {
		const normalized = normalizeWorkingLineMessage(values[index]);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		output.push(normalized);
		if (output.length === MAX_WORKING_LINE_MESSAGES) break;
	}
	return output;
}

export function effectiveWorkingLineMessages(config: WorkingLineComponentConfig): string[] {
	if (!config.messages.custom) return [WORKING_LINE_FALLBACK_MESSAGE];
	const custom = normalizeWorkingLineMessages(config.messages.values);
	return custom.length > 0 ? custom : [WORKING_LINE_FALLBACK_MESSAGE];
}

export function selectWorkingLineMessage(
	config: WorkingLineComponentConfig,
	random: () => number = Math.random,
): string {
	const pool = effectiveWorkingLineMessages(config);
	if (!config.messages.custom || pool.length <= 1) return pool[0] ?? WORKING_LINE_FALLBACK_MESSAGE;
	const sample = random();
	const finite = Number.isFinite(sample) ? sample : 0;
	const index = Math.min(pool.length - 1, Math.max(0, Math.floor(finite * pool.length)));
	return pool[index] ?? WORKING_LINE_FALLBACK_MESSAGE;
}

function gcd(left: number, right: number): number {
	let a = left;
	let b = right;
	while (b !== 0) {
		const remainder = a % b;
		a = b;
		b = remainder;
	}
	return a;
}

function lcm(left: number, right: number): number {
	return (left / gcd(left, right)) * right;
}

function schedulePeriod(intervalMs: number, cycleAdvances: number, quantumMs: number): number {
	const product = intervalMs * cycleAdvances;
	return product / gcd(quantumMs, product);
}

function graphemeCells(message: string): { cells: GraphemeCell[]; width: number } {
	const cells: GraphemeCell[] = [];
	let start = 0;
	for (const text of segmentGraphemes(message)) {
		const width = visibleWidth(text);
		cells.push({ text, start, width });
		start += width;
	}
	return { cells, width: start };
}

function classicTier(cell: GraphemeCell, tick: number): Tier {
	const center = tick - CLASSIC_PADDING_CELLS;
	const cellCenter = cell.start + Math.max(0, cell.width - 1) / 2;
	const distance = Math.abs(cellCenter - center);
	if (distance <= 1) return "high";
	if (distance <= CLASSIC_HIGHLIGHT_HALF_WIDTH) return "mid";
	return "low";
}

function kittHead(tick: number, width: number): { position: number; direction: 1 | -1 } {
	const span = width + KITT_TRAIL_CELLS - 1;
	if (tick < span) return { position: tick - (KITT_TRAIL_CELLS - 1), direction: 1 };
	return {
		position: span * 2 - 2 - tick - (KITT_TRAIL_CELLS - 1),
		direction: -1,
	};
}

function kittTier(cell: GraphemeCell, tick: number, width: number): Tier {
	const { position, direction } = kittHead(tick, width);
	const cellEnd = cell.start + cell.width;
	if (position >= cell.start && position < cellEnd) return "high";
	const cellCenter = cell.start + Math.max(0, cell.width - 1) / 2;
	const distance = direction === 1 ? position - cellCenter : cellCenter - position;
	if (distance > 0 && distance <= KITT_TRAIL_CELLS) return "mid";
	return "low";
}

function textPeriod(animation: WorkingLineTextAnimation, width: number): number {
	switch (animation) {
		case "classic":
			return width + CLASSIC_PADDING_CELLS * 2;
		case "kitt":
			return (width + KITT_TRAIL_CELLS - 2) * 2;
		case "disabled":
			return 1;
	}
}

type TextSpatialPhase = { position: number; direction: 1 | -1 };

function normalizedPhaseTick(tick: number, period: number): number {
	const integral = Number.isFinite(tick) ? Math.floor(tick) : 0;
	return ((integral % period) + period) % period;
}

function textSpatialPhase(
	animation: WorkingLineTextAnimation,
	width: number,
	tick: number,
): TextSpatialPhase | undefined {
	const phase = normalizedPhaseTick(tick, textPeriod(animation, width));
	switch (animation) {
		case "classic":
			return { position: phase - CLASSIC_PADDING_CELLS, direction: 1 };
		case "kitt":
			return kittHead(phase, width);
		case "disabled":
			return undefined;
	}
}

function textTickForSpatialPhase(
	animation: WorkingLineTextAnimation,
	width: number,
	spatial: TextSpatialPhase | undefined,
): number {
	if (!spatial || animation === "disabled") return 0;
	if (animation === "classic") {
		const position = Math.min(
			width + CLASSIC_PADDING_CELLS - 1,
			Math.max(-CLASSIC_PADDING_CELLS, spatial.position),
		);
		return position + CLASSIC_PADDING_CELLS;
	}
	if (spatial.direction === 1) {
		const position = Math.min(width - 1, Math.max(-(KITT_TRAIL_CELLS - 1), spatial.position));
		return position + KITT_TRAIL_CELLS - 1;
	}
	const position = Math.min(width - 2, Math.max(-(KITT_TRAIL_CELLS - 2), spatial.position));
	return width * 2 + 1 - position;
}

export function remapWorkingLineTextTick(
	fromAnimation: WorkingLineTextAnimation,
	fromWidth: number,
	fromTick: number,
	toAnimation: WorkingLineTextAnimation,
	toWidth: number,
	fromOrigin = 0,
	toOrigin = 0,
): number {
	const spatial = textSpatialPhase(fromAnimation, fromWidth, fromTick);
	return textTickForSpatialPhase(
		toAnimation,
		toWidth,
		spatial ? { ...spatial, position: spatial.position + fromOrigin - toOrigin } : undefined,
	);
}

function styleForTier(colors: PolishedTuiColors, tier: Tier): ColorSpec | undefined {
	switch (tier) {
		case "low":
			return colors.workingLineLow;
		case "mid":
			return colors.workingLineMid;
		case "high":
			return colors.workingLineHigh;
	}
}

/** Normalize only Working-line palette specs before they are repeated across generated frames. */
export function normalizeWorkingLineStyleSpec(value: ColorSpec | undefined): ColorSpec | undefined {
	if (value === undefined) return undefined;
	const tokens: string[] = [];
	const seen = new Set<string>();
	let codeUnits = 0;
	for (const match of value.matchAll(/\S+/g)) {
		const token = match[0];
		if (!isSupportedColorSpec(token)) return undefined;
		const lower = token.toLowerCase();
		const equivalent = lower === "dimmed" ? "dim" : lower;
		if (seen.has(equivalent)) continue;
		const separator = tokens.length > 0 ? 1 : 0;
		if (
			tokens.length === MAX_WORKING_LINE_STYLE_TOKENS ||
			codeUnits + separator + token.length > MAX_WORKING_LINE_STYLE_CODE_UNITS
		) {
			return undefined;
		}
		seen.add(equivalent);
		tokens.push(equivalent === "dim" ? "dim" : token);
		codeUnits += separator + token.length;
	}
	return tokens.join(" ");
}

function renderTier(
	theme: ThemeLike,
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
	tier: Tier,
	text: string,
): string {
	return renderStyleForSourceOrFallback(
		theme,
		config.colorSource,
		normalizeWorkingLineStyleSpec(styleForTier(colors, tier)),
		WORKING_LINE_FALLBACKS[tier],
		text,
	);
}

/** Resolve the fixed, nonanimated high-tier style used by persisted Turn summaries. */
export function renderWorkingLineHigh(
	theme: ThemeLike,
	colorSource: WorkingLineComponentConfig["colorSource"],
	style: ColorSpec | undefined,
	text: string,
): string {
	return renderStyleForSourceOrFallback(
		theme,
		colorSource,
		normalizeWorkingLineStyleSpec(style),
		WORKING_LINE_FALLBACKS.high,
		text,
	);
}

export function snapshotWorkingLineHighStyle(
	theme: ThemeLike,
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
): string {
	const sentinel = "\u{f0000}";
	const rendered = renderWorkingLineHigh(
		theme,
		config.colorSource,
		colors.workingLineHigh,
		sentinel,
	);
	const position = rendered.indexOf(sentinel);
	const prefix = position >= 0 ? rendered.slice(0, position) : "";
	return isSafeSgrStylePrefix(prefix) ? prefix : "\x1b[1;36m";
}

function renderAnimatedText(
	theme: ThemeLike,
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
	cells: GraphemeCell[],
	width: number,
	tick: number,
	animation: WorkingLineTextAnimation,
): string {
	const runs: Array<{ tier: Tier; text: string }> = [];
	for (const cell of cells) {
		const tier =
			animation === "disabled"
				? "mid"
				: animation === "classic"
					? classicTier(cell, tick)
					: kittTier(cell, tick, width);
		const previous = runs.at(-1);
		if (previous?.tier === tier) previous.text += cell.text;
		else runs.push({ tier, text: cell.text });
	}
	return runs.map((run) => renderTier(theme, config, colors, run.tier, run.text)).join("");
}

export type WorkingLineRuntimeSegments = {
	tool?: string;
	elapsedMs?: number;
	thought?: { durationMs: number; active: boolean };
	tokens?: { input: number; output: number; outputApproximate?: boolean };
};

export type WorkingLineFrameState = {
	spinnerTick: number;
	textTick: number;
};

export type WorkingLineSchedulerMetadata = {
	quantumMs: number;
	effectiveSpinnerIntervalMs: number;
	effectiveTextIntervalMs?: number;
	exact: boolean;
	spinnerSeamless: boolean;
	textSeamless: boolean;
	spinnerAdvances: number;
	textAdvances: number;
};

export type WorkingLineFrames = {
	frames: string[];
	frameStates: WorkingLineFrameState[];
	intervalMs: number;
	message: string;
	row: string;
	textAnimation: WorkingLineTextAnimation;
	textWidth: number;
	textOrigin: number;
	scheduler: WorkingLineSchedulerMetadata;
};

export function formatWorkingLineElapsed(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0)
		return `${hours}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
	if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
	return `${seconds}s`;
}

export function formatWorkingLineThought(
	thought: NonNullable<WorkingLineRuntimeSegments["thought"]>,
): string | undefined {
	if (!thought.active && thought.durationMs <= 0) return undefined;
	return `${thought.active ? "thinking" : "thought for"} ${formatWorkingLineElapsed(thought.durationMs)}`;
}

export function normalizeWorkingLineToolLabel(value: unknown): string {
	const normalized = normalizeWorkingLineMessage(value);
	if (visibleWidth(normalized) <= MAX_WORKING_LINE_TOOL_CELLS) return normalized;
	const prefix = truncateGraphemes(normalized, MAX_WORKING_LINE_TOOL_CELLS - 1);
	return prefix ? `${prefix}…` : "";
}

export function formatWorkingLineTokens(
	tokens: WorkingLineRuntimeSegments["tokens"],
): string | undefined {
	if (
		!tokens ||
		!Number.isSafeInteger(tokens.input) ||
		!Number.isSafeInteger(tokens.output) ||
		tokens.input < 0 ||
		tokens.output < 0 ||
		(tokens.outputApproximate !== undefined && typeof tokens.outputApproximate !== "boolean")
	) {
		return undefined;
	}
	return `↑${formatCount(tokens.input)} ↓${formatCount(tokens.output)}`;
}

function truncateWithEllipsis(value: string, capacity: number): string {
	if (visibleWidth(value) <= capacity) return value;
	if (capacity <= 0) return "";
	if (capacity === 1) return "…";
	const prefix = truncateGraphemes(value, capacity - 1);
	return prefix ? `${prefix}…` : "";
}

export type ComposedWorkingLine = { message: string; row: string };

/** Validate and measure the fixed visible width shared by every frame in a preset. */
export function workingLineSpinnerWidth(spinnerId: WorkingLineComponentConfig["spinner"]): number {
	const frames: readonly string[] = WORKING_LINE_SPINNERS[spinnerId].frames;
	const width = visibleWidth(frames[0] ?? "");
	if (width <= 0 || frames.some((frame) => visibleWidth(frame) !== width)) {
		throw new Error("Working-line spinner frames must share a positive fixed width");
	}
	return width;
}

/** Compose visual Message · Tool · Elapsed · Thought · Tokens order with tokens reserved first. */
export function composeWorkingLineRow(
	config: WorkingLineComponentConfig,
	message: string,
	runtime: WorkingLineRuntimeSegments = {},
): ComposedWorkingLine {
	const normalized = normalizeWorkingLineMessage(message) || WORKING_LINE_FALLBACK_MESSAGE;
	const maximumRowCells =
		MAX_WORKING_LINE_FRAME_CELLS - workingLineSpinnerWidth(config.spinner) - visibleWidth(" ");
	const delimiter = " · ";
	const tokens = config.segments.tokens ? formatWorkingLineTokens(runtime.tokens) : undefined;
	const mandatoryWidth = tokens ? visibleWidth(delimiter) + visibleWidth(tokens) : 0;
	const messageCapacity = maximumRowCells - mandatoryWidth;
	const fittedMessage = truncateWithEllipsis(normalized, messageCapacity);
	const segments: string[] = [fittedMessage];
	let remaining = maximumRowCells - visibleWidth(fittedMessage) - mandatoryWidth;
	const elapsed =
		config.segments.elapsed && runtime.elapsedMs !== undefined
			? formatWorkingLineElapsed(runtime.elapsedMs)
			: undefined;
	const thought =
		config.segments.thought && runtime.thought
			? formatWorkingLineThought(runtime.thought)
			: undefined;
	const tool =
		config.segments.tool && runtime.tool ? normalizeWorkingLineToolLabel(runtime.tool) : undefined;
	const accepted = new Set<"thought" | "elapsed" | "tool">();
	for (const [key, label] of [
		["thought", thought],
		["elapsed", elapsed],
	] as const) {
		if (label && remaining >= visibleWidth(delimiter) + visibleWidth(label)) {
			remaining -= visibleWidth(delimiter) + visibleWidth(label);
			accepted.add(key);
		}
	}
	let fittedTool = "";
	if (tool && remaining > visibleWidth(delimiter)) {
		fittedTool = truncateWithEllipsis(tool, remaining - visibleWidth(delimiter));
		if (fittedTool) accepted.add("tool");
	}
	if (accepted.has("tool")) segments.push(fittedTool);
	if (accepted.has("elapsed") && elapsed) segments.push(elapsed);
	if (accepted.has("thought") && thought) segments.push(thought);
	if (tokens) segments.push(tokens);
	return { message: normalized, row: segments.filter(Boolean).join(delimiter) };
}

type ScheduleDefinition = {
	frameCount: number;
	stateAt: (index: number) => WorkingLineFrameState;
	metadata: WorkingLineSchedulerMetadata;
};

function exactSchedule(
	spinnerIntervalMs: number,
	textIntervalMs: number,
	spinnerCycle: number,
	textCycle: number,
): ScheduleDefinition {
	const quantumMs = Math.max(30, gcd(spinnerIntervalMs, textIntervalMs));
	const spinnerPeriod = schedulePeriod(spinnerIntervalMs, spinnerCycle, quantumMs);
	const textSchedulePeriod = schedulePeriod(textIntervalMs, textCycle, quantumMs);
	const frameCount = lcm(spinnerPeriod, textSchedulePeriod);
	return {
		frameCount,
		stateAt: (index) => ({
			spinnerTick: Math.floor((index * quantumMs) / spinnerIntervalMs),
			textTick: Math.floor((index * quantumMs) / textIntervalMs),
		}),
		metadata: {
			quantumMs,
			effectiveSpinnerIntervalMs: spinnerIntervalMs,
			effectiveTextIntervalMs: textIntervalMs,
			exact: true,
			spinnerSeamless: true,
			textSeamless: true,
			spinnerAdvances: (frameCount * quantumMs) / spinnerIntervalMs,
			textAdvances: (frameCount * quantumMs) / textIntervalMs,
		},
	};
}

function fallbackSchedule(
	frameCount: number,
	quantumMs: number,
	spinnerIntervalMs: number,
	textIntervalMs: number,
	spinnerCycle: number,
	textCycle: number,
): ScheduleDefinition {
	const idealSpinnerAdvances = (frameCount * quantumMs) / spinnerIntervalMs;
	const spinnerAdvances = Math.max(
		spinnerCycle,
		Math.round(idealSpinnerAdvances / spinnerCycle) * spinnerCycle,
	);
	const textAdvances = Math.max(1, Math.round((frameCount * quantumMs) / textIntervalMs));
	return {
		frameCount,
		stateAt: (index) => ({
			spinnerTick: Math.floor((index * spinnerAdvances) / frameCount),
			textTick: Math.floor((index * textAdvances) / frameCount),
		}),
		metadata: {
			quantumMs,
			effectiveSpinnerIntervalMs: (frameCount * quantumMs) / spinnerAdvances,
			effectiveTextIntervalMs: (frameCount * quantumMs) / textAdvances,
			exact: false,
			spinnerSeamless: spinnerAdvances % spinnerCycle === 0,
			textSeamless: textAdvances % textCycle === 0,
			spinnerAdvances,
			textAdvances,
		},
	};
}

function bestFallbackFrameCount(
	maximum: number,
	quantumMs: number,
	spinnerIntervalMs: number,
	spinnerCycle: number,
): number {
	let best = 1;
	let bestError = Number.POSITIVE_INFINITY;
	for (let count = 1; count <= maximum; count += 1) {
		const advances = Math.max(
			spinnerCycle,
			Math.round((count * quantumMs) / spinnerIntervalMs / spinnerCycle) * spinnerCycle,
		);
		const effective = (count * quantumMs) / advances;
		const error = Math.abs(effective - spinnerIntervalMs);
		if (error < bestError || (error === bestError && count > best)) {
			best = count;
			bestError = error;
		}
	}
	return best;
}

function renderWorkingLineSchedule(
	definition: ScheduleDefinition,
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
	theme: ThemeLike,
	row: string,
	width: number,
	textCycle: number,
	spinnerStartTick: number,
	textStartTick: number,
	scheduleStartFrame: number,
): { frames: string[]; frameStates: WorkingLineFrameState[] } | undefined {
	const spinner = WORKING_LINE_SPINNERS[config.spinner];
	const frames: string[] = [];
	const frameStates: WorkingLineFrameState[] = [];
	let codeUnits = 0;
	const scheduleOrigin = definition.stateAt(scheduleStartFrame);
	for (let index = 0; index < definition.frameCount; index += 1) {
		const scheduled = definition.stateAt(scheduleStartFrame + index);
		const state = {
			spinnerTick: spinnerStartTick + scheduled.spinnerTick - scheduleOrigin.spinnerTick,
			textTick: normalizedPhaseTick(
				textStartTick + scheduled.textTick - scheduleOrigin.textTick,
				textCycle,
			),
		};
		const spinnerGlyph =
			spinner.frames[state.spinnerTick % spinner.frames.length] ?? spinner.frames[0];
		const frame = config.animateSpinnerColor
			? `${renderAnimatedText(
					theme,
					config,
					colors,
					graphemeCells(`${spinnerGlyph} ${row}`).cells,
					width,
					state.textTick,
					config.textAnimation,
				)}${SGR_RESET}`
			: `${renderTier(theme, config, colors, "high", spinnerGlyph)} ${renderAnimatedText(
					theme,
					config,
					colors,
					graphemeCells(row).cells,
					width,
					state.textTick,
					config.textAnimation,
				)}${SGR_RESET}`;
		codeUnits += frame.length;
		if (codeUnits > MAX_WORKING_LINE_FRAME_CODE_UNITS) return undefined;
		frames.push(frame);
		frameStates.push(state);
	}
	return { frames, frameStates };
}

export function buildWorkingLineFrames(
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
	theme: ThemeLike,
	message: string,
	runtime: WorkingLineRuntimeSegments = {},
	spinnerStartTick = 0,
	textStartTick = spinnerStartTick,
	scheduleStartFrame = 0,
): WorkingLineFrames {
	const composed = composeWorkingLineRow(config, message, runtime);
	const spinner = WORKING_LINE_SPINNERS[config.spinner];
	const spinnerWidth = workingLineSpinnerWidth(config.spinner);
	const { width: rowWidth } = graphemeCells(composed.row);
	const frameWidth = spinnerWidth + visibleWidth(" ") + rowWidth;
	if (frameWidth > MAX_WORKING_LINE_FRAME_CELLS) {
		throw new Error("Working-line row exceeds its visible-width cap");
	}
	const spinnerPhase = Number.isFinite(spinnerStartTick)
		? Math.max(0, Math.floor(spinnerStartTick))
		: 0;
	const animatedTextWidth = config.animateSpinnerColor ? frameWidth : rowWidth;
	const textOrigin = config.animateSpinnerColor ? 0 : spinnerWidth + visibleWidth(" ");
	const textCycle = textPeriod(config.textAnimation, animatedTextWidth);
	const textPhase = normalizedPhaseTick(textStartTick, textCycle);

	if (config.textAnimation === "disabled") {
		const frameStates = Array.from({ length: spinner.frames.length }, (_, index) => ({
			spinnerTick: spinnerPhase + index,
			textTick: 0,
		}));
		let codeUnits = 0;
		const frames = frameStates.map((state) => {
			const glyph = spinner.frames[state.spinnerTick % spinner.frames.length] ?? spinner.frames[0];
			const frame = `${renderAnimatedText(
				theme,
				config,
				colors,
				graphemeCells(`${glyph} ${composed.row}`).cells,
				frameWidth,
				0,
				"disabled",
			)}${SGR_RESET}`;
			codeUnits += frame.length;
			if (codeUnits > MAX_WORKING_LINE_FRAME_CODE_UNITS)
				throw new Error("Working-line animation exceeds its memory cap");
			return frame;
		});
		return {
			frames,
			frameStates,
			intervalMs: config.spinnerIntervalMs,
			message: composed.message,
			row: composed.row,
			textAnimation: config.textAnimation,
			textWidth: frameWidth,
			textOrigin: 0,
			scheduler: {
				quantumMs: config.spinnerIntervalMs,
				effectiveSpinnerIntervalMs: config.spinnerIntervalMs,
				exact: true,
				spinnerSeamless: true,
				textSeamless: true,
				spinnerAdvances: spinner.frames.length,
				textAdvances: 0,
			},
		};
	}

	const exact = exactSchedule(
		config.spinnerIntervalMs,
		config.textIntervalMs,
		spinner.frames.length,
		textCycle,
	);
	if (exact.frameCount <= MAX_WORKING_LINE_FRAMES) {
		const rendered = renderWorkingLineSchedule(
			exact,
			config,
			colors,
			theme,
			composed.row,
			animatedTextWidth,
			textCycle,
			spinnerPhase,
			textPhase,
			scheduleStartFrame,
		);
		if (rendered) {
			return {
				...rendered,
				intervalMs: exact.metadata.quantumMs,
				message: composed.message,
				row: composed.row,
				textAnimation: config.textAnimation,
				textWidth: animatedTextWidth,
				textOrigin,
				scheduler: exact.metadata,
			};
		}
	}

	const quantumMs = exact.metadata.quantumMs;
	let maximum = MAX_WORKING_LINE_FRAMES;
	while (maximum > 0) {
		const frameCount = bestFallbackFrameCount(
			maximum,
			quantumMs,
			config.spinnerIntervalMs,
			spinner.frames.length,
		);
		const fallback = fallbackSchedule(
			frameCount,
			quantumMs,
			config.spinnerIntervalMs,
			config.textIntervalMs,
			spinner.frames.length,
			textCycle,
		);
		const rendered = renderWorkingLineSchedule(
			fallback,
			config,
			colors,
			theme,
			composed.row,
			animatedTextWidth,
			textCycle,
			spinnerPhase,
			textPhase,
			scheduleStartFrame,
		);
		if (rendered) {
			return {
				...rendered,
				intervalMs: quantumMs,
				message: composed.message,
				row: composed.row,
				textAnimation: config.textAnimation,
				textWidth: animatedTextWidth,
				textOrigin,
				scheduler: fallback.metadata,
			};
		}
		maximum = frameCount - 1;
	}
	throw new Error("Working-line animation exceeds its memory cap");
}

export function buildWorkingLineSpinnerFrames(
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
	theme: ThemeLike,
	startTick = 0,
): { frames: string[]; frameStates: WorkingLineFrameState[]; intervalMs: number } {
	const spinner = WORKING_LINE_SPINNERS[config.spinner];
	workingLineSpinnerWidth(config.spinner);
	const phase = Number.isFinite(startTick) ? Math.max(0, Math.floor(startTick)) : 0;
	const frameStates = Array.from({ length: spinner.frames.length }, (_, index) => ({
		spinnerTick: phase + index,
		textTick: 0,
	}));
	const frames = frameStates.map((state) => {
		const glyph = spinner.frames[state.spinnerTick % spinner.frames.length] ?? spinner.frames[0];
		return `${renderTier(theme, config, colors, "high", glyph)}${SGR_RESET}`;
	});
	return { frames, frameStates, intervalMs: config.spinnerIntervalMs };
}

export function buildWorkingLinePreviewFrames(
	config: WorkingLineComponentConfig,
	colors: PolishedTuiColors,
	theme: ThemeLike,
	spinnerStartTick = 0,
	textStartTick = spinnerStartTick,
): WorkingLineFrames {
	const message = effectiveWorkingLineMessages(config)[0] ?? WORKING_LINE_FALLBACK_MESSAGE;
	return buildWorkingLineFrames(
		config,
		colors,
		theme,
		message,
		{
			tool: "read",
			elapsedMs: 62_000,
			thought: { durationMs: 10_000, active: true },
			tokens: { input: 1234, output: 56 },
		},
		spinnerStartTick,
		textStartTick,
	);
}

function workingLineUi(ctx: WorkingLineContext): WorkingLineUi | undefined {
	if (ctx.hasUI === false || (ctx.mode !== undefined && ctx.mode !== "tui")) return undefined;
	const ui = ctx.ui as unknown as Partial<WorkingLineUi>;
	if (typeof ui.setWorkingMessage !== "function" || typeof ui.setWorkingIndicator !== "function") {
		return undefined;
	}
	return ui as WorkingLineUi;
}

export type WorkingLineReconcileResult = { applied: boolean; reason?: string };

type InstalledAnimationPhase = {
	/** Logical beginning of the dwell for frameStates[0]. */
	frameEpochMs: number;
	/** Scheduler frame represented by frameStates[0], retained across array rebuilds. */
	scheduleFrame: number;
	intervalMs: number;
	frameStates: WorkingLineFrameState[];
	textAnimation: WorkingLineTextAnimation;
	textWidth: number;
	textOrigin: number;
};

type WorkingIndicatorOptions = { frames?: string[]; intervalMs?: number };

type InstallationSnapshot = {
	installed: boolean;
	ownsIndicator: boolean;
	ownsMessage: boolean;
	selectedMessage: string | undefined;
	frameKey: string | undefined;
	installedPhase: InstalledAnimationPhase | undefined;
	indicatorOptions: WorkingIndicatorOptions | undefined;
	elapsedUpdatesActive: boolean;
	elapsedUpdatesContext: WorkingLineContext | undefined;
	elapsedUpdatesGeneration: number;
	stopElapsedUpdates: (() => void) | undefined;
};

/** Owns Pi's public, unkeyed working-row message and indicator configuration. */
export class WorkingLineController {
	private installed = false;
	private ownsIndicator = false;
	private ownsMessage = false;
	private agentActive = false;
	private selectedMessage: string | undefined;
	private frameKey: string | undefined;
	private installedPhase: InstalledAnimationPhase | undefined;
	private installedIndicatorOptions: WorkingIndicatorOptions | undefined;
	private tokens: WorkingLineRuntimeSegments["tokens"];
	private thought: WorkingLineRuntimeSegments["thought"];
	private readonly activeTools = new Map<string, string>();
	private elapsedUpdatesActive = false;
	private elapsedUpdatesContext: WorkingLineContext | undefined;
	private elapsedUpdatesGeneration = 0;
	private stopElapsedUpdates: (() => void) | undefined;

	constructor(
		private readonly getConfig: () => ZentuiConfig,
		private readonly getTheme: () => ThemeLike,
		private readonly durationClock: AgentDurationClock = new AgentDurationClock(),
		private readonly random: () => number = Math.random,
		private readonly now: () => number = Date.now,
		private readonly getThought: () => WorkingLineRuntimeSegments["thought"] = () => this.thought,
	) {}

	startSession(ctx: WorkingLineContext): WorkingLineReconcileResult {
		this.clearRuntime();
		this.selectedMessage = undefined;
		this.installedPhase = undefined;
		if (!this.getConfig().components.workingLine.enabled) return { applied: true };
		return this.install(ctx);
	}

	startAgent(ctx: WorkingLineContext): void {
		this.agentActive = true;
		this.activeTools.clear();
		if (this.getConfig().components.workingLine.enabled) {
			// Pi emits extension handlers before constructing its Loader. Force and rebase the
			// stored indicator so the subsequently constructed Loader begins at intended frame zero.
			this.install(ctx, true, true);
		}
		this.reconcileElapsedUpdates(ctx);
	}

	startTurn(ctx: WorkingLineContext): WorkingLineReconcileResult {
		const config = this.getConfig().components.workingLine;
		this.activeTools.clear();
		const selectedMessage = selectWorkingLineMessage(config, this.random);
		if (!config.enabled) {
			this.selectedMessage = selectedMessage;
			return { applied: true };
		}
		return this.install(ctx, false, false, selectedMessage);
	}

	updateMetrics(
		tokens: WorkingLineRuntimeSegments["tokens"],
		thought: WorkingLineRuntimeSegments["thought"],
		ctx: WorkingLineContext,
	): void {
		this.tokens = tokens;
		this.thought = thought;
		this.updateIndicator(ctx);
		this.reconcileElapsedUpdates(ctx);
	}

	updateTokens(tokens: WorkingLineRuntimeSegments["tokens"], ctx: WorkingLineContext): void {
		this.updateMetrics(tokens, this.getThought(), ctx);
	}

	startTool(toolCallId: string, toolName: string, ctx: WorkingLineContext): void {
		this.activeTools.delete(toolCallId);
		this.activeTools.set(toolCallId, normalizeWorkingLineToolLabel(toolName));
		this.updateIndicator(ctx);
	}

	finishTool(toolCallId: string, ctx: WorkingLineContext): void {
		this.activeTools.delete(toolCallId);
		this.updateIndicator(ctx);
	}

	finishAgent(ctx: WorkingLineContext): void {
		this.agentActive = false;
		this.activeTools.clear();
		this.deactivateElapsedUpdates();
		this.updateIndicator(ctx);
	}

	settle(
		tokens: WorkingLineRuntimeSegments["tokens"],
		thought: WorkingLineRuntimeSegments["thought"],
		ctx: WorkingLineContext,
	): void {
		this.tokens = tokens;
		this.thought = thought;
		this.updateIndicator(ctx);
		this.reconcileElapsedUpdates(ctx);
	}

	reconcile(ctx: WorkingLineContext): WorkingLineReconcileResult {
		const config = this.getConfig().components.workingLine;
		if (!config.enabled) {
			this.reset(ctx);
			return { applied: true };
		}
		const effective = effectiveWorkingLineMessages(config);
		const selectedMessage =
			this.selectedMessage && effective.includes(this.selectedMessage)
				? this.selectedMessage
				: (effective[0] ?? WORKING_LINE_FALLBACK_MESSAGE);
		return this.install(ctx, false, false, selectedMessage);
	}

	dispose(ctx: WorkingLineContext): void {
		this.reset(ctx);
		this.clearRuntime();
		this.selectedMessage = undefined;
		this.installedPhase = undefined;
	}

	currentMessage(): string | undefined {
		return this.selectedMessage;
	}

	private install(
		ctx: WorkingLineContext,
		forceIndicator = false,
		rebasePhase = false,
		selectedMessage?: string,
	): WorkingLineReconcileResult {
		const ui = workingLineUi(ctx);
		if (!ui) {
			this.installed = false;
			this.deactivateElapsedUpdates();
			return { applied: false, reason: "Working line requires a newer Pi TUI" };
		}
		const rootConfig = this.getConfig();
		const config = rootConfig.components.workingLine;
		const nextMessage =
			selectedMessage ?? this.selectedMessage ?? effectiveWorkingLineMessages(config)[0];
		const snapshot = this.installationSnapshot();
		try {
			if (!this.ownsMessage) {
				this.ownsMessage = true;
				ui.setWorkingMessage("");
			}
			this.applyIndicator(ui, rootConfig, nextMessage, forceIndicator, rebasePhase);
			this.selectedMessage = nextMessage;
			this.reconcileElapsedUpdates(ctx);
			return { applied: true };
		} catch {
			this.recoverOrReleaseAfterFailure(ui, snapshot);
			return { applied: false, reason: "Pi could not apply the Working line" };
		}
	}

	private makeFrameKey(rootConfig: ZentuiConfig, selectedMessage: string | undefined): string {
		const config = rootConfig.components.workingLine;
		const { row } = composeWorkingLineRow(
			config,
			selectedMessage ?? WORKING_LINE_FALLBACK_MESSAGE,
			this.runtimeSegments(),
		);
		return JSON.stringify([
			"owned",
			config.spinner,
			config.spinnerIntervalMs,
			...(config.textAnimation === "disabled"
				? [config.textAnimation, config.colorSource, rootConfig.colors.workingLineMid]
				: [
						config.textIntervalMs,
						config.textAnimation,
						config.animateSpinnerColor,
						config.colorSource,
						rootConfig.colors.workingLineLow,
						rootConfig.colors.workingLineMid,
						rootConfig.colors.workingLineHigh,
					]),
			row,
		]);
	}

	private runtimeSegments(): WorkingLineRuntimeSegments {
		const thought = this.getThought() ?? this.thought;
		return {
			tool: [...this.activeTools.values()].at(-1),
			elapsedMs: this.agentActive ? this.durationClock.elapsedMs() : undefined,
			thought,
			tokens: this.tokens,
		};
	}

	private applyIndicator(
		ui: WorkingLineUi,
		rootConfig: ZentuiConfig,
		selectedMessage = this.selectedMessage,
		force = false,
		rebase = false,
	): void {
		const key = this.makeFrameKey(rootConfig, selectedMessage);
		if (!force && this.installed && this.frameKey === key) return;
		const config = rootConfig.components.workingLine;
		const sampledAtMs = this.now();
		let spinnerTick = 0;
		let spatial: TextSpatialPhase | undefined;
		let scheduleStartFrame = 0;
		let intervalFraction = 0;
		if (!rebase && this.installedPhase && this.installedPhase.frameStates.length > 0) {
			const elapsedMs = Math.max(0, sampledAtMs - this.installedPhase.frameEpochMs);
			const elapsedFrames = Math.floor(elapsedMs / this.installedPhase.intervalMs);
			scheduleStartFrame = this.installedPhase.scheduleFrame + elapsedFrames;
			const remainderMs = elapsedMs % this.installedPhase.intervalMs;
			intervalFraction = remainderMs / this.installedPhase.intervalMs;
			const sampled =
				this.installedPhase.frameStates[elapsedFrames % this.installedPhase.frameStates.length] ??
				this.installedPhase.frameStates[0];
			spinnerTick = sampled?.spinnerTick ?? 0;
			spatial = textSpatialPhase(
				this.installedPhase.textAnimation,
				this.installedPhase.textWidth,
				sampled?.textTick ?? 0,
			);
		}
		const message = selectedMessage ?? WORKING_LINE_FALLBACK_MESSAGE;
		const runtime = this.runtimeSegments();
		const composed = composeWorkingLineRow(config, message, runtime);
		const spinnerWidth = workingLineSpinnerWidth(config.spinner);
		const textWidth =
			config.textAnimation !== "disabled" && config.animateSpinnerColor
				? spinnerWidth + 1 + visibleWidth(composed.row)
				: config.textAnimation === "disabled"
					? spinnerWidth + 1 + visibleWidth(composed.row)
					: visibleWidth(composed.row);
		const textOrigin =
			config.textAnimation !== "disabled" && !config.animateSpinnerColor ? spinnerWidth + 1 : 0;
		const relativeSpatial = spatial
			? {
					...spatial,
					position: spatial.position + (this.installedPhase?.textOrigin ?? 0) - textOrigin,
				}
			: undefined;
		const textTick = textTickForSpatialPhase(config.textAnimation, textWidth, relativeSpatial);
		const generated = buildWorkingLineFrames(
			config,
			rootConfig.colors,
			this.getTheme(),
			message,
			runtime,
			spinnerTick,
			textTick,
			scheduleStartFrame,
		);
		// Pi's public Loader always gives replacement frame zero a full first interval. Carrying
		// the logical fractional dwell in this epoch keeps later rebuilds wall-clock-correct; the
		// visible replacement can still jitter by less than one interval because the API cannot
		// schedule a fractional first interval.
		const frameEpochMs = sampledAtMs - intervalFraction * generated.intervalMs;
		this.ownsIndicator = true;
		const indicatorOptions = { frames: generated.frames, intervalMs: generated.intervalMs };
		ui.setWorkingIndicator(indicatorOptions);
		this.installedPhase = {
			frameEpochMs: rebase ? this.now() : frameEpochMs,
			scheduleFrame: rebase ? 0 : scheduleStartFrame,
			intervalMs: generated.intervalMs,
			frameStates: generated.frameStates,
			textAnimation: generated.textAnimation,
			textWidth: generated.textWidth,
			textOrigin: generated.textOrigin,
		};
		this.installed = true;
		this.frameKey = key;
		this.installedIndicatorOptions = indicatorOptions;
	}

	private updateIndicator(ctx: WorkingLineContext): void {
		const rootConfig = this.getConfig();
		if (!rootConfig.components.workingLine.enabled || !this.installed) return;
		const ui = workingLineUi(ctx);
		if (!ui) return;
		const snapshot = this.installationSnapshot();
		try {
			this.applyIndicator(ui, rootConfig);
		} catch {
			// A transient last-writer/public-API failure must not break the agent turn.
			this.recoverOrReleaseAfterFailure(ui, snapshot);
		}
	}

	private reconcileElapsedUpdates(ctx: WorkingLineContext): void {
		this.elapsedUpdatesContext = ctx;
		const config = this.getConfig().components.workingLine;
		const thoughtActive = Boolean(this.getThought()?.active);
		const needed =
			this.installed &&
			this.agentActive &&
			config.enabled &&
			(config.segments.elapsed || (config.segments.thought && thoughtActive));
		if (!needed) {
			this.deactivateElapsedUpdates();
			return;
		}
		if (this.elapsedUpdatesActive) return;
		this.elapsedUpdatesActive = true;
		const generation = ++this.elapsedUpdatesGeneration;
		this.stopElapsedUpdates = this.durationClock.subscribe(() => {
			if (!this.elapsedUpdatesActive || generation !== this.elapsedUpdatesGeneration) return;
			const latest = this.elapsedUpdatesContext;
			if (latest) this.updateIndicator(latest);
		});
	}

	private deactivateElapsedUpdates(): void {
		this.elapsedUpdatesActive = false;
		this.elapsedUpdatesContext = undefined;
		this.elapsedUpdatesGeneration++;
		this.stopElapsedUpdates?.();
		this.stopElapsedUpdates = undefined;
	}

	private installationSnapshot(): InstallationSnapshot {
		return {
			installed: this.installed,
			ownsIndicator: this.ownsIndicator,
			ownsMessage: this.ownsMessage,
			selectedMessage: this.selectedMessage,
			frameKey: this.frameKey,
			installedPhase: this.installedPhase,
			indicatorOptions: this.installedIndicatorOptions,
			elapsedUpdatesActive: this.elapsedUpdatesActive,
			elapsedUpdatesContext: this.elapsedUpdatesContext,
			elapsedUpdatesGeneration: this.elapsedUpdatesGeneration,
			stopElapsedUpdates: this.stopElapsedUpdates,
		};
	}

	private recoverOrReleaseAfterFailure(ui: WorkingLineUi, snapshot: InstallationSnapshot): void {
		if (!snapshot.installed || !snapshot.ownsIndicator || !snapshot.indicatorOptions) {
			this.releaseAfterFailure(ui);
			return;
		}
		this.installed = snapshot.installed;
		this.ownsIndicator = snapshot.ownsIndicator;
		this.ownsMessage = snapshot.ownsMessage;
		this.selectedMessage = snapshot.selectedMessage;
		this.frameKey = snapshot.frameKey;
		this.installedPhase = snapshot.installedPhase;
		this.installedIndicatorOptions = snapshot.indicatorOptions;
		this.elapsedUpdatesActive = snapshot.elapsedUpdatesActive;
		this.elapsedUpdatesContext = snapshot.elapsedUpdatesContext;
		this.elapsedUpdatesGeneration = snapshot.elapsedUpdatesGeneration;
		this.stopElapsedUpdates = snapshot.stopElapsedUpdates;
		try {
			ui.setWorkingIndicator(snapshot.indicatorOptions);
			if (snapshot.ownsMessage) ui.setWorkingMessage("");
		} catch {
			// Recovery is deliberately direct rather than recursive. If either setter cannot
			// restore the last successful public state, release both unkeyed surfaces.
			this.releaseAfterFailure(ui);
		}
	}

	private releaseAfterFailure(ui: WorkingLineUi): void {
		this.deactivateElapsedUpdates();
		if (this.ownsIndicator) {
			try {
				ui.setWorkingIndicator();
			} catch {
				// Best-effort release after a partial public-API installation failure.
			}
		}
		if (this.ownsMessage) {
			try {
				ui.setWorkingMessage();
			} catch {
				// Best-effort release after a partial public-API installation failure.
			}
		}
		this.installed = false;
		this.ownsIndicator = false;
		this.ownsMessage = false;
		this.frameKey = undefined;
		this.installedPhase = undefined;
		this.installedIndicatorOptions = undefined;
	}

	private reset(ctx: WorkingLineContext): void {
		this.deactivateElapsedUpdates();
		if (!this.ownsIndicator && !this.ownsMessage) return;
		const ui = workingLineUi(ctx);
		if (ui && this.ownsIndicator) {
			try {
				ui.setWorkingIndicator();
			} catch {
				// Cleanup is best effort and remains idempotent.
			}
		}
		if (ui && this.ownsMessage) {
			try {
				ui.setWorkingMessage();
			} catch {
				// Cleanup is best effort and remains idempotent.
			}
		}
		this.installed = false;
		this.ownsIndicator = false;
		this.ownsMessage = false;
		this.frameKey = undefined;
		this.installedPhase = undefined;
		this.installedIndicatorOptions = undefined;
	}

	private clearRuntime(): void {
		this.deactivateElapsedUpdates();
		this.agentActive = false;
		this.activeTools.clear();
		this.tokens = undefined;
		this.thought = undefined;
	}
}
