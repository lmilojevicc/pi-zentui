import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderAccentRailEditorFrame } from "./accent-rail-editor";
import type { PolishedTuiConfig } from "./config";
import { sanitizeEditorMetadataText } from "./editor-metadata-format";
import { renderMinimalistFrame } from "./minimalist-editor";
import { safeThemeFg } from "./style";
import { createThinkingStepsRows } from "./thinking-experimental";
import { parseThinkingSteps } from "./thinking-steps";
import { renderPolishedEditorFrame } from "./ui";
import { makeMarkdownTheme, renderUserMessageStyle } from "./user-message-styles";

export const SETTINGS_PREVIEW_MAX_WIDTH = 72;
export const SETTINGS_PREVIEW_MAX_ROWS = 10;
export const EDITOR_PREVIEW_INPUT = "Explain this change safely.";
export const USER_MESSAGE_PREVIEW_MARKDOWN = "Please review **this change** safely.";
export const THINKING_STEPS_PREVIEW_MARKDOWN = [
	"# Inspect the change",
	"# Map the affected surface",
	"# Parse structural labels",
	"# Check narrow widths",
	"# Preserve [literal] labels",
	"# Validate rendered output",
	"# Verify compatibility",
].join("\n");
type ThinkingPreviewState = Readonly<{
	available: boolean;
	active: boolean;
	activeMode?: "rail" | "tree" | "streaming";
	startup: Readonly<{ enabled: boolean; mode: "rail" | "tree" | "streaming" }>;
	restartRequired: boolean;
	reason?: string;
}>;

type ThinkingPreviewCapability =
	| boolean
	| Readonly<{ available: boolean }>
	| Readonly<{ readonly state: ThinkingPreviewState }>;

function boundedRows(rows: string[], width: number): string[] {
	const safeWidth = Math.max(0, Math.min(SETTINGS_PREVIEW_MAX_WIDTH, width));
	if (safeWidth <= 0) return [];
	const bounded = rows
		.slice(0, SETTINGS_PREVIEW_MAX_ROWS)
		.map((line) => truncateToWidth(line, safeWidth, ""));
	while (bounded.length > 0 && visibleWidth(bounded.at(-1) ?? "") === 0) bounded.pop();
	return bounded;
}

function previewConfig(config: PolishedTuiConfig): PolishedTuiConfig {
	const derived = structuredClone(config);
	derived.icons = Object.fromEntries(
		Object.entries(derived.icons).map(([key, value]) => [
			key,
			typeof value === "string" ? sanitizeEditorMetadataText(value) : value,
		]),
	) as typeof derived.icons;
	return derived;
}

function adaptiveBorder(theme: Theme): (text: string) => string {
	return (text) => safeThemeFg(theme, "thinkingHigh", text);
}

export function renderEditorSettingsPreview(
	config: PolishedTuiConfig,
	theme: Theme,
	width: number,
): string[] {
	const previewWidth = Math.max(0, Math.min(SETTINGS_PREVIEW_MAX_WIDTH, width));
	if (previewWidth <= 0) return [];
	const safeConfig = previewConfig(config);
	const editor = safeConfig.components.editor;
	const borderColor = adaptiveBorder(theme);
	const modelLabel = editor.modelLabel === "name" ? "Sonnet 4" : "sonnet-4";
	const editorLines = [EDITOR_PREVIEW_INPUT];
	const autocompleteLines = [
		safeThemeFg(theme, "accent", "→ settings     Open settings"),
		"  files        Search files",
		safeThemeFg(theme, "muted", "  (1/47)"),
	];
	const viewport = editor.viewportIndicators ? { above: "2", below: "3" } : undefined;
	let frame: string[];
	if (editor.style === "accent-rail") {
		frame = renderAccentRailEditorFrame({
			width: previewWidth,
			editorLines,
			autocompleteLines,
			viewport,
			uiTheme: theme,
			config: safeConfig,
		});
	} else if (editor.style === "minimalist") {
		frame = renderMinimalistFrame({
			width: previewWidth,
			editorLines,
			viewport,
			inputText: EDITOR_PREVIEW_INPUT,
			metadata: {
				cwd: "/workspace/zentui/src",
				projectRoot: "/workspace/zentui",
				branch: "feat/settings-previews",
				dirty: true,
				ahead: 2,
				behind: 1,
				costLabel: "$.12",
				modelLabel,
				thinkingLevel: "high",
				contextPercent: 75,
				contextWindow: 372_000,
				sessionName: "Preview",
				agentDurationMs: 12_000,
				agentActive: true,
			},
			uiTheme: theme,
			config: safeConfig,
			borderColor,
		});
	} else {
		frame = renderPolishedEditorFrame({
			width: previewWidth,
			editorLines,
			autocompleteLines,
			viewport,
			uiTheme: theme,
			config: safeConfig,
			modelMeta: {
				modelLabel,
				modelId: "sonnet-4",
				modelName: "Sonnet 4",
				providerLabel: "Anthropic",
				sessionName: "Preview",
			},
			thinkingLevel: "high",
			borderColor,
		});
	}
	return boundedRows(frame, previewWidth);
}

export function renderUserMessageSettingsPreview(
	config: PolishedTuiConfig,
	theme: Theme,
	width: number,
	text = USER_MESSAGE_PREVIEW_MARKDOWN,
): string[] {
	const previewWidth = Math.max(0, Math.min(SETTINGS_PREVIEW_MAX_WIDTH, width));
	if (previewWidth <= 0) return [];
	const safeConfig = previewConfig(config);
	const frame = renderUserMessageStyle({ text, width: previewWidth, theme, config: safeConfig });
	return boundedRows(frame, previewWidth);
}

export function renderThinkingStepsSettingsPreview(
	config: PolishedTuiConfig,
	theme: Theme,
	width: number,
	capability: ThinkingPreviewCapability = true,
): string[] {
	const previewWidth = Math.max(0, Math.min(SETTINGS_PREVIEW_MAX_WIDTH, width));
	if (previewWidth <= 0) return [];
	const thinkingSteps = config.components.thinkingSteps;
	const state: ThinkingPreviewState =
		typeof capability === "boolean"
			? {
					available: capability,
					active: false,
					startup: { enabled: false, mode: "tree" },
					restartRequired: capability,
				}
			: "state" in capability
				? capability.state
				: {
						available: capability.available,
						active: false,
						startup: { enabled: false, mode: "tree" },
						restartRequired: false,
					};
	const saved = thinkingSteps.enabled ? `saved ${thinkingSteps.mode}` : "saved disabled";
	const active = state.active && state.activeMode ? `active ${state.activeMode}` : "native active";
	const status = !state.available
		? `${state.reason ?? "private renderer unavailable"} · native thinking`
		: state.restartRequired
			? `${saved} · ${active} · restart required`
			: `${saved} · ${active}`;
	if (thinkingSteps.mode === "streaming") {
		return boundedRows(
			[
				safeThemeFg(theme, "thinkingText", "Thinking 7.1s  (configured thinking toggle to expand)"),
				safeThemeFg(theme, "thinkingText", "Inspect the host-rendered reasoning tail."),
				safeThemeFg(theme, "thinkingText", "Preserve native Markdown and wrapping."),
				safeThemeFg(theme, "muted", status),
			],
			previewWidth,
		);
	}
	const markdownTheme = makeMarkdownTheme(theme);
	const defaultTextStyle = {
		color: (text: string) => theme.fg("thinkingText", text),
		italic: true,
	};
	const native = new Markdown(
		THINKING_STEPS_PREVIEW_MARKDOWN,
		0,
		0,
		markdownTheme,
		defaultTextStyle,
	);
	const steps = parseThinkingSteps(THINKING_STEPS_PREVIEW_MARKDOWN);
	const rows = steps
		? createThinkingStepsRows(
				native,
				{
					text: THINKING_STEPS_PREVIEW_MARKDOWN,
					paddingX: 0,
					paddingY: 0,
					theme: markdownTheme,
					defaultTextStyle,
				},
				steps,
				thinkingSteps.mode,
				true,
				() => theme,
			).render(previewWidth)
		: native.render(previewWidth);
	rows.push(safeThemeFg(theme, "muted", status));
	return boundedRows(rows, previewWidth);
}
