/**
 * Terminal escape sequence constants and helpers.
 *
 * @internal
 */

/** Enter alternate screen buffer. */
export const ENTER_ALT_SCREEN = "\x1b[?1049h";

/** Exit alternate screen buffer. */
export const EXIT_ALT_SCREEN = "\x1b[?1049l";

/** Enable SGR mouse reporting (button-event ?1002 + SGR ?1006 encoding).
 * Requires app-level drag-select because native terminal selection is
 * disabled while any mouse reporting mode is active. */
export const ENABLE_MOUSE_SGR = "\x1b[?1002h\x1b[?1006h";

/** Disable mouse reporting (all modes we may have enabled). */
export const DISABLE_MOUSE = "\x1b[?1002l\x1b[?1006l\x1b[?1000l";

/** Disable alternate scroll (xterm wheel-as-arrow in alt screen). */
export const DISABLE_ALT_SCROLL = "\x1b[?1007l";

/** Enable alternate scroll. */
export const ENABLE_ALT_SCROLL = "\x1b[?1007h";

/** Reset scroll region to full screen. */
export const RESET_SCROLL_REGION = "\x1b[r";

/** Begin synchronized output (reduce flicker). */
export const SYNC_BEGIN = "\x1b[?2026h";

/** End synchronized output. */
export const SYNC_END = "\x1b[?2026l";

/** Hide cursor. */
export const HIDE_CURSOR = "\x1b[?25l";

/** Show cursor. */
export const SHOW_CURSOR = "\x1b[?25h";

/** Clear entire line. */
export const CLEAR_LINE = "\x1b[2K";

/** Clear the current viewport without erasing scrollback. */
export const CLEAR_DISPLAY = "\x1b[2J";

/** Move the cursor home. */
export const HOME_CURSOR = "\x1b[H";

/** Disable auto-wrap (DECAWM off). */
export const DISABLE_AUTOWRAP = "\x1b[?7l";

/** Enable auto-wrap (DECAWM on). */
export const ENABLE_AUTOWRAP = "\x1b[?7h";

/** Set scroll region to rows [top, bottom] (1-indexed). */
export function setScrollRegion(top: number, bottom: number): string {
	return `\x1b[${top};${bottom}r`;
}

/** Move cursor to absolute position (1-indexed row, col). */
export function cursorTo(row: number, col: number): string {
	return `\x1b[${row};${col}H`;
}

/** Canonical idempotent reset for every terminal mode owned by Zentui. */
export const CANONICAL_TERMINAL_RESET =
	SYNC_BEGIN +
	RESET_SCROLL_REGION +
	DISABLE_MOUSE +
	DISABLE_ALT_SCROLL +
	ENABLE_AUTOWRAP +
	SHOW_CURSOR +
	EXIT_ALT_SCREEN +
	SYNC_END;

/** Clear-and-normalize prelude for a physical layout transition. */
export function transitionPrelude(target: "fixed" | "normal-flow"): string {
	return (
		SYNC_BEGIN +
		RESET_SCROLL_REGION +
		ENABLE_AUTOWRAP +
		DISABLE_MOUSE +
		(target === "fixed" ? DISABLE_ALT_SCROLL : ENABLE_ALT_SCROLL) +
		SHOW_CURSOR +
		HOME_CURSOR +
		CLEAR_DISPLAY +
		SYNC_END
	);
}

export function emergencyTerminalReset(): string {
	return CANONICAL_TERMINAL_RESET;
}
