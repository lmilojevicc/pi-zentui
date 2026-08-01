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
import type { EditorStyle, ZentuiConfig } from "./config";
import { renderEditorMetadataFormat } from "./editor-metadata-format";
import { type MinimalistEditorMetadata, renderMinimalistFrame } from "./minimalist-editor";
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
	config: ZentuiConfig;
	modelMeta: EditorMeta;
	thinkingLevel: string | undefined;
	rightStatus?: string;
	ownedFrame?: PolishedFrameSplit;
	trustedBaseFrame?: boolean;
	borderColor?: (text: string) => string;
};

type PolishedFrameResult = { lines: string[]; decorated: boolean };

type MinimalistFrameAdapterOptions = {
	width: number;
	baseRendered: string[];
	autocompleteSource: AutocompleteEditorInternals;
	uiTheme: Theme;
	config: ZentuiConfig;
	inputText: string;
	metadata: MinimalistEditorMetadata;
	ownedFrame?: PolishedFrameSplit;
	trustedBaseFrame?: boolean;
	borderColor?: (text: string) => string;
};

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

function isLowRailPolishedStyle(style: EditorStyle): boolean {
	return style === "polished-copy-friendly";
}

function selectedPolishedConfig(config: ZentuiConfig) {
	switch (config.components.editor.style) {
		case "polished":
			return config.components.editor.styles.polished;
		case "polished-copy-friendly":
			return config.components.editor.styles["polished-copy-friendly"];
		case "minimalist":
			return undefined;
	}
}

function lowRailPrompt(config: ZentuiConfig, uiTheme: Theme, reset: string): string {
	const promptIcon = config.icons.editorPrompt;
	return promptIcon
		? `${renderStyleForSourceOrFallback(
				uiTheme,
				config.components.editor.colorSource,
				config.colors.editorPrompt ?? config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				promptIcon,
			)}${reset} `
		: "";
}

function getEditorChromeWidths(config: ZentuiConfig, uiTheme: Theme, reset: string) {
	const lowRail = isLowRailPolishedStyle(config.components.editor.style);
	const prompt = lowRailPrompt(config, uiTheme, reset);
	const rail = lowRail
		? ""
		: `${renderStyleForSourceOrFallback(
				uiTheme,
				config.components.editor.colorSource,
				config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				config.icons.rail,
			)}${reset} `;
	return {
		prompt,
		promptWidth: visibleWidth(prompt),
		rail,
		railWidth: lowRail ? visibleWidth(prompt) : visibleWidth(rail),
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
	config: ZentuiConfig,
	uiTheme: Theme,
): { editorLines: string[]; viewport: ViewportCounts } | undefined {
	if (lines.length < 5) return undefined;
	const top = parseEditorBorder(lines[0] ?? "", "above");
	const bottom = parseEditorBorder(lines.at(-1) ?? "", "below");
	if (!top || !bottom) return undefined;

	const viewport = { above: top.count, below: bottom.count };
	const interior = lines.slice(1, -1);
	if (interior.length < 3) return undefined;

	if (isLowRailPolishedStyle(config.components.editor.style)) {
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
	config: ZentuiConfig,
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

function inspectPolishedFrameProvenance(
	base: WrappedEditor,
	rendered: string[],
	config: ZentuiConfig,
	uiTheme: Theme,
): { safe: boolean; ownedFrame?: PolishedFrameSplit } {
	const provenance = POLISHED_FRAME_SPLITS.get(rendered);
	const provenanceMatches = Boolean(
		provenance &&
			provenance.rows.length === rendered.length &&
			provenance.rows.every((line, index) => line === rendered[index]),
	);
	const ownedFrame = provenanceMatches ? provenance?.split : undefined;
	const unsafe =
		Boolean(provenance && !provenanceMatches) ||
		LEGACY_SPLIT_POLISHED_FRAME in base ||
		(!ownedFrame && Boolean(splitPolishedFrame(rendered, config, uiTheme)));
	return { safe: !unsafe, ownedFrame };
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

function renderMinimalistFrameFromBase({
	width,
	baseRendered,
	autocompleteSource,
	uiTheme,
	config,
	inputText,
	metadata,
	ownedFrame,
	trustedBaseFrame = false,
	borderColor,
}: MinimalistFrameAdapterOptions): PolishedFrameResult {
	if (width <= 4 || baseRendered.length < 2) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	if (ownedFrame && !isPolishedFrameSplit(ownedFrame, baseRendered.length)) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const autocomplete = ownedFrame
		? { known: true as const, count: ownedFrame.trailingLines.length }
		: readAutocompleteCount(autocompleteSource, Math.max(0, width - 4), baseRendered.length);
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
	const viewport = ownedFrame?.viewport ?? {
		above: parsedTop?.count,
		below: parsedBottom?.count,
	};
	return {
		lines: renderMinimalistFrame({
			width,
			editorLines: ownedFrame?.editorLines ?? editorFrame.slice(1, -1),
			autocompleteLines,
			viewport: config.components.editor.viewportIndicators ? viewport : undefined,
			inputText,
			metadata,
			uiTheme,
			config,
			borderColor,
		}),
		decorated: true,
	};
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
	borderColor,
}: PolishedFrameOptions): PolishedFrameResult {
	if (width <= 2) return { lines: clampRenderedLines(baseRendered, width), decorated: false };

	const reset = "\x1b[0m";
	const colorSource = config.components.editor.colorSource;
	const { prompt, promptWidth, rail, railWidth } = getEditorChromeWidths(config, uiTheme, reset);
	const innerWidth = Math.max(0, width - railWidth);
	const lowRailContinuation = " ".repeat(promptWidth);

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
		selectedPolishedConfig(config)?.metadataFormat ??
			config.components.editor.styles.polished.metadataFormat,
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
	const lowRailMeta = composeMetadataLine(meta, rightStatus, Math.max(0, width - 1));
	const railedMeta = composeMetadataLine(meta, rightStatus, innerWidth);

	const renderStaticBorder = (text: string) =>
		renderStyleForSourceOrFallback(
			uiTheme,
			colorSource,
			config.colors.editorBorder,
			EDITOR_BORDER_FALLBACK,
			text,
		);
	const renderBorder = (text: string) => {
		if (
			config.components.editor.borderColorMode !== "adaptive" ||
			typeof borderColor !== "function"
		) {
			return renderStaticBorder(text);
		}
		try {
			const rendered = borderColor(text);
			return typeof rendered === "string" ? rendered : renderStaticBorder(text);
		} catch {
			return renderStaticBorder(text);
		}
	};
	const top = renderBorder(
		renderEditorBorder(
			width,
			"above",
			config.components.editor.viewportIndicators ? viewport.above : undefined,
		),
	);
	const bottom = renderBorder(
		renderEditorBorder(
			width,
			"below",
			config.components.editor.viewportIndicators ? viewport.below : undefined,
		),
	);
	const lines = ["", ...editorLines, "", railedMeta];
	const renderedLines = isLowRailPolishedStyle(config.components.editor.style)
		? [
				top,
				"",
				...editorLines.map(
					(line, index) =>
						`${index === 0 ? prompt : lowRailContinuation}${fillLine(line, innerWidth)}`,
				),
				"",
				` ${truncateToWidth(lowRailMeta, Math.max(0, width - 1), "")}`,
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
	private readonly getMinimalistMetadata: () => MinimalistEditorMetadata;
	private readonly onMinimalistDecorationChange: (active: boolean) => void;
	private readonly getConfig: () => ZentuiConfig;
	private readonly uiTheme: Theme;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		uiTheme: Theme,
		getConfig: () => ZentuiConfig,
		getModelMeta: () => EditorMeta,
		getThinkingLevel: () => string | undefined,
		getMinimalistMetadata: () => MinimalistEditorMetadata = () => ({ cwd: "" }),
		onMinimalistDecorationChange: (active: boolean) => void = () => {},
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.borderColor = (text: string) => safeThemeFg(uiTheme, "border", text);
		this.uiTheme = uiTheme;
		this.getConfig = getConfig;
		this.getModelMeta = getModelMeta;
		this.getThinkingLevel = getThinkingLevel;
		this.getMinimalistMetadata = getMinimalistMetadata;
		this.onMinimalistDecorationChange = onMinimalistDecorationChange;
	}

	private reportMinimalistDecoration(active: boolean): void {
		this.onMinimalistDecorationChange(active);
	}

	render(width: number): string[] {
		const config = this.getConfig();
		if (config.components.editor.style === "minimalist") {
			if (width <= 4) {
				this.reportMinimalistDecoration(false);
				return clampRenderedLines(super.render(width), width);
			}
			try {
				const rendered = super.render(Math.max(0, width - 4));
				const result = renderMinimalistFrameFromBase({
					width,
					baseRendered: rendered,
					autocompleteSource: this as unknown as AutocompleteEditorInternals,
					uiTheme: this.uiTheme,
					config,
					inputText: this.getText(),
					metadata: this.getMinimalistMetadata(),
					trustedBaseFrame: true,
					borderColor: this.borderColor,
				});
				this.reportMinimalistDecoration(result.decorated);
				return result.lines;
			} catch {
				this.reportMinimalistDecoration(false);
				return clampRenderedLines(super.render(width), width);
			}
		}
		this.reportMinimalistDecoration(false);
		if (width <= 2) {
			return clampRenderedLines(super.render(width), width);
		}

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
				borderColor: this.borderColor,
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
		private readonly getConfig: () => ZentuiConfig,
		private readonly getModelMeta: () => EditorMeta,
		private readonly getThinkingLevel: () => string | undefined,
		private readonly getMinimalistMetadata: () => MinimalistEditorMetadata = () => ({ cwd: "" }),
		private readonly onMinimalistDecorationChange: (active: boolean) => void = () => {},
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

	private reportMinimalistDecoration(active: boolean): void {
		this.onMinimalistDecorationChange(active);
	}

	render(width: number): string[] {
		const config = this.getConfig();
		if (config.components.editor.style === "minimalist") {
			if (width <= 4) {
				this.reportMinimalistDecoration(false);
				return clampRenderedLines(this.base.render(width), width);
			}
			let rendered: string[];
			try {
				rendered = this.base.render(Math.max(0, width - 4));
			} catch {
				this.reportMinimalistDecoration(false);
				return clampRenderedLines(this.base.render(width), width);
			}
			try {
				const provenance = inspectPolishedFrameProvenance(
					this.base,
					rendered,
					config,
					this.uiTheme,
				);
				if (provenance.safe) {
					const result = renderMinimalistFrameFromBase({
						width,
						baseRendered: rendered,
						autocompleteSource: this.base,
						uiTheme: this.uiTheme,
						config,
						inputText: this.base.getText(),
						metadata: this.getMinimalistMetadata(),
						ownedFrame: provenance.ownedFrame,
						borderColor: this.borderColor,
					});
					if (result.decorated) {
						this.reportMinimalistDecoration(true);
						return result.lines;
					}
				}
			} catch {
				// Decoration is optional; re-render the base at the caller's width below.
			}
			this.reportMinimalistDecoration(false);
			return clampRenderedLines(this.base.render(width), width);
		}
		this.reportMinimalistDecoration(false);
		if (width <= 2) return clampRenderedLines(this.base.render(width), width);

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
			const provenance = inspectPolishedFrameProvenance(this.base, rendered, config, this.uiTheme);
			if (provenance.safe) {
				result = renderPolishedFrame({
					width,
					baseRendered: rendered,
					autocompleteSource: this.base,
					uiTheme: this.uiTheme,
					config,
					modelMeta: this.getModelMeta(),
					thinkingLevel: this.getThinkingLevel(),
					rightStatus: readVimStatus(this.base, this.uiTheme),
					ownedFrame: provenance.ownedFrame,
					borderColor: this.borderColor,
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
