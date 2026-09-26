import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (original) => {
	const actual = await original<typeof import("node:fs")>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import {
	mergeConfig,
	saveExtensionStatusChoice,
	saveExtensionStatusColorMode,
	saveExtensionStatusDefaultChoice,
} from "../extensions/zentui/config";

const dirs: string[] = [];
function fixture(record: object): string {
	const dir = mkdtempSync(join(tmpdir(), "zentui-status-choice-"));
	dirs.push(dir);
	const path = join(dir, "zentui.json");
	writeFileSync(path, JSON.stringify(record));
	return path;
}
const raw = (path: string) => JSON.parse(readFileSync(path, "utf8"));
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.clearAllMocks();
});

describe("atomic extension status choices", () => {
	it.each(["native", "hidden", "starship"] as const)(
		"saves Off/positive/Default atomically under %s without touching colors or other owners",
		(style) => {
			const original = {
				components: {
					editor: { enabled: false, unknown: "keep" },
					extensionStatuses: {
						hidden: {
							colorModes: { "demo:build": "zentui" },
							placements: { "demo:build": "right" },
						},
						visibility: { "demo:build": "hide" },
					},
					footer: {
						style,
						enabled: false,
						unknown: "keep",
						styles: {
							starship: {
								extensionStatuses: {
									placements: { "demo:build": "off" },
									colorModes: { "demo:build": "original" },
								},
							},
						},
					},
				},
			};
			const path = fixture(original);
			saveExtensionStatusDefaultChoice("off", style, path);
			expect(raw(path).components.extensionStatuses.defaultVisibility).toBe("hide");
			saveExtensionStatusChoice("demo:build", "left", style, path);
			let saved = raw(path);
			expect(saved.components.extensionStatuses.visibility["demo:build"]).toBe("show");
			expect(saved.components.editor).toEqual(original.components.editor);
			expect(saved.components.extensionStatuses.hidden.colorModes).toEqual(
				original.components.extensionStatuses.hidden.colorModes,
			);
			expect(saved.components.footer.styles.starship.extensionStatuses.colorModes).toEqual(
				original.components.footer.styles.starship.extensionStatuses.colorModes,
			);
			if (style === "hidden") {
				expect(saved.components.extensionStatuses.hidden.placements["demo:build"]).toBe("left");
				expect(saved.components.footer).toEqual(original.components.footer);
			} else
				expect(
					saved.components.footer.styles.starship.extensionStatuses.placements["demo:build"],
				).toBe("left");
			saveExtensionStatusChoice("demo:build", "off", style, path);
			expect(raw(path).components.extensionStatuses.visibility["demo:build"]).toBe("hide");
			saveExtensionStatusChoice("demo:build", "default", style, path);
			saved = raw(path);
			expect(saved.components.extensionStatuses.visibility).not.toHaveProperty("demo:build");
			if (style === "hidden") {
				expect(saved.components.extensionStatuses.hidden.placements).not.toHaveProperty(
					"demo:build",
				);
				expect(saved.components.footer).toEqual(original.components.footer);
			} else
				expect(
					saved.components.footer.styles.starship.extensionStatuses.placements,
				).not.toHaveProperty("demo:build");
			expect(mergeConfig(saved).components.extensionStatuses.defaultVisibility).toBe("hide");
			expect(saved.components.footer).toMatchObject({ style, enabled: false, unknown: "keep" });
			if (style !== "hidden")
				expect(saved.components.extensionStatuses.hidden).toEqual(
					original.components.extensionStatuses.hidden,
				);
		},
	);

	it("preserves special and unrelated legacy keys and shadows a reset legacy override", () => {
		const path = fixture({
			extensionStatuses: { placements: { "demo:build": "off", other: "middle" } },
			components: { extensionStatuses: { visibility: { "demo:build": "hide", other: "show" } } },
		});
		saveExtensionStatusChoice("demo:build", "default", "native", path);
		const saved = raw(path);
		expect(saved.extensionStatuses.placements).toEqual({ "demo:build": "off", other: "middle" });
		expect(saved.components.footer.styles.starship.extensionStatuses.placements).toEqual({
			other: "middle",
		});
		expect(saved.components.extensionStatuses.visibility).toEqual({ other: "show" });
		expect(
			mergeConfig(saved).components.footer.styles.starship.extensionStatuses.placements,
		).toEqual({ other: "middle" });
		for (const key of ["__proto__", "constructor", "a:b"]) {
			saveExtensionStatusChoice(key, "right", "hidden", path);
			expect(Object.hasOwn(raw(path).components.extensionStatuses.hidden.placements, key)).toBe(
				true,
			);
			saveExtensionStatusChoice(key, "default", "hidden", path);
			expect(Object.hasOwn(raw(path).components.extensionStatuses.hidden.placements, key)).toBe(
				false,
			);
		}
	});

	it("keeps a reset legacy-only key cleared through later saves while preserving unknown mappings", () => {
		const legacy = { key: "off", future: { option: "keep" } };
		const path = fixture({ extensionStatuses: { placements: legacy } });
		saveExtensionStatusChoice("key", "left", "starship", path);
		expect(raw(path).components.footer.styles.starship.extensionStatuses.placements).toEqual({
			...legacy,
			key: "left",
		});
		saveExtensionStatusChoice("key", "default", "starship", path);
		saveExtensionStatusDefaultChoice("middle", "starship", path);
		expect(raw(path).extensionStatuses.placements).toEqual(legacy);
		expect(raw(path).components.footer.styles.starship.extensionStatuses.placements).toEqual({
			future: legacy.future,
		});
		expect(
			mergeConfig(raw(path)).components.footer.styles.starship.extensionStatuses.placements,
		).toEqual({});
	});

	it.each(["native", "hidden", "starship"] as const)(
		"commits each %s selection once and leaves both choices unchanged on rename failure",
		(style) => {
			const path = fixture({ components: { footer: { style } } });
			saveExtensionStatusDefaultChoice("middle", style, path);
			expect(renameSync).toHaveBeenCalledTimes(1);
			let config = mergeConfig(raw(path));
			expect(config.components.extensionStatuses.defaultVisibility).toBe("show");
			expect(
				style === "hidden"
					? config.components.extensionStatuses.hidden?.defaultPlacement
					: config.components.footer.styles.starship.extensionStatuses.defaultPlacement,
			).toBe("middle");
			saveExtensionStatusChoice("key", "right", style, path);
			expect(renameSync).toHaveBeenCalledTimes(2);
			config = mergeConfig(raw(path));
			expect(config.components.extensionStatuses.visibility.key).toBe("show");
			expect(
				style === "hidden"
					? config.components.extensionStatuses.hidden?.placements?.key
					: config.components.footer.styles.starship.extensionStatuses.placements.key,
			).toBe("right");
			const before = readFileSync(path, "utf8");
			for (const save of [
				() => saveExtensionStatusDefaultChoice("off", style, path),
				() => saveExtensionStatusChoice("key", "left", style, path),
				() => saveExtensionStatusChoice("key", "off", style, path),
				() => saveExtensionStatusChoice("key", "default", style, path),
			]) {
				vi.mocked(renameSync).mockImplementationOnce(() => {
					throw new Error("rename failed");
				});
				expect(save).toThrow("rename failed");
				expect(readFileSync(path, "utf8")).toBe(before);
			}
			expect(readdirSync(dirs[dirs.length - 1])).toEqual(["zentui.json"]);
		},
	);

	it("preserves unknown leaves, mode selections and legacy colors in a sparse Starship color save", () => {
		const original = {
			future: { keep: true },
			extensionStatuses: { colorModes: { legacy: "original", future: "unknown" } },
			components: {
				footer: { enabled: false, style: "future", unknown: "keep" },
				extensionStatuses: {
					hidden: { colorModes: { key: "zentui" } },
					visibility: { key: "hide" },
				},
			},
		};
		const path = fixture(original);
		saveExtensionStatusColorMode("key", "original", path);
		expect(raw(path)).toEqual({
			...original,
			components: {
				...original.components,
				footer: {
					...original.components.footer,
					styles: {
						starship: {
							extensionStatuses: {
								colorModes: { ...original.extensionStatuses.colorModes, key: "original" },
							},
						},
					},
				},
			},
		});
		expect(renameSync).toHaveBeenCalledTimes(1);
	});

	it("refuses corrupt config without changing bytes or splitting Off/position", () => {
		const path = fixture({});
		writeFileSync(path, "{not json");
		expect(() => saveExtensionStatusChoice("key", "left", "starship", path)).toThrow(
			/corrupt or unreadable/,
		);
		expect(() => saveExtensionStatusDefaultChoice("off", "hidden", path)).toThrow(
			/corrupt or unreadable/,
		);
		expect(readFileSync(path, "utf8")).toBe("{not json");
	});
});
