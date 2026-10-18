import {
	createBashToolDefinition,
	createReadToolDefinition,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createBashProgress } from "../extensions/zentui/tool-display/bash-display.js";
import {
	createToolDisplayController,
	type ToolDisplayRendererAPI,
} from "../extensions/zentui/tool-display/controller.js";
import type {
	ToolRendererResolver,
	ToolRenderers,
} from "../extensions/zentui/tool-display/host-contract.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import type { ToolDisplayRenderContext } from "../extensions/zentui/tool-display/renderers.js";

import { toolRenderContextDefaults } from "./tool-display-context-fixture.js";

const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text } as Theme;
const ctx: ToolDisplayRenderContext = {
	...toolRenderContextDefaults,
	args: { path: "f" },
	toolCallId: "id",
	cwd: "/sandbox",
	state: {},
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
	lastComponent: undefined,
	invalidate() {},
};
const predecessor: ToolRenderers = {
	renderCall: vi.fn(() => ({
		invalidate() {},
		render() {
			return ["predecessor call"];
		},
	})),
	renderResult: vi.fn(() => ({
		invalidate() {},
		render() {
			return ["predecessor result"];
		},
	})),
	renderShell: "self",
};
const readDefinition = createReadToolDefinition("/sandbox");
const nativeRead = readDefinition as unknown as ToolRenderers;
function setup(
	raw: unknown = { enabled: true },
	source = "builtin",
	identities: { read?: ToolRenderers } = { read: nativeRead },
) {
	let config = normalizeToolDisplayConfig(raw);
	const api = {
		registerToolRenderer: vi.fn<(resolver: ToolRendererResolver) => void>(),
		getAllTools: vi.fn(() =>
			["read", "bash"].map((name) => ({ name, sourceInfo: { source, path: `${source}:${name}` } })),
		),
	};
	const controller = createToolDisplayController(api, () => config, {
		nativeRenderers: identities,
	});
	return {
		controller,
		api,
		update: (raw: unknown) => {
			config = normalizeToolDisplayConfig(raw);
		},
	};
}
const textResult = { content: [{ type: "text" as const, text: "one\ntwo" }], details: undefined };
const options = { expanded: false, isPartial: false };
describe("tool-display/controller (public resolver only)", () => {
	it("disabled/native/config-only preferences delegate exactly without touching registrations", () => {
		for (const raw of [
			{ enabled: false, style: "verbose" },
			{ enabled: true, style: "native" },
		]) {
			const { controller } = setup(raw);
			const next = vi.fn(() => predecessor);
			expect(controller.resolver("read", next)).toBe(predecessor);
			expect(next).toHaveBeenCalledOnce();
		}
	});
	it("auto acquires only public stable renderer identity plus exact native provenance", () => {
		const { controller } = setup({ enabled: true, readOutputMode: "summary" });
		expect(controller.resolver("read", () => nativeRead)).not.toBe(nativeRead);
		expect(controller.resolver("read", () => predecessor)).toBe(predecessor);
		const partialForeign = { ...nativeRead, renderResult: predecessor.renderResult };
		expect(controller.resolver("read", () => partialForeign)).toBe(partialForeign);
		const foreign = setup({ enabled: true, builtinRendererOverrides: { read: true } }, "extension");
		expect(foreign.controller.resolver("read", () => predecessor)).toBe(predecessor);
		const unknown = setup({ enabled: true, builtinRendererOverrides: { read: true } }, "unknown");
		expect(unknown.controller.resolver("read", () => predecessor)).toBe(predecessor);
	});
	it("Bash native closures are ambiguous; consent replaces rendering only and disable restores next", () => {
		const first = createBashToolDefinition("/sandbox");
		const second = createBashToolDefinition("/sandbox");
		expect(first.renderCall).not.toBe(second.renderCall);
		const { controller, update } = setup({ enabled: true });
		expect(controller.resolver("bash", () => predecessor)).toBe(predecessor);
		expect(controller.status().bashRequiresOverride).toBe(true);
		update({ enabled: true, builtinRendererOverrides: { bash: true }, bashOutputMode: "summary" });
		const owned = controller.resolver("bash", () => predecessor);
		expect(owned).not.toBe(predecessor);
		expect(owned?.renderShell).toBe("default");
		expect(
			owned
				?.renderResult?.(textResult, options, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["↳ 2 lines returned • Ctrl+O to expand"]);
		update({ enabled: false, builtinRendererOverrides: { bash: true } });
		expect(controller.resolver("bash", () => predecessor)).toBe(predecessor);
		expect(
			owned
				?.renderResult?.(textResult, options, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["predecessor result"]);
	});
	it("foreign definitions are skipped even when advanced rendering consent is true", () => {
		const { controller } = setup(
			{ enabled: true, builtinRendererOverrides: { read: true, bash: true } },
			"package",
		);
		for (const name of ["read", "bash"])
			expect(controller.resolver(name, () => predecessor)).toBe(predecessor);
	});
	it("never mutates execute/parameters/prompt identity or delegates execution through wrappers", () => {
		const execute = vi.fn(readDefinition.execute);
		const original = { ...readDefinition, execute };
		const snapshot = {
			execute,
			parameters: original.parameters,
			promptSnippet: original.promptSnippet,
			promptGuidelines: original.promptGuidelines,
			description: original.description,
			prepareArguments: original.prepareArguments,
		};
		const { controller } = setup({ enabled: true, readOutputMode: "summary" });
		const owned = controller.resolver("read", () => original as unknown as ToolRenderers);
		expect(owned && Object.keys(owned).sort()).toEqual([
			"renderCall",
			"renderResult",
			"renderShell",
		]);
		owned
			?.renderCall?.({ path: "f" }, theme, ctx)
			.render(80)
			.map((line) => line.trimEnd());
		owned
			?.renderResult?.(textResult, options, theme, ctx)
			.render(80)
			.map((line) => line.trimEnd());
		for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[])
			expect(original[key]).toBe(snapshot[key]);
		expect(execute).not.toHaveBeenCalled();
	});
	it("exact-name custom/MCP fills renderless tools but respects existing ownership until explicit consent", () => {
		const { controller, update } = setup({
			enabled: true,
			customToolOverrides: {
				late: true,
				mcp__demo__echo: { enabled: true, kind: "mcp", outputMode: "preview" },
			},
		});
		expect(controller.resolver("unrelated", () => undefined)).toBeUndefined();
		expect(controller.resolver("late", () => undefined)?.renderCall).toBeTypeOf("function");
		expect(controller.resolver("late", () => predecessor)).toBe(predecessor);
		expect(controller.resolver("mcp__demo__echo", () => predecessor)).toBe(predecessor);
		update({
			enabled: true,
			customToolOverrides: {
				mcp__demo__echo: {
					enabled: true,
					kind: "mcp",
					outputMode: "preview",
					overrideExistingRenderers: true,
				},
			},
		});
		const owned = controller.resolver("mcp__demo__echo", () => predecessor);
		expect(
			owned
				?.renderCall?.({}, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual([" demo/echo (no args)"]);
		expect(
			owned
				?.renderResult?.(textResult, options, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["• Ctrl+O to expand"]);
	});
	it("supports late tools/config getter changes, per-builtin flags, neutral idempotent release", () => {
		const { controller, update, api } = setup({ enabled: true, readOutputMode: "summary" });
		controller.install();
		controller.install();
		expect(api.registerToolRenderer).toHaveBeenCalledOnce();
		const owned = controller.resolver("read", () => nativeRead);
		expect(
			owned
				?.renderResult?.(textResult, options, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["↳ loaded 2 lines • Ctrl+O to expand"]);
		update({ enabled: true, readOutputMode: "preview" });
		expect(
			owned
				?.renderResult?.(textResult, options, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["one", "two"]);
		update({ enabled: true, registerToolOverrides: { read: false } });
		expect(controller.resolver("read", () => nativeRead)).toBe(nativeRead);
		update({ enabled: true });
		controller.dispose();
		controller.dispose();
		controller.install();
		expect(api.registerToolRenderer).toHaveBeenCalledOnce();
		expect(controller.resolver("read", () => nativeRead)).toBe(nativeRead);
	});
	it.each([
		{ content: [] },
		{ content: [{ type: "text", text: "" }] },
		{ content: [{ type: "image", data: "base64", mimeType: "image/png" }] },
		{
			content: [
				{ type: "text", text: "caption" },
				{ type: "image", data: "base64", mimeType: "image/png" },
			],
		},
	])("released rows pass exact empty/image/mixed results to predecessor", ({ content }) => {
		const { controller, update } = setup({
			enabled: true,
			builtinRendererOverrides: { read: true },
		});
		const result = { content, details: { unknown: true } } as Parameters<
			NonNullable<ToolRenderers["renderResult"]>
		>[0];
		const owned = controller.resolver("read", () => predecessor);
		update({ enabled: false });
		expect(
			owned
				?.renderResult?.(result, options, theme, ctx)
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["predecessor result"]);
		expect(predecessor.renderResult).toHaveBeenLastCalledWith(result, options, theme, ctx);
	});
	it("capability failures stay native without re-registering tools", () => {
		for (const api of [
			{},
			{
				registerToolRenderer() {
					throw new Error("unsupported");
				},
			},
			{
				registerToolRenderer() {},
				getAllTools() {
					throw new Error("not bound");
				},
			},
		] as ToolDisplayRendererAPI[]) {
			const controller = createToolDisplayController(
				api,
				() => normalizeToolDisplayConfig({ enabled: true }),
				{ nativeRenderers: { read: nativeRead } },
			);
			controller.install();
			expect(controller.resolver("read", () => nativeRead)).toBe(nativeRead);
		}
	});
	it("custom MCP defaults stay summary across global changes; explicit overrides and reset roundtrip", () => {
		const entry = { enabled: true, kind: "mcp", overrideExistingRenderers: true };
		const { controller, update } = setup({
			enabled: true,
			mcpOutputMode: "summary",
			customToolOverrides: { demo: entry },
		});
		const owned = controller.resolver("demo", () => predecessor);
		const output = owned?.renderResult?.(textResult, { ...options, expanded: true }, theme, {
			...ctx,
			expanded: true,
		});
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual([
			"",
			"output:",
			"↳ 2 lines returned",
		]);
		update({ enabled: true, mcpOutputMode: "preview", customToolOverrides: { demo: entry } });
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual([
			"",
			"output:",
			"↳ 2 lines returned",
		]);
		update({
			enabled: true,
			mcpOutputMode: "hidden",
			customToolOverrides: { demo: { ...entry, outputMode: "preview" } },
		});
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual(["", "output:", "one", "two"]);
		const persisted = JSON.parse(
			JSON.stringify(
				normalizeToolDisplayConfig({
					enabled: true,
					mcpOutputMode: "hidden",
					customToolOverrides: { demo: entry },
				}),
			),
		);
		expect(persisted.customToolOverrides.demo.outputMode).toBe("summary");
		update(persisted);
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual([
			"",
			"output:",
			"↳ 2 lines returned",
		]);
		update({
			...persisted,
			mcpOutputMode: "preview",
			customToolOverrides: { demo: { ...entry, outputMode: "invalid" } },
		});
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual([
			"",
			"output:",
			"↳ 2 lines returned",
		]);
	});
	it("late foreign resolver precedence and foreign definitions release already acquired rendering", () => {
		const { controller, api } = setup({ enabled: true, readOutputMode: "summary" });
		let downstream: ToolRenderers = nativeRead;
		const owned = controller.resolver("read", () => downstream);
		const output = owned?.renderResult?.(textResult, options, theme, ctx);
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual([
			"↳ loaded 2 lines • Ctrl+O to expand",
		]);
		downstream = predecessor;
		expect(output?.render(80).map((line) => line.trimEnd())).toEqual([
			"↳ loaded 2 lines • Ctrl+O to expand",
		]);
		expect(
			owned
				?.renderResult?.(textResult, options, theme, { ...ctx, lastComponent: output })
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["predecessor result"]);
		downstream = nativeRead;
		api.getAllTools.mockReturnValue([
			{ name: "read", sourceInfo: { source: "package", path: "/foreign" } },
		]);
		expect(controller.resolver("read", () => nativeRead)).toBe(nativeRead);
	});
	it("row-local release keeps predecessor partial/final cleanup after re-enable, without claiming later rows", () => {
		vi.useFakeTimers();
		try {
			const timers = new WeakMap<object, ReturnType<typeof setInterval>>();
			const native: ToolRenderers = {
				renderCall: predecessor.renderCall,
				renderResult: vi.fn((_result, renderOptions, _theme, context) => {
					const key = context.state as object;
					if (renderOptions.isPartial && !timers.has(key))
						timers.set(
							key,
							setInterval(() => {}, 1000),
						);
					if (!renderOptions.isPartial && timers.has(key)) {
						clearInterval(timers.get(key));
						timers.delete(key);
					}
					return {
						invalidate() {},
						render() {
							return ["native result"];
						},
					};
				}),
			};
			const { controller, update } = setup({
				enabled: true,
				builtinRendererOverrides: { bash: true },
				bashOutputMode: "summary",
			});
			const owned = controller.resolver("bash", () => native);
			const first = { ...ctx, state: {}, args: { command: "echo harmless" } };
			update({ enabled: false, builtinRendererOverrides: { bash: true } });
			expect(
				owned
					?.renderResult?.(textResult, { ...options, isPartial: true }, theme, first)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["native result"]);
			expect(vi.getTimerCount()).toBe(1);
			update({
				enabled: true,
				builtinRendererOverrides: { bash: true },
				bashOutputMode: "summary",
			});
			expect(
				owned
					?.renderCall?.(first.args, theme, first)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["predecessor call"]);
			expect(
				owned
					?.renderResult?.(textResult, options, theme, first)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["native result"]);
			expect(vi.getTimerCount()).toBe(0);
			const second = { ...first, toolCallId: "second", state: {} };
			expect(
				owned
					?.renderResult?.(textResult, options, theme, second)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["↳ 2 lines returned • Ctrl+O to expand"]);
		} finally {
			vi.useRealTimers();
		}
	});
	it.each(["mixed", "image", "foreign", "per-tool", "native", "failure"])(
		"%s fallback latches only that public row state across call/result",
		(reason) => {
			const { controller, update } = setup({
				enabled: true,
				readOutputMode: "summary",
				builtinRendererOverrides: { read: true },
			});
			let downstream: ToolRenderers = predecessor;
			const owned = controller.resolver("read", () => downstream);
			const row = { ...ctx, state: {} };
			let localTheme = theme;
			let content = textResult;
			if (reason === "mixed" || reason === "image")
				content = {
					...textResult,
					content:
						reason === "image"
							? [{ type: "image", data: "x", mimeType: "image/png" }]
							: [...textResult.content, { type: "image", data: "x", mimeType: "image/png" }],
				} as unknown as typeof textResult;
			if (reason === "mixed" || reason === "image") update({ enabled: false });
			if (reason === "foreign") {
				update({ enabled: true, readOutputMode: "summary" });
				downstream = predecessor;
			}
			if (reason === "per-tool") update({ enabled: true, registerToolOverrides: { read: false } });
			if (reason === "native") update({ enabled: true, style: "native" });
			if (reason === "failure")
				localTheme = {
					fg() {
						throw new Error("renderer unavailable");
					},
					bold: (s: string) => s,
				} as unknown as Theme;
			expect(
				owned
					?.renderResult?.(content, options, localTheme, row)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["predecessor result"]);
			update({
				enabled: true,
				readOutputMode: "summary",
				builtinRendererOverrides: { read: true },
			});
			expect(
				owned
					?.renderCall?.(ctx.args, theme, row)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["predecessor call"]);
			expect(
				owned
					?.renderResult?.(textResult, options, theme, row)
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["predecessor result"]);
			expect(
				owned
					?.renderResult?.(textResult, options, theme, { ...row, state: {}, toolCallId: "fresh" })
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["↳ loaded 2 lines • Ctrl+O to expand"]);
		},
	);
	it("missing public row identity fails open rather than storing an unbounded ID map", () => {
		const { controller } = setup({ enabled: true, builtinRendererOverrides: { read: true } });
		const owned = controller.resolver("read", () => predecessor);
		expect(
			owned
				?.renderResult?.(textResult, options, theme, { ...ctx, state: undefined })
				.render(80)
				.map((line) => line.trimEnd()),
		).toEqual(["predecessor result"]);
	});
	it("paints through the retained slot without content inspection and follows live config", () => {
		let config = normalizeToolDisplayConfig({ enabled: true, readOutputMode: "summary" });
		let configReads = 0;
		const api = {
			registerToolRenderer: vi.fn<(resolver: ToolRendererResolver) => void>(),
			getAllTools: vi.fn(() => [
				{ name: "read", sourceInfo: { source: "builtin", path: "builtin:read" } },
			]),
		};
		const controller = createToolDisplayController(
			api,
			() => {
				configReads++;
				return config;
			},
			{ nativeRenderers: { read: nativeRead } },
		);
		const owned = controller.resolver("read", () => nativeRead);
		const row = { ...ctx, state: {}, toolCallId: "paint" };
		const component = owned?.renderResult?.(textResult, options, theme, row);
		const first = component?.render(80);
		expect(first?.map((line) => line.trimEnd())).toEqual(["↳ loaded 2 lines • Ctrl+O to expand"]);
		const reads = configReads;
		const lookups = api.getAllTools.mock.calls.length;
		expect(lookups).toBeGreaterThan(0);
		for (let paint = 0; paint < 5; paint++) expect(component?.render(80)).toEqual(first);
		// Paint reads the config identity only; it never inspects row content.
		expect(configReads).toBe(reads + 5);
		expect(api.getAllTools.mock.calls.length).toBe(lookups);
		// A live config edit reaches the existing row on its next paint, without a rebuild signal.
		config = normalizeToolDisplayConfig({ enabled: true, readOutputMode: "preview" });
		expect(component?.render(80)?.map((line) => line.trimEnd())).toEqual(["one", "two"]);
		const rebuilt = api.getAllTools.mock.calls.length;
		expect(rebuilt).toBeGreaterThan(lookups);
		expect(component?.render(80)?.map((line) => line.trimEnd())).toEqual(["one", "two"]);
		expect(api.getAllTools.mock.calls.length).toBe(rebuilt);
		// Painting stays free of content inspection even across a host invalidate.
		component?.invalidate();
		expect(component?.render(80)?.map((line) => line.trimEnd())).toEqual(["one", "two"]);
		const afterInvalidate = api.getAllTools.mock.calls.length;
		for (let paint = 0; paint < 3; paint++)
			expect(component?.render(80)?.map((line) => line.trimEnd())).toEqual(["one", "two"]);
		expect(api.getAllTools.mock.calls.length).toBe(afterInvalidate);
	});
	it("bounds upstream-style Bash progress and releases only owned timers without needing paint", () => {
		vi.useFakeTimers();
		try {
			const progress = createBashProgress();
			for (let i = 0; i < 30; i++)
				progress.renderCall({ command: "printf harmless" }, theme, {
					...ctx,
					toolCallId: `live-${i}`,
					state: {},
					isPartial: true,
				});
			expect(vi.getTimerCount()).toBe(16);
			progress.release({ ...ctx, toolCallId: "live-29" });
			expect(vi.getTimerCount()).toBe(15);
			progress.dispose();
			progress.dispose();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
