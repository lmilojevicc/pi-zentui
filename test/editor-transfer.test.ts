import { describe, expect, it, vi } from "vitest";
import { replaceEditorComponentWithExpandedText } from "../extensions/zentui/editor-transfer";

type Editor = {
	getText(): string;
	setText(text: string): void;
	getExpandedText?: () => string;
};

type Factory = () => Editor;

function piLikeUi(initialEditor: Editor, operations: string[], initialFactory?: Factory) {
	let active = initialEditor;
	let configuredFactory = initialFactory;
	return {
		get active() {
			return active;
		},
		get configuredFactory() {
			return configuredFactory;
		},
		getEditorComponent() {
			operations.push("getEditorComponent");
			return configuredFactory;
		},
		getEditorText() {
			operations.push("getEditorText");
			return active.getExpandedText?.() ?? active.getText();
		},
		setEditorText(text: string) {
			operations.push(`setEditorText:${text}`);
			active.setText(text);
		},
		setEditorComponent(factory: Factory | undefined) {
			operations.push("setEditorComponent");
			configuredFactory = factory;
			const currentText = active.getText();
			if (!factory) return;
			const next = factory();
			next.setText(currentText);
			active = next;
		},
	};
}

function textEditor(initial = ""): Editor {
	let text = initial;
	return {
		getText: () => text,
		setText(next) {
			text = next;
		},
	};
}

describe("safe editor component transfer", () => {
	it("expands a collapsed paste before Pi snapshots the replaced editor", () => {
		const marker = "[paste #1 +12 lines]";
		const expanded = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
		let oldText = marker;
		const operations: string[] = [];
		const oldEditor: Editor = {
			getText: () => oldText,
			getExpandedText: () => (oldText === marker ? expanded : oldText),
			setText(text) {
				oldText = text;
			},
		};
		const ui = piLikeUi(oldEditor, operations);
		const next = textEditor();

		const result = replaceEditorComponentWithExpandedText(ui, () => next);

		expect(result).toEqual({ ok: true });
		expect(operations).toEqual([
			"getEditorComponent",
			"getEditorText",
			`setEditorText:${expanded}`,
			"setEditorComponent",
		]);
		expect(ui.active).toBe(next);
		expect(next.getText()).toBe(expanded);
		expect(next.getText()).not.toContain(marker);
	});

	it.each(["ordinary prompt", ""])("transfers normal prompt text: %j", (text) => {
		const operations: string[] = [];
		const ui = piLikeUi(textEditor(text), operations);
		const next = textEditor();

		expect(replaceEditorComponentWithExpandedText(ui, () => next)).toEqual({ ok: true });
		expect(next.getText()).toBe(text);
	});

	it("uses the public getText fallback for a third-party editor without getExpandedText", () => {
		const operations: string[] = [];
		const ui = piLikeUi(textEditor("third-party draft"), operations);
		const next = textEditor();

		expect(replaceEditorComponentWithExpandedText(ui, () => next)).toEqual({ ok: true });
		expect(next.getText()).toBe("third-party draft");
	});

	it("does not replace when the public transfer API is unavailable", () => {
		const setEditorComponent = vi.fn();
		expect(replaceEditorComponentWithExpandedText({ setEditorComponent }, undefined)).toEqual({
			ok: false,
			reason: "unsupported-transfer-api",
		});
		expect(setEditorComponent).not.toHaveBeenCalled();
	});

	it("does not replace when the previous factory cannot be snapshotted", () => {
		const getEditorText = vi.fn();
		const setEditorComponent = vi.fn();
		const result = replaceEditorComponentWithExpandedText(
			{
				getEditorComponent() {
					throw new Error("factory snapshot failed");
				},
				getEditorText,
				setEditorText() {},
				setEditorComponent,
			},
			undefined,
		);

		expect(result).toEqual({ ok: false, reason: "editor-factory-snapshot-failed" });
		expect(getEditorText).not.toHaveBeenCalled();
		expect(setEditorComponent).not.toHaveBeenCalled();
	});

	it("does not replace when expanded text snapshotting fails", () => {
		const setEditorText = vi.fn();
		const setEditorComponent = vi.fn();
		const result = replaceEditorComponentWithExpandedText(
			{
				getEditorComponent: () => undefined,
				getEditorText() {
					throw new Error("snapshot failed");
				},
				setEditorText,
				setEditorComponent,
			},
			undefined,
		);

		expect(result).toEqual({ ok: false, reason: "editor-text-snapshot-failed" });
		expect(setEditorText).not.toHaveBeenCalled();
		expect(setEditorComponent).not.toHaveBeenCalled();
	});

	it("rejects a non-string snapshot without replacing", () => {
		const setEditorComponent = vi.fn();
		const result = replaceEditorComponentWithExpandedText(
			{
				getEditorComponent: () => undefined,
				getEditorText: () => undefined,
				setEditorText() {},
				setEditorComponent,
			},
			undefined,
		);
		expect(result).toEqual({ ok: false, reason: "editor-text-snapshot-failed" });
		expect(setEditorComponent).not.toHaveBeenCalled();
	});

	it("does not replace when writing expanded text back fails", () => {
		const setEditorComponent = vi.fn();
		const result = replaceEditorComponentWithExpandedText(
			{
				getEditorComponent: () => undefined,
				getEditorText: () => "expanded",
				setEditorText() {
					throw new Error("write failed");
				},
				setEditorComponent,
			},
			undefined,
		);

		expect(result).toEqual({ ok: false, reason: "editor-text-preparation-failed" });
		expect(setEditorComponent).not.toHaveBeenCalled();
	});

	it("restores the previous factory after an assignment-first replacement failure", () => {
		const operations: string[] = [];
		const previousEditor = textEditor("marker");
		const previousFactory = () => previousEditor;
		const ui = piLikeUi(previousEditor, operations, previousFactory);
		const failingFactory = () => {
			throw new Error("replacement failed after assignment");
		};

		const result = replaceEditorComponentWithExpandedText(ui, failingFactory);

		expect(result).toEqual({
			ok: false,
			reason: "editor-replacement-failed-with-rollback",
		});
		expect(ui.configuredFactory).toBe(previousFactory);
		expect(ui.active.getText()).toBe("marker");
		expect(operations).toEqual([
			"getEditorComponent",
			"getEditorText",
			"setEditorText:marker",
			"setEditorComponent",
			"setEditorComponent",
		]);
	});

	it("reports when assignment-first replacement rollback also throws", () => {
		const previousFactory = () => textEditor("previous");
		let configuredFactory: Factory | undefined = previousFactory;
		let setterCalls = 0;
		const result = replaceEditorComponentWithExpandedText(
			{
				getEditorComponent: () => configuredFactory,
				getEditorText: () => "expanded payload",
				setEditorText() {},
				setEditorComponent(factory) {
					configuredFactory = factory;
					setterCalls += 1;
					throw new Error(setterCalls === 1 ? "replacement failed" : "rollback failed");
				},
			},
			() => textEditor("next"),
		);

		expect(result).toEqual({
			ok: false,
			reason: "editor-replacement-rollback-failed",
		});
		expect(setterCalls).toBe(2);
	});

	it("submits the exact original multiline paste payload after replacement", () => {
		const marker = "[paste #7 +4 lines]";
		const payload = "alpha\nbeta\ngamma\ndelta";
		let oldText = marker;
		const submitted: string[] = [];
		const oldEditor: Editor = {
			getText: () => oldText,
			getExpandedText: () => (oldText === marker ? payload : oldText),
			setText(text) {
				oldText = text;
			},
		};
		const operations: string[] = [];
		const ui = piLikeUi(oldEditor, operations);
		const next = textEditor();

		expect(replaceEditorComponentWithExpandedText(ui, () => next)).toEqual({ ok: true });
		const onSubmit = (text: string) => submitted.push(text);
		onSubmit(next.getText());

		expect(submitted).toEqual([payload]);
		expect(submitted[0]).not.toContain("[paste #");
	});
});
