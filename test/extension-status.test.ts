import { describe, expect, it } from "vitest";
import { defaultConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import {
	collectExtensionStatusSegments,
	sanitizeExtensionStatusOriginalText,
	sanitizeExtensionStatusText,
} from "../extensions/zentui/extension-status";

function configWithExtensionStatuses(
	extensionStatuses: Partial<PolishedTuiConfig["extensionStatuses"]>,
): PolishedTuiConfig {
	const merged = {
		...defaultConfig.extensionStatuses,
		...extensionStatuses,
		placements: {
			...defaultConfig.extensionStatuses.placements,
			...(extensionStatuses.placements ?? {}),
		},
		colorModes: {
			...defaultConfig.extensionStatuses.colorModes,
			...(extensionStatuses.colorModes ?? {}),
		},
	};
	const footer = defaultConfig.components.footer;
	return {
		...defaultConfig,
		extensionStatuses: merged,
		components: {
			...defaultConfig.components,
			footer: {
				...footer,
				styles: { starship: { ...footer.styles.starship, extensionStatuses: merged } },
			},
		},
	};
}

describe("sanitizeExtensionStatusText", () => {
	it("strips ANSI, terminal control sequences, and control whitespace", () => {
		expect(sanitizeExtensionStatusText("\x1b[31mred\x1b[0m\nnext\tline")).toBe("red next line");
		expect(sanitizeExtensionStatusText("\x1b]133;A\x07prompt\x1b]133;B\x07")).toBe("prompt");
		expect(sanitizeExtensionStatusText("  a\r\n\t b   c \x00\x08 ")).toBe("a b c");
	});

	it("returns an empty string when no visible status remains", () => {
		expect(sanitizeExtensionStatusText("\x1b[31m\x1b[0m\n\t")).toBe("");
	});
});

describe("sanitizeExtensionStatusOriginalText", () => {
	it.each(["\x07", "\x1b\\"])("preserves HTTP(S) OSC 8 links terminated by %j", (end) => {
		const source = `\x1b]8;id=pr;https://example.com/pull/123${end}PR #123\x1b]8;;${end}`;
		expect(sanitizeExtensionStatusOriginalText(source)).toBe(
			"\x1b]8;;https://example.com/pull/123\x07PR #123\x1b]8;;\x07",
		);
		expect(sanitizeExtensionStatusText(source)).toBe("PR #123");
	});

	it("preserves styling inside links and keeps following text outside the link", () => {
		expect(
			sanitizeExtensionStatusOriginalText(
				"\x1b]8;;http://example.com/pr/1\x07\x1b[31mPR #1\x1b[0m\x1b]8;;\x07 | failed",
			),
		).toBe("\x1b]8;;http://example.com/pr/1\x07\x1b[31mPR #1\x1b[0m\x1b]8;;\x07 | failed");
	});

	it.each([
		"javascript:alert(1)",
		"file:///tmp/report",
		"not-a-url",
		"https://example.com/\u0085x",
	])("drops an unsafe OSC 8 target %j while retaining its label", (url) =>
		expect(sanitizeExtensionStatusOriginalText(`\x1b]8;;${url}\x07PR #1\x1b]8;;\x07`)).toBe(
			"PR #1",
		),
	);

	it("closes an unterminated link and does not retain clipboard or cursor controls", () => {
		expect(
			sanitizeExtensionStatusOriginalText(
				"\x1b]52;c;YQ==\x07\x1b[2J\x1b]8;;https://example.com/pr/1\x07PR #1",
			),
		).toBe("\x1b]8;;https://example.com/pr/1\x07PR #1\x1b]8;;\x07");
		expect(
			sanitizeExtensionStatusOriginalText("\x1b]8;;https://example.com/pr/1\x07\x1b]8;;\x07"),
		).toBe("");
	});

	it("does not interpret visible placeholder-shaped text as control sequences", () => {
		expect(sanitizeExtensionStatusOriginalText("__ZENTUI_SGR_0__ \x1b[31mred\x1b[0m")).toBe(
			"__ZENTUI_SGR_0__ \x1b[31mred\x1b[0m",
		);
	});
	it("preserves SGR color while stripping unsafe control sequences", () => {
		expect(sanitizeExtensionStatusOriginalText("\x1b[31mred\x1b[0m\nnext\tline")).toBe(
			"\x1b[31mred\x1b[0m next line",
		);
		expect(sanitizeExtensionStatusOriginalText("\x1b]133;A\x07prompt\x1b]133;B\x07")).toBe(
			"prompt",
		);
		expect(sanitizeExtensionStatusOriginalText("\x1b[32mok\x1b[0m\x1b[2K")).toBe(
			"\x1b[32mok\x1b[0m",
		);
	});

	it("returns an empty string when no visible original status remains", () => {
		expect(sanitizeExtensionStatusOriginalText("\x1b[31m\x1b[0m\n\t")).toBe("");
	});
});

describe("collectExtensionStatusSegments", () => {
	it("preserves links only for original-color statuses without changing their placement", () => {
		const link = "\x1b]8;;https://example.com/pull/123\x07PR #123\x1b]8;;\x07";
		const config = configWithExtensionStatuses({
			placements: { pr: "right" },
			colorModes: { pr: "original" },
		});
		const segments = collectExtensionStatusSegments(
			new Map([
				["pr", link],
				["plain", link],
			]),
			config,
		);
		expect(segments.right).toEqual([
			{ key: "plain", text: "PR #123", placement: "right", colorMode: "zentui" },
			{ key: "pr", text: link, placement: "right", colorMode: "original" },
		]);
	});
	it("routes active statuses by placement and defaults unsaved keys to right", () => {
		const config = configWithExtensionStatuses({
			placements: {
				alpha: "left",
				beta: "middle",
				gamma: "right",
				hidden: "off",
			},
		});
		const segments = collectExtensionStatusSegments(
			new Map([
				["gamma", "gamma"],
				["unsaved", "unsaved"],
				["hidden", "hidden"],
				["beta", "beta"],
				["alpha", "alpha"],
			]),
			config,
		);

		expect(segments.left.map((segment) => segment.key)).toEqual(["alpha"]);
		expect(segments.middle.map((segment) => segment.key)).toEqual(["beta"]);
		expect(segments.right.map((segment) => segment.key)).toEqual(["gamma", "unsaved"]);
		expect(
			[...segments.left, ...segments.middle, ...segments.right].map((segment) => segment.key),
		).not.toContain("hidden");
	});

	it("sorts each placement alphabetically and skips sanitized-empty statuses", () => {
		const config = configWithExtensionStatuses({ defaultPlacement: "left" });
		const segments = collectExtensionStatusSegments(
			new Map([
				["zeta", "z"],
				["empty", "\x1b[31m\x1b[0m"],
				["alpha", "a"],
			]),
			config,
		);

		expect(segments.left.map((segment) => segment.key)).toEqual(["alpha", "zeta"]);
		expect(segments.left.map((segment) => segment.text)).toEqual(["a", "z"]);
	});

	it("treats prototype-shaped status keys as opaque strings", () => {
		const statuses = new Map([
			["constructor", "constructor"],
			["toString", "toString"],
			["__proto__", "proto"],
		]);
		const defaults = collectExtensionStatusSegments(statuses, configWithExtensionStatuses({}));
		expect(defaults.right.map((segment) => segment.key)).toEqual([
			"__proto__",
			"constructor",
			"toString",
		]);

		const configured = collectExtensionStatusSegments(
			statuses,
			configWithExtensionStatuses({
				placements: Object.fromEntries([
					["constructor", "left"],
					["toString", "middle"],
					["__proto__", "off"],
				]) as PolishedTuiConfig["extensionStatuses"]["placements"],
				colorModes: Object.fromEntries([
					["constructor", "original"],
					["toString", "original"],
					["__proto__", "original"],
				]) as PolishedTuiConfig["extensionStatuses"]["colorModes"],
			}),
		);
		expect(configured.left[0]).toMatchObject({ key: "constructor", colorMode: "original" });
		expect(configured.middle[0]).toMatchObject({ key: "toString", colorMode: "original" });
		expect(configured.right).toEqual([]);
	});

	it("falls back safely after runtime enum mutation", () => {
		const config = configWithExtensionStatuses({});
		const mutable = config.components.footer.styles.starship.extensionStatuses as unknown as {
			defaultPlacement: string;
			placements: Record<string, string>;
			colorModes: Record<string, string>;
		};
		mutable.defaultPlacement = "center";
		mutable.placements.alpha = "explode";
		mutable.colorModes.alpha = "rainbow";

		const segments = collectExtensionStatusSegments(new Map([["alpha", "ok"]]), config);
		expect(segments.right).toEqual([
			{ key: "alpha", text: "ok", placement: "right", colorMode: "zentui" },
		]);
	});

	it("keeps original ANSI color only for statuses configured as original", () => {
		const config = configWithExtensionStatuses({
			colorModes: {
				alpha: "original",
				beta: "zentui",
			},
		});
		const segments = collectExtensionStatusSegments(
			new Map([
				["alpha", "\x1b[31mred\x1b[0m"],
				["beta", "\x1b[32mgreen\x1b[0m"],
			]),
			config,
		);

		expect(segments.right).toEqual([
			{ key: "alpha", text: "\x1b[31mred\x1b[0m", placement: "right", colorMode: "original" },
			{ key: "beta", text: "green", placement: "right", colorMode: "zentui" },
		]);
	});
});
