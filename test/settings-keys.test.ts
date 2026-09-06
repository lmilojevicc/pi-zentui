import { describe, expect, it } from "vitest";
import { settingsKeys } from "../extensions/zentui/settings-keys";

describe("settings injected keybinding hints", () => {
	it("uses older-host defaults only when facilities are unavailable", () => {
		const keys = settingsKeys({});
		expect(keys.matches("\r", "confirm")).toBe(true);
		expect(keys.matches("\x1b", "cancel")).toBe(true);
		for (const width of [20, 32, 40]) {
			const help = keys.help(width).join("\n");
			expect(help).toContain("enter Change");
			expect(help).toContain("Tab Sections");
			expect(help).toContain("escape Close");
		}
	});
	it("supports legacy manager action IDs", () => {
		const keys = settingsKeys({ getKeys: (id) => (String(id) === "selectConfirm" ? ["x"] : []) });
		expect(keys.matches("x", "confirm")).toBe(true);
		expect(keys.matches("\r", "confirm")).toBe(false);
	});
	it("does not resurrect a deliberately unbound namespaced action", () => {
		const keys = settingsKeys({ getKeys: () => [], getDefinition: () => ({ defaultKeys: [] }) });
		expect(keys.matches("\r", "confirm")).toBe(false);
		expect(keys.matches("\x1b", "cancel")).toBe(false);
		expect(keys.help(40).join("\n")).toContain("Space Change");
		expect(keys.help(40).join("\n")).toContain("unbound Close");
	});
});
