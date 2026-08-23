import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	applyOwnedSurfaceBackground,
	fillTerminalLine,
	renderCompletionRows,
} from "./completion-menu";
import type { ZentuiConfig } from "./config";
import { sanitizeEditorMetadataText } from "./editor-metadata-format";
import { renderStyleForSourceOrFallback, type SourceStyleFallback } from "./style";

export const ACCENT_RAIL_CHROME_WIDTH = 2;

const ACCENT_RAIL_FALLBACK: SourceStyleFallback = {
	theme: "syntaxNumber",
	terminal: "fg:215",
};

export type AccentRailViewport = {
	above?: string;
	below?: string;
};

export type AccentRailEditorFrameOptions = {
	width: number;
	editorLines: string[];
	autocompleteLines?: string[];
	viewport?: AccentRailViewport;
	uiTheme: Theme;
	config: ZentuiConfig;
};

function clampLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

function selectedRail(config: ZentuiConfig): string {
	const style = config.components.editor.styles["accent-rail"];
	const fallback = config.icons.mode === "ascii" ? "|" : "▎";
	const configured = config.icons.mode === "ascii" ? style.asciiRail : style.rail;
	const sanitized = sanitizeEditorMetadataText(configured);
	const glyph = truncateToWidth(sanitized, 1, "");
	return visibleWidth(glyph) === 1 ? glyph : fallback;
}

function viewportLabel(
	direction: "above" | "below",
	count: string | undefined,
): string | undefined {
	if (!count || !/^[1-9]\d*$/.test(count)) return undefined;
	return `${direction === "above" ? "↑" : "↓"} ${count} more`;
}

/** Pure compact accent-rail composition shared by live rendering and settings previews. */
export function renderAccentRailEditorFrame({
	width,
	editorLines,
	autocompleteLines = [],
	viewport = {},
	uiTheme,
	config,
}: AccentRailEditorFrameOptions): string[] {
	if (width < ACCENT_RAIL_CHROME_WIDTH + 1) {
		return clampLines([...editorLines, ...autocompleteLines], width);
	}

	const contentWidth = width - ACCENT_RAIL_CHROME_WIDTH;
	const rail = renderStyleForSourceOrFallback(
		uiTheme,
		config.components.editor.colorSource,
		config.colors.editorRail,
		ACCENT_RAIL_FALLBACK,
		selectedRail(config),
	);
	const above = config.components.editor.viewportIndicators
		? viewportLabel("above", viewport.above)
		: undefined;
	const below = config.components.editor.viewportIndicators
		? viewportLabel("below", viewport.below)
		: undefined;
	const rows = [...(above ? [above] : []), ...editorLines, ...(below ? [below] : [])];
	const transparent = config.components.editor.styles["accent-rail"].transparent;
	const surface = rows.map((line) => {
		const railCell = transparent ? rail : applyOwnedSurfaceBackground(uiTheme, rail);
		const bodyText = ` ${fillTerminalLine(line, contentWidth)}`;
		const body = transparent ? bodyText : applyOwnedSurfaceBackground(uiTheme, bodyText);
		return `${railCell}${body}`;
	});
	const autocompleteSurface = renderCompletionRows({
		lines: autocompleteLines,
		width,
		theme: uiTheme,
		selectedPrefix: `${rail} `,
		ownedBackground: !transparent,
	});

	return clampLines([...surface, ...autocompleteSurface], width);
}
