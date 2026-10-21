import { describe, expect, it, vi } from "vitest";
import {
	BASH_CACHE_MAX_ENTRIES,
	BASH_TOKEN_CACHE_BYTES,
	createBashProgress,
	validateBashPaint,
} from "../extensions/zentui/tool-display/bash-display.js";
import {
	type BashPalette,
	type BashTokenBatch,
	paintBashBatch,
	tokenizeBashBatch,
} from "../extensions/zentui/tool-display/bash-highlight.js";

const COLORS: Record<string, string> = {
	text: "#cdd6f4",
	muted: "#a6adc8",
	dim: "#7f849c",
	accent: "#89b4fa",
	success: "#a6e3a1",
	warning: "#f9e2af",
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
function openSgr(hex: string): string {
	const [r, g, b] = [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
	return `\x1b[38;2;${r};${g};${b}m`;
}
const theme = {
	colors: Object.freeze({ ...COLORS }),
	getColorMode: () => "truecolor",
	fg(token: string, text: string) {
		const hex = COLORS[token];
		return hex ? `${openSgr(hex)}${text}\x1b[39m` : text;
	},
	bold: (text: string) => text,
};
const night = {
	...theme,
	colors: Object.freeze({ ...COLORS, success: "#68b78d", accent: "#a798d7" }),
};
function counters() {
	return {
		tokenize: vi.fn((text: string) => tokenizeBashBatch(text)),
		paint: vi.fn((batch: BashTokenBatch, palette: BashPalette) => paintBashBatch(batch, palette)),
		validate: vi.fn((display: string, painted: string) => validateBashPaint(display, painted)),
	};
}

const context = (toolCallId: string) => ({
	executionStarted: false,
	isPartial: false,
	toolCallId,
	state: {},
	invalidate() {},
});
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const command = `git commit -m "msg"`;
const commands = (count: number, index = 0) =>
	Array.from(
		{ length: count },
		(_, offset) => `echo value-${index + offset} && printf '%s\\n' "${index + offset}" | wc -l`,
	);
/** Realistic ~2 KB commands, each distinct, to exercise the byte budgets. */
const LONG_UNIT = `git commit -m "feat: add semantic bash highlighting" && rg -n 'toolDisplay|presentation' extensions/zentui/tool-display --glob '*.ts' | head -50 && find . -name "*.ts" -not -path './node_modules/*' -exec rm -f {} + 2>/dev/null ; curl -sS -X POST --data '{"a":1,"b":2}' https://x.dev/api/v1/items?page=2 | jq -r '.items[] | .name' >> /tmp/items.json && echo done`;
/** ~2 KB rows: the cache budget is stated for these, not for short rows. */
const longCommands = (count: number, index = 0) =>
	Array.from({ length: count }, (_, offset) => {
		let text = LONG_UNIT;
		while (text.length < 2000) text += ` ${LONG_UNIT}`;
		return `${text.slice(0, 1990)} #${String(index + offset).padStart(6, "0")}`;
	});

describe("bash-display long-session caches", () => {
	it("builds the ~2 KB fixture the cache budgets are stated for", () => {
		const [row] = longCommands(1);
		expect(row.length).toBeGreaterThanOrEqual(1990);
		expect(row.length).toBeLessThanOrEqual(2000);
	});
	it("renders 300 distinct commands once and re-renders them without re-tokenizing", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const list = commands(300);
		const first = new Map<string, string>();
		for (const command of list) {
			first.set(
				command,
				progress.renderCall({ command }, theme, context(command)).render(120).join("\n"),
			);
		}
		expect(calls.tokenize).toHaveBeenCalledTimes(300);
		expect(calls.paint).toHaveBeenCalledTimes(300);
		expect(calls.validate).toHaveBeenCalledTimes(300);
		// Scroll, resize, and host invalidate all hit the painted cache.
		for (const command of list) {
			for (const width of [33, 120, 200]) {
				const rows = progress.renderCall({ command }, theme, context(command)).render(width);
				expect(strip(rows.join("")).replace(/\s+/g, " ")).toContain("$ echo value-");
			}
		}
		expect(calls.tokenize).toHaveBeenCalledTimes(300);
		expect(calls.paint).toHaveBeenCalledTimes(300);
		expect(calls.validate).toHaveBeenCalledTimes(300);
		for (const command of list.slice(0, 20)) {
			expect(progress.renderCall({ command }, theme, context(command)).render(120).join("\n")).toBe(
				first.get(command),
			);
		}
		progress.dispose();
	});

	it("keeps a partially warm window on a sequential rescan instead of thrashing to 0%", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		// More distinct ~2 KB rows than either byte budget can hold.
		const list = longCommands(1000);
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		expect(calls.tokenize).toHaveBeenCalledTimes(1000);
		// Scroll back to the start (the leading rows were never admitted), then scan
		// forward again. Sampled eviction plus second-touch admission keep a partially warm
		// window: strict LRU repaints all 1000 rows because every miss evicts exactly the
		// row the scan needs next, and admitting every miss would do the same.
		calls.paint.mockClear();
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		const repainted = calls.paint.mock.calls.length;
		expect(repainted).toBeGreaterThan(0);
		expect(repainted).toBeLessThan(900);
		// The retained window also survives the scan: re-rendering the tail again after a
		// full pass is still (mostly) a cache hit.
		calls.paint.mockClear();
		for (const command of list.slice(-100)) {
			progress.renderCall({ command }, theme, context(command));
		}
		expect(calls.paint.mock.calls.length).toBeLessThan(100);
		progress.dispose();
	});

	it("never admits streaming partial commands into the session caches", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const completed = commands(40);
		for (const command of completed) progress.renderCall({ command }, theme, context(command));
		expect(calls.tokenize).toHaveBeenCalledTimes(40);
		const big = `echo ${"a/b ".repeat(4000)}`;
		for (let length = 50; length <= big.length; length += 50) {
			progress.renderCall({ command: big.slice(0, length) }, theme, {
				...context("stream"),
				executionStarted: true,
				isPartial: true,
				argsComplete: false,
			});
		}
		// Every completed row still hits the painted cache: streaming only used the
		// one-row transient slot.
		calls.tokenize.mockClear();
		calls.paint.mockClear();
		for (const command of completed) progress.renderCall({ command }, theme, context(command));
		expect(calls.tokenize).not.toHaveBeenCalled();
		expect(calls.paint).not.toHaveBeenCalled();
		progress.dispose();
	});

	it("does not admit a streaming row before execution starts", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const completed = commands(20);
		for (const command of completed) progress.renderCall({ command }, theme, context(command));
		expect(calls.tokenize).toHaveBeenCalledTimes(20);
		const streaming = {
			...context("args"),
			executionStarted: false,
			isPartial: true,
			argsComplete: false,
		};
		for (let length = 20; length <= 4000; length += 20) {
			progress.renderCall(
				{ command: `echo ${"a/b ".repeat(1000)}`.slice(0, length) },
				theme,
				streaming,
			);
		}
		calls.tokenize.mockClear();
		calls.paint.mockClear();
		for (const command of completed) progress.renderCall({ command }, theme, context(command));
		expect(calls.tokenize).not.toHaveBeenCalled();
		expect(calls.paint).not.toHaveBeenCalled();
		progress.dispose();
	});

	it("keeps spinner ticks on a streaming row to one paint", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const streaming = {
			...context("tick"),
			executionStarted: true,
			isPartial: true,
			argsComplete: false,
		};
		const growing = `printf '%s\\n' "${"界".repeat(200)}`;
		progress.renderCall({ command: growing }, theme, streaming);
		for (let tick = 0; tick < 20; tick++) {
			progress.renderCall({ command: growing }, theme, streaming);
		}
		expect(calls.tokenize).toHaveBeenCalledTimes(1);
		expect(calls.paint).toHaveBeenCalledTimes(1);
		progress.dispose();
	});

	it("bounds the token budget on rows far larger than a session slot", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		// Rows deliberately far larger than a session slot: 300 x 16 KB cannot fit either
		// the 2 MiB packed-token budget or the 8 MiB painted budget, so a re-render has to
		// re-tokenize some rows while the resident window keeps the rest warm.
		const filler = "a".repeat(16_000);
		const count = 300;
		expect(count * (filler.length + 90)).toBeGreaterThan(BASH_TOKEN_CACHE_BYTES);
		for (let index = 0; index < count; index++) {
			progress.renderCall({ command: `echo ${filler}${index}` }, theme, context(`f${index}`));
		}
		expect(calls.tokenize).toHaveBeenCalledTimes(count);
		// The budget cannot hold every row, so re-rendering all of them must re-tokenize
		// some rows; the resident window keeps the rest warm.
		calls.tokenize.mockClear();
		for (let index = 0; index < count; index++) {
			progress.renderCall({ command: `echo ${filler}${index}` }, theme, context(`f${index}`));
		}
		const missed = calls.tokenize.mock.calls.length;
		expect(missed).toBeGreaterThan(0);
		expect(missed).toBeLessThan(count);
		progress.dispose();
	});

	it("caps both caches at 512 entries", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const total = BASH_CACHE_MAX_ENTRIES + 8;
		for (let index = 0; index < total; index++) {
			const command = `echo entry-${index}`;
			progress.renderCall({ command }, theme, context(`c${index}`));
		}
		expect(calls.tokenize).toHaveBeenCalledTimes(total);
		for (let index = 0; index < total; index++) {
			progress.renderCall({ command: `echo entry-${index}` }, theme, context(`c${index}`));
		}
		// At most 512 of the 520 distinct rows can be resident, so a full re-render must
		// miss at least 8 times; it must also hit (the cache is not cleared wholesale).
		const misses = calls.tokenize.mock.calls.length - total;
		expect(misses).toBeGreaterThanOrEqual(total - BASH_CACHE_MAX_ENTRIES);
		expect(misses).toBeLessThan(total);
		progress.dispose();
	});

	it("repaints every row once on a theme revision without re-tokenizing", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const list = commands(40);
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		expect(calls.tokenize).toHaveBeenCalledTimes(40);
		expect(calls.paint).toHaveBeenCalledTimes(40);
		for (const command of list) progress.renderCall({ command }, night, context(command));
		expect(calls.tokenize).toHaveBeenCalledTimes(40);
		expect(calls.paint).toHaveBeenCalledTimes(80);
		for (const command of list) progress.renderCall({ command }, night, context(command));
		expect(calls.paint).toHaveBeenCalledTimes(80);
		progress.dispose();
	});

	it("keeps tokens across a live mode change but clears painted rows", () => {
		let mode: "semantic" | "pi" = "semantic";
		const calls = counters();
		const highlight = vi.fn((text: string) => [text]);
		const progress = createBashProgress(highlight, {
			getMode: () => mode,
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const list = commands(10);
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		expect([calls.tokenize.mock.calls.length, calls.paint.mock.calls.length]).toEqual([10, 10]);
		mode = "pi";
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		expect(highlight).toHaveBeenCalledTimes(10);
		expect(calls.tokenize).toHaveBeenCalledTimes(10);
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		expect(highlight).toHaveBeenCalledTimes(10);
		mode = "semantic";
		for (const command of list) progress.renderCall({ command }, theme, context(command));
		expect(calls.paint).toHaveBeenCalledTimes(20);
		expect(calls.tokenize).toHaveBeenCalledTimes(10);
		progress.dispose();
	});

	it("does not tokenize, paint, or validate on a warm cache hit", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		progress.renderCall({ command }, theme, context("warm"));
		const warm = calls.tokenize.mock.calls.length;
		for (let paint = 0; paint < 50; paint++) {
			progress.renderCall({ command }, theme, context("warm")).render(80 + paint);
		}
		expect(calls.tokenize).toHaveBeenCalledTimes(warm);
		expect(calls.paint).toHaveBeenCalledTimes(warm);
		expect(calls.validate).toHaveBeenCalledTimes(warm);
		progress.dispose();
	});

	it("keys semantic warm hits on the command instead of hashing a prefixed copy", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		const args = { command, commandPrefix: "user@host:~/project$" };
		progress.renderCall(args, theme, context("prefix"));
		expect(calls.tokenize).toHaveBeenCalledTimes(1);
		for (let paint = 0; paint < 20; paint++) progress.renderCall(args, theme, context("prefix"));
		expect(calls.tokenize).toHaveBeenCalledTimes(1);
		expect(calls.paint).toHaveBeenCalledTimes(1);
		progress.dispose();
	});

	it("clears both caches on dispose", () => {
		const calls = counters();
		const progress = createBashProgress(undefined, {
			getMode: () => "semantic",
			tokenize: calls.tokenize,
			paint: calls.paint,
			validate: calls.validate,
		});
		progress.renderCall({ command }, theme, context("dispose"));
		progress.renderCall({ command }, theme, context("dispose"));
		expect([calls.tokenize.mock.calls.length, calls.paint.mock.calls.length]).toEqual([1, 1]);
		progress.dispose();
		progress.renderCall({ command }, theme, context("dispose"));
		expect([calls.tokenize.mock.calls.length, calls.paint.mock.calls.length]).toEqual([2, 2]);
		progress.dispose();
	});
});
