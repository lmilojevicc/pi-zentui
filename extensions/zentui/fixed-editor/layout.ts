import type { FixedEditorLayoutMetadata } from "./editor-layout";
import type { FixedLayoutPlan } from "./types";

export function takeTail<T>(rows: readonly T[], budget: number): T[] {
	const count = Math.max(0, Math.floor(budget));
	if (count <= 0) return [];
	return rows.slice(Math.max(0, rows.length - count));
}

export function cropAround<T>(rows: readonly T[], anchor: number, budget: number): T[] {
	const count = Math.max(0, Math.floor(budget));
	if (count <= 0 || rows.length === 0) return [];
	if (rows.length <= count) return [...rows];
	const at = Math.max(0, Math.min(rows.length - 1, Math.floor(anchor)));
	const start = Math.max(0, Math.min(at - Math.floor((count - 1) / 2), rows.length - count));
	return rows.slice(start, start + count);
}

function expand(ranges: readonly { start: number; end: number }[]): number[] {
	return ranges.flatMap(({ start, end }) =>
		Array.from({ length: end - start }, (_, index) => start + index),
	);
}

function sorted(values: Iterable<number>): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

export type FixedLayoutInput = {
	rawRows: number;
	desiredMode?: "fixed" | "normal-flow";
	editorRows: readonly string[];
	metadata?: FixedEditorLayoutMetadata;
	statusRows?: readonly string[];
	aboveRows?: readonly string[];
	belowRows?: readonly string[];
	footerRows?: readonly string[];
};

export function planFixedLayout(input: FixedLayoutInput): FixedLayoutPlan {
	const rawRows = Math.max(0, Math.floor(Number.isFinite(input.rawRows) ? input.rawRows : 0));
	const desired = input.desiredMode ?? "fixed";
	if (rawRows === 0) return { mode: "no-terminal-rows", pendingDesiredMode: desired };
	const available = Math.max(0, rawRows - 1);
	if (desired === "normal-flow") {
		return {
			mode: "normal-flow",
			reason: input.metadata ? "editor-minimum-does-not-fit" : "opaque-editor-does-not-fit",
		};
	}

	let editorRows: number[];
	let autocompleteRows: number[] = [];
	let used = 0;
	if (!input.metadata) {
		if (input.editorRows.length > available)
			return { mode: "normal-flow", reason: "opaque-editor-does-not-fit" };
		editorRows = input.editorRows.map((_, index) => index);
		used = editorRows.length;
	} else {
		const metadata = input.metadata;
		const editorMinimum = sorted([
			...metadata.editor.structuralRows,
			...metadata.editor.borderPairs.flatMap(({ top, bottom }) => [top, bottom]),
			metadata.editor.cursorRow,
		]);
		if (editorMinimum.length > available)
			return { mode: "normal-flow", reason: "editor-minimum-does-not-fit" };
		editorRows = editorMinimum;
		used = editorRows.length;
		const autocomplete = metadata.autocomplete;
		if (autocomplete) {
			const allAutoRows = Array.from(
				{ length: autocomplete.rows.end - autocomplete.rows.start },
				(_, index) => autocomplete.rows.start + index,
			);
			if (autocomplete.selection.known) {
				const minimum = sorted([
					...autocomplete.structuralRows,
					...autocomplete.closureRows,
					...autocomplete.borderPairs.flatMap(({ top, bottom }) => [top, bottom]),
					autocomplete.selection.selectedRow,
				]);
				if (used + minimum.length <= available) {
					const remaining = available - used - minimum.length;
					const itemRows = autocomplete.selection.itemToOutputRows.map(
						({ outputRow }) => outputRow,
					);
					const selectedOffset = Math.max(0, itemRows.indexOf(autocomplete.selection.selectedRow));
					const extras = cropAround(
						itemRows,
						selectedOffset,
						Math.min(itemRows.length, remaining + 1),
					);
					autocompleteRows = sorted([...minimum, ...extras]);
					used += autocompleteRows.length;
				}
			} else if (used + allAutoRows.length <= available) {
				autocompleteRows = allAutoRows;
				used += autocompleteRows.length;
			}
		}
	}

	const allocate = (rows: readonly string[] | undefined): number => {
		const count = Math.min(rows?.length ?? 0, Math.max(0, available - used));
		used += count;
		return count;
	};
	const footerBudget = allocate(input.footerRows);
	const belowBudget = allocate(input.belowRows);
	const aboveBudget = allocate(input.aboveRows);
	const statusBudget = allocate(input.statusRows);

	if (input.metadata && used < available) {
		const selected = new Set(editorRows);
		const cursorRow = input.metadata.editor.cursorRow;
		const candidates = expand(input.metadata.editor.rows)
			.filter((row) => !selected.has(row))
			.sort((a, b) => Math.abs(a - cursorRow) - Math.abs(b - cursorRow) || a - b);
		for (const row of candidates.slice(0, available - used)) selected.add(row);
		editorRows = sorted(selected);
	}

	return {
		mode: "fixed",
		transcriptRows: Math.max(
			1,
			rawRows -
				(editorRows.length +
					autocompleteRows.length +
					statusBudget +
					aboveBudget +
					belowBudget +
					footerBudget),
		),
		selectedEditorRows: editorRows,
		selectedAutocompleteRows: autocompleteRows,
		statusBudget,
		aboveBudget,
		belowBudget,
		footerBudget,
	};
}
