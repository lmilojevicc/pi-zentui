import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ColorSource, ColorSpec } from "./config";
import { formatCount, formatElapsedDuration } from "./format";
import { isSafeSgrStylePrefix } from "./style";
import { renderWorkingLineHigh } from "./working-line";

export const TURN_SUMMARY_ENTRY_TYPE = "zentui-turn-summary";
const TURN_SUMMARY_VERSION = 3;
const SGR_RESET = "\x1b[0m";

export type InteractionTokens = Readonly<{ input: number; output: number }>;
export type LiveTokenDisplay = Readonly<{
	input: number;
	output: number;
	outputApproximate: boolean;
}>;
export type ThoughtSnapshot = Readonly<{ durationMs: number; active: boolean }>;

type SummaryBase = {
	durationMs: number;
	input: number;
	output: number;
};

export type TurnSummaryDataV1 = SummaryBase & { version: 1 };
export type TurnSummaryDataV2 = SummaryBase & { version: 2; stylePrefix: string };
export type TurnSummaryDataV3 = SummaryBase & {
	version: 3;
	thoughtDurationMs: number;
	stylePrefix: string;
};
export type TurnSummaryData = TurnSummaryDataV1 | TurnSummaryDataV2 | TurnSummaryDataV3;
export type TurnSummaryMetrics = SummaryBase & { thoughtDurationMs: number };

type Interval = { start: number; end: number };
type TaggedInterval = Interval & { sources: number[] };
type ThoughtCoverage = { intervals: TaggedInterval[]; incomplete: boolean };
type ThoughtBlock = { startedAt?: number; closed: boolean };

type ContentBlock = {
	acceptedLength: number;
	codePoints: number;
	pendingHighSurrogate: boolean;
	headHash: number;
	headUnits: number;
	tail: string;
	frozen: boolean;
};

type ResponseState = {
	ordinal: number;
	authorized: boolean;
	responseIdKey?: string;
	snapshot: InteractionTokens;
	hasSnapshot: boolean;
	thoughtBlocks: Map<number, ThoughtBlock>;
	contentBlocks: Map<string, ContentBlock>;
	generatedCodePoints: number;
	outputAnchor: number;
	outputAnchorCodePoints: number;
	liveOutputFloor: number;
	lastDisplay?: LiveTokenDisplay;
	estimateIncomplete: boolean;
	estimateEnabled: boolean;
};

type RunState = {
	ordinal: number;
	startedAt: number;
	ended: boolean;
	committed: InteractionTokens;
	responseOrdinal: number;
	response?: ResponseState;
	committedResponseIds: Set<string>;
	lastClosedResponseId?: string;
	lastClosedDisplay?: LiveTokenDisplay;
	responseLessClosed: boolean;
};

type InteractionState = {
	startedAt: number;
	runOrdinal: number;
	runs: RunState[];
	activeRun?: RunState;
	foldedCommitted: InteractionTokens;
	thoughtCoverage: ThoughtCoverage;
};

export type MetricsUpdateResult = {
	displayTokens?: LiveTokenDisplay;
	usageChanged: boolean;
	thoughtChanged: boolean;
};

export type MessageEndResult =
	| {
			status: "accepted";
			tokens: InteractionTokens;
			displayTokens: LiveTokenDisplay;
			source: "final" | "last-snapshot" | "no-snapshot";
	  }
	| { status: "duplicate" }
	| { status: "rejected" };

export type SettlementResult = {
	summary: TurnSummaryMetrics;
	nextStartedAt?: number;
	nextTokens?: LiveTokenDisplay;
	nextThought?: ThoughtSnapshot;
};

export type InteractionMetricsDiagnostics = Readonly<{
	runs: number;
	responseIds: number;
	activeResponses: number;
	contentBlocks: number;
	thoughtBlocks: number;
	thoughtIntervals: number;
	maxContentTailUnits: number;
	retainedContentUnits: number;
	estimateIncomplete: boolean;
}>;

const MAX_CONTENT_BLOCKS = 128;
const MAX_CONTENT_INDEX = 65_535;
const MAX_DELTA_UNITS = 65_536;
const MAX_SNAPSHOT_UNITS = 1_048_576;
const MAX_GENERATED_CODE_POINTS = 4_194_304;
const MAX_ESTIMATED_RESPONSES = 128;
const MAX_RUNS = 32;
const MAX_RESPONSE_IDS = 256;
const MAX_RESPONSE_ID_UNITS = 128;
const MAX_THOUGHT_INTERVALS = 256;
const HEAD_UNITS = 64;
const TAIL_UNITS = 64;
const HASH_OFFSET = 0x811c9dc5;

function isNonnegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeAdd(left: number, right: number): number {
	return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function estimatedTokens(codePoints: number): number {
	return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(codePoints / 4));
}

function addTokens(left: InteractionTokens, right: InteractionTokens): InteractionTokens {
	return { input: safeAdd(left.input, right.input), output: safeAdd(left.output, right.output) };
}

type InteractionMessage = { role?: string; usage?: unknown; responseId?: unknown };

export function parseAssistantMessageTokens(
	message: InteractionMessage,
): InteractionTokens | undefined {
	if (message.role !== "assistant") return undefined;
	const usage = (message as unknown as AssistantMessage).usage;
	return isNonnegativeSafeInteger(usage?.input) && isNonnegativeSafeInteger(usage?.output)
		? { input: usage.input, output: usage.output }
		: undefined;
}

function responseIdKey(message: InteractionMessage): string | undefined {
	if (typeof message.responseId !== "string") return undefined;
	const value = message.responseId;
	if (value.length > MAX_RESPONSE_ID_UNITS) return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function safeTime(value: number): number {
	if (!Number.isFinite(value)) return value > 0 ? Number.MAX_SAFE_INTEGER : 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

function durationMs(startedAt: number, now: number): number {
	const elapsed = Math.floor(now - startedAt);
	if (Number.isNaN(elapsed) || elapsed <= 0) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, elapsed);
}

function unionIntervals(intervals: readonly Interval[]): Interval[] {
	const sorted = intervals
		.filter(({ start, end }) => end > start)
		.map(({ start, end }) => ({ start: safeTime(start), end: safeTime(end) }))
		.filter(({ start, end }) => end > start)
		.sort((left, right) => left.start - right.start || left.end - right.end);
	const union: Interval[] = [];
	for (const interval of sorted) {
		const previous = union.at(-1);
		if (!previous || interval.start > previous.end) union.push({ ...interval });
		else previous.end = Math.max(previous.end, interval.end);
	}
	return union;
}

function intervalDuration(intervals: readonly Interval[]): number {
	return unionIntervals(intervals).reduce(
		(total, interval) => safeAdd(total, interval.end - interval.start),
		0,
	);
}

function sameSources(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((source, index) => source === right[index]);
}

function normalizeTaggedIntervals(intervals: readonly TaggedInterval[]): TaggedInterval[] {
	const sanitized = intervals
		.map(({ start, end, sources }) => ({
			start: safeTime(start),
			end: safeTime(end),
			sources: [...new Set(sources)].sort((left, right) => left - right),
		}))
		.filter(({ start, end, sources }) => end > start && sources.length > 0);
	const boundaries = [...new Set(sanitized.flatMap(({ start, end }) => [start, end]))].sort(
		(left, right) => left - right,
	);
	const result: TaggedInterval[] = [];
	for (let index = 0; index + 1 < boundaries.length; index++) {
		const start = boundaries[index];
		const end = boundaries[index + 1];
		if (start === undefined || end === undefined || end <= start) continue;
		const sources = [
			...new Set(
				sanitized
					.filter((interval) => interval.start < end && interval.end > start)
					.flatMap((interval) => interval.sources),
			),
		].sort((left, right) => left - right);
		if (sources.length === 0) continue;
		const previous = result.at(-1);
		if (previous && previous.end === start && sameSources(previous.sources, sources)) {
			previous.end = end;
		} else result.push({ start, end, sources });
	}
	return result;
}

function addThoughtInterval(
	coverage: ThoughtCoverage,
	interval: Interval,
	source: number,
): boolean {
	if (coverage.incomplete) return false;
	const candidate = normalizeTaggedIntervals([
		...coverage.intervals,
		{ ...interval, sources: [source] },
	]);
	if (candidate.length > MAX_THOUGHT_INTERVALS) {
		coverage.incomplete = true;
		return false;
	}
	coverage.intervals = candidate;
	return true;
}

export function subtractThoughtIntervalsWithinCap(
	source: readonly Interval[],
	removed: readonly Interval[],
): { intervals: Interval[]; incomplete: boolean } {
	let result = unionIntervals(source);
	for (const cut of unionIntervals(removed)) {
		result = result.flatMap((part) => {
			if (cut.end <= part.start || cut.start >= part.end) return [part];
			return [
				...(cut.start > part.start ? [{ start: part.start, end: cut.start }] : []),
				...(cut.end < part.end ? [{ start: cut.end, end: part.end }] : []),
			];
		});
	}
	return {
		intervals: result.slice(0, MAX_THOUGHT_INTERVALS),
		incomplete: result.length > MAX_THOUGHT_INTERVALS,
	};
}

function cappedTaggedDifference(
	source: readonly TaggedInterval[],
	removed: readonly Interval[],
): { intervals: TaggedInterval[]; incomplete: boolean } {
	let incomplete = false;
	const fragments = source.flatMap((interval) => {
		const difference = subtractThoughtIntervalsWithinCap([interval], removed);
		incomplete ||= difference.incomplete;
		return difference.intervals.map((fragment) => ({
			...fragment,
			sources: interval.sources,
		}));
	});
	const normalized = normalizeTaggedIntervals(fragments);
	return {
		intervals: normalized.slice(0, MAX_THOUGHT_INTERVALS),
		incomplete: incomplete || normalized.length > MAX_THOUGHT_INTERVALS,
	};
}

function hashUnits(value: string, start: number, end: number, seed = HASH_OFFSET): number {
	let hash = seed;
	for (let index = start; index < end; index++)
		hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
	return hash;
}

function appendCodePoints(
	value: string,
	pendingHighSurrogate: boolean,
): { codePoints: number; pendingHighSurrogate: boolean } {
	let codePoints = 0;
	let index = 0;
	if (pendingHighSurrogate) {
		if (value.length === 0) return { codePoints, pendingHighSurrogate };
		const first = value.charCodeAt(0);
		codePoints++;
		if (first >= 0xdc00 && first <= 0xdfff) index = 1;
	}
	for (; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			if (index + 1 === value.length) return { codePoints, pendingHighSurrogate: true };
			const next = value.charCodeAt(index + 1);
			codePoints++;
			if (next >= 0xdc00 && next <= 0xdfff) index++;
		} else codePoints++;
	}
	return { codePoints, pendingHighSurrogate: false };
}

function contentFingerprintMatches(block: ContentBlock, snapshot: string): boolean {
	if (block.headUnits > snapshot.length) return false;
	if (hashUnits(snapshot, 0, block.headUnits) !== block.headHash) return false;
	const tailStart = block.acceptedLength - block.tail.length;
	return snapshot.slice(tailStart, block.acceptedLength) === block.tail;
}

type ValidatedEvent = {
	type: "text_delta" | "thinking_delta" | "toolcall_delta" | "thinking_start" | "thinking_end";
	contentIndex: number;
	delta?: string;
	cumulative?: string;
	oversizedDelta: boolean;
	oversizedSnapshot: boolean;
};

function validateEvent(
	event: AssistantMessageEvent | undefined,
): ValidatedEvent | undefined | false {
	if (!event) return undefined;
	if (
		event.type !== "text_delta" &&
		event.type !== "thinking_delta" &&
		event.type !== "toolcall_delta" &&
		event.type !== "thinking_start" &&
		event.type !== "thinking_end"
	)
		return undefined;
	const record = event as unknown as Record<string, unknown>;
	if (
		!Number.isSafeInteger(record.contentIndex) ||
		(record.contentIndex as number) < 0 ||
		(record.contentIndex as number) > MAX_CONTENT_INDEX
	)
		return false;
	const partial = record.partial;
	if (!partial || typeof partial !== "object" || Array.isArray(partial)) return false;
	const content = (partial as Record<string, unknown>).content;
	if (!Array.isArray(content)) return false;
	const contentIndex = record.contentIndex as number;
	const isDelta =
		event.type === "text_delta" ||
		event.type === "thinking_delta" ||
		event.type === "toolcall_delta";
	if (isDelta && typeof record.delta !== "string") return false;
	const expectedType =
		event.type === "text_delta"
			? "text"
			: event.type === "toolcall_delta"
				? "toolCall"
				: "thinking";
	let cumulative: string | undefined;
	if (event.type === "toolcall_delta" && !(contentIndex in content)) return false;
	if (contentIndex in content) {
		const item = content[contentIndex];
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		const itemRecord = item as Record<string, unknown>;
		if (itemRecord.type !== expectedType) return false;
		if (expectedType === "toolCall") {
			if (
				typeof itemRecord.id !== "string" ||
				typeof itemRecord.name !== "string" ||
				!itemRecord.arguments ||
				typeof itemRecord.arguments !== "object" ||
				Array.isArray(itemRecord.arguments)
			)
				return false;
		} else {
			const field = expectedType === "text" ? "text" : "thinking";
			if (typeof itemRecord[field] !== "string") return false;
			cumulative = itemRecord[field] as string;
		}
	}
	const delta = isDelta ? (record.delta as string) : undefined;
	return {
		type: event.type,
		contentIndex,
		delta,
		cumulative,
		oversizedDelta: (delta?.length ?? 0) > MAX_DELTA_UNITS,
		oversizedSnapshot: (cumulative?.length ?? 0) > MAX_SNAPSHOT_UNITS,
	};
}

/** Owns provider-usage snapshots and thought-time partitioning for one settled interaction. */
export class InteractionMetricsTracker {
	private interaction?: InteractionState;

	constructor(private readonly now: () => number = Date.now) {}

	agentStart(now = this.now()): { interactionStarted: boolean } {
		const at = safeTime(now);
		const interactionStarted = this.interaction === undefined;
		if (!this.interaction) {
			this.interaction = {
				startedAt: at,
				runOrdinal: 0,
				runs: [],
				foldedCommitted: { input: 0, output: 0 },
				thoughtCoverage: { intervals: [], incomplete: false },
			};
		}
		const previous = this.interaction.activeRun;
		if (previous && !previous.ended) {
			if (previous.response) {
				this.commitSnapshot(previous, previous.response);
				this.closeResponse(previous, previous.response, at);
			}
			previous.ended = true;
		}
		this.makeRunCapacity(this.interaction);
		const ordinal = safeAdd(this.interaction.runOrdinal, 1);
		this.interaction.runOrdinal = ordinal;
		const run: RunState = {
			ordinal,
			startedAt: at,
			ended: false,
			committed: { input: 0, output: 0 },
			responseOrdinal: 0,
			committedResponseIds: new Set(),
			responseLessClosed: false,
		};
		this.interaction.runs.push(run);
		this.interaction.activeRun = run;
		return { interactionStarted };
	}

	turnStart(now = this.now()): void {
		const run = this.activeRun();
		if (!run) return;
		if (run.response) {
			this.commitSnapshot(run, run.response);
			this.closeResponse(run, run.response, now);
		}
		this.openResponse(run);
	}

	messageUpdate(
		message: InteractionMessage,
		event?: AssistantMessageEvent,
		now = this.now(),
	): MetricsUpdateResult {
		const unchanged: MetricsUpdateResult = {
			displayTokens: this.currentDisplayTokens(),
			usageChanged: false,
			thoughtChanged: false,
		};
		const run = this.activeRun();
		if (!run || message.role !== "assistant") return unchanged;
		const validated = validateEvent(event);
		if (validated === false) return unchanged;
		const tokens = parseAssistantMessageTokens(message);
		if (!tokens && !validated) return unchanged;
		const response = this.responseForUpdate(run, message);
		if (!response) return unchanged;
		let thoughtChanged = false;
		let contentChanged = false;
		if (validated) {
			if (validated.type.startsWith("thinking"))
				thoughtChanged = this.applyThoughtEvent(run, response, validated, now);
			if (
				validated.type === "text_delta" ||
				validated.type === "thinking_delta" ||
				validated.type === "toolcall_delta"
			)
				contentChanged = this.applyContentEvent(response, validated);
		}
		const usageChanged = tokens ? this.applyLiveUsage(response, tokens) : false;
		const display = this.liveDisplay(response);
		const displayChanged = !this.sameDisplay(response.lastDisplay, display);
		response.lastDisplay = display;
		return {
			displayTokens: display,
			usageChanged: usageChanged || contentChanged || displayChanged,
			thoughtChanged,
		};
	}

	messageEnd(message: InteractionMessage, now = this.now()): MessageEndResult {
		const run = this.activeRun();
		if (!run || message.role !== "assistant") return { status: "rejected" };
		const tokens = parseAssistantMessageTokens(message);
		const key = responseIdKey(message);
		const response = run.response;
		if (!response?.authorized) return { status: "rejected" };
		if (key && this.isDuplicateId(run, key)) return { status: "duplicate" };
		if (response.responseIdKey && key && response.responseIdKey !== key)
			return { status: "rejected" };
		if (!response.responseIdKey && key) response.responseIdKey = key;
		const preCloseDisplay = this.liveDisplay(response);
		let source: "final" | "last-snapshot" | "no-snapshot";
		if (tokens) {
			response.snapshot = tokens;
			response.hasSnapshot = true;
			source = "final";
		} else source = response.hasSnapshot ? "last-snapshot" : "no-snapshot";
		this.commitSnapshot(run, response);
		const committed = this.totalTokens();
		const preserveEstimate = source !== "final" && response.lastDisplay?.outputApproximate === true;
		const displayTokens = preserveEstimate
			? { ...preCloseDisplay, outputApproximate: true }
			: { ...committed, outputApproximate: false };
		run.lastClosedDisplay = preserveEstimate ? displayTokens : undefined;
		this.closeResponse(run, response, now);
		return { status: "accepted", tokens: committed, displayTokens, source };
	}

	agentEnd(now = this.now()): void {
		const interaction = this.interaction;
		const run = interaction?.activeRun;
		if (!interaction || !run) return;
		if (run.response) {
			this.commitSnapshot(run, run.response);
			this.closeResponse(run, run.response, now);
		}
		run.ended = true;
		interaction.activeRun = undefined;
	}

	currentTokens(): InteractionTokens | undefined {
		return this.interaction ? this.totalTokens() : undefined;
	}

	currentDisplayTokens(): LiveTokenDisplay | undefined {
		if (!this.interaction) return undefined;
		const run = this.interaction.activeRun;
		if (run?.response) return this.liveDisplay(run.response);
		return run?.lastClosedDisplay ?? { ...this.totalTokens(), outputApproximate: false };
	}

	currentThought(now = this.now()): ThoughtSnapshot | undefined {
		if (!this.interaction) return undefined;
		return this.thoughtSnapshot(this.interaction, now);
	}

	settle(idle: boolean, now = this.now()): SettlementResult | undefined {
		const interaction = this.interaction;
		if (!interaction) return undefined;
		const at = safeTime(now);
		const splitIndex = idle
			? interaction.runs.length
			: interaction.runs.findIndex((run) => !run.ended);
		const settledCount = splitIndex < 0 ? interaction.runs.length : splitIndex;
		const hasFolded =
			interaction.foldedCommitted.input > 0 ||
			interaction.foldedCommitted.output > 0 ||
			interaction.thoughtCoverage.intervals.some((interval) => interval.sources.includes(0));
		if (settledCount === 0 && !hasFolded) return undefined;
		const settledRuns = interaction.runs.slice(0, settledCount);
		for (const run of interaction.runs) this.retainOpenThought(run, at);
		for (const run of settledRuns) {
			if (run.response) this.closeResponse(run, run.response, at);
		}
		const settledSources = new Set([0, ...settledRuns.map((run) => run.ordinal)]);
		const settledIntervals = interaction.thoughtCoverage.intervals.filter((interval) =>
			interval.sources.some((source) => settledSources.has(source)),
		);
		let tokens = interaction.foldedCommitted;
		for (const run of settledRuns) tokens = addTokens(tokens, this.runTokens(run));
		const summary: TurnSummaryMetrics = {
			durationMs: durationMs(interaction.startedAt, now),
			thoughtDurationMs: intervalDuration(settledIntervals),
			input: tokens.input,
			output: tokens.output,
		};
		const remaining = interaction.runs.slice(settledCount);
		if (remaining.length === 0) {
			this.interaction = undefined;
			return { summary };
		}
		const remainingSources = new Set(remaining.map((run) => run.ordinal));
		const remainingCoverage = interaction.thoughtCoverage.intervals
			.map((interval) => ({
				...interval,
				sources: interval.sources.filter((source) => remainingSources.has(source)),
			}))
			.filter((interval) => interval.sources.length > 0);
		const difference = cappedTaggedDifference(remainingCoverage, settledIntervals);
		for (const run of remaining) {
			for (const block of run.response?.thoughtBlocks.values() ?? []) {
				if (block.startedAt !== undefined && !block.closed) block.startedAt = at;
			}
		}
		const nextStartedAt = remaining[0]?.startedAt ?? at;
		this.interaction = {
			startedAt: nextStartedAt,
			runOrdinal: interaction.runOrdinal,
			runs: remaining,
			activeRun: remaining.find((run) => !run.ended),
			foldedCommitted: { input: 0, output: 0 },
			thoughtCoverage: {
				intervals: difference.intervals,
				incomplete: interaction.thoughtCoverage.incomplete || difference.incomplete,
			},
		};
		return {
			summary,
			nextStartedAt,
			nextTokens: this.currentDisplayTokens(),
			nextThought: this.currentThought(at),
		};
	}

	shutdown(): void {
		this.interaction = undefined;
	}

	diagnostics(): InteractionMetricsDiagnostics {
		const interaction = this.interaction;
		const responses =
			interaction?.runs.flatMap((run) => (run.response ? [run.response] : [])) ?? [];
		const blocks = responses.flatMap((response) => [...response.contentBlocks.values()]);
		return {
			runs: interaction?.runs.length ?? 0,
			responseIds:
				interaction?.runs.reduce((total, run) => total + run.committedResponseIds.size, 0) ?? 0,
			activeResponses: responses.length,
			contentBlocks: blocks.length,
			thoughtBlocks: responses.reduce((total, response) => total + response.thoughtBlocks.size, 0),
			thoughtIntervals: interaction?.thoughtCoverage.intervals.length ?? 0,
			maxContentTailUnits: blocks.reduce(
				(maximum, block) => Math.max(maximum, block.tail.length),
				0,
			),
			retainedContentUnits: blocks.reduce((total, block) => total + block.tail.length, 0),
			estimateIncomplete: responses.some((response) => response.estimateIncomplete),
		};
	}

	private activeRun(): RunState | undefined {
		const run = this.interaction?.activeRun;
		return run && !run.ended ? run : undefined;
	}

	private makeRunCapacity(interaction: InteractionState): void {
		if (interaction.runs.length < MAX_RUNS) return;
		const index = interaction.runs.findIndex((run) => run.ended);
		if (index < 0) return;
		const [run] = interaction.runs.splice(index, 1);
		if (!run) return;
		interaction.foldedCommitted = addTokens(interaction.foldedCommitted, this.runTokens(run));
		interaction.thoughtCoverage.intervals = normalizeTaggedIntervals(
			interaction.thoughtCoverage.intervals.map((interval) => ({
				...interval,
				sources: interval.sources.map((source) => (source === run.ordinal ? 0 : source)),
			})),
		);
	}

	private openResponse(run: RunState, key?: string): ResponseState {
		run.responseOrdinal = safeAdd(run.responseOrdinal, 1);
		run.lastClosedDisplay = undefined;
		const estimateEnabled =
			run.ordinal <= MAX_RUNS && run.responseOrdinal <= MAX_ESTIMATED_RESPONSES;
		const response: ResponseState = {
			ordinal: run.responseOrdinal,
			authorized: true,
			responseIdKey: key,
			snapshot: { input: 0, output: 0 },
			hasSnapshot: false,
			thoughtBlocks: new Map(),
			contentBlocks: new Map(),
			generatedCodePoints: 0,
			outputAnchor: 0,
			outputAnchorCodePoints: 0,
			liveOutputFloor: 0,
			estimateIncomplete: !estimateEnabled,
			estimateEnabled,
		};
		run.response = response;
		run.responseLessClosed = false;
		return response;
	}

	private responseForUpdate(run: RunState, message: InteractionMessage): ResponseState | undefined {
		const key = responseIdKey(message);
		const response = run.response;
		if (!response?.authorized || (key && this.isDuplicateId(run, key))) return undefined;
		if (response.responseIdKey && key && response.responseIdKey !== key) return undefined;
		if (!response.responseIdKey && key) response.responseIdKey = key;
		return response;
	}

	private isDuplicateId(run: RunState, key: string): boolean {
		return run.committedResponseIds.has(key) || run.lastClosedResponseId === key;
	}

	private applyContentEvent(response: ResponseState, event: ValidatedEvent): boolean {
		if (!response.estimateEnabled) {
			response.estimateIncomplete = true;
			return false;
		}
		if (event.oversizedDelta || event.oversizedSnapshot) {
			response.estimateIncomplete = true;
			const existing = response.contentBlocks.get(
				`${event.type === "text_delta" ? "text" : event.type === "toolcall_delta" ? "toolcall" : "thinking"}:${event.contentIndex}`,
			);
			if (existing) existing.frozen = true;
			return false;
		}
		const contentType =
			event.type === "text_delta"
				? "text"
				: event.type === "toolcall_delta"
					? "toolcall"
					: "thinking";
		const key = `${contentType}:${event.contentIndex}`;
		let block = response.contentBlocks.get(key);
		if (!block) {
			if (response.contentBlocks.size >= MAX_CONTENT_BLOCKS) {
				response.estimateIncomplete = true;
				return false;
			}
			block = {
				acceptedLength: 0,
				codePoints: 0,
				pendingHighSurrogate: false,
				headHash: HASH_OFFSET,
				headUnits: 0,
				tail: "",
				frozen: false,
			};
			response.contentBlocks.set(key, block);
		}
		if (block.frozen) return false;
		let suffix = event.delta ?? "";
		if (event.cumulative !== undefined) {
			const snapshot = event.cumulative;
			if (snapshot.length < block.acceptedLength) return false;
			if (!contentFingerprintMatches(block, snapshot)) {
				block.frozen = true;
				response.estimateIncomplete = true;
				return false;
			}
			if (snapshot.length === block.acceptedLength) return false;
			if (snapshot.length - block.acceptedLength > MAX_DELTA_UNITS) {
				block.frozen = true;
				response.estimateIncomplete = true;
				return false;
			}
			suffix = snapshot.slice(block.acceptedLength);
		}
		if (suffix.length === 0) return false;
		if (block.acceptedLength + suffix.length > MAX_SNAPSHOT_UNITS) {
			block.frozen = true;
			response.estimateIncomplete = true;
			return false;
		}
		const counted = appendCodePoints(suffix, block.pendingHighSurrogate);
		if (response.generatedCodePoints + counted.codePoints > MAX_GENERATED_CODE_POINTS) {
			block.frozen = true;
			response.estimateIncomplete = true;
			return false;
		}
		if (block.headUnits < HEAD_UNITS) {
			const taken = Math.min(HEAD_UNITS - block.headUnits, suffix.length);
			block.headHash = hashUnits(suffix, 0, taken, block.headHash);
			block.headUnits += taken;
		}
		block.tail =
			suffix.length >= TAIL_UNITS
				? suffix.slice(-TAIL_UNITS)
				: `${block.tail}${suffix}`.slice(-TAIL_UNITS);
		block.acceptedLength += suffix.length;
		block.codePoints += counted.codePoints;
		block.pendingHighSurrogate = counted.pendingHighSurrogate;
		response.generatedCodePoints += counted.codePoints;
		return true;
	}

	private applyThoughtEvent(
		run: RunState,
		response: ResponseState,
		event: ValidatedEvent,
		now: number,
	): boolean {
		const at = safeTime(now);
		let block = response.thoughtBlocks.get(event.contentIndex);
		if (!block) {
			if (response.thoughtBlocks.size >= MAX_THOUGHT_INTERVALS) return false;
			block = { closed: false };
			response.thoughtBlocks.set(event.contentIndex, block);
		}
		if (event.type === "thinking_end") {
			if (block.closed || block.startedAt === undefined) {
				block.closed = true;
				return false;
			}
			this.closeBlock(run, block, at);
			return true;
		}
		if (block.closed || block.startedAt !== undefined) return false;
		block.startedAt = at;
		return true;
	}

	private closeBlock(run: RunState, block: ThoughtBlock, now: number): void {
		if (block.closed) return;
		block.closed = true;
		if (block.startedAt === undefined) return;
		const end = safeTime(now);
		if (end <= block.startedAt || !this.interaction) return;
		addThoughtInterval(
			this.interaction.thoughtCoverage,
			{ start: block.startedAt, end },
			run.ordinal,
		);
	}

	private closeResponse(run: RunState, response: ResponseState, now: number): void {
		if (run.response !== response) return;
		for (const block of response.thoughtBlocks.values()) this.closeBlock(run, block, now);
		if (response.responseIdKey) {
			if (run.committedResponseIds.size < MAX_RESPONSE_IDS)
				run.committedResponseIds.add(response.responseIdKey);
			run.lastClosedResponseId = response.responseIdKey;
		} else run.responseLessClosed = true;
		response.authorized = false;
		response.contentBlocks.clear();
		response.thoughtBlocks.clear();
		run.response = undefined;
	}

	private commitSnapshot(run: RunState, response: ResponseState): void {
		if (!response.hasSnapshot) return;
		run.committed = addTokens(run.committed, response.snapshot);
		response.hasSnapshot = false;
	}

	private applyLiveUsage(response: ResponseState, tokens: InteractionTokens): boolean {
		if (tokens.input === 0 && tokens.output === 0) return false;
		if (
			response.hasSnapshot &&
			(tokens.input < response.snapshot.input || tokens.output < response.snapshot.output)
		)
			return false;
		if (
			response.hasSnapshot &&
			tokens.input === response.snapshot.input &&
			tokens.output === response.snapshot.output
		)
			return false;
		const outputAdvanced = !response.hasSnapshot || tokens.output > response.snapshot.output;
		response.snapshot = tokens;
		response.hasSnapshot = true;
		if (outputAdvanced) {
			response.outputAnchor = tokens.output;
			response.outputAnchorCodePoints = response.generatedCodePoints;
		}
		return true;
	}

	private liveDisplay(response: ResponseState): LiveTokenDisplay {
		const committed = this.committedTokens();
		const postAnchorCodePoints = Math.max(
			0,
			response.generatedCodePoints - response.outputAnchorCodePoints,
		);
		const candidate = safeAdd(response.outputAnchor, estimatedTokens(postAnchorCodePoints));
		const responseOutput = Math.max(response.liveOutputFloor, candidate);
		const exactCoverage =
			response.hasSnapshot &&
			postAnchorCodePoints === 0 &&
			responseOutput === response.outputAnchor &&
			!response.estimateIncomplete;
		response.liveOutputFloor = responseOutput;
		return {
			input: safeAdd(committed.input, response.hasSnapshot ? response.snapshot.input : 0),
			output: safeAdd(committed.output, responseOutput),
			outputApproximate: !exactCoverage,
		};
	}

	private runTokens(run: RunState): InteractionTokens {
		return run.response?.hasSnapshot
			? addTokens(run.committed, run.response.snapshot)
			: run.committed;
	}

	private committedTokens(): InteractionTokens {
		const interaction = this.interaction;
		if (!interaction) return { input: 0, output: 0 };
		let total = interaction.foldedCommitted;
		for (const run of interaction.runs) total = addTokens(total, run.committed);
		return total;
	}

	private totalTokens(): InteractionTokens {
		const interaction = this.interaction;
		if (!interaction) return { input: 0, output: 0 };
		let total = interaction.foldedCommitted;
		for (const run of interaction.runs) total = addTokens(total, this.runTokens(run));
		return total;
	}

	private retainOpenThought(run: RunState, now: number): void {
		const end = safeTime(now);
		for (const block of run.response?.thoughtBlocks.values() ?? []) {
			if (block.startedAt === undefined || block.closed || end <= block.startedAt) continue;
			if (this.interaction) {
				addThoughtInterval(
					this.interaction.thoughtCoverage,
					{ start: block.startedAt, end },
					run.ordinal,
				);
			}
			block.startedAt = end;
		}
	}

	private thoughtSnapshot(interaction: InteractionState, now: number): ThoughtSnapshot {
		const coverage: ThoughtCoverage = {
			intervals: interaction.thoughtCoverage.intervals.map((interval) => ({
				...interval,
				sources: [...interval.sources],
			})),
			incomplete: interaction.thoughtCoverage.incomplete,
		};
		for (const run of interaction.runs) {
			for (const block of run.response?.thoughtBlocks.values() ?? []) {
				if (block.startedAt === undefined || block.closed) continue;
				addThoughtInterval(coverage, { start: block.startedAt, end: safeTime(now) }, run.ordinal);
			}
		}
		return {
			durationMs: intervalDuration(coverage.intervals),
			active: interaction.runs.some((run) =>
				[...(run.response?.thoughtBlocks.values() ?? [])].some(
					(block) => block.startedAt !== undefined && !block.closed,
				),
			),
		};
	}

	private sameDisplay(
		left: LiveTokenDisplay | undefined,
		right: LiveTokenDisplay | undefined,
	): boolean {
		return (
			left?.input === right?.input &&
			left?.output === right?.output &&
			left?.outputApproximate === right?.outputApproximate
		);
	}
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
	return Object.keys(record).sort().join("\0") === [...expected].sort().join("\0");
}

export function isTurnSummaryData(value: unknown): value is TurnSummaryData {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (
		!isNonnegativeSafeInteger(record.durationMs) ||
		!isNonnegativeSafeInteger(record.input) ||
		!isNonnegativeSafeInteger(record.output)
	)
		return false;
	if (record.version === 1) {
		return hasExactKeys(record, ["version", "durationMs", "input", "output"]);
	}
	if (record.version === 2) {
		return (
			hasExactKeys(record, ["version", "durationMs", "input", "output", "stylePrefix"]) &&
			isSafeSgrStylePrefix(record.stylePrefix)
		);
	}
	return (
		record.version === TURN_SUMMARY_VERSION &&
		hasExactKeys(record, [
			"version",
			"durationMs",
			"thoughtDurationMs",
			"input",
			"output",
			"stylePrefix",
		]) &&
		isNonnegativeSafeInteger(record.thoughtDurationMs) &&
		isSafeSgrStylePrefix(record.stylePrefix)
	);
}

export function formatTurnSummary(data: TurnSummaryData | TurnSummaryMetrics): string {
	const thought =
		"thoughtDurationMs" in data && data.thoughtDurationMs > 0
			? ` · thought for ${formatElapsedDuration(data.thoughtDurationMs)}`
			: "";
	return ` Turn took ${formatElapsedDuration(data.durationMs)}${thought} · ↑${formatCount(data.input)} ↓${formatCount(data.output)}`;
}

export function renderTurnSummaryEntry(
	entry: { data?: unknown },
	themeOptions: unknown,
	theme: Pick<Theme, "fg">,
): Text | undefined {
	if (!isTurnSummaryData(entry.data)) return undefined;
	const text = formatTurnSummary(entry.data);
	if (entry.data.version === 2 || entry.data.version === 3) {
		return new Text(`${entry.data.stylePrefix}${text}${SGR_RESET}`, 0, 0);
	}
	const options = (themeOptions ?? {}) as {
		colorSource?: ColorSource;
		workingLineHigh?: ColorSpec;
	};
	return new Text(
		`${renderWorkingLineHigh(
			theme,
			options.colorSource === "terminal" ? "terminal" : "theme",
			options.workingLineHigh,
			text,
		)}${SGR_RESET}`,
		0,
		0,
	);
}
