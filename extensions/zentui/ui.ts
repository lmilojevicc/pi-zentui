import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteProvider,
	type Component,
	type EditorComponent,
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

type WrappedEditor = EditorComponent &
	AutocompleteEditorInternals & {
		focused?: boolean;
		onEscape?: () => void;
		onCtrlD?: () => void;
		onPasteImage?: () => void;
		onExtensionShortcut?: (data: string) => boolean;
		actionHandlers?: Map<unknown, () => void>;
		wantsKeyRelease?: boolean;
		disableSubmit?: boolean;
		getLines?: () => string[];
		getCursor?: () => unknown;
		getMode?: () => unknown;
		getPaddingX?: () => number;
		getAutocompleteMaxVisible?: () => number;
		addToHistory?: (text: string) => void;
		getExpandedText?: () => string;
		insertTextAtCursor?: (text: string) => void;
		setAutocompleteProvider?: (provider: AutocompleteProvider) => void;
		setPaddingX?: (padding: number) => void;
		setAutocompleteMaxVisible?: (maxVisible: number) => void;
	};

type EditorMeta = {
	modelLabel: string;
	providerLabel: string;
};

type PolishedFrameOptions = {
	width: number;
	baseRendered: string[];
	autocompleteSource: AutocompleteEditorInternals;
	uiTheme: Theme;
	config: PolishedTuiConfig;
	modelMeta: EditorMeta;
	previousModelMeta?: EditorMeta;
	thinkingLevel: string | undefined;
	rightStatus?: string;
};

function clampRenderedLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
}

function editorThinkingStyle(config: PolishedTuiConfig, level: string): string | undefined {
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

function copyFriendlyPrompt(config: PolishedTuiConfig, uiTheme: Theme, reset: string): string {
	const promptIcon = config.icons.editorPrompt;
	return promptIcon
		? `${renderStyleForSourceOrFallback(
				uiTheme,
				config.colorSources.editor,
				config.colors.editorPrompt ?? config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				promptIcon,
			)}${reset} `
		: "";
}

function getEditorChromeWidths(config: PolishedTuiConfig, uiTheme: Theme, reset: string) {
	const prompt = copyFriendlyPrompt(config, uiTheme, reset);
	const rail = config.features.copyFriendly
		? ""
		: `${renderStyleForSourceOrFallback(
				uiTheme,
				config.colorSources.editor,
				config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				config.icons.rail,
			)}${reset} `;
	return {
		prompt,
		promptWidth: visibleWidth(prompt),
		rail,
		railWidth: config.features.copyFriendly ? visibleWidth(prompt) : visibleWidth(rail),
	};
}

function composeMetadataLine(left: string, right: string | undefined, width: number): string {
	if (!right) return left;
	const maxWidth = Math.max(0, width);
	const rightWidth = visibleWidth(right);
	if (rightWidth >= maxWidth) return truncateToWidth(right, maxWidth, "");

	const leftWidth = Math.max(0, maxWidth - rightWidth - 1);
	const leftText = truncateToWidth(left, leftWidth, "");
	const gap = " ".repeat(Math.max(1, maxWidth - visibleWidth(leftText) - rightWidth));
	return `${leftText}${gap}${right}`;
}

function plainRenderedText(line: string): string {
	return line
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\[[/?][^\]]+\]/g, "");
}

function isHorizontalBorder(line: string): boolean {
	const plain = plainRenderedText(line).trim();
	return plain.length > 0 && /^─+$/.test(plain);
}

function isRenderedModelMetaLine(line: string, modelMeta: EditorMeta): boolean {
	const plain = plainRenderedText(line);
	return plain.includes(modelMeta.modelLabel) && plain.includes(modelMeta.providerLabel);
}

function matchesAnyModelMeta(
	line: string,
	modelMeta: EditorMeta,
	previousMeta?: EditorMeta,
): boolean {
	if (isRenderedModelMetaLine(line, modelMeta)) return true;
	if (previousMeta && isRenderedModelMetaLine(line, previousMeta)) return true;
	return false;
}

function hasRenderedModelMetaLine(
	lines: string[],
	modelMeta: EditorMeta,
	previousMeta?: EditorMeta,
): boolean {
	return lines.some((line) => matchesAnyModelMeta(line, modelMeta, previousMeta));
}

function isAlreadyPolishedFrame(
	lines: string[],
	modelMeta: EditorMeta,
	previousMeta?: EditorMeta,
): boolean {
	return (
		lines.length >= 3 &&
		isHorizontalBorder(lines[0] ?? "") &&
		isHorizontalBorder(lines.at(-1) ?? "") &&
		hasRenderedModelMetaLine(lines.slice(1, -1), modelMeta, previousMeta)
	);
}

function removeRenderedModelMetaLines(
	lines: string[],
	modelMeta: EditorMeta,
	previousMeta?: EditorMeta,
): string[] {
	const result: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (matchesAnyModelMeta(line, modelMeta, previousMeta)) continue;

		const plain = plainRenderedText(line).trim();
		const previousWasMeta =
			index > 0 && matchesAnyModelMeta(lines[index - 1] ?? "", modelMeta, previousMeta);
		const nextIsMeta =
			index < lines.length - 1 &&
			matchesAnyModelMeta(lines[index + 1] ?? "", modelMeta, previousMeta);
		if (!plain && (previousWasMeta || nextIsMeta)) continue;

		result.push(line);
	}
	return result;
}

function removeStalePolishedLeadingSpacer(lines: string[], shouldRemove: boolean): string[] {
	if (!shouldRemove || lines.length === 0) return lines;
	const firstLine = lines[0] ?? "";
	if (plainRenderedText(firstLine).trim()) return lines;
	return lines.slice(1);
}

function vimModeColor(mode: string): string {
	switch (mode.toLowerCase()) {
		case "insert":
			return "success";
		case "normal":
			return "accent";
		case "ex":
			return "warning";
		case "replace":
			return "error";
		case "visual":
			return "syntaxKeyword";
		default:
			return "muted";
	}
}

function readVimStatus(editor: WrappedEditor, uiTheme: Theme): string | undefined {
	const mode = editor.getMode?.();
	if (typeof mode !== "string") return undefined;
	const normalized = mode.trim();
	if (!normalized) return undefined;
	const label = `${normalized.toUpperCase()} `;
	return safeThemeFg(uiTheme, vimModeColor(normalized), label);
}

function renderPolishedFrame({
	width,
	baseRendered,
	autocompleteSource,
	uiTheme,
	config,
	modelMeta,
	previousModelMeta,
	thinkingLevel,
	rightStatus,
}: PolishedFrameOptions): string[] {
	if (width <= 2) return clampRenderedLines(baseRendered, width);

	const reset = "\x1b[0m";
	const colorSource = config.colorSources.editor;
	const { prompt, promptWidth, rail, railWidth } = getEditorChromeWidths(config, uiTheme, reset);
	const innerWidth = Math.max(0, width - railWidth);
	const copyFriendlyContinuation = " ".repeat(promptWidth);
	const isShowingAutocomplete =
		typeof autocompleteSource.isShowingAutocomplete === "function"
			? Boolean(autocompleteSource.isShowingAutocomplete())
			: false;

	if (baseRendered.length < 2) return clampRenderedLines(baseRendered, width);

	const { autocompleteList } = autocompleteSource;
	const autocompleteCount =
		isShowingAutocomplete && typeof autocompleteList?.render === "function"
			? autocompleteList.render(innerWidth).length
			: 0;
	const editorFrame =
		autocompleteCount > 0 && autocompleteCount < baseRendered.length
			? baseRendered.slice(0, -autocompleteCount)
			: baseRendered;
	const autocompleteLines =
		autocompleteCount > 0 && autocompleteCount < baseRendered.length
			? baseRendered.slice(-autocompleteCount)
			: [];
	if (editorFrame.length < 2) return clampRenderedLines(baseRendered, width);

	const stalePolishedFrame = isAlreadyPolishedFrame(editorFrame, modelMeta, previousModelMeta);
	const editorLines = removeStalePolishedLeadingSpacer(
		removeRenderedModelMetaLines(editorFrame.slice(1, -1), modelMeta, previousModelMeta),
		stalePolishedFrame,
	);
	const model = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorModel,
		EDITOR_ACCENT_FALLBACK,
		modelMeta.modelLabel,
	);
	const provider = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorProvider,
		"text",
		modelMeta.providerLabel,
	);
	const renderedModelMeta = [model, provider]
		.filter(Boolean)
		.join(safeThemeFg(uiTheme, "borderMuted", "  "));
	const metaParts = [renderedModelMeta];
	if (thinkingLevel && thinkingLevel !== "off") {
		metaParts.push(
			renderStyleForSourceOrFallback(
				uiTheme,
				colorSource,
				editorThinkingStyle(config, thinkingLevel),
				"muted",
				thinkingLevel,
			),
		);
	}
	const meta = metaParts.filter(Boolean).join(safeThemeFg(uiTheme, "border", "  "));
	const copyFriendlyMeta = composeMetadataLine(meta, rightStatus, Math.max(0, width - 1));
	const railedMeta = composeMetadataLine(meta, rightStatus, innerWidth);

	const top = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorBorder,
		EDITOR_BORDER_FALLBACK,
		"─".repeat(width),
	);
	const bottom = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorBorder,
		EDITOR_BORDER_FALLBACK,
		"─".repeat(width),
	);
	const lines = [...editorLines, "", railedMeta];
	const renderedLines = config.features.copyFriendly
		? [
				top,
				...editorLines.map(
					(line, index) =>
						`${index === 0 ? prompt : copyFriendlyContinuation}${fillLine(line, innerWidth)}`,
				),
				"",
				` ${truncateToWidth(copyFriendlyMeta, Math.max(0, width - 1), "")}`,
				bottom,
				...autocompleteLines,
			]
		: [
				top,
				...lines.map((line) => `${rail}${fillLine(line, innerWidth)}`),
				bottom,
				...autocompleteLines,
			];

	return clampRenderedLines(renderedLines, width);
}

export class PolishedEditor extends CustomEditor {
	private readonly getModelMeta: () => EditorMeta;
	private readonly getThinkingLevel: () => string | undefined;
	private readonly getConfig: () => PolishedTuiConfig;
	private readonly uiTheme: Theme;
	private previousModelMeta?: EditorMeta;

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

	render(width: number): string[] {
		if (width <= 2) {
			return clampRenderedLines(super.render(width), width);
		}

		const config = this.getConfig();
		const { railWidth } = getEditorChromeWidths(config, this.uiTheme, "\x1b[0m");
		const innerWidth = Math.max(0, width - railWidth);
		const rendered = super.render(innerWidth);
		const modelMeta = this.getModelMeta();
		const result = renderPolishedFrame({
			width,
			baseRendered: rendered,
			autocompleteSource: this as unknown as AutocompleteEditorInternals,
			uiTheme: this.uiTheme,
			config,
			modelMeta,
			previousModelMeta: this.previousModelMeta,
			thinkingLevel: this.getThinkingLevel(),
		});
		this.previousModelMeta = modelMeta;
		return result;
	}
}

export class WrappedPolishedEditor implements EditorComponent {
	private previousModelMeta?: EditorMeta;

	constructor(
		private readonly base: WrappedEditor,
		private readonly uiTheme: Theme,
		private readonly getConfig: () => PolishedTuiConfig,
		private readonly getModelMeta: () => EditorMeta,
		private readonly getThinkingLevel: () => string | undefined,
	) {}

	get focused(): boolean {
		return Boolean(this.base.focused);
	}
	set focused(value: boolean) {
		this.base.focused = value;
	}

	get borderColor(): ((str: string) => string) | undefined {
		return this.base.borderColor;
	}
	set borderColor(value: ((str: string) => string) | undefined) {
		this.base.borderColor = value;
	}

	get onSubmit(): ((text: string) => void) | undefined {
		return this.base.onSubmit;
	}
	set onSubmit(value: ((text: string) => void) | undefined) {
		this.base.onSubmit = value;
	}

	get onChange(): ((text: string) => void) | undefined {
		return this.base.onChange;
	}
	set onChange(value: ((text: string) => void) | undefined) {
		this.base.onChange = value;
	}

	get onEscape(): (() => void) | undefined {
		return this.base.onEscape;
	}
	set onEscape(value: (() => void) | undefined) {
		this.base.onEscape = value;
	}

	get onCtrlD(): (() => void) | undefined {
		return this.base.onCtrlD;
	}
	set onCtrlD(value: (() => void) | undefined) {
		this.base.onCtrlD = value;
	}

	get onPasteImage(): (() => void) | undefined {
		return this.base.onPasteImage;
	}
	set onPasteImage(value: (() => void) | undefined) {
		this.base.onPasteImage = value;
	}

	get onExtensionShortcut(): ((data: string) => boolean) | undefined {
		return this.base.onExtensionShortcut;
	}
	set onExtensionShortcut(value: ((data: string) => boolean) | undefined) {
		this.base.onExtensionShortcut = value;
	}

	get actionHandlers(): Map<unknown, () => void> | undefined {
		return this.base.actionHandlers;
	}
	set actionHandlers(value: Map<unknown, () => void> | undefined) {
		this.base.actionHandlers = value;
	}

	get wantsKeyRelease(): boolean | undefined {
		return this.base.wantsKeyRelease;
	}
	set wantsKeyRelease(value: boolean | undefined) {
		this.base.wantsKeyRelease = value;
	}

	get disableSubmit(): boolean | undefined {
		return this.base.disableSubmit;
	}
	set disableSubmit(value: boolean | undefined) {
		this.base.disableSubmit = value;
	}

	render(width: number): string[] {
		if (width <= 2) return clampRenderedLines(this.base.render(width), width);

		const config = this.getConfig();
		const { railWidth } = getEditorChromeWidths(config, this.uiTheme, "\x1b[0m");
		const innerWidth = Math.max(0, width - railWidth);
		const rendered = this.base.render(innerWidth);
		const vimStatus = readVimStatus(this.base, this.uiTheme);
		const modelMeta = this.getModelMeta();
		const result = renderPolishedFrame({
			width,
			baseRendered: rendered,
			autocompleteSource: this.base,
			uiTheme: this.uiTheme,
			config,
			modelMeta,
			previousModelMeta: this.previousModelMeta,
			thinkingLevel: this.getThinkingLevel(),
			rightStatus: vimStatus,
		});
		this.previousModelMeta = modelMeta;
		return result;
	}

	invalidate(): void {
		this.base.invalidate?.();
	}

	handleInput(data: string): void {
		this.base.handleInput(data);
	}

	getText(): string {
		return this.base.getText();
	}

	setText(text: string): void {
		this.base.setText(text);
	}

	addToHistory(text: string): void {
		this.base.addToHistory?.(text);
	}

	insertTextAtCursor(text: string): void {
		this.base.insertTextAtCursor?.(text);
	}

	getExpandedText(): string {
		return this.base.getExpandedText?.() ?? this.base.getText();
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.base.setAutocompleteProvider?.(provider);
	}

	setPaddingX(padding: number): void {
		this.base.setPaddingX?.(padding);
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.base.setAutocompleteMaxVisible?.(maxVisible);
	}

	getLines(): string[] {
		return this.base.getLines?.() ?? this.base.getText().split("\n");
	}

	getCursor(): unknown {
		return this.base.getCursor?.();
	}

	getMode(): unknown {
		return this.base.getMode?.();
	}

	getPaddingX(): number | undefined {
		return this.base.getPaddingX?.();
	}

	getAutocompleteMaxVisible(): number | undefined {
		return this.base.getAutocompleteMaxVisible?.();
	}
}
