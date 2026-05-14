import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type EditorTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

type AutocompleteEditorInternals = {
	autocompleteList?: Pick<Component, "render">;
	isShowingAutocomplete?: () => boolean;
};

function clampRenderedLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

export class PolishedEditor extends CustomEditor {
	private readonly getModelMeta: () => string;
	private readonly getThinkingLevel: () => string | undefined;
	private readonly uiTheme: Theme;
	private readonly reset = "\x1b[0m";

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		uiTheme: Theme,
		getModelMeta: () => string,
		getThinkingLevel: () => string | undefined,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.borderColor = (text: string) => uiTheme.fg("border", text);
		this.uiTheme = uiTheme;
		this.getModelMeta = getModelMeta;
		this.getThinkingLevel = getThinkingLevel;
	}

	private fillLine(content: string, width: number): string {
		const truncated = truncateToWidth(content, Math.max(0, width), "");
		const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
		return `${truncated}${pad}`;
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

		const editorLines = editorFrame.slice(1, -1);
		const metaParts = [this.getModelMeta()];
		const thinkingLevel = this.getThinkingLevel();
		if (thinkingLevel && thinkingLevel !== "off") {
			metaParts.push(this.uiTheme.fg("muted", thinkingLevel));
		}
		const meta = metaParts.filter(Boolean).join(this.uiTheme.fg("border", "  "));

		const rail = `${this.uiTheme.fg("accent", "│")}${this.reset} `;
		const top = this.uiTheme.fg("border", "─".repeat(width));
		const bottom = this.uiTheme.fg("border", "─".repeat(width));
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
