import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { componentColor } from "../extensions/zentui/component-colors";
import { mergeConfig, type ZentuiConfig } from "../extensions/zentui/config";
import { renderMinimalistFrame } from "../extensions/zentui/minimalist-editor";

const theme = {
	fg: (color: string, text: string) => {
		const codes: Record<string, number> = { muted: 100, success: 101, warning: 102, error: 103 };
		return `\x1b[38;5;${codes[color] ?? 104}m${text}\x1b[0m`;
	},
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
} as Theme;
const label = "Cache 98.2%";
function top(config: ZentuiConfig, contextPercent?: number): string {
	return renderMinimalistFrame({
		width: 120,
		editorLines: ["draft"],
		inputText: "draft",
		metadata: { cwd: "", cacheHitRate: 98.16, contextPercent },
		uiTheme: theme,
		config,
	})[0];
}

const cases = [
	{ name: "default normal", shared: {}, local: {}, terminal: 90, theme: 100 },
	{
		name: "shared normal",
		shared: { contextNormal: "green" },
		local: {},
		terminal: 32,
		theme: 101,
	},
	{
		name: "local normal",
		shared: { contextNormal: "red" },
		local: { contextNormal: "green" },
		terminal: 32,
		theme: 101,
	},
	{
		name: "shared cache before local normal",
		shared: { cacheHit: "green" },
		local: { contextNormal: "red" },
		terminal: 32,
		theme: 101,
	},
	{
		name: "local cache before shared cache",
		shared: { cacheHit: "red" },
		local: { cacheHit: "green" },
		terminal: 32,
		theme: 101,
	},
	{
		name: "invalid local cache",
		shared: { cacheHit: "green" },
		local: { cacheHit: "invalid" },
		terminal: 32,
		theme: 101,
	},
	{
		name: "invalid shared cache",
		shared: { cacheHit: "invalid", contextNormal: "green" },
		local: {},
		terminal: 32,
		theme: 101,
	},
	{
		name: "theme token",
		shared: {},
		local: { cacheHit: "success" },
		terminal: "theme",
		theme: 101,
	},
	{
		name: "explicit 256 color",
		shared: {},
		local: { cacheHit: "fg:202" },
		terminal: "256",
		theme: 202,
	},
	{
		name: "explicit hex",
		shared: {},
		local: { cacheHit: "#123456" },
		terminal: "hex",
		theme: "hex",
	},
	{
		name: "empty local cache",
		shared: { cacheHit: "red" },
		local: { cacheHit: "" },
		terminal: "empty",
		theme: "empty",
	},
	{
		name: "whitespace shared cache",
		shared: { cacheHit: "   " },
		local: { contextNormal: "red" },
		terminal: "empty",
		theme: "empty",
	},
	{
		name: "empty normal fallback",
		shared: {},
		local: { contextNormal: "" },
		terminal: "empty",
		theme: "empty",
	},
] as const;

describe.each(["theme", "terminal"] as const)("Minimalist cache-hit %s colors", (source) => {
	it.each(cases)("resolves $name identically in built-in and template labels", (test) => {
		const config = mergeConfig({
			colors: test.shared,
			components: {
				editor: {
					colorSource: source,
					colors: test.local,
					styles: { minimalist: { showCacheHit: true } },
				},
			},
		});
		const code = test[source];
		const prefix =
			code === "empty"
				? ""
				: code === "hex"
					? "\x1b[38;2;18;52;86m"
					: code === "256"
						? "\x1b[38;5;202m"
						: code === "theme"
							? "\x1b[38;5;101m"
							: source === "theme"
								? `\x1b[38;5;${code}m`
								: `\x1b[${code}m`;
		const expected = `${prefix}${label}${code === "empty" ? "" : "\x1b[0m"}`;
		const builtin = top(config);
		expect(builtin).toContain(expected);
		if (code === "empty") expect(builtin).toContain(`\x1b[0m${label}\x1b[`);
		config.components.editor.styles.minimalist.formats = { topRight: "$cache_hit" };
		config.components.editor.styles.minimalist.showCacheHit = false;
		expect(top(config)).toBe(builtin);
	});
	it.each([75, 95])("keeps normal fallback stable at %i%% context", (percent) => {
		const config = mergeConfig({
			colors: { contextNormal: "red" },
			components: {
				editor: {
					colorSource: source,
					colors: { contextNormal: "green", contextWarning: "yellow", contextError: "red" },
					styles: { minimalist: { showCacheHit: true } },
				},
			},
		});
		const expected =
			source === "theme" ? `\x1b[38;5;101m${label}\x1b[0m` : `\x1b[32m${label}\x1b[0m`;
		expect(top(config, percent)).toContain(expected);
		config.components.editor.styles.minimalist.formats = { topRight: "$context$sep$cache_hit" };
		expect(top(config, percent)).toContain(expected);
		const contextCode =
			source === "theme" ? `38;5;${percent === 75 ? 102 : 103}` : percent === 75 ? "33" : "31";
		expect(top(config, percent)).toContain(`\x1b[${contextCode}m${percent}%\x1b[0m`);
	});
});

it("leaves cacheHit sparse and ignores unsupported owner roles", () => {
	const config = mergeConfig({
		components: {
			footer: { colors: { cacheHit: "red" } },
			userMessages: { colors: { cacheHit: "red" } },
			selectorBorders: { colors: { cacheHit: "red" } },
			workingLine: { colors: { cacheHit: "red" } },
		},
	});
	expect(config.colors).not.toHaveProperty("cacheHit");
	expect(config.components.editor.colors).toBeUndefined();
	expect(componentColor(config, "editor", "cacheHit")).toBeUndefined();
	for (const owner of ["footer", "userMessages", "selectorBorders", "workingLine"] as const)
		expect(config.components[owner].colors).toEqual({});
});
