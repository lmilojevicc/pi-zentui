import { describe, expect, it } from "vitest";
import {
	buildCostLabel,
	buildTokenLabel,
	formatCount,
	getUsageTotals,
} from "../extensions/zentui/format";

const cacheHitIcon = "󰆼";

function makeAssistantEntry(
	input: number,
	output: number,
	cost: number,
	cacheRead = 0,
	cacheWrite = 0,
) {
	return {
		type: "message",
		message: {
			role: "assistant",
			usage: {
				input,
				output,
				cacheRead,
				cacheWrite,
				cost: { total: cost },
			},
		},
	};
}

function makeSessionContext(entries: unknown[], branch = entries) {
	return {
		sessionManager: {
			getBranch: () => branch,
			getEntries: () => entries,
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
		const ctx = makeSessionContext([branchEntry, freshTreeEntry], [branchEntry]);

		const totals = getUsageTotals(ctx as never);

		expect(totals).toEqual({
			input: 2_000_100,
			output: 100_010,
			cacheRead: 0,
			cacheWrite: 0,
			latestCacheHitRate: 0,
			cost: 26,
		});
		expect(buildTokenLabel(totals, cacheHitIcon)).toBe("↑2.0M ↓100k");
		expect(buildCostLabel(totals)).toBe("$26.000");
	});

	it("keeps token and cost labels compact", () => {
		const totals = { input: 3_100_000, output: 197_000, cacheRead: 0, cacheWrite: 0, cost: 41.957 };
		const tokenLabel = buildTokenLabel(totals, cacheHitIcon);

		expect(tokenLabel).toBe("↑3.1M ↓197k");
		expect(tokenLabel).not.toContain("R");
		expect(tokenLabel).not.toContain("W");
		expect(buildCostLabel(totals)).toBe("$41.957");
	});

	it("shows latest prompt cache hit rate icon without R/W totals", () => {
		const totals = {
			input: 100,
			output: 10,
			cacheRead: 800,
			cacheWrite: 100,
			latestCacheHitRate: 80,
			cost: 1,
		};
		const tokenLabel = buildTokenLabel(totals, cacheHitIcon);

		expect(tokenLabel).toBe("↑100 ↓10 󰆼 80.0%");
		expect(tokenLabel).not.toContain("CH");
		expect(tokenLabel).not.toContain("R");
		expect(tokenLabel).not.toContain("W");
	});

	it("uses custom and empty cache hit icons", () => {
		const totals = {
			input: 100,
			output: 10,
			cacheRead: 800,
			cacheWrite: 100,
			latestCacheHitRate: 80,
			cost: 1,
		};

		expect(buildTokenLabel(totals, "CH")).toBe("↑100 ↓10 CH 80.0%");
		expect(buildTokenLabel(totals, "")).toBe("↑100 ↓10 80.0%");
	});

	it("uses the latest assistant message for prompt cache hit rate", () => {
		const firstEntry = makeAssistantEntry(100, 10, 1, 900, 0);
		const latestEntry = makeAssistantEntry(200, 20, 2, 300, 500);
		const ctx = makeSessionContext([firstEntry, latestEntry], [firstEntry]);

		const totals = getUsageTotals(ctx as never);

		expect(totals.cacheRead).toBe(1200);
		expect(totals.cacheWrite).toBe(500);
		expect(totals.latestCacheHitRate).toBe(30);
		expect(buildTokenLabel(totals, cacheHitIcon)).toBe("↑300 ↓30 󰆼 30.0%");
	});
});
