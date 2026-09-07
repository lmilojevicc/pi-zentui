import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, test, vi } from "vitest";
import { startSummary } from "../extensions/subagent-summary/index";
import { runRows, SubagentReader } from "../extensions/subagent-summary/rpc";

function bus() {
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	return {
		listeners,
		on(name: string, fn: (value: unknown) => void) {
			const set = listeners.get(name) ?? new Set();
			set.add(fn);
			listeners.set(name, set);
			return () => {
				set.delete(fn);
			};
		},
		emit(name: string, value: unknown) {
			for (const fn of listeners.get(name) ?? []) fn(value);
		},
	};
}
const snapshot = {
	kind: "pi-subagents.async-status-snapshot",
	version: 1,
	runs: [{ id: "run", label: "Build", state: "running", activity: { currentTool: "bash" } }],
};
afterEach(() => vi.useRealTimers());

test("accepts only versioned status snapshots and retains child identity", () => {
	expect(runRows({ asyncSnapshot: { ...snapshot, version: 2 } })).toEqual([]);
	expect(runRows({ asyncSnapshot: snapshot })[0].action).toBe("bash");
	const rows = runRows({
		asyncSnapshot: {
			...snapshot,
			runs: [
				{
					...snapshot.runs[0],
					children: [{ id: "opaque-step", kind: "step", label: "Verify", state: "pending" }],
				},
			],
		},
	});
	expect(rows[1].runId).toBe("run");
	expect(rows[1].childId).toBe("opaque-step");
});

test("reader ignores foreign replies and disposal cancels reads", async () => {
	const events = bus();
	let requestId = "";
	events.on("subagents:rpc:v1:request", (raw) => {
		requestId = (raw as { requestId: string }).requestId;
	});
	const reader = new SubagentReader(events);
	const result = reader.read();
	events.emit(`subagents:rpc:v1:reply:${requestId}`, {
		requestId: "foreign",
		version: 1,
		success: true,
	});
	const assertion = expect(result).rejects.toThrow("closed");
	reader.dispose();
	await assertion;
	expect(events.listeners.get(`subagents:rpc:v1:reply:${requestId}`)?.size).toBe(0);
});

test("task appearance uses only a passive widget and clears stale state on timeout", async () => {
	vi.useFakeTimers();
	const events = bus();
	let replies = true;
	events.on("subagents:rpc:v1:request", (raw) => {
		const r = raw as { requestId: string; method: string; params: object };
		expect(r.method).toBe("status");
		expect(r.params).toEqual({});
		if (replies)
			events.emit(`subagents:rpc:v1:reply:${r.requestId}`, {
				requestId: r.requestId,
				version: 1,
				success: true,
				data: { asyncSnapshot: snapshot },
			});
	});
	const setWidget = vi.fn();
	// No terminal/input APIs are provided: registering a listener or mouse mode is a regression.
	const ctx = { ui: { setWidget } } as unknown as ExtensionContext;
	const stop = startSummary({ events }, ctx);
	await vi.advanceTimersByTimeAsync(0);
	expect(setWidget).toHaveBeenCalledTimes(1);
	const factory = setWidget.mock.calls[0][1];
	const widget = factory({}, { fg: (_color: string, text: string) => text });
	expect(widget.render(80).join("\n")).toContain("Build · running · bash");
	expect(widget.render(12).every((line: string) => visibleWidth(line) <= 12)).toBe(true);
	await vi.advanceTimersByTimeAsync(1500);
	expect(setWidget).toHaveBeenCalledTimes(1); // Unchanged snapshots don't repaint.
	replies = false;
	await vi.advanceTimersByTimeAsync(4000);
	expect(setWidget).toHaveBeenLastCalledWith("zentui-subagent-summary", undefined);
	stop();
	expect(vi.getTimerCount()).toBe(0);
});

test("shutdown before a reply never creates a widget", async () => {
	vi.useFakeTimers();
	const events = bus();
	const setWidget = vi.fn();
	const stop = startSummary({ events }, { ui: { setWidget } } as unknown as ExtensionContext);
	stop();
	await vi.advanceTimersByTimeAsync(10000);
	expect(setWidget).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
