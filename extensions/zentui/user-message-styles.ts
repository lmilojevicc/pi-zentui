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

export type UserMessageStyleRenderInput = {
	text: string;
	width: number;
	theme?: Theme;
	config: ZentuiConfig;
};

const ESC = "\x1b";
const BEL = "\x07";
const C1_OSC = "\x9d";
const C1_ST = "\x9c";

type OscShield = {
	placeholder: string;
	original: string;
};

function oscStartLength(text: string, index: number): number {
	if (text[index] === C1_OSC) return 1;
	return text[index] === ESC && text[index + 1] === "]" ? 2 : 0;
}

function findCompleteOscEnd(text: string, payloadStart: number): number | undefined {
	for (let index = payloadStart; index < text.length; index += 1) {
		if (oscStartLength(text, index) > 0) return undefined;
		if (text[index] === BEL || text[index] === C1_ST) return index + 1;
		if (text[index] === ESC && text[index + 1] === "\\") return index + 2;
	}
	return undefined;
}

function makeOscShield(index: number, source: string): string {
	let suffix = index;
	while (true) {
		const id = `zentuioscshield${suffix}`;
		const placeholder = `${ESC}]8;id=${id};zentuioscshield:${suffix}${ESC}\\${ESC}]8;;${ESC}\\`;
		if (!source.includes(placeholder)) return placeholder;
		suffix += 1;
	}
}

function shieldCompleteOscSequences(text: string): { text: string; shields: OscShield[] } {
	let output = "";
	let index = 0;
	const shields: OscShield[] = [];
	while (index < text.length) {
		const startLength = oscStartLength(text, index);
		if (startLength === 0) {
			output += text[index];
			index += 1;
			continue;
		}

		const end = findCompleteOscEnd(text, index + startLength);
		if (end === undefined) {
			// Incomplete controls should already have been neutralized by the adapter.
			// Preserve direct-render behavior rather than inventing another sanitizer here.
			output += text[index];
			index += 1;
			continue;
		}

		const original = text.slice(index, end);
		const placeholder = makeOscShield(shields.length, `${text}\0${output}`);
		shields.push({ placeholder, original });
		output += placeholder;
		index = end;
	}
	return { text: output, shields };
}

function restoreCompleteOscSequences(lines: string[], shields: OscShield[]): string[] {
	if (shields.length === 0) return lines;
	const remaining = new Set(shields.map(({ placeholder }) => placeholder));
	const restored = lines.map((line) => {
		let output = line;
		for (const { placeholder, original } of shields) {
			const first = output.indexOf(placeholder);
			if (first < 0) continue;
			if (output.indexOf(placeholder, first + placeholder.length) >= 0) {
				throw new Error("duplicated OSC shield");
			}
			output = `${output.slice(0, first)}${original}${output.slice(first + placeholder.length)}`;
			remaining.delete(placeholder);
		}
		return output;
	});
	if (remaining.size > 0) throw new Error("lost OSC shield");
	return restored;
}

function themeFg(theme: Theme | undefined, color: ThemeColor, text: string): string {
	return theme ? theme.fg(color, text) : text;
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

export function renderUserMessageStyle(input: UserMessageStyleRenderInput): string[] {
	const shielded = shieldCompleteOscSequences(input.text);
	const shieldedInput = { ...input, text: shielded.text };
	let lines: string[];
	switch (input.config.components.userMessages.style) {
		case "framed":
			lines = renderFramed(shieldedInput);
			break;
		case "framed-copy-friendly":
			lines = renderFramedCopyFriendly(shieldedInput);
			break;
		case "compact":
			lines = renderCompact(shieldedInput);
			break;
		case "labeled":
			lines = renderLabeled(shieldedInput);
			break;
	}
	return restoreCompleteOscSequences(lines, shielded.shields);
}
