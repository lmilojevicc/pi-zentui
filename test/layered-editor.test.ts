import { describe, expect, it, vi } from "vitest";
import { LayeredEditorConsumer } from "../extensions/zentui/layered-editor.js";

describe("LayeredEditorConsumer", () => {
	it("is visible only while the outer factory and generation are current", () => {
		let generation = 1;
		const consumer = new LayeredEditorConsumer<object>((value) => value === generation);
		const outer = {};
		const render = vi.fn();
		consumer.attach(outer, 1, render);

		expect(consumer.isVisibleThrough(outer)).toBe(true);
		consumer.requestRender(outer);
		expect(render).toHaveBeenCalledTimes(1);

		expect(consumer.isVisibleThrough({})).toBe(false);
		expect(consumer.isVisibleThrough(outer)).toBe(false);

		consumer.attach(outer, 1, render);
		generation = 2;
		expect(consumer.isVisibleThrough(outer)).toBe(false);
		consumer.requestRender(outer);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it("detach clears the record", () => {
		const consumer = new LayeredEditorConsumer<object>(() => true);
		const outer = {};
		consumer.attach(outer, 1, () => {});
		consumer.detach();
		expect(consumer.isVisibleThrough(outer)).toBe(false);
	});
});
