import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ZentuiConfig } from "./config";
import { type FormatToken, parseFooterFormat } from "./footer-format";
import { buildSessionTokenLabel, formatCacheHitRate, formatContextPercentLabel } from "./format";
import { EDITOR_ACCENT_FALLBACK, renderStyleForSourceOrFallback, safeThemeFg } from "./style";

export type EditorMetadataValues = {
	model: string;
	modelId: string;
	modelName: string;
	provider: string;
	thinking: string;
	sessionName: string;
	contextPercent?: number;
	contextWindow?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheHitRate?: number;
};

type RenderedTokens = {
	styled: string;
	hasDynamic: boolean;
	hasNonEmptyDynamic: boolean;
};

export type EditorMetadataZones = {
	left: string;
	middle: string;
	right: string;
};

const ESC = 0x1b;
const BEL = 0x07;
const CAN = 0x18;
const SUB = 0x1a;
const C1_DCS = 0x90;
const C1_CSI = 0x9b;
const C1_ST = 0x9c;
const C1_OSC = 0x9d;
const C1_SOS = 0x98;
const C1_PM = 0x9e;
const C1_APC = 0x9f;

function consumeCsi(value: string, start: number): number {
	for (let index = start; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === CAN || code === SUB) return index + 1;
		if (code >= 0x40 && code <= 0x7e) return index + 1;
	}
	return value.length;
}

function consumeControlString(value: string, start: number, allowBel: boolean): number {
	for (let index = start; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === CAN || code === SUB) return index + 1;
		if (allowBel && code === BEL) return index + 1;
		if (code === C1_ST) return index + 1;
		if (code === ESC && value.charCodeAt(index + 1) === 0x5c) return index + 2;
	}
	return value.length;
}

function consumeEscape(value: string, start: number): number {
	if (start + 1 >= value.length) return value.length;
	const next = value.charCodeAt(start + 1);
	if (next === 0x5b) return consumeCsi(value, start + 2);
	if (next === 0x5d) return consumeControlString(value, start + 2, true);
	if (next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
		return consumeControlString(value, start + 2, false);
	}

	let index = start + 1;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code >= 0x20 && code <= 0x2f) {
			index += 1;
			continue;
		}
		return code >= 0x30 && code <= 0x7e ? index + 1 : index;
	}
	return value.length;
}

function isNormalizedWhitespace(code: number): boolean {
	return (
		code === 0x09 ||
		code === 0x0a ||
		code === 0x0b ||
		code === 0x0c ||
		code === 0x0d ||
		code === 0x85 ||
		code === 0x2028 ||
		code === 0x2029
	);
}

export function sanitizeEditorMetadataText(value: string): string {
	let sanitized = "";
	for (let index = 0; index < value.length; ) {
		const code = value.charCodeAt(index);
		if (code === ESC) {
			index = consumeEscape(value, index);
			continue;
		}
		if (code === C1_CSI) {
			index = consumeCsi(value, index + 1);
			continue;
		}
		if (code === C1_OSC) {
			index = consumeControlString(value, index + 1, true);
			continue;
		}
		if (code === C1_DCS || code === C1_SOS || code === C1_PM || code === C1_APC) {
			index = consumeControlString(value, index + 1, false);
			continue;
		}
		if (isNormalizedWhitespace(code)) {
			sanitized += " ";
			do index += 1;
			while (index < value.length && isNormalizedWhitespace(value.charCodeAt(index)));
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			index += 1;
			continue;
		}
		sanitized += value[index];
		index += 1;
	}
	return sanitized;
}

function editorThinkingStyle(config: ZentuiConfig, level: string): string | undefined {
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
		case "max":
			return (
				config.colors.editorThinkingMax ??
				config.colors.editorThinkingXhigh ??
				config.colors.editorThinking
			);
		default:
			return config.colors.editorThinking;
	}
}

function renderVariable(
	name: string,
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: ZentuiConfig,
): { plain: string; styled: string } {
	const colorSource = config.components.editor.colorSource;
	const thinking = values.thinking.toLowerCase() === "off" ? "" : values.thinking;
	const raw =
		name === "model"
			? values.model
			: name === "model_id"
				? values.modelId
				: name === "model_name"
					? values.modelName
					: name === "provider"
						? values.provider
						: name === "thinking"
							? thinking
							: name === "session_name"
								? values.sessionName
								: name === "context"
									? formatContextPercentLabel(values.contextPercent, values.contextWindow)
									: name === "tokens"
										? buildSessionTokenLabel({
												input: values.inputTokens ?? 0,
												output: values.outputTokens ?? 0,
											})
										: name === "cache_hit"
											? formatCacheHitRate(values.cacheHitRate)
											: "";
	const plain = sanitizeEditorMetadataText(raw);
	if (!plain) return { plain: "", styled: "" };

	if (name === "model" || name === "model_id" || name === "model_name") {
		return {
			plain,
			styled: renderStyleForSourceOrFallback(
				uiTheme,
				colorSource,
				config.colors.editorModel,
				EDITOR_ACCENT_FALLBACK,
				plain,
			),
		};
	}
	if (name === "provider") {
		return {
			plain,
			styled: renderStyleForSourceOrFallback(
				uiTheme,
				colorSource,
				config.colors.editorProvider,
				"text",
				plain,
			),
		};
	}
	if (name === "thinking") {
		return {
			plain,
			styled: renderStyleForSourceOrFallback(
				uiTheme,
				colorSource,
				editorThinkingStyle(config, plain),
				"muted",
				plain,
			),
		};
	}
	if (name === "session_name" || name === "context" || name === "tokens" || name === "cache_hit") {
		return { plain, styled: safeThemeFg(uiTheme, "border", plain) };
	}
	return { plain: "", styled: "" };
}

function renderTokens(
	tokens: FormatToken[],
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: ZentuiConfig,
): RenderedTokens {
	let styled = "";
	let hasDynamic = false;
	let hasNonEmptyDynamic = false;

	for (const token of tokens) {
		if (token.kind === "text") {
			const plain = sanitizeEditorMetadataText(token.value);
			if (plain) styled += safeThemeFg(uiTheme, "border", plain);
			continue;
		}
		if (token.kind === "fill") {
			hasDynamic = true;
			continue;
		}
		if (token.kind === "var") {
			hasDynamic = true;
			const rendered = renderVariable(token.name, values, uiTheme, config);
			styled += rendered.styled;
			if (rendered.plain) hasNonEmptyDynamic = true;
			continue;
		}

		const rendered = renderTokens(token.tokens, values, uiTheme, config);
		const visible = !rendered.hasDynamic || rendered.hasNonEmptyDynamic;
		hasDynamic = true;
		if (visible) {
			styled += rendered.styled;
			hasNonEmptyDynamic = true;
		}
	}

	return { styled, hasDynamic, hasNonEmptyDynamic };
}

export function renderEditorMetadataFormatSplit(
	format: string,
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: ZentuiConfig,
): EditorMetadataZones {
	const tokens = parseFooterFormat(sanitizeEditorMetadataText(format));
	const fillIndices: number[] = [];
	for (let index = 0; index < tokens.length; index++) {
		if (tokens[index]?.kind === "fill") fillIndices.push(index);
	}

	const first = fillIndices[0];
	const second = fillIndices[1];
	if (first === undefined) {
		return {
			left: renderTokens(tokens, values, uiTheme, config).styled,
			middle: "",
			right: "",
		};
	}
	if (second === undefined) {
		return {
			left: renderTokens(tokens.slice(0, first), values, uiTheme, config).styled,
			middle: "",
			right: renderTokens(tokens.slice(first + 1), values, uiTheme, config).styled,
		};
	}
	return {
		left: renderTokens(tokens.slice(0, first), values, uiTheme, config).styled,
		middle: renderTokens(tokens.slice(first + 1, second), values, uiTheme, config).styled,
		right: renderTokens(tokens.slice(second + 1), values, uiTheme, config).styled,
	};
}

export function renderEditorMetadataFormat(
	format: string,
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: ZentuiConfig,
): string {
	return renderTokens(
		parseFooterFormat(sanitizeEditorMetadataText(format)),
		values,
		uiTheme,
		config,
	).styled;
}
