import {
	BASH_OUTPUT_MODES,
	BUILTIN_TOOL_NAMES,
	DEFAULT_TOOL_DISPLAY_CONFIG,
	DIFF_INDICATOR_MODES,
	DIFF_VIEW_MODES,
	isBuiltinToolName,
	READ_OUTPUT_MODES,
	SEARCH_OUTPUT_MODES,
	TOOL_DISPLAY_STYLES,
	type ToolDisplayConfig,
	type ToolDisplayPreset,
} from "./types.ts";

export function toolDisplayPresetPatch(
	style: ToolDisplayPreset,
): Pick<
	ToolDisplayConfig,
	| "style"
	| "readOutputMode"
	| "searchOutputMode"
	| "mcpOutputMode"
	| "bashOutputMode"
	| "previewLines"
	| "bashCollapsedLines"
> {
	return {
		style,
		readOutputMode: style === "opencode" ? "hidden" : style === "balanced" ? "summary" : "preview",
		searchOutputMode: style === "opencode" ? "hidden" : style === "balanced" ? "count" : "preview",
		mcpOutputMode: style === "opencode" ? "hidden" : style === "balanced" ? "summary" : "preview",
		bashOutputMode:
			style === "opencode" ? "opencode" : style === "balanced" ? "summary" : "preview",
		previewLines: style === "verbose" ? 12 : 8,
		bashCollapsedLines: style === "verbose" ? 20 : 10,
	};
}
export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
	return choices.includes(value as T) ? (value as T) : fallback;
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, Math.floor(value)))
		: fallback;
}
/** Normalize owner-local input only. Presets never toggle ownership or other surfaces. */
export function normalizeToolDisplayConfig(value: unknown): ToolDisplayConfig {
	const raw = record(value);
	const d = DEFAULT_TOOL_DISPLAY_CONFIG;
	const style = choice(raw.style, TOOL_DISPLAY_STYLES, d.style);
	const modes = style === "native" ? d : toolDisplayPresetPatch(style);
	const owned = record(raw.registerToolOverrides);
	const overrides = record(raw.builtinRendererOverrides);
	const config: ToolDisplayConfig = {
		enabled: raw.enabled === true,
		style,
		registerToolOverrides: { ...d.registerToolOverrides },
		builtinRendererOverrides: {},
		customToolOverrides: {},
		readOutputMode: choice(raw.readOutputMode, READ_OUTPUT_MODES, modes.readOutputMode),
		searchOutputMode: choice(raw.searchOutputMode, SEARCH_OUTPUT_MODES, modes.searchOutputMode),
		mcpOutputMode: choice(raw.mcpOutputMode, READ_OUTPUT_MODES, modes.mcpOutputMode),
		bashOutputMode: choice(raw.bashOutputMode, BASH_OUTPUT_MODES, modes.bashOutputMode),
		previewLines: integer(raw.previewLines, modes.previewLines, 1, 80),
		expandedPreviewMaxLines: integer(
			raw.expandedPreviewMaxLines,
			d.expandedPreviewMaxLines,
			0,
			20_000,
		),
		bashCollapsedLines: integer(raw.bashCollapsedLines, modes.bashCollapsedLines, 0, 80),
		diffViewMode: choice(raw.diffViewMode, DIFF_VIEW_MODES, d.diffViewMode),
		diffIndicatorMode: choice(raw.diffIndicatorMode, DIFF_INDICATOR_MODES, d.diffIndicatorMode),
		diffSplitMinWidth: integer(raw.diffSplitMinWidth, d.diffSplitMinWidth, 70, 240),
		diffCollapsedLines: integer(raw.diffCollapsedLines, d.diffCollapsedLines, 4, 240),
		diffWordWrap: typeof raw.diffWordWrap === "boolean" ? raw.diffWordWrap : d.diffWordWrap,
		showTruncationHints: raw.showTruncationHints === true,
	};
	for (const name of BUILTIN_TOOL_NAMES) {
		if (typeof owned[name] === "boolean") config.registerToolOverrides[name] = owned[name];
		if (typeof overrides[name] === "boolean")
			config.builtinRendererOverrides[name] = overrides[name];
	}
	for (const [name, value] of Object.entries(record(raw.customToolOverrides)).slice(0, 100)) {
		if (
			!name ||
			name.length > 200 ||
			isBuiltinToolName(name) ||
			["__proto__", "constructor", "prototype"].includes(name)
		)
			continue;
		if (typeof value !== "boolean" && (!value || typeof value !== "object" || Array.isArray(value)))
			continue;
		const entry = record(value);
		config.customToolOverrides[name] = {
			enabled: typeof value === "boolean" ? value : entry.enabled !== false,
			kind: entry.kind === "mcp" ? "mcp" : "generic",
			outputMode: choice(entry.outputMode, READ_OUTPUT_MODES, "summary"),
			overrideExistingRenderers: entry.overrideExistingRenderers === true,
		};
	}
	return config;
}
