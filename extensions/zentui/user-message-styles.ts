import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	type MarkdownTheme,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ZentuiConfig } from "./config";
import {
	EDITOR_ACCENT_FALLBACK,
	EDITOR_BORDER_FALLBACK,
	renderStyleForSourceOrFallbackStrict,
} from "./style";
import { sanitizeUserMessageSourceText } from "./user-message-osc";

export type UserMessageStyleRenderInput = {
	text: string;
	width: number;
	theme?: Theme;
	config: ZentuiConfig;
};

function themeFg(theme: Theme | undefined, color: ThemeColor, text: string): string {
	return theme ? theme.fg(color, text) : text;
}

export function makeMarkdownTheme(theme: Theme | undefined): MarkdownTheme {
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

function renderMarkdown(text: string, width: number, theme: Theme | undefined): string[] {
	const renderer = new Markdown(text, 0, 0, makeMarkdownTheme(theme), {
		color: (content) => themeFg(theme, "userMessageText", content),
	});
	const lines = renderer.render(Math.max(1, width));
	return lines.length > 0 ? lines : [""];
}

function trimMarkdownPadding(line: string): string {
	return line.replace(/ +((?:\x1b\[[0-?]*[ -/]*[@-~])*)$/, "$1");
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function accent(theme: Theme | undefined, config: ZentuiConfig, text: string): string {
	return theme
		? renderStyleForSourceOrFallbackStrict(
				theme,
				config.components.userMessages.colorSource,
				config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				text,
			)
		: text;
}

function border(theme: Theme | undefined, config: ZentuiConfig, text: string): string {
	return theme
		? renderStyleForSourceOrFallbackStrict(
				theme,
				config.components.userMessages.colorSource,
				config.colors.editorBorder,
				EDITOR_BORDER_FALLBACK,
				text,
			)
		: text;
}

function renderRail(theme: Theme | undefined, config: ZentuiConfig): string {
	return `${accent(theme, config, config.icons.rail)} `;
}

function renderFramed({ text, width, theme, config }: UserMessageStyleRenderInput): string[] {
	if (width <= 0) return [""];
	const rail = renderRail(theme, config);
	const contentWidth = Math.max(1, width - visibleWidth(rail));
	const body = renderMarkdown(text, contentWidth, theme);
	const row = (line: string) => {
		const available = Math.max(0, width - visibleWidth(rail));
		return truncateToWidth(`${rail}${fillLine(line, available)}`, width, "");
	};
	const rule = truncateToWidth(border(theme, config, "─".repeat(width)), width, "");
	return [rule, row(""), ...body.map(row), row(""), rule];
}

function renderFramedCopyFriendly({
	text,
	width,
	theme,
	config,
}: UserMessageStyleRenderInput): string[] {
	if (width <= 0) return [""];
	const prefix = width > 1 ? " " : "";
	const body = renderMarkdown(text, width - prefix.length, theme).map((line) =>
		fillLine(`${prefix}${line}`, width),
	);
	const rule = truncateToWidth(border(theme, config, "─".repeat(width)), width, "");
	return [rule, "", ...body, "", rule];
}

function renderCompact({ text, width, theme, config }: UserMessageStyleRenderInput): string[] {
	if (width <= 0) return [""];
	const rail = renderRail(theme, config);
	const railWidth = visibleWidth(rail);
	if (width <= railWidth) {
		return renderMarkdown(text, width, theme).map((line) =>
			truncateToWidth(trimMarkdownPadding(line), width, ""),
		);
	}
	const contentWidth = width - railWidth;
	return renderMarkdown(text, contentWidth, theme).map((line) =>
		truncateToWidth(`${rail}${trimMarkdownPadding(line)}`, width, ""),
	);
}

function renderLabeled({ text, width, theme, config }: UserMessageStyleRenderInput): string[] {
	if (width <= 0) return [""];
	if (width <= 2) {
		return renderMarkdown(text, width, theme).map((line) => truncateToWidth(line, width, ""));
	}

	const horizontalPadding = width >= 5 ? 1 : 0;
	const contentWidth = Math.max(1, width - 2 - horizontalPadding * 2);
	const body = renderMarkdown(text, contentWidth, theme);
	const top =
		width >= 9
			? `${border(theme, config, "╭─")}${accent(theme, config, " User ")}${border(
					theme,
					config,
					`${"─".repeat(Math.max(0, width - 9))}╮`,
				)}`
			: border(theme, config, `╭${"─".repeat(Math.max(0, width - 2))}╮`);
	const padding = " ".repeat(horizontalPadding);
	const side = (line: string) =>
		`${border(theme, config, "│")}${padding}${fillLine(line, contentWidth)}${padding}${border(
			theme,
			config,
			"│",
		)}`;
	const bottom = border(theme, config, `╰${"─".repeat(Math.max(0, width - 2))}╯`);
	return [top, ...body.map(side), bottom];
}

export function userMessageStyleCacheKey(config: ZentuiConfig): string {
	const messages = config.components.userMessages;
	switch (messages.style) {
		case "framed":
			return [
				"framed",
				messages.colorSource,
				config.colors.editorAccent ?? "",
				config.colors.editorBorder ?? "",
				config.icons.rail,
			].join("\0");
		case "framed-copy-friendly":
			return ["framed-copy-friendly", messages.colorSource, config.colors.editorBorder ?? ""].join(
				"\0",
			);
		case "compact":
			return [
				"compact",
				messages.colorSource,
				config.colors.editorAccent ?? "",
				config.icons.rail,
			].join("\0");
		case "labeled":
			return [
				"labeled",
				messages.colorSource,
				config.colors.editorAccent ?? "",
				config.colors.editorBorder ?? "",
				"User:v1",
			].join("\0");
	}
}

function renderSelectedUserMessageStyle(input: UserMessageStyleRenderInput): string[] {
	switch (input.config.components.userMessages.style) {
		case "framed":
			return renderFramed(input);
		case "framed-copy-friendly":
			return renderFramedCopyFriendly(input);
		case "compact":
			return renderCompact(input);
		case "labeled":
			return renderLabeled(input);
	}
}

export function renderUserMessageStyle(input: UserMessageStyleRenderInput): string[] {
	// Raw user input is a terminal trust boundary. Strip every source control,
	// including OSC 8; Markdown may add its own validated links afterward.
	return renderSelectedUserMessageStyle({
		...input,
		text: sanitizeUserMessageSourceText(input.text),
	});
}
