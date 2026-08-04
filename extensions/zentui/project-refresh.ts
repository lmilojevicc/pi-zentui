export type StopProjectRefreshInterval = () => void;

export type ScheduleProjectRefreshOptions = {
	force?: boolean;
};

export type ProjectRefreshRun = {
	isCurrent: () => boolean;
};

export type ProjectRefreshScheduler<T> = {
	schedule: (target: T, options?: ScheduleProjectRefreshOptions) => void;
	invalidate: () => void;
	stop: () => void;
};

export const PROJECT_REFRESH_THROTTLE_MS = 5_000;

export function startProjectRefreshInterval(
	intervalMs: number,
	refresh: () => void,
): StopProjectRefreshInterval {
	if (intervalMs <= 0) return () => {};

	const timer = setInterval(refresh, intervalMs);
	timer.unref?.();

	return () => clearInterval(timer);
}

export function createProjectRefreshScheduler<T>(
	refresh: (target: T, run: ProjectRefreshRun) => Promise<void>,
	afterRefresh: () => void,
	throttleMs = PROJECT_REFRESH_THROTTLE_MS,
): ProjectRefreshScheduler<T> {
	let refreshInFlight = false;
	let refreshPending = false;
	let pendingForce = false;
	let pendingTarget: T | undefined;
	let delayedRefresh: ReturnType<typeof setTimeout> | undefined;
	let lastRefreshStartedAt: number | undefined;
	let generation = 0;

	const clearDelayedRefresh = () => {
		if (!delayedRefresh) return;
		clearTimeout(delayedRefresh);
		delayedRefresh = undefined;
	};

	const runRefresh = (target: T, options: ScheduleProjectRefreshOptions = {}) => {
		clearDelayedRefresh();
		if (refreshInFlight) {
			refreshPending = true;
			pendingForce ||= options.force === true;
			pendingTarget = target;
			return;
		}

		const currentGeneration = generation;
		const run: ProjectRefreshRun = {
			isCurrent: () => currentGeneration === generation,
		};
		refreshInFlight = true;
		lastRefreshStartedAt = Date.now();
		void refresh(target, run)
			.catch(() => undefined)
			.finally(() => {
				if (currentGeneration !== generation) return;
				refreshInFlight = false;
				afterRefresh();
				if (refreshPending) {
					refreshPending = false;
					const nextForce = pendingForce;
					pendingForce = false;
					const nextTarget = pendingTarget ?? target;
					pendingTarget = undefined;
					schedule(nextTarget, { force: nextForce });
				}
			});
	};

	const schedule = (target: T, options: ScheduleProjectRefreshOptions = {}) => {
		if (options.force || throttleMs <= 0 || lastRefreshStartedAt === undefined) {
			runRefresh(target, options);
			return;
		}

		const delayMs = Math.max(0, throttleMs - (Date.now() - lastRefreshStartedAt));
		if (delayMs === 0) {
			runRefresh(target);
			return;
		}

		pendingTarget = target;
		if (delayedRefresh) return;
		delayedRefresh = setTimeout(() => {
			delayedRefresh = undefined;
			const nextTarget = pendingTarget ?? target;
			pendingTarget = undefined;
			runRefresh(nextTarget);
		}, delayMs);
		delayedRefresh.unref?.();
	};

	const invalidate = () => {
		generation += 1;
		clearDelayedRefresh();
		refreshInFlight = false;
		refreshPending = false;
		pendingForce = false;
		pendingTarget = undefined;
		lastRefreshStartedAt = undefined;
	};

	return {
		schedule,
		invalidate,
		stop: invalidate,
	};
}
