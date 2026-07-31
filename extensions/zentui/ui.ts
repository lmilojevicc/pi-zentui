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
import { renderEditorMetadataFormat } from "./editor-metadata-format";
import {
	EDITOR_ACCENT_FALLBACK,
	EDITOR_BORDER_FALLBACK,
	renderStyleForSourceOrFallback,
	safeThemeFg,
} from "./style";

const LEGACY_SPLIT_POLISHED_FRAME = Symbol.for("pi-zentui.polished-frame");

type ViewportCounts = {
	above?: string;
	below?: string;
};

type PolishedFrameSplit = {
	editorLines: string[];
	trailingLines: string[];
	viewport: ViewportCounts;
};

type PolishedFrameProvenance = {
	rows: readonly string[];
	split: PolishedFrameSplit;
};

const POLISHED_FRAME_SPLITS = new WeakMap<string[], PolishedFrameProvenance>();

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
	modelId?: string;
	modelName?: string;
	providerLabel: string;
	sessionName?: string;
};

type PolishedFrameOptions = {
	width: number;
	baseRendered: string[];
	autocompleteSource: AutocompleteEditorInternals;
	uiTheme: Theme;
	config: PolishedTuiConfig;
	modelMeta: EditorMeta;
	thinkingLevel: string | undefined;
	rightStatus?: string;
	ownedFrame?: PolishedFrameSplit;
	trustedBaseFrame?: boolean;
};

type PolishedFrameResult = { lines: string[]; decorated: boolean };

type AutocompleteCount = { known: true; count: number } | { known: false };

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((line) => typeof line === "string");
}

function isViewportCounts(value: unknown): value is ViewportCounts {
	if (!value || typeof value !== "object") return false;
	const counts = value as Record<string, unknown>;
	return [counts.above, counts.below].every(
		(count) => count === undefined || (typeof count === "string" && /^[1-9]\d*$/.test(count)),
	);
}

function isPolishedFrameSplit(value: unknown, baseLineCount: number): value is PolishedFrameSplit {
	if (!value || typeof value !== "object") return false;
	const split = value as Record<string, unknown>;
	return (
		isStringArray(split.editorLines) &&
		isStringArray(split.trailingLines) &&
		split.trailingLines.length <= baseLineCount &&
		isViewportCounts(split.viewport)
	);
}

function readAutocompleteCount(
	source: AutocompleteEditorInternals,
	width: number,
	baseLineCount: number,
): AutocompleteCount {
	try {
		const showing = source.isShowingAutocomplete;
		if (typeof showing !== "function") return { known: true, count: 0 };
		if (!showing.call(source)) return { known: true, count: 0 };
		const list = source.autocompleteList;
		if (!list || typeof list.render !== "function") return { known: false };
		const rendered = list.render(width);
		if (!isStringArray(rendered) || rendered.length <= 0 || rendered.length >= baseLineCount) {
			return { known: false };
		}
		return { known: true, count: rendered.length };
	} catch {
		return { known: false };
	}
}

function clampRenderedLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
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

function ansiStrippedText(line: string): string {
	return line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function plainRenderedText(line: string): string {
	return ansiStrippedText(line).replace(/\[\/?[^\]]+\]/g, "");
}

function parseEditorBorder(
	line: string,
	direction: keyof ViewportCounts,
): { count?: string } | undefined {
	const plain = ansiStrippedText(line);
	if (/^─+$/.test(plain)) return {};

	const arrow = direction === "above" ? "↑" : "↓";
	const match = new RegExp(`^─── ${arrow} ([1-9]\\d*) more ─*$`).exec(plain);
	return match?.[1] ? { count: match[1] } : undefined;
}

function renderEditorBorder(
	width: number,
	direction: keyof ViewportCounts,
	count: string | undefined,
): string {
	if (!count) return "─".repeat(width);
	const arrow = direction === "above" ? "↑" : "↓";
	const indicator = `─── ${arrow} ${count} more `;
	return `${indicator}${"─".repeat(Math.max(0, width - visibleWidth(indicator)))}`;
}

function unwrapPolishedFrameOnly(
	lines: string[],
	config: PolishedTuiConfig,
	uiTheme: Theme,
): { editorLines: string[]; viewport: ViewportCounts } | undefined {
	if (lines.length < 5) return undefined;
	const top = parseEditorBorder(lines[0] ?? "", "above");
	const bottom = parseEditorBorder(lines.at(-1) ?? "", "below");
	if (!top || !bottom) return undefined;

	const viewport = { above: top.count, below: bottom.count };
	const interior = lines.slice(1, -1);
	if (interior.length < 3) return undefined;

	if (config.features.copyFriendly) {
		if (
			plainRenderedText(interior[0] ?? "").trim() !== "" ||
			plainRenderedText(interior.at(-2) ?? "").trim() !== "" ||
			!(interior.at(-1) ?? "").startsWith(" ")
		)
			return undefined;

		const { prompt, promptWidth } = getEditorChromeWidths(config, uiTheme, "\x1b[0m");
		const continuation = " ".repeat(promptWidth);
		const content = interior.slice(1, -2);
		const unwrapped: string[] = [];
		for (let index = 0; index < content.length; index++) {
			const prefix = index === 0 ? prompt : continuation;
			const line = content[index] ?? "";
			if (prefix && !line.startsWith(prefix)) return undefined;
			unwrapped.push(prefix ? line.slice(prefix.length) : line);
		}
		return { editorLines: unwrapped, viewport };
	}

	const { rail } = getEditorChromeWidths(config, uiTheme, "\x1b[0m");
	if (!rail || interior.some((line) => !line.startsWith(rail))) return undefined;
	const unrailed = interior.map((line) => line.slice(rail.length));
	if (
		plainRenderedText(unrailed[0] ?? "").trim() !== "" ||
		plainRenderedText(unrailed.at(-2) ?? "").trim() !== ""
	)
		return undefined;
	return { editorLines: unrailed.slice(1, -2), viewport };
}

function splitPolishedFrame(
	lines: string[],
	config: PolishedTuiConfig,
	uiTheme: Theme,
): PolishedFrameSplit | undefined {
	if (!parseEditorBorder(lines[0] ?? "", "above")) return undefined;
	for (let bottomIndex = lines.length - 1; bottomIndex >= 4; bottomIndex--) {
		if (!parseEditorBorder(lines[bottomIndex] ?? "", "below")) continue;
		const frame = unwrapPolishedFrameOnly(lines.slice(0, bottomIndex + 1), config, uiTheme);
		if (frame) {
			return { ...frame, trailingLines: lines.slice(bottomIndex + 1) };
		}
	}
	return undefined;
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
	thinkingLevel,
	rightStatus,
	ownedFrame,
	trustedBaseFrame = false,
}: PolishedFrameOptions): PolishedFrameResult {
	if (width <= 2) return { lines: clampRenderedLines(baseRendered, width), decorated: false };

	const reset = "\x1b[0m";
	const colorSource = config.colorSources.editor;
	const { prompt, promptWidth, rail, railWidth } = getEditorChromeWidths(config, uiTheme, reset);
	const innerWidth = Math.max(0, width - railWidth);
	const copyFriendlyContinuation = " ".repeat(promptWidth);

	if (baseRendered.length < 2) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	if (ownedFrame && !isPolishedFrameSplit(ownedFrame, baseRendered.length)) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}

	const autocomplete = ownedFrame
		? { known: true, count: ownedFrame.trailingLines.length }
		: readAutocompleteCount(autocompleteSource, innerWidth, baseRendered.length);
	if (!autocomplete.known) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const editorFrame =
		!ownedFrame && autocomplete.count > 0
			? baseRendered.slice(0, -autocomplete.count)
			: baseRendered;
	const autocompleteLines = ownedFrame
		? ownedFrame.trailingLines
		: autocomplete.count > 0
			? baseRendered.slice(-autocomplete.count)
			: [];
	if (editorFrame.length < 2) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}

	const parsedTop = parseEditorBorder(editorFrame[0] ?? "", "above");
	const parsedBottom = parseEditorBorder(editorFrame.at(-1) ?? "", "below");
	if (!ownedFrame && !trustedBaseFrame && (!parsedTop || !parsedBottom)) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const editorLines = ownedFrame?.editorLines ?? editorFrame.slice(1, -1);
	const viewport = ownedFrame?.viewport ?? {
		above: parsedTop?.count,
		below: parsedBottom?.count,
	};
	const meta = renderEditorMetadataFormat(
		config.editorMetadataFormat,
		{
			model: modelMeta.modelLabel,
			modelId: modelMeta.modelId ?? "",
			modelName: modelMeta.modelName ?? "",
			provider: modelMeta.providerLabel,
			thinking: thinkingLevel ?? "",
			sessionName: modelMeta.sessionName ?? "",
		},
		uiTheme,
		config,
	);
	const copyFriendlyMeta = composeMetadataLine(meta, rightStatus, Math.max(0, width - 1));
	const railedMeta = composeMetadataLine(meta, rightStatus, innerWidth);

	const top = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorBorder,
		EDITOR_BORDER_FALLBACK,
		renderEditorBorder(
			width,
			"above",
			config.features.viewportIndicators ? viewport.above : undefined,
		),
	);
	const bottom = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorBorder,
		EDITOR_BORDER_FALLBACK,
		renderEditorBorder(
			width,
			"below",
			config.features.viewportIndicators ? viewport.below : undefined,
		),
	);
	const lines = ["", ...editorLines, "", railedMeta];
	const renderedLines = config.features.copyFriendly
		? [
				top,
				"",
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

	const clamped = clampRenderedLines(renderedLines, width);
	POLISHED_FRAME_SPLITS.set(clamped, {
		rows: Object.freeze([...clamped]),
		split: {
			editorLines,
			trailingLines: autocompleteLines.length > 0 ? clamped.slice(-autocompleteLines.length) : [],
			viewport,
		},
	});
	return { lines: clamped, decorated: true };
}

export class PolishedEditor extends CustomEditor {
	private readonly getModelMeta: () => EditorMeta;
	private readonly getThinkingLevel: () => string | undefined;
	private readonly getConfig: () => PolishedTuiConfig;
	private readonly uiTheme: Theme;

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
		try {
			return renderPolishedFrame({
				width,
				baseRendered: rendered,
				autocompleteSource: this as unknown as AutocompleteEditorInternals,
				uiTheme: this.uiTheme,
				config,
				modelMeta: this.getModelMeta(),
				thinkingLevel: this.getThinkingLevel(),
				trustedBaseFrame: true,
			}).lines;
		} catch {
			return clampRenderedLines(rendered, width);
		}
	}
}

export class WrappedPolishedEditor implements EditorComponent {
	declare readonly addToHistory?: (text: string) => void;
	declare readonly insertTextAtCursor?: (text: string) => void;
	declare readonly setAutocompleteProvider?: (provider: AutocompleteProvider) => void;
	declare readonly setPaddingX?: (padding: number) => void;
	declare readonly setAutocompleteMaxVisible?: (maxVisible: number) => void;

	constructor(
		private readonly base: WrappedEditor,
		private readonly uiTheme: Theme,
		private readonly getConfig: () => PolishedTuiConfig,
		private readonly getModelMeta: () => EditorMeta,
		private readonly getThinkingLevel: () => string | undefined,
	) {
		if (typeof base.addToHistory === "function") {
			this.addToHistory = (text) => base.addToHistory?.(text);
		}
		if (typeof base.insertTextAtCursor === "function") {
			this.insertTextAtCursor = (text) => base.insertTextAtCursor?.(text);
		}
		if (typeof base.setAutocompleteProvider === "function") {
			this.setAutocompleteProvider = (provider) => base.setAutocompleteProvider?.(provider);
		}
		if (typeof base.setPaddingX === "function") {
			this.setPaddingX = (padding) => base.setPaddingX?.(padding);
		}
		if (typeof base.setAutocompleteMaxVisible === "function") {
			this.setAutocompleteMaxVisible = (maxVisible) => base.setAutocompleteMaxVisible?.(maxVisible);
		}
	}

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
		let rendered: string[];
		try {
			rendered = this.base.render(innerWidth);
		} catch {
			return clampRenderedLines(this.base.render(width), width);
		}
		let result: PolishedFrameResult | undefined;
		try {
			const provenance = POLISHED_FRAME_SPLITS.get(rendered);
			const provenanceMatches = Boolean(
				provenance &&
					provenance.rows.length === rendered.length &&
					provenance.rows.every((line, index) => line === rendered[index]),
			);
			const ownedFrame = provenanceMatches ? provenance?.split : undefined;
			const hasMutatedProvenance = Boolean(provenance && !provenanceMatches);
			const hasUntrustedLegacySplitter = LEGACY_SPLIT_POLISHED_FRAME in this.base;
			const hasUnprovenPolishedFrame =
				!ownedFrame && Boolean(splitPolishedFrame(rendered, config, this.uiTheme));
			if (!hasMutatedProvenance && !hasUntrustedLegacySplitter && !hasUnprovenPolishedFrame) {
				result = renderPolishedFrame({
					width,
					baseRendered: rendered,
					autocompleteSource: this.base,
					uiTheme: this.uiTheme,
					config,
					modelMeta: this.getModelMeta(),
					thinkingLevel: this.getThinkingLevel(),
					rightStatus: readVimStatus(this.base, this.uiTheme),
					ownedFrame,
				});
			}
		} catch {
			// Decoration is optional; re-render the base at the caller's width below.
		}
		return result?.decorated ? result.lines : clampRenderedLines(this.base.render(width), width);
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

	getExpandedText(): string {
		return this.base.getExpandedText?.() ?? this.base.getText();
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
