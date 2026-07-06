import { type Theme, type ThemeColor, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	type MarkdownTheme,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "./config";
import {
	EDITOR_ACCENT_FALLBACK,
	EDITOR_BORDER_FALLBACK,
	renderStyleForSourceOrFallback,
} from "./style";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

type RenderFn = (width: number) => string[];
type InvalidateFn = () => void;

type PatchableUserMessagePrototype = {
	render: RenderFn;
	invalidate: InvalidateFn;
	children?: unknown[];
	__zentuiUserMessageOriginalRender?: RenderFn;
	__zentuiUserMessageOriginalInvalidate?: InvalidateFn;
	__zentuiUserMessagePatched?: boolean;
	__zentuiUserMessageInvalidatePatched?: boolean;
	__zentuiUserMessageWrapper?: RenderFn;
	__zentuiUserMessageInvalidateWrapper?: InvalidateFn;
	__zentuiUserMessageActive?: boolean;
	__zentuiUserMessageGetTheme?: () => Theme | undefined;
	__zentuiUserMessageGetConfig?: () => PolishedTuiConfig;
};

type Cleanup = () => void;

type UserMessageRenderCache = {
	hasMarkdownText: boolean;
	text?: string;
	width?: number;
	theme?: Theme;
	configKey?: string;
	renderedLines?: string[];
};

const userMessageRenderCache = new WeakMap<object, UserMessageRenderCache>();

function isObject(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findMarkdownText(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.text === "string") return value.text;

	const children = value.children;
	if (!Array.isArray(children)) return undefined;

	for (const child of children) {
		const text = findMarkdownText(child);
		if (text !== undefined) return text;
	}

	return undefined;
}

function getCachedMarkdownText(instance: object): string | undefined {
	const cached = userMessageRenderCache.get(instance);
	if (cached?.hasMarkdownText) return cached.text;

	const text = findMarkdownText(instance);
	if (text !== undefined) {
		userMessageRenderCache.set(instance, { ...cached, hasMarkdownText: true, text });
	}
	return text;
}

function getUserMessageConfigKey(config: PolishedTuiConfig): string {
	return [
		config.features.copyFriendly ? "copy" : "chrome",
		config.colorSources.userMessages,
		config.colors.editorAccent ?? "",
		config.colors.editorBorder ?? "",
		config.icons.rail,
	].join("\0");
}

function themeFg(theme: Theme | undefined, color: ThemeColor, text: string): string {
	if (!theme) return text;
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function makeMarkdownTheme(theme: Theme | undefined): MarkdownTheme {
	return {
		heading: (text) => themeFg(theme, "mdHeading", text),
		link: (text) => themeFg(theme, "mdLink", text),
		linkUrl: (text) => themeFg(theme, "mdLinkUrl", text),
		code: (text) => themeFg(theme, "mdCode", text),
		codeBlock: (text) => themeFg(theme, "mdCodeBlock", text),
		codeBlockBorder: (text) => themeFg(theme, "mdCodeBlockBorder", text),
		quote: (text) => themeFg(theme, "mdQuote", text),
		quoteBorder: (text) => themeFg(theme, "mdQuoteBorder", text),
		hr: (text) => themeFg(theme, "mdHr", text),
		listBullet: (text) => themeFg(theme, "mdListBullet", text),
		bold: (text) => (theme ? theme.bold(text) : text),
		italic: (text) => (theme ? theme.italic(text) : text),
		underline: (text) => (theme ? theme.underline(text) : text),
		strikethrough: (text) => (theme ? theme.strikethrough(text) : text),
	};
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
}

function renderPromptBoxRail(theme: Theme | undefined, config: PolishedTuiConfig): string {
	if (config.features.copyFriendly) return "";
	const railGlyph = config.icons.rail;

	return `${
		theme
			? renderStyleForSourceOrFallback(
					theme,
					config.colorSources.userMessages,
					config.colors.editorAccent,
					EDITOR_ACCENT_FALLBACK,
					railGlyph,
				)
			: railGlyph
	} `;
}

function renderPromptBoxLine(
	line: string,
	width: number,
	theme: Theme | undefined,
	config: PolishedTuiConfig,
): string {
	if (width <= 0) return "";
	const rail = renderPromptBoxRail(theme, config);
	const contentWidth = Math.max(0, width - visibleWidth(rail));
	const content = config.features.copyFriendly
		? truncateToWidth(line, contentWidth, "")
		: fillLine(line, contentWidth);
	return truncateToWidth(`${rail}${content}`, width, "");
}

function renderZentuiUserMessage(
	instance: PatchableUserMessagePrototype,
	width: number,
	theme: Theme | undefined,
	config: PolishedTuiConfig,
): string[] | undefined {
	if (!isRecord(instance)) return undefined;

	const text = getCachedMarkdownText(instance);
	if (text === undefined) return undefined;
	if (width <= 0) return [""];

	const configKey = getUserMessageConfigKey(config);
	const cached = userMessageRenderCache.get(instance);
	if (
		cached?.hasMarkdownText &&
		cached.width === width &&
		cached.theme === theme &&
		cached.configKey === configKey &&
		cached.renderedLines
	) {
		return cached.renderedLines;
	}

	const railWidth = visibleWidth(renderPromptBoxRail(theme, config));
	const contentWidth = Math.max(1, width - railWidth);
	const renderer = new Markdown(text, 0, 0, makeMarkdownTheme(theme), {
		color: (content) => themeFg(theme, "userMessageText", content),
	});
	const body = renderer.render(contentWidth);
	const contentLines = body.length > 0 ? body : [""];
	const border = theme
		? renderStyleForSourceOrFallback(
				theme,
				config.colorSources.userMessages,
				config.colors.editorBorder,
				EDITOR_BORDER_FALLBACK,
				"─".repeat(width),
			)
		: "─".repeat(width);
	const lines = [
		truncateToWidth(border, width, ""),
		renderPromptBoxLine("", width, theme, config),
		...contentLines.map((line) => renderPromptBoxLine(line, width, theme, config)),
		renderPromptBoxLine("", width, theme, config),
		truncateToWidth(border, width, ""),
	];

	userMessageRenderCache.set(instance, {
		hasMarkdownText: true,
		text,
		width,
		theme,
		configKey,
		renderedLines: lines,
	});
	return lines;
}

function withPromptZoneMarkers(lines: string[]): string[] {
	const markedLines = [...lines];
	markedLines[0] = OSC133_ZONE_START + markedLines[0];
	markedLines[markedLines.length - 1] =
		OSC133_ZONE_END + OSC133_ZONE_FINAL + markedLines[markedLines.length - 1];
	return markedLines;
}

export function installUserMessageStyle(
	getTheme: () => Theme | undefined,
	getConfig: () => PolishedTuiConfig,
): Cleanup {
	const prototype = UserMessageComponent.prototype as unknown as PatchableUserMessagePrototype;
	prototype.__zentuiUserMessageGetTheme = getTheme;
	prototype.__zentuiUserMessageGetConfig = getConfig;
	prototype.__zentuiUserMessageActive = true;

	if (
		!(
			prototype.__zentuiUserMessageInvalidatePatched &&
			prototype.invalidate === prototype.__zentuiUserMessageInvalidateWrapper
		)
	) {
		prototype.__zentuiUserMessageOriginalInvalidate = prototype.invalidate;
		const invalidateWrapper = function invalidateWithZentuiUserMessage(this: unknown): void {
			if (isObject(this)) userMessageRenderCache.delete(this);
			const originalInvalidate = prototype.__zentuiUserMessageOriginalInvalidate;
			originalInvalidate?.call(this);
		};
		prototype.__zentuiUserMessageInvalidateWrapper = invalidateWrapper;
		prototype.invalidate = invalidateWrapper;
		prototype.__zentuiUserMessageInvalidatePatched = true;
	}

	if (
		prototype.__zentuiUserMessagePatched &&
		prototype.render === prototype.__zentuiUserMessageWrapper
	) {
		return () => {
			prototype.__zentuiUserMessageActive = false;
		};
	}

	prototype.__zentuiUserMessageOriginalRender = prototype.render;
	const wrapper = function renderWithZentuiUserMessage(this: unknown, width: number): string[] {
		const original = prototype.__zentuiUserMessageOriginalRender ?? prototype.render;
		if (!prototype.__zentuiUserMessageActive) return original.call(this, width);

		const config = prototype.__zentuiUserMessageGetConfig?.();
		if (!config) return original.call(this, width);

		const lines = renderZentuiUserMessage(
			this as PatchableUserMessagePrototype,
			width,
			prototype.__zentuiUserMessageGetTheme?.(),
			config,
		);

		if (!lines) return original.call(this, width);
		if (lines.length === 0) return lines;

		return withPromptZoneMarkers(lines);
	};
	prototype.__zentuiUserMessageWrapper = wrapper;
	prototype.render = wrapper;
	prototype.__zentuiUserMessagePatched = true;

	return () => {
		prototype.__zentuiUserMessageActive = false;
	};
}
