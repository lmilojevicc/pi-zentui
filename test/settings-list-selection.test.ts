import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { selectOwnedSetting } from "../extensions/zentui/settings-list-selection";

const theme = {
	label: (text: string) => text,
	value: (text: string) => text,
	description: (text: string) => text,
	cursor: "> ",
	hint: (text: string) => text,
};
function fixture(enableSearch = false) {
	const items: SettingItem[] = Array.from({ length: 12 }, (_, i) => ({
		id: `row-${i}`,
		label: `Row ${i}`,
		description: `Help ${i}`,
		currentValue: "off",
		values: ["off", "on"],
	}));
	const onChange = vi.fn();
	const list = new SettingsList(items, 3, theme, onChange, () => {}, { enableSearch });
	return { items, list, onChange };
}
function withoutSelectionApi(list: SettingsList) {
	// Incomplete injected lists must fail open without private state writes.
	Object.defineProperty(list, "selectItem", { value: undefined });
}

describe("owned SettingsList selection compatibility", () => {
	it("keeps native scrolling, help, values and input receivers on the supported public API", () => {
		const { list, items, onChange } = fixture();
		expect(selectOwnedSetting(list, items, "row-10")).toBe(true);
		let output = list.render(80).join("\n");
		expect(output).toContain("> Row 10");
		expect(output).toContain("Help 10");
		expect(output).toContain("(11/12)");
		expect(output).not.toContain("Row 0 ");
		list.handleInput("\r");
		expect(onChange).toHaveBeenCalledExactlyOnceWith("row-10", "on");
		expect(selectOwnedSetting(list, items, "row-0")).toBe(true);
		output = list.render(80).join("\n");
		expect(output).toContain("> Row 0");
		expect(output).toContain("Help 0");
		expect(output).not.toContain("Row 10");
		expect(items[10].currentValue).toBe("on");
	});

	it("rejects an unknown id without changing selection", () => {
		const { list, items } = fixture();
		const select = vi.spyOn(list, "selectItem");
		expect(selectOwnedSetting(list, items, "missing")).toBe(false);
		expect(select).not.toHaveBeenCalled();
	});

	it("calls the public selection method with its original receiver", () => {
		const { list, items } = fixture();
		const selectItem = vi.fn(function (this: SettingsList, id: string) {
			expect(this).toBe(list);
			expect(id).toBe("row-10");
		});
		Object.defineProperty(list, "selectItem", { value: selectItem });
		expect(selectOwnedSetting(list, items, "row-10")).toBe(true);
		expect(selectItem).toHaveBeenCalledOnce();
	});

	it.each(["missing API", "foreign items", "search", "submenu", "readonly", "unknown selection"])(
		"leaves %s state untouched rather than forwarding keys through a global manager",
		(shape) => {
			const { list, items } = fixture(shape === "search");
			withoutSelectionApi(list);
			if (shape === "search") list.handleInput("Row 1");
			if (shape === "submenu") {
				items[0].submenu = () => ({ render: () => ["SUBMENU"], invalidate() {} });
				list.handleInput("\r");
			}
			if (shape === "readonly") Object.defineProperty(list, "selectedIndex", { writable: false });
			if (shape === "unknown selection")
				Object.defineProperty(list, "selectedIndex", { value: undefined });
			const descriptors = Object.getOwnPropertyDescriptors(list);
			const rendered = list.render(80);
			expect(
				selectOwnedSetting(list, shape === "foreign items" ? [...items] : items, "row-10"),
			).toBe(false);
			expect(Object.getOwnPropertyDescriptors(list)).toEqual(descriptors);
			expect(list.render(80)).toEqual(rendered);
		},
	);
});
