import { describe, expect, it } from "vitest";
import { readOmpTemplateMetrics } from "../extensions/zentui/omp-template-metrics";

const context = { sessionManager: { getSessionId: () => "session-id" } };
const names = new Set(["session_id", "subagent_count", "active_time", "token_rate"]);
const assistant = { role: "assistant", timestamp: 1000, duration: 2000, usage: { output: 100 } };

function source(isStreaming = false, workerTokenRate?: number | null) {
	const messages: unknown[] = [assistant];
	return {
		receiver: { subagentCount: 0, getActiveMs: () => 65_000 },
		session: { state: { messages }, isStreaming },
		workerTokenRate,
	};
}

describe("OMP public template metrics", () => {
	it("distinguishes native active processing from session age and an idle turn", () => {
		const data = source();
		expect(readOmpTemplateMetrics(context, names, data)).toEqual({
			session_id: "session-id",
			subagent_count: "0",
			active_time: "1m 5s",
			token_rate: "50.0 tok/s",
		});
		data.receiver.getActiveMs = () => 0;
		expect(readOmpTemplateMetrics(context, names, data).active_time).toBe("0s");
	});

	it("adds current main throughput to streaming workers, never a stale idle main reply", () => {
		expect(readOmpTemplateMetrics(context, names, source(true, 25)).token_rate).toBe("75.0 tok/s");
		expect(readOmpTemplateMetrics(context, names, source(false, 25)).token_rate).toBe("25.0 tok/s");
		expect(readOmpTemplateMetrics(context, names, source(false, null)).token_rate).toBe(
			"50.0 tok/s",
		);
	});

	it("does not fabricate rates from unknown output, too-short spans or invalid public metrics", () => {
		for (const message of [
			{ ...assistant, usage: { output: 0 } },
			{ ...assistant, usage: { output: Number.NaN } },
			{ ...assistant, duration: 20 },
			{ ...assistant, duration: undefined },
		]) {
			const data = source();
			data.session.state.messages = [message];
			expect(readOmpTemplateMetrics(context, names, data).token_rate).toBeUndefined();
		}
		const data = { receiver: { subagentCount: -1, getActiveMs: () => Infinity }, session: {} };
		expect(readOmpTemplateMetrics(context, names, data)).toEqual({ session_id: "session-id" });
	});

	it("keeps session identity available when native metrics throw or are not supported", () => {
		const data = {
			receiver: {
				get subagentCount() {
					throw new Error("getter unavailable");
				},
				getActiveMs() {
					throw new Error("meter unavailable");
				},
			},
			session: {
				get state() {
					throw new Error("messages unavailable");
				},
			},
		};
		expect(readOmpTemplateMetrics(context, names, data)).toEqual({ session_id: "session-id" });
		expect(readOmpTemplateMetrics(context, names)).toEqual({ session_id: "session-id" });
	});
});
