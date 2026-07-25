import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createProjectRefreshScheduler,
	startProjectRefreshInterval,
} from "../extensions/zentui/project-refresh";

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("startProjectRefreshInterval", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs the refresh callback at the configured interval", () => {
		vi.useFakeTimers();
		const refresh = vi.fn();

		const stop = startProjectRefreshInterval(30_000, refresh);

		vi.advanceTimersByTime(29_999);
		expect(refresh).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(refresh).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(30_000);
		expect(refresh).toHaveBeenCalledTimes(2);

		stop();
		vi.advanceTimersByTime(30_000);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("does not start a timer when polling is disabled", () => {
		vi.useFakeTimers();
		const refresh = vi.fn();

		const stop = startProjectRefreshInterval(0, refresh);

		vi.advanceTimersByTime(120_000);
		expect(refresh).not.toHaveBeenCalled();
		expect(() => stop()).not.toThrow();
	});
});

describe("createProjectRefreshScheduler", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("throttles bursty project refresh requests", async () => {
		vi.useFakeTimers();
		const refresh = vi.fn<(...args: [string]) => Promise<void>>(() => Promise.resolve());
		const afterRefresh = vi.fn();
		const scheduler = createProjectRefreshScheduler(refresh, afterRefresh, 5_000);

		scheduler.schedule("initial");
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenLastCalledWith("initial");
		expect(afterRefresh).toHaveBeenCalledTimes(1);

		scheduler.schedule("first-pending");
		scheduler.schedule("latest-pending");
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(4_999);
		await flushPromises();
		expect(refresh).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenLastCalledWith("latest-pending");
		expect(afterRefresh).toHaveBeenCalledTimes(2);
	});

	it("coalesces refreshes requested while a refresh is in flight", async () => {
		vi.useFakeTimers();
		let finishRefresh: (() => void) | undefined;
		const refresh = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishRefresh = resolve;
				}),
		);
		const afterRefresh = vi.fn();
		const scheduler = createProjectRefreshScheduler(refresh, afterRefresh, 5_000);

		scheduler.schedule("initial");
		scheduler.schedule("pending");
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(afterRefresh).not.toHaveBeenCalled();

		finishRefresh?.();
		await flushPromises();

		expect(afterRefresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(5_000);
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenLastCalledWith("pending");
	});

	it("preserves force intent while a refresh is in flight", async () => {
		vi.useFakeTimers();
		let finishInitialRefresh: (() => void) | undefined;
		const refresh = vi.fn((target: string) => {
			if (target !== "initial") return Promise.resolve();
			return new Promise<void>((resolve) => {
				finishInitialRefresh = resolve;
			});
		});
		const afterRefresh = vi.fn();
		const scheduler = createProjectRefreshScheduler(refresh, afterRefresh, 5_000);

		scheduler.schedule("initial");
		scheduler.schedule("dependency-change", { force: true });
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(1);

		finishInitialRefresh?.();
		await flushPromises();
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenLastCalledWith("dependency-change");
		expect(afterRefresh).toHaveBeenCalledTimes(2);

		scheduler.schedule("ordinary-follow-up");
		await flushPromises();
		expect(refresh).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(4_999);
		await flushPromises();
		expect(refresh).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(1);
		await flushPromises();
		expect(refresh).toHaveBeenCalledTimes(3);
		expect(refresh).toHaveBeenLastCalledWith("ordinary-follow-up");
	});

	it("supports forced refreshes for initial status reads", async () => {
		vi.useFakeTimers();
		const refresh = vi.fn<(...args: [string]) => Promise<void>>(() => Promise.resolve());
		const afterRefresh = vi.fn();
		const scheduler = createProjectRefreshScheduler(refresh, afterRefresh, 5_000);

		scheduler.schedule("initial");
		await flushPromises();
		scheduler.schedule("forced", { force: true });
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenLastCalledWith("forced");
	});

	it("recovers from failed refreshes", async () => {
		vi.useFakeTimers();
		const refresh = vi
			.fn<(...args: [string]) => Promise<void>>()
			.mockRejectedValueOnce(new Error("slow git command failed"))
			.mockResolvedValue(undefined);
		const afterRefresh = vi.fn();
		const scheduler = createProjectRefreshScheduler(refresh, afterRefresh, 5_000);

		scheduler.schedule("initial");
		await flushPromises();
		scheduler.schedule("next", { force: true });
		await flushPromises();

		expect(refresh).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenLastCalledWith("next");
		expect(afterRefresh).toHaveBeenCalledTimes(2);
	});
});
