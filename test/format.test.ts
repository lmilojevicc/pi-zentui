import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetUsageTotalsCacheForTests,
	__usageTotalsComputeCount,
	buildContextDisplayLabel,
	buildContextGauge,
	buildCostLabel,
	buildSessionDurationLabel,
	buildTokenLabel,
	contextColorTier,
	formatCount,
	formatCwdLabel,
	formatGitCommitSegment,
	formatGitMetricsSegment,
	formatOsLabel,
	formatPackageVersionSegment,
	getUsageTotals,
	invalidateUsageTotalsCache,
} from "../extensions/zentui/format";
import {
	ASCII_DEFAULT_ICONS,
	NERD_DEFAULT_ICONS,
	OS_PLATFORM_ICONS_ASCII,
	OS_PLATFORM_ICONS_NERD,
} from "../extensions/zentui/icons";

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

describe("buildSessionDurationLabel", () => {
	const FIXED_NOW = 1_700_000_000_000;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(FIXED_NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("formats seconds only", () => {
		expect(buildSessionDurationLabel(FIXED_NOW - 45_000)).toBe("45s");
	});

	it("formats minutes and seconds", () => {
		expect(buildSessionDurationLabel(FIXED_NOW - (2 * 60 + 13) * 1000)).toBe("2m 13s");
	});

	it("formats hours and minutes", () => {
		expect(buildSessionDurationLabel(FIXED_NOW - (1 * 3600 + 5 * 60) * 1000)).toBe("1h 5m");
	});

	it("clamps zero and negative elapsed to 0s", () => {
		expect(buildSessionDurationLabel(FIXED_NOW)).toBe("0s");
		expect(buildSessionDurationLabel(FIXED_NOW + 10_000)).toBe("0s");
	});
});

describe("formatOsLabel", () => {
	it("honors a custom icons.os over platform defaults", () => {
		expect(formatOsLabel("X", "auto", "darwin")).toBe("X");
		expect(formatOsLabel("X", "ascii", "linux")).toBe("X");
	});

	it("maps platform icons when using the mode default os glyph", () => {
		expect(formatOsLabel(NERD_DEFAULT_ICONS.os, "auto", "linux")).toBe(
			OS_PLATFORM_ICONS_NERD.linux,
		);
		expect(formatOsLabel(ASCII_DEFAULT_ICONS.os, "ascii", "darwin")).toBe(
			OS_PLATFORM_ICONS_ASCII.darwin,
		);
	});
});

describe("formatCwdLabel", () => {
	const home = "/Users/me";

	it("defaults to basename and preserves current behavior", () => {
		expect(formatCwdLabel("/Users/me/Projects/zentui", "")).toBe("zentui");
		expect(formatCwdLabel("/Users/me/Projects/zentui/", "")).toBe("zentui");
		expect(formatCwdLabel("/", "")).toBe("/");
		expect(formatCwdLabel("C:\\Users\\me\\zentui", "")).toBe("zentui");
		expect(formatCwdLabel("/tmp/project", "󰝰")).toBe("󰝰 project");
	});

	it("renders full paths with home contracted to ~", () => {
		expect(formatCwdLabel("/Users/me/Projects/zentui", "", { mode: "full", home })).toBe(
			"~/Projects/zentui",
		);
		expect(formatCwdLabel("/Users/me", "", { mode: "full", home })).toBe("~");
		expect(formatCwdLabel("/tmp/project", "", { mode: "full", home })).toBe("/tmp/project");
		expect(formatCwdLabel("/", "", { mode: "full", home })).toBe("/");
		expect(
			formatCwdLabel("C:\\Users\\me\\Projects\\zentui", "", {
				mode: "full",
				home: "C:\\Users\\me",
			}),
		).toBe("~/Projects/zentui");
		// Prefix-safe: /Users/me2 must not match home /Users/me
		expect(formatCwdLabel("/Users/me2/Projects", "", { mode: "full", home })).toBe(
			"/Users/me2/Projects",
		);
	});

	it("truncates full paths to trailing directory depth (Starship-style)", () => {
		expect(
			formatCwdLabel("/Users/me/Projects/foo/bar", "", {
				mode: "full",
				home,
				depth: 2,
			}),
		).toBe("…/foo/bar");
		expect(
			formatCwdLabel("/var/log/nginx/access", "", {
				mode: "full",
				home,
				depth: 2,
			}),
		).toBe("…/nginx/access");
		expect(
			formatCwdLabel("C:\\a\\b\\c\\d", "", {
				mode: "full",
				home,
				depth: 2,
			}),
		).toBe("…/c/d");
		expect(
			formatCwdLabel("/Users/me/Projects/zentui", "", {
				mode: "full",
				home,
				depth: 5,
			}),
		).toBe("~/Projects/zentui");
		expect(
			formatCwdLabel("/Users/me/Projects/zentui", "", {
				mode: "full",
				home,
				depth: 1,
			}),
		).toBe("…/zentui");
		expect(formatCwdLabel("/Users/me", "", { mode: "full", home, depth: 2 })).toBe("~");
		expect(formatCwdLabel("/", "", { mode: "full", home, depth: 2 })).toBe("/");
		expect(formatCwdLabel("//", "", { mode: "full", home, depth: 2 })).toBe("/");
		expect(formatCwdLabel("//", "")).toBe("/");
		expect(
			formatCwdLabel("/Users/me/Projects/zentui", "", {
				mode: "full",
				home,
				depth: 0,
			}),
		).toBe("~/Projects/zentui");
		// depth is ignored for basename
		expect(
			formatCwdLabel("/Users/me/Projects/zentui", "", {
				mode: "basename",
				depth: 2,
			}),
		).toBe("zentui");
		expect(
			formatCwdLabel("/Users/me/Projects/zentui", "󰝰", {
				mode: "full",
				home,
				depth: 1,
			}),
		).toBe("󰝰 …/zentui");
	});
});

describe("context helpers", () => {
	it("classifies context color tiers from thresholds", () => {
		expect(contextColorTier(10, { warning: 50, error: 80 })).toBe("normal");
		expect(contextColorTier(50, { warning: 50, error: 80 })).toBe("warning");
		expect(contextColorTier(80, { warning: 50, error: 80 })).toBe("error");
		expect(contextColorTier(null)).toBe("normal");
	});

	it("builds stable-width gauges and style labels", () => {
		expect(buildContextGauge(0, 10)).toHaveLength(10);
		expect(buildContextGauge(100, 10)).toHaveLength(10);
		expect(buildContextGauge(50, 10, true)).toBe("#####-----");
		expect(buildContextDisplayLabel({ percent: 42, contextWindow: 128_000, style: "text" })).toBe(
			"42%/128k",
		);
		expect(
			buildContextDisplayLabel({ percent: 42, contextWindow: 128_000, style: "gauge" }),
		).toMatch(/^\[.{10}\]$/);
		expect(
			buildContextDisplayLabel({
				percent: 42,
				contextWindow: 128_000,
				style: "text+gauge",
			}),
		).toMatch(/^\[.{10}\] 42%\/128k$/);
		expect(buildContextDisplayLabel({ percent: null, contextWindow: undefined })).toBe("--");
	});
});

describe("getUsageTotals memoization", () => {
	it("reuses totals for unchanged entries and recomputes after invalidate", () => {
		__resetUsageTotalsCacheForTests();

		const entries = [makeAssistantEntry(10, 1, 0.1)];
		const ctx = makeSessionContext(entries) as never;

		const first = getUsageTotals(ctx);
		const second = getUsageTotals(ctx);
		expect(second).toBe(first);
		expect(__usageTotalsComputeCount()).toBe(1);

		entries.push(makeAssistantEntry(20, 2, 0.2));
		const third = getUsageTotals(ctx);
		expect(third.input).toBe(30);
		expect(__usageTotalsComputeCount()).toBe(2);

		invalidateUsageTotalsCache();
		const fourth = getUsageTotals(ctx);
		expect(fourth).toEqual(third);
		expect(fourth).not.toBe(third);
		expect(__usageTotalsComputeCount()).toBe(3);
	});
});

describe("formatGitMetricsSegment", () => {
	const makeTheme = (): { fg: (color: string, text: string) => string } => ({
		fg: (_color, text) => text,
	});

	it("returns empty when metrics are missing", () => {
		expect(
			formatGitMetricsSegment(
				makeTheme(),
				undefined,
				{ onlyNonzero: true },
				"terminal",
				"bold green",
				"bold red",
			),
		).toBe("");
		expect(
			formatGitMetricsSegment(
				makeTheme(),
				null,
				{ onlyNonzero: true },
				"terminal",
				"bold green",
				"bold red",
			),
		).toBe("");
	});

	it("renders both added and deleted", () => {
		const out = formatGitMetricsSegment(
			makeTheme(),
			{ added: 12, deleted: 3 },
			{ onlyNonzero: false },
			"terminal",
			"bold green",
			"bold red",
		);
		expect(out).toContain("+12");
		expect(out).toContain("−3");
	});

	it("omits each zero component independently when onlyNonzero", () => {
		// 0 added → only show deleted.
		expect(
			formatGitMetricsSegment(
				makeTheme(),
				{ added: 0, deleted: 5 },
				{ onlyNonzero: true },
				"terminal",
				"bold green",
				"bold red",
			),
		).not.toContain("+0");
		expect(
			formatGitMetricsSegment(
				makeTheme(),
				{ added: 0, deleted: 5 },
				{ onlyNonzero: true },
				"terminal",
				"bold green",
				"bold red",
			),
		).toContain("−5");
		// 0 deleted → only show added.
		expect(
			formatGitMetricsSegment(
				makeTheme(),
				{ added: 7, deleted: 0 },
				{ onlyNonzero: true },
				"terminal",
				"bold green",
				"bold red",
			),
		).toContain("+7");
	});

	it("hides entirely at 0/0 when onlyNonzero", () => {
		expect(
			formatGitMetricsSegment(
				makeTheme(),
				{ added: 0, deleted: 0 },
				{ onlyNonzero: true },
				"terminal",
				"bold green",
				"bold red",
			),
		).toBe("");
	});
});

describe("formatGitCommitSegment", () => {
	const makeTheme = (): { fg: (color: string, text: string) => string } => ({
		fg: (_color, text) => text,
	});
	const FULL = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

	it("returns empty when commit info or oid is missing", () => {
		expect(
			formatGitCommitSegment(
				makeTheme(),
				undefined,
				{ hashLength: 7, onlyDetached: true, showTag: true },
				"terminal",
				"bold green",
			),
		).toBe("");
		expect(
			formatGitCommitSegment(
				makeTheme(),
				{ oid: null, detached: false, tag: null },
				{ hashLength: 7, onlyDetached: true, showTag: true },
				"terminal",
				"bold green",
			),
		).toBe("");
	});

	it("shows short hash on detached HEAD", () => {
		const out = formatGitCommitSegment(
			makeTheme(),
			{ oid: FULL, detached: true, tag: null },
			{ hashLength: 7, onlyDetached: true, showTag: true },
			"terminal",
			"bold green",
		);
		expect(out).toContain("a1b2c3d");
	});

	it("hides hash on a normal branch when onlyDetached is true", () => {
		const out = formatGitCommitSegment(
			makeTheme(),
			{ oid: FULL, detached: false, tag: null },
			{ hashLength: 7, onlyDetached: true, showTag: true },
			"terminal",
			"bold green",
		);
		expect(out).toBe("");
	});

	it("hides the whole segment (including tag) on a branch when onlyDetached is true", () => {
		const out = formatGitCommitSegment(
			makeTheme(),
			{ oid: FULL, detached: false, tag: "v1.0.0" },
			{ hashLength: 7, onlyDetached: true, showTag: true },
			"terminal",
			"bold green",
		);
		expect(out).toBe("");
		expect(out).not.toContain("v1.0.0");
	});

	it("shows hash on a normal branch when onlyDetached is false", () => {
		const out = formatGitCommitSegment(
			makeTheme(),
			{ oid: FULL, detached: false, tag: null },
			{ hashLength: 7, onlyDetached: false, showTag: false },
			"terminal",
			"bold green",
		);
		expect(out).toContain("a1b2c3d");
	});

	it("appends exact-match tag when present", () => {
		const out = formatGitCommitSegment(
			makeTheme(),
			{ oid: FULL, detached: true, tag: "v1.2.3" },
			{ hashLength: 7, onlyDetached: true, showTag: true },
			"terminal",
			"bold green",
		);
		expect(out).toContain("a1b2c3d");
		expect(out).toContain("v1.2.3");
	});

	it("hides tag when showTag is false", () => {
		const out = formatGitCommitSegment(
			makeTheme(),
			{ oid: FULL, detached: true, tag: "v1.2.3" },
			{ hashLength: 7, onlyDetached: true, showTag: false },
			"terminal",
			"bold green",
		);
		expect(out).not.toContain("v1.2.3");
	});
});

describe("formatPackageVersionSegment", () => {
	const makeTheme = (): { fg: (color: string, text: string) => string } => ({
		// Identity wrapper: prefix text with the requested color token so we can
		// assert Starship style strings are routed correctly.
		fg: (color, text) => `[${color}]${text}[/${color}]`,
	});

	it("returns empty when no package is present", () => {
		expect(formatPackageVersionSegment(makeTheme(), undefined, "terminal", "nerd", "", "208")).toBe(
			"",
		);
	});

	it("renders the Starship `is <glyph> <version>` shape", () => {
		const out = formatPackageVersionSegment(
			makeTheme(),
			{ ecosystem: "nodejs", version: "1.2.3" },
			"terminal",
			"nerd",
			"",
			"208",
		);
		expect(out).toContain("is");
		expect(out).toContain("\u{f487}");
		expect(out).toContain("1.2.3");
		// Starship `package` default color 208 → ANSI 256-color code 38;5;208.
		expect(out).toContain("38;5;208");
	});

	it("falls back to the ASCII package label in ASCII mode", () => {
		const out = formatPackageVersionSegment(
			makeTheme(),
			{ ecosystem: "nodejs", version: "1.2.3" },
			"terminal",
			"ascii",
			"",
			"208",
		);
		expect(out).toContain("is");
		expect(out).toContain("pkg");
		expect(out).not.toContain("\u{f487}");
	});

	it("honors a configured package icon override", () => {
		const out = formatPackageVersionSegment(
			makeTheme(),
			{ ecosystem: "nodejs", version: "1.2.3" },
			"terminal",
			"nerd",
			"#", // custom override wins over mode default
			"208",
		);
		expect(out).toContain("#");
		expect(out).not.toContain("\u{f487}");
	});
});
