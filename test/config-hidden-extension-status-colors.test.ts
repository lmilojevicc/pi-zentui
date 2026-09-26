import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getExtensionStatusColorMode,
	getHiddenExtensionStatusColorMode,
	mergeConfig,
	saveExtensionStatusDefaultVisibility,
	saveHiddenExtensionStatusColorMode,
} from "../extensions/zentui/config";

describe("Hidden extension status colors", () => {
	it("defaults to Original independently of legacy and Starship color choices", () => {
		for (const raw of [
			{},
			{ extensionStatuses: { colorModes: { x: "zentui" } } },
			{
				components: {
					footer: { styles: { starship: { extensionStatuses: { colorModes: { x: "zentui" } } } } },
				},
			},
		]) {
			const config = mergeConfig(raw);
			expect(config.components.extensionStatuses).not.toHaveProperty("hidden");
			expect(getHiddenExtensionStatusColorMode(config.components.extensionStatuses, "x")).toBe(
				"original",
			);
		}
	});

	it("normalizes only supported choices and keeps Hidden and Starship independent", () => {
		const config = mergeConfig({
			components: {
				extensionStatuses: {
					hidden: { colorModes: { a: "zentui", b: "original", c: "future", d: false } },
				},
				footer: { styles: { starship: { extensionStatuses: { colorModes: { a: "original" } } } } },
			},
		});
		expect(config.components.extensionStatuses.hidden).toEqual({
			colorModes: { a: "zentui", b: "original" },
		});
		expect(getHiddenExtensionStatusColorMode(config.components.extensionStatuses, "a")).toBe(
			"zentui",
		);
		expect(getHiddenExtensionStatusColorMode(config.components.extensionStatuses, "c")).toBe(
			"original",
		);
		expect(getExtensionStatusColorMode(config, "a")).toBe("original");
	});

	it("saves only the chosen Hidden color and resets it sparsely without touching other owners", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-hidden-colors-"));
		const path = join(dir, "zentui.json");
		const before = {
			future: { untouched: true },
			extensionStatuses: { colorModes: { x: "original" } },
			components: {
				footer: {
					style: "hidden",
					styles: { starship: { extensionStatuses: { colorModes: { x: "zentui" } } } },
				},
				editor: { enabled: false },
				extensionStatuses: {
					visibility: { x: "hide" },
					future: 7,
					hidden: {
						defaultPlacement: "right",
						placements: { x: "middle" },
						colorModes: { keep: "original", future: "unknown" },
						future: true,
					},
				},
			},
		};
		writeFileSync(path, JSON.stringify(before));
		try {
			const read = () => JSON.parse(readFileSync(path, "utf8"));
			for (const key of ["x", "demo:build", "__proto__", "constructor"]) {
				saveHiddenExtensionStatusColorMode(key, "zentui", path);
				expect(
					getHiddenExtensionStatusColorMode(mergeConfig(read()).components.extensionStatuses, key),
				).toBe("zentui");
			}
			expect(read().components.footer).toEqual(before.components.footer);
			expect(read().components.extensionStatuses.hidden.placements).toEqual({ x: "middle" });
			expect(read().components.extensionStatuses.visibility).toEqual({ x: "hide" });
			for (const key of ["x", "demo:build", "__proto__", "constructor"]) {
				saveHiddenExtensionStatusColorMode(key, "original", path);
			}
			expect(read()).toEqual(before);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not materialize color preferences for Original or ordinary visibility saves", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-hidden-colors-"));
		const path = join(dir, "zentui.json");
		writeFileSync(path, "{}");
		try {
			saveHiddenExtensionStatusColorMode("missing", "original", path);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({});
			saveExtensionStatusDefaultVisibility("hide", path);
			expect(
				JSON.parse(readFileSync(path, "utf8")).components.extensionStatuses,
			).not.toHaveProperty("hidden");
			saveHiddenExtensionStatusColorMode("x", "zentui", path);
			saveExtensionStatusDefaultVisibility("show", path);
			expect(JSON.parse(readFileSync(path, "utf8")).components.extensionStatuses.hidden).toEqual({
				colorModes: { x: "zentui" },
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
