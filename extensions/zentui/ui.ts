import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type EditorTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "./config";
import {
	EDITOR_ACCENT_FALLBACK,
	EDITOR_BORDER_FALLBACK,
	renderStyleForSourceOrFallback,
	safeThemeFg,
} from "./style";

type AutocompleteEditorInternals = {
	autocompleteList?: Pick<Component, "render">;
	isShowingAutocomplete?: () => boolean;
};

type EditorMeta = {
	modelLabel: string;
	providerLabel: string;
};

function clampRenderedLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

export class PolishedEditor extends CustomEditor {
	private readonly getModelMeta: () => EditorMeta;
	private readonly getThinkingLevel: () => string | undefined;
	private readonly getConfig: () => PolishedTuiConfig;
	private readonly uiTheme: Theme;
	private readonly reset = "\x1b[0m";

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		uiTheme: Theme,
		getConfig: () => PolishedTuiConfig,
		getModelMeta: () => EditorMeta,
		getThinkingLevel: () => string | undefined,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.borderColor = (text: string) => safeThemeFg(uiTheme, "border", text);
		this.uiTheme = uiTheme;
		this.getConfig = getConfig;
		this.getModelMeta = getModelMeta;
		this.getThinkingLevel = getThinkingLevel;
	}

	private fillLine(content: string, width: number): string {
		const truncated = truncateToWidth(content, Math.max(0, width), "");
		const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
		return `${truncated}${pad}`;
	}

	private editorThinkingStyle(config: PolishedTuiConfig, level: string): string | undefined {
		switch (level.toLowerCase()) {
			case "minimal":
				return config.colors.editorThinkingMinimal ?? config.colors.editorThinking;
			case "low":
				return config.colors.editorThinkingLow ?? config.colors.editorThinking;
			case "medium":
				return config.colors.editorThinkingMedium ?? config.colors.editorThinking;
			case "high":
				return config.colors.editorThinkingHigh ?? config.colors.editorThinking;
			case "xhigh":
				return config.colors.editorThinkingXhigh ?? config.colors.editorThinking;
			default:
				return config.colors.editorThinking;
		}
	}

	render(width: number): string[] {
		if (width <= 2) {
			return clampRenderedLines(super.render(width), width);
		}

		const innerWidth = width - 2;
		const rendered = super.render(innerWidth);
		const editorInternals = this as unknown as AutocompleteEditorInternals;
		const isShowingAutocomplete =
			typeof editorInternals.isShowingAutocomplete === "function"
				? Boolean(editorInternals.isShowingAutocomplete())
				: false;

		if (rendered.length < 2) {
			return clampRenderedLines(super.render(width), width);
		}

		const { autocompleteList } = editorInternals;
		const autocompleteCount =
			isShowingAutocomplete && typeof autocompleteList?.render === "function"
				? autocompleteList.render(innerWidth).length
				: 0;
		const editorFrame =
			autocompleteCount > 0 && autocompleteCount < rendered.length
				? rendered.slice(0, -autocompleteCount)
				: rendered;
		const autocompleteLines =
			autocompleteCount > 0 && autocompleteCount < rendered.length
				? rendered.slice(-autocompleteCount)
				: [];

		if (editorFrame.length < 2) {
			return clampRenderedLines(rendered, width);
		}

		const config = this.getConfig();
		const colorSource = config.colorSources.editor;
		const editorLines = editorFrame.slice(1, -1);
		const { modelLabel, providerLabel } = this.getModelMeta();
		const model = renderStyleForSourceOrFallback(
			this.uiTheme,
			colorSource,
			config.colors.editorModel,
			EDITOR_ACCENT_FALLBACK,
			modelLabel,
		);
		const provider = renderStyleForSourceOrFallback(
			this.uiTheme,
			colorSource,
			config.colors.editorProvider,
			"text",
			providerLabel,
		);
		const modelMeta = [model, provider]
			.filter(Boolean)
			.join(safeThemeFg(this.uiTheme, "borderMuted", "  "));
		const metaParts = [modelMeta];
		const thinkingLevel = this.getThinkingLevel();
		if (thinkingLevel && thinkingLevel !== "off") {
			metaParts.push(
				renderStyleForSourceOrFallback(
					this.uiTheme,
					colorSource,
					this.editorThinkingStyle(config, thinkingLevel),
					"muted",
					thinkingLevel,
				),
			);
		}
		const meta = metaParts.filter(Boolean).join(safeThemeFg(this.uiTheme, "border", "  "));

		const rail = `${renderStyleForSourceOrFallback(
			this.uiTheme,
			colorSource,
			config.colors.editorAccent,
			EDITOR_ACCENT_FALLBACK,
			"│",
		)}${this.reset} `;
		const top = renderStyleForSourceOrFallback(
			this.uiTheme,
			colorSource,
			config.colors.editorBorder,
			EDITOR_BORDER_FALLBACK,
			"─".repeat(width),
		);
		const bottom = renderStyleForSourceOrFallback(
			this.uiTheme,
			colorSource,
			config.colors.editorBorder,
			EDITOR_BORDER_FALLBACK,
			"─".repeat(width),
		);
		const lines = ["", ...editorLines, "", meta];
		const renderedLines = [
			top,
			...lines.map((line) => `${rail}${this.fillLine(line, innerWidth)}`),
			bottom,
			...autocompleteLines,
		];

		return clampRenderedLines(renderedLines, width);
	}
}
