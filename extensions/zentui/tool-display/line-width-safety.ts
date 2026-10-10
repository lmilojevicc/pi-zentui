/* Adapted from pi-tool-display 0.5.0, commit91cef7580078371f8dc49a8607222807ad6a424d.
 * MIT License
 *
 * Copyright (c) 2026 MasuRii
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
import { normalizeDiffRenderWidth } from "./diff-presentation.js";
import { pluralize } from "./render-utils.js";

export interface WidthMeasurementOps {
	measure(text: string): number;
	truncate(text: string, maxWidth: number): string;
}

export interface CollapsedDiffHintOptions {
	remainingLines: number;
	hiddenHunks: number;
}

function guardSafeWidth(width: number): number | undefined {
	const safe = normalizeDiffRenderWidth(width);
	return safe === 0 ? undefined : safe;
}

function renderWithSafeWidth<T>(width: number, fallback: T, render: (safeWidth: number) => T): T {
	const safeWidth = guardSafeWidth(width);
	if (safeWidth === undefined) {
		return fallback;
	}
	return render(safeWidth);
}

export function clampRenderedLineToWidth(
	text: string,
	width: number,
	ops: WidthMeasurementOps,
): string {
	return renderWithSafeWidth(width, "", (safeWidth) => {
		if (ops.measure(text) <= safeWidth) {
			return text;
		}

		for (let targetWidth = safeWidth; targetWidth >= 0; targetWidth--) {
			const candidate = ops.truncate(text, targetWidth);
			if (ops.measure(candidate) <= safeWidth) {
				return candidate;
			}
		}

		return "";
	});
}

export function clampRenderedLinesToWidth(
	lines: string[],
	width: number,
	ops: WidthMeasurementOps,
): string[] {
	return lines.map((line) => clampRenderedLineToWidth(line, width, ops));
}

export function buildCollapsedDiffHintText(
	options: CollapsedDiffHintOptions,
	width: number,
	ops: WidthMeasurementOps,
): string {
	return renderWithSafeWidth(width, "", (safeWidth) => {
		const remainingText = `${options.remainingLines} more ${pluralize(options.remainingLines, "diff line")}`;
		const hiddenHunksText =
			options.hiddenHunks > 0
				? `${options.hiddenHunks} more ${pluralize(options.hiddenHunks, "hunk")}`
				: undefined;
		const shortRemainingText = `${options.remainingLines} more ${pluralize(options.remainingLines, "line")}`;
		const shortHiddenHunksText =
			options.hiddenHunks > 0
				? `${options.hiddenHunks} ${pluralize(options.hiddenHunks, "hunk")}`
				: undefined;

		const candidates = [
			`… (${[remainingText, hiddenHunksText, "Ctrl+O to expand"].filter(Boolean).join(" • ")})`,
			`… (${[remainingText, hiddenHunksText].filter(Boolean).join(" • ")})`,
			`… (${[shortRemainingText, shortHiddenHunksText].filter(Boolean).join(" • ")})`,
			options.hiddenHunks > 0
				? `… (+${options.remainingLines} • +${options.hiddenHunks}h)`
				: `… (+${options.remainingLines})`,
			"…",
		];

		for (const candidate of candidates) {
			if (ops.measure(candidate) <= safeWidth) {
				return candidate;
			}
		}

		return clampRenderedLineToWidth(candidates[candidates.length - 1] ?? "", safeWidth, ops);
	});
}
