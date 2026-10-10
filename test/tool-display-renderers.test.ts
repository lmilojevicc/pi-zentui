import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ToolRenderers } from "../extensions/zentui/tool-display/host-contract.js";
import { PendingPreimages } from "../extensions/zentui/tool-display/pending.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	createToolDisplayRenderers,
	hasOnlyTextContent,
	type ToolDisplayRenderContext,
} from "../extensions/zentui/tool-display/renderers.js";

const theme = {
	fg: (_token: string, text: string) => `\x1b[36m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as Theme;
function context(args: Record<string, unknown> = {}): ToolDisplayRenderContext {
	return {
		args,
		cwd: "/sandbox",
		toolCallId: "live",
		state: {},
		argsComplete: true,
		executionStarted: true,
		expanded: false,
		isPartial: false,
		isError: false,
		showImages: false,
		lastComponent: undefined,
		invalidate() {},
	};
}
const plain = (lines: string[]) =>
	lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).join("\n");
const result = (text: string) => ({
	content: [{ type: "text" as const, text }],
	details: undefined,
});
function render(
	renderer: ToolRenderers,
	text: string,
	expanded = false,
	partial = false,
	args = {},
	isError = false,
) {
	return (
		renderer
			.renderResult?.(result(text), { expanded, isPartial: partial }, theme, {
				...context(args),
				isError,
			})
			.render(80) ?? []
	);
}

describe("tool-display/renderers", () => {
	it.each(["read", "grep", "find", "ls", "bash", "write", "edit"])(
		"compact %s calls clip safely with ANSI/wide characters",
		(name) => {
			const renderer = createToolDisplayRenderers(name, () =>
				normalizeToolDisplayConfig({ enabled: true }),
			);
			const args = {
				path: "界/🧪-example.ts",
				pattern: "界 pattern",
				command: "printf '界'",
				content: "界\n",
				oldText: "old",
				newText: "new",
				limit: 10,
			};
			const call = renderer.renderCall?.(args, theme, context(args));
			for (const width of [0, 1, 2, 7, 17, 30, 80, 140, NaN])
				for (const line of call?.render(width) ?? [])
					expect(visibleWidth(line)).toBeLessThanOrEqual(Number.isFinite(width) ? width : 0);
		},
	);
	it("F7 native read preview retains complete upstream word-wrap output", () => {
		const renderer = createToolDisplayRenderers("read", () =>
			normalizeToolDisplayConfig({ enabled: true, readOutputMode: "preview", previewLines: 1 }),
		);
		const collapsed =
			renderer
				.renderResult?.(
					result("aaa aaa aaa"),
					{ expanded: false, isPartial: false },
					theme,
					context(),
				)
				.render(6) ?? [];
		expect(collapsed).toHaveLength(3);
		expect(plain(collapsed)).not.toContain("…");
		expect(plain(collapsed).match(/aaa/g)).toHaveLength(3);
		for (const line of collapsed) expect(visibleWidth(line)).toBeLessThanOrEqual(6);
		const expanded =
			renderer
				.renderResult?.(
					result("aaa aaa aaa"),
					{ expanded: true, isPartial: false },
					theme,
					context(),
				)
				.render(6) ?? [];
		expect(plain(expanded).match(/aaa/g)).toHaveLength(3);
		expect(plain(expanded)).not.toContain("…");
	});
	it("read ranges and write Unicode byte/line counts are precise", () => {
		const config = () => normalizeToolDisplayConfig({ enabled: true });
		const read = createToolDisplayRenderers("read", config);
		expect(
			plain(
				read.renderCall?.({ path: "f.ts", offset: 3, limit: 2 }, theme, context()).render(80) ?? [],
			),
		).toBe("read f.ts:3-4");
		const write = createToolDisplayRenderers("write", config);
		expect(
			plain(
				write.renderCall?.({ path: "f.ts", content: "界\n" }, theme, context()).render(80) ?? [],
			),
		).toBe("write f.ts (1 line • 4B)");
	});
	it.each(["hidden", "summary", "preview"] as const)(
		"read %s follows compact/expanded semantics",
		(readOutputMode) => {
			const renderer = createToolDisplayRenderers("read", () =>
				normalizeToolDisplayConfig({ enabled: true, readOutputMode, previewLines: 1 }),
			);
			const collapsed = plain(render(renderer, "one\ntwo\n"));
			expect(collapsed).toBe(
				readOutputMode === "hidden"
					? ""
					: readOutputMode === "summary"
						? "↳ loaded 2 lines • Ctrl+O to expand"
						: "one\n... (1 more line • Ctrl+O to expand)",
			);
			expect(plain(render(renderer, "one\ntwo\n", true))).toBe(
				readOutputMode === "hidden" ? "" : "one\ntwo",
			);
		},
	);
	it.each([
		["grep", "matches"],
		["find", "results"],
		["ls", "entries"],
	])("%s count uses %s and expands previews", (name, unit) => {
		const renderer = createToolDisplayRenderers(name, () =>
			normalizeToolDisplayConfig({ enabled: true, searchOutputMode: "count" }),
		);
		expect(plain(render(renderer, "one\n\ntwo\n"))).toBe(`↳ 2 ${unit} returned • Ctrl+O to expand`);
		expect(plain(render(renderer, "one\ntwo", true))).toBe("one\ntwo");
	});
	it.each(["opencode", "summary", "preview"] as const)(
		"bash %s shows the correct collapsed lines, and streaming content",
		(bashOutputMode) => {
			const renderer = createToolDisplayRenderers("bash", () =>
				normalizeToolDisplayConfig({
					enabled: true,
					bashOutputMode,
					bashCollapsedLines: 2,
					previewLines: 1,
				}),
			);
			expect(plain(render(renderer, "a\nb\nc"))).toBe(
				bashOutputMode === "summary"
					? "↳ 3 lines returned • Ctrl+O to expand"
					: bashOutputMode === "opencode"
						? "a\nb\n... (1 more line • Ctrl+O to expand)"
						: "a\n... (2 more lines • Ctrl+O to expand)",
			);
			expect(plain(render(renderer, "a\nb", false, true))).toContain("a");
		},
	);
	it.each(["read", "grep", "find", "ls", "bash"])(
		"%s error presentation follows upstream mode without altering failures",
		(name) => {
			const renderer = createToolDisplayRenderers(name, () =>
				normalizeToolDisplayConfig({ enabled: true }),
			);
			const output = plain(render(renderer, "permission denied", false, false, {}, true));
			if (name === "bash") {
				expect(output).toContain("command failed");
				expect(output).toContain("permission denied");
			} else expect(output).toBe("");
		},
	);
	it("generic/MCP exact adapters have distinct labels and output modes", () => {
		const getter = () => normalizeToolDisplayConfig({ enabled: true });
		const generic = createToolDisplayRenderers(
			"ide",
			getter,
			{},
			{ enabled: true, kind: "generic", outputMode: "summary" },
		);
		expect(plain(generic.renderCall?.({ path: "x" }, theme, context()).render(80) ?? [])).toBe(
			"ide (1 arg)",
		);
		expect(plain(render(generic, "one\ntwo"))).toBe("↳ 2 lines returned • Ctrl+O to expand");
		const mcp = createToolDisplayRenderers(
			"mcp__demo__echo",
			getter,
			{},
			{ enabled: true, kind: "mcp", outputMode: "preview" },
		);
		expect(
			plain(mcp.renderCall?.({ tool: "echo", server: "demo" }, theme, context()).render(80) ?? []),
		).toBe("MCP call demo:echo (2 args)");
		expect(plain(render(mcp, "one"))).toBe("one");
	});
	it("reports backend and expanded caps, strips terminal instructions, and re-reads config/theme", () => {
		let config = normalizeToolDisplayConfig({
			enabled: true,
			readOutputMode: "preview",
			expandedPreviewMaxLines: 1,
			showTruncationHints: true,
		});
		const renderer = createToolDisplayRenderers("read", () => config);
		const output = renderer.renderResult?.(
			{
				...result("\x1b[31ma\x1b[0m\x1b]0;untrusted\x07\nb"),
				details: { truncation: { truncated: true }, fullOutputPath: "/tmp/full" },
			},
			{ expanded: true, isPartial: false },
			theme,
			context(),
		);
		expect(plain(output?.render(80) ?? [])).toBe(
			"a\n... (1 more line)\n(truncated by backend limits)\n(display capped at 1 lines by tool-display setting)",
		);
		config = normalizeToolDisplayConfig({ enabled: true, readOutputMode: "hidden" });
		expect(
			renderer
				.renderResult?.(result("a\nb"), { expanded: true, isPartial: false }, theme, context())
				.render(80),
		).toEqual([]);
	});
	it("marks incomplete pending previews honestly, never reads current files from history", () => {
		const renderer = createToolDisplayRenderers("write", () =>
			normalizeToolDisplayConfig({ enabled: true }),
		);
		const args = { path: "missing", content: "new" };
		const call = renderer.renderCall?.(args, theme, { ...context(args), isPartial: true });
		expect(plain(call?.render(80) ?? [])).toContain("no live preimage");
		expect(plain(render(renderer, "written", false, false, args))).toContain(
			"preimage unavailable",
		);
	});
	it("only non-empty all-text content is eligible (images/mixed/unknown/empty pass through)", () => {
		expect(hasOnlyTextContent(result("x"))).toBe(true);
		for (const content of [
			[],
			[{ type: "text", text: "" }],
			[{ type: "image", data: "x" }],
			[
				{ type: "text", text: "x" },
				{ type: "image", data: "x" },
			],
			[{ type: "unknown" }],
		])
			expect(hasOnlyTextContent({ content })).toBe(false);
	});
	it("live observed preimages render pending and finalized write/edit previews without file reads", () => {
		const pending = new PendingPreimages();
		const get = vi.spyOn(pending, "get").mockReturnValue({ exists: true, content: "old\n" });
		const config = () => normalizeToolDisplayConfig({ enabled: true, diffViewMode: "unified" });
		const write = createToolDisplayRenderers("write", config, { pending });
		const args = { path: "f", content: "new\n" };
		expect(
			plain(
				write.renderCall?.(args, theme, { ...context(args), isPartial: true }).render(80) ?? [],
			),
		).toContain("pending overwrite");
		expect(plain(render(write, "written", false, false, args))).toContain("overwritten");
		const edit = createToolDisplayRenderers("edit", config, { pending });
		const edits = { path: "f", oldText: "old", newText: "new" };
		expect(
			plain(
				edit.renderCall?.(edits, theme, { ...context(edits), isPartial: true }).render(80) ?? [],
			),
		).toContain("pending edit");
		get.mockReturnValue(undefined);
		expect(plain(render(write, "written", false, false, args))).toContain("preimage unavailable");
	});
	it("giant output is explicitly capped and never sends raw terminal controls", () => {
		const renderer = createToolDisplayRenderers("read", () =>
			normalizeToolDisplayConfig({ enabled: true, readOutputMode: "summary" }),
		);
		const output = plain(render(renderer, "x\n".repeat(600_000)));
		expect(output).toContain("loaded 20001 lines");
	});
	it("keeps terminal instructions out of owned call/result/diff presentation without changing data", () => {
		const cfg = () => normalizeToolDisplayConfig({ enabled: true, readOutputMode: "preview" });
		const raw = "safe\x1b]0;unsafe-title\x07\x1b[2J text";
		const read = createToolDisplayRenderers("read", cfg);
		const args = { path: raw };
		const call = read.renderCall?.(args, theme, context(args)).render(80).join("\n") ?? "";
		const value = result(raw);
		const output =
			read
				.renderResult?.(value, { expanded: false, isPartial: false }, theme, context())
				.render(80)
				.join("\n") ?? "";
		for (const display of [call, output]) {
			expect(display).not.toContain("\x1b]0;");
			expect(display).not.toContain("\x1b[2J");
		}
		expect(args.path).toBe(raw);
		expect(value.content[0].text).toBe(raw);
		const edit = createToolDisplayRenderers("edit", cfg);
		const details = { diff: `+1|${raw}` };
		const edited =
			edit
				.renderResult?.(
					{ ...result("edited"), details },
					{ expanded: false, isPartial: false },
					theme,
					context({ path: "safe.txt" }),
				)
				.render(80)
				.join("\n") ?? "";
		expect(edited).not.toContain("\x1b]0;");
		expect(edited).not.toContain("\x1b[2J");
		expect(details.diff).toContain(raw);
	});
});
