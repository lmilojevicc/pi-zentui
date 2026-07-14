/**
 * Pure functions for parsing terminal input into scroll commands.
 *
 * These are fully unit-testable with no I/O or side effects.
 */

import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

import type { KeyboardScrollInput, MouseScrollInput } from "./types";

/** Regex matching SGR mouse format `\x1b[<code;col;row M|m`. */
const SGR_MOUSE_RE = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/;

/** Kitty protocol variants for PgUp/PgDn ( CSI 5;~u / CSI 6;~u etc). */
const KITTY_PAGE_UP_RE = /^\u001b\[5;9(?::[12])?~$|^\u001b\[57421;9(?::[12])?u$|^\u001b\[1;6A$/;
const KITTY_PAGE_DOWN_RE = /^\u001b\[6;9(?::[12])?~$|^\u001b\[57422;9(?::[12])?u$|^\u001b\[1;6B$/;

/** Mouse wheel button codes (SGR). */
const WHEEL_UP = 64;
const WHEEL_DOWN = 65;
const SCROLL_AMOUNT = 3;

/**
 * Parse an SGR mouse sequence for wheel scroll.
 * Returns `undefined` if the data is not a wheel event.
 */
export function parseMouseScroll(data: string): MouseScrollInput | undefined {
	const match = SGR_MOUSE_RE.exec(data);
	if (!match) return undefined;
	const code = Number(match[1]);
	// Mask off modifier bits (4=shift, 8=meta, 16=control, 32=motion).
	const baseButton = code & ~(4 | 8 | 16 | 32);
	if (baseButton === WHEEL_UP) return { direction: "up", amount: SCROLL_AMOUNT };
	if (baseButton === WHEEL_DOWN) return { direction: "down", amount: SCROLL_AMOUNT };
	return undefined;
}

/**
 * Parse keyboard input for scroll commands.
 * Handles PgUp/PgDn, Ctrl+Shift+↑/↓, and Enter (jump-to-bottom).
 * Returns `undefined` if the input is not a scroll command.
 */
export function parseKeyboardScroll(data: string): KeyboardScrollInput | undefined {
	if (isKeyRelease(data)) return undefined;

	if (matchesKey(data, "pageUp") || KITTY_PAGE_UP_RE.test(data)) return { action: "pageUp" };
	if (matchesKey(data, "pageDown") || KITTY_PAGE_DOWN_RE.test(data)) return { action: "pageDown" };
	if (matchesKey(data, "enter") || matchesKey(data, "return")) return { action: "jumpBottom" };

	return undefined;
}

/** Clamp scroll offset to [0, maxOffset]. */
export function clampScrollOffset(offset: number, maxOffset: number): number {
	return Math.max(0, Math.min(offset, maxOffset));
}
