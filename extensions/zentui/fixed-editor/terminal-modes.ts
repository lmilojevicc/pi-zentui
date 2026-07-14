/**
 * Terminal escape sequence constants and helpers.
 *
 * @internal
 */

/** Enter alternate screen buffer. */
export const ENTER_ALT_SCREEN = "\x1b[?1049h";

/** Exit alternate screen buffer. */
export const EXIT_ALT_SCREEN = "\x1b[?1049l";

/** Enable SGR mouse mode (button-event + 1006 encoding). */
export const ENABLE_MOUSE_SGR = "\x1b[?1002h\x1b[?1006h";

/** Disable mouse reporting (all modes). */
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

/**
 * Emit all sequences needed to restore the terminal to a safe state.
 * Call on dispose and process.exit to avoid leaving the terminal broken.
 */
export function emergencyTerminalReset(): string {
	return (
		SYNC_BEGIN +
		RESET_SCROLL_REGION +
		DISABLE_MOUSE +
		ENABLE_ALT_SCROLL +
		EXIT_ALT_SCREEN +
		SYNC_END
	);
}
