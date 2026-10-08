import { AverageTokenRateTracker } from "./average-token-rate";
import type { MessageEndResult } from "./interaction-summary";
import type { TokenRateMessage } from "./token-rate";

/** Passive summary-only accounting: no UI demand, model identity, sampling or timers. */
export class TurnSummaryRateTracker {
	private readonly average: AverageTokenRateTracker;
	private active = false;
	private enabled = false;

	constructor(now?: () => number) {
		this.average = new AverageTokenRateTracker(now);
	}

	reconcile(enabled: boolean): void {
		this.enabled = enabled;
		if (this.active && !enabled) this.average.markIncomplete();
	}

	agentStart(interactionStarted: boolean, enabled: boolean): void {
		this.average.agentStart(interactionStarted);
		this.active = true;
		this.reconcile(enabled);
	}

	turnStart(): void {
		if (this.active && this.enabled) this.average.turnStart();
	}

	observeTime(): void {
		if (this.active && this.enabled) this.average.observeTime();
	}

	messageEnd(message: TokenRateMessage & { stopReason?: unknown }, result: MessageEndResult): void {
		if (this.active && this.enabled) this.average.messageEnd(message, result);
	}

	agentEnd(): void {
		this.average.suspend();
	}

	settle(idle: boolean): number | undefined {
		const rate = this.average.settle(idle);
		if (idle) this.active = false;
		return rate;
	}

	reset(): void {
		this.active = false;
		this.average.reset();
	}
}
