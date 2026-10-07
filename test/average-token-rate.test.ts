import { describe, expect, it } from "vitest";
import {
	AverageTokenRateTracker,
	formatAverageTokenRate,
} from "../extensions/zentui/average-token-rate";
import { InteractionMetricsTracker } from "../extensions/zentui/interaction-summary";

function fixture() {
	let now = 0;
	const average = new AverageTokenRateTracker(() => now);
	const metrics = new InteractionMetricsTracker(() => now);
	const message = (output?: number, responseId = "one", stopReason = "stop", input = 10) => ({
		role: "assistant",
		responseId,
		stopReason,
		...(output === undefined ? {} : { usage: { input, output } }),
	});
	const start = () => average.agentStart(metrics.agentStart().interactionStarted);
	const turn = (at: number) => {
		now = at;
		metrics.turnStart();
		average.turnStart();
	};
	const end = (at: number, value = message(120)) => {
		now = at;
		const result = metrics.messageEnd(value);
		average.messageEnd(value, result);
		return result;
	};
	start();
	return { average, metrics, message, start, turn, end };
}

describe("AverageTokenRateTracker completed model work", () => {
	it("includes initial wait, sums per-call output/durations and excludes tool gaps", () => {
		const f = fixture();
		f.turn(0);
		f.metrics.messageUpdate(f.message(10), undefined, 2000); // two seconds initial wait
		expect(f.average.snapshot()).toBeUndefined();
		f.end(4000);
		expect(f.average.snapshot()).toBe(30); // 120/4, not 120/2
		f.turn(14000); // ten-second tool gap
		expect(f.average.snapshot()).toBe(30); // completed calls so far during this call
		f.end(16000, f.message(180, "two"));
		expect(f.average.snapshot()).toBe(50); // 300/6, not (30+90)/2 or 300/16
	});
	it("retains across continuation agent_start and settlement, resets only a new interaction", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000);
		f.metrics.agentEnd();
		f.average.suspend();
		f.start();
		expect(f.average.snapshot()).toBe(30);
		f.turn(14000);
		f.end(16000, f.message(180, "two"));
		expect(f.average.snapshot()).toBe(50);
		f.metrics.agentEnd();
		f.average.suspend();
		f.metrics.settle(true);
		expect(f.average.snapshot()).toBe(50);
		f.start();
		expect(f.average.snapshot()).toBeUndefined();
	});
	it("accepts final-only usage with observed timing and honest successful zero", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000, f.message(0, "one", "stop", 0));
		expect(formatAverageTokenRate(f.average.snapshot())).toBe("0 tok/s avg");
		f.turn(10000);
		f.end(12000, f.message(120, "two"));
		expect(f.average.snapshot()).toBe(20); // zero-output duration still included
	});
	it.each([undefined, NaN, -1, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
		"missing/invalid final output %s poisons the aggregate, never falling back to live usage",
		(output) => {
			const f = fixture();
			f.turn(0);
			f.end(4000);
			f.turn(5000);
			f.metrics.messageUpdate(f.message(60, "two"));
			f.end(7000, f.message(output, "two"));
			expect(f.average.snapshot()).toBeUndefined();
			f.turn(8000);
			f.end(10000, f.message(100, "three"));
			expect(formatAverageTokenRate(f.average.snapshot())).toBe("— tok/s avg");
		},
	);
	it.each(["error", "aborted"])(
		"rejects all-zero %s placeholders, accepts positive reported partial usage",
		(reason) => {
			const f = fixture();
			f.turn(0);
			f.end(4000, f.message(20, "one", reason));
			expect(f.average.snapshot()).toBe(5);
			f.turn(5000);
			f.end(7000, f.message(0, "two", reason, 0));
			expect(f.average.snapshot()).toBeUndefined();
		},
	);
	it("duplicate and mismatched finals cannot close or count a newer call", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000);
		f.turn(5000);
		f.metrics.messageUpdate(f.message(10, "two"));
		expect(f.end(5500).status).toBe("duplicate");
		expect(f.end(6000, f.message(999, "other")).status).toBe("rejected");
		expect(f.average.snapshot()).toBe(30);
		f.end(7000, f.message(180, "two"));
		expect(f.average.snapshot()).toBe(50);
	});
	it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		"invalid/regressing/zero-duration final time %s fails closed",
		(at) => {
			const f = fixture();
			f.turn(0);
			f.end(at);
			expect(f.average.snapshot()).toBeUndefined();
			f.turn(10000);
			f.end(12000, f.message(120, "two"));
			expect(f.average.snapshot()).toBeUndefined();
		},
	);
	it("observed intermediate clock regression and invalid turn starts remain unknown", () => {
		for (const at of [NaN, Infinity, -1, 0]) {
			const f = fixture();
			f.turn(at);
			f.average.observeTime(2000);
			f.average.observeTime(1000);
			f.end(4000);
			expect(f.average.snapshot()).toBeUndefined();
		}
	});
	it("missing timing or unfinished included calls cannot yield a partial exact aggregate", () => {
		const f = fixture();
		f.metrics.turnStart();
		f.end(4000);
		expect(f.average.snapshot()).toBeUndefined();
		const other = fixture();
		other.turn(0);
		other.end(4000);
		other.turn(5000);
		other.average.suspend();
		expect(other.average.snapshot()).toBeUndefined();
		other.turn(10000);
		other.end(12000, other.message(120, "two"));
		expect(other.average.snapshot()).toBeUndefined();
	});
	it("boundary reset ignores old finals and permits the next properly observed current-model call", () => {
		const f = fixture();
		f.turn(0);
		f.average.reset();
		f.end(4000);
		expect(f.average.snapshot()).toBeUndefined();
		f.turn(10000);
		f.end(12000, f.message(120, "two"));
		expect(f.average.snapshot()).toBe(60);
	});
	it("fails closed on aggregate integer overflow", () => {
		const f = fixture();
		f.turn(0);
		f.end(1000, f.message(Number.MAX_SAFE_INTEGER));
		f.turn(2000);
		f.end(3000, f.message(1, "two"));
		expect(f.average.snapshot()).toBeUndefined();
	});
});
