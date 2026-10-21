import { initTheme, type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type BashCallRenderTheme,
	createBashProgress,
	validateBashPaint,
} from "../extensions/zentui/tool-display/bash-display.js";
import {
	type BashPalette,
	type BashTokenBatch,
	paintBashBatch,
	resolveBashPalette,
	tokenizeBashBatch,
} from "../extensions/zentui/tool-display/bash-highlight.js";
import { PresentationText } from "../extensions/zentui/tool-display/presentation-text.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	createToolDisplayRenderers,
	type ToolDisplayRenderContext,
} from "../extensions/zentui/tool-display/renderers.js";
import { MAX_PREVIEW_LINE_CHARS } from "../extensions/zentui/tool-display/source-bounds.js";

import { toolRenderContextDefaults } from "./tool-display-context-fixture.js";

const command = `for i in 1 2 3 4 5; do printf 'stream %s\\n' "$i"; sleep 0.3; done`;
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const flatTheme = {
	fg: (_token: string, text: string) => `\x1b[36m${text}\x1b[39m`,
	bold: (text: string) => text,
};
const CATPPUCCIN: Record<string, string> = {
	text: "#cdd6f4",
	muted: "#a6adc8",
	dim: "#7f849c",
	accent: "#89b4fa",
	success: "#a6e3a1",
	warning: "#f9e2af",
	error: "#f38ba8",
	syntaxKeyword: "#cba6f7",
	syntaxFunction: "#89b4fa",
	syntaxVariable: "#cdd6f4",
	syntaxString: "#a6e3a1",
	syntaxNumber: "#fab387",
	syntaxType: "#f9e2af",
	syntaxOperator: "#89dceb",
	syntaxPunctuation: "#a6adc8",
	syntaxComment: "#7f849c",
	mdCode: "#fab387",
	mdLink: "#89b4fa",
	mdLinkUrl: "#74c7ec",
	bashMode: "#fab387",
	toolTitle: "#a6adc8",
};
/**
 * A painted word is one foreground run covering the whole word: `<color>word`. Colour
 * changes are emitted at word starts only, so a reset never lands in front of the
 * whitespace that follows a word (that is what keeps pi-tui's geometry exact).
 */
function paintedWord(text: string, word: string, color: string): boolean {
	return text.includes(`${color}${word}`);
}

function openSgr(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}
function tokenTheme(
	tokens: Record<string, string>,
	options: {
		withColors?: boolean;
		color?: () => string;
		colorMap?: () => Record<string, string>;
	} = {},
): BashCallRenderTheme {
	const colors = Object.freeze({ ...tokens });
	return {
		...(options.withColors === false ? {} : { colors }),
		getColorMode: () => "truecolor",
		fg(token: string, text: string): string {
			if (options.colorMap) {
				const hex = options.colorMap()[token];
				return hex ? `${openSgr(hex)}${text}\x1b[39m` : text;
			}
			if (options.color) return `${options.color()}${text}\x1b[39m`;
			const hex = tokens[token];
			return hex ? `${openSgr(hex)}${text}\x1b[39m` : text;
		},
		bold: (text: string) => text,
	};
}
const NIGHT: Record<string, string> = {
	...CATPPUCCIN,
	success: "#68b78d",
	warning: "#cd9a22",
	accent: "#a798d7",
	syntaxNumber: "#68b78d",
	syntaxPunctuation: "#9da5a9",
	syntaxOperator: "#89dceb",
	mdLinkUrl: "#9da5a9",
};
const catTheme = tokenTheme(CATPPUCCIN);
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
function accentText(theme: BashCallRenderTheme, display: string): Text {
	return new Text(`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", display)}`, 0, 0);
}
afterEach(() => {
	vi.useRealTimers();
});

describe("tool-display/bash-display semantic syntax", () => {
	it("paints the command row and refreshes the stable active theme proxy", () => {
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
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
	it("paints semantic categories without the legacy accent wrapper and keeps args default", () => {
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		const row = progress
			.renderCall({ command: `git commit -m "msg" && rm -f /tmp/x` }, catTheme, ctx())
			.render(200)
			.join("\n");
		expect(strip(row).trimEnd()).toBe(`$ git commit -m "msg" && rm -f /tmp/x`);
		expect(paintedWord(row, "git", openSgr("#a6e3a1"))).toBe(true);
		expect(paintedWord(row, "-m", openSgr("#fab387"))).toBe(true);
		expect(paintedWord(row, `"msg"`, openSgr("#f9e2af"))).toBe(true);
		// Plain `commit` is base text: no color run opens on it.
		expect(row).not.toContain(`${openSgr("#a6e3a1")}comm`);
		// No nested/duplicated opening colors from an outer accent wrapper.
		expect(row).not.toMatch(/\x1b\[38;2;\d+;\d+;\d+m\x1b\[38;2;/);
		expect(new Set(row.match(/\x1b\[38;2;\d+;\d+;\d+m/g)).size).toBeGreaterThan(4);
		progress.dispose();
	});
	it("renders the shell prompt separately so the real command keeps the verb color", () => {
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		const row = progress
			.renderCall(
				{ command: "git status --short", commandPrefix: "user@host:~/project$" },
				catTheme,
				ctx(),
			)
			.render(200)
			.join("");
		expect(strip(row)).toContain("$ user@host:~/project$ git status --short");
		// The prompt is one muted run, never tokenized as a command or variable.
		expect(row).toContain(`${openSgr("#a6adc8")}user@host:~/project$ \x1b[39m`);
		expect(paintedWord(row, "git", openSgr("#a6e3a1"))).toBe(true);
		expect(row).not.toContain(`${openSgr("#a6e3a1")}user@host`);
		progress.dispose();
	});
	it("keeps the legacy pi path byte-identical to the old accent-wrapped rows", () => {
		const highlight = vi.fn((text: string) =>
			text.split("\n").map((line) => `\x1b[31m${line}\x1b[39m`),
		);
		const progress = createBashProgress(highlight, { getMode: () => "pi" });
		const args = {
			command,
			commandPrefix: "  env LC_ALL=C  ",
			shellPath: "/bin/sh",
			timeout: 3,
		};
		const display = `env LC_ALL=C ${command}`;
		const highlighted = `\x1b[31m${display}\x1b[39m`;
		const old = new Text(
			`${flatTheme.fg("toolTitle", flatTheme.bold("$"))} ${flatTheme.fg("accent", highlighted)}${flatTheme.fg("muted", " [shell: /bin/sh]")}${flatTheme.fg("muted", " (timeout 3s)")}`,
			0,
			0,
		);
		const actual = progress.renderCall(args, flatTheme, ctx());
		const escapeOnlyRow = (row: string) =>
			/^(?:\x1b\[(?:3[0-7]|9[0-7]|38;5;\d{1,3}|38;2;\d{1,3};\d{1,3};\d{1,3})m)+$/.test(row.trim());
		for (const width of [7, 17, 80, 110, 160]) {
			const native = old.render(width);
			// PresentationText drops pi-tui's escape-only wrap row (a blank transcript line
			// that only colored rows produce); every real row stays byte-identical.
			const expected = native.filter((row) => !escapeOnlyRow(row));
			expect(actual.render(width)).toEqual(expected);
			expect(actual.render(width).map(visibleWidth)).toEqual(expected.map(visibleWidth));
			expect(
				native.filter((row) => escapeOnlyRow(row)).every((row) => strip(row).trim() === ""),
			).toBe(true);
		}
		expect(highlight).toHaveBeenCalledTimes(1);
		progress.dispose();
	});
	it("fails open semantic -> pi -> accent", () => {
		const highlight = (text: string) => [`\x1b[31m${text}\x1b[39m`];
		const piRow = new Text(
			`${flatTheme.fg("toolTitle", flatTheme.bold("$"))} ${flatTheme.fg("accent", `\x1b[31m${command}\x1b[39m`)}`,
			0,
			0,
		);
		const accentRow = accentText(flatTheme, command);
		for (const paint of [
			() => {
				throw new Error("painter unavailable");
			},
			(batch: BashTokenBatch) => `${batch.source}changed`,
			() => "\x1b[41mcommand\x1b[49m",
		]) {
			const progress = createBashProgress(highlight, {
				getMode: () => "semantic",
				paint: paint as (batch: BashTokenBatch, palette: BashPalette) => string,
			});
			expect(progress.renderCall({ command }, flatTheme, ctx()).render(80)).toEqual(
				piRow.render(80),
			);
			progress.dispose();
		}
		for (const highlightFailure of [
			null,
			() => {
				throw new Error("highlighter unavailable");
			},
		]) {
			const progress = createBashProgress(highlightFailure, {
				getMode: () => "semantic",
				paint: () => `${command}changed`,
			});
			expect(progress.renderCall({ command }, flatTheme, ctx()).render(80)).toEqual(
				accentRow.render(80),
			);
			progress.dispose();
		}
	});
	it("preserves host wrapping through the production component at widths 10..200", () => {
		const inputs = [
			command,
			"printf 'partial",
			"\tprintf '界 👩‍💻 é'\t",
			`echo a\necho b`,
			`cat <<'EOF'\nhello\nEOF\necho done`,
			// Adjacent over-width painted tokens: a space token can fill a row exactly and
			// the next long path/glob/URL is wider than the row (the escape-only wrap row
			// shape that used to add a blank transcript line).
			`rg -n 'toolDisplay|presentation' extensions/zentui/tool-display --glob '*.ts'`,
			`ssh -i ~/.ssh/id_ed25519 deploy@example.com`,
			`tar -czf archive.tar.gz --exclude=node_modules src`,
			`timeout 30 sh -c 'curl -fsSL https://install.example.com/install.sh | sh'`,
			`npm exec --yes --package=typescript@latest -- tsc --noEmit --pretty`,
			`git log --oneline --all --decorate --graph --simplify-by-decoration`,
			`${"x".repeat(26)} ${"y".repeat(26)}`,
			`${"x".repeat(80)} ${"y".repeat(80)}`,
			`echo \necho ${"界".repeat(40)} " ${"z".repeat(40)}"`,
		];
		for (const input of inputs) {
			const progress = createBashProgress(undefined, { getMode: () => "semantic" });
			const row = progress.renderCall({ command: input }, catTheme, ctx());
			const plain = new PresentationText(`$ ${input}`, 0, 0);
			const accent = new PresentationText(
				`${catTheme.fg("toolTitle", "$")} ${catTheme.fg("accent", input)}`,
				0,
				0,
			);
			for (let width = 10; width <= 200; width++) {
				const rows = row.render(width);
				// No inserted or removed rows versus the uncolored command.
				expect(rows.map(strip)).toEqual(plain.render(width).map(strip));
				expect(rows.map(visibleWidth)).toEqual(plain.render(width).map(visibleWidth));
				// The legacy accent row has identical geometry (and the same normalization).
				expect(accent.render(width).map(strip)).toEqual(plain.render(width).map(strip));
				expect(accent.render(width)).toHaveLength(rows.length);
			}
			progress.dispose();
		}
		// The semantic row differs only in color bytes, not visible text.
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		const semantic = progress.renderCall({ command }, catTheme, ctx()).render(160).join("\n");
		expect(semantic).not.toBe(accentText(catTheme, command).render(160).join("\n"));
		expect(strip(semantic)).toBe(strip(accentText(catTheme, command).render(160).join("\n")));
		progress.dispose();
	});
	it("drops pi-tui's escape-only wrap row while keeping real blank rows", () => {
		// Raw pi-tui Text on a colored row inserts a zero-width blank row at this width;
		// the same input uncolored does not. PresentationText normalizes both modes.
		const input = `${"x".repeat(26)} ${"y".repeat(26)}`;
		const native = new Text(catTheme.fg("accent", input), 0, 0).render(13);
		expect(native.some((row) => row.trim() !== "" && strip(row).trim() === "")).toBe(true);
		const normalized = new PresentationText(catTheme.fg("accent", input), 0, 0).render(13);
		expect(normalized).toHaveLength(new Text(input, 0, 0).render(13).length);
		expect(normalized.some((row) => strip(row).trim() !== "")).toBe(true);
		// Multi-line commands keep their real blank lines and trailing blank row.
		const multiline = "echo a\n\necho b\n";
		const rows = new PresentationText(catTheme.fg("accent", multiline), 0, 0).render(20);
		expect(rows).toHaveLength(new PresentationText(multiline, 0, 0).render(20).length);
		expect(rows.map(strip)).toEqual(new PresentationText(multiline, 0, 0).render(20).map(strip));
	});
	it("resolves every role, including variables, on the builtin light theme", () => {
		const light = activeTheme("light");
		const palette = resolveBashPalette(light);
		expect(palette.unpainted).toEqual([]);
		const command = `echo "deploy $VERSION to $ENV"`;
		const painted = paintBashBatch(tokenizeBashBatch(command), palette);
		expect(painted).toContain(palette.roles.variable.ansi as string);
		expect(strip(painted)).toBe(command);
	});

	it("keeps raw pi-tui Text rows visible-identical at widths 10..200 for long tokens", () => {
		// Adjacent over-width painted tokens (long paths, globs, quoted strings) can still
		// expose a pi-tui `wrapSingleLine` artifact: when a token breaks exactly at its
		// width, the wrapper can push a whitespace-only escape row. That artifact is an
		// upstream property of the host wrapper, not of the painter: the legacy whole-row
		// accent wrapper produces it for the same inputs, `PresentationText` drops such
		// rows, and semantic rows never introduce a class the accent row does not have.
		const palette = resolveBashPalette(catTheme);
		const corpus = [
			`rg -n 'toolDisplay|presentation' extensions/zentui/tool-display --glob '*.ts'`,
			`ssh -p 2222 -i ~/.ssh/id_ed25519 user@host 'cd /srv && ./run.sh'`,
			`tar -xzf archive.tar.gz -C /tmp && rm archive.tar.gz`,
			`chmod +x ./scripts/deploy.sh && ./scripts/deploy.sh --env=prod`,
			`git log --oneline --all --decorate --graph --simplify-by-decoration`,
			`npm exec --yes --package=typescript@latest -- tsc --noEmit --pretty`,
			`cat /very/long/path/that/keeps/going/and/going/for/a/while/and/another/file/name/that/is/long.ts`,
			`echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC`,
		];
		for (const input of corpus) {
			const painted = validateBashPaint(input, paintBashBatch(tokenizeBashBatch(input), palette));
			expect(painted).toBeDefined();
			const accent = catTheme.fg("accent", input);
			let artifactCases = 0;
			let accentArtifact = false;
			for (let width = 10; width <= 200; width++) {
				const plain = new Text(input, 0, 0).render(width).map(strip);
				const coloredRows = new Text(painted as string, 0, 0).render(width).map(strip);
				const accentRows = new Text(accent, 0, 0).render(width).map(strip);
				// Only whitespace-only rows may be inserted/removed; visible text and order match.
				expect(coloredRows.filter((row) => row.trim() !== "")).toEqual(plain);
				expect(accentRows.filter((row) => row.trim() !== "")).toEqual(plain);
				if (coloredRows.length !== plain.length) {
					artifactCases++;
					for (const row of coloredRows) {
						if (!plain.includes(row)) expect(row.trim()).toBe("");
					}
				}
				if (accentRows.length !== plain.length) accentArtifact = true;
			}
			// Any row-count delta must be the upstream artifact class, shared with the
			// accent row, and every extra row must be whitespace-only.
			if (artifactCases > 0) expect(accentArtifact).toBe(true);
		}
	});
	it("bounds a painted row's ANSI spans and its host setText+render cost", () => {
		// A running command calls setText on every spinner tick and every output update, so
		// the painted row's span count is a per-repaint cost the host pays. The semantic
		// painter caps it deterministically, which keeps ANSI-aware wrapping close to the
		// legacy accent row instead of the ~330-span blowup a flag-dense 2 KB row used to
		// produce (that was ~2.8x the legacy wrap cost).
		const palette = resolveBashPalette(catTheme);
		const rows = [
			`git log --oneline --all --decorate --graph --simplify-by-decoration && rg -n 'toolDisplay|presentation' extensions/zentui/tool-display --glob '*.ts'`,
			`echo ${"a/b ".repeat(400)}`,
		];
		const measure = (text: string): number => {
			const target = new Text("", 0, 0);
			const start = performance.now();
			for (let tick = 0; tick < 20; tick++) {
				target.setText(text);
				target.render(120);
			}
			return (performance.now() - start) / 20;
		};
		for (const input of rows) {
			const painted = paintBashBatch(tokenizeBashBatch(input), palette);
			expect(strip(painted)).toBe(input);
			const spans = (painted.match(/\x1b\[[0-9;]*m/g) ?? []).length;
			expect(spans).toBeLessThanOrEqual(96);
			// Warm both paths, then compare the painted host wrap cost to the plain row.
			measure(painted);
			measure(input);
			const paintedCost = measure(painted);
			const plainCost = measure(input);
			expect(paintedCost).toBeLessThan(plainCost * 6);
		}
	});
	it("keeps semantic colors on CRLF rows and never splits a CRLF pair with an SGR", () => {
		const inputs = [
			`cat <<'EOF'\r\nhello $x\r\nEOF\r\necho done`,
			"echo \\\r\n  continued",
			"printf 'a\r\nb'",
			'echo "a\r\nb"',
		];
		for (const input of inputs) {
			const progress = createBashProgress(undefined, { getMode: () => "semantic" });
			const rows = progress.renderCall({ command: input }, catTheme, ctx()).render(200);
			const painted = rows.map(strip).join("\n");
			expect(painted).not.toContain("\r\x1b");
			expect(rows.join("")).not.toMatch(/\r\x1b\[[0-9;]*m\n/);
			progress.dispose();
		}
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		const recolored = progress
			.renderCall({ command: "cat <<'EOF'\r\nhello $x\r\nEOF\r\necho done" }, catTheme, ctx())
			.render(200)
			.join("");
		// Not the plain accent fallback: multiple role openings survived.
		expect(new Set(recolored.match(/\x1b\[38;2;\d+;\d+;\d+m/g)).size).toBeGreaterThan(2);
		progress.dispose();
	});
	it("keeps every visible byte of 12K-16K dense commands without partial escapes", () => {
		for (const length of [12_000, 16_384]) {
			// Short flags maximize color runs and ANSI expansion.
			const input = `${"-f ".repeat(Math.ceil(length / 3)).slice(0, length - 1)}z`;
			const progress = createBashProgress(undefined, { getMode: () => "semantic" });
			const rows = progress.renderCall({ command: input }, catTheme, ctx()).render(120);
			const visible = rows.map(strip).join("");
			expect(visible.replace(/^\$ /, "").replace(/\s/g, "")).toBe(input.replace(/\s/g, ""));
			expect(visible).not.toContain("omitted");
			for (const row of rows) expect(row).not.toMatch(/\x1b\[[0-9;]*$/);
			// Even an alternating-role row (a maximal span count) survives intact.
			const dense = `${"a;".repeat(Math.ceil(length / 2)).slice(0, length - 1)}z`;
			const denseRows = progress
				.renderCall({ command: dense }, catTheme, ctx())
				.render(120)
				.map(strip)
				.join("");
			expect(denseRows.replace(/^\$ /, "").replace(/\s/g, "")).toBe(dense);
			progress.dispose();
		}
	});
	it("repaints once on theme revision while surviving tokens, and probes colors-less themes", () => {
		const tokenize = vi.fn((text: string) => tokenizeBashBatch(text));
		const paint = vi.fn((batch: BashTokenBatch, palette: BashPalette) =>
			paintBashBatch(batch, palette),
		);
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize,
			paint,
		});
		const first = progress.renderCall({ command }, catTheme, ctx()).render(120);
		expect([tokenize.mock.calls.length, paint.mock.calls.length]).toEqual([1, 1]);
		expect(progress.renderCall({ command }, catTheme, ctx()).render(120)).toEqual(first);
		expect([tokenize.mock.calls.length, paint.mock.calls.length]).toEqual([1, 1]);
		const night = tokenTheme(NIGHT);
		expect(progress.renderCall({ command }, night, ctx()).render(120)).not.toEqual(first);
		expect([tokenize.mock.calls.length, paint.mock.calls.length]).toEqual([1, 2]);
		progress.renderCall({ command }, night, ctx());
		expect([tokenize.mock.calls.length, paint.mock.calls.length]).toEqual([1, 2]);
		progress.dispose();

		// Hosts without theme.colors re-sample only the tokens the row actually uses.
		let alternate = false;
		const sampled = tokenTheme(CATPPUCCIN, {
			withColors: false,
			colorMap: () => (alternate ? NIGHT : CATPPUCCIN),
		});
		const fallbackPaint = vi.fn((batch: BashTokenBatch, palette: BashPalette) =>
			paintBashBatch(batch, palette),
		);
		const fallback = createBashProgress(undefined, {
			getMode: () => "semantic",
			paint: fallbackPaint,
		});
		fallback.renderCall({ command }, sampled, ctx());
		fallback.renderCall({ command }, sampled, ctx());
		expect(fallbackPaint).toHaveBeenCalledTimes(1);
		alternate = true;
		fallback.renderCall({ command }, sampled, ctx());
		expect(fallbackPaint).toHaveBeenCalledTimes(2);
		fallback.dispose();
	});
	it.each(["/bin/fish", "/bin/zsh", "cmd.exe", "pwsh", "/custom/shell", 42, {}, false, null])(
		"never tokenizes or paints a non-Bash shell: %j",
		(shellPath) => {
			const tokenize = vi.fn((text: string) => tokenizeBashBatch(text));
			const progress = createBashProgress(null, { getMode: () => "semantic", tokenize });
			const rows = progress
				.renderCall({ command, shellPath: shellPath as string }, catTheme, ctx())
				.render(80);
			expect(tokenize).not.toHaveBeenCalled();
			const suffix =
				typeof shellPath === "string" && shellPath !== "cmd.exe"
					? catTheme.fg("muted", ` [shell: ${shellPath}]`)
					: "";
			const expected = new Text(
				`${catTheme.fg("toolTitle", catTheme.bold("$"))} ${catTheme.fg("accent", command)}${suffix}`,
				0,
				0,
			);
			expect(rows).toEqual(expected.render(80));
			progress.dispose();
		},
	);
	it("sanitizes and caps raw commands/prefixes before tokenizing", () => {
		const tokenize = vi.fn((text: string) => tokenizeBashBatch(text));
		const progress = createBashProgress(null, { getMode: () => "semantic", tokenize });
		const renderer = createToolDisplayRenderers(
			"bash",
			() => normalizeToolDisplayConfig({ enabled: true }),
			{ progress },
		);
		const args = {
			command: `echo \x1b]0;attack\x07\x1b[2J${"界".repeat(MAX_PREVIEW_LINE_CHARS + 100)}`,
			commandPrefix: "env\x07",
		};
		const source = `env echo \x1b]0;attack\x07\x1b[2J${"界".repeat(MAX_PREVIEW_LINE_CHARS + 100)}`;
		const rows = renderer.renderCall?.(args, catTheme as Theme, ctx(args)).render(80) ?? [];
		expect(tokenize).toHaveBeenCalledTimes(1);
		const sanitized = tokenize.mock.calls[0][0];
		expect(sanitized).not.toMatch(/[\x00-\x08\x1b\x7f-\x9f]/);
		expect(sanitized.length).toBeLessThanOrEqual(MAX_PREVIEW_LINE_CHARS + 32);
		expect(source.length).toBeGreaterThan(sanitized.length);
		expect(rows.map(strip).join("\n")).toContain("preview capped");
		progress.dispose();
	});
	it.each(["echo\u00a0hello", "echo\u2003hello", "echo \u0301hello", "echo\n \u0301hello"])(
		"preserves Unicode whitespace and graphemes after semantic SGR placement: %s",
		(input) => {
			const progress = createBashProgress(undefined, { getMode: () => "semantic" });
			const row = progress.renderCall({ command: input }, catTheme, ctx());
			const old = accentText(catTheme, input);
			for (let width = 3; width <= 20; width++) {
				expect(row.render(width).map(strip)).toEqual(old.render(width).map(strip));
				expect(row.render(width).map(visibleWidth)).toEqual(old.render(width).map(visibleWidth));
			}
			expect(row.render(1000).join("\n")).not.toMatch(/ (?:\x1b\[[0-9;]*m)+\u0301/u);
			progress.dispose();
		},
	);
	it("rejects syntax ANSI inside a grapheme", () => {
		const source = "echo é 👩‍💻";
		const progress = createBashProgress(null, {
			getMode: () => "semantic",
			paint: (batch) => batch.source.replace("é", "e\x1b[31ḿ"),
		});
		expect(progress.renderCall({ command: source }, catTheme, ctx()).render(7)).toEqual(
			accentText(catTheme, source).render(7),
		);
		progress.dispose();
	});
	it("keeps semantic colors when the public highlighter is missing", () => {
		const progress = createBashProgress(null, { getMode: () => "semantic" });
		const rows = progress.renderCall({ command }, catTheme, ctx()).render(120);
		expect(strip(rows.join("\n")).trimEnd()).toBe(`$ ${command}`);
		expect(rows.join("")).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
		progress.dispose();
	});
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
	])("falls back byte-for-byte in pi mode for invalid/throwing highlighting", (highlight) => {
		const progress = createBashProgress(highlight, { getMode: () => "pi" });
		expect(progress.renderCall({ command }, flatTheme, ctx()).render(80)).toEqual(
			accentText(flatTheme, command).render(80),
		);
		progress.dispose();
	});
	it("retains pi highlights on paints/ticks, refreshes command and live palette, disposes timers", () => {
		vi.useFakeTimers();
		const highlight = vi.fn((text: string) => [`\x1b[31m${text}\x1b[39m`]);
		const progress = createBashProgress(highlight, { getMode: () => "pi" });
		let color = 36;
		const proxy = {
			...flatTheme,
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
	it("retains semantic paints on ticks while a live mode change clears painted rows", () => {
		vi.useFakeTimers();
		let mode: "semantic" | "pi" = "semantic";
		const tokenize = vi.fn((text: string) => tokenizeBashBatch(text));
		const paint = vi.fn((batch: BashTokenBatch, palette: BashPalette) =>
			paintBashBatch(batch, palette),
		);
		const highlight = vi.fn((text: string) => [`\x1b[31m${text}\x1b[39m`]);
		const progress = createBashProgress(highlight, {
			getMode: () => mode,
			tokenize,
			paint,
		});
		const context = { ...ctx(), executionStarted: true, isPartial: true, invalidate: vi.fn() };
		const row = progress.renderCall({ command }, catTheme, context);
		progress.renderCall({ command }, catTheme, { ...context, lastComponent: row });
		vi.advanceTimersByTime(1200);
		expect([tokenize.mock.calls.length, paint.mock.calls.length]).toEqual([1, 1]);
		mode = "pi";
		vi.advanceTimersByTime(200);
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(tokenize).toHaveBeenCalledTimes(1);
		mode = "semantic";
		vi.advanceTimersByTime(200);
		// Mode revision clears painted rows; tokenized text survives.
		expect(paint).toHaveBeenCalledTimes(2);
		expect(tokenize).toHaveBeenCalledTimes(1);
		progress.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});
