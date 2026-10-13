import { initTheme, type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBashProgress } from "../extensions/zentui/tool-display/bash-display.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	createToolDisplayRenderers,
	type ToolDisplayRenderContext,
} from "../extensions/zentui/tool-display/renderers.js";
import { MAX_PREVIEW_LINE_CHARS } from "../extensions/zentui/tool-display/source-bounds.js";

import { toolRenderContextDefaults } from "./tool-display-context-fixture.js";

const command = `for i in 1 2 3 4 5; do printf 'stream %s\\n' "$i"; sleep 0.3; done`;
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const theme = {
	fg: (_token: string, text: string) => `\x1b[36m${text}\x1b[39m`,
	bold: (text: string) => text,
};
const ctx = (args = {}): ToolDisplayRenderContext => ({
	...toolRenderContextDefaults,
	args,
	cwd: "/sandbox",
	toolCallId: "test",
	state: {},
	argsComplete: true,
	executionStarted: false,
	expanded: false,
	isPartial: false,
	isError: false,
	showImages: false,
	lastComponent: undefined,
	invalidate() {},
});
function activeTheme(name: string): Theme {
	initTheme(name, false);
	let captured!: Theme;
	new ToolExecutionComponent(
		"capture",
		"id",
		{},
		{},
		{
			renderCall(_args: unknown, current: Theme) {
				captured = current;
				return new Text("", 0, 0);
			},
		},
		{ requestRender() {} } as TUI,
		"/sandbox",
	);
	return captured;
}
afterEach(() => {
	vi.useRealTimers();
});
describe("tool-display/bash-display foreground syntax only", () => {
	it("public host colors the screenshot command and refreshes the stable active theme proxy", () => {
		const progress = createBashProgress();
		const dark = activeTheme("dark");
		const before = progress.renderCall({ command }, dark, ctx()).render(160);
		const light = activeTheme("light");
		expect(light).toBe(dark);
		const after = progress.renderCall({ command }, light, ctx()).render(160);
		expect(after).not.toEqual(before);
		for (const rows of [before, after]) {
			expect(strip(rows.join("\n")).trimEnd()).toBe(`$ ${command}`);
			expect(
				new Set(rows.join("").match(/\x1b\[38;(?:2;\d+;\d+;\d+|5;\d+)m/g)).size,
			).toBeGreaterThan(3);
		}
		progress.dispose();
	});
	it.each([
		"",
		"printf 'partial",
		"printf 'first\nsecond'\necho done\n",
		"\tprintf '界 👩‍💻 é'\t",
		command,
	])("matches independently constructed old rows at narrow/normal/wide widths: %s", (input) => {
		const highlight = vi.fn((text: string) =>
			text.split("\n").map((line) => `\x1b[31m${line}\x1b[39m`),
		);
		const progress = createBashProgress(highlight);
		const args = {
			command: input,
			commandPrefix: "  env LC_ALL=C  ",
			shellPath: "/bin/sh",
			timeout: 3,
		};
		const display = `env LC_ALL=C ${input.trim() ? input : "..."}`;
		const old = new Text(
			`$ ${theme.fg("accent", display)}${theme.fg("muted", " [shell: /bin/sh]")}${theme.fg("muted", " (timeout 3s)")}`,
			0,
			0,
		);
		const actual = progress.renderCall(args, theme, ctx());
		for (const width of [7, 17, 80, 110, 160]) {
			const before = old.render(width),
				after = actual.render(width);
			expect(after.map(strip)).toEqual(before.map(strip));
			expect(after.map(visibleWidth)).toEqual(before.map(visibleWidth));
		}
		expect(highlight).toHaveBeenCalledTimes(1);
		progress.dispose();
	});
	it.each(["/bin/fish", "/bin/zsh", "cmd.exe", "pwsh", "/custom/shell"])(
		"does not label %s as Bash",
		(shellPath) => {
			const highlight = vi.fn((text: string) => [text]);
			const progress = createBashProgress(highlight);
			progress.renderCall({ command, shellPath }, theme, ctx());
			expect(highlight).not.toHaveBeenCalled();
			progress.dispose();
		},
	);
	it.each([42, {}, false, null])(
		"retains the original accent row for malformed shellPath: %j",
		(shellPath) => {
			const highlight = vi.fn((text: string) => [`\x1b[31m${text}\x1b[39m`]);
			const progress = createBashProgress(highlight);
			const renderer = createToolDisplayRenderers(
				"bash",
				() => normalizeToolDisplayConfig({ enabled: true }),
				{ progress },
			);
			const args = { command: "echo ok", shellPath };
			const expected = new Text(
				`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", "echo ok")}`,
				0,
				0,
			);
			try {
				const row = renderer.renderCall?.(args, theme as Theme, ctx(args));
				expect(row?.render(80)).toEqual(expected.render(80));
				expect(highlight).not.toHaveBeenCalled();
			} finally {
				progress.dispose();
			}
		},
	);
	it.each([
		() => {
			throw new Error("unavailable");
		},
		() => [],
		(text: string) => [`\x1b[41m${text}\x1b[49m`],
		(text: string) => [`\x1b[0m${text}`],
		(text: string) => [`\x1b[1m${text}\x1b[22m`],
		(text: string) => [`\x1b]0;title\x07${text}`],
		(text: string) => [`\x1b[38;2;999;0;0m${text}`],
		(text: string) => [`${text}changed`],
		(text: string) => [`${"\x1b[31m".repeat(10000)}${text}`],
	])("falls back byte-for-byte for invalid/throwing highlighting", (highlight) => {
		const progress = createBashProgress(highlight);
		const expected = new Text(
			`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", command)}`,
			0,
			0,
		);
		expect(progress.renderCall({ command }, theme, ctx()).render(80)).toEqual(expected.render(80));
		progress.dispose();
	});
	it("public grammar preserves old screenshot wrapping even at very narrow widths", () => {
		const current = activeTheme("dark");
		const progress = createBashProgress();
		const old = new Text(
			`${current.fg("toolTitle", current.bold("$"))} ${current.fg("accent", command)}`,
			0,
			0,
		);
		const row = progress.renderCall({ command }, current, ctx());
		for (const width of [3, 5, 7, 17, 40, 80, 110, 160]) {
			expect(row.render(width).map(strip)).toEqual(old.render(width).map(strip));
			expect(row.render(width).map(visibleWidth)).toEqual(old.render(width).map(visibleWidth));
		}
		progress.dispose();
	});
	it.each(["echo\u00a0hello", "echo\u2003hello", "echo \u0301hello", "echo\n \u0301hello"])(
		"preserves Unicode whitespace and graphemes after syntax SGR placement: %s",
		(input) => {
			const current = activeTheme("dark");
			const progress = createBashProgress();
			const old = new Text(
				`${current.fg("toolTitle", current.bold("$"))} ${current.fg("accent", input)}`,
				0,
				0,
			);
			try {
				const row = progress.renderCall({ command: input }, current, ctx());
				for (let width = 3; width <= 20; width++) {
					expect(row.render(width).map(strip)).toEqual(old.render(width).map(strip));
					expect(row.render(width).map(visibleWidth)).toEqual(old.render(width).map(visibleWidth));
				}
				expect(row.render(1000).join("\n")).not.toMatch(/ (?:\x1b\[[0-9;]*m)+\u0301/u);
			} finally {
				progress.dispose();
			}
		},
	);
	it("rejects syntax ANSI inside a grapheme", () => {
		const source = "echo é 👩‍💻";
		const progress = createBashProgress((text) => [text.replace("é", "e\x1b[31ḿ")]);
		const old = new Text(
			`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", source)}`,
			0,
			0,
		);
		expect(progress.renderCall({ command: source }, theme, ctx()).render(7)).toEqual(old.render(7));
		progress.dispose();
	});
	it("keeps the original accent bytes when the public highlighter is missing", () => {
		const progress = createBashProgress(null);
		expect(progress.renderCall({ command }, theme, ctx()).render(80)).toEqual(
			new Text(
				`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", command)}`,
				0,
				0,
			).render(80),
		);
		progress.dispose();
	});
	it("sanitizes and caps raw commands/prefixes before the highlighter", () => {
		const highlight = vi.fn((text: string) => [text]);
		const progress = createBashProgress(highlight);
		const renderer = createToolDisplayRenderers(
			"bash",
			() => normalizeToolDisplayConfig({ enabled: true }),
			{ progress },
		);
		const args = {
			command: `echo \x1b]0;attack\x07\x1b[2J${"界".repeat(MAX_PREVIEW_LINE_CHARS + 100)}`,
			commandPrefix: "env\x07",
		};
		const rows = renderer.renderCall?.(args, theme as Theme, ctx(args)).render(80) ?? [];
		expect(highlight).toHaveBeenCalledTimes(1);
		const source = highlight.mock.calls[0][0];
		expect(source).not.toMatch(/[\x00-\x08\x1b\x7f-\x9f]/);
		expect(source.length).toBeLessThanOrEqual(MAX_PREVIEW_LINE_CHARS + 32);
		expect(rows.map(strip).join("\n")).toContain("preview capped");
		progress.dispose();
	});
	it("retains highlights on paints/ticks, but refreshes command and live palette; disposes timers", () => {
		vi.useFakeTimers();
		const highlight = vi.fn((text: string) => [`\x1b[31m${text}\x1b[39m`]);
		const progress = createBashProgress(highlight);
		let color = 36;
		const proxy = {
			...theme,
			fg: (_token: string, text: string) => `\x1b[${color}m${text}\x1b[39m`,
		};
		const context = { ...ctx(), executionStarted: true, isPartial: true, invalidate: vi.fn() };
		const row = progress.renderCall({ command }, proxy, context);
		progress.renderCall({ command }, proxy, { ...context, lastComponent: row });
		vi.advanceTimersByTime(1200);
		expect(highlight).toHaveBeenCalledTimes(1);
		color = 35;
		vi.advanceTimersByTime(200);
		expect(highlight).toHaveBeenCalledTimes(2);
		progress.renderCall({ command: "echo changed" }, proxy, context);
		expect(highlight).toHaveBeenCalledTimes(3);
		progress.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});
