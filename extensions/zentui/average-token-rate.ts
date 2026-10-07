import { type MessageEndResult, parseAssistantMessageTokens } from "./interaction-summary";
import type { TokenRateMessage } from "./token-rate";

type FinalMessage = TokenRateMessage & { stopReason?: unknown };

/** Provider final output / summed turn_start -> accepted message_end observations.
 * Includes initial wait and client preparation, not just backend decoding. No tool/gap time.
 * Acceptance and response identity belong to InteractionMetricsTracker, not this accumulator.
 */
export class AverageTokenRateTracker {
	private output = 0;
	private elapsedMs = 0;
	private unknown = false;
	private enabled = false;
	private startedAt?: number;
	private clock?: number;

	constructor(private readonly now: () => number = () => performance.now()) {}

	agentStart(interactionStarted: boolean): void {
		if (interactionStarted) this.reset();
		else this.suspend();
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
		if (
			!Number.isFinite(at) ||
			at < 0 ||
			at > Number.MAX_SAFE_INTEGER ||
			(this.clock !== undefined && at < this.clock)
		)
			this.unknown = true;
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
			!Number.isSafeInteger(this.output + usage.output) ||
			!Number.isFinite(this.elapsedMs + elapsed) ||
			this.elapsedMs + elapsed > Number.MAX_SAFE_INTEGER
		) {
			this.unknown = true;
			return;
		}
		this.output += usage.output;
		this.elapsedMs += elapsed;
	}

	/** An unclosed observed call cannot be silently omitted from an exact aggregate. */
	suspend(): void {
		if (this.startedAt !== undefined) this.unknown = true;
		this.startedAt = undefined;
	}

	reset(): void {
		this.output = 0;
		this.elapsedMs = 0;
		this.unknown = false;
		this.enabled = false;
		this.startedAt = undefined;
		this.clock = undefined;
	}

	snapshot(): number | undefined {
		return !this.unknown && this.elapsedMs > 0 ? (this.output * 1000) / this.elapsedMs : undefined;
	}
}

export function formatAverageTokenRate(rate: number | undefined): string {
	return `${rate !== undefined && Number.isFinite(rate) && rate >= 0 ? Math.round(rate) : "—"} tok/s avg`;
}
