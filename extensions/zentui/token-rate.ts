import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { InteractionMetricsTracker, parseAssistantMessageTokens } from "./interaction-summary";

export type TokenRateMessage = {
	role?: string;
	usage?: unknown;
	responseId?: unknown;
};
export type TokenRateSnapshot = Readonly<{
	tokensPerSecond: number;
	approximate: boolean;
	source: "provider" | "estimate";
	observedAt: number;
	windowMs: number;
}>;

type Sample = { at: number; output: number };
const WINDOW_MS = 3000;
const MIN_SPAN_MS = 500;
const STALE_MS = 2000;
const MAX_SAMPLES = 512;
const MAX_IDS = 256;
const MAX_BLOCKS = 128;

function identity(message: TokenRateMessage): string | undefined {
	if (typeof message.responseId !== "string" || message.responseId.length > 128) return undefined;
	return message.responseId.trim() || undefined;
}

/** Only validates event boundaries; all content counting/fingerprinting belongs to the estimator. */
function eventBoundary(
	event: AssistantMessageEvent,
): { key?: string; length?: number; delta: boolean } | undefined {
	const record = event as unknown as Record<string, unknown>;
	const type = record.type;
	if (
		type === "start" ||
		type === "text_start" ||
		type === "text_end" ||
		type === "toolcall_start" ||
		type === "toolcall_end"
	) {
		const partial = record.partial;
		if (
			!partial ||
			typeof partial !== "object" ||
			Array.isArray(partial) ||
			!Array.isArray((partial as Record<string, unknown>).content)
		)
			return undefined;
		if (
			type !== "start" &&
			(typeof record.contentIndex !== "number" ||
				!Number.isSafeInteger(record.contentIndex) ||
				record.contentIndex < 0 ||
				record.contentIndex > 65_535)
		)
			return undefined;
		if (
			type === "text_end" &&
			(typeof record.content !== "string" || record.content.length > 1_048_576)
		)
			return undefined;
		if (
			type === "toolcall_end" &&
			(!record.toolCall || typeof record.toolCall !== "object" || Array.isArray(record.toolCall))
		)
			return undefined;
		return { delta: false };
	}
	if (
		type !== "text_delta" &&
		type !== "thinking_delta" &&
		type !== "toolcall_delta" &&
		type !== "thinking_start" &&
		type !== "thinking_end"
	)
		return undefined;
	const index = record.contentIndex;
	if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index > 65_535)
		return undefined;
	const partial = record.partial;
	if (!partial || typeof partial !== "object" || Array.isArray(partial)) return undefined;
	const content = (partial as Record<string, unknown>).content;
	if (!Array.isArray(content)) return undefined;
	const delta = type.endsWith("_delta");
	if (
		type === "thinking_end" &&
		(typeof record.content !== "string" || record.content.length > 1_048_576)
	)
		return undefined;
	if (delta && (typeof record.delta !== "string" || record.delta.length > 65_536)) return undefined;
	const kind = type === "text_delta" ? "text" : type === "toolcall_delta" ? "toolCall" : "thinking";
	let length: number | undefined;
	if (kind === "toolCall" && !(index in content)) return undefined;
	if (index in content) {
		const item = content[index];
		if (!item || typeof item !== "object" || Array.isArray(item) || item.type !== kind)
			return undefined;
		if (kind === "toolCall") {
			if (
				typeof item.id !== "string" ||
				typeof item.name !== "string" ||
				!item.arguments ||
				typeof item.arguments !== "object" ||
				Array.isArray(item.arguments)
			)
				return undefined;
		} else {
			const text = kind === "text" ? item.text : item.thinking;
			if (typeof text !== "string" || text.length > 1_048_576) return undefined;
			length = text.length;
		}
	}
	return { key: `${kind}:${index}`, length, delta };
}

/** Recent generated output for one authorized response, never interaction/session throughput. */
export class TokenRateTracker {
	private estimator?: InteractionMetricsTracker;
	private run = false;
	private authorized = false;
	private responseId?: string;
	private readonly closedIds = new Set<string>();
	private lastClosedId?: string;
	private readonly lengths = new Map<string, number>();
	private samples: Sample[] = [];
	private source?: TokenRateSnapshot["source"];
	private output = 0;
	private providerInput = 0;
	private providerOutput = 0;
	private incomplete = false;
	private clock?: number;

	constructor(private readonly now: () => number = () => performance.now()) {}

	agentStart(at = this.now()): void {
		this.reset();
		this.run = true;
		this.checkTime(at);
	}

	turnStart(at = this.now()): void {
		if (!this.run) return;
		this.suspend();
		this.checkTime(at);
		this.authorized = true;
		this.estimator = new InteractionMetricsTracker(this.now);
		this.estimator.agentStart(Number.isFinite(at) ? at : 0);
		this.estimator.turnStart(Number.isFinite(at) ? at : 0);
	}

	messageUpdate(
		message: TokenRateMessage,
		event?: AssistantMessageEvent,
		at = this.now(),
	): boolean {
		if (!this.matches(message) || this.incomplete || !this.estimator) return false;
		const timeValid = this.checkTime(at);
		const before = this.output;
		const boundary = event ? eventBoundary(event) : undefined;
		if (event && !boundary) return this.invalidate();
		if (boundary?.key && boundary.delta) {
			if (!this.lengths.has(boundary.key) && this.lengths.size >= MAX_BLOCKS)
				return this.invalidate();
			const previousLength = this.lengths.get(boundary.key) ?? 0;
			if (boundary.length !== undefined && boundary.length < previousLength) {
				const changed = this.samples.length > 0;
				this.samples = [];
				return changed;
			}
			this.lengths.set(boundary.key, boundary.length ?? previousLength);
		}
		const usage = parseAssistantMessageTokens(message);
		if (message.usage !== undefined && !usage) return this.invalidate();
		if (usage && (usage.input < this.providerInput || usage.output < this.providerOutput))
			return this.invalidate();
		const providerAdvanced = !!usage && usage.output > this.providerOutput;
		const previousSource = this.source;
		// Zero-only output is not a live provider anchor, including input-only usage.
		const liveMessage = usage?.output === 0 ? { ...message, usage: undefined } : message;
		const result = this.estimator.messageUpdate(liveMessage, event, Number.isFinite(at) ? at : 0);
		if (this.estimator.diagnostics().estimateIncomplete) return this.invalidate();
		if (usage) {
			this.providerInput = usage.input;
			this.providerOutput = usage.output;
		}
		const display = result.displayTokens;
		if (!display || !Number.isSafeInteger(display.output) || display.output < before)
			return this.invalidate();
		const source = display.outputApproximate || this.providerOutput === 0 ? "estimate" : "provider";
		const correction = providerAdvanced && previousSource === "estimate";
		const transition = previousSource !== undefined && previousSource !== source;
		this.output = display.output;
		this.source = source;
		const changed = display.output > before || transition || correction;
		if (transition || correction) this.samples = [];
		if (!changed) return !timeValid || (boundary?.delta === true && result.usageChanged);
		if (!timeValid || display.output <= 0) return true;
		// An advancing provider anchor is correction, even if the estimator's floor stays approximate.
		const last = this.samples.at(-1);
		if (last?.at === at) last.output = display.output;
		else this.samples.push({ at, output: display.output });
		this.trim(at);
		if (this.samples.length > MAX_SAMPLES) return this.invalidate();
		return true;
	}

	messageEnd(message: TokenRateMessage, at = this.now()): void {
		if (!this.matches(message)) return;
		this.checkTime(at);
		this.suspend();
	}

	suspend(): void {
		if (this.authorized && this.responseId) {
			if (this.closedIds.size < MAX_IDS) this.closedIds.add(this.responseId);
			this.lastClosedId = this.responseId;
		}
		this.estimator?.shutdown();
		this.estimator = undefined;
		this.authorized = false;
		this.responseId = undefined;
		this.lengths.clear();
		this.samples = [];
		this.source = undefined;
		this.output = 0;
		this.providerInput = 0;
		this.providerOutput = 0;
		this.incomplete = false;
	}

	reset(): void {
		this.suspend();
		this.run = false;
		this.closedIds.clear();
		this.lastClosedId = undefined;
		this.clock = undefined;
	}

	shutdown(): void {
		this.reset();
	}

	snapshot(at = this.now()): TokenRateSnapshot | undefined {
		if (!this.checkTime(at) || !this.authorized || this.incomplete || !this.source)
			return undefined;
		const last = this.samples.at(-1);
		if (!last || at - last.at > STALE_MS) return undefined;
		// Keep a boundary observation in storage, but never interpolate unobserved output.
		const first = this.samples.find((sample) => sample.at >= at - WINDOW_MS);
		if (!first || first === last) return undefined;
		const windowMs = last.at - first.at;
		const difference = last.output - first.output;
		if (windowMs < MIN_SPAN_MS || difference <= 0) return undefined;
		const tokensPerSecond = (difference * 1000) / windowMs;
		if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return undefined;
		return Object.freeze({
			tokensPerSecond,
			approximate: this.source === "estimate",
			source: this.source,
			observedAt: last.at,
			windowMs,
		});
	}

	private matches(message: TokenRateMessage): boolean {
		if (!this.run || !this.authorized || message.role !== "assistant") return false;
		const key = identity(message);
		if (key && (this.closedIds.has(key) || this.lastClosedId === key)) return false;
		if (key && this.responseId && key !== this.responseId) return false;
		if (key && !this.responseId) this.responseId = key;
		return true;
	}

	private checkTime(at: number): boolean {
		const valid = Number.isFinite(at) && at >= 0 && at <= Number.MAX_SAFE_INTEGER;
		const forward = valid && (this.clock === undefined || at >= this.clock);
		if (!forward) this.samples = [];
		this.clock = valid ? at : undefined;
		return forward;
	}

	private trim(at: number): void {
		while (this.samples.length > 1 && this.samples[1].at <= at - WINDOW_MS) this.samples.shift();
	}

	private invalidate(): boolean {
		this.incomplete = true;
		this.samples = [];
		this.estimator?.shutdown();
		this.estimator = undefined;
		return true;
	}
}

export function formatTokenRate(value: TokenRateSnapshot | undefined): string {
	if (
		!value ||
		!Number.isFinite(value.tokensPerSecond) ||
		value.tokensPerSecond <= 0 ||
		!Number.isFinite(value.observedAt) ||
		value.observedAt < 0 ||
		!Number.isFinite(value.windowMs) ||
		value.windowMs < MIN_SPAN_MS ||
		value.windowMs > WINDOW_MS ||
		(value.source !== "provider" && value.source !== "estimate") ||
		value.approximate !== (value.source === "estimate")
	)
		return "";
	const rate = Math.round(value.tokensPerSecond);
	return rate > 0 ? `${value.approximate ? "~" : ""}${rate} tok/s` : "";
}
