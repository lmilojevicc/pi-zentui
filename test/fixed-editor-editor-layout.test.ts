import { describe, expect, it } from "vitest";
import {
	FIXED_EDITOR_LAYOUT,
	type FixedEditorLayoutMetadata,
	readFixedEditorLayout,
	validateFixedEditorLayout,
} from "../extensions/zentui/fixed-editor/editor-layout";

function valid(): FixedEditorLayoutMetadata {
	return {
		width: 20,
		renderedRowCount: 6,
		editor: {
			rows: [
				{ start: 0, end: 3 },
				{ start: 5, end: 6 },
			],
			frame: [
				{ start: 0, end: 1 },
				{ start: 5, end: 6 },
			],
			content: [{ start: 1, end: 3 }],
			structuralRows: [0, 5],
			cursorRow: 1,
			borderPairs: [{ top: 0, bottom: 5 }],
		},
		autocomplete: {
			rows: { start: 3, end: 5 },
			structuralRows: [],
			closureRows: [],
			borderPairs: [],
			selection: {
				known: true,
				selectedIndex: 1,
				visibleWindow: { start: 0, end: 2 },
				itemToOutputRows: [
					{ itemIndex: 0, outputRow: 3 },
					{ itemIndex: 1, outputRow: 4 },
				],
				selectedRow: 4,
			},
		},
	};
}

const rows = ["top", "cursor", "body", "one", "two", "bottom"];

describe("fixed editor semantic metadata", () => {
	it("accepts an exhaustive embedded partition and returns an immutable copy", () => {
		const metadata = valid();
		const result = validateFixedEditorLayout(metadata, rows, 20);
		expect(result).toEqual(metadata);
		expect(result).not.toBe(metadata);
		metadata.editor.structuralRows = [2, 5];
		expect(result?.editor.structuralRows).toEqual([0, 5]);
	});

	it.each([
		[
			"stale width",
			(m: FixedEditorLayoutMetadata) => {
				m.width = 19;
			},
		],
		[
			"stale count",
			(m: FixedEditorLayoutMetadata) => {
				m.renderedRowCount = 5;
			},
		],
		[
			"partition gap",
			(m: FixedEditorLayoutMetadata) => {
				m.editor.rows = [
					{ start: 0, end: 2 },
					{ start: 5, end: 6 },
				];
			},
		],
		[
			"overlap",
			(m: FixedEditorLayoutMetadata) => {
				m.editor.rows = [
					{ start: 0, end: 4 },
					{ start: 5, end: 6 },
				];
			},
		],
		[
			"duplicate row",
			(m: FixedEditorLayoutMetadata) => {
				m.editor.structuralRows = [0, 0];
			},
		],
		[
			"crossing pair",
			(m: FixedEditorLayoutMetadata) => {
				m.editor.borderPairs = [
					{ top: 0, bottom: 5 },
					{ top: 1, bottom: 2 },
				];
			},
		],
		[
			"missing selected mapping",
			(m: FixedEditorLayoutMetadata) => {
				if (m.autocomplete?.selection.known)
					m.autocomplete.selection.itemToOutputRows = [{ itemIndex: 0, outputRow: 3 }];
			},
		],
		[
			"out of partition",
			(m: FixedEditorLayoutMetadata) => {
				if (m.autocomplete?.selection.known)
					m.autocomplete.selection.itemToOutputRows = [
						{ itemIndex: 0, outputRow: 1 },
						{ itemIndex: 1, outputRow: 4 },
					];
			},
		],
	] as const)("rejects %s", (_name, mutate) => {
		const metadata = valid();
		mutate(metadata);
		expect(validateFixedEditorLayout(metadata, rows, 20)).toBeUndefined();
	});

	it.each(["separator", "closure", "border", "scroll-info"])(
		"rejects item mapping to %s rows",
		(kind) => {
			const metadata = valid();
			const auto = metadata.autocomplete;
			if (!auto) throw new Error("expected autocomplete fixture");
			auto.rows = { start: 2, end: 6 };
			metadata.editor.rows = [{ start: 0, end: 2 }];
			metadata.editor.frame = [{ start: 0, end: 1 }];
			metadata.editor.content = [{ start: 1, end: 2 }];
			metadata.editor.structuralRows = [0];
			metadata.editor.borderPairs = [];
			const forbidden =
				kind === "separator" ? 2 : kind === "closure" ? 3 : kind === "border" ? 4 : 5;
			auto.structuralRows = kind === "separator" || kind === "scroll-info" ? [forbidden] : [];
			auto.closureRows = kind === "closure" ? [forbidden] : [];
			auto.borderPairs = kind === "border" ? [{ top: 4, bottom: 5 }] : [];
			auto.selection = {
				known: true,
				selectedIndex: 0,
				visibleWindow: { start: 0, end: 1 },
				itemToOutputRows: [{ itemIndex: 0, outputRow: forbidden }],
				selectedRow: forbidden,
			};
			expect(validateFixedEditorLayout(metadata, rows, 20)).toBeUndefined();
		},
	);

	it("reads the private provider and fails open", () => {
		const provider = { [FIXED_EDITOR_LAYOUT]: () => valid() };
		expect(readFixedEditorLayout(provider, rows, 20)).toEqual(valid());
		expect(readFixedEditorLayout({}, rows, 20)).toBeUndefined();
		expect(
			readFixedEditorLayout(
				{
					[FIXED_EDITOR_LAYOUT]: () => {
						throw new Error("changed");
					},
				},
				rows,
				20,
			),
		).toBeUndefined();
	});

	it("treats throwing provider access as opaque", () => {
		const proxy = new Proxy(
			{},
			{
				get(_target, key) {
					if (key === FIXED_EDITOR_LAYOUT) throw new Error("provider trap");
					return undefined;
				},
			},
		);
		const getter = Object.defineProperty({}, FIXED_EDITOR_LAYOUT, {
			configurable: true,
			get() {
				throw new Error("provider getter");
			},
		});

		expect(() => readFixedEditorLayout(proxy, rows, 20)).not.toThrow();
		expect(readFixedEditorLayout(proxy, rows, 20)).toBeUndefined();
		expect(() => readFixedEditorLayout(getter, rows, 20)).not.toThrow();
		expect(readFixedEditorLayout(getter, rows, 20)).toBeUndefined();
	});
});
