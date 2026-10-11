import { initTheme, type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { boundedWrap } from "../extensions/zentui/tool-display/bounds.js";
import { resolveDiffPresentationMode } from "../extensions/zentui/tool-display/diff-presentation.js";
import {
	renderEditDiffResult,
	renderWriteDiffResult,
} from "../extensions/zentui/tool-display/diff-renderer.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	boundedPresentationSource,
	graphemePrefix,
	MAX_PRESENTATION_SOURCE_BYTES,
	MAX_PREVIEW_LINE_CHARS,
} from "../extensions/zentui/tool-display/source-bounds.js";
import { editFixture, writeFixture } from "./tool-display-fixture.js";

const plain = (lines: string[]) =>
	lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).join("\n");
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
		const diff = "+1|aaa aaa aaa aaa aaa";
		const collapsed = editFixture(diff, config, theme, false).render(8);
		expect(collapsed).toHaveLength(7);
		expect(plain(collapsed)).toContain("…");
		expect(plain(collapsed).match(/aaa/g)).toHaveLength(4);
		for (const line of collapsed) expect(visibleWidth(line)).toBeLessThanOrEqual(8);
		const expanded = editFixture(diff, config, theme, true).render(8);
		expect(plain(expanded).match(/aaa/g)).toHaveLength(5);
		expect(plain(expanded)).not.toContain("…");
	});
	it("production parser preserves canonical/legacy/hash gutters and independent hunk cursors", () => {
		const rendered = plain(
			renderEditDiffResult(
				{ diff: "-12#AB:old\n+12#CD:new\n 13|same\n- 14 legacy\n+ 14 replacement" },
				{ expanded: true },
				normalizeToolDisplayConfig({ diffViewMode: "split" }),
				theme,
				"",
			).render(160),
		);
		expect(rendered).toContain("12#AB");
		expect(rendered).toContain("12#CD");
		expect(rendered).toContain("legacy");
		expect(rendered).toContain("replacement");
		const hunk = plain(
			renderEditDiffResult(
				{ diff: "@@ -4,1 +8,1 @@\n-old\n+new" },
				{ expanded: true },
				normalizeToolDisplayConfig({ diffViewMode: "split" }),
				theme,
				"",
			).render(160),
		);
		expect(hunk).toMatch(/4.*old.*8.*new/);
	});
	it("production write rendering preserves create/delete/replacement/context without phantom data rows", () => {
		const cfg = () => normalizeToolDisplayConfig({ diffViewMode: "unified" });
		const created = plain(writeFixture("", "a\n", cfg, theme, true).render(80));
		expect(created).toContain("created");
		expect(created).toMatch(/1.*a/);
		const deleted = plain(writeFixture("a\n", "", cfg, theme, true).render(80));
		expect(deleted).toContain("overwritten");
		expect(deleted).toMatch(/1.*a/);
		const changed = plain(writeFixture("a\nb\nc", "a\nx\nc", cfg, theme, true).render(80));
		expect(changed).toContain("b");
		expect(changed).toContain("x");
		expect(changed).toContain("c");
	});
	it.each(["auto", "split", "unified"] as const)(
		"%s adapts through summary/compact/unified/split modes",
		(diffViewMode) => {
			const config = normalizeToolDisplayConfig({ diffViewMode });
			expect(resolveDiffPresentationMode(config, 7, false)).toBe("summary");
			expect(resolveDiffPresentationMode(config, 8, false)).toBe("compact");
			expect(resolveDiffPresentationMode(config, 30, false)).toBe("unified");
			expect(resolveDiffPresentationMode(config, 140, true)).toBe(
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
					const component = editFixture(
						`-12#AB:${"界🧪 old ".repeat(25)}\n+12#CD:${"界🧪 new ".repeat(25)}\n 13#EF:same`,
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
		const component = editFixture(
			"-12#AB:const old = 1;\n+12#CD:const next = 1;\n 13#EF:same\n 14|same\n 15|same\n 16|same",
			() => normalizeToolDisplayConfig({ diffViewMode: "split", diffCollapsedLines: 4 }),
			theme,
			true,
		);
		expect(plain(component.render(140))).toContain("12#AB");
		expect(plain(component.render(140))).toContain("12#CD");
		expect(component.render(140).join("\n")).toContain("\x1b[48;2;");
		expect(plain(component.render(140))).toContain("+1 -1");
		expect(plain(component.render(140))).toContain("split");
		expect(plain(component.render(8))).toContain("const");
	});
	it("re-evaluates theme/config without stale width caches and catches highlighting failure", () => {
		let config = normalizeToolDisplayConfig({ diffViewMode: "unified" });
		let tint = 31;
		const liveTheme = {
			fg: (_token: string, text: string) => `\x1b[${tint}m${text}\x1b[39m`,
			bold: (s: string) => s,
		} as Theme;
		const component = writeFixture("a", "a\nb", () => config, liveTheme, true, {
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
	it("production overwrite comparison guard avoids materializing oversized matrices", () => {
		const before = Array.from({ length: 600 }, (_, i) => `old ${i}`).join("\n");
		const after = Array.from({ length: 600 }, (_, i) => `new ${i}`).join("\n");
		expect(
			plain(
				writeFixture(before, after, () => normalizeToolDisplayConfig({}), theme, true).render(80),
			),
		).toContain("overwrite diff omitted");
	});
	it("production expanded overwrite shows distant changes", () => {
		const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
		const after = before.replace("line 80", "changed");
		expect(
			plain(
				writeFixture(before, after, () => normalizeToolDisplayConfig({}), theme, true).render(80),
			),
		).toContain("changed");
	});
	it("reports oversized diff omissions and preserves emoji in word highlighting", () => {
		expect(
			plain(
				writeFixture(
					"x\n".repeat(4001),
					"new",
					() => normalizeToolDisplayConfig({}),
					theme,
					true,
				).render(80),
			),
		).toContain("omitted");
		expect(
			plain(
				renderEditDiffResult(
					{ diff: "+x\n".repeat(8001) },
					{ expanded: true },
					normalizeToolDisplayConfig({}),
					theme,
					"",
				).render(80),
			),
		).toContain("capped");
		const component = editFixture(
			"-1|🧪 old\n+1|🧫 new",
			() => normalizeToolDisplayConfig({ diffViewMode: "unified" }),
			theme,
			true,
		);
		expect(plain(component.render(80))).toContain("🧪 old");
		expect(plain(component.render(80))).toContain("🧫 new");
	});
	it.each([
		["🧪", "🧫"],
		["👩‍💻", "👩‍🔬"],
		["e\u0301", "e\u0300"],
	])("preserves UTF-8 and whole graphemes in changed %s -> %s emphasis", (before, after) => {
		const component = editFixture(
			`-1|const value = '${before}';\n+1|const value = '${after}';`,
			() => normalizeToolDisplayConfig({ diffViewMode: "split" }),
			theme,
			true,
		);
		const rows = component.render(160);
		for (const row of rows) expect(Buffer.from(row, "utf8").toString("utf8")).toBe(row);
		const visible = plain(rows);
		expect(visible).toContain(before);
		expect(visible).toContain(after);
		for (const glyph of [before, after]) expect(rows.some((row) => row.includes(glyph))).toBe(true);
	});
	it.each(["create", "overwrite-new", "overwrite-previous"])(
		"bounds write %s before real-card highlighting or detailed entries",
		(kind) => {
			initTheme("dark", false);
			const huge = `${"x".repeat(2 * MAX_PRESENTATION_SOURCE_BYTES)}🧪`;
			const content = kind === "overwrite-previous" ? "const next = 1;" : huge;
			const previous = kind === "overwrite-previous" ? huge : "const old = 1;";
			const highlight = vi.fn((line: string) => line);
			const args = Object.freeze({ path: "example.ts", content });
			const result = { content: [{ type: "text", text: "written" }], details: {}, isError: false };
			const config = normalizeToolDisplayConfig({
				diffViewMode: "split",
				expandedPreviewMaxLines: 0,
			});
			const row = new ToolExecutionComponent(
				"write",
				"bounded-write",
				args,
				{ showImages: false },
				{
					renderCall: () => new Text("write example.ts", 0, 0),
					renderResult: (
						_result: unknown,
						options: { expanded: boolean; isPartial: boolean },
						current: Theme,
					) =>
						renderWriteDiffResult(
							content,
							{
								expanded: options.expanded,
								filePath: args.path,
								previousContent: previous,
								fileExistedBeforeWrite: kind !== "create",
								highlighter: highlight,
							},
							config,
							current,
							"written",
						),
				},
				{ requestRender() {} } as unknown as TUI,
				"/sandbox",
			);
			row.updateResult(result);
			row.setExpanded(true);
			const output = row.render(80);
			expect(plain(output)).toContain("write diff omitted");
			expect(highlight).not.toHaveBeenCalled();
			expect(args.content).toBe(content);
			expect(result.content[0].text).toBe("written");
			for (const line of output) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(80);
				expect(Buffer.from(line, "utf8").toString("utf8")).toBe(line);
			}
		},
	);
	it.each(["🧪", "e\u0301", "👩‍💻"])(
		"caps source/line prefixes on complete %s boundaries",
		(glyph) => {
			const prefix = "a".repeat(MAX_PREVIEW_LINE_CHARS - 1);
			const original = `${prefix + glyph}tail`;
			const bounded = boundedPresentationSource(original, 4000, false);
			expect(bounded.capped).toBe(true);
			expect(bounded.lines[0]).toBe(prefix);
			expect(Buffer.from(bounded.lines[0], "utf8").toString("utf8")).toBe(bounded.lines[0]);
			expect(
				graphemePrefix(`${"a".repeat(MAX_PREVIEW_LINE_CHARS - 3)}👩‍💻`, MAX_PREVIEW_LINE_CHARS),
			).toBe("a".repeat(MAX_PREVIEW_LINE_CHARS - 3));
			const leading = `${"a".repeat(MAX_PREVIEW_LINE_CHARS)}\n`.repeat(63);
			const tail = "a".repeat(MAX_PRESENTATION_SOURCE_BYTES - leading.length - 1);
			const byteBounded = boundedPresentationSource(`${leading + tail}e\u0301tail`, 4000, false);
			expect(byteBounded.capped).toBe(true);
			expect(byteBounded.lines.at(-1)).toBe(tail);
			const highlight = vi.fn((line: string) => line);
			const component = renderWriteDiffResult(
				original,
				{
					expanded: true,
					previousContent: "old",
					fileExistedBeforeWrite: true,
					highlighter: highlight,
				},
				normalizeToolDisplayConfig({}),
				theme,
				"written",
			);
			expect(plain(component.render(80))).toContain("omitted");
			expect(highlight).not.toHaveBeenCalled();
		},
	);
	it.each([8000, 8001, 8010])(
		"retains an external capped-input warning at %s lines across rendering boundaries",
		(count) => {
			const payload = Array.from(
				{ length: count },
				(_, index) => `+${index + 1}|line-${index + 1}`,
			).join("\n");
			const result = Object.freeze({ diff: payload });
			for (const expanded of [false, true])
				for (const width of [1, 7, 8, 17, 80]) {
					const config = normalizeToolDisplayConfig({
						diffCollapsedLines: 4,
						expandedPreviewMaxLines: 0,
						diffViewMode: "unified",
					});
					const output = renderEditDiffResult(result, { expanded }, config, theme, "edited").render(
						width,
					);
					for (const line of output) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					if (count > 8000) {
						expect(plain(output.at(-1) ? [output.at(-1) as string] : [])).toMatch(
							width >= 8 ? /capped/ : /…/,
						);
						expect(plain(output)).not.toMatch(/\(\d+ more diff lines/);
					} else expect(plain(output)).not.toContain("input capped");
				}
			expect(result.diff).toBe(payload);
		},
	);
	it("counts a terminal empty meta row at the source boundary without silently dropping it", () => {
		const payload = `${Array.from({ length: 8000 }, (_, index) => `+${index + 1}|x`).join("\n")}\n`;
		expect(
			plain(
				renderEditDiffResult(
					{ diff: payload },
					{ expanded: true },
					normalizeToolDisplayConfig({ expandedPreviewMaxLines: 0 }),
					theme,
					"edited",
				).render(80),
			),
		).toContain("input capped");
	});
});
