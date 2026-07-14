/**
 * Pure functions for parsing terminal input into scroll commands.
 *
 * These are fully unit-testable with no I/O or side effects.
 */

import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

import type { KeyboardScrollInput, MouseEvent, MouseScrollInput } from "./types";

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
	const ev = parseMouseEvent(data);
	if (!ev) return undefined;
	if (ev.button === "wheel-up") return { direction: "up", amount: SCROLL_AMOUNT };
	if (ev.button === "wheel-down") return { direction: "down", amount: SCROLL_AMOUNT };
	return undefined;
}

/**
 * Parse any SGR mouse event (press, drag, release, wheel).
 * Returns `undefined` if the data is not a mouse sequence.
 */
export function parseMouseEvent(data: string): MouseEvent | undefined {
	const match = SGR_MOUSE_RE.exec(data);
	if (!match) return undefined;
	const code = Number(match[1]);
	const col = Number(match[2]);
	const row = Number(match[3]);
	const isRelease = match[4] === "m";
	const isMotion = (code & 32) !== 0;
	const baseButton = code & ~(4 | 8 | 16 | 32);

	const button: MouseEvent["button"] =
		baseButton === 0
			? "left"
			: baseButton === 1
				? "middle"
				: baseButton === 2
					? "right"
					: baseButton === WHEEL_UP
						? "wheel-up"
						: baseButton === WHEEL_DOWN
							? "wheel-down"
							: "other";

	const action: MouseEvent["action"] = isRelease ? "release" : isMotion ? "drag" : "press";

	return { button, action, col, row };
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
