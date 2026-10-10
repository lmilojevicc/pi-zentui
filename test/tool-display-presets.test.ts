import { describe, expect, it } from "vitest";
import {
	normalizeToolDisplayConfig,
	toolDisplayPresetPatch,
} from "../extensions/zentui/tool-display/presets.js";
import { DEFAULT_TOOL_DISPLAY_CONFIG } from "../extensions/zentui/tool-display/types.js";

describe("tool-display/presets", () => {
	it("defaults disabled with independent ownership and no unrelated surfaces", () => {
		expect(normalizeToolDisplayConfig(undefined)).toEqual(DEFAULT_TOOL_DISPLAY_CONFIG);
		expect(DEFAULT_TOOL_DISPLAY_CONFIG).not.toHaveProperty("enableNativeUserMessageBox");
		expect(DEFAULT_TOOL_DISPLAY_CONFIG).not.toHaveProperty("thinkingSteps");
		expect(DEFAULT_TOOL_DISPLAY_CONFIG.builtinRendererOverrides).toEqual({});
	});
	it.each(["opencode", "balanced", "verbose"] as const)(
		"expands %s modes without changing enablement or ownership",
		(style) => {
			const patch = toolDisplayPresetPatch(style);
			expect(patch).not.toHaveProperty("enabled");
			expect(patch).not.toHaveProperty("registerToolOverrides");
			expect(patch).not.toHaveProperty("customToolOverrides");
			const config = normalizeToolDisplayConfig({ style });
			expect(config).toMatchObject(patch);
			expect(config.enabled).toBe(false);
		},
	);
	it("clamps finite limits, rejects invalid modes and keeps exact-name overrides safe", () => {
		const config = normalizeToolDisplayConfig({
			enabled: true,
			style: "verbose",
			previewLines: -9,
			diffSplitMinWidth: Infinity,
			diffCollapsedLines: 1e8,
			readOutputMode: "wrong",
			registerToolOverrides: { read: false, bash: "true" },
			builtinRendererOverrides: { bash: true, read: false, unknown: true },
			customToolOverrides: {
				read: true,
				ide: true,
				mcp__demo__echo: { kind: "mcp", outputMode: "preview", overrideExistingRenderers: true },
				unowned: { kind: "generic", enabled: false },
			},
		});
		expect(config.enabled).toBe(true);
		expect(config.previewLines).toBe(1);
		expect(config.diffSplitMinWidth).toBe(120);
		expect(config.diffCollapsedLines).toBe(240);
		expect(config.readOutputMode).toBe("preview");
		expect(config.registerToolOverrides).toMatchObject({ read: false, bash: true });
		expect(config.builtinRendererOverrides).toEqual({ bash: true, read: false });
		expect(config.customToolOverrides).not.toHaveProperty("read");
		expect(config.customToolOverrides.ide).toMatchObject({
			enabled: true,
			kind: "generic",
			overrideExistingRenderers: false,
		});
		expect(config.customToolOverrides.mcp__demo__echo).toMatchObject({
			kind: "mcp",
			overrideExistingRenderers: true,
		});
	});
	it("does not share mutable defaults or convert dormant preferences to enablement", () => {
		const a = normalizeToolDisplayConfig({ enabled: false, style: "balanced" });
		a.registerToolOverrides.read = false;
		a.customToolOverrides.test = { enabled: true, kind: "generic", outputMode: "hidden" };
		expect(normalizeToolDisplayConfig({}).registerToolOverrides.read).toBe(true);
		expect(DEFAULT_TOOL_DISPLAY_CONFIG.customToolOverrides).toEqual({});
	});
});
