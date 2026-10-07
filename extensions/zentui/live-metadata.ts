import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { AverageTokenRateTracker, formatAverageTokenRate } from "./average-token-rate";
import {
	type GithubContext,
	type GithubExec,
	GithubStatusCollector,
	githubTemplateValues,
} from "./github-status";
import { type HostTemplateValues, isHostTemplateVariable } from "./host-template-values";
import type { MessageEndResult } from "./interaction-summary";
import type { LiveMetadataDemand } from "./live-metadata-demand";
import { formatTokenRate, type TokenRateMessage, TokenRateTracker } from "./token-rate";

/** Session resources and demand live outside render; reads are entirely passive. */
export class LiveMetadataController {
	readonly rate: TokenRateTracker;
	private readonly averageRate: AverageTokenRateTracker;
	private readonly github: GithubStatusCollector;
	private context: GithubContext | undefined;
	private demand: LiveMetadataDemand = { github: false, tokenRate: false };
	private githubTimer: ReturnType<typeof setTimeout> | undefined;
	private rateTimer: ReturnType<typeof setInterval> | undefined;
	private streaming = false;
	private rateLabel = "";
	private workingRateLabel = "";
	private averageLabel = "";
	private generation = 0;
	private disposed = false;
	private scheduledRefresh: number | undefined;
	constructor(
		exec: GithubExec,
		private readonly onRate: (text: string) => void,
		private readonly repaint: () => void,
		private readonly reconcileOwnership: () => void,
		rateNow?: () => number,
		private readonly githubNow: () => number = Date.now,
	) {
		this.rate = new TokenRateTracker(rateNow);
		this.averageRate = new AverageTokenRateTracker(rateNow);
		this.github = new GithubStatusCollector(
			exec,
			() => {
				if (!this.disposed && this.context && this.demand.github) this.repaint();
			},
			githubNow,
		);
	}
	reconcile(context: GithubContext | undefined, demand: LiveMetadataDemand): void {
		if (this.disposed) return;
		const changed =
			this.context?.cwd !== context?.cwd || this.context?.scopeKey !== context?.scopeKey;
		const start = demand.github && (!this.demand.github || changed);
		this.context = context;
		this.demand = context ? demand : { github: false, tokenRate: false };
		if (context) this.github.reconcile(context, this.demand.github);
		else this.github.reconcile({ cwd: "", scopeKey: "" }, false);
		if (changed || !this.demand.github) {
			this.generation++;
			this.stopGithubTimer();
		}
		if (start && context) this.scheduleRefresh();
		if (changed || !this.demand.tokenRate) this.suspendRate(true);
		this.reconcileRateTimer();
		this.rateChanged();
	}
	startAgent(interactionStarted: boolean): void {
		if (this.disposed) return;
		this.rate.agentStart();
		this.averageRate.agentStart(interactionStarted);
		if (this.demand.tokenRate)
			this.averageLabel = formatAverageTokenRate(this.averageRate.snapshot());
		else this.averageRate.reset();
		this.rateChanged();
	}
	updateResponse(message: TokenRateMessage, event?: AssistantMessageEvent): void {
		if (this.disposed || !this.demand.tokenRate) return;
		this.averageRate.observeTime();
		if (this.rate.messageUpdate(message, event)) this.rateChanged();
	}
	endResponse(
		message: TokenRateMessage & { stopReason?: unknown },
		result: MessageEndResult,
	): void {
		if (this.disposed || !this.demand.tokenRate || result.status !== "accepted") return;
		this.rate.messageEnd(message);
		this.averageRate.messageEnd(message, result);
		const previous = this.averageLabel;
		if (this.averageLabel) this.averageLabel = formatAverageTokenRate(this.averageRate.snapshot());
		this.setStreaming(false);
		if (previous !== this.averageLabel) this.repaint();
	}
	/** A new authorized response must not inherit another response's observed speed. */
	startResponse(): void {
		if (this.disposed) return;
		this.rate.turnStart();
		this.rateLabel = this.demand.tokenRate ? "— tok/s" : "";
		if (this.demand.tokenRate) {
			this.averageRate.turnStart();
			this.averageLabel = formatAverageTokenRate(this.averageRate.snapshot());
		} else this.rate.suspend();
		this.setStreaming(true);
	}
	/** Tools/end retain metadata; identity/boundary changes explicitly clear it. */
	suspendRate(clearDisplay = false): void {
		this.rate.suspend();
		this.averageRate.suspend();
		const cleared = clearDisplay && (this.rateLabel !== "" || this.averageLabel !== "");
		const workingWasVisible = this.workingRateLabel !== "";
		if (clearDisplay) {
			this.rateLabel = "";
			this.averageLabel = "";
			this.averageRate.reset();
		} else if (this.averageLabel)
			this.averageLabel = formatAverageTokenRate(this.averageRate.snapshot());
		this.setStreaming(false);
		if (cleared && !workingWasVisible && !this.disposed) this.repaint();
	}
	resetRate(): void {
		this.rate.reset();
		this.suspendRate(true);
	}
	setStreaming(active: boolean): void {
		this.streaming = !this.disposed && active;
		this.reconcileRateTimer();
		this.rateChanged();
	}
	rateChanged(): void {
		if (this.disposed) return;
		const previous = this.rateLabel;
		if (this.streaming && this.demand.tokenRate) {
			// Retain only an observed window rate, never turn final usage into a live sample.
			const measured = formatTokenRate(this.rate.snapshot());
			if (measured) this.rateLabel = measured;
		}
		const workingText = this.streaming && this.demand.tokenRate ? this.rateLabel : "";
		const workingChanged = workingText !== this.workingRateLabel;
		if (workingChanged) {
			this.workingRateLabel = workingText;
			this.onRate(workingText);
		}
		if (previous !== this.rateLabel || workingChanged) this.repaint();
	}
	invalidateProject(): void {
		if (this.disposed || !this.demand.github) return;
		this.generation++;
		this.stopGithubTimer();
		this.github.invalidate();
		this.scheduleRefresh();
	}
	private scheduleRefresh(): void {
		if (!this.demand.github || this.disposed || this.scheduledRefresh === this.generation) return;
		const generation = this.generation;
		this.scheduledRefresh = generation;
		// Branch invalidation can originate in render; never execute there.
		queueMicrotask(() => {
			if (this.scheduledRefresh === generation) this.scheduledRefresh = undefined;
			if (generation !== this.generation || !this.demand.github || this.disposed) return;
			this.stopGithubTimer();
			const completed = () => {
				if (generation === this.generation && this.demand.github && !this.disposed)
					this.scheduleNextGithubRefresh();
			};
			void this.github.refresh().then(completed, completed);
		});
	}
	private scheduleNextGithubRefresh(): void {
		this.stopGithubTimer();
		const expiresAt = this.github.snapshot()?.expiresAt;
		const remaining = expiresAt === undefined ? Number.NaN : expiresAt - this.githubNow();
		// Identity failures have no cache deadline; retry on the base cadence. Never spin at zero.
		const delay = Number.isFinite(remaining) ? Math.max(1, Math.min(30_000, remaining)) : 30_000;
		const generation = this.generation;
		const timer = setTimeout(() => {
			if (
				this.githubTimer !== timer ||
				generation !== this.generation ||
				!this.demand.github ||
				this.disposed
			)
				return;
			this.githubTimer = undefined;
			this.reconcileOwnership();
			if (generation !== this.generation || !this.demand.github || this.disposed) return;
			// snapshot() marks expired CI stale. Repaint before the deferred refresh can wait on I/O.
			this.repaint();
			this.scheduleRefresh();
		}, delay);
		this.githubTimer = timer;
		timer.unref?.();
	}
	read(names: ReadonlySet<string>, native?: HostTemplateValues): HostTemplateValues {
		const values: Partial<Record<keyof HostTemplateValues, string>> = { ...native };
		// The shared passive snapshot replaces only the PR/CI path, never OMP rate/quota/modes.
		delete values.pr_number;
		delete values.pr_url;
		delete values.ci;
		Object.assign(values, githubTemplateValues(this.github.snapshot()));
		if (!native && this.demand.tokenRate && this.averageLabel)
			values.token_rate = this.averageLabel;
		return Object.fromEntries(
			Object.entries(values).filter(([name]) => names.has(name) && isHostTemplateVariable(name)),
		);
	}
	reset(): void {
		this.generation++;
		this.context = undefined;
		this.demand = { github: false, tokenRate: false };
		this.github.reconcile({ cwd: "", scopeKey: "" }, false);
		this.stopGithubTimer();
		this.resetRate();
	}
	dispose(): void {
		this.disposed = true;
		this.reset();
		this.github.dispose();
	}
	private stopGithubTimer(): void {
		if (this.githubTimer) clearTimeout(this.githubTimer);
		this.githubTimer = undefined;
	}
	private reconcileRateTimer(): void {
		if (!(this.streaming && this.demand.tokenRate)) {
			if (this.rateTimer) clearInterval(this.rateTimer);
			this.rateTimer = undefined;
			return;
		}
		if (this.rateTimer) return;
		this.rateTimer = setInterval(() => {
			this.reconcileOwnership();
			this.rateChanged();
		}, 250);
		this.rateTimer.unref?.();
	}
}
