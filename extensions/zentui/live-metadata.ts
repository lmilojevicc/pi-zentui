import {
	type GithubContext,
	type GithubExec,
	GithubStatusCollector,
	githubTemplateValues,
} from "./github-status";
import { type HostTemplateValues, isHostTemplateVariable } from "./host-template-values";
import type { LiveMetadataDemand } from "./live-metadata-demand";
import { formatTokenRate, TokenRateTracker } from "./token-rate";

/** Session resources and demand live outside render; reads are entirely passive. */
export class LiveMetadataController {
	readonly rate: TokenRateTracker;
	private readonly github: GithubStatusCollector;
	private context: GithubContext | undefined;
	private demand: LiveMetadataDemand = { github: false, tokenRate: false };
	private githubTimer: ReturnType<typeof setTimeout> | undefined;
	private rateTimer: ReturnType<typeof setInterval> | undefined;
	private streaming = false;
	private rateLabel = "";
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
		this.reconcileRateTimer();
		this.rateChanged();
	}
	setStreaming(active: boolean): void {
		this.streaming = !this.disposed && active;
		this.reconcileRateTimer();
		this.rateChanged();
	}
	rateChanged(): void {
		const text =
			this.streaming && this.demand.tokenRate ? formatTokenRate(this.rate.snapshot()) : "";
		if (text === this.rateLabel) return;
		this.rateLabel = text;
		if (!this.disposed) {
			this.onRate(text);
			this.repaint();
		}
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
		if (!native && this.streaming && this.demand.tokenRate) {
			const text = formatTokenRate(this.rate.snapshot());
			if (text) values.token_rate = text;
		}
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
		this.rate.reset();
		this.setStreaming(false);
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
