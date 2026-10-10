import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	mergeConfig,
	migrateComponentSelections,
	saveEditorComponentPatch,
	saveToolDisplayComponentPatch,
} from "../extensions/zentui/config";
import { toolDisplayPresetPatch } from "../extensions/zentui/tool-display/presets";
import {
	DEFAULT_TOOL_DISPLAY_CONFIG,
	TOOL_DISPLAY_PRESETS,
} from "../extensions/zentui/tool-display/types";

function fixture(run: (path: string, dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), "zentui-tool-display-config-"));
	try {
		run(join(dir, "zentui.json"), dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
function raw(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

describe("Tool display owner configuration", () => {
	it("defaults disabled independently of historical surface gates", () => {
		for (const input of [
			{},
			{ features: { editor: true, statusLine: true } },
			{ features: { editor: false } },
		]) {
			expect(mergeConfig(input).components.toolDisplay).toEqual(DEFAULT_TOOL_DISPLAY_CONFIG);
		}
		expect(defaultConfig.components.toolDisplay).toEqual(DEFAULT_TOOL_DISPLAY_CONFIG);
	});
	it.each(TOOL_DISPLAY_PRESETS)("expands missing %s modes without enabling", (style) => {
		const config = mergeConfig({ components: { toolDisplay: { style } } });
		expect(config.components.toolDisplay).toMatchObject(toolDisplayPresetPatch(style));
		expect(config.components.toolDisplay.enabled).toBe(false);
	});
	it("clones ownership maps and preserves missing custom output inheritance", () => {
		const input = {
			components: { toolDisplay: { customToolOverrides: { mcp_example: { kind: "mcp" } } } },
		};
		const a = mergeConfig(input).components.toolDisplay;
		const b = mergeConfig(input).components.toolDisplay;
		a.registerToolOverrides.read = false;
		a.builtinRendererOverrides.bash = true;
		a.customToolOverrides.mcp_example.enabled = false;
		expect(b.registerToolOverrides.read).toBe(true);
		expect(b.builtinRendererOverrides).toEqual({});
		expect(b.customToolOverrides.mcp_example.enabled).toBe(true);
		expect(b.customToolOverrides.mcp_example).not.toHaveProperty("outputMode");
	});
	it.each(TOOL_DISPLAY_PRESETS)(
		"roundtrips %s enable/edit/disable/native without touching another config",
		(preset) =>
			fixture((path, dir) => {
				const external = join(dir, "pi-tool-display-config.json");
				const bytes = "{ malformed upstream config, preserve me }\n";
				writeFileSync(external, bytes);
				const original = {
					colors: { editorAccent: "blue" },
					features: { editor: false },
					footerFormat: "$cwd",
					components: {
						thinkingSteps: { enabled: true, mode: "rail" },
						userMessages: { enabled: false, future: 42 },
						editor: { enabled: false, styles: { minimalist: { formats: { topLeft: "$ci" } } } },
						toolDisplay: { future: { x: 1 }, colors: { futureRole: "cyan" } },
					},
					unknown: 9,
				};
				writeFileSync(path, JSON.stringify(original));
				let result = saveToolDisplayComponentPatch(
					{ ...toolDisplayPresetPatch(preset), enabled: true },
					path,
				);
				expect(result.components.toolDisplay).toMatchObject({
					...toolDisplayPresetPatch(preset),
					enabled: true,
				});
				result = saveToolDisplayComponentPatch(
					{ readOutputMode: "summary", previewLines: 7 },
					path,
				);
				expect(result.components.toolDisplay.previewLines).toBe(7);
				result = saveToolDisplayComponentPatch({ enabled: false }, path);
				expect(result.components.toolDisplay.enabled).toBe(false);
				expect(result.components.toolDisplay.previewLines).toBe(7);
				result = saveToolDisplayComponentPatch({ enabled: true, style: "native" }, path);
				expect(result.components.toolDisplay.style).toBe("native");
				const saved = raw(path);
				const { toolDisplay: _tool, ...owners } = saved.components;
				const { toolDisplay: _old, ...oldOwners } = original.components;
				expect(owners).toEqual(oldOwners);
				const { components: _components, ...top } = saved;
				const { components: _oldComponents, ...oldTop } = original;
				expect(top).toEqual(oldTop);
				expect(saved.components.toolDisplay.future).toEqual({ x: 1 });
				expect(saved.components.toolDisplay.colors).toEqual({ futureRole: "cyan" });
				expect(saved.components.toolDisplay).not.toHaveProperty("enableNativeUserMessageBox");
				expect(readFileSync(external, "utf8")).toBe(bytes);
			}),
	);
	it("clamps every numeric control consistently on save and load", () =>
		fixture((path) => {
			const config = saveToolDisplayComponentPatch(
				{
					previewLines: -5,
					bashCollapsedLines: 90,
					expandedPreviewMaxLines: 99999,
					diffSplitMinWidth: 1,
					diffCollapsedLines: 99999,
				},
				path,
			);
			expect(config.components.toolDisplay).toMatchObject({
				previewLines: 1,
				bashCollapsedLines: 80,
				expandedPreviewMaxLines: 20000,
				diffSplitMinWidth: 70,
				diffCollapsedLines: 240,
			});
			expect(mergeConfig(raw(path)).components.toolDisplay).toEqual(config.components.toolDisplay);
			expect(
				saveToolDisplayComponentPatch(
					{
						previewLines: Number.NaN,
						bashCollapsedLines: Number.POSITIVE_INFINITY,
						expandedPreviewMaxLines: -1,
						diffSplitMinWidth: 9999,
						diffCollapsedLines: 0,
					},
					path,
				).components.toolDisplay,
			).toMatchObject({
				previewLines: 8,
				bashCollapsedLines: 10,
				expandedPreviewMaxLines: 0,
				diffSplitMinWidth: 240,
				diffCollapsedLines: 4,
			});
		}));
	it("edits and resets exact-name advanced preferences without taking execution ownership", () =>
		fixture((path) => {
			let config = saveToolDisplayComponentPatch(
				{
					registerToolOverrides: { read: false },
					builtinRendererOverrides: { bash: true },
					customToolOverrides: {
						mcp_example: { enabled: true, kind: "mcp", overrideExistingRenderers: true },
						generic_example: { outputMode: "preview" },
					},
				},
				path,
			);
			expect(config.components.toolDisplay.enabled).toBe(false);
			expect(config.components.toolDisplay.registerToolOverrides.write).toBe(true);
			expect(raw(path).components.toolDisplay.customToolOverrides.mcp_example).not.toHaveProperty(
				"outputMode",
			);
			config = saveToolDisplayComponentPatch(
				{
					mcpOutputMode: "preview",
					customToolOverrides: {
						mcp_example: { outputMode: "hidden" },
						generic_example: { enabled: false },
					},
				},
				path,
			);
			expect(config.components.toolDisplay.customToolOverrides.mcp_example).toMatchObject({
				kind: "mcp",
				outputMode: "hidden",
				overrideExistingRenderers: true,
			});
			config = saveToolDisplayComponentPatch(
				{
					builtinRendererOverrides: { bash: null },
					customToolOverrides: {
						mcp_example: { outputMode: null },
						generic_example: null,
					},
				},
				path,
			);
			expect(config.components.toolDisplay.builtinRendererOverrides).toEqual({});
			expect(config.components.toolDisplay.customToolOverrides.mcp_example).not.toHaveProperty(
				"outputMode",
			);
			expect(raw(path).components.toolDisplay.customToolOverrides.mcp_example).not.toHaveProperty(
				"outputMode",
			);
			expect(raw(path).components.toolDisplay.customToolOverrides).not.toHaveProperty(
				"generic_example",
			);
		}));
	it("persists and resets only Bash renderer consent while dormant", () =>
		fixture((path) => {
			writeFileSync(
				path,
				JSON.stringify({
					components: {
						toolDisplay: { enabled: false, builtinRendererOverrides: { edit: true } },
						thinkingSteps: { enabled: true, mode: "rail" },
						userMessages: { enabled: false },
					},
				}),
			);
			const before = raw(path).components;
			let config = saveToolDisplayComponentPatch(
				{ builtinRendererOverrides: { bash: true } },
				path,
			);
			expect(config.components.toolDisplay.enabled).toBe(false);
			expect(raw(path).components.toolDisplay.builtinRendererOverrides).toEqual({
				edit: true,
				bash: true,
			});
			config = saveToolDisplayComponentPatch({ builtinRendererOverrides: { bash: null } }, path);
			expect(config.components.toolDisplay.builtinRendererOverrides).toEqual({ edit: true });
			expect(raw(path).components.toolDisplay.builtinRendererOverrides).toEqual({ edit: true });
			expect(raw(path).components.thinkingSteps).toEqual(before.thinkingSteps);
			expect(raw(path).components.userMessages).toEqual(before.userMessages);
		}));
	it("rejects reserved builtin/prototype and malformed advanced entries", () => {
		const input = JSON.parse(
			'{"customToolOverrides":{"read":true,"__proto__":true,"constructor":true,"bad":[],"ok":true},"builtinRendererOverrides":{"foreign":true},"registerToolOverrides":{"read":"yes"},"enableNativeUserMessageBox":true}',
		);
		const owner = mergeConfig({ components: { toolDisplay: input } }).components.toolDisplay;
		expect(Object.keys(owner.customToolOverrides)).toEqual(["ok"]);
		expect(owner.builtinRendererOverrides).toEqual({});
		expect(owner.registerToolOverrides.read).toBe(true);
		expect(owner).not.toHaveProperty("enableNativeUserMessageBox");
	});
	it("preserves Tool display raw bytes semantically when another owner saves", () =>
		fixture((path) => {
			const toolDisplay = {
				enabled: true,
				style: "future",
				previewLines: "future",
				customToolOverrides: { example: { kind: "mcp" } },
			};
			writeFileSync(path, JSON.stringify({ components: { toolDisplay } }));
			saveEditorComponentPatch({ modelLabel: "name" }, path);
			expect(raw(path).components.toolDisplay).toEqual(toolDisplay);
		}));
	it("includes Tool display in confirmed all-owner migration without freezing MCP inheritance", () =>
		fixture((path) => {
			writeFileSync(
				path,
				JSON.stringify({
					components: { toolDisplay: { customToolOverrides: { example: { kind: "mcp" } } } },
				}),
			);
			migrateComponentSelections(path);
			expect(raw(path).components.toolDisplay.enabled).toBe(false);
			expect(raw(path).components.toolDisplay.customToolOverrides.example).not.toHaveProperty(
				"outputMode",
			);
		}));
	it.each(["{ broken", "[]", "null"])("refuses corrupt JSON %s without rewriting bytes", (bytes) =>
		fixture((path) => {
			writeFileSync(path, bytes);
			expect(() => saveToolDisplayComponentPatch({ enabled: true }, path)).toThrow(
				"corrupt or unreadable",
			);
			expect(readFileSync(path, "utf8")).toBe(bytes);
		}),
	);
	it("refuses unreadable directory config without replacing it", () =>
		fixture((path) => {
			mkdirSync(path);
			const sentinel = join(path, "preserve.txt");
			writeFileSync(sentinel, "preserve");
			expect(() => saveToolDisplayComponentPatch({ enabled: true }, path)).toThrow(
				"corrupt or unreadable",
			);
			expect(readFileSync(sentinel, "utf8")).toBe("preserve");
		}));
});
