import { describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import {
	ASCII_DEFAULT_ICONS,
	detectAutoIconMode,
	ICON_GLYPH_KEYS,
	NERD_DEFAULT_ICONS,
	RUNTIME_ASCII_SYMBOLS,
	resolveConfiguredIcons,
	resolveEffectiveIconMode,
	resolveOsIcon,
	resolveRuntimeSymbol,
} from "../extensions/zentui/icons";
import { runtimeMetadata } from "../extensions/zentui/runtime";

describe("icon tables", () => {
	it("keeps explicit nerd defaults byte-identical to historical glyphs", () => {
		const configured = resolveConfiguredIcons("nerd", {}, {});
		for (const key of ICON_GLYPH_KEYS) {
			expect(NERD_DEFAULT_ICONS[key]).toBe(configured[key]);
		}
		expect(defaultConfig.icons.mode).toBe("auto");
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

describe("automatic icon detection", () => {
	it.each([
		[{ TERM_PROGRAM: "iTerm.app" }, "nerd"],
		[{ TERM_PROGRAM: "WEZTERM" }, "nerd"],
		[{ TERM_PROGRAM: "Ghostty" }, "nerd"],
		[{ KITTY_WINDOW_ID: "1" }, "nerd"],
		[{ ALACRITTY_SOCKET: "/tmp/alacritty.sock" }, "nerd"],
		[{}, "ascii"],
		[{ TERM_PROGRAM: "vscode" }, "ascii"],
		[{ WT_SESSION: "session" }, "ascii"],
	] as const)("detects %j as %s", (env, expected) => {
		expect(detectAutoIconMode(env)).toBe(expected);
	});

	it("uses only exact Auto overrides and never overrides explicit modes", () => {
		expect(detectAutoIconMode({ TERM_PROGRAM: "ghostty", ZENTUI_NERD_FONTS: "0" })).toBe("ascii");
		expect(detectAutoIconMode({ ZENTUI_NERD_FONTS: "1" })).toBe("nerd");
		expect(detectAutoIconMode({ ZENTUI_NERD_FONTS: "true" })).toBe("ascii");
		expect(resolveEffectiveIconMode("nerd", { ZENTUI_NERD_FONTS: "0" })).toBe("nerd");
		expect(resolveEffectiveIconMode("ascii", { TERM_PROGRAM: "ghostty" })).toBe("ascii");
	});
});

describe("resolveConfiguredIcons", () => {
	it("keeps Auto canonical while materializing the detected effective mode", () => {
		expect(resolveConfiguredIcons("auto", {}, {})).toMatchObject({
			mode: "auto",
			effectiveMode: "ascii",
			git: ASCII_DEFAULT_ICONS.git,
		});
		expect(resolveConfiguredIcons("auto", {}, { TERM_PROGRAM: "ghostty" })).toMatchObject({
			mode: "auto",
			effectiveMode: "nerd",
			git: NERD_DEFAULT_ICONS.git,
		});
	});

	it("lets user overrides win over detected defaults", () => {
		expect(resolveConfiguredIcons("auto", { cwd: "DIR", os: "X" }, {})).toMatchObject({
			mode: "auto",
			effectiveMode: "ascii",
			cwd: "DIR",
			os: "X",
			osOverridden: true,
			git: ASCII_DEFAULT_ICONS.git,
		});
	});

	it("preserves OS override provenance when it equals the detected mode default", () => {
		expect(resolveConfiguredIcons("auto", { os: ASCII_DEFAULT_ICONS.os }, {})).toMatchObject({
			effectiveMode: "ascii",
			os: ASCII_DEFAULT_ICONS.os,
			osOverridden: true,
		});
		expect(
			resolveConfiguredIcons("auto", { os: NERD_DEFAULT_ICONS.os }, { TERM_PROGRAM: "ghostty" }),
		).toMatchObject({
			effectiveMode: "nerd",
			os: NERD_DEFAULT_ICONS.os,
			osOverridden: true,
		});
	});
});

describe("resolveOsIcon", () => {
	it("always honors a custom os icon", () => {
		expect(resolveOsIcon("X", "auto", "darwin", {})).toBe("X");
		expect(resolveOsIcon("X", "ascii", "linux")).toBe("X");
		expect(resolveOsIcon("X", "nerd", "win32")).toBe("X");
	});

	it("maps platforms when os is still the effective mode default", () => {
		expect(resolveOsIcon(NERD_DEFAULT_ICONS.os, "auto", "linux", { TERM_PROGRAM: "ghostty" })).toBe(
			"\uf17c",
		);
		expect(resolveOsIcon(ASCII_DEFAULT_ICONS.os, "auto", "darwin", {})).toBe("mac");
	});

	it("honors Auto overrides equal to the effective mode default", () => {
		const ascii = resolveConfiguredIcons("auto", { os: ASCII_DEFAULT_ICONS.os }, {});
		expect(resolveOsIcon(ascii.os, ascii.effectiveMode, "linux", {}, ascii.osOverridden)).toBe(
			ASCII_DEFAULT_ICONS.os,
		);

		const nerd = resolveConfiguredIcons(
			"auto",
			{ os: NERD_DEFAULT_ICONS.os },
			{ TERM_PROGRAM: "ghostty" },
		);
		expect(resolveOsIcon(nerd.os, nerd.effectiveMode, "linux", {}, nerd.osOverridden)).toBe(
			NERD_DEFAULT_ICONS.os,
		);
	});
});

describe("resolveRuntimeSymbol", () => {
	it("uses the derived mode for runtime symbols", () => {
		expect(resolveRuntimeSymbol("nodejs", "", "auto", { TERM_PROGRAM: "ghostty" })).toBe("");
		expect(resolveRuntimeSymbol("nodejs", "", "auto", {})).toBe("node");
		expect(resolveRuntimeSymbol("nodejs", "", "ascii", { TERM_PROGRAM: "ghostty" })).toBe("node");
	});
});
