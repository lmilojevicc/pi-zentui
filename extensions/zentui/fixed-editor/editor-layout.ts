/** Private semantic row metadata for Zentui-owned editor frames. @internal */

export const FIXED_EDITOR_LAYOUT = Symbol("pi-zentui.fixed-editor-layout");

export type AbsoluteOutputRange = { start: number; end: number };
export type BorderPair = { top: number; bottom: number };
export type ItemToOutputRow = { itemIndex: number; outputRow: number };

export type FixedEditorLayoutMetadata = {
	width: number;
	renderedRowCount: number;
	editor: {
		rows: readonly AbsoluteOutputRange[];
		frame: readonly AbsoluteOutputRange[];
		content: readonly AbsoluteOutputRange[];
		structuralRows: readonly number[];
		cursorRow: number;
		borderPairs: readonly BorderPair[];
	};
	autocomplete?: {
		rows: AbsoluteOutputRange;
		structuralRows: readonly number[];
		closureRows: readonly number[];
		borderPairs: readonly BorderPair[];
		selection:
			| {
					known: true;
					selectedIndex: number;
					visibleWindow: { start: number; end: number };
					itemToOutputRows: readonly ItemToOutputRow[];
					selectedRow: number;
			  }
			| { known: false };
	};
};

export type FixedEditorLayoutProvider = {
	[FIXED_EDITOR_LAYOUT](
		renderedRows: readonly string[],
		width: number,
	): FixedEditorLayoutMetadata | undefined;
};

function integer(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function range(value: AbsoluteOutputRange, count: number): boolean {
	return (
		integer(value.start) &&
		integer(value.end) &&
		value.start >= 0 &&
		value.start < value.end &&
		value.end <= count
	);
}

function orderedRanges(values: readonly AbsoluteOutputRange[], count: number): boolean {
	return (
		values.length > 0 &&
		values.every((value, index) => {
			const previous = values[index - 1];
			return (
				range(value, count) &&
				(index === 0 || (previous !== undefined && previous.end <= value.start))
			);
		})
	);
}

function expand(values: readonly AbsoluteOutputRange[]): number[] {
	return values.flatMap(({ start, end }) =>
		Array.from({ length: end - start }, (_, index) => start + index),
	);
}

function uniqueRows(values: readonly number[], count: number): boolean {
	return (
		values.every((value) => integer(value) && value >= 0 && value < count) &&
		new Set(values).size === values.length
	);
}

function pairsValid(values: readonly BorderPair[], allowed: Set<number>): boolean {
	let previousBottom = -1;
	for (const { top, bottom } of values) {
		if (
			!integer(top) ||
			!integer(bottom) ||
			top >= bottom ||
			top <= previousBottom ||
			!allowed.has(top) ||
			!allowed.has(bottom)
		)
			return false;
		previousBottom = bottom;
	}
	return true;
}

function subset(values: readonly number[], allowed: Set<number>): boolean {
	return values.every((value) => allowed.has(value));
}

function clone(metadata: FixedEditorLayoutMetadata): FixedEditorLayoutMetadata {
	return structuredClone(metadata);
}

export function validateFixedEditorLayout(
	metadata: FixedEditorLayoutMetadata | undefined,
	renderedRows: readonly string[],
	width: number,
): FixedEditorLayoutMetadata | undefined {
	if (
		!metadata ||
		!integer(width) ||
		metadata.width !== width ||
		metadata.renderedRowCount !== renderedRows.length
	)
		return undefined;
	const count = renderedRows.length;
	const editor = metadata.editor;
	if (
		!orderedRanges(editor.rows, count) ||
		!orderedRanges(editor.frame, count) ||
		!orderedRanges(editor.content, count)
	)
		return undefined;
	const editorRows = expand(editor.rows);
	const editorSet = new Set(editorRows);
	if (
		!uniqueRows(editorRows, count) ||
		!uniqueRows(editor.structuralRows, count) ||
		!subset(editor.structuralRows, editorSet) ||
		!editorSet.has(editor.cursorRow)
	)
		return undefined;
	if (
		!expand(editor.frame).every((row) => editorSet.has(row)) ||
		!expand(editor.content).every((row) => editorSet.has(row)) ||
		!pairsValid(editor.borderPairs, editorSet)
	)
		return undefined;

	const autocomplete = metadata.autocomplete;
	const autocompleteRows = autocomplete ? expand([autocomplete.rows]) : [];
	const autoSet = new Set(autocompleteRows);
	const partition = [...editorRows, ...autocompleteRows].sort((a, b) => a - b);
	if (partition.length !== count || partition.some((row, index) => row !== index)) return undefined;
	if (autocomplete) {
		if (
			!range(autocomplete.rows, count) ||
			!uniqueRows(autocomplete.structuralRows, count) ||
			!uniqueRows(autocomplete.closureRows, count)
		)
			return undefined;
		if (
			!subset(autocomplete.structuralRows, autoSet) ||
			!subset(autocomplete.closureRows, autoSet) ||
			!pairsValid(autocomplete.borderPairs, autoSet)
		)
			return undefined;
		const forbidden = new Set([
			...autocomplete.structuralRows,
			...autocomplete.closureRows,
			...autocomplete.borderPairs.flatMap(({ top, bottom }) => [top, bottom]),
		]);
		if (autocomplete.selection.known) {
			const selection = autocomplete.selection;
			if (
				!integer(selection.selectedIndex) ||
				!range(selection.visibleWindow, Number.MAX_SAFE_INTEGER) ||
				selection.selectedIndex < selection.visibleWindow.start ||
				selection.selectedIndex >= selection.visibleWindow.end
			)
				return undefined;
			const expected = selection.visibleWindow.end - selection.visibleWindow.start;
			if (selection.itemToOutputRows.length !== expected) return undefined;
			const items = new Set<number>();
			const rows = new Set<number>();
			for (const mapping of selection.itemToOutputRows) {
				if (
					!integer(mapping.itemIndex) ||
					mapping.itemIndex < selection.visibleWindow.start ||
					mapping.itemIndex >= selection.visibleWindow.end ||
					!autoSet.has(mapping.outputRow) ||
					forbidden.has(mapping.outputRow) ||
					items.has(mapping.itemIndex) ||
					rows.has(mapping.outputRow)
				)
					return undefined;
				items.add(mapping.itemIndex);
				rows.add(mapping.outputRow);
			}
			const selected = selection.itemToOutputRows.find(
				({ itemIndex }) => itemIndex === selection.selectedIndex,
			);
			if (
				!selected ||
				selection.selectedRow !== selected.outputRow ||
				forbidden.has(selection.selectedRow)
			)
				return undefined;
		}
	}
	return clone(metadata);
}

export function readFixedEditorLayout(
	value: unknown,
	renderedRows: readonly string[],
	width: number,
): FixedEditorLayoutMetadata | undefined {
	if ((typeof value !== "object" && typeof value !== "function") || value === null)
		return undefined;
	try {
		const provider = Reflect.get(value, FIXED_EDITOR_LAYOUT);
		if (typeof provider !== "function") return undefined;
		return validateFixedEditorLayout(
			Reflect.apply(provider, value, [renderedRows, width]),
			renderedRows,
			width,
		);
	} catch {
		return undefined;
	}
}
