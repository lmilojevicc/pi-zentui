import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getExtensionStatusPlacement,
	getHiddenExtensionStatusPlacement,
	mergeConfig,
	saveExtensionStatusDefaultVisibility,
	saveHiddenExtensionStatusDefaultPlacement,
	saveHiddenExtensionStatusPlacement,
} from "../extensions/zentui/config";

describe("Hidden extension status placement config", () => {
	it("defaults Left independently of historical or canonical Starship off/positions", () => {
		for (const raw of [
			{},
			{ extensionStatuses: { defaultPlacement: "off", placements: { x: "right" } } },
			{
				components: {
					footer: {
						styles: {
							starship: {
								extensionStatuses: { defaultPlacement: "off", placements: { x: "middle" } },
							},
						},
					},
				},
			},
		]) {
			const config = mergeConfig(raw);
			expect(config.components.extensionStatuses).not.toHaveProperty("hidden");
			expect(getHiddenExtensionStatusPlacement(config.components.extensionStatuses, "x")).toBe(
				"left",
			);
		}
	});

	it("normalizes only valid Hidden positions and never treats off as visibility", () => {
		const config = mergeConfig({
			components: {
				extensionStatuses: {
					hidden: {
						defaultPlacement: "off",
						placements: { a: "right", b: "middle", c: "off", d: false },
					},
				},
			},
		});
		expect(config.components.extensionStatuses).toEqual({
			defaultVisibility: "show",
			visibility: {},
			hidden: { placements: { a: "right", b: "middle" } },
		});
		expect(getHiddenExtensionStatusPlacement(config.components.extensionStatuses, "c")).toBe(
			"left",
		);
		expect(getExtensionStatusPlacement(config, "a")).toBe("right");
	});

	it("saves only sparse Hidden leaves and resets only the selected override, preserving unknowns and Footer", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-hidden-placement-"));
		const path = join(dir, "zentui.json");
		const before = {
			unknown: { untouched: true },
			extensionStatuses: { defaultPlacement: "off" },
			components: {
				footer: {
					style: "hidden",
					styles: {
						starship: {
							extensionStatuses: { placements: { x: "off" }, colorModes: { x: "original" } },
						},
					},
				},
				editor: { enabled: false },
				extensionStatuses: {
					visibility: { x: "hide" },
					future: 7,
					hidden: { future: "retained", placements: { keep: "left", unknown: "future" } },
				},
			},
		};
		writeFileSync(path, JSON.stringify(before));
		try {
			const read = () => JSON.parse(readFileSync(path, "utf8"));
			saveHiddenExtensionStatusDefaultPlacement("right", path);
			expect(read()).toEqual({
				...before,
				components: {
					...before.components,
					extensionStatuses: {
						...before.components.extensionStatuses,
						hidden: { ...before.components.extensionStatuses.hidden, defaultPlacement: "right" },
					},
				},
			});
			for (const key of ["x", "__proto__", "constructor"])
				saveHiddenExtensionStatusPlacement(key, "middle", path);
			let config = mergeConfig(read());
			for (const key of ["x", "__proto__", "constructor"])
				expect(getHiddenExtensionStatusPlacement(config.components.extensionStatuses, key)).toBe(
					"middle",
				);
			for (const key of ["x", "__proto__", "constructor"])
				saveHiddenExtensionStatusPlacement(key, undefined, path);
			config = mergeConfig(read());
			expect(getHiddenExtensionStatusPlacement(config.components.extensionStatuses, "x")).toBe(
				"right",
			);
			expect(read().components.extensionStatuses.hidden.placements).toEqual(
				before.components.extensionStatuses.hidden.placements,
			);
			expect(read().components.footer).toEqual(before.components.footer);
			expect(read().components.editor).toEqual(before.components.editor);
			expect(read().components.extensionStatuses.visibility).toEqual({ x: "hide" });
			expect(read().components.extensionStatuses).not.toHaveProperty("defaultVisibility");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not materialize Hidden preferences on visibility save or absent reset", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-hidden-placement-"));
		const path = join(dir, "zentui.json");
		writeFileSync(path, "{}");
		try {
			saveHiddenExtensionStatusPlacement("absent", undefined, path);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({});
			saveExtensionStatusDefaultVisibility("hide", path);
			expect(
				JSON.parse(readFileSync(path, "utf8")).components.extensionStatuses,
			).not.toHaveProperty("hidden");
			saveHiddenExtensionStatusPlacement("x", "middle", path);
			expect(JSON.parse(readFileSync(path, "utf8")).components.extensionStatuses.hidden).toEqual({
				placements: { x: "middle" },
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
