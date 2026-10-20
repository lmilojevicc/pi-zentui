/**
 * Rail glyph resolution for the Editor and User messages components.
 *
 * Each owner resolves its own glyph so a rail choice in one component never
 * rewrites the other. The canonical per-component glyph is validated to
 * exactly one terminal cell; anything wider, empty, or control-bearing falls
 * back safely. `asciiRail` is the ASCII-icon-mode override of the same
 * canonical `rail`, so an explicit `rail` still applies in every icon mode.
 * The historical shared `icons.rail` fallback stays untouched.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ZentuiConfig } from "./config.ts";
import { sanitizeEditorMetadataText } from "./editor-metadata-format.ts";

/** Nerd-mode fallback used when a configured rail is missing or unusable. */
export const DEFAULT_RAIL_GLYPH = "│";
/** ASCII-mode fallback used when a configured rail is missing or unusable. */
export const DEFAULT_ASCII_RAIL_GLYPH = "|";
/** Accent Rail keeps its own filled-rail default. */
export const DEFAULT_ACCENT_RAIL_GLYPH = "▎";

/** Rail glyphs offered by the Editor and User messages settings panels. */
export const RAIL_GLYPH_CHOICES = ["│", "┃", "▎", "▌", "|"] as const;

/** Settings label for "inherit the shared/default glyph". */
export const RAIL_GLYPH_INHERIT = "Default";

/** Keep the first terminal cell of a sanitized value without adding escape codes. */
function firstCell(value: string): string {
	let result = "";
	for (const character of value) {
		const candidate = result + character;
		if (visibleWidth(candidate) > 1) break;
		result = candidate;
	}
	return result;
}

/**
 * Normalize a configured glyph to exactly one terminal cell.
 *
 * Returns undefined when the value cannot be used as a rail: control
 * sequences, empty strings, and wide characters all fail closed. Surrounding
 * whitespace is dropped so a padded value still selects its glyph instead of
 * degrading into an invisible blank rail cell.
 */
export function normalizeRailGlyph(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const sanitized = sanitizeEditorMetadataText(value).trim();
	if (!sanitized) return undefined;
	const glyph = firstCell(sanitized);
	return visibleWidth(glyph) === 1 ? glyph : undefined;
}

function asciiIconMode(config: ZentuiConfig): boolean {
	return config.icons.effectiveMode === "ascii";
}

/**
 * The canonical owner glyph.
 *
 * `asciiRail` is the ASCII-icon-mode override of the same rail, so a
 * hand-written `rail` keeps working while the effective icon mode is `ascii`.
 * This mirrors `icons.rail`, where an explicit override wins in every mode and
 * only the built-in defaults are mode-specific.
 */
function canonicalEditorRail(config: ZentuiConfig): string | undefined {
	const editor = config.components.editor;
	return asciiIconMode(config) ? (editor.asciiRail ?? editor.rail) : editor.rail;
}

function canonicalUserMessageRail(config: ZentuiConfig): string | undefined {
	const messages = config.components.userMessages;
	return asciiIconMode(config) ? (messages.asciiRail ?? messages.rail) : messages.rail;
}

/**
 * The Accent Rail editor's rail glyph.
 *
 * The canonical `components.editor.rail` choice wins; otherwise the style's
 * own `rail` / `asciiRail` setting stays in charge.
 */
export function resolveAccentRailGlyph(config: ZentuiConfig): string {
	const canonical = normalizeRailGlyph(canonicalEditorRail(config));
	if (canonical) return canonical;
	const ascii = asciiIconMode(config);
	const style = config.components.editor.styles["accent-rail"];
	const fallback = ascii ? DEFAULT_ASCII_RAIL_GLYPH : DEFAULT_ACCENT_RAIL_GLYPH;
	const configured = ascii ? style.asciiRail : style.rail;
	const sanitized = sanitizeEditorMetadataText(configured);
	const glyph = truncateToWidth(sanitized, 1, "");
	return visibleWidth(glyph) === 1 ? glyph : fallback;
}

/**
 * The rail glyph of the Opencode editor frame.
 *
 * The canonical `components.editor.rail` choice wins; otherwise the shared
 * `icons.rail` stays the historical fallback. Frame provenance uses the same
 * glyph the Opencode frame renders, so ownership checks stay consistent.
 */
export function resolveEditorFrameRailGlyph(config: ZentuiConfig): string {
	const canonical = normalizeRailGlyph(canonicalEditorRail(config));
	if (canonical) return canonical;
	return config.icons.rail;
}

/**
 * The user-message rail glyph.
 *
 * The canonical `components.userMessages.rail` choice wins; otherwise the
 * shared `icons.rail` stays the historical fallback.
 */
export function resolveUserMessageRailGlyph(config: ZentuiConfig): string {
	const canonical = normalizeRailGlyph(canonicalUserMessageRail(config));
	if (canonical) return canonical;
	return config.icons.rail;
}
