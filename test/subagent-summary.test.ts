import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, test, vi } from "vitest";
import { startSummary } from "../extensions/zentui/subagent-summary";
import { SubagentReader } from "../extensions/zentui/subagent-summary-rpc";
import { projectSubagentSummary } from "../extensions/zentui/subagent-summary-view";

const runRows = (data: unknown) => projectSubagentSummary(data, Date.now()).rows;

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

test("actual Pi caught-event bus settles malformed errors instead of stranding stale status", async () => {
	vi.useFakeTimers();
	const { createEventBus } = await import("@earendil-works/pi-coding-agent");
	const events = createEventBus();
	events.on("subagents:rpc:v1:request", (raw) => {
		const request = raw as { requestId: string };
		events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
			version: 1,
			requestId: request.requestId,
			success: false,
			error: { message: { toString: null } },
		});
	});
	const reader = new SubagentReader(events);
	await expect(reader.read()).rejects.toThrow("Subagent read failed");
	expect(vi.getTimerCount()).toBe(0);
	reader.dispose();
});

test.each(["on", "emit", "off"])(
	"settles and clears timers when bus %s throws",
	async (operation) => {
		vi.useFakeTimers();
		const events = bus();
		const broken = {
			on(name: string, handler: (data: unknown) => void) {
				if (operation === "on") throw new Error("on");
				const off = events.on(name, handler);
				return () => {
					off();
					if (operation === "off") throw new Error("off");
				};
			},
			emit() {
				if (operation === "emit") throw new Error("emit");
			},
		};
		const reader = new SubagentReader(broken);
		const reads = [reader.read(), reader.read()];
		const assertions = reads.map((read) => expect(read).rejects.toThrow());
		reader.dispose();
		reader.dispose();
		await Promise.all(assertions);
		expect(vi.getTimerCount()).toBe(0);
		for (const listeners of events.listeners.values()) expect(listeners.size).toBe(0);
	},
);

test("ignores duplicate, late, foreign method/version/channel replies and registers before emit", async () => {
	vi.useFakeTimers();
	const events = bus();
	let requestId = "";
	events.on("subagents:rpc:v1:request", (raw) => {
		requestId = (raw as { requestId: string }).requestId;
		expect(events.listeners.get(`subagents:rpc:v1:reply:${requestId}`)?.size).toBe(1);
	});
	const reader = new SubagentReader(events);
	const settled = vi.fn();
	const result = reader.read().then(settled);
	const reply = {
		version: 1,
		requestId,
		method: "status",
		success: true,
		data: { asyncSnapshot: snapshot },
	};
	for (const patch of [{ version: 2 }, { method: "stop" }, { requestId: "foreign" }])
		events.emit(`subagents:rpc:v1:reply:${requestId}`, { ...reply, ...patch });
	events.emit("subagents:rpc:v1:reply:foreign", reply);
	await vi.advanceTimersByTimeAsync(1);
	expect(settled).not.toHaveBeenCalled();
	events.emit(`subagents:rpc:v1:reply:${requestId}`, reply);
	events.emit(`subagents:rpc:v1:reply:${requestId}`, { ...reply, success: false });
	await result;
	reader.dispose();
	events.emit(`subagents:rpc:v1:reply:${requestId}`, reply);
	expect(settled).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});

test("registration-time reply cleans its subsequently returned listener and skips emit", async () => {
	vi.useFakeTimers();
	const off = vi.fn();
	const emit = vi.fn();
	const reader = new SubagentReader({
		on(name, handler) {
			handler({ version: 1, requestId: name.split(":").at(-1), success: true });
			return off;
		},
		emit,
	});
	await expect(reader.read()).resolves.toEqual({});
	expect(off).toHaveBeenCalledTimes(1);
	expect(emit).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

test("idle/incompatible/error snapshots clear once; timeout cadence is settlement plus 1500ms", async () => {
	vi.useFakeTimers();
	const events = bus();
	const requests = vi.fn();
	let data: unknown = { asyncSnapshot: snapshot };
	let error = false;
	let replies = true;
	events.on("subagents:rpc:v1:request", (raw) => {
		requests();
		const r = raw as { requestId: string };
		if (replies)
			events.emit(`subagents:rpc:v1:reply:${r.requestId}`, {
				version: 1,
				requestId: r.requestId,
				success: !error,
				data,
			});
	});
	const setWidget = vi.fn();
	const status = vi.fn();
	const stop = startSummary(
		{ events },
		{ ui: { setWidget } } as unknown as ExtensionContext,
		status,
	);
	await vi.advanceTimersByTimeAsync(0);
	data = { asyncSnapshot: { ...snapshot, runs: [] } };
	await vi.advanceTimersByTimeAsync(1500);
	expect(setWidget).toHaveBeenCalledTimes(2);
	await vi.advanceTimersByTimeAsync(1500);
	expect(setWidget).toHaveBeenCalledTimes(2);
	expect(status).toHaveBeenLastCalledWith("compatible");
	data = {};
	await vi.advanceTimersByTimeAsync(1500);
	expect(status).toHaveBeenLastCalledWith("incompatible");
	error = true;
	await vi.advanceTimersByTimeAsync(1500);
	expect(status).toHaveBeenLastCalledWith("status unavailable");
	replies = false;
	await vi.advanceTimersByTimeAsync(1500);
	const count = requests.mock.calls.length;
	await vi.advanceTimersByTimeAsync(3999);
	expect(requests).toHaveBeenCalledTimes(count);
	await vi.advanceTimersByTimeAsync(1);
	expect(requests).toHaveBeenCalledTimes(count + 1);
	stop();
	expect(vi.getTimerCount()).toBe(0);
});

test("themes at render time then truncates emoji/CJK/combining glyphs at zero/narrow widths", async () => {
	vi.useFakeTimers();
	const events = bus();
	events.on("subagents:rpc:v1:request", (raw) => {
		const { requestId } = raw as { requestId: string };
		events.emit(`subagents:rpc:v1:reply:${requestId}`, {
			version: 1,
			requestId,
			success: true,
			data: {
				asyncSnapshot: {
					...snapshot,
					runs: [{ ...snapshot.runs[0], label: "😀漢字é".repeat(40) }],
				},
			},
		});
	});
	const setWidget = vi.fn();
	const stop = startSummary({ events }, { ui: { setWidget } } as unknown as ExtensionContext);
	await vi.advanceTimersByTimeAsync(0);
	let color = "31";
	const widget = setWidget.mock.calls[0][1](
		{},
		{ fg: (_name: string, value: string) => `\x1b[${color}m${value}\x1b[0m` },
	);
	for (const width of [0, 1, 2, 3, 4, 8, 20, 80])
		expect(widget.render(width).every((line: string) => visibleWidth(line) <= width)).toBe(true);
	expect(widget.render(80)[0]).toContain("\x1b[31m");
	color = "32";
	widget.invalidate();
	expect(widget.render(80)[0]).toContain("\x1b[32m");
	expect(widget.handleInput).toBeUndefined();
	stop();
});
