import { describe, expect, it } from "vitest";
import {
	buildCostLabel,
	buildTokenLabel,
	formatCount,
	getUsageTotals,
} from "../extensions/zentui/format";

function makeAssistantEntry(input: number, output: number, cost: number) {
	return {
		type: "message",
		message: {
			role: "assistant",
			usage: {
				input,
				output,
				cacheRead: 123,
				cacheWrite: 456,
				cost: { total: cost },
			},
		},
	};
}

describe("usage formatting", () => {
	it("formats large counts with compact M suffixes", () => {
		expect(formatCount(999)).toBe("999");
		expect(formatCount(1_500)).toBe("1.5k");
		expect(formatCount(123_456)).toBe("123k");
		expect(formatCount(3_100_000)).toBe("3.1M");
		expect(formatCount(44_000_000)).toBe("44M");
	});

	it("uses all session entries for totals instead of only the active branch", () => {
		const branchEntry = makeAssistantEntry(100, 10, 1);
		const freshTreeEntry = makeAssistantEntry(2_000_000, 100_000, 25);
		const ctx = {
			sessionManager: {
				getBranch: () => [branchEntry],
				getEntries: () => [branchEntry, freshTreeEntry],
			},
		};

		const totals = getUsageTotals(ctx as never);

		expect(totals).toEqual({ input: 2_000_100, output: 100_010, cost: 26 });
		expect(buildTokenLabel(totals)).toBe("↑2.0M ↓100k");
		expect(buildCostLabel(totals)).toBe("$26.000");
	});

	it("keeps token and cost labels compact", () => {
		const totals = { input: 3_100_000, output: 197_000, cost: 41.957 };
		const tokenLabel = buildTokenLabel(totals);

		expect(tokenLabel).toBe("↑3.1M ↓197k");
		expect(tokenLabel).not.toContain("R");
		expect(tokenLabel).not.toContain("W");
		expect(buildCostLabel(totals)).toBe("$41.957");
	});
});
