import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderCluster } from "../extensions/zentui/fixed-editor/cluster";
import {
	FIXED_EDITOR_LAYOUT,
	type FixedEditorLayoutMetadata,
	validateFixedEditorLayout,
} from "../extensions/zentui/fixed-editor/editor-layout";
import { cropAround, planFixedLayout, takeTail } from "../extensions/zentui/fixed-editor/layout";

const metadata: FixedEditorLayoutMetadata = {
	width: 20,
	renderedRowCount: 7,
	editor: {
		rows: [{ start: 0, end: 5 }],
		frame: [
			{ start: 0, end: 1 },
			{ start: 4, end: 5 },
		],
		content: [{ start: 1, end: 4 }],
		structuralRows: [0, 4],
		cursorRow: 2,
		borderPairs: [{ top: 0, bottom: 4 }],
	},
	autocomplete: {
		rows: { start: 5, end: 7 },
		structuralRows: [],
		closureRows: [],
		borderPairs: [],
		selection: {
			known: true,
			selectedIndex: 1,
			visibleWindow: { start: 0, end: 2 },
			itemToOutputRows: [
				{ itemIndex: 0, outputRow: 5 },
				{ itemIndex: 1, outputRow: 6 },
			],
			selectedRow: 6,
		},
	},
};

describe("fixed layout planner", () => {
	it("treats zero and negative budgets as empty", () => {
		expect(takeTail([1, 2], 0)).toEqual([]);
		expect(takeTail([1, 2], -1)).toEqual([]);
		expect(cropAround([1, 2], 1, 0)).toEqual([]);
	});

	it("crops contiguously around an anchor", () => {
		expect(cropAround([0, 1, 2, 3, 4], 2, 3)).toEqual([1, 2, 3]);
		expect(cropAround([0, 1, 2, 3, 4], 0, 3)).toEqual([0, 1, 2]);
		expect(cropAround([0, 1, 2, 3, 4], 4, 3)).toEqual([2, 3, 4]);
	});

	it("suspends with no terminal rows", () => {
		expect(planFixedLayout({ rawRows: 0, editorRows: [] })).toEqual({
			mode: "no-terminal-rows",
			pendingDesiredMode: "fixed",
		});
	});

	it("falls back when opaque or semantic minimums do not fit", () => {
		expect(planFixedLayout({ rawRows: 2, editorRows: ["a", "b"] })).toMatchObject({
			mode: "normal-flow",
			reason: "opaque-editor-does-not-fit",
		});
		expect(planFixedLayout({ rawRows: 3, editorRows: Array(7).fill("x"), metadata })).toMatchObject(
			{ mode: "normal-flow", reason: "editor-minimum-does-not-fit" },
		);
	});

	it("matches hand-authored allocation and materialization thresholds", () => {
		const editorRows = [
			"top",
			"body-1",
			`cursor${CURSOR_MARKER}`,
			"body-3",
			"bottom",
			"one",
			"two",
		];
		const expectations = [
			{ budget: 0, mode: "normal-flow" },
			{ budget: 1, mode: "normal-flow" },
			{ budget: 2, mode: "normal-flow" },
			{
				budget: 3,
				editor: [0, 2, 4],
				auto: [],
				extras: [0, 0, 0, 0],
				lines: ["top", "cursor", "bottom"],
			},
			{
				budget: 4,
				editor: [0, 2, 4],
				auto: [6],
				extras: [0, 0, 0, 0],
				lines: ["top", "cursor", "bottom", "two"],
			},
			{
				budget: 5,
				editor: [0, 2, 4],
				auto: [5, 6],
				extras: [0, 0, 0, 0],
				lines: ["top", "cursor", "bottom", "one", "two"],
			},
			{
				budget: 6,
				editor: [0, 2, 4],
				auto: [5, 6],
				extras: [1, 0, 0, 0],
				lines: ["top", "cursor", "bottom", "one", "two", "footer"],
			},
			{
				budget: 7,
				editor: [0, 2, 4],
				auto: [5, 6],
				extras: [1, 1, 0, 0],
				lines: ["top", "cursor", "bottom", "one", "two", "below", "footer"],
			},
			{
				budget: 8,
				editor: [0, 2, 4],
				auto: [5, 6],
				extras: [1, 1, 1, 0],
				lines: ["above", "top", "cursor", "bottom", "one", "two", "below", "footer"],
			},
			{
				budget: 9,
				editor: [0, 2, 4],
				auto: [5, 6],
				extras: [1, 1, 1, 1],
				lines: ["status", "above", "top", "cursor", "bottom", "one", "two", "below", "footer"],
			},
			{
				budget: 10,
				editor: [0, 1, 2, 4],
				auto: [5, 6],
				extras: [1, 1, 1, 1],
				lines: [
					"status",
					"above",
					"top",
					"body-1",
					"cursor",
					"bottom",
					"one",
					"two",
					"below",
					"footer",
				],
			},
			{
				budget: 11,
				editor: [0, 1, 2, 3, 4],
				auto: [5, 6],
				extras: [1, 1, 1, 1],
				lines: [
					"status",
					"above",
					"top",
					"body-1",
					"cursor",
					"body-3",
					"bottom",
					"one",
					"two",
					"below",
					"footer",
				],
			},
		] as const;
		const capability = (lines: string[]) => {
			const target = { render: () => lines };
			return {
				target,
				render: target.render,
				ownDescriptor: Object.getOwnPropertyDescriptor(target, "render"),
			};
		};
		const editorChild = { [FIXED_EDITOR_LAYOUT]: () => metadata };
		const cluster = {
			status: capability(["status"]),
			aboveWidget: capability(["above"]),
			editor: capability(editorRows),
			editorChild,
			belowWidget: capability(["below"]),
			footer: capability(["footer"]),
		};

		for (const expected of expectations) {
			const plan = planFixedLayout({
				rawRows: expected.budget + 1,
				editorRows,
				metadata,
				statusRows: ["status"],
				aboveRows: ["above"],
				belowRows: ["below"],
				footerRows: ["footer"],
			});
			const rendered = renderCluster(cluster, 20, expected.budget + 1);
			if ("mode" in expected) {
				expect(plan.mode, `budget ${expected.budget}`).toBe("normal-flow");
				expect(rendered).toMatchObject({ mode: "normal-flow", lines: [] });
				continue;
			}
			expect(plan).toMatchObject({
				mode: "fixed",
				selectedEditorRows: expected.editor,
				selectedAutocompleteRows: expected.auto,
				footerBudget: expected.extras[0],
				belowBudget: expected.extras[1],
				aboveBudget: expected.extras[2],
				statusBudget: expected.extras[3],
			});
			expect(rendered.lines, `budget ${expected.budget}`).toEqual(expected.lines);
		}
	});

	it("always includes validated border-pair endpoints in the editor minimum", () => {
		const adversarial: FixedEditorLayoutMetadata = {
			...metadata,
			autocomplete: undefined,
			renderedRowCount: 5,
			editor: { ...metadata.editor, structuralRows: [], borderPairs: [{ top: 0, bottom: 4 }] },
		};
		const rows = Array<string>(5).fill("row");
		expect(validateFixedEditorLayout(adversarial, rows, 20)).toEqual(adversarial);
		const plan = planFixedLayout({ rawRows: 4, editorRows: rows, metadata: adversarial });
		expect(plan).toMatchObject({ mode: "fixed", selectedEditorRows: [0, 2, 4] });
	});

	it("keeps opaque editors intact when they fit", () => {
		const plan = planFixedLayout({
			rawRows: 4,
			editorRows: ["a", "b", "c"],
			footerRows: ["footer"],
		});
		expect(plan).toMatchObject({ mode: "fixed", selectedEditorRows: [0, 1, 2], footerBudget: 0 });
	});
});
