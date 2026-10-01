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
import { ACCENT_RAIL_CHROME_WIDTH, renderAccentRailEditorFrame } from "./accent-rail-editor";
import type { CodexQuota } from "./codex-quota";
import { renderCodexQuota } from "./codex-quota-display";
import { omitTrailingNativeCompletionCountRow, renderCompletionPalette } from "./completion-menu";
import { componentColor, editorShellColor } from "./component-colors";
import type { EditorStyle, ZentuiConfig } from "./config";
import {
	type EditorMetadataZones,
	renderEditorMetadataFormatSplit,
	sanitizeEditorMetadataText,
} from "./editor-metadata-format";
import {
	EditorMouseForwarder,
	type EditorMouseHandler,
	editorMouseCells,
	rememberEditorMouseLayout,
} from "./editor-mouse";
import { collectFooterFormatReferences, parseFooterFormat } from "./footer-format";
import { bashModeLabel } from "./format";
import { type MinimalistEditorMetadata, renderMinimalistFrame } from "./minimalist-editor";
import { minimalistTemplateReferences } from "./minimalist-template";
import {
	EDITOR_ACCENT_FALLBACK,
	EDITOR_BORDER_FALLBACK,
	renderStyleForSourceOrFallback,
	safeThemeFg,
} from "./style";

// Reserve at least four label cells beside Minimalist metadata.
const MIN_WORKING_LINE_BORDER_WIDTH = 16;

const LEGACY_SPLIT_POLISHED_FRAME = Symbol.for("pi-zentui.polished-frame");

export type ViewportCounts = {
	above?: string;
	below?: string;
};

type PolishedFrameSplit = {
	editorLines: string[];
	/** Logical, unframed autocomplete payload rows owned by this module. */
	trailingLines: string[];
	viewport: ViewportCounts;
};

type PolishedFrameProvenance = {
	rows: readonly string[];
	split: PolishedFrameSplit;
};

const POLISHED_FRAME_SPLITS = new WeakMap<string[], PolishedFrameProvenance>();

type AutocompleteListInternals = Pick<Component, "render">;

type AutocompleteEditorInternals = {
	autocompleteList?: AutocompleteListInternals;
	isShowingAutocomplete?: () => boolean;
	getPaddingX?: () => number;
};

type AutocompleteCapture = {
	compatible: boolean;
	called: number;
	rows: string[];
};

type WrappedEditor = EditorComponent &
	AutocompleteEditorInternals & {
		handleMouse?: EditorMouseHandler;
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

export type EditorMeta = {
	codexQuota?: CodexQuota;
	modelLabel: string;
	modelId?: string;
	modelName?: string;
	providerLabel: string;
	sessionName?: string;
	contextPercent?: number;
	contextWindow?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheHitRate?: number;
	customVariables?: ReadonlyMap<string, string>;
};

export type PolishedEditorFrameOptions = {
	width: number;
	editorLines: string[];
	autocompleteLines?: string[];
	viewport?: ViewportCounts;
	uiTheme: Theme;
	config: ZentuiConfig;
	modelMeta: EditorMeta;
	thinkingLevel?: string;
	rightStatus?: string;
	workingLineFrame?: string;
	shellMode?: boolean;
	borderColor?: (text: string) => string;
};

type PolishedFrameOptions = {
	width: number;
	baseWidth: number;
	baseRendered: string[];
	autocompleteSource: AutocompleteEditorInternals;
	autocompleteCapture?: AutocompleteCapture;
	uiTheme: Theme;
	config: ZentuiConfig;
	modelMeta: EditorMeta;
	thinkingLevel: string | undefined;
	rightStatus?: string;
	shellMode?: boolean;
	ownedFrame?: PolishedFrameSplit;
	trustedBaseFrame?: boolean;
	getWorkingLineFrame: () => string | undefined;
	reportWorkingLineBorder: (active: boolean) => void;
	borderColor?: (text: string) => string;
};

type PolishedFrameResult = {
	lines: string[];
	decorated: boolean;
};

type AccentRailFrameAdapterOptions = {
	codexQuota?: CodexQuota;
	width: number;
	baseWidth: number;
	baseRendered: string[];
	autocompleteSource: AutocompleteEditorInternals;
	autocompleteCapture?: AutocompleteCapture;
	uiTheme: Theme;
	config: ZentuiConfig;
	ownedFrame?: PolishedFrameSplit;
	trustedBaseFrame?: boolean;
};

type MinimalistFrameAdapterOptions = {
	width: number;
	baseWidth: number;
	baseRendered: string[];
	autocompleteSource: AutocompleteEditorInternals;
	autocompleteCapture?: AutocompleteCapture;
	uiTheme: Theme;
	config: ZentuiConfig;
	inputText: string;
	getMetadata: () => MinimalistEditorMetadata;
	reportWorkingLineBorder: (active: boolean) => void;
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

function stripNativeRightPadding(value: string): string {
	return value.replace(/ +$/, "");
}

// Mirrors the native editor's per-render padding clamp: effective horizontal
// padding never exceeds half of the rendered width.
function nativeHorizontalPadding(source: AutocompleteEditorInternals, baseWidth: number): number {
	try {
		if (typeof source.getPaddingX !== "function") return 0;
		const padding = source.getPaddingX.call(source);
		if (!Number.isFinite(padding)) return 0;
		const maxPadding = Math.max(0, Math.floor((baseWidth - 1) / 2));
		return Math.min(Math.max(0, Math.floor(padding)), maxPadding);
	} catch {
		return 0;
	}
}

function autocompleteCount(
	source: AutocompleteEditorInternals,
	capture: AutocompleteCapture | undefined,
	baseRendered: string[],
	baseWidth: number,
): AutocompleteCount {
	try {
		const showing = source.isShowingAutocomplete;
		if (typeof showing !== "function" || !showing.call(source)) return { known: true, count: 0 };
		if (
			!capture?.compatible ||
			capture.called !== 1 ||
			capture.rows.length <= 0 ||
			capture.rows.length >= baseRendered.length
		)
			return { known: false };
		const paddingX = nativeHorizontalPadding(source, baseWidth);
		const leftPadding = " ".repeat(paddingX);
		const suffix = baseRendered.slice(-capture.rows.length);
		if (
			!suffix.every((line, index) => {
				const captured = capture.rows[index];
				const unpadded =
					paddingX > 0 && line.startsWith(leftPadding) ? line.slice(leftPadding.length) : line;
				return (
					captured !== undefined &&
					(line === captured ||
						stripNativeRightPadding(unpadded) === stripNativeRightPadding(captured))
				);
			})
		)
			return { known: false };
		return { known: true, count: capture.rows.length };
	} catch {
		return { known: false };
	}
}

// The native editor renders autocomplete rows wrapped in its horizontal
// padding; prefer the raw captured rows so decoration starts at column zero.
function capturedAutocompleteLines(
	capture: AutocompleteCapture | undefined,
	baseRendered: string[],
	count: number,
): string[] {
	if (count <= 0) return [];
	return capture && capture.rows.length === count ? capture.rows : baseRendered.slice(-count);
}

/** @internal Exported only for descriptor-safety regression tests. */
export function renderWithAutocompleteCapture<T>(
	source: AutocompleteEditorInternals,
	render: () => T,
): { value: T; capture?: AutocompleteCapture } {
	let showing = false;
	try {
		showing =
			typeof source.isShowingAutocomplete === "function" &&
			source.isShowingAutocomplete.call(source);
	} catch {
		return { value: render() };
	}
	if (!showing) return { value: render(), capture: { compatible: true, called: 0, rows: [] } };

	let list: AutocompleteListInternals;
	let own: PropertyDescriptor | undefined;
	let predecessor: (...args: unknown[]) => unknown;
	try {
		const candidate = source.autocompleteList;
		if (!candidate) return { value: render() };
		own = Object.getOwnPropertyDescriptor(candidate, "render");
		const current = Reflect.get(candidate, "render");
		if (typeof current !== "function") return { value: render() };
		if (own && (!("value" in own) || own.writable !== true)) return { value: render() };
		if (!own && !Object.isExtensible(candidate)) return { value: render() };
		list = candidate;
		predecessor = current as (...args: unknown[]) => unknown;
	} catch {
		return { value: render() };
	}

	const capture: AutocompleteCapture = { compatible: true, called: 0, rows: [] };
	const wrapper = function (this: AutocompleteListInternals, ...args: unknown[]) {
		const result = Reflect.apply(predecessor, this, args);
		capture.called++;
		if (!isStringArray(result)) {
			capture.compatible = false;
			return result;
		}
		capture.rows = [...result];
		return result;
	};
	const installedDescriptor: PropertyDescriptor = {
		...(own ?? { configurable: true, enumerable: false, writable: true }),
		value: wrapper,
	};
	try {
		Object.defineProperty(list, "render", installedDescriptor);
	} catch {
		return { value: render() };
	}

	try {
		return { value: render(), capture };
	} finally {
		let current: PropertyDescriptor | undefined;
		let currentValue: unknown;
		let descriptorKnown = true;
		try {
			current = Object.getOwnPropertyDescriptor(list, "render");
			currentValue = current && "value" in current ? current.value : Reflect.get(list, "render");
		} catch {
			descriptorKnown = false;
			try {
				currentValue = Reflect.get(list, "render");
			} catch {
				currentValue = undefined;
			}
		}
		if (currentValue === wrapper) {
			if (
				!descriptorKnown ||
				!current ||
				current.configurable !== installedDescriptor.configurable ||
				current.enumerable !== installedDescriptor.enumerable ||
				current.writable !== installedDescriptor.writable
			)
				capture.compatible = false;
			try {
				if (own) Object.defineProperty(list, "render", own);
				else if (!Reflect.deleteProperty(list, "render")) capture.compatible = false;
			} catch {
				capture.compatible = false;
			}
		} else {
			// A synchronous third-party replacement wins; captured semantics are no longer trustworthy.
			capture.compatible = false;
		}
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
	return style === "opencode-copy-friendly";
}

function isShellModeInput(text: string): boolean {
	return bashModeLabel(text) !== "";
}

export function editorWantsContext(config: ZentuiConfig): boolean {
	const editor = config.components.editor;
	if (!editor.enabled || editor.style === "accent-rail") return false;
	if (editor.style === "minimalist")
		return minimalistTemplateReferences(editor.styles.minimalist).has("context");
	return collectFooterFormatReferences(
		parseFooterFormat(sanitizeEditorMetadataText(editor.styles[editor.style].metadataFormat)),
	).has("context");
}

function selectedPolishedConfig(config: ZentuiConfig) {
	switch (config.components.editor.style) {
		case "opencode":
			return config.components.editor.styles.opencode;
		case "opencode-copy-friendly":
			return config.components.editor.styles["opencode-copy-friendly"];
		case "accent-rail":
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
				componentColor(config, "editor", "prompt") ?? componentColor(config, "editor", "accent"),
				EDITOR_ACCENT_FALLBACK,
				promptIcon,
			)}${reset} `
		: "";
}

function getEditorChromeWidths(
	config: ZentuiConfig,
	uiTheme: Theme,
	reset: string,
	shellMode = false,
) {
	const lowRail = isLowRailPolishedStyle(config.components.editor.style);
	const prompt = lowRailPrompt(config, uiTheme, reset);
	const chromeColor = shellMode
		? editorShellColor(config)
		: { color: componentColor(config, "editor", "accent"), fallback: EDITOR_ACCENT_FALLBACK };
	const rail = lowRail
		? ""
		: `${renderStyleForSourceOrFallback(
				uiTheme,
				config.components.editor.colorSource,
				chromeColor.color,
				chromeColor.fallback,
				config.icons.rail,
			)}${reset} `;
	return {
		prompt,
		promptWidth: visibleWidth(prompt),
		rail,
		railWidth: lowRail ? visibleWidth(prompt) : visibleWidth(rail),
	};
}

export function composeEditorMetadataLine(
	{ left, middle, right }: EditorMetadataZones,
	rightStatus: string | undefined,
	width: number,
): string {
	const maxWidth = Math.max(0, width);

	// Preserve the legacy no-fill path exactly, including deferring left-only
	// truncation to the style-specific frame clamp below.
	if (!middle && !right) {
		if (!rightStatus) return left;
		const rightStatusWidth = visibleWidth(rightStatus);
		if (rightStatusWidth >= maxWidth) return truncateToWidth(rightStatus, maxWidth, "");

		const leftBudget = Math.max(0, maxWidth - rightStatusWidth - 1);
		const leftText = truncateToWidth(left, leftBudget, "");
		const gap = " ".repeat(Math.max(1, maxWidth - visibleWidth(leftText) - rightStatusWidth));
		return `${leftText}${gap}${rightStatus}`;
	}

	const statusText = rightStatus ? truncateToWidth(rightStatus, maxWidth, "") : "";
	const statusWidth = visibleWidth(statusText);
	const leftBudget = Math.max(0, maxWidth - statusWidth - (statusText && left ? 1 : 0));
	const leftText = truncateToWidth(left, leftBudget, "");
	const leftWidth = visibleWidth(leftText);

	const rightBudget = Math.max(
		0,
		maxWidth - leftWidth - statusWidth - (leftText ? 1 : 0) - (statusText ? 1 : 0),
	);
	const configuredRight = truncateToWidth(right, rightBudget, "");
	const rightText =
		configuredRight && statusText
			? `${configuredRight} ${statusText}`
			: configuredRight || statusText;
	const rightWidth = visibleWidth(rightText);
	const gapWidth = Math.max(0, maxWidth - leftWidth - rightWidth);
	const middleWidth = visibleWidth(middle);
	const minimumMiddleGap = (leftText ? 1 : 0) + (rightText ? 1 : 0);

	if (!middle || middleWidth + minimumMiddleGap > gapWidth) {
		return `${leftText}${" ".repeat(gapWidth)}${rightText}`;
	}

	const availablePadding = gapWidth - middleWidth;
	const minimumLeftPadding = leftText ? 1 : 0;
	const maximumLeftPadding = availablePadding - (rightText ? 1 : 0);
	const leftPadding = Math.min(
		maximumLeftPadding,
		Math.max(minimumLeftPadding, Math.floor(availablePadding / 2)),
	);
	return `${leftText}${" ".repeat(leftPadding)}${middle}${" ".repeat(
		availablePadding - leftPadding,
	)}${rightText}`;
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
	const match = new RegExp(`^─{3,} ${arrow} ([1-9]\\d*) more ─*$`).exec(plain);
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
	shellMode = false,
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

	const { rail } = getEditorChromeWidths(config, uiTheme, "\x1b[0m", shellMode);
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
	shellMode = false,
): PolishedFrameSplit | undefined {
	if (!parseEditorBorder(lines[0] ?? "", "above")) return undefined;

	for (let bottomIndex = lines.length - 1; bottomIndex >= 4; bottomIndex--) {
		if (!parseEditorBorder(lines[bottomIndex] ?? "", "below")) continue;
		const frame = unwrapPolishedFrameOnly(
			lines.slice(0, bottomIndex + 1),
			config,
			uiTheme,
			shellMode,
		);
		if (frame) return { ...frame, trailingLines: lines.slice(bottomIndex + 1) };
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
		// A predecessor may return cached rows from either input mode.
		(!ownedFrame &&
			Boolean(
				splitPolishedFrame(rendered, config, uiTheme) ||
					splitPolishedFrame(rendered, config, uiTheme, true),
			));
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

function renderAccentRailFrameFromBase({
	codexQuota,
	width,
	baseWidth,
	baseRendered,
	autocompleteSource,
	autocompleteCapture,
	uiTheme,
	config,
	ownedFrame,
	trustedBaseFrame = false,
}: AccentRailFrameAdapterOptions): PolishedFrameResult {
	if (width < ACCENT_RAIL_CHROME_WIDTH + 1 || baseRendered.length < 2) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	if (ownedFrame && !isPolishedFrameSplit(ownedFrame, baseRendered.length)) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const autocomplete = ownedFrame
		? { known: true as const, count: ownedFrame.trailingLines.length }
		: autocompleteCount(autocompleteSource, autocompleteCapture, baseRendered, baseWidth);
	if (!autocomplete.known) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const editorFrame =
		!ownedFrame && autocomplete.count > 0
			? baseRendered.slice(0, -autocomplete.count)
			: baseRendered;
	const autocompleteLines = ownedFrame
		? ownedFrame.trailingLines
		: capturedAutocompleteLines(autocompleteCapture, baseRendered, autocomplete.count);
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
	const quotaRow = renderCodexQuota(codexQuota, uiTheme, config, "editor");
	const quotaVisible = quotaRow && visibleWidth(quotaRow) <= width - ACCENT_RAIL_CHROME_WIDTH;
	const renderedLines = renderAccentRailEditorFrame({
		codexQuota,
		width,
		editorLines,
		autocompleteLines,
		viewport,
		uiTheme,
		config,
	});
	const lines = renderedLines.length === 1 ? ["", ...renderedLines, ""] : renderedLines;
	const bodyStart =
		(renderedLines.length === 1 ? 1 : 0) +
		(config.components.editor.viewportIndicators && viewport.above ? 1 : 0);
	rememberEditorMouseLayout(lines, baseRendered, editorLines.length, autocompleteLines.length, {
		body: editorMouseCells(editorLines.length, ACCENT_RAIL_CHROME_WIDTH, bodyStart),
		completion: editorMouseCells(
			autocompleteLines.length,
			0,
			bodyStart +
				editorLines.length +
				(quotaVisible ? 1 : 0) +
				(config.components.editor.viewportIndicators && viewport.below ? 1 : 0),
		),
	});
	POLISHED_FRAME_SPLITS.set(lines, {
		rows: Object.freeze([...lines]),
		split: { editorLines, trailingLines: autocompleteLines, viewport },
	});
	return { lines, decorated: true };
}

function renderMinimalistFrameFromBase({
	width,
	baseWidth,
	baseRendered,
	autocompleteSource,
	autocompleteCapture,
	uiTheme,
	config,
	inputText,
	getMetadata,
	reportWorkingLineBorder,
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
		: autocompleteCount(autocompleteSource, autocompleteCapture, baseRendered, baseWidth);
	if (!autocomplete.known) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const editorFrame =
		!ownedFrame && autocomplete.count > 0
			? baseRendered.slice(0, -autocomplete.count)
			: baseRendered;
	const autocompleteLines = ownedFrame
		? ownedFrame.trailingLines
		: capturedAutocompleteLines(autocompleteCapture, baseRendered, autocomplete.count);
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
	const editorLines = ownedFrame?.editorLines ?? editorFrame.slice(1, -1);
	// Publish safe geometry before reading the controller-gated Working frame.
	reportWorkingLineBorder(
		width >= MIN_WORKING_LINE_BORDER_WIDTH &&
			Boolean(
				ownedFrame ||
					(typeof autocompleteSource.isShowingAutocomplete === "function" &&
						autocompleteCapture?.compatible),
			),
	);
	const metadata = getMetadata();
	const lines = renderMinimalistFrame({
		width,
		editorLines,
		autocompleteLines,
		viewport: config.components.editor.viewportIndicators ? viewport : undefined,
		inputText,
		metadata,
		uiTheme,
		config,
		borderColor,
	});
	rememberEditorMouseLayout(lines, baseRendered, editorLines.length, autocompleteLines.length, {
		body: editorMouseCells(editorLines.length, 2, 1),
		completion: editorMouseCells(autocompleteLines.length, 2, editorLines.length + 2),
	});
	return { lines, decorated: true };
}

function renderPolishedFrame({
	width,
	baseWidth,
	baseRendered,
	autocompleteSource,
	autocompleteCapture,
	uiTheme,
	config,
	modelMeta,
	thinkingLevel,
	rightStatus,
	shellMode = false,
	ownedFrame,
	trustedBaseFrame = false,
	getWorkingLineFrame,
	reportWorkingLineBorder,
	borderColor,
}: PolishedFrameOptions): PolishedFrameResult {
	if (width <= 2) return { lines: clampRenderedLines(baseRendered, width), decorated: false };

	if (baseRendered.length < 2) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	if (ownedFrame && !isPolishedFrameSplit(ownedFrame, baseRendered.length)) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}

	const autocomplete = ownedFrame
		? { known: true, count: ownedFrame.trailingLines.length }
		: autocompleteCount(autocompleteSource, autocompleteCapture, baseRendered, baseWidth);
	if (!autocomplete.known) {
		return { lines: clampRenderedLines(baseRendered, width), decorated: false };
	}
	const editorFrame =
		!ownedFrame && autocomplete.count > 0
			? baseRendered.slice(0, -autocomplete.count)
			: baseRendered;
	const autocompleteLines = ownedFrame
		? ownedFrame.trailingLines
		: capturedAutocompleteLines(autocompleteCapture, baseRendered, autocomplete.count);
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
	// Publish safe geometry before reading the controller-gated Working frame.
	reportWorkingLineBorder(
		width >= MIN_WORKING_LINE_BORDER_WIDTH &&
			Boolean(
				ownedFrame ||
					(typeof autocompleteSource.isShowingAutocomplete === "function" &&
						autocompleteCapture?.compatible),
			),
	);
	const workingLineFrame = getWorkingLineFrame();
	const lines = renderPolishedEditorFrame({
		width,
		editorLines,
		autocompleteLines,
		viewport,
		uiTheme,
		config,
		modelMeta,
		thinkingLevel,
		rightStatus,
		workingLineFrame,
		shellMode,
		borderColor,
	});
	const { railWidth } = getEditorChromeWidths(config, uiTheme, "\x1b[0m", shellMode);
	const completionCount =
		selectedPolishedConfig(config)?.completionMenu === "palette"
			? omitTrailingNativeCompletionCountRow(autocompleteLines).length
			: autocompleteLines.length;
	rememberEditorMouseLayout(lines, baseRendered, editorLines.length, autocompleteLines.length, {
		body: editorMouseCells(editorLines.length, railWidth, 2),
		completion: editorMouseCells(completionCount, 0, editorLines.length + 5),
	});
	POLISHED_FRAME_SPLITS.set(lines, {
		rows: Object.freeze([...lines]),
		split: {
			editorLines,
			trailingLines: autocompleteLines,
			viewport,
		},
	});
	return { lines, decorated: true };
}

/** Pure Opencode frame composition shared by the live editor and settings preview. */
export function renderPolishedEditorFrame({
	width,
	editorLines,
	autocompleteLines = [],
	viewport = {},
	uiTheme,
	config,
	modelMeta,
	thinkingLevel,
	rightStatus,
	workingLineFrame,
	shellMode = false,
	borderColor,
}: PolishedEditorFrameOptions): string[] {
	if (width <= 2) return clampRenderedLines(editorLines, width);
	const reset = "\x1b[0m";
	const colorSource = config.components.editor.colorSource;
	const { prompt, promptWidth, rail, railWidth } = getEditorChromeWidths(
		config,
		uiTheme,
		reset,
		shellMode,
	);
	const innerWidth = Math.max(0, width - railWidth);
	const lowRailContinuation = " ".repeat(promptWidth);
	const renderMetadata = (codexQuota?: CodexQuota, includeCustom = true) =>
		renderEditorMetadataFormatSplit(
			selectedPolishedConfig(config)?.metadataFormat ??
				config.components.editor.styles.opencode.metadataFormat,
			{
				codexQuota,
				model: modelMeta.modelLabel,
				modelId: modelMeta.modelId ?? "",
				modelName: modelMeta.modelName ?? "",
				provider: modelMeta.providerLabel,
				thinking: thinkingLevel ?? "",
				sessionName: modelMeta.sessionName ?? "",
				contextPercent: modelMeta.contextPercent,
				contextWindow: modelMeta.contextWindow,
				inputTokens: modelMeta.inputTokens,
				outputTokens: modelMeta.outputTokens,
				cacheHitRate: modelMeta.cacheHitRate,
				customVariables: includeCustom ? modelMeta.customVariables : undefined,
			},
			uiTheme,
			config,
			shellMode,
		);
	let metadataZones = renderMetadata(modelMeta.codexQuota);
	// Quota is atomic: never clip away its labels or trailing stale warning.
	const metadataBudget = isLowRailPolishedStyle(config.components.editor.style)
		? width - 1
		: innerWidth;
	const naturalWidth = () =>
		Object.values(metadataZones).reduce((sum, zone) => sum + visibleWidth(zone), 0) +
		Object.values(metadataZones).filter(Boolean).length -
		1 +
		(rightStatus ? visibleWidth(rightStatus) + 1 : 0);
	// Configured extension values yield whole before any built-in metadata is cropped.
	const includeCustom = naturalWidth() <= metadataBudget;
	if (!includeCustom) metadataZones = renderMetadata(modelMeta.codexQuota, false);
	if (modelMeta.codexQuota && naturalWidth() > metadataBudget)
		metadataZones = renderMetadata(undefined, includeCustom);
	const lowRailMeta = composeEditorMetadataLine(metadataZones, rightStatus, Math.max(0, width - 1));
	const railedMeta = composeEditorMetadataLine(metadataZones, rightStatus, innerWidth);

	const renderStaticBorder = (text: string) =>
		renderStyleForSourceOrFallback(
			uiTheme,
			colorSource,
			componentColor(config, "editor", "border"),
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
	let top = renderBorder(
		renderEditorBorder(
			width,
			"above",
			config.components.editor.viewportIndicators ? viewport.above : undefined,
		),
	);
	if (workingLineFrame && width >= MIN_WORKING_LINE_BORDER_WIDTH) {
		const label = truncateToWidth(workingLineFrame, width - 6, "…");
		top = `${renderBorder("── ")}${label}${renderBorder(
			` ${renderEditorBorder(
				width - visibleWidth(label) - 4,
				"above",
				config.components.editor.viewportIndicators ? viewport.above : undefined,
			)}`,
		)}`;
	}
	const bottom = renderBorder(
		renderEditorBorder(
			width,
			"below",
			config.components.editor.viewportIndicators ? viewport.below : undefined,
		),
	);
	const completionLines =
		selectedPolishedConfig(config)?.completionMenu === "palette"
			? renderCompletionPalette({
					lines: autocompleteLines,
					width,
					theme: uiTheme,
					renderSeparator: renderBorder,
					ownedBackground: false,
				})
			: autocompleteLines;
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
				...completionLines,
			]
		: [
				top,
				...lines.map((line) => `${rail}${fillLine(line, innerWidth)}`),
				bottom,
				...completionLines,
			];

	return clampRenderedLines(renderedLines, width);
}

export class PolishedEditor extends CustomEditor {
	private readonly getModelMeta: () => EditorMeta;
	private readonly getThinkingLevel: () => string | undefined;
	private readonly getMinimalistMetadata: () => MinimalistEditorMetadata;
	private readonly onMinimalistDecorationChange: (active: boolean) => void;
	private readonly getConfig: () => ZentuiConfig;
	private readonly uiTheme: Theme;

	private readonly mouse = new EditorMouseForwarder();
	private workingLineBorderCapable = false;
	private metadataDecorated = false;
	private metadataDecoratedStyle?: EditorStyle;

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
		private readonly onWorkingLineBorderCapabilityChange: () => void = () => {},
		private readonly onMetadataDecorationChange: () => void = () => {},
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.borderColor = (text: string) => safeThemeFg(uiTheme, "border", text);
		this.uiTheme = uiTheme;
		this.getConfig = getConfig;
		this.getModelMeta = getModelMeta;
		this.getThinkingLevel = getThinkingLevel;
		this.getMinimalistMetadata = getMinimalistMetadata;
		this.onMinimalistDecorationChange = onMinimalistDecorationChange;
		// Pi defines focused as an instance field; observe its public focus lifecycle
		// without shadowing the native cursor's value with a prototype accessor.
		let focused = this.focused;
		Object.defineProperty(this, "focused", {
			configurable: true,
			enumerable: true,
			get: () => focused,
			set: (value: boolean) => {
				focused = value;
				if (!value) this.reportWorkingLineBorder(false);
			},
		});
		// Resolve subclass prototype overrides before installing the instance adapter.
		// Their super call reaches the native prototype directly, so translate once.
		const handleMouse = (this as unknown as { handleMouse?: EditorMouseHandler }).handleMouse;
		if (typeof handleMouse === "function") {
			Object.defineProperty(this, "handleMouse", {
				value: (event: Parameters<EditorMouseHandler>[0]) =>
					this.mouse.forward(this, handleMouse, event),
				writable: true,
				configurable: true,
			});
		}
	}

	isMetadataDecorated(): boolean {
		return (
			this.metadataDecorated &&
			this.metadataDecoratedStyle === this.getConfig().components.editor.style
		);
	}
	private reportMetadataDecoration(active: boolean): void {
		const style = active ? this.getConfig().components.editor.style : undefined;
		if (this.metadataDecorated === active && this.metadataDecoratedStyle === style) return;
		this.metadataDecorated = active;
		this.metadataDecoratedStyle = style;
		this.onMetadataDecorationChange();
	}

	private reportMinimalistDecoration(active: boolean): void {
		this.onMinimalistDecorationChange(active);
	}

	private renderBase(width: number): string[] {
		return this.mouse.baseRendered(width, super.render(width));
	}

	canEmbedWorkingLineBorder(): boolean {
		return this.focused && this.workingLineBorderCapable;
	}

	private reportWorkingLineBorder = (active: boolean): void => {
		active = active && this.focused;
		if (this.workingLineBorderCapable === active) return;
		this.workingLineBorderCapable = active;
		this.onWorkingLineBorderCapabilityChange();
	};

	private renderFallback(lines: string[], width: number): string[] {
		this.reportMetadataDecoration(false);
		this.reportWorkingLineBorder(false);
		return clampRenderedLines(lines, width);
	}

	render(width: number): string[] {
		try {
			return this.mouse.rendered(this.renderDecorated(width));
		} catch (error) {
			this.reportMetadataDecoration(false);
			this.reportWorkingLineBorder(false);
			throw error;
		}
	}

	private renderDecorated(width: number): string[] {
		const config = this.getConfig();
		if (!config.components.editor.enabled) {
			this.reportMinimalistDecoration(false);
			return this.renderFallback(this.renderBase(width), width);
		}
		if (config.components.editor.style === "accent-rail") {
			this.reportMetadataDecoration(false);
			this.reportWorkingLineBorder(false);
			this.reportMinimalistDecoration(false);
			if (width < ACCENT_RAIL_CHROME_WIDTH + 1) {
				return this.renderFallback(this.renderBase(width), width);
			}
			let captured: { value: string[]; capture?: AutocompleteCapture };
			try {
				captured = renderWithAutocompleteCapture(
					this as unknown as AutocompleteEditorInternals,
					() => this.renderBase(width - ACCENT_RAIL_CHROME_WIDTH),
				);
			} catch {
				return this.renderFallback(this.renderBase(width), width);
			}
			try {
				const result = renderAccentRailFrameFromBase({
					codexQuota: this.getModelMeta().codexQuota,
					width,
					baseWidth: width - ACCENT_RAIL_CHROME_WIDTH,
					baseRendered: captured.value,
					autocompleteSource: this as unknown as AutocompleteEditorInternals,
					autocompleteCapture: captured.capture,
					uiTheme: this.uiTheme,
					config,
					trustedBaseFrame: true,
				});
				if (result.decorated) return result.lines;
			} catch {
				// Decoration is optional; preserve the completed same-render rows below.
			}
			return this.renderFallback(captured.value, width);
		}
		if (config.components.editor.style === "minimalist") {
			if (width <= 4) {
				this.reportMinimalistDecoration(false);
				return this.renderFallback(this.renderBase(width), width);
			}
			let captured: { value: string[]; capture?: AutocompleteCapture };
			try {
				captured = renderWithAutocompleteCapture(
					this as unknown as AutocompleteEditorInternals,
					() => this.renderBase(Math.max(0, width - 4)),
				);
			} catch {
				this.reportMinimalistDecoration(false);
				return this.renderFallback(this.renderBase(width), width);
			}
			try {
				const result = renderMinimalistFrameFromBase({
					width,
					baseWidth: Math.max(0, width - 4),
					baseRendered: captured.value,
					autocompleteSource: this as unknown as AutocompleteEditorInternals,
					autocompleteCapture: captured.capture,
					uiTheme: this.uiTheme,
					config,
					inputText: this.getText(),
					getMetadata: this.getMinimalistMetadata,
					reportWorkingLineBorder: this.reportWorkingLineBorder,
					trustedBaseFrame: true,
					borderColor: this.borderColor,
				});
				this.reportMetadataDecoration(result.decorated);
				this.reportMinimalistDecoration(result.decorated);
				if (!result.decorated) this.reportWorkingLineBorder(false);
				return result.lines;
			} catch {
				this.reportMinimalistDecoration(false);
				return this.renderFallback(captured.value, width);
			}
		}
		this.reportMinimalistDecoration(false);
		if (width <= 2) {
			return this.renderFallback(this.renderBase(width), width);
		}

		const shellMode = isShellModeInput(this.getText());
		const { railWidth } = getEditorChromeWidths(config, this.uiTheme, "\x1b[0m", shellMode);
		const innerWidth = Math.max(0, width - railWidth);
		let captured: { value: string[]; capture?: AutocompleteCapture };
		try {
			captured = renderWithAutocompleteCapture(this as unknown as AutocompleteEditorInternals, () =>
				this.renderBase(innerWidth),
			);
		} catch {
			return this.renderFallback(this.renderBase(width), width);
		}
		try {
			const result = renderPolishedFrame({
				width,
				baseWidth: innerWidth,
				baseRendered: captured.value,
				autocompleteSource: this as unknown as AutocompleteEditorInternals,
				autocompleteCapture: captured.capture,
				uiTheme: this.uiTheme,
				config,
				modelMeta: this.getModelMeta(),
				getWorkingLineFrame: () => this.getMinimalistMetadata().workingLineFrame,
				reportWorkingLineBorder: this.reportWorkingLineBorder,
				thinkingLevel: this.getThinkingLevel(),
				shellMode,
				trustedBaseFrame: true,
				borderColor: this.borderColor,
			});
			if (result.decorated) {
				this.reportMetadataDecoration(true);
				return result.lines;
			}
		} catch {
			// Decoration is optional; preserve the completed same-render rows below.
		}
		return this.renderFallback(captured.value, width);
	}
}

export class WrappedPolishedEditor implements EditorComponent {
	declare readonly handleMouse?: EditorMouseHandler;
	declare readonly addToHistory?: (text: string) => void;
	declare readonly insertTextAtCursor?: (text: string) => void;
	declare readonly setAutocompleteProvider?: (provider: AutocompleteProvider) => void;
	declare readonly setPaddingX?: (padding: number) => void;
	declare readonly setAutocompleteMaxVisible?: (maxVisible: number) => void;

	private readonly mouse = new EditorMouseForwarder();
	private workingLineBorderCapable = false;
	private metadataDecorated = false;
	private metadataDecoratedStyle?: EditorStyle;

	constructor(
		private readonly base: WrappedEditor,
		private readonly uiTheme: Theme,
		private readonly getConfig: () => ZentuiConfig,
		private readonly getModelMeta: () => EditorMeta,
		private readonly getThinkingLevel: () => string | undefined,
		private readonly getMinimalistMetadata: () => MinimalistEditorMetadata = () => ({ cwd: "" }),
		private readonly onMinimalistDecorationChange: (active: boolean) => void = () => {},
		private readonly onWorkingLineBorderCapabilityChange: () => void = () => {},
		private readonly onMetadataDecorationChange: () => void = () => {},
	) {
		if (typeof base.handleMouse === "function") {
			this.handleMouse = (event) => {
				const handler = base.handleMouse;
				return typeof handler === "function" ? this.mouse.forward(base, handler, event) : undefined;
			};
		}
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
		try {
			this.base.focused = value;
		} finally {
			if (!value) this.reportWorkingLineBorder(false);
		}
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

	isMetadataDecorated(): boolean {
		return (
			this.metadataDecorated &&
			this.metadataDecoratedStyle === this.getConfig().components.editor.style
		);
	}
	private reportMetadataDecoration(active: boolean): void {
		const style = active ? this.getConfig().components.editor.style : undefined;
		if (this.metadataDecorated === active && this.metadataDecoratedStyle === style) return;
		this.metadataDecorated = active;
		this.metadataDecoratedStyle = style;
		this.onMetadataDecorationChange();
	}

	private reportMinimalistDecoration(active: boolean): void {
		this.onMinimalistDecorationChange(active);
	}

	private renderBase(width: number): string[] {
		return this.mouse.baseRendered(width, this.base.render(width));
	}

	canEmbedWorkingLineBorder(): boolean {
		return this.focused && this.workingLineBorderCapable;
	}

	private reportWorkingLineBorder = (active: boolean): void => {
		active = active && this.focused;
		if (this.workingLineBorderCapable === active) return;
		this.workingLineBorderCapable = active;
		this.onWorkingLineBorderCapabilityChange();
	};

	private renderFallback(lines: string[], width: number): string[] {
		this.reportMetadataDecoration(false);
		this.reportWorkingLineBorder(false);
		return clampRenderedLines(lines, width);
	}

	render(width: number): string[] {
		try {
			return this.mouse.rendered(this.renderDecorated(width));
		} catch (error) {
			this.reportMetadataDecoration(false);
			this.reportWorkingLineBorder(false);
			throw error;
		}
	}

	private renderDecorated(width: number): string[] {
		const config = this.getConfig();
		if (!config.components.editor.enabled) {
			this.reportMinimalistDecoration(false);
			return this.renderFallback(this.renderBase(width), width);
		}
		if (config.components.editor.style === "accent-rail") {
			this.reportMetadataDecoration(false);
			this.reportWorkingLineBorder(false);
			this.reportMinimalistDecoration(false);
			if (width < ACCENT_RAIL_CHROME_WIDTH + 1) {
				return this.renderFallback(this.renderBase(width), width);
			}
			let captured: { value: string[]; capture?: AutocompleteCapture };
			try {
				captured = renderWithAutocompleteCapture(this.base, () =>
					this.renderBase(width - ACCENT_RAIL_CHROME_WIDTH),
				);
			} catch {
				return this.renderFallback(this.renderBase(width), width);
			}
			try {
				const provenance = inspectPolishedFrameProvenance(
					this.base,
					captured.value,
					config,
					this.uiTheme,
				);
				if (provenance.safe) {
					const result = renderAccentRailFrameFromBase({
						codexQuota: this.getModelMeta().codexQuota,
						width,
						baseWidth: width - ACCENT_RAIL_CHROME_WIDTH,
						baseRendered: captured.value,
						autocompleteSource: this.base,
						autocompleteCapture: captured.capture,
						uiTheme: this.uiTheme,
						config,
						ownedFrame: provenance.ownedFrame,
					});
					if (result.decorated) return result.lines;
				}
			} catch {
				// Decoration is optional; preserve the completed same-render rows below.
			}
			return this.renderFallback(captured.value, width);
		}
		if (config.components.editor.style === "minimalist") {
			if (width <= 4) {
				this.reportMinimalistDecoration(false);
				return this.renderFallback(this.renderBase(width), width);
			}
			let captured: { value: string[]; capture?: AutocompleteCapture };
			try {
				captured = renderWithAutocompleteCapture(this.base, () =>
					this.renderBase(Math.max(0, width - 4)),
				);
			} catch {
				this.reportMinimalistDecoration(false);
				return this.renderFallback(this.renderBase(width), width);
			}
			try {
				const provenance = inspectPolishedFrameProvenance(
					this.base,
					captured.value,
					config,
					this.uiTheme,
				);
				if (provenance.safe) {
					const result = renderMinimalistFrameFromBase({
						width,
						baseWidth: Math.max(0, width - 4),
						baseRendered: captured.value,
						autocompleteSource: this.base,
						autocompleteCapture: captured.capture,
						uiTheme: this.uiTheme,
						config,
						inputText: this.base.getText(),
						getMetadata: this.getMinimalistMetadata,
						reportWorkingLineBorder: this.reportWorkingLineBorder,
						ownedFrame: provenance.ownedFrame,
						borderColor: this.borderColor,
					});
					if (result.decorated) {
						this.reportMetadataDecoration(true);
						this.reportMinimalistDecoration(true);
						return result.lines;
					}
				}
			} catch {
				// Decoration is optional; preserve the completed same-render rows below.
			}
			this.reportMinimalistDecoration(false);
			return this.renderFallback(captured.value, width);
		}
		this.reportMinimalistDecoration(false);
		if (width <= 2) return this.renderFallback(this.renderBase(width), width);

		const shellMode = isShellModeInput(this.base.getText());
		const { railWidth } = getEditorChromeWidths(config, this.uiTheme, "\x1b[0m", shellMode);
		const innerWidth = Math.max(0, width - railWidth);
		let captured: { value: string[]; capture?: AutocompleteCapture };
		try {
			captured = renderWithAutocompleteCapture(this.base, () => this.renderBase(innerWidth));
		} catch {
			return this.renderFallback(this.renderBase(width), width);
		}
		let result: PolishedFrameResult | undefined;
		try {
			const provenance = inspectPolishedFrameProvenance(
				this.base,
				captured.value,
				config,
				this.uiTheme,
			);
			if (provenance.safe) {
				result = renderPolishedFrame({
					width,
					baseWidth: innerWidth,
					baseRendered: captured.value,
					autocompleteSource: this.base,
					autocompleteCapture: captured.capture,
					uiTheme: this.uiTheme,
					config,
					modelMeta: this.getModelMeta(),
					getWorkingLineFrame: () => this.getMinimalistMetadata().workingLineFrame,
					reportWorkingLineBorder: this.reportWorkingLineBorder,
					thinkingLevel: this.getThinkingLevel(),
					rightStatus: readVimStatus(this.base, this.uiTheme),
					shellMode,
					ownedFrame: provenance.ownedFrame,
					borderColor: this.borderColor,
				});
			}
		} catch {
			// Decoration is optional; preserve the completed same-render rows below.
		}
		if (result?.decorated) {
			this.reportMetadataDecoration(true);
			return result.lines;
		}
		return this.renderFallback(captured.value, width);
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
