import { stripVTControlCharacters } from "node:util";
import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	formatTurnSummary,
	InteractionMetricsTracker,
	isTurnSummaryData,
	parseAssistantMessageTokens,
	renderTurnSummaryEntry,
	subtractThoughtIntervalsWithinCap,
	TURN_SUMMARY_ENTRY_TYPE,
} from "../extensions/zentui/interaction-summary";

const stripTerminalSequences = stripVTControlCharacters;

type AssistantOptions = {
	responseId?: string;
	timestamp?: number;
	provider?: string;
	model?: string;
	stopReason?: string;
	content?: unknown[];
};

function assistant(input: number, output: number, options: AssistantOptions = {}) {
	return {
		role: "assistant" as const,
		usage: { input, output, cacheRead: 999, cacheWrite: 888, cost: { total: 1 } },
		content: options.content ?? [],
		api: "test",
		provider: options.provider ?? "provider",
		model: options.model ?? "model",
		stopReason: options.stopReason ?? "stop",
		timestamp: options.timestamp ?? 1,
		responseId: options.responseId,
	};
}

function delta(
	type: "text_delta" | "thinking_delta",
	contentIndex: number,
	value: string,
	cumulative?: string,
) {
	const content: unknown[] = [];
	if (cumulative !== undefined) {
		content[contentIndex] =
			type === "text_delta"
				? { type: "text", text: cumulative }
				: { type: "thinking", thinking: cumulative };
	}
	return {
		type,
		contentIndex,
		delta: value,
		partial: assistant(0, 0, { content }),
	} as never;
}

function toolDelta(contentIndex: number, value: string, includeBlock = true) {
	const content: unknown[] = [];
	if (includeBlock) {
		content[contentIndex] = { type: "toolCall", id: "call-1", name: "bash", arguments: {} };
	}
	return {
		type: "toolcall_delta",
		contentIndex,
		delta: value,
		partial: assistant(0, 0, { content }),
	} as never;
}

function accepted(
	tokens: { input: number; output: number },
	source: "final" | "last-snapshot" | "no-snapshot" = "final",
	displayTokens = { ...tokens, outputApproximate: false },
) {
	return { status: "accepted", tokens, displayTokens, source };
}

describe("live interaction token display", () => {
	it("starts terminal-only streams at zero approximate and estimates text plus thinking", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		expect(tracker.messageUpdate(assistant(0, 0)).displayTokens).toEqual({
			input: 0,
			output: 0,
			outputApproximate: true,
		});
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "abc", "abc")).displayTokens,
		).toEqual({ input: 0, output: 1, outputApproximate: true });
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("thinking_delta", 1, "defgh", "defgh"))
				.displayTokens,
		).toEqual({ input: 0, output: 2, outputApproximate: true });
	});

	it("counts cumulative Unicode code points and ignores unchanged or stale snapshots", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		const first = tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "💡ab", "💡ab"));
		expect(first.displayTokens).toEqual({ input: 0, output: 1, outputApproximate: true });
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "💡ab", "💡ab")).usageChanged,
		).toBe(false);
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "x", "💡a")).usageChanged,
		).toBe(false);
	});

	it("counts split surrogate pairs once in raw fallback and saturates estimates", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "\ud83d"));
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "\udca1abc")).displayTokens,
		).toEqual({ input: 0, output: 1, outputApproximate: true });
		const huge = new InteractionMetricsTracker();
		huge.agentStart();
		huge.turnStart();
		huge.messageUpdate(assistant(0, Number.MAX_SAFE_INTEGER));
		expect(
			huge.messageUpdate(assistant(0, Number.MAX_SAFE_INTEGER), delta("text_delta", 0, "more"))
				.displayTokens,
		).toEqual({ input: 0, output: Number.MAX_SAFE_INTEGER, outputApproximate: true });
	});

	it("anchors estimates to advancing provider output and final corrects downward", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(10, 2), delta("text_delta", 0, "abcdefgh", "abcdefgh"));
		expect(
			tracker.messageUpdate(assistant(10, 2), delta("text_delta", 0, "ijkl", "abcdefghijkl"))
				.displayTokens,
		).toEqual({ input: 10, output: 3, outputApproximate: true });
		expect(tracker.messageUpdate(assistant(9, 1)).displayTokens).toEqual({
			input: 10,
			output: 3,
			outputApproximate: true,
		});
		expect(tracker.messageEnd(assistant(10, 2))).toEqual(accepted({ input: 10, output: 2 }));
		expect(tracker.currentTokens()).toEqual({ input: 10, output: 2 });
	});

	it("retains live estimate state across non-idle partition while settling provider-only totals", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart();
		tracker.messageEnd(assistant(5, 1, { responseId: "settled" }));
		tracker.agentEnd(10);
		tracker.agentStart(20);
		tracker.turnStart();
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "live" }),
			delta("text_delta", 0, "abcdefgh", "abcdefgh"),
		);
		expect(tracker.settle(false, 30)).toMatchObject({
			summary: { input: 5, output: 1 },
			nextTokens: { input: 0, output: 2, outputApproximate: true },
		});
		expect(tracker.currentDisplayTokens()).toEqual({
			input: 0,
			output: 2,
			outputApproximate: true,
		});
	});

	it("handles sparse cumulative thinking indexes and divergent snapshots conservatively", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("thinking_delta", 7, "abcd", "abcd"))
				.displayTokens,
		).toEqual({ input: 0, output: 1, outputApproximate: true });
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("thinking_delta", 7, "efgh", "abcdefgh"))
				.displayTokens,
		).toEqual({ input: 0, output: 2, outputApproximate: true });
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("thinking_delta", 7, "zzzz", "abcdzzzz"))
				.usageChanged,
		).toBe(false);
		expect(tracker.diagnostics()).toMatchObject({
			contentBlocks: 1,
			retainedContentUnits: 8,
			estimateIncomplete: true,
		});
	});

	it("joins cumulative split surrogates across an unchanged pending snapshot", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "\ud83d", "\ud83d"));
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "", "\ud83d")).usageChanged,
		).toBe(false);
		expect(
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "\udca1abc", "💡abc"))
				.displayTokens,
		).toEqual({ input: 0, output: 1, outputApproximate: true });
	});

	it("validates malformed event boundaries before any mutation", () => {
		for (const event of [
			{ type: "thinking_delta", contentIndex: 0, delta: "x" },
			{ type: "thinking_delta", contentIndex: 0, delta: 1, partial: { content: [] } },
			{ type: "thinking_delta", contentIndex: 0, delta: "x", partial: { content: {} } },
			{
				type: "thinking_delta",
				contentIndex: 0,
				delta: "x",
				partial: { content: [{ type: "text", text: "x" }] },
			},
			{ type: "thinking_start", contentIndex: 65_536, partial: { content: [] } },
		] as const) {
			const tracker = new InteractionMetricsTracker();
			tracker.agentStart(0);
			tracker.turnStart(0);
			expect(() => tracker.messageUpdate(assistant(-1, 1), event as never, 10)).not.toThrow();
			expect(tracker.currentTokens()).toEqual({ input: 0, output: 0 });
			expect(tracker.currentThought(20)).toEqual({ durationMs: 0, active: false });
			expect(tracker.diagnostics().contentBlocks).toBe(0);
		}
	});

	it("releases bounded estimator state on closure", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "abcdefgh", "abcdefgh"));
		expect(tracker.diagnostics()).toMatchObject({ activeResponses: 1, contentBlocks: 1 });
		expect(tracker.messageEnd(assistant(2, 1))).toEqual(accepted({ input: 2, output: 1 }));
		expect(tracker.diagnostics()).toMatchObject({
			activeResponses: 0,
			contentBlocks: 0,
			retainedContentUnits: 0,
		});
	});

	it("processes progressive cumulative snapshots incrementally with bounded retention", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		let cumulative = "";
		const started = performance.now();
		for (let index = 0; index < 20_000; index++) {
			cumulative += "x";
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "x", cumulative));
		}
		expect(performance.now() - started).toBeLessThan(5_000);
		expect(tracker.currentDisplayTokens()).toEqual({
			input: 0,
			output: 5_000,
			outputApproximate: true,
		});
		expect(tracker.diagnostics()).toMatchObject({
			contentBlocks: 1,
			maxContentTailUnits: 64,
			retainedContentUnits: 64,
		});
	});

	it("bounds block, delta, snapshot, generated, and thought estimator state without losing final usage", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		for (let index = 0; index < 129; index++) {
			expect(() =>
				tracker.messageUpdate(assistant(0, 0), delta("text_delta", index, "x")),
			).not.toThrow();
		}
		expect(tracker.diagnostics().contentBlocks).toBe(128);
		expect(() =>
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "x".repeat(65_537))),
		).not.toThrow();
		expect(() =>
			tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "x", "x".repeat(1_048_577))),
		).not.toThrow();
		for (let index = 0; index < 65; index++) {
			expect(() =>
				tracker.messageUpdate(
					assistant(0, 0),
					delta("text_delta", index % 128, "x".repeat(65_536)),
				),
			).not.toThrow();
		}
		for (let index = 0; index < 257; index++) {
			expect(() =>
				tracker.messageUpdate(
					assistant(0, 0),
					{
						type: "thinking_start",
						contentIndex: index,
						partial: { content: [] },
					} as never,
					index,
				),
			).not.toThrow();
		}
		expect(tracker.diagnostics()).toMatchObject({
			contentBlocks: 128,
			thoughtBlocks: 256,
			estimateIncomplete: true,
		});
		expect(tracker.messageEnd(assistant(11, 7), 300)).toEqual(accepted({ input: 11, output: 7 }));
	});

	it("counts every raw tool-call chunk independently and exact final usage reconciles it", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		expect(tracker.messageUpdate(assistant(0, 0), toolDelta(0, "abcdefgh"), 10)).toMatchObject({
			displayTokens: { input: 0, output: 2, outputApproximate: true },
			usageChanged: true,
			thoughtChanged: false,
		});
		expect(
			tracker.messageUpdate(assistant(0, 0), toolDelta(0, "abcdefgh"), 20).displayTokens,
		).toEqual({ input: 0, output: 4, outputApproximate: true });
		expect(tracker.currentThought(30)).toEqual({ durationMs: 0, active: false });
		expect(tracker.diagnostics()).toMatchObject({ contentBlocks: 1, thoughtBlocks: 0 });
		expect(tracker.messageEnd(assistant(7, 1), 40)).toEqual(accepted({ input: 7, output: 1 }));
	});

	it("ceilings mixed text, thinking, and tool-call output together", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "abc", "abc"));
		tracker.messageUpdate(assistant(0, 0), delta("thinking_delta", 1, "def", "def"));
		expect(tracker.messageUpdate(assistant(0, 0), toolDelta(2, "ghi")).displayTokens).toEqual({
			input: 0,
			output: 3,
			outputApproximate: true,
		});
		expect(tracker.diagnostics().contentBlocks).toBe(3);
	});

	it("rejects malformed tool deltas atomically and bounds oversized tool-call state", () => {
		for (const event of [
			{ type: "toolcall_delta", contentIndex: 0, delta: "x" },
			{ type: "toolcall_delta", contentIndex: 0, delta: 1, partial: { content: [] } },
			{ type: "toolcall_delta", contentIndex: 0, delta: "x", partial: { content: [] } },
			{ type: "toolcall_delta", contentIndex: 0, delta: "x", partial: { content: {} } },
			{
				type: "toolcall_delta",
				contentIndex: 0,
				delta: "x",
				partial: { content: [{ type: "text", text: "x" }] },
			},
		] as const) {
			const tracker = new InteractionMetricsTracker();
			tracker.agentStart();
			tracker.turnStart();
			expect(tracker.messageUpdate(assistant(0, 0), event as never).usageChanged).toBe(false);
			expect(tracker.diagnostics()).toMatchObject({ contentBlocks: 0, estimateIncomplete: false });
		}

		const oversized = new InteractionMetricsTracker();
		oversized.agentStart();
		oversized.turnStart();
		expect(
			oversized.messageUpdate(assistant(0, 0), toolDelta(0, "x".repeat(65_537))).usageChanged,
		).toBe(true);
		expect(oversized.currentDisplayTokens()).toEqual({
			input: 0,
			output: 0,
			outputApproximate: true,
		});
		expect(oversized.diagnostics()).toMatchObject({
			contentBlocks: 0,
			estimateIncomplete: true,
		});
		expect(oversized.messageEnd(assistant(11, 7))).toEqual(accepted({ input: 11, output: 7 }));
	});

	it("caps tool-call blocks and preserves exact final reconciliation", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		for (let index = 0; index < 129; index++) {
			tracker.messageUpdate(assistant(0, 0), toolDelta(index, "x"));
		}
		expect(tracker.diagnostics()).toMatchObject({
			contentBlocks: 128,
			estimateIncomplete: true,
		});
		expect(tracker.messageEnd(assistant(9, 4))).toEqual(accepted({ input: 9, output: 4 }));
		expect(tracker.diagnostics()).toMatchObject({ contentBlocks: 0, retainedContentUnits: 0 });
	});

	it("never commits an estimate on malformed closure", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(0, 0), delta("text_delta", 0, "abcdefgh", "abcdefgh"));
		expect(tracker.messageEnd(assistant(-1, 1))).toEqual(
			accepted({ input: 0, output: 0 }, "no-snapshot", {
				input: 0,
				output: 2,
				outputApproximate: true,
			}),
		);
		expect(tracker.currentTokens()).toEqual({ input: 0, output: 0 });
	});
});

describe("interaction metrics tracker", () => {
	it("promotes a response-less stream to a normalized ID and ignores its duplicate final", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(1_000);
		tracker.turnStart();
		expect(
			tracker.messageUpdate(assistant(100, 4, { timestamp: 1, provider: "first", model: "first" }))
				.displayTokens,
		).toEqual({ input: 100, output: 4, outputApproximate: false });
		expect(
			tracker.messageUpdate(
				assistant(120, 7, {
					responseId: "  response-a  ",
					timestamp: 2,
					provider: "second",
					model: "second",
				}),
			).displayTokens,
		).toEqual({ input: 120, output: 7, outputApproximate: false });
		expect(
			tracker.messageEnd(assistant(150, 9, { responseId: "response-a", timestamp: 3 })),
		).toEqual(accepted({ input: 150, output: 9 }));
		expect(
			tracker.messageEnd(assistant(999, 99, { responseId: " response-a ", timestamp: 4 })),
		).toEqual({ status: "rejected" });
	});

	it("deduplicates the same ID even after a new turn slot", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 1, { responseId: "a" }));
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(10, 1, { responseId: " a " }))).toEqual({
			status: "duplicate",
		});
	});

	it("keeps short IDs exact and treats overlong IDs as anonymous", () => {
		const tracker = new InteractionMetricsTracker();
		const first = `${"a".repeat(126)}-1`;
		const second = `${"a".repeat(126)}-2`;
		tracker.agentStart();
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(10, 1, { responseId: first }))).toEqual(
			accepted({ input: 10, output: 1 }),
		);
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(20, 2, { responseId: second }))).toEqual(
			accepted({ input: 30, output: 3 }),
		);
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(99, 99, { responseId: first }))).toEqual({
			status: "duplicate",
		});

		const overlong = "x".repeat(129);
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(3, 4, { responseId: overlong }))).toEqual(
			accepted({ input: 33, output: 7 }),
		);
		expect(tracker.diagnostics().responseIds).toBe(2);
	});

	it("rejects multi-megabyte response IDs before normalization or retention", () => {
		const tracker = new InteractionMetricsTracker();
		const overlong = ` ${"x".repeat(2 * 1024 * 1024)} `;
		tracker.agentStart();
		tracker.turnStart();
		const startedAt = performance.now();
		expect(tracker.messageUpdate(assistant(2, 1, { responseId: overlong })).displayTokens).toEqual({
			input: 2,
			output: 1,
			outputApproximate: false,
		});
		expect(tracker.messageEnd(assistant(7, 3, { responseId: overlong }))).toEqual(
			accepted({ input: 7, output: 3 }),
		);
		expect(performance.now() - startedAt).toBeLessThan(1_000);
		expect(tracker.diagnostics().responseIds).toBe(0);
		expect(tracker.messageEnd(assistant(99, 99, { responseId: overlong }))).toEqual({
			status: "rejected",
		});
	});

	it("counts a reused response ID independently in a later low-level run", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 1, { responseId: "reused" }));
		tracker.agentEnd();
		tracker.agentStart();
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(20, 2, { responseId: " reused " }))).toEqual(
			accepted({
				input: 30,
				output: 3,
			}),
		);
	});

	it("rejects distinct finals until turn_start authorizes each slot", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		expect(tracker.messageEnd(assistant(10, 1, { responseId: "a", timestamp: 7 }))).toEqual({
			status: "rejected",
		});
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(20, 2, { responseId: "b", timestamp: 7 }))).toEqual(
			accepted({ input: 20, output: 2 }),
		);
	});

	it("counts response-less same-metadata responses only when turn_start separates them", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 1, { timestamp: 7 }));
		expect(tracker.messageEnd(assistant(10, 1, { timestamp: 7 }))).toEqual({ status: "rejected" });
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(10, 1, { timestamp: 7 }))).toEqual(
			accepted({
				input: 20,
				output: 2,
			}),
		);
	});

	it("deduplicates a streaming error final despite changed metadata and timestamp", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(
			assistant(5, 1, {
				responseId: "error-response",
				provider: "first",
				model: "first",
				timestamp: 1,
			}),
		);
		expect(
			tracker.messageEnd(
				assistant(8, 2, {
					responseId: "error-response",
					provider: "second",
					model: "second",
					stopReason: "error",
					timestamp: 2,
				}),
			),
		).toEqual(accepted({ input: 8, output: 2 }));
		expect(
			tracker.messageEnd(
				assistant(80, 20, {
					responseId: "error-response",
					provider: "third",
					model: "third",
					stopReason: "error",
					timestamp: 3,
				}),
			),
		).toEqual({ status: "rejected" });
	});

	it("deduplicates a response-less aborted streaming final", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(4, 1, { stopReason: "aborted", timestamp: 1 }));
		expect(tracker.messageEnd(assistant(6, 2, { stopReason: "aborted", timestamp: 2 }))).toEqual(
			accepted({
				input: 6,
				output: 2,
			}),
		);
		expect(tracker.messageEnd(assistant(60, 20, { stopReason: "aborted", timestamp: 3 }))).toEqual({
			status: "rejected",
		});
	});

	it("displays cumulative usage throughout a three-response tool loop", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		for (const [input, output, expectedUpdate, expectedFinal, responseId, stopReason] of [
			[
				10,
				1,
				{ input: 9, output: 1, outputApproximate: false },
				{ input: 10, output: 1 },
				"a",
				"toolUse",
			],
			[
				20,
				2,
				{ input: 29, output: 3, outputApproximate: false },
				{ input: 30, output: 3 },
				"b",
				"toolUse",
			],
			[
				30,
				3,
				{ input: 59, output: 6, outputApproximate: false },
				{ input: 60, output: 6 },
				"c",
				"stop",
			],
		] as const) {
			tracker.turnStart();
			expect(
				tracker.messageUpdate(assistant(input - 1, output, { responseId, stopReason }))
					.displayTokens,
			).toEqual(expectedUpdate);
			expect(tracker.messageEnd(assistant(input, output, { responseId, stopReason }))).toEqual(
				accepted(expectedFinal),
			);
		}
		expect(tracker.currentTokens()).toEqual({ input: 60, output: 6 });
	});

	it("retains committed totals for a next response's initial zero snapshot", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 1, { responseId: "first" }));
		tracker.turnStart();
		expect(tracker.messageUpdate(assistant(0, 0, { responseId: "second" })).displayTokens).toEqual({
			input: 10,
			output: 1,
			outputApproximate: true,
		});
		expect(tracker.messageUpdate(assistant(7, 2, { responseId: "second" })).displayTokens).toEqual({
			input: 17,
			output: 3,
			outputApproximate: false,
		});
	});

	it.each([undefined, "final-id"])(
		"accepts authorized final-only usage with ID %s",
		(responseId) => {
			const tracker = new InteractionMetricsTracker();
			tracker.agentStart();
			tracker.turnStart();
			expect(tracker.messageEnd(assistant(4, 2, { responseId }))).toEqual(
				accepted({ input: 4, output: 2 }),
			);
		},
	);

	it("shows repeated initial zero updates once and ignores placeholder regression", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		expect(tracker.messageUpdate(assistant(0, 0, { responseId: "stream" })).displayTokens).toEqual({
			input: 0,
			output: 0,
			outputApproximate: true,
		});
		expect(tracker.messageUpdate(assistant(0, 0, { responseId: "stream" })).usageChanged).toBe(
			false,
		);
		expect(tracker.currentTokens()).toEqual({ input: 0, output: 0 });
		expect(tracker.messageUpdate(assistant(8, 2, { responseId: "stream" })).displayTokens).toEqual({
			input: 8,
			output: 2,
			outputApproximate: false,
		});
		expect(tracker.messageUpdate(assistant(0, 0, { responseId: "stream" })).displayTokens).toEqual({
			input: 8,
			output: 2,
			outputApproximate: false,
		});
		expect(tracker.currentTokens()).toEqual({ input: 8, output: 2 });
	});

	it("commits a zero-only final exactly once", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(1_000);
		tracker.turnStart();
		expect(
			tracker.messageUpdate(assistant(0, 0, { responseId: "zero-only" })).displayTokens,
		).toEqual({ input: 0, output: 0, outputApproximate: true });
		expect(tracker.messageEnd(assistant(0, 0, { responseId: "zero-only" }))).toEqual(
			accepted({
				input: 0,
				output: 0,
			}),
		);
		expect(tracker.messageEnd(assistant(9, 3, { responseId: "zero-only" }))).toEqual({
			status: "rejected",
		});
		tracker.agentEnd();
		expect(tracker.settle(true, 2_000)?.summary).toEqual({
			durationMs: 1_000,
			thoughtDurationMs: 0,
			input: 0,
			output: 0,
		});
	});

	it("rejects invalid and non-assistant updates without changing accounting", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(8, 2));
		expect(tracker.messageUpdate(assistant(-1, 4)).usageChanged).toBe(false);
		expect(
			tracker.messageUpdate({ role: "user", usage: { input: 99, output: 99 } }).usageChanged,
		).toBe(false);
		expect(tracker.currentTokens()).toEqual({ input: 8, output: 2 });
	});

	it.each([
		[assistant(0, 0), { input: 0, output: 0 }],
		[assistant(-1, 0), undefined],
		[assistant(0, 1.5), undefined],
		[assistant(Number.POSITIVE_INFINITY, 0), undefined],
		[assistant(Number.MAX_SAFE_INTEGER + 1, 0), undefined],
		[{ role: "user", usage: { input: 0, output: 0 } }, undefined],
	])("strictly parses assistant usage %#", (message, expected) => {
		expect(parseAssistantMessageTokens(message)).toEqual(expected);
	});

	it("saturates token fields independently and settles valid data with a clamped duration", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(1_000);
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(-1, 4, { responseId: "invalid-negative" }))).toEqual(
			accepted({ input: 0, output: 0 }, "no-snapshot"),
		);
		expect(
			tracker.messageEnd(
				assistant(Number.MAX_SAFE_INTEGER + 1, 4, { responseId: "invalid-unsafe" }),
			),
		).toEqual({ status: "rejected" });
		tracker.turnStart();
		tracker.messageEnd(assistant(Number.MAX_SAFE_INTEGER - 2, 10, { responseId: "first-valid" }));
		tracker.turnStart();
		expect(
			tracker.messageEnd(
				assistant(5, Number.MAX_SAFE_INTEGER - 20, { responseId: "second-valid" }),
			),
		).toEqual(
			accepted({
				input: Number.MAX_SAFE_INTEGER,
				output: Number.MAX_SAFE_INTEGER - 10,
			}),
		);
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(0, 20, { responseId: "third-valid" }))).toEqual(
			accepted({
				input: Number.MAX_SAFE_INTEGER,
				output: Number.MAX_SAFE_INTEGER,
			}),
		);
		tracker.agentEnd();
		const settled = tracker.settle(true, Number.POSITIVE_INFINITY);
		expect(settled?.summary).toEqual({
			durationMs: Number.MAX_SAFE_INTEGER,
			thoughtDurationMs: 0,
			input: Number.MAX_SAFE_INTEGER,
			output: Number.MAX_SAFE_INTEGER,
		});
		expect(
			isTurnSummaryData({
				version: 1,
				durationMs: settled?.summary.durationMs,
				input: settled?.summary.input,
				output: settled?.summary.output,
			}),
		).toBe(true);
	});

	it("spans low-level runs and resets only after settlement", () => {
		const tracker = new InteractionMetricsTracker();
		expect(tracker.agentStart(1_000)).toEqual({ interactionStarted: true });
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 2, { responseId: "a" }));
		tracker.agentEnd();
		expect(tracker.agentStart(2_000)).toEqual({ interactionStarted: false });
		tracker.turnStart();
		tracker.messageEnd(assistant(20, 3, { responseId: "b" }));
		tracker.agentEnd();
		expect(tracker.settle(true, 3_000)?.summary).toEqual({
			durationMs: 2_000,
			thoughtDurationMs: 0,
			input: 30,
			output: 5,
		});
		expect(tracker.settle(true)).toBeUndefined();
		tracker.agentStart(50_000);
		tracker.shutdown();
		expect(tracker.settle(true)).toBeUndefined();
	});

	it.each(["error", "aborted"])(
		"commits the last valid snapshot once when a matching %s final has malformed usage",
		(stopReason) => {
			const tracker = new InteractionMetricsTracker();
			tracker.agentStart(1_000);
			tracker.turnStart();
			tracker.messageUpdate(assistant(10, 1, { responseId: "a" }));
			const malformed = assistant(-1, 99, { responseId: "a", stopReason });
			expect(tracker.messageEnd(malformed)).toEqual(
				accepted({ input: 10, output: 1 }, "last-snapshot"),
			);
			expect(tracker.currentTokens()).toEqual({ input: 10, output: 1 });
			expect(tracker.messageEnd(malformed)).toEqual({ status: "rejected" });
			expect(tracker.currentTokens()).toEqual({ input: 10, output: 1 });

			tracker.turnStart();
			expect(tracker.messageEnd(assistant(20, 2, { responseId: "b" }))).toEqual(
				accepted({
					input: 30,
					output: 3,
				}),
			);
			tracker.agentEnd();
			expect(tracker.settle(true, 2_000)?.summary).toEqual({
				durationMs: 1_000,
				thoughtDurationMs: 0,
				input: 30,
				output: 3,
			});
		},
	);

	it("preserves a live estimate when a malformed final has no valid snapshot", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "invalid" }),
			delta("thinking_delta", 0, "abcdefgh", "abcdefgh"),
		);
		expect(tracker.messageEnd(assistant(-1, 1, { responseId: "invalid" }))).toEqual(
			accepted({ input: 0, output: 0 }, "no-snapshot", {
				input: 0,
				output: 2,
				outputApproximate: true,
			}),
		);
		expect(tracker.currentTokens()).toEqual({ input: 0, output: 0 });
		expect(tracker.currentDisplayTokens()).toEqual({
			input: 0,
			output: 2,
			outputApproximate: true,
		});
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(20, 2, { responseId: "b" }))).toEqual(
			accepted({
				input: 20,
				output: 2,
			}),
		);
	});

	it("preserves an estimate above a lower provider anchor on malformed final", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(10, 1, { responseId: "anchored" }));
		tracker.messageUpdate(
			assistant(10, 1, { responseId: "anchored" }),
			delta("text_delta", 0, "abcdefghijkl", "abcdefghijkl"),
		);
		expect(tracker.messageEnd(assistant(-1, 9, { responseId: "anchored" }))).toEqual(
			accepted({ input: 10, output: 1 }, "last-snapshot", {
				input: 10,
				output: 4,
				outputApproximate: true,
			}),
		);
		tracker.agentEnd();
		expect(tracker.settle(true)?.summary).toMatchObject({ input: 10, output: 1 });
	});

	it("commits an unfinalized valid snapshot before opening the next response", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(10, 1, { responseId: "a" }));
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(20, 2, { responseId: "b" }))).toEqual(
			accepted({
				input: 30,
				output: 3,
			}),
		);
	});

	it("rejects mismatched updates and finals without modifying or closing the active response", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		tracker.messageUpdate(
			assistant(10, 1, { responseId: "a" }),
			{
				type: "thinking_start",
				contentIndex: 0,
				partial: assistant(0, 0),
			} as never,
			0,
		);
		expect(tracker.messageUpdate(assistant(99, 9, { responseId: "b" }), undefined, 10)).toEqual({
			displayTokens: { input: 10, output: 1, outputApproximate: false },
			usageChanged: false,
			thoughtChanged: false,
		});
		expect(tracker.messageEnd(assistant(99, 9, { responseId: "b" }), 20)).toEqual({
			status: "rejected",
		});
		expect(tracker.currentThought(30)).toEqual({ durationMs: 30, active: true });
		expect(tracker.messageEnd(assistant(12, 2, { responseId: "a" }), 40)).toEqual(
			accepted({
				input: 12,
				output: 2,
			}),
		);
		expect(tracker.currentThought(50)).toEqual({ durationMs: 40, active: false });
	});

	it("does not let a mismatched malformed final close or commit the active response", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		tracker.messageUpdate(
			assistant(10, 1, { responseId: "a" }),
			{
				type: "thinking_start",
				contentIndex: 0,
				partial: assistant(0, 0),
			} as never,
			0,
		);
		expect(tracker.messageEnd(assistant(-1, 9, { responseId: "b" }), 20)).toEqual({
			status: "rejected",
		});
		expect(tracker.currentTokens()).toEqual({ input: 10, output: 1 });
		expect(tracker.currentThought(30)).toEqual({ durationMs: 30, active: true });
		expect(tracker.messageEnd(assistant(-1, 9, { responseId: "a" }), 40)).toEqual(
			accepted({ input: 10, output: 1 }, "last-snapshot"),
		);
		expect(tracker.currentTokens()).toEqual({ input: 10, output: 1 });
		expect(tracker.currentThought(50)).toEqual({ durationMs: 40, active: false });
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(20, 2, { responseId: "b" }))).toEqual(
			accepted({
				input: 30,
				output: 3,
			}),
		);
	});

	it("does not let a stale committed ID promote a fresh response-less turn slot", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 1, { responseId: "a" }));
		tracker.turnStart();
		expect(tracker.messageUpdate(assistant(99, 9, { responseId: "a" })).usageChanged).toBe(false);
		expect(tracker.messageEnd(assistant(20, 2, { responseId: "b" }))).toEqual(
			accepted({
				input: 30,
				output: 3,
			}),
		);
	});

	it("keeps authorized live and exact accounting at estimator and response-ID caps", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart();
		for (let index = 0; index < 128; index++) {
			tracker.turnStart();
			tracker.messageUpdate(
				assistant(0, 0, { responseId: `estimated-${index}` }),
				delta("text_delta", 0, "abcd", "abcd"),
			);
			tracker.messageEnd(assistant(1, 1, { responseId: `estimated-${index}` }));
		}
		tracker.turnStart();
		expect(
			tracker.messageUpdate(
				assistant(0, 0, { responseId: "exact-only" }),
				delta("text_delta", 0, "abcd", "abcd"),
			).displayTokens,
		).toEqual({ input: 128, output: 128, outputApproximate: true });
		expect(tracker.messageEnd(assistant(2, 3, { responseId: "exact-only" }))).toEqual(
			accepted({ input: 130, output: 131 }),
		);

		for (let index = 129; index < 256; index++) {
			tracker.turnStart();
			tracker.messageEnd(assistant(1, 1, { responseId: `exact-${index}` }));
		}
		expect(tracker.diagnostics().responseIds).toBe(256);
		tracker.turnStart();
		expect(tracker.messageEnd(assistant(3, 4, { responseId: "overflow-id" }))).toEqual(
			accepted({ input: 260, output: 262 }),
		);
		tracker.turnStart();
		expect(
			tracker.messageUpdate(
				assistant(99, 99, { responseId: "overflow-id" }),
				delta("text_delta", 0, "replay", "replay"),
			),
		).toMatchObject({ usageChanged: false });
		expect(tracker.messageEnd(assistant(99, 99, { responseId: "overflow-id" }))).toEqual({
			status: "duplicate",
		});
		expect(tracker.messageEnd(assistant(5, 6, { responseId: "fresh-after-overflow" }))).toEqual(
			accepted({ input: 265, output: 268 }),
		);
		expect(tracker.messageEnd(assistant(99, 99, { responseId: "fresh-after-overflow" }))).toEqual({
			status: "rejected",
		});
		expect(tracker.messageEnd(assistant(99, 99))).toEqual({ status: "rejected" });
		expect(tracker.messageEnd(assistant(99, 99, { responseId: "overflow-unsolicited" }))).toEqual({
			status: "rejected",
		});

		tracker.turnStart();
		expect(tracker.messageEnd(assistant(1, 1))).toEqual(accepted({ input: 266, output: 269 }));
		expect(tracker.messageEnd(assistant(99, 99))).toEqual({ status: "rejected" });

		tracker.turnStart();
		expect(
			tracker.messageUpdate(
				assistant(4, 2, { responseId: "authorized-at-cap" }),
				delta("text_delta", 0, "abcdefgh", "abcdefgh"),
			).displayTokens,
		).toEqual({ input: 270, output: 271, outputApproximate: true });
		expect(tracker.messageUpdate(assistant(99, 99, { responseId: "mismatch" })).usageChanged).toBe(
			false,
		);
		expect(tracker.messageEnd(assistant(99, 99, { responseId: "mismatch" }))).toEqual({
			status: "rejected",
		});
		expect(tracker.messageEnd(assistant(9, 9, { responseId: "authorized-at-cap" }))).toEqual(
			accepted({ input: 275, output: 278 }),
		);
		expect(tracker.diagnostics().responseIds).toBe(256);
		expect(tracker.messageEnd(assistant(99, 99, { responseId: "authorized-at-cap" }))).toEqual({
			status: "rejected",
		});
		expect(
			tracker.messageUpdate(assistant(99, 99, { responseId: "unknown" }), {
				type: "unknown",
			} as never).usageChanged,
		).toBe(false);
	});

	it("bounds run state while preserving folded exact totals", () => {
		const tracker = new InteractionMetricsTracker();
		for (let index = 0; index < 40; index++) {
			tracker.agentStart(index);
			tracker.turnStart(index);
			tracker.messageEnd(assistant(1, 2, { responseId: `run-${index}` }));
			tracker.agentEnd(index + 1);
		}
		expect(tracker.currentTokens()).toEqual({ input: 40, output: 80 });
		expect(tracker.diagnostics().runs).toBeLessThanOrEqual(32);
	});

	it("ignores late events after agent_end and accepts them only after a real next agent_start", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		tracker.messageEnd(assistant(10, 1, { responseId: "a" }));
		tracker.agentEnd(10);
		expect(tracker.messageUpdate(assistant(90, 9, { responseId: "late" })).usageChanged).toBe(
			false,
		);
		expect(tracker.messageEnd(assistant(90, 9, { responseId: "late" }))).toEqual({
			status: "rejected",
		});
		expect(tracker.currentTokens()).toEqual({ input: 10, output: 1 });
		tracker.agentStart(20);
		tracker.turnStart(20);
		expect(tracker.messageEnd(assistant(20, 2, { responseId: "late" }))).toEqual(
			accepted({
				input: 30,
				output: 3,
			}),
		);
	});

	it("retains a live response ID and snapshot across non-idle partitioning", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(1_000);
		tracker.turnStart();
		tracker.messageEnd(assistant(10, 1, { responseId: "settled" }));
		tracker.agentEnd();
		tracker.agentStart(5_000);
		tracker.turnStart();
		tracker.messageUpdate(assistant(7, 2, { responseId: " live " }));
		expect(tracker.settle(false, 6_000)).toEqual({
			summary: { durationMs: 5_000, thoughtDurationMs: 0, input: 10, output: 1 },
			nextStartedAt: 5_000,
			nextTokens: { input: 7, output: 2, outputApproximate: false },
			nextThought: { durationMs: 0, active: false },
		});
		expect(tracker.messageEnd(assistant(9, 3, { responseId: "live", timestamp: 99 }))).toEqual(
			accepted({
				input: 9,
				output: 3,
			}),
		);
		expect(tracker.messageEnd(assistant(9, 3, { responseId: "live" }))).toEqual({
			status: "rejected",
		});
	});
});

describe("thought duration tracking", () => {
	const thinking = (
		type: "thinking_start" | "thinking_delta" | "thinking_end",
		contentIndex: number,
	) =>
		({
			type,
			contentIndex,
			partial: assistant(0, 0),
			...(type === "thinking_delta" ? { delta: "x" } : {}),
			...(type === "thinking_end" ? { content: "x" } : {}),
		}) as never;

	it("retains a bounded exact lower bound after adversarial subtraction", () => {
		const result = subtractThoughtIntervalsWithinCap(
			[{ start: 0, end: 513 }],
			Array.from({ length: 257 }, (_, index) => ({
				start: index * 2 + 1,
				end: index * 2 + 2,
			})),
		);
		expect(result.incomplete).toBe(true);
		expect(result.intervals).toHaveLength(256);
		expect(result.intervals[0]).toEqual({ start: 0, end: 1 });
		expect(result.intervals.at(-1)).toEqual({ start: 510, end: 511 });
		for (let index = 0; index < result.intervals.length; index++) {
			const interval = result.intervals[index];
			expect(interval.end).toBeGreaterThan(interval.start);
			expect(interval.start).toBeGreaterThanOrEqual(0);
			expect(interval.end).toBeLessThanOrEqual(513);
			if (index > 0) expect(interval.start).toBeGreaterThan(result.intervals[index - 1].end);
		}
	});

	it("counts the union of overlapping blocks and updates open elapsed from receipt time", () => {
		let now = 1_000;
		const tracker = new InteractionMetricsTracker(() => now);
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(0, 0, { responseId: "a" }), thinking("thinking_start", 0));
		now = 2_000;
		tracker.messageUpdate(assistant(0, 0, { responseId: "a" }), thinking("thinking_start", 1));
		now = 3_000;
		expect(tracker.currentThought()).toEqual({ durationMs: 2_000, active: true });
		tracker.messageUpdate(assistant(0, 0, { responseId: "a" }), thinking("thinking_end", 0));
		now = 4_000;
		tracker.messageUpdate(assistant(0, 0, { responseId: "a" }), thinking("thinking_end", 1));
		expect(tracker.currentThought()).toEqual({ durationMs: 3_000, active: false });
	});

	it("keeps an exact lower-bound union after the strict thought interval cap", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		for (let index = 0; index < 256; index++) {
			tracker.turnStart(index * 4);
			tracker.messageUpdate(
				assistant(0, 0, { responseId: `thought-${index}` }),
				thinking("thinking_start", 0),
				index * 4,
			);
			tracker.messageUpdate(
				assistant(0, 0, { responseId: `thought-${index}` }),
				thinking("thinking_end", 0),
				index * 4 + 1,
			);
			tracker.messageEnd(assistant(0, 0, { responseId: `thought-${index}` }), index * 4 + 1);
		}
		expect(tracker.diagnostics().thoughtIntervals).toBe(256);
		expect(tracker.currentThought(2_000)).toEqual({ durationMs: 256, active: false });

		tracker.turnStart(2_000);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "overflow" }),
			thinking("thinking_start", 0),
			2_000,
		);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "overflow" }),
			thinking("thinking_end", 0),
			2_001,
		);
		expect(tracker.diagnostics().thoughtIntervals).toBe(256);
		expect(tracker.currentThought(2_001)).toEqual({ durationMs: 256, active: false });

		tracker.turnStart(500);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "covered-overlap" }),
			thinking("thinking_start", 0),
			500,
		);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "covered-overlap" }),
			thinking("thinking_end", 0),
			505,
		);
		expect(tracker.diagnostics().thoughtIntervals).toBe(256);
		expect(tracker.currentThought(2_100)).toEqual({ durationMs: 256, active: false });

		tracker.turnStart(2_002);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "gap-after-incomplete" }),
			thinking("thinking_start", 0),
			2_002,
		);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "gap-after-incomplete" }),
			thinking("thinking_end", 0),
			2_003,
		);
		expect(tracker.diagnostics().thoughtIntervals).toBe(256);
		expect(tracker.currentThought(2_100)).toEqual({ durationMs: 256, active: false });
		expect(tracker.settle(true, 2_100)?.summary.thoughtDurationMs).toBe(256);
		expect(tracker.currentThought()).toBeUndefined();
	});

	it("handles duplicates, delta without start, missing ends, and reused content indexes", () => {
		let now = 10;
		const tracker = new InteractionMetricsTracker(() => now);
		tracker.agentStart();
		tracker.turnStart();
		tracker.messageUpdate(assistant(0, 0, { responseId: "a" }), thinking("thinking_delta", 0));
		tracker.messageUpdate(assistant(0, 0, { responseId: "a" }), thinking("thinking_start", 0));
		now = 20;
		tracker.messageEnd(assistant(1, 1, { responseId: "a" }));
		tracker.turnStart();
		now = 30;
		tracker.messageUpdate(assistant(0, 0, { responseId: "b" }), thinking("thinking_start", 0));
		now = 40;
		tracker.agentEnd();
		expect(tracker.currentThought()).toEqual({ durationMs: 20, active: false });
	});

	it("ignores late thought after agent_end", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.agentEnd(10);
		const result = tracker.messageUpdate(
			assistant(0, 0, { responseId: "late" }),
			thinking("thinking_start", 0),
			20,
		);
		expect(result.thoughtChanged).toBe(false);
		expect(tracker.currentThought(30)).toEqual({ durationMs: 0, active: false });
	});

	it("partitions ended thought without double-counting a concurrent retained run", () => {
		const tracker = new InteractionMetricsTracker();
		tracker.agentStart(0);
		tracker.turnStart(0);
		tracker.messageUpdate(assistant(0, 0, { responseId: "old" }), thinking("thinking_start", 0), 0);
		tracker.agentEnd(100);
		tracker.agentStart(50);
		tracker.turnStart(50);
		tracker.messageUpdate(
			assistant(0, 0, { responseId: "live" }),
			thinking("thinking_start", 0),
			50,
		);
		const split = tracker.settle(false, 100);
		expect(split?.summary.thoughtDurationMs).toBe(100);
		expect(split?.nextThought).toEqual({ durationMs: 0, active: true });
		expect(tracker.currentThought(150)).toEqual({ durationMs: 50, active: true });
	});
});

describe("turn summary entry", () => {
	it("validates versioned numeric data and formats exact persistent text", () => {
		const data = { version: 1 as const, durationMs: 42_999, input: 27_000, output: 1_400 };
		expect(isTurnSummaryData(data)).toBe(true);
		expect(formatTurnSummary(data)).toBe(" Turn took 42s · ↑27k ↓1.4k");
		const rendered = renderTurnSummaryEntry(
			{ data },
			{},
			{ fg: (_color: string, text: string) => `\x1b[2m${text}\x1b[0m` },
		);
		expect(stripTerminalSequences(rendered?.render(100).join("\n") ?? "").trimEnd()).toBe(
			" Turn took 42s · ↑27k ↓1.4k",
		);
	});

	it("validates and renders v2 with its persisted style independently of the current theme", () => {
		const data = {
			version: 2 as const,
			durationMs: 1,
			input: 2,
			output: 3,
			stylePrefix: "\x1b[1;38;5;202m",
		};
		expect(isTurnSummaryData(data)).toBe(true);
		const rendered = renderTurnSummaryEntry(
			{ data },
			{ colorSource: "theme", workingLineHigh: "green" },
			{ fg: () => "changed-theme" },
		)?.render(100)[0];
		expect(rendered).toContain("\x1b[1;38;5;202m Turn took 0s · ↑2 ↓3\x1b[0m");
		expect(rendered).not.toContain("changed-theme");
	});

	it("validates v3 exactly and formats thought while omitting zero", () => {
		const data = {
			version: 3 as const,
			durationMs: 56_999,
			thoughtDurationMs: 10_999,
			input: 7_100,
			output: 779,
			stylePrefix: "\x1b[1;36m",
		};
		expect(isTurnSummaryData(data)).toBe(true);
		expect(formatTurnSummary(data)).toBe(" Turn took 56s · thought for 10s · ↑7.1k ↓779");
		expect(formatTurnSummary({ ...data, thoughtDurationMs: 0 })).toBe(
			" Turn took 56s · ↑7.1k ↓779",
		);
		expect(isTurnSummaryData({ ...data, thoughtDurationMs: -1 })).toBe(false);
		expect(isTurnSummaryData({ ...data, extra: true })).toBe(false);
		expect(isTurnSummaryData({ ...data, stylePrefix: "\x1b]8;;bad\x07" })).toBe(false);
	});

	it("accepts four safe SGR sequences but rejects a fifth sequence and injected controls", () => {
		const safe = {
			version: 2 as const,
			durationMs: 1,
			input: 2,
			output: 3,
			stylePrefix: "\x1b[38;5;202m\x1b[4m\x1b[3m\x1b[1m",
		};
		expect(isTurnSummaryData(safe)).toBe(true);
		const rendered = renderTurnSummaryEntry({ data: safe }, {}, { fg: (_color, text) => text })
			?.render(100)
			.join("\n");
		expect(rendered).toContain(`${safe.stylePrefix} Turn took 0s · ↑2 ↓3\x1b[0m`);
		expect(isTurnSummaryData({ ...safe, stylePrefix: `${safe.stylePrefix}\x1b[2m` })).toBe(false);
		expect(isTurnSummaryData({ ...safe, stylePrefix: `${safe.stylePrefix}\x1b]8;;bad\x07` })).toBe(
			false,
		);
		expect(
			isTurnSummaryData({
				...safe,
				stylePrefix: "\x1b[38;2;0000000255;0000000255;0000000255m".repeat(4),
			}),
		).toBe(false);
	});

	it.each([
		null,
		{},
		{ version: 2, durationMs: 1, input: 1, output: 1 },
		{ version: 2, durationMs: 1, input: 1, output: 1, stylePrefix: "\x1b[0m" },
		{ version: 2, durationMs: 1, input: 1, output: 1, stylePrefix: "\x1b[31mprint" },
		{ version: 2, durationMs: 1, input: 1, output: 1, stylePrefix: "\x1b]8;;bad\x07" },
		{ version: 2, durationMs: 1, input: 1, output: 1, stylePrefix: "\x1b[2J" },
		{ version: 2, durationMs: 1, input: 1, output: 1, stylePrefix: "\x1b[31m", extra: true },
		{ version: 1, durationMs: -1, input: 1, output: 1 },
		{ version: 1, durationMs: 1, input: 1.5, output: 1 },
		{ version: 1, durationMs: 1, input: 1, output: 1, extra: true },
	])("rejects invalid renderer data %#", (data) => {
		expect(renderTurnSummaryEntry({ data }, {}, { fg: (_color, text) => text })).toBeUndefined();
	});

	it("proves custom entries persist while contributing zero model messages", () => {
		const entry = {
			type: "custom" as const,
			id: "summary",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			customType: TURN_SUMMARY_ENTRY_TYPE,
			data: { version: 1, durationMs: 1, input: 0, output: 0 },
		};
		const entries = [entry];
		expect(entries[0]?.data).toEqual(entry.data);
		expect(buildSessionContext(entries).messages).toEqual([]);
	});
});
