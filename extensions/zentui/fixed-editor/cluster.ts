/**
 * Cluster discovery and rendering for the fixed editor.
 *
 * The "cluster" is the set of Pi TUI children around the editor that should be
 * pinned at the bottom: status container, above-editor widget, editor,
 * below-editor widget, and footer.
 *
 * @internal
 */

import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ClusterRender } from "./types";

/** Minimal Component shape needed for rendering. */
type Renderable = {
	render(width: number): string[];
};

/** Minimal Container shape for child scanning. */
type ContainerLike = Renderable & {
	children: unknown[];
};

/** Check if a value is a container-like object (has children + render). */
function isContainerLike(value: unknown): value is ContainerLike {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray(Reflect.get(value, "children")) &&
		typeof Reflect.get(value, "render") === "function"
	);
}

/** Check if a value looks like an editor component (duck-typed). */
function isEditorLike(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "getText") === "function" &&
		typeof Reflect.get(value, "setText") === "function" &&
		typeof Reflect.get(value, "handleInput") === "function"
	);
}

/**
 * Find the index in `children` of the container holding the editor.
 * Prefers the focused component's parent; falls back to scanning for
 * an editor-like grandchild.
 */
export function findEditorContainerIndex(
	children: unknown[],
	focusedComponent?: unknown,
): number | undefined {
	// Try focused component first.
	if (focusedComponent && typeof focusedComponent === "object") {
		const idx = children.findIndex(
			(c) => isContainerLike(c) && c.children.includes(focusedComponent),
		);
		if (idx !== -1) return idx;
	}

	// Scan for a container with an editor-like child.
	const idx = children.findIndex(
		(c) => isContainerLike(c) && c.children.some((gc) => isEditorLike(gc)),
	);
	return idx === -1 ? undefined : idx;
}

/** The 5-component cluster pinned at the bottom. */
export type FixedCluster = {
	status: Renderable | null;
	aboveWidget: Renderable | null;
	editor: Renderable;
	belowWidget: Renderable | null;
	footer: Renderable | null;
};

/** Build the cluster from children around the editor index. */
export function buildCluster(children: unknown[], editorIdx: number): FixedCluster | null {
	const editor = children[editorIdx];
	if (!editor || typeof (editor as Renderable).render !== "function") return null;
	return {
		status: (children[editorIdx - 2] as Renderable | undefined) ?? null,
		aboveWidget: (children[editorIdx - 1] as Renderable | undefined) ?? null,
		editor: editor as Renderable,
		belowWidget: (children[editorIdx + 1] as Renderable | undefined) ?? null,
		footer: (children[editorIdx + 2] as Renderable | undefined) ?? null,
	};
}

/** Render a component at `width`, filtering out empty lines. */
function renderComponent(component: Renderable | null, width: number): string[] {
	if (!component) return [];
	const lines = component.render(width);
	return lines.filter((line) => visibleWidth(line) > 0);
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

	const statusLines = sanitizeLines(renderComponent(cluster.status, w), w);
	const aboveLines = sanitizeLines(renderComponent(cluster.aboveWidget, w), w);
	const editorSource = sanitizeLines(renderComponent(cluster.editor, w), w);
	const belowLines = sanitizeLines(renderComponent(cluster.belowWidget, w), w);
	const footerLines = sanitizeLines(renderComponent(cluster.footer, w), w);

	const editorLines = capEditorLines(editorSource, maxRows);
	let remaining = maxRows - editorLines.length;

	const footer = footerLines.slice(-remaining);
	remaining -= footer.length;

	const below = belowLines.slice(-remaining);
	remaining -= below.length;

	const above = aboveLines.slice(-remaining);
	remaining -= above.length;

	const status = statusLines.slice(-remaining);

	const allLines = [...status, ...above, ...editorLines, ...below, ...footer];

	let cursor: { row: number; col: number } | null = null;
	const cleaned = allLines.map((line, row) => {
		const markerIndex = line.indexOf(CURSOR_MARKER);
		if (markerIndex === -1) return line;
		cursor ??= { row, col: visibleWidth(line.slice(0, markerIndex)) };
		return line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
	});

	return { lines: cleaned, cursor };
}
