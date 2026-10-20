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
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { pluralize } from "./render-utils.ts";
import type { ToolDisplayConfig } from "./types.ts";

export interface DiffSummaryStats {
	added: number;
	removed: number;
	hunks: number;
	files: number;
}

export type DiffPresentationMode = "split" | "unified" | "compact" | "summary";

const MIN_COMPACT_DIFF_WIDTH = 8;
const MIN_UNIFIED_DIFF_WIDTH = 18;

export function normalizeDiffRenderWidth(width: number): number {
	if (!Number.isFinite(width)) {
		return 0;
	}
	return Math.max(0, Math.floor(width));
}

export function resolveDiffPresentationMode(
	config: Pick<ToolDisplayConfig, "diffViewMode" | "diffSplitMinWidth">,
	width: number,
	canRenderSplitLayout: boolean,
): DiffPresentationMode {
	const safeWidth = normalizeDiffRenderWidth(width);
	if (safeWidth < MIN_COMPACT_DIFF_WIDTH) {
		return "summary";
	}
	if (safeWidth < MIN_UNIFIED_DIFF_WIDTH) {
		return "compact";
	}

	switch (config.diffViewMode) {
		case "split":
			return canRenderSplitLayout ? "split" : "unified";
		case "unified":
			return "unified";
		default:
			return safeWidth >= config.diffSplitMinWidth && canRenderSplitLayout ? "split" : "unified";
	}
}

export function buildDiffSummaryText(stats: DiffSummaryStats, width: number): string {
	const safeWidth = normalizeDiffRenderWidth(width);
	if (safeWidth === 0) {
		return "";
	}

	const summaryCandidates = [
		`↳ diff +${stats.added} -${stats.removed} • ${stats.hunks} ${pluralize(stats.hunks, "hunk")} • ${stats.files} ${pluralize(stats.files, "file")}`,
		`↳ diff +${stats.added} -${stats.removed} • ${stats.hunks}h • ${stats.files}f`,
		`↳ diff +${stats.added} -${stats.removed}`,
		`+${stats.added} -${stats.removed}`,
		"diff",
		"…",
	];

	for (const candidate of summaryCandidates) {
		if (visibleWidth(candidate) <= safeWidth) {
			return candidate;
		}
	}

	return truncateToWidth(summaryCandidates[summaryCandidates.length - 1] ?? "", safeWidth, "");
}
