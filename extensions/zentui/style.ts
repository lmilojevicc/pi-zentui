import type { ColorSpec } from "./config";

type ThemeLike = {
	fg(color: string, text: string): string;
};

export type { ThemeLike };

function isHexColor(value: string): boolean {
	return /^#(?:[0-9a-fA-F]{6})$/.test(value);
}

function hexToAnsi(hex: string, isBackground = false): string {
	const normalized = hex.slice(1);
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `\x1b[${isBackground ? 48 : 38};2;${r};${g};${b}m`;
}

const terminalColorCodes = new Map([
	["black", 30],
	["red", 31],
	["green", 32],
	["yellow", 33],
	["blue", 34],
	["purple", 35],
	["cyan", 36],
	["white", 37],
	["bright-black", 90],
	["bright-red", 91],
	["bright-green", 92],
	["bright-yellow", 93],
	["bright-blue", 94],
	["bright-purple", 95],
	["bright-cyan", 96],
	["bright-white", 97],
]);

const terminalStyleModifiers = new Map([
	["bold", 1],
	["dim", 2],
	["dimmed", 2],
	["italic", 3],
	["underline", 4],
]);

function terminalColorToAnsi(color: string): string | undefined {
	const normalized = color.toLowerCase();
	const colorCode = terminalColorCodes.get(normalized);
	if (colorCode !== undefined) return `${colorCode}`;

	if (/^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(normalized)) {
		return `38;5;${normalized}`;
	}

	if (isHexColor(normalized)) return hexToAnsi(normalized).slice(2, -1);
	return undefined;
}

/**
 * Colorize text using a theme color token or hex color.
 * Non-hex values are passed directly to `theme.fg()` — if the token
 * is valid it renders styled, otherwise the theme handles fallback.
 */
export function colorize(theme: ThemeLike, color: ColorSpec, text: string): string {
	if (isHexColor(color)) {
		return `${hexToAnsi(color)}${text}\x1b[39m`;
	}
	return theme.fg(color, text);
}

/**
 * Render text with Starship-style terminal styling strings (e.g. "bold red", "fg:202").
 */
export function renderTerminalStyle(style: string, text: string): string {
	const codes: string[] = [];
	for (const token of style.trim().split(/\s+/)) {
		if (!token) continue;

		const normalized = token.toLowerCase();
		const modifier = terminalStyleModifiers.get(normalized);
		if (modifier !== undefined) {
			codes.push(`${modifier}`);
			continue;
		}

		const foreground = normalized.startsWith("fg:") ? normalized.slice(3) : normalized;
		const color = terminalColorToAnsi(foreground);
		if (color) codes.push(color);
	}

	return codes.length ? `\x1b[${codes.join(";")}m${text}\x1b[0m` : text;
}
