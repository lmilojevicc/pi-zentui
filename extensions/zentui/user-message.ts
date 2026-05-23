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

type PatchableUserMessagePrototype = {
	render: RenderFn;
	children?: unknown[];
	__zentuiUserMessageOriginalRender?: RenderFn;
	__zentuiUserMessagePatched?: boolean;
	__zentuiUserMessageWrapper?: RenderFn;
	__zentuiUserMessageActive?: boolean;
	__zentuiUserMessageGetTheme?: () => Theme | undefined;
	__zentuiUserMessageGetConfig?: () => PolishedTuiConfig;
};

type Cleanup = () => void;

type MarkdownLike = {
	text?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findMarkdownText(value: unknown): string | undefined {
	if (isRecord(value) && typeof (value as MarkdownLike).text === "string") {
		return (value as { text: string }).text;
	}

	if (!isRecord(value)) return undefined;

	const children = Array.isArray(value.children) ? value.children : [];
	for (const child of children) {
		const text = findMarkdownText(child);
		if (text !== undefined) return text;
	}

	return undefined;
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

function renderPromptBoxLine(
	line: string,
	width: number,
	theme: Theme | undefined,
	config: PolishedTuiConfig,
): string {
	if (width <= 0) return "";
	const rail = `${
		theme
			? renderStyleForSourceOrFallback(
					theme,
					config.colorSources.userMessages,
					config.colors.editorAccent,
					EDITOR_ACCENT_FALLBACK,
					"│",
				)
			: "│"
	} `;
	const contentWidth = Math.max(0, width - visibleWidth(rail));
	return truncateToWidth(`${rail}${fillLine(line, contentWidth)}`, width, "");
}

function renderZentuiUserMessage(
	instance: PatchableUserMessagePrototype,
	width: number,
	theme: Theme | undefined,
	config: PolishedTuiConfig,
): string[] | undefined {
	const text = findMarkdownText(instance);
	if (text === undefined) return undefined;
	if (width <= 0) return [""];

	const railWidth = visibleWidth(
		`${
			theme
				? renderStyleForSourceOrFallback(
						theme,
						config.colorSources.userMessages,
						config.colors.editorAccent,
						EDITOR_ACCENT_FALLBACK,
						"│",
					)
				: "│"
		} `,
	);
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

	return [
		truncateToWidth(border, width, ""),
		renderPromptBoxLine("", width, theme, config),
		...contentLines.map((line) => renderPromptBoxLine(line, width, theme, config)),
		renderPromptBoxLine("", width, theme, config),
		truncateToWidth(border, width, ""),
	];
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

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	};
	prototype.__zentuiUserMessageWrapper = wrapper;
	prototype.render = wrapper;
	prototype.__zentuiUserMessagePatched = true;

	return () => {
		prototype.__zentuiUserMessageActive = false;
	};
}
