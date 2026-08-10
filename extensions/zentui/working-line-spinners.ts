import type { WorkingLineSpinner } from "./config";

/*
 * Pulse frames adapted from Funky UI's animations.ts:
 * https://github.com/pi-zza/funky-ui/blob/e9aed319a4de61c2b2a5e99009821efa7b67b178/packages/funky-ui/extensions/funky-ui/animations.ts
 * Frozen imported source revision:
 * https://github.com/lmilojevicc/pi-zza/blob/37d82d565c1f5a9aa9b31d4b1711fa5604eb04a1/packages/funky-ui/extensions/funky-ui/animations.ts
 *
 * Funky UI's NOTICE states that the package combines Marko Nakic's Funky UI
 * source with code derived from FammasMaz/pi-cc-tools, published as
 * pi-claude-style-tools.
 *
 * MIT License
 *
 * Copyright (c) FammasMaz/pi-cc-tools contributors
 * Copyright (c) 2026 Marko Nakic
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/** Spinner definitions contain frames only; spinnerIntervalMs remains user-controlled. */
export const WORKING_LINE_SPINNERS = {
	braille: {
		frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	},
	"star-bloom": {
		frames: ["·", "✦", "✧", "✶", "✧", "✦"],
	},
	pinwheel: {
		frames: ["-", "\\", "|", "/"],
	},
	"claude-inspired": {
		frames: ["·", "✢", "✳", "✶", "✻", "✽"],
	},
	pulse: {
		frames: ["⠀⠶⠀", "⠰⣿⠆", "⢾⣉⡷", "⣏⠀⣹", "⡁⠀⢈"],
	},
} as const satisfies Record<WorkingLineSpinner, { frames: readonly string[] }>;
