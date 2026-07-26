import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CompactFooterMaxLines } from "./config";
import type { CompactBoundaryKind } from "./footer-format";

export type FooterZones = {
	left: string;
	middle: string;
	right: string;
};

export function fullFooterFitsAligned(zones: FooterZones, innerWidth: number): boolean {
	const leftWidth = visibleWidth(zones.left);
	const middleWidth = visibleWidth(zones.middle);
	const rightWidth = visibleWidth(zones.right);
	if (middleWidth === 0) {
		return leftWidth + rightWidth + (leftWidth > 0 && rightWidth > 0 ? 1 : 0) <= innerWidth;
	}

	const gapWidth = innerWidth - leftWidth - rightWidth;
	if (gapWidth < middleWidth) return false;
	const leftPadding = Math.floor((gapWidth - middleWidth) / 2);
	const rightPadding = gapWidth - middleWidth - leftPadding;
	return (leftWidth === 0 || leftPadding >= 1) && (rightWidth === 0 || rightPadding >= 1);
}

function joinZones(parts: string[]): string {
	return parts.filter(Boolean).join(" ");
}

function validRows(rows: string[], innerWidth: number): string[] | undefined {
	const nonEmpty = rows.filter(Boolean);
	if (nonEmpty.length === 0 || nonEmpty.length > 2) return undefined;
	return nonEmpty.every((row) => visibleWidth(row) <= innerWidth) ? nonEmpty : undefined;
}

/** Prefer project identity alone, with middle/right status on the second row. */
export function reflowFullFooter(zones: FooterZones, innerWidth: number): string[] | undefined {
	const preferred = validRows([zones.left, joinZones([zones.middle, zones.right])], innerWidth);
	if (preferred) return preferred;
	return validRows([joinZones([zones.left, zones.middle]), zones.right], innerWidth);
}

export function compactChunkBudget(innerWidth: number): number {
	return Math.max(8, Math.floor((innerWidth - 1) / 2));
}

export type CompactLayoutChunk = {
	text: string;
	boundary: CompactBoundaryKind;
};

type PackedRow = {
	text: string;
	endsWithRendererEllipsis: boolean;
};

function fitChunk(chunk: string, innerWidth: number): PackedRow {
	if (visibleWidth(chunk) <= innerWidth) {
		return { text: chunk, endsWithRendererEllipsis: false };
	}
	return {
		text: truncateToWidth(chunk, innerWidth, "…"),
		endsWithRendererEllipsis: true,
	};
}

function appendOmissionMarker(row: PackedRow, innerWidth: number): PackedRow {
	if (row.endsWithRendererEllipsis) return row;
	if (innerWidth <= 1) return { text: "…", endsWithRendererEllipsis: true };
	return {
		text: `${truncateToWidth(row.text, innerWidth - 1, "")}…`,
		endsWithRendererEllipsis: true,
	};
}

export function packCompactChunks(
	chunks: CompactLayoutChunk[],
	innerWidth: number,
	maxLines: CompactFooterMaxLines,
	separator: string,
): string[] {
	if (innerWidth <= 0) return [""];
	const content = chunks
		.map((chunk) => ({ ...chunk, text: chunk.text.trim() }))
		.filter((chunk) => chunk.text.length > 0);
	if (content.length === 0) return [""];

	const finiteLimit = maxLines === "unlimited" ? Number.POSITIVE_INFINITY : maxLines;
	const rows: PackedRow[] = [];
	let current: PackedRow | undefined;
	let omitted = false;

	for (const chunk of content) {
		const fitted = fitChunk(chunk.text, innerWidth);
		if (!current) {
			current = fitted;
			continue;
		}

		const join = chunk.boundary === "separator" ? separator : " ";
		const candidate = `${current.text}${join}${fitted.text}`;
		if (visibleWidth(candidate) <= innerWidth) {
			current = {
				text: candidate,
				endsWithRendererEllipsis: fitted.endsWithRendererEllipsis,
			};
			continue;
		}

		if (rows.length + 1 < finiteLimit) {
			rows.push(current);
			current = fitted;
			continue;
		}

		omitted = true;
		break;
	}

	if (current) rows.push(omitted ? appendOmissionMarker(current, innerWidth) : current);
	return rows.map((row) => truncateToWidth(row.text, innerWidth, ""));
}
