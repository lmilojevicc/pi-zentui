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
	it("paints the real command after a multi-part assignment value", () => {
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		for (const [input, verb] of [
			[`PATH=$PATH:/usr/local/go/bin go build`, "go"],
			[`PYTHONPATH=. pytest -q`, "pytest"],
		] as const) {
			const row = progress.renderCall({ command: input }, catTheme, ctx()).render(200).join("");
			expect(paintedWord(row, verb, openSgr("#a6e3a1"))).toBe(true);
			expect(strip(row)).toContain(input);
		}
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
	it("fails open on the command alone so a prefix is printed exactly once", () => {
		// No role resolves a color and the host highlighter sees the command only: the
		// accent fallback is deterministic and the muted prefix is prepended once.
		const monochrome = { fg: (_token: string, text: string) => text, bold: (text: string) => text };
		const highlight = vi.fn((text: string) => [text]);
		const progress = createBashProgress(highlight, { getMode: () => "semantic" });
		const render = (commandPrefix: string) =>
			progress
				.renderCall({ command: "git status", commandPrefix }, monochrome, ctx())
				.render(80)
				.map((row) => strip(row).trimEnd())
				.join("");
		expect(render("PS>")).toBe("$ PS> git status");
		// A different prefix on the same command must not reuse the previous prefix.
		expect(render("ALICE>")).toBe("$ ALICE> git status");
		expect(render("PS>")).toBe("$ PS> git status");
		// The semantic painted cache is keyed by the command, so only the cold row painted.
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(highlight).toHaveBeenCalledWith("git status");
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
	it("keeps a real blank line in pi mode while dropping only the wrap artifact", () => {
		const highlight = (text: string) => text.split("\n").map((line) => `\x1b[31m${line}\x1b[39m`);
		const progress = createBashProgress(highlight, { getMode: () => "pi" });
		const input = `git commit -m 'Subject line\n\nLong body\n\nFooter'`;
		const old = new Text(
			`${flatTheme.fg("toolTitle", flatTheme.bold("$"))} ${flatTheme.fg("accent", highlight(input).join("\n"))}`,
			0,
			0,
		);
		const row = progress.renderCall({ command: input }, flatTheme, ctx());
		const plain = new PresentationText(`$ ${input}`, 0, 0);
		let droppedArtifacts = 0;
		for (let width = 3; width <= 60; width++) {
			const native = old.render(width);
			const rows = row.render(width);
			const plainRows = plain.render(width);
			// The explicit blank lines survive with the uncolored row's geometry.
			expect(rows.map(strip)).toEqual(plainRows.map(strip));
			expect(rows.map(visibleWidth)).toEqual(plainRows.map(visibleWidth));
			const blank = (line: string) => strip(line).trim() === "";
			const plainBlank = plainRows.filter(blank).length;
			const rowBlank = rows.filter(blank).length;
			const nativeBlank = native.filter(blank).length;
			// Every blank row of the uncolored row is kept; the native colored row can only
			// add zero-width artifacts, and those are exactly the rows the component drops.
			expect(rowBlank).toBe(plainBlank);
			expect(native.length - rows.length).toBe(nativeBlank - rowBlank);
			droppedArtifacts += nativeBlank - rowBlank;
		}
		expect(droppedArtifacts).toBeGreaterThan(0);
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
	it.each([
		`git commit -m 'Subject line\n\nLong body\n\nFooter'`,
		`cat <<'EOF' > notes.txt\nfirst\n\n${"x".repeat(26)} ${"y".repeat(26)}\nEOF`,
		`printf 'a\n\nb'\n\necho ${"x".repeat(10)}`,
		`echo\n\n${"x".repeat(26)} ${"y".repeat(26)}`,
		`\t'q' && ls`,
		`\tgit status`,
		`   echo hi`,
	])("keeps wrap geometry on narrow rows without an extra blank line: %j", (input) => {
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		const row = progress.renderCall({ command: input }, catTheme, ctx());
		// Stripped comparison: a kept real blank row is a padded escape-only row, not "".
		const plain = new PresentationText(`$ ${input}`, 0, 0);
		for (let width = 1; width <= 60; width++) {
			const rows = row.render(width);
			expect(rows.map(strip)).toEqual(plain.render(width).map(strip));
			expect(rows.map(visibleWidth)).toEqual(plain.render(width).map(visibleWidth));
		}
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
	it("returns a budget-closed tail to the terminal default", () => {
		const palette = resolveBashPalette(catTheme);
		const input = "x;".repeat(1000);
		const painted = paintBashBatch(tokenizeBashBatch(input), palette);
		expect(strip(painted)).toBe(input);
		// Simulate the SGR stream: the visible bytes emitted while a foreground is open
		// must stay bounded, and the tail after the final reset must be at the default.
		let active = false;
		let escapes = 0;
		let openVisible = 0;
		let lastReset = -1;
		for (let index = 0; index < painted.length; ) {
			if (painted.charCodeAt(index) === 27) {
				const match = /^\x1b\[([0-9;]*)m/.exec(painted.slice(index));
				if (!match) throw new Error("unexpected escape");
				escapes++;
				if (match[1] === "39") {
					active = false;
					lastReset = index;
				} else active = true;
				index += match[0].length;
				continue;
			}
			if (active) openVisible++;
			index++;
		}
		expect(openVisible).toBeLessThanOrEqual(100);
		// The budget stops before an opener it cannot close, so the row carries no
		// zero-width opener/reset pair and every opener is matched by one close.
		const openings = (painted.match(/\x1b\[38;[0-9;]*m/g) ?? []).length;
		expect(openings).toBeLessThanOrEqual(96);
		expect(escapes).toBe(openings * 2);
		expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m\x1b\[39m/);
		expect(painted.length - (lastReset + 5)).toBeGreaterThan(500);
		expect(painted.slice(lastReset + 5)).not.toMatch(/\x1b/);
		expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m[ \t\n]/);
		expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m$/);
	});
	it("keeps degraded whitespace-dense rows wrap-identical and free of pre-whitespace SGR", () => {
		// The span budget stops painting part-way through a long row. Its closing reset must
		// still land on a visible byte: an escape directly before a space is attached to that
		// whitespace token by pi-tui and shifts the wrap geometry.
		const palette = resolveBashPalette(catTheme);
		const input = 'if [ "s" ] ; then echo 1 $x ; fi ; '.repeat(200);
		const painted = paintBashBatch(tokenizeBashBatch(input), palette);
		expect(strip(painted)).toBe(input);
		expect(painted).not.toMatch(/\x1b\[39m[ \t\n]/);
		expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m[ \t\n]/);
		expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m\x1b\[39m/);
		const progress = createBashProgress(undefined, { getMode: () => "semantic" });
		const row = progress.renderCall({ command: input }, catTheme, ctx());
		const plain = new PresentationText(`$ ${input}`, 0, 0);
		for (let width = 10; width <= 200; width++) {
			expect(row.render(width).map(strip)).toEqual(plain.render(width).map(strip));
			expect(row.render(width).map(visibleWidth)).toEqual(plain.render(width).map(visibleWidth));
		}
		progress.dispose();
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
	it.each(["ls \u00a0 foo bar", "ls \u3000 foo bar", "ls \u2003 foo bar baz", "echo a\u00a0b c d"])(
		"keeps pi-tui's whitespace definition for %j",
		(input) => {
			const progress = createBashProgress(undefined, { getMode: () => "semantic" });
			const row = progress.renderCall({ command: input }, catTheme, ctx());
			const plain = new PresentationText(`$ ${input}`, 0, 0);
			for (let width = 3; width <= 40; width++) {
				const rows = row.render(width);
				expect(rows.map(strip)).toEqual(plain.render(width).map(strip));
				expect(rows.map(visibleWidth)).toEqual(plain.render(width).map(visibleWidth));
			}
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
	it("never tokenizes a command that already carries raw SGR", () => {
		const tokenize = vi.fn((text: string) => tokenizeBashBatch(text));
		const progress = createBashProgress(null, { getMode: () => "semantic", tokenize });
		const input = `echo \x1b[1;31mERROR\x1b[0m: build failed && make test`;
		const rows = progress.renderCall({ command: input }, catTheme, ctx()).render(200);
		const row = rows.join("\n");
		expect(tokenize).not.toHaveBeenCalled();
		// The raw sequence stays contiguous: no role SGR is inserted inside it.
		expect(row).toContain("\x1b[1;31mERROR");
		expect(row).not.toMatch(/\x1b\[1\x1b\[/);
		expect(rows.map((line) => strip(line).trimEnd()).join("")).toBe(`$ ${strip(input).trimEnd()}`);
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
		// Channel 258 used to pass the loose strip filter; only 0..255 is a foreground color.
		(text: string) => [`\x1b[38;5;258m${text}\x1b[39m`],
		(text: string) => [`${text}changed`],
		(text: string) => [`${"\x1b[31m".repeat(10000)}${text}`],
	])("falls back byte-for-byte in pi mode for invalid/throwing highlighting", (highlight) => {
		const progress = createBashProgress(highlight, { getMode: () => "pi" });
		expect(progress.renderCall({ command }, flatTheme, ctx()).render(80)).toEqual(
			accentText(flatTheme, command).render(80),
		);
		progress.dispose();
	});
	it.each([
		{ name: "message_end executing rows", argsComplete: true },
		{ name: "tool_execution_start rows", argsComplete: false },
	])("admits each executing row once instead of repainting every tick ($name)", (spec) => {
		vi.useFakeTimers();
		try {
			const tokenize = vi.fn((text: string) => tokenizeBashBatch(text));
			const paint = vi.fn((batch: BashTokenBatch, palette: BashPalette) =>
				paintBashBatch(batch, palette),
			);
			const validate = vi.fn((display: string, painted: string) =>
				validateBashPaint(display, painted),
			);
			const progress = createBashProgress(undefined, {
				getMode: () => "semantic",
				tokenize,
				paint,
				validate,
			});
			const streaming = (suffix: string) => {
				const context = {
					...ctx(),
					toolCallId: `tick-${suffix}`,
					state: {},
					executionStarted: true,
					isPartial: true,
					argsComplete: spec.argsComplete,
					invalidate: vi.fn(),
				};
				return { context, command: `printf '%s\\n' "${"界".repeat(200)}${suffix}"` };
			};
			const rows = [streaming("one"), streaming("two")];
			let components = rows.map((row) =>
				progress.renderCall({ command: row.command }, catTheme, row.context),
			);
			for (let tick = 0; tick < 10; tick++) {
				vi.advanceTimersByTime(200);
				components = rows.map((row, index) =>
					progress.renderCall({ command: row.command }, catTheme, {
						...row.context,
						lastComponent: components[index],
					}),
				);
			}
			// One paint per row for the whole spinner run, not one per tick and row.
			expect([
				tokenize.mock.calls.length,
				paint.mock.calls.length,
				validate.mock.calls.length,
			]).toEqual([2, 2, 2]);
			expect(vi.getTimerCount()).toBe(2);
			progress.dispose();
			expect(vi.getTimerCount()).toBe(0);

			// The pi path is admitted the same way: ticks do not call the host highlighter.
			const highlight = vi.fn((text: string) => [`\x1b[31m${text}\x1b[39m`]);
			const piProgress = createBashProgress(highlight, { getMode: () => "pi" });
			const piRows = [streaming("one"), streaming("two")];
			let piComponents = piRows.map((row) =>
				piProgress.renderCall({ command: row.command }, catTheme, row.context),
			);
			for (let tick = 0; tick < 10; tick++) {
				vi.advanceTimersByTime(200);
				piComponents = piRows.map((row, index) =>
					piProgress.renderCall({ command: row.command }, catTheme, {
						...row.context,
						lastComponent: piComponents[index],
					}),
				);
			}
			expect(highlight).toHaveBeenCalledTimes(2);
			piProgress.dispose();
		} finally {
			vi.useRealTimers();
		}
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
