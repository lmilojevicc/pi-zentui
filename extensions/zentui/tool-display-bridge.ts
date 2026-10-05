import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayComponentConfig, ToolDisplayStyle } from "./config";

/**
 * Bridge between Zentui's `toolDisplay` component and the pi-tool-display
 * extension (https://github.com/MasuRii/pi-tool-display).
 *
 * Zentui owns the selections (`/zentui` → Tool display, saved in
 * `zentui.json`); rendering stays owned by pi-tool-display. Selections are
 * mirrored into pi-tool-display's documented runtime config file, which that
 * extension reads at startup — so changes apply after a Pi restart or
 * `/reload`, mirroring how tool-ownership changes already behave there.
 */

export function piToolDisplayConfigDir(agentDir = getAgentDir()): string {
	return join(agentDir, "extensions", "pi-tool-display");
}

export function piToolDisplayConfigPath(agentDir = getAgentDir()): string {
	return join(piToolDisplayConfigDir(agentDir), "config.json");
}

/** npm install (`pi install npm:pi-tool-display`) or a local extension folder. */
export function isPiToolDisplayInstalled(agentDir = getAgentDir()): boolean {
	if (existsSync(piToolDisplayConfigDir(agentDir))) return true;
	return existsSync(join(agentDir, "npm", "node_modules", "pi-tool-display"));
}

/** Per-style selection sets mirroring pi-tool-display's presets. */
export const TOOL_DISPLAY_PRESET_STYLES: Record<
	ToolDisplayStyle,
	Pick<
		ToolDisplayComponentConfig,
		| "readOutputMode"
		| "searchOutputMode"
		| "mcpOutputMode"
		| "bashOutputMode"
		| "previewLines"
		| "bashCollapsedLines"
	>
> = {
	opencode: {
		readOutputMode: "hidden",
		searchOutputMode: "hidden",
		mcpOutputMode: "hidden",
		bashOutputMode: "opencode",
		previewLines: 8,
		bashCollapsedLines: 10,
	},
	balanced: {
		readOutputMode: "summary",
		searchOutputMode: "count",
		mcpOutputMode: "summary",
		bashOutputMode: "summary",
		previewLines: 8,
		bashCollapsedLines: 10,
	},
	verbose: {
		readOutputMode: "preview",
		searchOutputMode: "preview",
		mcpOutputMode: "preview",
		bashOutputMode: "preview",
		previewLines: 12,
		bashCollapsedLines: 20,
	},
};

/** Full preset expansion for a style change (modes plus line counts). */
export function toolDisplayPresetPatch(
	style: ToolDisplayStyle,
): Partial<ToolDisplayComponentConfig> {
	return { style, ...TOOL_DISPLAY_PRESET_STYLES[style] };
}

export type PiToolDisplayBridgeResult = {
	written: boolean;
	skipped?: "missing-target" | "unchanged";
	error?: string;
};

function readPiToolDisplayConfig(path: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		// Missing or unreadable target config: start from a blank record and let
		// pi-tool-display's own normalization fill in its defaults at startup.
		return {};
	}
}

function writePiToolDisplayConfigAtomic(path: string, record: Record<string, unknown>): void {
	const dir = join(path, "..");
	mkdirSync(dir, { recursive: true });
	const tempPath = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	renameSync(tempPath, path);
}

/**
 * Selections mirrored into the target file. Fields pi-tool-display owns that
 * Zentui does not expose (ownership toggles, custom overrides, RTK hints) are
 * left untouched in the target file so no data is ever clobbered.
 */
function bridgeFields(component: ToolDisplayComponentConfig): Record<string, unknown> {
	return {
		enabled: component.enabled,
		readOutputMode: component.readOutputMode,
		searchOutputMode: component.searchOutputMode,
		mcpOutputMode: component.mcpOutputMode,
		bashOutputMode: component.bashOutputMode,
		previewLines: component.previewLines,
		expandedPreviewMaxLines: component.expandedPreviewMaxLines,
		bashCollapsedLines: component.bashCollapsedLines,
		diffViewMode: component.diffViewMode,
		diffIndicatorMode: component.diffIndicatorMode,
		diffSplitMinWidth: component.diffSplitMinWidth,
		diffCollapsedLines: component.diffCollapsedLines,
		diffWordWrap: component.diffWordWrap,
		enableNativeUserMessageBox: component.enableNativeUserMessageBox,
	};
}

/** Zentui's User messages component owns prompt rendering when enabled. */
export function toolDisplayUserMessageGuard(
	component: ToolDisplayComponentConfig,
	userMessagesEnabled: boolean,
): ToolDisplayComponentConfig {
	if (!userMessagesEnabled || !component.enableNativeUserMessageBox) return component;
	return { ...component, enableNativeUserMessageBox: false };
}

export function syncPiToolDisplayConfig(
	component: ToolDisplayComponentConfig,
	options: { userMessagesEnabled: boolean; agentDir?: string },
): PiToolDisplayBridgeResult {
	const agentDir = options.agentDir ?? getAgentDir();
	if (!isPiToolDisplayInstalled(agentDir)) {
		return { written: false, skipped: "missing-target" };
	}

	const guarded = toolDisplayUserMessageGuard(component, options.userMessagesEnabled);
	const path = piToolDisplayConfigPath(agentDir);
	const target = readPiToolDisplayConfig(path);
	const next = { ...target, ...bridgeFields(guarded) };
	if (JSON.stringify(target) === JSON.stringify(next)) {
		return { written: false, skipped: "unchanged" };
	}

	try {
		writePiToolDisplayConfigAtomic(path, next);
		return { written: true };
	} catch (error) {
		return {
			written: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
