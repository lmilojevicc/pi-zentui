import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, type ZentuiConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { packCompactChunks } from "../extensions/zentui/footer-layout";
import { truncateFooterText } from "../extensions/zentui/footer-text";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
	return { ...actual, truncateToWidth: vi.fn(actual.truncateToWidth) };
});

const actualTui =
	await vi.importActual<typeof import("@earendil-works/pi-tui")>("@earendil-works/pi-tui");
const url = "https://example.com/pull/123";
const longLabel = "abcdefghijklmnopqrstuvwxyz".repeat(4);
const link = (label: string, end = "\x07") => `\x1b]8;;${url}${end}${label}\x1b]8;;${end}`;

// Isolated old-host model: preserve complete ANSI controls in the retained prefix,
// but append only an SGR reset on truncation, as Pi TUI 0.80.5 does. Never rely
// on the installed (possibly link-safe) truncateToWidth implementation here.
function legacyTruncate(text: string, width: number, ellipsis = "..."): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	if (visibleWidth(ellipsis) >= width) return ellipsis.slice(0, width);
	let result = "";
	let used = 0;
	for (const token of text.match(/\x1b\[[0-9;:]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)|./gu) ?? []) {
		const size = visibleWidth(token);
		if (used + size > width - visibleWidth(ellipsis)) break;
		result += token;
		used += size;
	}
	return `${result}\x1b[0m${ellipsis}`;
}

function linkState(text: string) {
	let active = false;
	let linked = "";
	let plain = "";
	for (const token of text.match(/\x1b\[[0-9;:]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)|./gu) ?? []) {
		if (token.startsWith("\x1b]8;")) active = !/^\x1b\]8;;(?:\x07|\x1b\\)$/.test(token);
		else if (!token.startsWith("\x1b")) {
			if (active) linked += token;
			else plain += token;
		}
	}
	return { active, linked, plain };
}

function renderFooter(
	config: ZentuiConfig,
	statuses: Map<string, string>,
	width: number,
): string[] {
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	const ctx = {
		cwd: "/repo",
		getContextUsage: () => undefined,
		sessionManager: { getSessionName: () => undefined },
		ui: {
			setFooter(value: typeof factory) {
				factory = value;
			},
		},
	} as unknown as ExtensionContext;
	installFooter(ctx, createInitialState(emptyGitStatus()), () => config, {
		setRequestRender() {},
		scheduleProjectRefresh() {},
	});
	const footer = factory?.(
		{ requestRender() {} } as never,
		{ fg: (_color: string, text: string) => text } as Theme,
		{ onBranchChange: () => () => {}, getExtensionStatuses: () => statuses } as never,
	);
	expect(footer).toBeDefined();
	try {
		return footer?.render(width) ?? [];
	} finally {
		footer?.dispose?.();
	}
}

for (const host of ["installed", "legacy"] as const) {
	describe(`footer status hyperlinks (${host} truncation)`, () => {
		beforeEach(() => {
			vi.mocked(truncateToWidth).mockImplementation(
				host === "legacy" ? legacyTruncate : actualTui.truncateToWidth,
			);
		});

		it("models the old host's missing OSC 8 close independently of installed Pi", () => {
			const text = legacyTruncate(link(longLabel), 8, "…");
			expect(text).toBe(`\x1b]8;;${url}\x07abcdefg\x1b[0m…`);
			expect(linkState(text).active).toBe(true);
		});

		for (const responsive of [false, true]) {
			for (const placement of ["left", "middle", "right"] as const) {
				it.each(["\x07", "\x1b\\"])(
					`truncates long ${placement} links safely (responsive=${responsive}, %j)`,
					(end) => {
						const config = structuredClone(defaultConfig);
						const style = config.components.footer.styles.starship;
						style.responsive = responsive;
						style.format = "LEFT$fill RIGHT";
						style.compactFormat = "$extensions $wrap_sep SUFFIX";
						style.extensionStatuses.colorModes.pr = "original";
						style.extensionStatuses.placements.pr = placement;
						const lines = renderFooter(config, new Map([["pr", link(longLabel, end)]]), 20);
						expect(lines.join("")).toContain("…");
						expect(lines.join("")).not.toContain(longLabel);
						expect(lines.join("")).toContain(`\x1b]8;;${url}\x07`);
						for (const line of lines) {
							expect(visibleWidth(line)).toBeLessThanOrEqual(20);
							const state = linkState(`${line}NEIGHBOR`);
							expect(state.active).toBe(false);
							expect(state.linked).toMatch(/^[a-z…]*$/);
							expect(state.plain).toContain("NEIGHBOR");
						}
					},
				);

				it(`isolates malformed ${placement} statuses from neighbors (responsive=${responsive})`, () => {
					const config = structuredClone(defaultConfig);
					const style = config.components.footer.styles.starship;
					style.responsive = responsive;
					style.format = "LEFT$fill RIGHT";
					style.extensionStatuses.colorModes.pr = "original";
					style.extensionStatuses.placements = { pr: placement, zz: placement };
					const malformed = "\x1b]8;;https://example.com/\x07A\x1b]0;title\x1b]8;;\x07\x07 tail";
					const lines = renderFooter(
						config,
						new Map([
							["pr", malformed],
							["zz", "PLAIN"],
						]),
						80,
					);
					const state = linkState(lines.join(""));
					expect(state.active).toBe(false);
					expect(state.linked).toBe("A tail");
					expect(state.plain).toContain("PLAIN");
					expect(state.plain).toContain("RIGHT");
				});
			}
		}

		it.each([20, 40, 80, 160])(
			"preserves short links and plain suffixes at %i columns",
			(width) => {
				const config = structuredClone(defaultConfig);
				const style = config.components.footer.styles.starship;
				style.format = "demo$fill";
				style.compactFormat = "$extensions";
				style.extensionStatuses.colorModes.pr = "original";
				const lines = renderFooter(
					config,
					new Map([["pr", `${link("PR #123")} | pending`]]),
					width,
				);
				expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
				expect(lines.join("\n")).toContain(link("PR #123"));
				expect(linkState(lines.join("")).linked).toBe("PR #123");
				expect(linkState(lines.join("")).plain).toContain("pending");
			},
		);

		it("closes links when compact omission truncates a previously joined row", () => {
			const rows = packCompactChunks(
				[
					{ text: `PLAIN ${link("abcdefghijk")}`, boundary: "space" },
					{ text: "OMITTED", boundary: "space" },
				],
				17,
				1,
				" | ",
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toContain("…");
			expect(linkState(`${rows[0]}NEIGHBOR`).plain).toContain("NEIGHBOR");
			expect(linkState(rows[0] ?? "").active).toBe(false);
			expect(visibleWidth(rows[0] ?? "")).toBe(17);
		});

		it.each([0, 1, 2, 3, 8, 20, 160])(
			"closes BEL/ST links at fragment boundaries of width %i",
			(width) => {
				for (const end of ["\x07", "\x1b\\"]) {
					for (const ellipsis of ["", "…"]) {
						const text = `PLAIN ${link("first", end)} | ${link(longLabel, end)} SUFFIX`;
						const result = truncateFooterText(text, width, ellipsis);
						expect(visibleWidth(result)).toBeLessThanOrEqual(width);
						expect(linkState(`${result}NEIGHBOR`).plain).toContain("NEIGHBOR");
						expect(linkState(result).linked).toMatch(/^[a-z…]*$/);
					}
				}
			},
		);

		it.each([1, 2, 3, 4, 8])("bounds compact footer frames at %i columns", (width) => {
			const config = structuredClone(defaultConfig);
			const style = config.components.footer.styles.starship;
			style.format = "LEFT$fill RIGHT";
			style.compactFormat = "$extensions";
			style.extensionStatuses.colorModes.pr = "original";
			const lines = renderFooter(config, new Map([["pr", link(longLabel)]]), width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(linkState(`${line}NEIGHBOR`).plain).toContain("NEIGHBOR");
			}
		});

		it("leaves plain and SGR-only truncation unchanged", () => {
			for (const text of ["plain", "\x1b[31mred label\x1b[0m", "界 e\u0301 wide text"]) {
				for (const width of [0, 1, 8, 80]) {
					expect(truncateFooterText(text, width, "…")).toBe(truncateToWidth(text, width, "…"));
				}
			}
		});

		it("keeps adjacent plain and built-in chunks outside links", () => {
			const rows = packCompactChunks(
				[
					{ text: link("label"), boundary: "space" },
					{ text: "PLAIN", boundary: "space" },
					{ text: "BUILTIN", boundary: "separator" },
				],
				40,
				1,
				" | ",
			);
			expect(linkState(rows[0] ?? "")).toEqual({
				active: false,
				linked: "label",
				plain: " PLAIN | BUILTIN",
			});
		});
	});
}
