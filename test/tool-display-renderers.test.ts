import {
	createEditToolDefinition,
	createWriteToolDefinition,
	initTheme,
	type Theme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller.js";
import type { ToolRenderers } from "../extensions/zentui/tool-display/host-contract.js";
import { PendingPreimages } from "../extensions/zentui/tool-display/pending.js";
import { PresentationText } from "../extensions/zentui/tool-display/presentation-text.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	boundedComponent,
	createToolDisplayRenderers,
	hasOnlyTextContent,
	type ToolDisplayRenderContext,
} from "../extensions/zentui/tool-display/renderers.js";
import {
	boundedContentMetadata,
	MAX_PRESENTATION_SOURCE_BYTES,
	MAX_PREVIEW_LINE_CHARS,
} from "../extensions/zentui/tool-display/source-bounds.js";
import { getEditLineMetadata } from "../extensions/zentui/tool-display/tool-presentation.js";

import { toolRenderContextDefaults } from "./tool-display-context-fixture.js";

const theme = {
	fg: (_token: string, text: string) => `\x1b[36m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as Theme;
function context(args: Record<string, unknown> = {}): ToolDisplayRenderContext {
	return {
		...toolRenderContextDefaults,
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
		expect(plain(render(renderer, "one\n\ntwo\n"))).toBe(
			`\n↳ 2 ${unit} returned • Ctrl+O to expand`,
		);
		expect(plain(render(renderer, "one\ntwo", true))).toBe("\none\ntwo");
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
	it.each(["mcp", "generic"] as const)(
		"custom %s without outputMode summarizes despite global hidden mode at width 112",
		(kind) => {
			const name = kind === "mcp" ? "mcp__zentui_demo__echo" : "sandbox_echo";
			const args = { message: "hello from real local MCP server" };
			const lines = Array.from(
				{ length: 12 },
				(_, i) => `${i + 1}: hello from real local MCP server`,
			);
			const config = normalizeToolDisplayConfig({
				enabled: true,
				mcpOutputMode: "hidden",
				customToolOverrides: { [name]: { enabled: true, kind, overrideExistingRenderers: true } },
			});
			// Exercise both normalized entries and the public renderer's optional-mode fallback.
			for (const entry of [config.customToolOverrides[name], { enabled: true, kind }]) {
				const renderer = createToolDisplayRenderers(name, () => config, {}, entry);
				expect(plain(renderer.renderCall?.(args, theme, context(args)).render(112) ?? [])).toBe(
					kind === "mcp"
						? ' zentui_demo/echo [message="hello from real local MCP server"]'
						: 'sandbox_echo message="hello from real local MCP server"',
				);
				for (const expanded of [false, true]) {
					const rows =
						renderer
							.renderResult?.(
								result(lines.join("\n")),
								{ expanded, isPartial: false },
								theme,
								context(args),
							)
							.render(112) ?? [];
					expect(plain(rows)).toBe(
						kind === "mcp"
							? expanded
								? "\noutput:\n↳ 12 lines returned"
								: "• Ctrl+O to expand"
							: expanded
								? lines.join("\n")
								: "↳ 12 lines returned • Ctrl+O to expand",
					);
				}
			}
		},
	);
	it.each(["generic", "mcp"] as const)(
		"custom %s call inspects only own data properties",
		(kind) => {
			let reads = 0;
			const args = { message: "hello" };
			for (const key of ["boom", "server", "tool"])
				Object.defineProperty(args, key, {
					enumerable: true,
					get() {
						reads++;
						throw new Error("no getter reads");
					},
				});
			const renderer = createToolDisplayRenderers(
				"custom_gateway",
				() => normalizeToolDisplayConfig({ enabled: true }),
				{},
				{ enabled: true, kind },
			);
			expect(() => renderer.renderCall?.(args, theme, context(args)).render(80)).not.toThrow();
			expect(reads).toBe(0);
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
			'ide path="x"',
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
		).toBe(' demo/echo [tool="echo", server="demo"]');
		expect(plain(render(mcp, "one"))).toBe("• Ctrl+O to expand");
		expect(plain(render(mcp, "one", true))).toBe("\noutput:\none");
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
		expect(plain(render(renderer, "written", false, false, args))).toContain("↳ written");
	});
	it.each([false, true])(
		"renders call content as additions without a preimage (expanded=%s)",
		(expanded) => {
			const renderer = createToolDisplayRenderers("write", () =>
				normalizeToolDisplayConfig({ enabled: true, diffViewMode: "unified" }),
			);
			const args = { path: "history.txt", content: "written first\nwritten second\n" };
			const rows = plain(
				render(renderer, "result text must not be used as file content", expanded, false, args),
			);
			expect(rows).toContain("↳ written");
			expect(rows).toMatch(/▌\s+1 │ written first/);
			expect(rows).toMatch(/▌\s+2 │ written second/);
			expect(rows).not.toContain("created");
			expect(rows).not.toContain("overwritten");
			expect(rows).not.toContain("result text");
			expect(plain(render(renderer, "written", expanded))).toContain("content unavailable");
		},
	);
	it.each(["grep", "find", "ls"])("%s adds one separator only before visible results", (name) => {
		for (const expanded of [false, true]) {
			const renderer = createToolDisplayRenderers(name, () =>
				normalizeToolDisplayConfig({ enabled: true, searchOutputMode: "preview" }),
			);
			expect(plain(render(renderer, "first\nsecond", expanded))).toBe("\nfirst\nsecond");
			const hidden = createToolDisplayRenderers(name, () =>
				normalizeToolDisplayConfig({ enabled: true, searchOutputMode: "hidden" }),
			);
			expect(render(hidden, "first", expanded)).toEqual([]);
		}
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
		expect(plain(render(write, "written", false, false, args))).toContain("↳ written");
	});
	it("giant output is explicitly capped and never sends raw terminal controls", () => {
		const renderer = createToolDisplayRenderers("read", () =>
			normalizeToolDisplayConfig({ enabled: true, readOutputMode: "summary" }),
		);
		const output = plain(render(renderer, "x\n".repeat(600_000)));
		expect(output).toContain("loaded 20000 lines");
		expect(output).toContain("input capped");
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
	it.each(["new-many-lines", "overwrite-many-lines", "control-unused-content", "unicode-boundary"])(
		"bounds full production write ingress for %s before normalization/count allocation",
		(kind) => {
			initTheme("dark", false);
			const content =
				kind === "unicode-boundary"
					? `${"a".repeat(MAX_PREVIEW_LINE_CHARS - 1)}🧪tail`
					: kind === "control-unused-content"
						? "\x1b]0;payload-title\x07x\n".repeat(100000)
						: "x\n".repeat(700000);
			const args = Object.freeze({ path: "safe.ts", content });
			const value = Object.freeze({
				content: [{ type: "text", text: "written" }],
				details: {},
				isError: false,
			});
			const pending = new PendingPreimages();
			vi.spyOn(pending, "get").mockReturnValue({
				exists: kind.startsWith("overwrite"),
				content: kind.startsWith("overwrite") ? "old\n" : "",
			});
			const native = createWriteToolDefinition("/sandbox");
			const execute = native.execute;
			const parameters = native.parameters;
			const highlight = vi.fn((text: string) => text);
			const cfg = () => normalizeToolDisplayConfig({ enabled: true, diffViewMode: "split" });
			const controller = createToolDisplayController(
				{
					getAllTools: () => [
						{ name: "write", sourceInfo: { source: "builtin", path: "builtin:write" } },
					],
				},
				cfg,
				{
					nativeRenderers: { write: native as unknown as ToolRenderers },
					pending,
					highlighter: highlight,
				},
			);
			const rawReplace = String.prototype.replace;
			const rawSplit = String.prototype.split;
			const rawByteLength = Buffer.byteLength;
			const unbounded: string[] = [];
			const replace = vi.spyOn(String.prototype, "replace").mockImplementation(function (
				this: string,
				...call: Parameters<typeof String.prototype.replace>
			) {
				if (this.length > MAX_PRESENTATION_SOURCE_BYTES) unbounded.push("replace");
				return Reflect.apply(rawReplace, this, call);
			});
			const split = vi.spyOn(String.prototype, "split").mockImplementation(function (
				this: string,
				...call: Parameters<typeof String.prototype.split>
			) {
				if (this.length > MAX_PREVIEW_LINE_CHARS) unbounded.push("split");
				return Reflect.apply(rawSplit, this, call);
			});
			const bytes = vi.spyOn(Buffer, "byteLength").mockImplementation((input, ...other) => {
				if (typeof input === "string" && input.length > MAX_PRESENTATION_SOURCE_BYTES)
					unbounded.push("byteLength");
				return Reflect.apply(rawByteLength, Buffer, [input, ...other]);
			});
			try {
				const row = new ToolExecutionComponent(
					"write",
					"ingress",
					args,
					{ showImages: false },
					controller.resolver("write", () => native as unknown as ToolRenderers),
					{ requestRender() {} } as unknown as TUI,
					"/sandbox",
				);
				row.setArgsComplete();
				row.updateResult(value, true);
				const partial = row.render(110);
				row.markExecutionStarted();
				row.updateResult(value, false);
				row.setExpanded(true);
				const final = row.render(110);
				expect(unbounded).toEqual([]);
				expect(highlight).not.toHaveBeenCalled();
				expect(plain(partial)).toContain("preview capped");
				expect(plain(partial)).toContain("≥");
				expect(plain(partial)).toContain("Preview omitted");
				expect(plain(final)).toContain("bounded input limit");
				for (const display of [...partial, ...final]) {
					expect(visibleWidth(display)).toBeLessThanOrEqual(110);
					expect(Buffer.from(display, "utf8").toString("utf8")).toBe(display);
					expect(display).not.toContain("\x1b]0;");
				}
				expect(args.content).toBe(content);
				expect(value.content[0].text).toBe("written");
				expect(native.execute).toBe(execute);
				expect(native.parameters).toBe(parameters);
			} finally {
				replace.mockRestore();
				split.mockRestore();
				bytes.mockRestore();
				controller.dispose();
			}
		},
	);
	it("counts ordinary write metadata exactly with no line array, and bounded metadata as lower bounds", () => {
		for (const content of ["", "\r", "a", "a\n", "a\n\n", "a\r\nb", "界🧪\n"]) {
			const normalized = content.replace(/\r/g, "");
			const expected = content ? normalized.split("\n") : [];
			if (expected.at(-1) === "") expected.pop();
			expect(boundedContentMetadata(content)).toEqual({
				lineCount: expected.length,
				sizeBytes: Buffer.byteLength(content, "utf8"),
				capped: false,
			});
		}
		const capped = boundedContentMetadata("x\n".repeat(700000));
		expect(capped.capped).toBe(true);
		expect(capped.lineCount).toBeLessThanOrEqual(4000);
		expect(capped.sizeBytes).toBeLessThanOrEqual(MAX_PRESENTATION_SOURCE_BYTES);
	});
	it("bounds the adjacent edit header/partial count and leaves unused payload strings unsanitized", () => {
		initTheme("dark", false);
		const oldText = "\x1b]0;unused-title\x07".repeat(90000);
		const newText = "new\n".repeat(600000);
		const args = Object.freeze({ path: "safe.ts", oldText, newText });
		const native = createEditToolDefinition("/sandbox") as unknown as ToolRenderers;
		const cfg = () => normalizeToolDisplayConfig({ enabled: true });
		const controller = createToolDisplayController(
			{
				getAllTools: () => [
					{ name: "edit", sourceInfo: { source: "builtin", path: "builtin:edit" } },
				],
			},
			cfg,
			{ nativeRenderers: { edit: native } },
		);
		const original = String.prototype.replace;
		const violations: string[] = [];
		const spy = vi.spyOn(String.prototype, "replace").mockImplementation(function (
			this: string,
			...call: Parameters<typeof String.prototype.replace>
		) {
			if (this.length > MAX_PRESENTATION_SOURCE_BYTES) violations.push("replace");
			return Reflect.apply(original, this, call);
		});
		try {
			const row = new ToolExecutionComponent(
				"edit",
				"ingress-edit",
				args,
				{ showImages: false },
				controller.resolver("edit", () => native),
				{ requestRender() {} } as unknown as TUI,
				"/sandbox",
			);
			row.setArgsComplete();
			row.updateResult(
				{ content: [{ type: "text", text: "editing" }], details: {}, isError: false },
				true,
			);
			expect(plain(row.render(110))).toContain("preview capped");
			expect(violations).toEqual([]);
			row.updateResult(
				{
					content: [{ type: "text", text: "edited" }],
					details: { diff: "-1|old\n+1|new" },
					isError: false,
				},
				false,
			);
			expect(plain(row.render(110))).toContain("diff");
			expect(violations).toEqual([]);
			expect(args.oldText).toBe(oldText);
			expect(args.newText).toBe(newText);
		} finally {
			spy.mockRestore();
			controller.dispose();
		}
	});
	it.each([
		["", 0],
		["\r", 1],
		["\r\r\r", 1],
		["\n", 2],
		["\r\n", 2],
		["x\r\n", 2],
	] as const)(
		"preserves original upstream edit metadata for %j without a zero-count correction",
		(raw, count) => {
			initTheme("dark", false);
			expect(boundedContentMetadata(raw, true)).toEqual({
				lineCount: count,
				sizeBytes: Buffer.byteLength(raw),
				capped: false,
			});
			for (const shape of ["newText", "lines", "multi-edit"]) {
				const payload =
					shape === "multi-edit"
						? {
								edits: [
									{ oldText: "old", newText: raw },
									{ oldText: "old", lines: raw },
								],
							}
						: shape === "lines"
							? { lines: raw }
							: { oldText: "old", newText: raw };
				const args = Object.freeze({ path: "metadata.txt", ...payload });
				const expected = shape === "multi-edit" ? 2 * count : count;
				expect(getEditLineMetadata(args).lineCount).toBe(expected);
				const native = createEditToolDefinition("/sandbox") as unknown as ToolRenderers;
				const controller = createToolDisplayController(
					{
						getAllTools: () => [
							{ name: "edit", sourceInfo: { source: "builtin", path: "builtin:edit" } },
						],
					},
					() => normalizeToolDisplayConfig({ enabled: true }),
					{ nativeRenderers: { edit: native } },
				);
				const row = new ToolExecutionComponent(
					"edit",
					`metadata-${shape}`,
					args,
					{ showImages: false },
					controller.resolver("edit", () => native),
					{ requestRender() {} } as unknown as TUI,
					"/sandbox",
				);
				row.updateResult(
					{ content: [{ type: "text", text: "editing" }], details: {}, isError: false },
					true,
				);
				const output = plain(row.render(110));
				expect(output).toContain(`metadata.txt (${expected} ${expected === 1 ? "line" : "lines"})`);
				expect(output).toContain(`editing... (${expected} ${expected === 1 ? "line" : "lines"})`);
				controller.dispose();
			}
		},
	);
	it.each([
		[
			"mcp__zentui_demo__echo",
			{ message: "hello from real local MCP server" },
			' zentui_demo/echo [message="hello from real local MCP server"]',
		],
		[
			"mcp__demo_prod__echo",
			{ message: "sanitized name" },
			' demo_prod/echo [message="sanitized name"]',
		],
		[
			"mcp",
			{ tool: "echo", server: "demo", message: "proxy" },
			' call demo:echo [message="proxy"]',
		],
		[
			"custom_mcp_gateway",
			{ tool: "echo", server: "demo", message: "gateway" },
			' call demo:echo [message="gateway"]',
		],
	] as const)(
		"uses the correct direct versus proxy MCP extension presentation for %s",
		(name, args, expected) => {
			initTheme("dark", false);
			const cfg = () =>
				normalizeToolDisplayConfig({
					enabled: true,
					customToolOverrides: {
						[name]: {
							enabled: true,
							kind: "mcp",
							outputMode: "preview",
							overrideExistingRenderers: true,
						},
					},
				});
			const api = { getAllTools: () => [{ name }] };
			Object.defineProperty(api, "getToolDefinition", {
				get() {
					throw new Error("Private tool-definition access is forbidden");
				},
			});
			const predecessor: ToolRenderers = {};
			Object.defineProperty(predecessor, "label", {
				get() {
					throw new Error("Undocumented predecessor label access is forbidden");
				},
			});
			const controller = createToolDisplayController(api, cfg, { nativeRenderers: {} });
			const row = new ToolExecutionComponent(
				name,
				"mcp-domain",
				args,
				{ showImages: false },
				controller.resolver(name, () => predecessor),
				{ requestRender() {} } as unknown as TUI,
				"/sandbox",
			);
			row.updateResult({
				content: [{ type: "text", text: "response" }],
				details: {},
				isError: false,
			});
			expect(plain(row.render(110))).toContain(expected);
			expect(plain(row.render(110))).not.toContain("response");
			row.setExpanded(true);
			expect(plain(row.render(110))).toContain(expected);
			expect(plain(row.render(110))).toContain("output:\n response");
			controller.dispose();
		},
	);
	it("keeps explicit sandbox_echo result previews unchanged while showing inline call arguments", () => {
		initTheme("dark", false);
		const name = "sandbox_echo";
		const cfg = () =>
			normalizeToolDisplayConfig({
				enabled: true,
				customToolOverrides: {
					[name]: {
						enabled: true,
						kind: "generic",
						outputMode: "preview",
						overrideExistingRenderers: true,
					},
				},
			});
		const controller = createToolDisplayController({}, cfg, { nativeRenderers: {} });
		const args = { message: "hello from real custom tool" };
		const content = Array.from(
			{ length: 12 },
			(_, index) => `custom ${index + 1}: ${args.message}`,
		).join("\n");
		const row = new ToolExecutionComponent(
			name,
			"custom-domain",
			args,
			{ showImages: false },
			controller.resolver(name, () => ({})),
			{ requestRender() {} } as unknown as TUI,
			"/sandbox",
		);
		row.updateResult({ content: [{ type: "text", text: content }], details: {}, isError: false });
		expect(plain(row.render(110))).toContain('sandbox_echo message="hello from real custom tool"');
		expect(plain(row.render(110))).toContain("... (4 more lines • Ctrl+O to expand)");
		row.setExpanded(true);
		const output = plain(row.render(110));
		for (let index = 0; index < 12; index++)
			expect(output).toContain(`custom ${index + 1}: ${args.message}`);
		controller.dispose();
	});
});

describe("tool-display/renderers boundedComponent", () => {
	it("passes PresentationText rows through without a per-frame truncation map", () => {
		const text = new PresentationText("x".repeat(500), 0, 0);
		const rows = boundedComponent(text, 20).render(120);
		expect(rows).toEqual(text.render(120));
		for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(120);
	});
	it("still truncates and caps any other component", () => {
		const stub = { invalidate() {}, render: () => ["x".repeat(500)] };
		const rows = boundedComponent(stub, 20).render(120);
		expect(rows).toHaveLength(1);
		expect(visibleWidth(rows[0])).toBe(120);
		expect(rows[0].replace(/\x1b\[[0-9;]*m/g, "")).toBe("x".repeat(120));
	});
	it("keeps PresentationText's own row cap and omission note", () => {
		const rows = boundedComponent(new PresentationText("x\n".repeat(20_001), 0, 0), 3).render(80);
		expect(rows).toHaveLength(4);
		expect(rows[3].replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).toBe("… (preview output omitted)");
	});
});
