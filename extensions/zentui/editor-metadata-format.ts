import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PolishedTuiConfig } from "./config";
import { type FormatToken, parseFooterFormat } from "./footer-format";
import { EDITOR_ACCENT_FALLBACK, renderStyleForSourceOrFallback, safeThemeFg } from "./style";

export type EditorMetadataValues = {
	model: string;
	modelId: string;
	modelName: string;
	provider: string;
	thinking: string;
	sessionName: string;
};

type RenderedTokens = {
	styled: string;
	hasDynamic: boolean;
	hasNonEmptyDynamic: boolean;
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

function renderVariable(
	name: string,
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: PolishedTuiConfig,
): { plain: string; styled: string } {
	const colorSource = config.colorSources.editor;
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
	if (name === "session_name") {
		return { plain, styled: safeThemeFg(uiTheme, "border", plain) };
	}
	return { plain: "", styled: "" };
}

function renderTokens(
	tokens: FormatToken[],
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: PolishedTuiConfig,
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

export function renderEditorMetadataFormat(
	format: string,
	values: EditorMetadataValues,
	uiTheme: Theme,
	config: PolishedTuiConfig,
): string {
	return renderTokens(
		parseFooterFormat(sanitizeEditorMetadataText(format)),
		values,
		uiTheme,
		config,
	).styled;
}
