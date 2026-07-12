import { describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import {
	ASCII_DEFAULT_ICONS,
	ICON_GLYPH_KEYS,
	NERD_DEFAULT_ICONS,
	RUNTIME_ASCII_SYMBOLS,
	resolveConfiguredIcons,
	resolveOsIcon,
	resolveRuntimeSymbol,
} from "../extensions/zentui/icons";
import { runtimeMetadata } from "../extensions/zentui/runtime";

describe("icon tables", () => {
	it("keeps nerd defaults byte-identical to historical defaultConfig icons", () => {
		for (const key of ICON_GLYPH_KEYS) {
			expect(NERD_DEFAULT_ICONS[key]).toBe(defaultConfig.icons[key]);
		}
	});

	it("provides ascii defaults for every nerd icon key", () => {
		for (const key of ICON_GLYPH_KEYS) {
			expect(typeof ASCII_DEFAULT_ICONS[key]).toBe("string");
		}
	});

	it("covers runtime metadata names with ascii symbols", () => {
		for (const runtime of runtimeMetadata) {
			expect(RUNTIME_ASCII_SYMBOLS[runtime.name]).toBeTruthy();
		}
	});
});

describe("resolveConfiguredIcons", () => {
	it("starts from nerd for auto/nerd and ascii for ascii mode", () => {
		expect(resolveConfiguredIcons("auto").cwd).toBe(NERD_DEFAULT_ICONS.cwd);
		expect(resolveConfiguredIcons("nerd").git).toBe(NERD_DEFAULT_ICONS.git);
		expect(resolveConfiguredIcons("ascii").cwd).toBe(ASCII_DEFAULT_ICONS.cwd);
	});

	it("lets user overrides win over mode defaults", () => {
		expect(resolveConfiguredIcons("ascii", { cwd: "DIR", os: "X" })).toMatchObject({
			mode: "ascii",
			cwd: "DIR",
			os: "X",
			git: ASCII_DEFAULT_ICONS.git,
		});
	});
});

describe("resolveOsIcon", () => {
	it("always honors a custom os icon", () => {
		expect(resolveOsIcon("X", "auto", "darwin")).toBe("X");
		expect(resolveOsIcon("X", "ascii", "linux")).toBe("X");
		expect(resolveOsIcon("X", "nerd", "win32")).toBe("X");
	});

	it("maps platforms when os is still the mode default", () => {
		expect(resolveOsIcon(NERD_DEFAULT_ICONS.os, "auto", "linux")).toBe("\uf17c");
		expect(resolveOsIcon(ASCII_DEFAULT_ICONS.os, "ascii", "darwin")).toBe("mac");
	});
});

describe("resolveRuntimeSymbol", () => {
	it("returns nerd symbol unless ascii mode is active", () => {
		expect(resolveRuntimeSymbol("nodejs", "", "auto")).toBe("");
		expect(resolveRuntimeSymbol("nodejs", "", "ascii")).toBe("node");
	});
});
