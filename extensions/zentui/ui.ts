import {
	CustomEditor,
	type KeybindingsManager,
	type Theme,
	UserMessageComponent,
} from "@mariozechner/pi-coding-agent";
import {
	type Component,
	Container,
	type EditorTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const originalUserMessageRender = UserMessageComponent.prototype.render;

type AutocompleteEditorInternals = {
	autocompleteList?: Pick<Component, "render">;
	isShowingAutocomplete?: () => boolean;
};

let currentUiTheme: Theme | undefined;

const TRUECOLOR_BACKGROUND_ANSI = /\x1b\[48;2;\d+;\d+;\d+m/g;
const INDEXED_BACKGROUND_ANSI = /\x1b\[48;5;\d+m/g;
const SIMPLE_BACKGROUND_ANSI = /\x1b\[(?:4\d|10[0-7]|49)m/g;

function stripBackgroundAnsi(text: string): string {
	return text
		.replace(TRUECOLOR_BACKGROUND_ANSI, "")
		.replace(INDEXED_BACKGROUND_ANSI, "")
		.replace(SIMPLE_BACKGROUND_ANSI, "");
}

function fillStyledLine(
	content: string,
	width: number,
	background?: (text: string) => string,
): string {
	const truncated = truncateToWidth(stripBackgroundAnsi(content), width, "");
	const padWidth = Math.max(0, width - visibleWidth(truncated));
	const pad =
		padWidth > 0 ? (background ? background(" ".repeat(padWidth)) : " ".repeat(padWidth)) : "";
	return `${truncated}${pad}`;
}

export function patchUserMessageComponent(uiTheme: Theme): void {
	currentUiTheme = uiTheme;

	const prototype = UserMessageComponent.prototype as {
		render(width: number): string[];
	};
	prototype.render = function (this: UserMessageComponent, width: number): string[] {
		if (!currentUiTheme) {
			return originalUserMessageRender.call(this, width);
		}

		const railWidth = 2;
		const innerWidth = Math.max(1, width - railWidth);
		const baseLines = Container.prototype.render.call(this, innerWidth) as string[];
		if (baseLines.length === 0) return baseLines;

		const hasLeadingSpacer = baseLines.length > 1 && visibleWidth(baseLines[0] ?? "") === 0;
		const leadingLines = hasLeadingSpacer ? [baseLines[0] ?? ""] : [];
		const contentLines = hasLeadingSpacer ? baseLines.slice(1) : baseLines;
		const rail = `${currentUiTheme.fg("accent", "│")}\x1b[0m `;
		const border = currentUiTheme.fg("border", "─".repeat(width));
		const styledLines = contentLines.map((line) => `${rail}${fillStyledLine(line, innerWidth)}`);

		if (styledLines.length === 0) {
			return leadingLines;
		}

		const framedLines = [border, ...styledLines, border];
		framedLines[0] = OSC133_ZONE_START + framedLines[0];
		framedLines[framedLines.length - 1] =
			framedLines[framedLines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;
		return [...leadingLines, ...framedLines];
	};
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
		const truncated = truncateToWidth(content, width, "");
		const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
		return `${truncated}${pad}`;
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const rendered = super.render(innerWidth);
		const editorInternals = this as unknown as AutocompleteEditorInternals;
		const isShowingAutocomplete =
			typeof editorInternals.isShowingAutocomplete === "function"
				? Boolean(editorInternals.isShowingAutocomplete())
				: false;

		if (rendered.length < 2) {
			return super.render(width);
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
			return rendered;
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

		return [
			top,
			...lines.map((line) => `${rail}${this.fillLine(line, innerWidth)}`),
			bottom,
			...autocompleteLines,
		];
	}
}
