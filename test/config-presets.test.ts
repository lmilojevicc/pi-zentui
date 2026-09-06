import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: vi.fn(actual.renameSync),
		writeFileSync: vi.fn(actual.writeFileSync),
	};
});

import {
	hasUnsupportedComponentStyle,
	mergeConfig,
	saveComponentPreset,
} from "../extensions/zentui/config";
import {
	componentPresets,
	getComponentPreset,
	matchingComponentPreset,
} from "../extensions/zentui/presets";

function preset(id: string) {
	const value = getComponentPreset(id);
	if (!value) throw new Error(`Unknown test preset ${id}`);
	return value;
}
function withConfig(initial: unknown, run: (path: string, dir: string) => void) {
	const dir = fs.mkdtempSync(join(tmpdir(), "zentui-preset-"));
	const path = join(dir, "zentui.json");
	try {
		if (initial !== undefined) fs.writeFileSync(path, JSON.stringify(initial));
		vi.clearAllMocks();
		run(path, dir);
	} finally {
		fs.rmSync(dir, { force: true, recursive: true });
	}
}
function raw(path: string) {
	return JSON.parse(fs.readFileSync(path, "utf8"));
}
afterEach(() => {
	vi.clearAllMocks();
});

describe("atomic component preset persistence", () => {
	it.each(componentPresets)(
		"saves only $id selection leaves once, without a preset key or materialized defaults",
		(value) => {
			withConfig(undefined, (path, dir) => {
				const config = saveComponentPreset(value, path);
				expect(raw(path)).toEqual({ components: value.components });
				expect(matchingComponentPreset(config)?.id).toBe(value.id);
				expect(config).toEqual(mergeConfig(raw(path)));
				expect(fs.renameSync).toHaveBeenCalledTimes(1);
				expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
				expect(fs.readdirSync(dir)).toEqual(["zentui.json"]);
				const before = fs.readFileSync(path, "utf8");
				saveComponentPreset(value, path);
				expect(fs.readFileSync(path, "utf8")).toBe(before);
			});
		},
	);

	it.each(componentPresets)(
		"preserves every unrelated raw field, option, and future style under $id",
		(value) => {
			const initial = {
				unknown: { future: true },
				icons: { mode: "ascii", cwd: "custom" },
				colors: { cwd: "red" },
				footerSegments: { cost: false },
				footerFormat: "$cwd",
				pathDisplay: { mode: "full" },
				components: {
					editor: {
						enabled: false,
						style: "future-editor",
						colorSource: "terminal",
						borderColorMode: "adaptive",
						future: true,
						styles: { "future-editor": { x: 1 }, opencode: { completionMenu: "native" } },
					},
					userMessages: {
						enabled: true,
						style: "future-messages",
						colorSource: "terminal",
						styles: {
							"future-messages": { rail: "!" },
							framed: { copyFriendly: true, future: true },
						},
					},
					footer: {
						style: "future-footer",
						colorSource: "terminal",
						styles: {
							"future-footer": { foo: "bar" },
							starship: { format: "$cwd", segments: { cost: false } },
						},
					},
					selectorBorders: { style: "future-selectors", enabled: true },
					workingLine: { enabled: true, future: true },
					thinkingSteps: { enabled: true, mode: "rail" },
					futureComponent: { enabled: true, style: "future" },
				},
			};
			withConfig(initial, (path) => {
				const result = saveComponentPreset(value, path);
				const expected = structuredClone(initial);
				for (const owner of ["editor", "userMessages", "footer"] as const)
					Object.assign(expected.components[owner], value.components[owner]);
				if (value.components.userMessages.style !== undefined)
					Reflect.deleteProperty(expected.components.userMessages.styles.framed, "copyFriendly");
				expect(raw(path)).toEqual(expected);
				expect(hasUnsupportedComponentStyle(result, "selectorBorders")).toBe(true);
				expect(hasUnsupportedComponentStyle(result, "userMessages")).toBe(
					value.id === "minimalist",
				);
				expect(matchingComponentPreset(result)?.id).toBe(value.id);
			});
		},
	);

	it("keeps legacy options effective and clears only explicit selection migration flags", () => {
		withConfig(
			{
				features: { editor: false, statusLine: false, viewportIndicators: false },
				editorMetadataFormat: "$model",
				footerFormat: "$cwd",
				colorSources: { editor: "terminal", userMessages: "terminal", starship: "terminal" },
				components: {
					editor: {
						styles: { polished: { copyFriendly: true, metadataFormat: "$provider", future: 42 } },
					},
					userMessages: { styles: { framed: { copyFriendly: true, future: 42 } } },
					footer: { enabled: false },
				},
			},
			(path) => {
				const result = saveComponentPreset(preset("opencode"), path);
				expect(result.components.editor).toMatchObject({
					enabled: true,
					style: "opencode",
					colorSource: "terminal",
					viewportIndicators: false,
					styles: { opencode: { metadataFormat: "$provider" } },
				});
				expect(result.components.userMessages).toMatchObject({
					enabled: true,
					style: "framed",
					colorSource: "terminal",
				});
				expect(result.components.footer).toMatchObject({
					style: "starship",
					colorSource: "terminal",
					styles: { starship: { format: "$cwd" } },
				});
				expect(raw(path).components.editor.styles.polished).toEqual({
					metadataFormat: "$provider",
					future: 42,
				});
				expect(raw(path).components.userMessages.styles.framed).toEqual({ future: 42 });
				expect(raw(path).components.footer).not.toHaveProperty("enabled");
			},
		);
	});

	it("preserves the dormant migrated copy-friendly message style for Minimalist", () => {
		withConfig(
			{ components: { userMessages: { styles: { framed: { copyFriendly: true } } } } },
			(path) => {
				const result = saveComponentPreset(preset("minimalist"), path);
				expect(result.components.userMessages.style).toBe("framed-copy-friendly");
				expect(raw(path).components.userMessages).toEqual({
					enabled: false,
					styles: { framed: { copyFriendly: true } },
				});
			},
		);
	});

	it("uses fresh disk state rather than a stale resolved snapshot", () => {
		withConfig({ colors: { cwd: "red" } }, (path) => {
			mergeConfig(raw(path));
			fs.writeFileSync(path, JSON.stringify({ colors: { cwd: "blue" }, unknown: "new" }));
			const result = saveComponentPreset(preset("rail"), path);
			expect(result.colors.cwd).toBe("blue");
			expect(raw(path).unknown).toBe("new");
		});
	});

	it("preserves symlinks and file permissions", () => {
		withConfig({ unknown: true }, (path, dir) => {
			const link = join(dir, "link.json");
			fs.chmodSync(path, 0o600);
			fs.symlinkSync(path, link);
			saveComponentPreset(preset("rail"), link);
			expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
			expect(fs.statSync(path).mode & 0o777).toBe(0o600);
			expect(raw(path).unknown).toBe(true);
		});
	});

	it.each(["{broken", "null", "[]"])(
		"refuses corrupt/non-object config %s without writes",
		(bytes) => {
			withConfig(undefined, (path, dir) => {
				fs.writeFileSync(path, bytes);
				vi.clearAllMocks();
				expect(() => saveComponentPreset(preset("rail"), path)).toThrow(/Refusing to save/);
				expect(fs.readFileSync(path, "utf8")).toBe(bytes);
				expect(fs.renameSync).not.toHaveBeenCalled();
				expect(fs.writeFileSync).not.toHaveBeenCalled();
				expect(fs.readdirSync(dir)).toEqual(["zentui.json"]);
			});
		},
	);

	it.each(["write", "rename"])(
		"keeps original bytes and removes temporary files on %s failure",
		(operation) => {
			withConfig({ unknown: true }, (path, dir) => {
				const bytes = fs.readFileSync(path, "utf8");
				const failing =
					operation === "write" ? vi.mocked(fs.writeFileSync) : vi.mocked(fs.renameSync);
				failing.mockImplementationOnce(() => {
					throw new Error("disk failure");
				});
				expect(() => saveComponentPreset(preset("rail"), path)).toThrow("disk failure");
				expect(fs.readFileSync(path, "utf8")).toBe(bytes);
				expect(fs.readdirSync(dir)).toEqual(["zentui.json"]);
			});
		},
	);
});
