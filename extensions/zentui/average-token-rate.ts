import { type MessageEndResult, parseAssistantMessageTokens } from "./interaction-summary";
import type { TokenRateMessage } from "./token-rate";

type FinalMessage = TokenRateMessage & { stopReason?: unknown };
type CompletedWork = { output: number; elapsedMs: number; unknown: boolean };

function emptyCompletedWork(): CompletedWork {
	return { output: 0, elapsedMs: 0, unknown: false };
}

function combineCompletedWork(prior: CompletedWork, current: CompletedWork): CompletedWork {
	const output = prior.output + current.output;
	const elapsedMs = prior.elapsedMs + current.elapsedMs;
	if (
		!Number.isSafeInteger(output) ||
		!Number.isFinite(elapsedMs) ||
		elapsedMs > Number.MAX_SAFE_INTEGER
	)
		return { ...prior, unknown: true };
	return { output, elapsedMs, unknown: prior.unknown || current.unknown };
}

function averageCompletedWork(completed: CompletedWork): number | undefined {
	return !completed.unknown && completed.elapsedMs > 0
		? (completed.output * 1000) / completed.elapsedMs
		: undefined;
}

/** Provider final output / summed turn_start -> accepted message_end observations.
 * Includes initial wait and client preparation, not just backend decoding. No tool/gap time.
 * Acceptance and response identity belong to InteractionMetricsTracker, not this accumulator.
 */
export class AverageTokenRateTracker {
	/** Only the latest run can survive non-idle settlement; older runs fold in constant space. */
	private priorRuns = emptyCompletedWork();
	private currentRun = emptyCompletedWork();
	private enabled = false;
	private startedAt?: number;
	private clock?: number;
	private priorClock?: number;

	constructor(private readonly now: () => number = () => performance.now()) {}

	agentStart(interactionStarted: boolean): void {
		if (interactionStarted) this.reset();
		else {
			this.suspend();
			this.priorRuns = combineCompletedWork(this.priorRuns, this.currentRun);
			this.currentRun = emptyCompletedWork();
			this.priorClock = this.clock ?? this.priorClock;
			this.clock = undefined;
		}
		this.enabled = true;
	}

	turnStart(at = this.now()): void {
		this.suspend();
		this.enabled = true;
		this.observeTime(at);
		this.startedAt = at;
	}

	observeTime(at = this.now()): void {
		if (!this.enabled) return;
		// Cross-run clock ordering is relevant only while those prior runs remain included.
		if (this.clock === undefined && this.priorClock !== undefined && at < this.priorClock)
			this.priorRuns.unknown = true;
		if (
			!Number.isFinite(at) ||
			at < 0 ||
			at > Number.MAX_SAFE_INTEGER ||
			(this.clock !== undefined && at < this.clock)
		)
			this.currentRun.unknown = true;
		this.clock = at;
	}

	messageEnd(message: FinalMessage, result: MessageEndResult, at = this.now()): void {
		if (result.status !== "accepted" || !this.enabled) return;
		this.observeTime(at);
		const elapsed = this.startedAt === undefined ? NaN : at - this.startedAt;
		this.startedAt = undefined;
		const usage = result.source === "final" ? parseAssistantMessageTokens(message) : undefined;
		const failedPlaceholder =
			(message.stopReason === "error" || message.stopReason === "aborted") &&
			usage?.input === 0 &&
			usage.output === 0;
		if (
			!usage ||
			failedPlaceholder ||
			!Number.isFinite(elapsed) ||
			elapsed <= 0 ||
			!Number.isSafeInteger(this.currentRun.output + usage.output) ||
			!Number.isFinite(this.currentRun.elapsedMs + elapsed) ||
			this.currentRun.elapsedMs + elapsed > Number.MAX_SAFE_INTEGER
		) {
			this.currentRun.unknown = true;
			return;
		}
		this.currentRun.output += usage.output;
		this.currentRun.elapsedMs += elapsed;
	}

	/** An unclosed observed call cannot be silently omitted from an exact aggregate. */
	suspend(): void {
		if (this.startedAt !== undefined) this.currentRun.unknown = true;
		this.startedAt = undefined;
	}

	/** Drop settled runs without disturbing surviving completed work or an open call's anchor. */
	partition(): void {
		this.priorRuns = emptyCompletedWork();
		this.priorClock = undefined;
	}

	/** Summary settlement reads the removed side before dropping it, never combined or surviving work. */
	settle(idle: boolean): number | undefined {
		if (idle) this.suspend();
		const rate = idle ? this.snapshot() : averageCompletedWork(this.priorRuns);
		if (idle) this.reset();
		else this.partition();
		return rate;
	}

	markIncomplete(): void {
		this.currentRun.unknown = true;
	}

	reset(): void {
		this.priorRuns = emptyCompletedWork();
		this.currentRun = emptyCompletedWork();
		this.enabled = false;
		this.startedAt = undefined;
		this.clock = undefined;
		this.priorClock = undefined;
	}

	snapshot(): number | undefined {
		const completed = combineCompletedWork(this.priorRuns, this.currentRun);
		return averageCompletedWork(completed);
	}
}

export function formatAverageTokenRate(rate: number | undefined): string {
	return `${rate !== undefined && Number.isFinite(rate) && rate >= 0 ? Math.round(rate) : "—"} tok/s avg`;
}
