import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, saveToolDisplayComponentPatch } from "../extensions/zentui/config";
import {
	isPiToolDisplayInstalled,
	piToolDisplayConfigPath,
	syncPiToolDisplayConfig,
	TOOL_DISPLAY_PRESET_STYLES,
	toolDisplayPresetPatch,
	toolDisplayUserMessageGuard,
} from "../extensions/zentui/tool-display-bridge";

const tempDirs: string[] = [];

function makeAgentDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "zentui-tool-display-"));
	tempDirs.push(dir);
	return dir;
}

function writeTargetConfig(agentDir: string, record: unknown): void {
	const path = piToolDisplayConfigPath(agentDir);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
}

function readTargetConfig(agentDir: string): Record<string, unknown> {
	return JSON.parse(readFileSync(piToolDisplayConfigPath(agentDir), "utf8"));
}

afterEach(() => {
	while (tempDirs.length) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("tool display bridge", () => {
	it("preserves pi-tool-display-owned fields in the target config", () => {
		const agentDir = makeAgentDir();
		writeTargetConfig(agentDir, {
			customToolOverrides: {
				ide_find_symbol: { enabled: true, kind: "generic", outputMode: "summary" },
			},
			registerToolOverrides: { read: false },
			showTruncationHints: true,
		});
		const result = syncPiToolDisplayConfig(defaultConfig.components.toolDisplay, {
			userMessagesEnabled: true,
			agentDir,
		});
		expect(result.written).toBe(true);
		const target = readTargetConfig(agentDir);
		expect(target.customToolOverrides).toEqual({
			ide_find_symbol: { enabled: true, kind: "generic", outputMode: "summary" },
		});
		expect(target.registerToolOverrides).toEqual({ read: false });
		expect(target.showTruncationHints).toBe(true);
		expect(target.enabled).toBe(false);
	});

	it("reports missing target when pi-tool-display is not installed", () => {
		const agentDir = makeAgentDir();
		const result = syncPiToolDisplayConfig(defaultConfig.components.toolDisplay, {
			userMessagesEnabled: false,
			agentDir,
		});
		expect(result).toEqual({ written: false, skipped: "missing-target" });
		expect(existsSync(piToolDisplayConfigPath(agentDir))).toBe(false);
	});

	it("detects an npm install and a local extension folder", () => {
		const npmDir = makeAgentDir();
		mkdirSync(join(npmDir, "npm", "node_modules", "pi-tool-display"), { recursive: true });
		expect(isPiToolDisplayInstalled(npmDir)).toBe(true);
		const extDir = makeAgentDir();
		mkdirSync(join(extDir, "extensions", "pi-tool-display"), { recursive: true });
		expect(isPiToolDisplayInstalled(extDir)).toBe(true);
		expect(isPiToolDisplayInstalled(makeAgentDir())).toBe(false);
	});

	it("forces the native user message box off while Zentui user messages are enabled", () => {
		const component = {
			...defaultConfig.components.toolDisplay,
			enableNativeUserMessageBox: true,
		};
		expect(toolDisplayUserMessageGuard(component, true).enableNativeUserMessageBox).toBe(false);
		expect(toolDisplayUserMessageGuard(component, false).enableNativeUserMessageBox).toBe(true);
	});

	it("mirrors the guard into the written target config", () => {
		const agentDir = makeAgentDir();
		mkdirSync(join(agentDir, "npm", "node_modules", "pi-tool-display"), { recursive: true });
		const component = {
			...defaultConfig.components.toolDisplay,
			enabled: true,
			enableNativeUserMessageBox: true,
		};
		syncPiToolDisplayConfig(component, { userMessagesEnabled: true, agentDir });
		expect(readTargetConfig(agentDir).enableNativeUserMessageBox).toBe(false);
	});

	it("skips writing when nothing changed", () => {
		const agentDir = makeAgentDir();
		writeTargetConfig(agentDir, defaultConfig.components.toolDisplay);
		const result = syncPiToolDisplayConfig(defaultConfig.components.toolDisplay, {
			userMessagesEnabled: false,
			agentDir,
		});
		expect(result).toEqual({ written: false, skipped: "unchanged" });
	});

	it("expands presets to pi-tool-display's preset values", () => {
		expect(toolDisplayPresetPatch("opencode")).toEqual({
			style: "opencode",
			...TOOL_DISPLAY_PRESET_STYLES.opencode,
		});
		expect(TOOL_DISPLAY_PRESET_STYLES.balanced).toMatchObject({
			readOutputMode: "summary",
			searchOutputMode: "count",
			mcpOutputMode: "summary",
			bashOutputMode: "summary",
			previewLines: 8,
			bashCollapsedLines: 10,
		});
		expect(TOOL_DISPLAY_PRESET_STYLES.verbose).toMatchObject({
			readOutputMode: "preview",
			searchOutputMode: "preview",
			mcpOutputMode: "preview",
			bashOutputMode: "preview",
			previewLines: 12,
			bashCollapsedLines: 20,
		});
	});
});

describe("saveToolDisplayComponentPatch", () => {
	it("persists selections into the toolDisplay component and normalizes unknown values", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-config-"));
		tempDirs.push(dir);
		const path = join(dir, "zentui.json");
		writeFileSync(path, JSON.stringify({ components: { toolDisplay: { enabled: true } } }));
		const config = saveToolDisplayComponentPatch(
			{ style: "verbose", previewLines: 9999, readOutputMode: "nonsense" as "preview" },
			path,
		);
		expect(config.components.toolDisplay.enabled).toBe(true);
		expect(config.components.toolDisplay.style).toBe("verbose");
		// previewLines is clamped to pi-tool-display's documented range; the
		// unknown mode string falls back to the style preset already applied.
		expect(config.components.toolDisplay.previewLines).toBe(80);
		const raw = JSON.parse(readFileSync(path, "utf8"));
		expect(raw.components.toolDisplay.style).toBe("verbose");
	});
});
