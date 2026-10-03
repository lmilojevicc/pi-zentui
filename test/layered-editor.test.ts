import { describe, expect, it, vi } from "vitest";
import { LayeredEditorConsumer } from "../extensions/zentui/layered-editor.js";

describe("LayeredEditorConsumer", () => {
	it("exposes the recorded editor only while the outer factory and generation are current", () => {
		let generation = 1;
		const consumer = new LayeredEditorConsumer<object, object>((value) => value === generation);
		const outer = {};
		const editor = {};
		const render = vi.fn();
		consumer.attach(outer, 1, editor, render);

		expect(consumer.isVisibleThrough(outer)).toBe(true);
		expect(consumer.editorVisibleThrough(outer)).toBe(editor);
		consumer.requestRender(outer);
		expect(render).toHaveBeenCalledTimes(1);

		// A replaced outer factory invalidates the record, including its editor identity.
		expect(consumer.editorVisibleThrough({})).toBeUndefined();
		expect(consumer.isVisibleThrough(outer)).toBe(false);

		consumer.attach(outer, 1, editor, render);
		generation = 2;
		expect(consumer.editorVisibleThrough(outer)).toBeUndefined();
		expect(consumer.isVisibleThrough(outer)).toBe(false);
		consumer.requestRender(outer);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it("replaces the recorded editor and render callback on re-attach", () => {
		const consumer = new LayeredEditorConsumer<object, object>(() => true);
		const outer = {};
		const firstRender = vi.fn();
		consumer.attach(outer, 1, { id: "first" }, firstRender);
		const replacement = { id: "replacement" };
		const replacementRender = vi.fn();
		consumer.attach(outer, 1, replacement, replacementRender);

		expect(consumer.editorVisibleThrough(outer)).toBe(replacement);
		consumer.requestRender(outer);
		expect(replacementRender).toHaveBeenCalledTimes(1);
		expect(firstRender).not.toHaveBeenCalled();
	});

	it("detach clears the record", () => {
		const consumer = new LayeredEditorConsumer<object, object>(() => true);
		const outer = {};
		consumer.attach(outer, 1, {}, () => {});
		consumer.detach();
		expect(consumer.isVisibleThrough(outer)).toBe(false);
		expect(consumer.editorVisibleThrough(outer)).toBeUndefined();
	});
});
