import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("SessionLifecycle", () => {
	it("cancels owned timeouts, rejects old generations, and shuts down twice safely", () => {
		vi.useFakeTimers();
		const lifecycle = new SessionLifecycle();
		const calls: string[] = [];
		const oldGeneration = lifecycle.start();
		lifecycle.defer(() => calls.push("old"));

		lifecycle.shutdown();
		lifecycle.shutdown();
		const currentGeneration = lifecycle.start();
		lifecycle.defer(() => calls.push("current"));
		vi.runAllTimers();

		expect(calls).toEqual(["current"]);
		expect(lifecycle.isCurrent(oldGeneration)).toBe(false);
		expect(lifecycle.isCurrent(currentGeneration)).toBe(true);
	});

	it("drops queued microtasks from an old generation", async () => {
		const lifecycle = new SessionLifecycle();
		const calls: string[] = [];
		lifecycle.start();
		lifecycle.queueMicrotask(() => calls.push("old"));
		lifecycle.start();
		lifecycle.queueMicrotask(() => calls.push("current"));

		await Promise.resolve();

		expect(calls).toEqual(["current"]);
	});
});
