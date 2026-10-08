import { describe, expect, it } from "vitest";
import { InteractionMetricsTracker } from "../extensions/zentui/interaction-summary";
import { TurnSummaryRateTracker } from "../extensions/zentui/turn-summary-rate";

function fixture(enabled = true) {
	let now = 0;
	const rate = new TurnSummaryRateTracker(() => now);
	const metrics = new InteractionMetricsTracker(() => now);
	const start = (collect = enabled) =>
		rate.agentStart(metrics.agentStart().interactionStarted, collect);
	const turn = (at: number) => {
		now = at;
		metrics.turnStart();
		rate.turnStart();
	};
	const end = (at: number, output?: number, stopReason = "stop", input = 10) => {
		now = at;
		const message = {
			role: "assistant",
			...(output === undefined ? {} : { usage: { input, output } }),
			stopReason,
		};
		rate.messageEnd(message, metrics.messageEnd(message));
	};
	const endRun = () => {
		metrics.agentEnd();
		rate.agentEnd();
	};
	const settle = (idle: boolean) => {
		const settled = metrics.settle(idle);
		return settled ? rate.settle(settled.nextStartedAt === undefined) : undefined;
	};
	start();
	return { start, turn, end, endRun, settle, rate };
}

describe("passive settled summary average", () => {
	it("sums all continuation calls, not per-call rates or interaction wall duration", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000, 120);
		f.endRun();
		f.start();
		f.turn(14000);
		f.end(16000, 180);
		f.endRun();
		expect(f.settle(true)).toBe(50);
		expect(f.settle(true)).toBeUndefined();
	});
	it("snapshots only A120/4 and preserves B180/2 plus its open second anchor", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000, 120);
		f.endRun();
		f.start();
		f.turn(14000);
		f.end(16000, 180);
		f.turn(18000);
		expect(f.settle(false)).toBe(30);
		expect(f.settle(false)).toBeUndefined();
		f.end(22000, 120);
		f.endRun();
		expect(f.settle(true)).toBe(50); // B300/6; first B call and open anchor both survived
	});
	it("A120/4 yields 30 while surviving B180/2 yields 90, never combined 50", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000, 120);
		f.endRun();
		f.start();
		f.turn(14000);
		f.end(16000, 180);
		expect(f.settle(false)).toBe(30);
		f.endRun();
		expect(f.settle(true)).toBe(90);
	});
	it("preserves a surviving run's unknown state, without poisoning settled A", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000, 120);
		f.endRun();
		f.start();
		f.turn(14000);
		f.end(16000);
		expect(f.settle(false)).toBe(30);
		f.turn(18000);
		f.end(20000, 180);
		f.endRun();
		expect(f.settle(true)).toBeUndefined();
	});
	it("drops settled unknown without poisoning a trustworthy surviving B", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000);
		f.endRun();
		f.start();
		f.turn(14000);
		f.end(16000, 180);
		expect(f.settle(false)).toBeUndefined();
		f.endRun();
		expect(f.settle(true)).toBe(90);
	});
	it("never claims a partial aggregate after late enablement, even at continuation", () => {
		const f = fixture(false);
		f.turn(0);
		f.end(4000, 120);
		f.endRun();
		f.start(true);
		f.turn(14000);
		f.end(16000, 180);
		f.endRun();
		expect(f.settle(true)).toBeUndefined();
		f.start(true);
		f.turn(20000);
		f.end(22000, 180);
		f.endRun();
		expect(f.settle(true)).toBe(90);
	});
	it("disable/re-enable midcall taints coverage through subsequent valid calls", () => {
		const f = fixture();
		f.turn(0);
		f.rate.reconcile(false);
		f.rate.reconcile(true);
		f.end(4000, 120);
		f.turn(14000);
		f.end(16000, 180);
		f.endRun();
		expect(f.settle(true)).toBeUndefined();
	});
	it.each(["error", "aborted"])(
		"omits all-zero %s placeholder but retains positive reported failed usage",
		(reason) => {
			const f = fixture();
			f.turn(0);
			f.end(4000, 20, reason);
			f.endRun();
			expect(f.settle(true)).toBe(5);
			f.start();
			f.turn(10000);
			f.end(12000, 0, reason, 0);
			f.endRun();
			expect(f.settle(true)).toBeUndefined();
		},
	);
	it("supports honest zero output and rejects unclosed calls without estimation", () => {
		const f = fixture();
		f.turn(0);
		f.end(4000, 0, "stop", 0);
		f.endRun();
		expect(f.settle(true)).toBe(0);
		f.start();
		f.turn(10000);
		f.end(12000, 120);
		f.turn(13000);
		f.endRun();
		expect(f.settle(true)).toBeUndefined();
	});
});
