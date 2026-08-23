import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type CompletionRowsOptions = {
	lines: string[];
	width: number;
	theme: Theme;
	selectedPrefix: string;
	ownedBackground: boolean;
};

export type CompletionPaletteOptions = {
	lines: string[];
	width: number;
	theme: Theme;
	renderSeparator: (text: string) => string;
	ownedBackground: boolean;
};

const SGR_SEQUENCE = /(?:\x1b\[|\u009b)([0-9:;]*)m/g;

function normalizeC1Csi(content: string): string {
	return content.replace(/\u009b([0-?]*[ -/]*[@-~])/g, "\x1b[$1");
}

function sgrBackgroundAction(parameters: string): "reset" | "set" | undefined {
	let action: "reset" | "set" | undefined;
	const values = (parameters || "0").split(";");
	for (let index = 0; index < values.length; index++) {
		const parameter = values[index] ?? "";
		const primary = parameter === "" ? 0 : Number.parseInt(parameter.split(":", 1)[0] ?? "", 10);
		if (primary === 38 || primary === 48 || primary === 58) {
			if (primary === 48) action = "set";
			if (!parameter.includes(":")) {
				const mode = Number.parseInt(values[index + 1] ?? "", 10);
				if (mode === 5) index += 2;
				else if (mode === 2) index += 4;
			}
			continue;
		}
		if (primary === 0 || primary === 49) action = "reset";
		else if ((primary >= 40 && primary <= 47) || (primary >= 100 && primary <= 107)) action = "set";
	}
	return action;
}

function restoresOwnedBackground(sequence: string): boolean {
	const parameters = sequence.slice(sequence.startsWith("\u009b") ? 1 : 2, -1);
	return sgrBackgroundAction(parameters) === "reset";
}

function truncateTerminalLine(content: string, width: number): string {
	const safeWidth = Math.max(0, width);
	const normalized = normalizeC1Csi(content);
	return visibleWidth(normalized) <= safeWidth
		? content
		: truncateToWidth(normalized, safeWidth, "");
}

export function fillTerminalLine(content: string, width: number): string {
	const truncated = truncateTerminalLine(content, width);
	const renderedWidth = visibleWidth(normalizeC1Csi(truncated));
	return `${truncated}${" ".repeat(Math.max(0, width - renderedWidth))}`;
}

export function applyOwnedSurfaceBackground(theme: Theme, text: string): string {
	try {
		const background = theme.getBgAnsi("userMessageBg");
		const restored = text.replace(SGR_SEQUENCE, (sequence) =>
			restoresOwnedBackground(sequence) ? `${sequence}${background}` : sequence,
		);
		return `${background}${restored}\x1b[49m`;
	} catch {
		try {
			let cursor = 0;
			let rendered = "";
			for (const match of text.matchAll(SGR_SEQUENCE)) {
				if (!restoresOwnedBackground(match[0])) continue;
				const before = text.slice(cursor, match.index);
				if (before) rendered += theme.bg("userMessageBg", before);
				rendered += match[0];
				cursor = (match.index ?? 0) + match[0].length;
			}
			const trailing = text.slice(cursor);
			if (trailing) rendered += theme.bg("userMessageBg", trailing);
			return rendered || theme.bg("userMessageBg", text);
		} catch {
			return text;
		}
	}
}

export function replaceNativeSelectedPrefix(line: string, replacement: string): string {
	const selectedPrefix = /^((?:(?:\x1b\[|\u009b)[0-9:;]*m)*)→ /;
	const match = line.match(selectedPrefix);
	if (!match) return line;
	return `${replacement}${match[1]}${line.slice(match[0].length)}`;
}

export function isNativeCompletionCountRow(line: string): boolean {
	const withoutSgr = line.replace(/(?:\x1b\[|\u009b)[0-?]*[ -/]*m/g, "");
	return /^\s*\(\d+\/\d+\)\s*$/.test(withoutSgr);
}

export function omitTrailingNativeCompletionCountRow(lines: string[]): string[] {
	return lines.length > 0 && isNativeCompletionCountRow(lines.at(-1) ?? "")
		? lines.slice(0, -1)
		: lines;
}

export function renderCompletionRows({
	lines,
	width,
	theme,
	selectedPrefix,
	ownedBackground,
}: CompletionRowsOptions): string[] {
	return lines.map((line) => {
		const content = fillTerminalLine(replaceNativeSelectedPrefix(line, selectedPrefix), width);
		const surfaced = ownedBackground ? applyOwnedSurfaceBackground(theme, content) : content;
		return truncateTerminalLine(surfaced, width);
	});
}

function helpLabel(width: number): string {
	const labels = [
		" ↑↓ Navigate   Enter Use   Esc Close",
		" ↑↓ Nav   Enter Use   Esc",
		" ↑↓   Enter   Esc",
	];
	return labels.find((label) => visibleWidth(label) <= width) ?? labels.at(-1) ?? "";
}

/** Full-width, provenance-preserving completion shell for Opencode editor styles. */
export function renderCompletionPalette({
	lines,
	width,
	theme,
	renderSeparator,
	ownedBackground,
}: CompletionPaletteOptions): string[] {
	const resultLines = omitTrailingNativeCompletionCountRow(lines);
	if (resultLines.length === 0) return [];
	const safeWidth = Math.max(0, width);
	const rows = renderCompletionRows({
		lines: resultLines,
		width: safeWidth,
		theme,
		selectedPrefix: "  ",
		ownedBackground,
	});
	const separator = renderSeparator("─".repeat(safeWidth));
	if (safeWidth < 3) return [...rows, truncateToWidth(separator, safeWidth, "")];
	const helpText = fillTerminalLine(helpLabel(safeWidth), safeWidth);
	const help = ownedBackground ? applyOwnedSurfaceBackground(theme, helpText) : helpText;
	return [...rows, truncateToWidth(separator, safeWidth, ""), truncateToWidth(help, safeWidth, "")];
}
