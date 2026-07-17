import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	calculateLiveContextTokens,
	LiveContextController,
	liveContextFromMessage,
} from "../extensions/zentui/live-context";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

function usage(patch: Partial<Usage> = {}): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...patch,
	};
}

function assistant(messageUsage: Usage, stopReason: AssistantMessage["stopReason"] = "stop") {
	return {
		role: "assistant" as const,
		content: [],
		api: "anthropic-messages" as const,
		provider: "anthropic",
		model: "test",
		usage: messageUsage,
		stopReason,
		timestamp: 1,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("live context usage", () => {
	it("prefers totalTokens and otherwise includes cache components", () => {
		expect(
			calculateLiveContextTokens(
				usage({ input: 400, output: 300, cacheRead: 200, cacheWrite: 100, totalTokens: 777 }),
			),
		).toBe(777);
		expect(
			calculateLiveContextTokens(
				usage({ input: 400, output: 300, cacheRead: 200, cacheWrite: 100 }),
			),
		).toBe(1_000);
	});

	it("ignores zero usage, non-assistant messages, and failed assistant snapshots", () => {
		expect(calculateLiveContextTokens(usage())).toBeUndefined();
		expect(liveContextFromMessage({ role: "user" })).toBeUndefined();
		expect(liveContextFromMessage(assistant(usage({ totalTokens: 100 }), "error"))).toBeUndefined();
		expect(
			liveContextFromMessage(assistant(usage({ totalTokens: 100 }), "aborted")),
		).toBeUndefined();
	});

	it("keeps the newest cumulative snapshot instead of summing deltas", () => {
		vi.useFakeTimers();
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		const render = vi.fn();
		const controller = new LiveContextController(lifecycle, render);

		controller.update(assistant(usage({ totalTokens: 1_000 })));
		controller.update(assistant(usage({ totalTokens: 1_100 })));
		expect(controller.get()).toEqual({ tokens: 1_100 });
		vi.advanceTimersByTime(250);

		expect(render).toHaveBeenCalledTimes(1);
		expect(controller.get()).toEqual({ tokens: 1_100 });
	});

	it("coalesces bursts to at most one render per 250ms with the newest usage", () => {
		vi.useFakeTimers();
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		const renderedTokens: number[] = [];
		let controller: LiveContextController;
		controller = new LiveContextController(lifecycle, () => {
			renderedTokens.push(controller.get()?.tokens ?? 0);
		});

		for (const totalTokens of [100, 200, 300, 400]) {
			controller.update(assistant(usage({ totalTokens })));
		}
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(249);
		expect(renderedTokens).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(renderedTokens).toEqual([400]);

		controller.update(assistant(usage({ totalTokens: 500 })));
		vi.advanceTimersByTime(250);
		expect(renderedTokens).toEqual([400, 500]);
	});

	it("cancels old generations without suppressing scheduling after direct lifecycle restarts", () => {
		vi.useFakeTimers();
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		const renderedTokens: number[] = [];
		let controller: LiveContextController;
		controller = new LiveContextController(lifecycle, () => {
			renderedTokens.push(controller.get()?.tokens ?? 0);
		});

		controller.update(assistant(usage({ totalTokens: 100 })));
		lifecycle.shutdown();
		vi.advanceTimersByTime(250);
		expect(renderedTokens).toEqual([]);

		lifecycle.start();
		controller.update(assistant(usage({ totalTokens: 200 })));
		vi.advanceTimersByTime(250);
		expect(renderedTokens).toEqual([200]);

		controller.update(assistant(usage({ totalTokens: 300 })));
		lifecycle.start();
		controller.update(assistant(usage({ totalTokens: 400 })));
		vi.advanceTimersByTime(250);
		expect(renderedTokens).toEqual([200, 400]);
	});

	it("recovers from a cleared compaction boundary when live usage resumes", () => {
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		const controller = new LiveContextController(lifecycle, () => {});
		controller.update(assistant(usage({ totalTokens: 100 })));
		controller.clear();
		expect(controller.get()).toBeUndefined();
		controller.update(assistant(usage({ totalTokens: 150 })));
		expect(controller.get()).toEqual({ tokens: 150 });
	});
});
