import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	boundedWrap,
	diffComponent,
	diffContents,
	focusDiffContext,
	parseDiff,
	resolveDiffPresentation,
} from "../extensions/zentui/tool-display/diff.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";

const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const theme = {
	fg: (_token: string, text: string) => `\x1b[32m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as Theme;
describe("tool-display/diff", () => {
	it.each([
		"aaa aaa aaa",
		"\x1b[35maaa aaa aaa\x1b[39m",
		"\x1b[35m🧪a 🧪a 🧪a\x1b[39m",
		"🧪a 🧪a 🧪a",
		"a\u0301aa a\u0301aa a\u0301aa",
	])("F7 boundedWrap reports omitted host word-wrap rows: %s", (text) => {
		const bounded = boundedWrap(text, 6, 2, true);
		expect(bounded.lines).toHaveLength(2);
		expect(bounded.capped).toBe(true);
		for (const line of bounded.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(6);
		const full = boundedWrap(text, 6, 3, true);
		expect(full.lines).toHaveLength(3);
		expect(full.capped).toBe(false);
	});
	it("F7 boundedWrap preserves empty, zero-budget and nowrap behavior", () => {
		expect(boundedWrap("aaa", 0, 2, true)).toEqual({ lines: [], capped: true });
		expect(boundedWrap("aaa", 6, 0, true)).toEqual({ lines: [], capped: true });
		expect(boundedWrap("", 0, 2, true)).toEqual({ lines: [], capped: false });
		expect(boundedWrap("", 6, 2, true)).toEqual({ lines: [""], capped: false });
		expect(boundedWrap("aaa", 6, 2, false)).toEqual({ lines: ["aaa"], capped: false });
		const clipped = boundedWrap("aaa aaa aaa", 6, 2, false);
		expect(clipped.lines).toHaveLength(1);
		expect(visibleWidth(clipped.lines[0])).toBe(6);
		expect(clipped.capped).toBe(true);
	});
	it("F7 compact diff reports words omitted by its visual row limit", () => {
		const config = () => normalizeToolDisplayConfig({ diffCollapsedLines: 4 });
		const diff = parseDiff("+1|aaa aaa aaa aaa aaa");
		const collapsed = diffComponent(diff, config, theme, false).render(8);
		expect(collapsed).toHaveLength(6);
		expect(plain(collapsed)).toContain("…");
		expect(plain(collapsed).match(/aaa/g)).toHaveLength(4);
		for (const line of collapsed) expect(visibleWidth(line)).toBeLessThanOrEqual(8);
		const expanded = diffComponent(diff, config, theme, true).render(8);
		expect(plain(expanded).match(/aaa/g)).toHaveLength(5);
		expect(plain(expanded)).not.toContain("…");
	});
	it("parses Pi canonical, legacy, unified hunks and hashline gutters", () => {
		expect(
			parseDiff("-12#AB:old\n+12#CD:new\n 13|same\n- 14 legacy\n+ 14 replacement"),
		).toMatchObject([
			{ kind: "remove", text: "old", old: "12#AB" },
			{ kind: "add", text: "new", next: "12#CD" },
			{ kind: "context", text: "same", old: "13", next: "13" },
			{ kind: "remove", text: "legacy", old: "14" },
			{ kind: "add", text: "replacement", next: "14" },
		]);
		expect(parseDiff("--- a/file\n+++ b/file\n@@ -4,1 +8,1 @@\n-old\n+new")).toMatchObject([
			{ kind: "meta" },
			{ kind: "meta" },
			{ kind: "meta" },
			{ old: "4" },
			{ next: "8" },
		]);
	});
	it("builds exact create/delete/replacement/context transformations and no phantom terminal blank line", () => {
		expect(diffContents("", "a\n")).toEqual([
			{ kind: "add", text: "a", next: "1", old: undefined },
		]);
		expect(diffContents("a\n", "")).toMatchObject([{ kind: "remove", old: "1" }]);
		expect(diffContents("a\nb\nc", "a\nx\nc")).toMatchObject([
			{ kind: "context", old: "1", next: "1" },
			{ kind: "remove", text: "b", old: "2" },
			{ kind: "add", text: "x", next: "2" },
			{ kind: "context", text: "c", old: "3", next: "3" },
		]);
	});
	it.each(["auto", "split", "unified"] as const)(
		"%s adapts through summary/compact/unified/split modes",
		(diffViewMode) => {
			const config = normalizeToolDisplayConfig({ diffViewMode });
			expect(resolveDiffPresentation(config, 7)).toBe("summary");
			expect(resolveDiffPresentation(config, 8)).toBe("compact");
			expect(resolveDiffPresentation(config, 30)).toBe("unified");
			expect(resolveDiffPresentation(config, 140)).toBe(
				diffViewMode === "unified" ? "unified" : "split",
			);
		},
	);
	it.each([true, false])(
		"wrap=%s keeps every ANSI/Unicode line within width on resize",
		(diffWordWrap) => {
			for (const diffViewMode of ["auto", "split", "unified"] as const)
				for (const diffIndicatorMode of ["bars", "classic", "none"] as const) {
					const config = normalizeToolDisplayConfig({
						diffViewMode,
						diffWordWrap,
						diffIndicatorMode,
						diffCollapsedLines: 2,
					});
					const component = diffComponent(
						parseDiff(
							`-12#AB:${"界🧪 old ".repeat(25)}\n+12#CD:${"界🧪 new ".repeat(25)}\n 13#EF:same`,
						),
						() => config,
						theme,
						false,
					);
					for (const width of [140, 80, 60, 17, 8, 7, 2, 1, 0, NaN, -1, 140])
						for (const line of component.render(width))
							expect(visibleWidth(line)).toBeLessThanOrEqual(
								Number.isFinite(width) ? Math.max(0, width) : 0,
							);
				}
		},
	);
	it("shows anchors, inline word emphasis, counts and progressive collapse hints", () => {
		const component = diffComponent(
			parseDiff(
				"-12#AB:const old = 1;\n+12#CD:const next = 1;\n 13#EF:same\n 14|same\n 15|same\n 16|same",
			),
			() => normalizeToolDisplayConfig({ diffViewMode: "split", diffCollapsedLines: 4 }),
			theme,
			false,
		);
		expect(plain(component.render(140))).toContain("12#AB");
		expect(plain(component.render(140))).toContain("12#CD");
		expect(component.render(140).join("\n")).toContain("\x1b[1mold\x1b[22m");
		expect(plain(component.render(140))).toContain("+1 -1");
		expect(plain(component.render(140))).toContain("at least 1 more diff rows");
		expect(plain(component.render(8))).toContain("…");
	});
	it("re-evaluates theme/config without stale width caches and catches highlighting failure", () => {
		let config = normalizeToolDisplayConfig({ diffViewMode: "unified" });
		let tint = 31;
		const liveTheme = {
			fg: (_token: string, text: string) => `\x1b[${tint}m${text}\x1b[39m`,
			bold: (s: string) => s,
		} as Theme;
		const component = diffComponent(diffContents("a", "a\nb"), () => config, liveTheme, true, {
			highlighter: () => {
				throw new Error("unsupported syntax");
			},
		});
		expect(component.render(120).join("\n")).toContain("\x1b[31m");
		tint = 32;
		config = normalizeToolDisplayConfig({
			diffViewMode: "split",
			diffIndicatorMode: "none",
			diffWordWrap: false,
		});
		component.invalidate();
		expect(component.render(120).join("\n")).toContain("\x1b[32m");
		expect(plain(component.render(120))).toContain("a");
	});
	it("bounds the large middle diff algorithm without incorrect transformations", () => {
		const before = Array.from({ length: 600 }, (_, i) => `old ${i}`).join("\n");
		const after = Array.from({ length: 600 }, (_, i) => `new ${i}`).join("\n");
		const diff = diffContents(before, after);
		expect(diff.filter((line) => line.kind === "remove")).toHaveLength(600);
		expect(diff.filter((line) => line.kind === "add")).toHaveLength(600);
	});
	it("generated pending/write previews retain distant changes and mark omitted context", () => {
		const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
		const after = before.replace("line 80", "changed");
		const focused = focusDiffContext(diffContents(before, after));
		expect(focused.length).toBeLessThan(12);
		expect(focused.some((line) => line.text === "changed")).toBe(true);
		expect(
			focused.some((line) => line.kind === "meta" && line.text.includes("unchanged lines omitted")),
		).toBe(true);
	});
	it("reports oversized diff omissions and preserves emoji in word highlighting", () => {
		expect(diffContents("x\n".repeat(4001), "new")[0].text).toContain("omitted");
		expect(parseDiff("+x\n".repeat(8001)).at(-1)?.text).toContain("capped");
		const component = diffComponent(
			parseDiff("-1|🧪 old\n+1|🧫 new"),
			() => normalizeToolDisplayConfig({ diffViewMode: "unified" }),
			theme,
			true,
		);
		expect(plain(component.render(80))).toContain("🧪 old");
		expect(plain(component.render(80))).toContain("🧫 new");
	});
});
