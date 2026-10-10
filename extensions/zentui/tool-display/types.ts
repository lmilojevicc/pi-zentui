/*
 * Tool display modes/presentation adapted from pi-tool-display 0.5.0.
 * MIT License
 *
 * Copyright (c) 2026 MasuRii
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Visual modes adapted from pi-tool-display 0.5.0; see docs/tool-display-attribution.md.
export const BUILTIN_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
export const TOOL_DISPLAY_PRESETS = ["opencode", "balanced", "verbose"] as const;
export type ToolDisplayPreset = (typeof TOOL_DISPLAY_PRESETS)[number];
export const TOOL_DISPLAY_STYLES = ["native", ...TOOL_DISPLAY_PRESETS] as const;
export const READ_OUTPUT_MODES = ["hidden", "summary", "preview"] as const;
export const SEARCH_OUTPUT_MODES = ["hidden", "count", "preview"] as const;
export const MCP_OUTPUT_MODES = READ_OUTPUT_MODES;
export const BASH_OUTPUT_MODES = ["opencode", "summary", "preview"] as const;
export const DIFF_VIEW_MODES = ["auto", "split", "unified"] as const;
export const DIFF_INDICATOR_MODES = ["bars", "classic", "none"] as const;
export type DiffIndicatorMode = (typeof DIFF_INDICATOR_MODES)[number];
export type OutputMode = (typeof READ_OUTPUT_MODES)[number];
export interface CustomToolDisplayConfig {
	enabled: boolean;
	kind: "generic" | "mcp";
	outputMode?: OutputMode;
	/** Exact-name rendering-only takeover consent; absent means false. */
	overrideExistingRenderers?: boolean;
}
export interface ToolDisplayConfig {
	enabled: boolean;
	style: (typeof TOOL_DISPLAY_STYLES)[number];
	registerToolOverrides: Record<BuiltinToolName, boolean>;
	/** Explicit rendering-only consent for an ambiguous native builtin renderer. */
	builtinRendererOverrides: Partial<Record<BuiltinToolName, boolean>>;
	/** Exact names only; no automatic MCP/extension tool takeover. */
	customToolOverrides: Record<string, CustomToolDisplayConfig>;
	readOutputMode: OutputMode;
	searchOutputMode: (typeof SEARCH_OUTPUT_MODES)[number];
	mcpOutputMode: OutputMode;
	bashOutputMode: (typeof BASH_OUTPUT_MODES)[number];
	previewLines: number;
	expandedPreviewMaxLines: number;
	bashCollapsedLines: number;
	diffViewMode: (typeof DIFF_VIEW_MODES)[number];
	diffIndicatorMode: (typeof DIFF_INDICATOR_MODES)[number];
	diffSplitMinWidth: number;
	diffCollapsedLines: number;
	diffWordWrap: boolean;
	showTruncationHints: boolean;
}
export const DEFAULT_TOOL_DISPLAY_CONFIG: ToolDisplayConfig = {
	enabled: false,
	style: "opencode",
	registerToolOverrides: {
		read: true,
		write: true,
		edit: true,
		bash: true,
		grep: true,
		find: true,
		ls: true,
	},
	builtinRendererOverrides: {},
	customToolOverrides: {},
	readOutputMode: "hidden",
	searchOutputMode: "hidden",
	mcpOutputMode: "hidden",
	bashOutputMode: "opencode",
	previewLines: 8,
	expandedPreviewMaxLines: 4000,
	bashCollapsedLines: 10,
	diffViewMode: "auto",
	diffIndicatorMode: "bars",
	diffSplitMinWidth: 120,
	diffCollapsedLines: 24,
	diffWordWrap: true,
	showTruncationHints: false,
};
export function isBuiltinToolName(name: string): name is BuiltinToolName {
	return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}
