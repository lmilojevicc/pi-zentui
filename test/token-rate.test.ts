import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	formatTokenRate,
	type TokenRateMessage,
	type TokenRateSnapshot,
	TokenRateTracker,
} from "../extensions/zentui/token-rate";

function message(output?: number, responseId?: string): TokenRateMessage {
	return {
		role: "assistant",
		responseId,
		...(output === undefined ? {} : { usage: { input: 10, output } }),
	};
}
function delta(
	value: string,
	cumulative?: string,
	type = "text_delta",
	index = 0,
): AssistantMessageEvent {
	const content: unknown[] = [];
	if (type === "toolcall_delta")
		content[index] = { type: "toolCall", id: "call", name: "bash", arguments: {} };
	else if (cumulative !== undefined)
		content[index] =
			type === "thinking_delta"
				? { type: "thinking", thinking: cumulative }
				: { type: "text", text: cumulative };
	return { type, contentIndex: index, delta: value, partial: { content } } as AssistantMessageEvent;
}
function started(): TokenRateTracker {
	const tracker = new TokenRateTracker(() => 0);
	tracker.agentStart(0);
	tracker.turnStart(0);
	return tracker;
}
function exact(tracker: TokenRateTracker, id?: string): void {
	tracker.messageUpdate(message(10, id), undefined, 100);
	tracker.messageUpdate(message(30, id), undefined, 600);
}

describe("TokenRateTracker response observations", () => {
	it("requires a generated baseline and useful span, excluding pre-output silence", () => {
		const tracker = started();
		expect(tracker.snapshot(5000)).toBeUndefined();
		expect(tracker.messageUpdate(message(100), undefined, 10000)).toBe(true);
		expect(tracker.snapshot(10000)).toBeUndefined();
		tracker.messageUpdate(message(110), undefined, 10499);
		expect(tracker.snapshot(10499)).toBeUndefined();
		tracker.messageUpdate(message(120), undefined, 10500);
		expect(tracker.snapshot(10500)).toEqual({
			tokensPerSecond: 40,
			approximate: false,
			source: "provider",
			observedAt: 10500,
			windowMs: 500,
		});
	});

	it("uses successive monotonic provider snapshots without rebaselining every update", () => {
		const tracker = started();
		exact(tracker);
		expect(formatTokenRate(tracker.snapshot(600))).toBe("40 tok/s");
		tracker.messageUpdate(message(75), undefined, 1600);
		expect(tracker.snapshot(1600)?.tokensPerSecond).toBeCloseTo(65 / 1.5);
	});

	it("trims to observed baselines inside 3s without inventing a boundary sample", () => {
		const tracker = started();
		for (const [at, output] of [
			[0, 1],
			[1000, 11],
			[2000, 31],
			[3200, 91],
			[4100, 100],
		])
			tracker.messageUpdate(message(output), undefined, at);
		expect(tracker.snapshot(3200)).toBeUndefined(); // clock regression clears the window
		const recent = started();
		for (const [at, output] of [
			[0, 1],
			[1000, 11],
			[2000, 31],
			[3200, 91],
		])
			recent.messageUpdate(message(output), undefined, at);
		expect(recent.snapshot(3200)).toMatchObject({
			windowMs: 2200,
			tokensPerSecond: (80 * 1000) / 2200,
		});
		recent.messageUpdate(message(100), undefined, 4100);
		expect(recent.snapshot(4100)).toMatchObject({
			windowMs: 2100,
			tokensPerSecond: (69 * 1000) / 2100,
		});
	});

	it("coalesces same-timestamp updates, never showing an instantaneous burst", () => {
		const tracker = started();
		tracker.messageUpdate(message(1), undefined, 0);
		tracker.messageUpdate(message(20), undefined, 0);
		expect(tracker.snapshot(0)).toBeUndefined();
		tracker.messageUpdate(message(30), undefined, 500);
		expect(tracker.snapshot(500)?.tokensPerSecond).toBe(20);
	});

	it("rebaselines both source transitions and anchor correction jumps", () => {
		const tracker = started();
		tracker.messageUpdate(message(), delta("abcd", "abcd"), 0);
		tracker.messageUpdate(message(), delta("efgh", "abcdefgh"), 500);
		expect(formatTokenRate(tracker.snapshot(500))).toBe("~2 tok/s");
		tracker.messageUpdate(message(1000), undefined, 600);
		expect(tracker.snapshot(600)).toBeUndefined();
		tracker.messageUpdate(message(1020), undefined, 1100);
		expect(formatTokenRate(tracker.snapshot(1100))).toBe("40 tok/s");
		tracker.messageUpdate(message(1020), delta("ijkl", "abcdefghijkl"), 1200);
		expect(tracker.snapshot(1200)).toBeUndefined();
		tracker.messageUpdate(message(1020), delta("mnop", "abcdefghijklmnop"), 1700);
		expect(formatTokenRate(tracker.snapshot(1700))).toBe("~2 tok/s");
	});

	it("does not turn provider corrections below an estimated floor into generation", () => {
		const tracker = started();
		tracker.messageUpdate(message(1), delta("abcd", "abcd"), 0);
		tracker.messageUpdate(message(1), delta("x".repeat(40), `abcd${"x".repeat(40)}`), 500);
		tracker.messageUpdate(message(2), undefined, 600);
		expect(tracker.snapshot(600)).toBeUndefined();
		tracker.messageUpdate(message(3), undefined, 1100);
		expect(tracker.snapshot(1100)).toBeUndefined();
		tracker.messageUpdate(message(3), delta("x".repeat(40), `abcd${"x".repeat(80)}`), 1600);
		expect(tracker.snapshot(1600)?.source).toBe("estimate");
		expect(tracker.snapshot(1600)?.tokensPerSecond).toBe(4);
	});

	it.each([undefined, 0])(
		"estimates with absent/zero output usage (%s), not word counts",
		(usage) => {
			const tracker = started();
			tracker.messageUpdate(message(usage), delta("abcdefgh", "abcdefgh"), 0);
			tracker.messageUpdate(message(usage), delta("ijklmnop", "abcdefghijklmnop"), 500);
			expect(formatTokenRate(tracker.snapshot(500))).toBe("~4 tok/s");
		},
	);

	it("does not count non-generating lifecycle markers or final stream usage", () => {
		const tracker = started();
		tracker.messageUpdate(
			message(),
			{ type: "start", partial: { content: [] } } as unknown as AssistantMessageEvent,
			0,
		);
		tracker.messageUpdate(
			message(),
			{
				type: "text_start",
				contentIndex: 0,
				partial: { content: [] },
			} as unknown as AssistantMessageEvent,
			0,
		);
		exact(tracker);
		expect(tracker.snapshot(600)).toBeDefined();
		tracker.messageUpdate(
			message(1000),
			{ type: "done", message: message(1000), reason: "stop" } as AssistantMessageEvent,
			1100,
		);
		expect(tracker.snapshot(1100)).toBeUndefined();
	});

	it("final-only usage never contributes a sample or retains settled rate", () => {
		const tracker = started();
		tracker.messageEnd(message(1000), 500);
		expect(tracker.snapshot(500)).toBeUndefined();
		tracker.turnStart(600);
		exact(tracker); // regressing event time also fails quiet
		expect(tracker.snapshot(600)).toBeUndefined();
		tracker.turnStart(1000);
		tracker.messageUpdate(message(), delta("abcd"), 1100);
		tracker.messageUpdate(message(), delta("efgh"), 1600);
		expect(tracker.snapshot(1600)).toBeDefined();
		tracker.messageEnd(message(500), 1600);
		expect(tracker.snapshot(1600)).toBeUndefined();
	});

	it("counts generated text, thinking and tool arguments, never tool execution", () => {
		const tracker = started();
		tracker.messageUpdate(message(), delta("abc", "abc"), 0);
		tracker.messageUpdate(message(), delta("def", "def", "thinking_delta", 1), 250);
		tracker.messageUpdate(message(), delta("ghi", undefined, "toolcall_delta", 2), 500);
		expect(formatTokenRate(tracker.snapshot(500))).toBe("~4 tok/s");
		tracker.suspend(); // integration calls on tool start
		expect(tracker.messageUpdate(message(), delta("execution"), 1000)).toBe(false);
		expect(tracker.snapshot(1000)).toBeUndefined();
	});

	it("reuses Unicode/split surrogate counting and cumulative replay rejection", () => {
		const tracker = started();
		tracker.messageUpdate(message(), delta("\ud83d", "\ud83d"), 0);
		tracker.messageUpdate(message(), delta("\udca1abc", "💡abc"), 100);
		expect(tracker.messageUpdate(message(), delta("\udca1abc", "💡abc"), 200)).toBe(false);
		tracker.messageUpdate(message(), delta("💡def", "💡abc💡def"), 600);
		expect(tracker.snapshot(600)).toMatchObject({ tokensPerSecond: 2, observedAt: 600 });
		expect(tracker.messageUpdate(message(), delta("💡def", "💡abc💡def"), 2000)).toBe(false);
		expect(tracker.snapshot(2601)).toBeUndefined();
	});

	it("accepted sub-token accounting changes do not refresh an unchanged output counter", () => {
		const tracker = started();
		tracker.messageUpdate(message(), delta("a", "a"), 0);
		tracker.messageUpdate(message(), delta("bcde", "abcde"), 500);
		expect(tracker.messageUpdate(message(), delta("f", "abcdef"), 1000)).toBe(true);
		expect(tracker.snapshot(1000)).toMatchObject({ observedAt: 500, tokensPerSecond: 2 });
		expect(tracker.messageUpdate(message(), delta("f", "abcdef"), 1500)).toBe(false);
	});

	it("unchanged usage/input-only updates do not refresh output time", () => {
		const tracker = started();
		exact(tracker);
		expect(tracker.messageUpdate(message(30), undefined, 1000)).toBe(false);
		expect(
			tracker.messageUpdate(
				{ role: "assistant", usage: { input: 20, output: 30 } },
				undefined,
				2000,
			),
		).toBe(false);
		expect(tracker.snapshot(2600)).toMatchObject({ observedAt: 600 });
		expect(tracker.snapshot(2601)).toBeUndefined();
	});

	it("returns detached immutable snapshots", () => {
		const tracker = started();
		exact(tracker);
		const snapshot = tracker.snapshot(600);
		expect(Object.isFrozen(snapshot)).toBe(true);
		tracker.messageUpdate(message(50), undefined, 1100);
		expect(snapshot?.observedAt).toBe(600);
		expect(tracker.snapshot(1100)).not.toBe(snapshot);
	});
});

describe("TokenRateTracker identity, integrity and lifecycle", () => {
	it("requires run and turn authorization; rejects stale/mismatched/wrong-role finals", () => {
		const tracker = new TokenRateTracker(() => 0);
		expect(tracker.messageUpdate(message(1))).toBe(false);
		tracker.agentStart(0);
		expect(tracker.messageUpdate(message(1))).toBe(false);
		tracker.turnStart(0);
		exact(tracker, " a ");
		tracker.messageEnd({ role: "tool", responseId: "a" }, 600);
		tracker.messageEnd(message(100, "b"), 600);
		expect(tracker.snapshot(600)).toBeDefined();
		tracker.turnStart(700); // retry closes prior identity
		expect(tracker.messageUpdate(message(100, "a"), undefined, 700)).toBe(false);
		tracker.messageEnd(message(100, "a"), 700);
		tracker.messageUpdate(message(1, "b"), undefined, 800);
		tracker.messageUpdate(message(11, "b"), undefined, 1300);
		tracker.messageEnd(message(100, "a"), 1300);
		expect(tracker.snapshot(1300)).toBeDefined();
		tracker.messageEnd(message(11, "b"), 1300);
		expect(tracker.snapshot(1300)).toBeUndefined();
		expect(tracker.messageUpdate(message(20, "b"), undefined, 1400)).toBe(false);
	});

	it("retains bounded identity rejection plus the most recent overflow identity", () => {
		const tracker = started();
		for (let index = 0; index < 258; index++) {
			tracker.turnStart(index);
			tracker.messageEnd(message(1, `id-${index}`), index);
		}
		tracker.turnStart(258);
		expect(tracker.messageUpdate(message(1, "id-0"), undefined, 258)).toBe(false);
		expect(tracker.messageUpdate(message(1, "id-257"), undefined, 258)).toBe(false);
		expect(tracker.messageUpdate(message(1, "new"), undefined, 258)).toBe(true);
	});

	it("normalizes short IDs, treats oversized IDs as anonymous and supports promotion", () => {
		const tracker = started();
		tracker.messageUpdate(message(1, "x".repeat(129)), undefined, 0);
		tracker.messageUpdate(message(11, "  promoted  "), undefined, 500);
		expect(tracker.messageUpdate(message(21, "different"), undefined, 1000)).toBe(false);
		expect(tracker.snapshot(1000)).toMatchObject({ observedAt: 500 });
	});

	it.each(["tool", "idle", "compaction"])(
		"suspend clears %s and only a new turn authorizes output",
		() => {
			const tracker = started();
			exact(tracker);
			tracker.suspend();
			expect(tracker.snapshot(600)).toBeUndefined();
			expect(tracker.messageUpdate(message(100), undefined, 700)).toBe(false);
			tracker.turnStart(1000);
			tracker.messageUpdate(message(1), undefined, 1100);
			tracker.messageUpdate(message(11), undefined, 1600);
			expect(tracker.snapshot(1600)?.tokensPerSecond).toBe(20);
		},
	);

	it.each(["reset", "shutdown", "agentStart"] as const)(
		"%s clears session/model/run identity and is reusable",
		(method) => {
			const tracker = started();
			exact(tracker, "reuse");
			tracker[method]();
			expect(tracker.snapshot(0)).toBeUndefined();
			tracker.agentStart(1000);
			tracker.turnStart(1000);
			tracker.messageUpdate(message(1, "reuse"), undefined, 1100);
			tracker.messageUpdate(message(11, "reuse"), undefined, 1600);
			expect(tracker.snapshot(1600)).toBeDefined();
		},
	);

	it.each([NaN, Infinity, -1, 99])(
		"fails quiet and rebaselines invalid/regressing clocks (%s)",
		(at) => {
			const tracker = started();
			exact(tracker);
			expect(tracker.snapshot(at)).toBeUndefined();
			tracker.messageUpdate(message(40), undefined, 1000);
			expect(tracker.snapshot(1000)).toBeUndefined();
			tracker.messageUpdate(message(50), undefined, 1500);
			expect(tracker.snapshot(1500)?.tokensPerSecond).toBe(20);
		},
	);

	it("uses injected monotonic clock defaults without timers", () => {
		let now = 0;
		const tracker = new TokenRateTracker(() => now);
		tracker.agentStart();
		tracker.turnStart();
		now = 5000;
		tracker.messageUpdate(message(1));
		now = 5500;
		tracker.messageUpdate(message(11));
		expect(tracker.snapshot()?.tokensPerSecond).toBe(20);
	});

	it.each([
		message(9),
		{ role: "assistant", usage: { input: 9, output: 40 } },
		{ role: "assistant", usage: { input: 10, output: Infinity } },
		{ role: "assistant", usage: { input: 10, output: Number.MAX_SAFE_INTEGER + 1 } },
	])("suppresses corrected/unsafe counters until another response %#", (invalid) => {
		const tracker = started();
		exact(tracker);
		expect(tracker.messageUpdate(invalid, undefined, 700)).toBe(true);
		expect(tracker.snapshot(700)).toBeUndefined();
		expect(tracker.messageUpdate(message(100), undefined, 1200)).toBe(false);
		tracker.turnStart(1300);
		tracker.messageUpdate(message(1), undefined, 1400);
		tracker.messageUpdate(message(11), undefined, 1900);
		expect(tracker.snapshot(1900)).toBeDefined();
	});

	it.each([
		{ type: "unknown" },
		{ type: "thinking_end", contentIndex: 0, partial: { content: [] } },
		{ type: "start" },
		{ type: "text_delta", contentIndex: 0, delta: "x" },
		{ type: "toolcall_delta", contentIndex: 0, delta: "x", partial: { content: [] } },
		{ type: "text_delta", contentIndex: 65536, delta: "x", partial: { content: [] } },
		{ type: "text_delta", contentIndex: 0, delta: 1, partial: { content: [] } },
		{
			type: "text_delta",
			contentIndex: 0,
			delta: "x",
			partial: { content: [{ type: "thinking", thinking: "x" }] },
		},
	])("unsupported/malformed event clears rate and suppresses integrity loss %#", (event) => {
		const tracker = started();
		exact(tracker);
		tracker.messageUpdate(message(40), event as AssistantMessageEvent, 700);
		expect(tracker.snapshot(700)).toBeUndefined();
		expect(tracker.messageUpdate(message(50), undefined, 1200)).toBe(false);
	});

	it("rewritten cumulative snapshots invalidate, shorter stale snapshots clear/rebaseline", () => {
		const tracker = started();
		tracker.messageUpdate(message(), delta("abcd", "abcd"), 0);
		tracker.messageUpdate(message(), delta("efgh", "abcdefgh"), 500);
		tracker.messageUpdate(message(), delta("rewrite", "abcdzzzz"), 600);
		expect(tracker.snapshot(600)).toBeUndefined();
		expect(tracker.messageUpdate(message(), delta("more", "abcdzzzzmore"), 1100)).toBe(false);
		tracker.turnStart(1200);
		tracker.messageUpdate(message(), delta("abcd", "abcd"), 1300);
		tracker.messageUpdate(message(), delta("efgh", "abcdefgh"), 1800);
		tracker.messageUpdate(message(), delta("stale", "abcd"), 1900);
		expect(tracker.snapshot(1900)).toBeUndefined();
		tracker.messageUpdate(message(), delta("ijkl", "abcdefghijkl"), 2000);
		tracker.messageUpdate(message(), delta("mnop", "abcdefghijklmnop"), 2500);
		expect(tracker.snapshot(2500)?.tokensPerSecond).toBe(2);
	});

	it.each(["delta", "snapshot", "blocks", "generated", "samples"])(
		"fails quiet at bounded %s overflow",
		(limit) => {
			const tracker = started();
			if (limit === "delta") tracker.messageUpdate(message(), delta("x".repeat(65537)), 0);
			if (limit === "snapshot")
				tracker.messageUpdate(message(), delta("x", "x".repeat(1048577)), 0);
			if (limit === "blocks")
				for (let i = 0; i < 129; i++)
					tracker.messageUpdate(message(), delta("abcd", undefined, "text_delta", i), i);
			if (limit === "generated")
				for (let i = 0; i < 65; i++)
					tracker.messageUpdate(
						message(),
						delta("x".repeat(65536), undefined, "text_delta", Math.floor(i / 16)),
						i,
					);
			if (limit === "samples")
				for (let i = 0; i < 513; i++) tracker.messageUpdate(message(i + 1), undefined, i);
			expect(tracker.snapshot(1000)).toBeUndefined();
			expect(tracker.messageUpdate(message(10000), undefined, 1500)).toBe(false);
		},
	);
});

describe("formatTokenRate", () => {
	const valid: TokenRateSnapshot = {
		tokensPerSecond: 47.6,
		approximate: false,
		source: "provider",
		observedAt: 1000,
		windowMs: 500,
	};
	it("rounds exact and approximate rates", () => {
		expect(formatTokenRate(valid)).toBe("48 tok/s");
		expect(formatTokenRate({ ...valid, source: "estimate", approximate: true })).toBe("~48 tok/s");
	});
	it.each([
		undefined,
		{ ...valid, tokensPerSecond: 0 },
		{ ...valid, tokensPerSecond: 0.1 },
		{ ...valid, tokensPerSecond: NaN },
		{ ...valid, tokensPerSecond: Infinity },
		{ ...valid, tokensPerSecond: -1 },
		{ ...valid, observedAt: NaN },
		{ ...valid, windowMs: 499 },
		{ ...valid, windowMs: 3001 },
		{ ...valid, approximate: true },
	])("hides invalid or unuseful values %#", (value) => {
		expect(formatTokenRate(value)).toBe("");
	});
});
