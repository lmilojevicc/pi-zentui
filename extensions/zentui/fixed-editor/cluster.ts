/**
 * Cluster rendering for the fixed editor.
 *
 * Pi-specific cluster discovery and validation live in pi-compat.ts. This module
 * only renders the already-verified pinned components.
 *
 * @internal
 */

import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { PiFixedCluster, PiRenderableCapability } from "./pi-compat";
import type { ClusterRender } from "./types";

export type FixedCluster = PiFixedCluster;

function renderComponent(component: PiRenderableCapability | null, width: number): string[] {
	if (!component) return [];
	const lines = component.render.call(component.target, width);
	// Strip only trailing blank lines — internal blank lines (e.g. editor
	// padding in copy-friendly mode) must be preserved.
	let end = lines.length;
	while (end > 0 && visibleWidth(lines[end - 1]) === 0) end--;
	return lines.slice(0, Math.max(end, 1));
}

/**
 * Cap editor lines to `maxLines`, keeping the cursor row visible.
 * If the cursor marker is found, the window centers on it; otherwise
 * the last `maxLines` are kept.
 */
export function capEditorLines(lines: string[], maxLines: number): string[] {
	if (maxLines <= 0) return [];
	if (lines.length <= maxLines) return lines;

	const cursorRow = lines.findIndex((line) => line.includes(CURSOR_MARKER));
	if (cursorRow !== -1) {
		const start = Math.max(0, Math.min(cursorRow - maxLines + 1, lines.length - maxLines));
		return lines.slice(start, start + maxLines);
	}
	return lines.slice(lines.length - maxLines);
}

function sanitizeLines(lines: string[], width: number): string[] {
	return lines.map((line) =>
		visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line,
	);
}

function stripLeadingBlankLines(lines: string[]): string[] {
	let start = 0;
	while (start < lines.length && visibleWidth(lines[start] ?? "") === 0) start++;
	return lines.slice(start);
}

/**
 * Render the full cluster (status + widgets + editor + footer) and extract
 * the cursor position from the CURSOR_MARKER.
 */
export function renderCluster(
	cluster: FixedCluster,
	width: number,
	maxHeight: number,
): ClusterRender {
	const w = Math.max(1, width);
	const maxRows = Math.max(1, maxHeight - 1);

	// Pi's Loader intentionally starts with a blank line so the live status is
	// separated from the transcript. The fixed-editor cluster owns the bottom
	// layout, so discard that status-internal blank here; the editor separator is
	// preserved from Pi's above-editor widget or supplied explicitly below.
	const statusLines = stripLeadingBlankLines(sanitizeLines(renderComponent(cluster.status, w), w));
	const aboveLines = sanitizeLines(renderComponent(cluster.aboveWidget, w), w);
	const editorSource = sanitizeLines(renderComponent(cluster.editor, w), w);
	const belowLines = sanitizeLines(renderComponent(cluster.belowWidget, w), w);
	const footerLines = sanitizeLines(renderComponent(cluster.footer, w), w);

	// Pi normally supplies a one-line above-editor Spacer. Do not add a second
	// separator when that widget is present; add one only for layouts where the
	// widget is absent or ends in visible content.
	const aboveEditorSpacerPresent =
		aboveLines.length > 0 && visibleWidth(aboveLines.at(-1) ?? "") === 0;
	const editorGapRows = editorSource.length > 0 ? 1 : 0;
	const editorLines = capEditorLines(editorSource, Math.max(0, maxRows - editorGapRows));
	let remaining = maxRows - editorLines.length - editorGapRows;

	const footer = footerLines.slice(-remaining);
	remaining -= footer.length;

	const below = belowLines.slice(-remaining);
	remaining -= below.length;

	const above = aboveLines.slice(-remaining);
	remaining -= above.length;

	const status = statusLines.slice(-remaining);

	const allLines = [
		...status,
		...above,
		...(editorLines.length > 0 && !aboveEditorSpacerPresent ? [""] : []),
		...editorLines,
		...below,
		...footer,
	];

	let cursor: { row: number; col: number } | null = null;
	const cleaned = allLines.map((line, row) => {
		const markerIndex = line.indexOf(CURSOR_MARKER);
		if (markerIndex === -1) return line;
		cursor ??= { row, col: visibleWidth(line.slice(0, markerIndex)) };
		return line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
	});

	return { lines: cleaned, cursor };
}
