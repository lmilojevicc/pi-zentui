/** Fixed-editor source collection and planned cluster materialization. @internal */

import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFixedEditorLayout } from "./editor-layout";
import { planFixedLayout, takeTail } from "./layout";
import type { PiFixedCluster, PiRenderableCapability } from "./pi-compat";
import type { ClusterRender } from "./types";

export type FixedCluster = PiFixedCluster;

function renderComponent(
	component: PiRenderableCapability | null,
	width: number,
	trim = true,
): string[] {
	if (!component) return [];
	const lines = component.render.call(component.target, width);
	if (!trim) return [...lines];
	let end = lines.length;
	while (end > 0 && visibleWidth(lines[end - 1] ?? "") === 0) end--;
	return lines.slice(0, Math.max(end, lines.length > 0 ? 1 : 0));
}

function sanitizeLines(lines: readonly string[], width: number): string[] {
	return lines.map((line) =>
		visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line,
	);
}

export function collectClusterSource(cluster: FixedCluster, width: number) {
	const w = Math.max(1, Math.floor(width));
	const status = sanitizeLines(renderComponent(cluster.status, w), w);
	const above = sanitizeLines(renderComponent(cluster.aboveWidget, w), w);
	const editor = sanitizeLines(renderComponent(cluster.editor, w, false), w);
	const below = sanitizeLines(renderComponent(cluster.belowWidget, w), w);
	const footer = sanitizeLines(renderComponent(cluster.footer, w), w);
	const metadata = readFixedEditorLayout(cluster.editorChild, editor, w);
	return { width: w, status, above, editor, below, footer, metadata };
}

export function renderCluster(
	cluster: FixedCluster,
	width: number,
	rawRows: number,
): ClusterRender {
	const normalizedRows = Math.max(0, Math.floor(Number.isFinite(rawRows) ? rawRows : 0));
	if (normalizedRows === 0)
		return {
			mode: "no-terminal-rows",
			lines: [],
			cursor: null,
			plan: { mode: "no-terminal-rows", pendingDesiredMode: "fixed" },
		};
	const source = collectClusterSource(cluster, width);
	const plan = planFixedLayout({
		rawRows: normalizedRows,
		editorRows: source.editor,
		metadata: source.metadata,
		statusRows: source.status,
		aboveRows: source.above,
		belowRows: source.below,
		footerRows: source.footer,
	});
	if (plan.mode !== "fixed") return { mode: "normal-flow", lines: [], cursor: null, plan };

	const selectedRows = new Set([...plan.selectedEditorRows, ...plan.selectedAutocompleteRows]);
	const editor = source.editor.filter((_line, index) => selectedRows.has(index));
	let allLines = [
		...takeTail(source.status, plan.statusBudget),
		...takeTail(source.above, plan.aboveBudget),
		...editor,
		...takeTail(source.below, plan.belowBudget),
		...takeTail(source.footer, plan.footerBudget),
	];
	let start = 0;
	while (start < allLines.length - 1 && visibleWidth(allLines[start] ?? "") === 0) start++;
	allLines = allLines.slice(start);

	let cursor: { row: number; col: number } | null = null;
	const cleaned = allLines.map((line, row) => {
		const markerIndex = line.indexOf(CURSOR_MARKER);
		if (markerIndex === -1) return line;
		cursor ??= { row, col: visibleWidth(line.slice(0, markerIndex)) };
		return line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
	});
	return { mode: "fixed", lines: cleaned, cursor, plan };
}
