/* Adapted from pi-tool-display 0.5.0, commit91cef7580078371f8dc49a8607222807ad6a424d.
 * MIT License
 *
 * Copyright (c) 2026 MasuRii
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
	type BashPalette,
	type BashPaletteTheme,
	type BashTokenBatch,
	bashThemeSignature,
	paintBashBatch,
	resolveBashPalette,
	tokenizeBashBatch,
} from "./bash-highlight.ts";
import { bashCommandHighlighter } from "./host.ts";
import { PresentationText as Text } from "./presentation-text.ts";
import type { BashSyntaxMode } from "./types.ts";

const BASH_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BASH_SPINNER_INTERVAL_MS = 200;
const BASH_SPINNER_STATE_KEY = "__piToolDisplayBashSpinner";
const BASH_SPINNER_TOOL_CALL_ID_KEY = "__piToolDisplayBashSpinnerToolCallId";

/**
 * Session-stable byte budgets: 2 MiB of packed token text, 8 MiB of painted ANSI, and a
 * 2048-entry cap. The painted budget is the one that decides whether scrolling back
 * re-tokenizes: a 2 KB command paints to roughly 4.2 KB (≈8.6 KB charged), so 8 MiB holds
 * about a thousand of them, and several thousand ordinary short commands. Measured heap
 * runs ≈1.3x the charge, so the pair tops out near 13 MiB and is fully released on dispose.
 */
export const BASH_TOKEN_CACHE_BYTES = 2_097_152;
export const BASH_PAINTED_CACHE_BYTES = 8_388_608;
export const BASH_CACHE_MAX_ENTRIES = 2048;

interface BashCallArgs {
	command?: string;
	commandPrefix?: string;
	shellPath?: string;
	timeout?: number;
}

export interface BashCallRenderTheme extends BashPaletteTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
	readonly colors?: object;
	getColorMode?(): string;
	getFgAnsi?(color: string): string;
}

interface BashSpinnerState {
	target?: {
		text: Text;
		args: BashCallArgs;
		theme: BashCallRenderTheme;
		invalidate?: () => void;
	};
	frameIndex: number;
	startedAt?: number;
	timer?: ReturnType<typeof setInterval>;
}

interface BashSpinnerStateCarrier {
	[BASH_SPINNER_STATE_KEY]?: BashSpinnerState;
	[BASH_SPINNER_TOOL_CALL_ID_KEY]?: string;
}

interface BashCallRenderContextLike {
	executionStarted: boolean;
	isPartial: boolean;
	argsComplete?: boolean;
	invalidate?: () => void;
	lastComponent?: unknown;
	state?: unknown;
	toolCallId?: string;
}

export interface BashProgressOptions {
	/** Live mode; read on every render so `/zentui` changes reach existing rows. */
	getMode?: () => BashSyntaxMode;
	/** Deterministic test seams; production uses the module tokenizer/painter. */
	tokenize?: (text: string) => BashTokenBatch;
	paint?: (batch: BashTokenBatch, palette: BashPalette) => string;
	validate?: (display: string, painted: string) => string | undefined;
}

function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) {
		return `${totalMinutes}m ${seconds}s`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m`;
}

function isDefaultShellPath(shellPath: string): boolean {
	const normalized = shellPath.trim().replace(/\\/g, "/").toLowerCase();
	const basename = normalized.split("/").pop() || normalized;
	return basename === "bash" || basename === "cmd.exe";
}

/** The raw command, or `...` while a call has no command yet. */
function commandText(args: BashCallArgs): string {
	const raw = args.command;
	if (typeof raw !== "string" || raw.length === 0) return "...";
	// Cheap non-blank probe: stop at the first visible byte instead of trimming a copy.
	for (let index = 0; index < raw.length; index++) {
		const code = raw.charCodeAt(index);
		if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return raw;
	}
	return "...";
}

/** The shell prompt prefix (`$`, `PS>`, `user@host:~$`), trimmed without a copy when clean. */
function prefixText(args: BashCallArgs): string {
	const raw = args.commandPrefix;
	if (typeof raw !== "string" || raw.length === 0) return "";
	let start = 0;
	let end = raw.length;
	while (start < end) {
		const code = raw.charCodeAt(start);
		if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
		start++;
	}
	while (end > start) {
		const code = raw.charCodeAt(end - 1);
		if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
		end--;
	}
	if (start >= end) return "";
	return start === 0 && end === raw.length ? raw : raw.slice(start, end);
}

/** Legacy `pi` mode tokenizes the prefix with the command, exactly as it always has. */
function buildCommandDisplay(args: BashCallArgs): string {
	const prefix = prefixText(args);
	return prefix ? `${prefix} ${commandText(args)}` : commandText(args);
}

function buildBashCallText(
	args: BashCallArgs,
	theme: BashCallRenderTheme,
	spinnerFrame: string | undefined,
	elapsedMs: number | undefined,
	commandSegment: string,
): string {
	const shellSuffix =
		typeof args.shellPath === "string" &&
		args.shellPath.trim().length > 0 &&
		!isDefaultShellPath(args.shellPath)
			? theme.fg("muted", ` [shell: ${args.shellPath}]`)
			: "";
	const timeoutSuffix = args.timeout ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
	const spinnerPrefix = spinnerFrame ? `${theme.fg("warning", `${spinnerFrame} `)}` : "";
	const elapsedSuffix =
		spinnerFrame && elapsedMs !== undefined
			? theme.fg("muted", ` · ${formatElapsed(elapsedMs)}`)
			: "";

	// The semantic painter returns color bytes for the command only; the legacy `pi`
	// path returns its historical accent-wrapped display (prefix included). Neither is
	// wrapped again here.
	return `${spinnerPrefix}${theme.fg("toolTitle", theme.bold("$"))} ${commandSegment}${shellSuffix}${timeoutSuffix}${elapsedSuffix}`;
}

// Only foreground SGR is permitted: resets/backgrounds/styles could change the host card.
// Channel values above 255 are rejected exactly like the historical strict filter.
const FOREGROUND_CHANNEL = "(?:2[0-5][0-9]|1?[0-9]{1,2})";
const FOREGROUND_SGR_SOURCE = `(?:3[0-7]|9[0-7]|39|38;5;${FOREGROUND_CHANNEL}|38;2;${FOREGROUND_CHANNEL};${FOREGROUND_CHANNEL};${FOREGROUND_CHANNEL})`;
const FOREGROUND_SGR_ALL = new RegExp(`\\x1b\\[(?:${FOREGROUND_SGR_SOURCE})m`, "g");
const ANY_SGR = /\x1b\[[0-9;]*m/g;
const NON_ASCII = /[^\x00-\x7f]/;
const commandGraphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/**
 * Parse one foreground-only SGR (`\x1b[…m`) starting at `start`; returns the index
 * after `m`, or -1. Hand-parsed with fast paths for the three forms the painter and
 * Pi themes emit (`39`, `38;5;N`, `38;2;R;G;B`) so validation stays one cheap scan.
 */
function foregroundSgrEnd(text: string, start: number): number {
	const length = text.length;
	const second = text.charCodeAt(start + 2);
	if (second === 51) {
		// 3x: 38;… extended foreground, 30-37 basic, or 39 (default foreground).
		const third = text.charCodeAt(start + 3);
		if (third === 56) {
			if (text.charCodeAt(start + 4) !== 59) return -1;
			const kind = text.charCodeAt(start + 5);
			if (kind === 53) {
				// 38;5;N (`start + 7` is the first digit: 38;5;N)
				if (text.charCodeAt(start + 6) !== 59) return -1;
				const d0 = text.charCodeAt(start + 7) - 48;
				if (d0 < 0 || d0 > 9) return -1;
				const d1 = text.charCodeAt(start + 8) - 48;
				if (d1 >= 0 && d1 <= 9) {
					const d2 = text.charCodeAt(start + 9) - 48;
					if (d2 >= 0 && d2 <= 9) {
						return text.charCodeAt(start + 10) === 109 && d0 * 100 + d1 * 10 + d2 <= 255
							? start + 11
							: -1;
					}
					return text.charCodeAt(start + 9) === 109 && d0 * 10 + d1 <= 255 ? start + 10 : -1;
				}
				return text.charCodeAt(start + 8) === 109 ? start + 9 : -1;
			}
			if (kind !== 50 || text.charCodeAt(start + 6) !== 59) return -1;
			// 38;2;R;G;B
			let index = start + 7;
			let value = 0;
			let digits = 0;
			let params = 0;
			while (index < length) {
				const code = text.charCodeAt(index);
				if (code >= 48 && code <= 57) {
					if (++digits > 3) return -1;
					value = value * 10 + (code - 48);
					index++;
					continue;
				}
				if (code === 59 && digits > 0 && params < 2) {
					if (value > 255) return -1;
					params++;
					value = 0;
					digits = 0;
					index++;
					continue;
				}
				return code === 109 && digits > 0 && params === 2 && value <= 255 ? index + 1 : -1;
			}
			return -1;
		}
		if (third === 57 || (third >= 48 && third <= 55))
			return text.charCodeAt(start + 4) === 109 ? start + 5 : -1;
		return -1;
	}
	if (second === 57) {
		// 9x: bright foreground 90-97.
		const third = text.charCodeAt(start + 3);
		return third >= 48 && third <= 55 && text.charCodeAt(start + 4) === 109 ? start + 5 : -1;
	}
	return -1;
}

/**
 * Every inserted SGR must land on an extended-grapheme boundary. ASCII rows take a
 * code-unit fast path (only CRLF spans two code units); anything non-ASCII uses the
 * exact segmenter, but only on a cache miss.
 */
function preservesGraphemes(display: string, colored: string): boolean {
	if (!NON_ASCII.test(display)) {
		if (display.indexOf("\r") < 0) return true;
		let escapes = 0;
		for (const match of colored.matchAll(ANY_SGR)) {
			const index = (match.index as number) - escapes;
			if (
				index > 0 &&
				index < display.length &&
				display.charCodeAt(index - 1) === 13 &&
				display.charCodeAt(index) === 10
			)
				return false;
			escapes += match[0].length;
		}
		return true;
	}
	const boundaries = new Set([display.length]);
	for (const segment of commandGraphemes.segment(display)) boundaries.add(segment.index);
	let escapes = 0;
	for (const match of colored.matchAll(ANY_SGR)) {
		if (!boundaries.has((match.index as number) - escapes)) return false;
		escapes += match[0].length;
	}
	return true;
}
const SYNTAX_PALETTE = [
	"accent",
	"muted",
	"syntaxKeyword",
	"syntaxString",
	"syntaxNumber",
	"syntaxComment",
	"syntaxFunction",
	"syntaxType",
	"syntaxVariable",
	"syntaxOperator",
	"syntaxPunctuation",
] as const;
const WHITESPACE_RELOCATION = /((?:\x1b\[[0-9;]*m)+)([ \t\n]+)/g;
const CRLF_SPLIT_SGR = /\r(?:\x1b\[[0-9;]*m)+\n/;
const GRAPHEME_SAFE_LENGTH_FACTOR = 64;
const GRAPHEME_SAFE_LENGTH_BASE = 1024;

/** Strip foreground-only SGR; any other escape byte remains and fails equality. */
function stripForegroundOnly(candidate: string): string {
	return candidate.replace(FOREGROUND_SGR_ALL, "");
}

/**
 * Foreground-only equality, line count, length cap, grapheme boundaries and the host
 * word-wrap relocation. ASCII rows (the overwhelming majority) prove the invariant by
 * foreground-strip equality in one native pass; non-ASCII rows keep the per-span scan
 * because only they can split a grapheme cluster.
 */
export interface ValidateBashPaintOptions {
	/**
	 * Move an SGR that precedes whitespace after the whitespace. The owned painters
	 * never emit that shape (the legacy `pi` path normalizes before validating), so
	 * this is opt-in for outside callers and keeps ASCII validation allocation-free.
	 */
	relocate?: boolean;
}

/**
 * Foreground-only equality, line count, length cap, grapheme boundaries and the host
 * word-wrap relocation. The ASCII path is a strict foreground-strip equality check
 * (no split copy, no per-span parse); non-ASCII rows use one escape-aware scan.
 */
export function validateBashPaint(
	display: string,
	painted: string,
	options?: ValidateBashPaintOptions,
): string | undefined {
	const lengthLimit = display.length * GRAPHEME_SAFE_LENGTH_FACTOR + GRAPHEME_SAFE_LENGTH_BASE;
	if (typeof painted !== "string" || painted.length > lengthLimit) return undefined;
	if (painted === display) return painted;
	if (!NON_ASCII.test(display)) {
		if (display.indexOf("\r") >= 0 && CRLF_SPLIT_SGR.test(painted)) return undefined;
		// Only foreground SGR survives the strip; anything else fails equality.
		if (painted.replace(FOREGROUND_SGR_ALL, "") !== display) return undefined;
		if (options?.relocate !== true) return painted;
		if (!/\x1b\[[0-9;]*m[ \t\n]/.test(painted)) return painted;
		const normalized = painted.replace(WHITESPACE_RELOCATION, "$2$1");
		return preservesGraphemes(display, normalized) ? normalized : undefined;
	}
	const graphemeBoundaries = NON_ASCII.test(display) ? ([] as number[]) : undefined;
	const hasCarriageReturn = display.indexOf("\r") >= 0;
	const length = painted.length;
	let pi = 0;
	let di = 0;
	let relocate = false;
	while (pi < length) {
		const code = painted.charCodeAt(pi);
		if (code === 27) {
			const end = foregroundSgrEnd(painted, pi);
			if (end < 0) return undefined;
			if (
				hasCarriageReturn &&
				di > 0 &&
				di < display.length &&
				display.charCodeAt(di - 1) === 13 &&
				display.charCodeAt(di) === 10
			)
				return undefined;
			if (graphemeBoundaries) graphemeBoundaries.push(di);
			const next = painted.charCodeAt(end);
			if (next === 32 || next === 9 || next === 10 || next === 13) relocate = true;
			pi = end;
			continue;
		}
		if (di >= display.length || code !== display.charCodeAt(di)) return undefined;
		pi++;
		di++;
	}
	// Equality already proves the line count: SGR sequences never contain a newline.
	if (di !== display.length) return undefined;
	if (graphemeBoundaries) {
		const boundaries = new Set([display.length]);
		for (const segment of commandGraphemes.segment(display)) boundaries.add(segment.index);
		for (const index of graphemeBoundaries) if (!boundaries.has(index)) return undefined;
	}
	if (!relocate) return painted;
	// Pi Text identifies whitespace tokens with raw trim(). Keeping syntax SGR off
	// spaces preserves the original word-wrap geometry.
	const normalized = painted.replace(WHITESPACE_RELOCATION, "$2$1");
	// Moving an escape over a space can split its combining marks.
	return preservesGraphemes(display, normalized) ? normalized : undefined;
}

/**
 * Token cache charge: two packed SMI arrays (8 bytes per element), headers, and the
 * source string the offsets point into (the map key keeps that string alive).
 */
function tokenCacheBytes(batch: BashTokenBatch): number {
	return 96 + batch.kinds.length * 16 + batch.source.length * 2;
}

interface CacheEntry<V> {
	readonly value: V;
	readonly bytes: number;
}

/**
 * Byte-budgeted, entry-capped cache with a uniformly sampled victim. Strict LRU turns a
 * sequential rescan of more rows than fit into a 0% hit rate: every miss evicts exactly
 * the row the scan needs next. Sampling keeps a partially warm window at the same
 * memory budget and still retains recent rows with probability 1 - 1/size per insert.
 */
/** Bounded "missed once while full" fingerprints used for second-touch admission. */
const BASH_CACHE_SEEN_LIMIT = 4_096;
/** Share of first-touch misses admitted while the cache is full (1 in 8). */
const BASH_CACHE_ADMIT_MASK = 7;
/** Share of first-touch misses admitted during a scan over uncached rows (1 in 32). */
const BASH_CACHE_SCAN_ADMIT_MASK = 31;
/** Consecutive misses that classify the access pattern as a scan over uncached rows. */
const BASH_CACHE_SCAN_MISSES = 16;

/** FNV-1a over the row; only runs on misses that would have to evict a resident row. */
function fingerprintRow(key: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index++) {
		hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
	}
	return hash >>> 0;
}

class SessionCache<V> {
	private readonly entries = new Map<string, CacheEntry<V>>();
	/** Rows that missed once while the cache was full; a revisit is admitted immediately. */
	private readonly seen = new Set<number>();
	private bytes = 0;
	private sample = 0x9e3779b9;
	private admit = 0x2545f491;
	private missRun = 0;
	constructor(
		private readonly budget: number,
		private readonly maxEntries: number,
	) {}
	get(key: string): V | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) this.missRun++;
		else this.missRun = 0;
		return entry?.value;
	}
	/**
	 * Byte-budgeted, entry-capped cache. Eviction samples a uniformly random victim, so a
	 * rescan that overruns the budget keeps a partially warm window instead of evicting
	 * exactly the row it needs next.
	 *
	 * While the cache is full, a row that was never seen is admitted only on one miss in
	 * eight, and a row that already missed once is admitted immediately. A single
	 * sequential scan over rows that were never cached therefore cannot flush the window a
	 * scroll-back is about to reach, while the rows of the live session and any revisited
	 * region still enter the cache.
	 */
	set(key: string, value: V, bytes: number): void {
		const cost = Math.max(1, Math.floor(bytes));
		if (cost > this.budget) return;
		if (!this.entries.has(key)) {
			const full = this.bytes + cost > this.budget || this.entries.size >= this.maxEntries;
			if (full) {
				const fingerprint = fingerprintRow(key);
				// A row that already missed once is a revisit of a scrolled-away region and
				// enters the cache immediately. A first-touch row is admitted on one miss in
				// eight, and on one in 32 while a long miss run marks a sequential scan over
				// rows that were never cached: admitting every row of such a scan would
				// evict exactly the window the scan is about to reach.
				if (!this.seen.delete(fingerprint)) {
					if (this.seen.size >= BASH_CACHE_SEEN_LIMIT) this.seen.clear();
					this.seen.add(fingerprint);
					this.admit = (Math.imul(this.admit, 1664525) + 1013904223) >>> 0;
					const mask =
						this.missRun >= BASH_CACHE_SCAN_MISSES
							? BASH_CACHE_SCAN_ADMIT_MASK
							: BASH_CACHE_ADMIT_MASK;
					if ((this.admit & mask) !== 0) return;
				}
			}
		}
		this.entries.delete(key);
		this.entries.set(key, { value, bytes: cost });
		this.bytes += cost;
		while (this.entries.size > this.maxEntries || this.bytes > this.budget) {
			if (!this.evictOne()) break;
		}
	}
	private evictOne(): boolean {
		const size = this.entries.size;
		if (size === 0) return false;
		// Deterministic 32-bit LCG; one map walk up to the sampled index.
		this.sample = (Math.imul(this.sample, 1664525) + 1013904223) >>> 0;
		const target = this.sample % size;
		let index = 0;
		for (const [key, entry] of this.entries) {
			if (index++ !== target) continue;
			this.entries.delete(key);
			this.bytes -= entry.bytes;
			return true;
		}
		return false;
	}
	clear(): void {
		this.entries.clear();
		this.seen.clear();
		this.bytes = 0;
	}
	get size(): number {
		return this.entries.size;
	}
}

interface PaintedCommand {
	readonly key: string;
	readonly text: string;
	readonly mode: BashSyntaxMode;
	readonly colors: object | undefined;
	readonly colorMode: string | undefined;
	readonly signature: string | undefined;
	readonly signatureTokens: readonly string[];
}

function themeColors(theme: BashCallRenderTheme): object | undefined {
	try {
		const colors = theme.colors;
		return colors && typeof colors === "object" ? colors : undefined;
	} catch {
		return undefined;
	}
}
function themeColorMode(theme: BashCallRenderTheme): string | undefined {
	try {
		return typeof theme.getColorMode === "function" ? String(theme.getColorMode()) : undefined;
	} catch {
		return undefined;
	}
}

export function createBashProgress(
	highlight: ((text: string) => string[]) | null | undefined = bashCommandHighlighter,
	options: BashProgressOptions = {},
) {
	const tokenize = options.tokenize ?? tokenizeBashBatch;
	const paint = options.paint ?? paintBashBatch;
	const validate = options.validate ?? validateBashPaint;
	const mode = (): BashSyntaxMode => {
		try {
			return options.getMode?.() === "pi" ? "pi" : "semantic";
		} catch {
			return "semantic";
		}
	};
	const tokenCache = new SessionCache<BashTokenBatch>(
		BASH_TOKEN_CACHE_BYTES,
		BASH_CACHE_MAX_ENTRIES,
	);
	const paintedCache = new SessionCache<PaintedCommand>(
		BASH_PAINTED_CACHE_BYTES,
		BASH_CACHE_MAX_ENTRIES,
	);
	// One-row cache for a streaming (not yet committed) call: ticks stay cheap without
	// pushing transient prefixes into the session caches and evicting completed rows.
	let transient: PaintedCommand | undefined;
	let lastColors: object | undefined;
	let lastColorMode: string | undefined;
	let lastMode: BashSyntaxMode | undefined;
	let paletteMemo:
		| { colors: object; colorMode: string | undefined; palette: BashPalette }
		| undefined;

	function resetRevisions(
		syntaxMode: BashSyntaxMode,
		colors: object | undefined,
		colorMode: string | undefined,
	): void {
		if (syntaxMode !== lastMode || colors !== lastColors || colorMode !== lastColorMode) {
			// Theme or mode revision: painted rows are stale, tokens survive. Reading the
			// stable theme proxy's `colors` identity is the whole warm-path probe.
			paintedCache.clear();
			transient = undefined;
			lastMode = syntaxMode;
			lastColors = colors;
			lastColorMode = colorMode;
		}
	}

	function cachedPainted(
		cached: PaintedCommand | undefined,
		key: string,
		syntaxMode: BashSyntaxMode,
		theme: BashCallRenderTheme,
		colors: object | undefined,
		colorMode: string | undefined,
	): string | undefined {
		if (cached === undefined || cached.key !== key || cached.mode !== syntaxMode) return undefined;
		if (colors !== undefined) {
			if (cached.colors === colors && cached.colorMode === colorMode) return cached.text;
			return undefined;
		}
		// Hosts without `theme.colors` re-sample only the tokens this row used; the probe
		// avoids palette parsing so a live theme mutation is still observed each hit.
		return cached.signature !== undefined &&
			cached.signature === bashThemeSignature(theme, cached.signatureTokens)
			? cached.text
			: undefined;
	}

	function cachePainted(
		key: string,
		result: { text: string; signatureTokens: readonly string[] },
		theme: BashCallRenderTheme,
		syntaxMode: BashSyntaxMode,
		colors: object | undefined,
		colorMode: string | undefined,
		admit: boolean,
	): string {
		const entry: PaintedCommand = {
			key,
			text: result.text,
			mode: syntaxMode,
			colors,
			colorMode,
			signature:
				colors === undefined ? bashThemeSignature(theme, result.signatureTokens) : undefined,
			signatureTokens: result.signatureTokens,
		};
		if (admit) paintedCache.set(key, entry, result.text.length * 2 + 96);
		else transient = entry;
		return result.text;
	}

	function paletteFor(
		theme: BashCallRenderTheme,
		colors: object | undefined,
		colorMode: string | undefined,
	): BashPalette {
		// Palette resolution samples the theme proxy; memoize per concrete colors record.
		if (
			colors !== undefined &&
			paletteMemo !== undefined &&
			paletteMemo.colors === colors &&
			paletteMemo.colorMode === colorMode
		)
			return paletteMemo.palette;
		const palette = resolveBashPalette(theme);
		if (colors !== undefined) paletteMemo = { colors, colorMode, palette };
		return palette;
	}

	function paintSemantic(
		batch: BashTokenBatch,
		theme: BashCallRenderTheme,
		colors: object | undefined,
		colorMode: string | undefined,
	): { text: string; signatureTokens: readonly string[] } | undefined {
		try {
			const palette = paletteFor(theme, colors, colorMode);
			const candidate = paint(batch, palette);
			const normalized =
				paint === paintBashBatch && validate === validateBashPaint
					? validateBashPaint(batch.source, candidate, { relocate: false })
					: validate(batch.source, candidate);
			if (normalized === undefined) return undefined;
			// A theme that resolves no role paints nothing: fail open instead of dropping
			// the command color entirely.
			if (normalized === batch.source) return undefined;
			return { text: normalized, signatureTokens: palette.usedTokens };
		} catch {
			return undefined;
		}
	}

	function paintLegacy(
		display: string,
		theme: BashCallRenderTheme,
	): { text: string; signatureTokens: readonly string[] } | undefined {
		if (!highlight) return undefined;
		try {
			const lines = highlight(display);
			if (
				!Array.isArray(lines) ||
				lines.length !== display.split("\n").length ||
				!lines.every(
					(line) =>
						typeof line === "string" &&
						line.length <= display.length * GRAPHEME_SAFE_LENGTH_FACTOR + GRAPHEME_SAFE_LENGTH_BASE,
				)
			)
				return undefined;
			const candidate = lines.join("\n");
			if (
				candidate.length >
					display.length * GRAPHEME_SAFE_LENGTH_FACTOR + GRAPHEME_SAFE_LENGTH_BASE ||
				stripForegroundOnly(candidate) !== display ||
				!preservesGraphemes(display, candidate)
			)
				return undefined;
			const normalized = candidate.replace(WHITESPACE_RELOCATION, "$2$1");
			// Validate final placement too; unsafe spans keep the plain accent row.
			if (!preservesGraphemes(display, normalized)) return undefined;
			// Legacy `pi` rows keep the historical outer accent wrapper byte-for-byte.
			return { text: theme.fg("accent", normalized), signatureTokens: SYNTAX_PALETTE };
		} catch {
			// Missing/partial/invalid highlighting fails open to the original accent row.
			return undefined;
		}
	}

	/** Returns the final command segment (prefix included) for the row. */
	function commandSegment(args: BashCallArgs, theme: BashCallRenderTheme, admit: boolean): string {
		const command = commandText(args);
		const prefix = prefixText(args);
		if (args.shellPath !== undefined && typeof args.shellPath !== "string")
			return theme.fg("accent", buildCommandDisplay(args));
		const shell = args.shellPath?.trim().replace(/\\/g, "/").split("/").pop()?.toLowerCase();
		if (shell && shell !== "bash" && shell !== "sh")
			return theme.fg("accent", buildCommandDisplay(args));

		const syntaxMode = mode();
		const colors = themeColors(theme);
		const colorMode = themeColorMode(theme);
		resetRevisions(syntaxMode, colors, colorMode);
		// Legacy `pi` mode hashes the historical prefix+command display; semantic mode
		// keys on the command reference alone so the prompt never hashes on a warm hit.
		const key = syntaxMode === "semantic" ? command : prefix ? `${prefix} ${command}` : command;
		const cached = cachedPainted(
			admit ? paintedCache.get(key) : transient,
			key,
			syntaxMode,
			theme,
			colors,
			colorMode,
		);
		if (cached !== undefined) {
			return syntaxMode === "semantic" && prefix
				? `${theme.fg("muted", `${prefix} `)}${cached}`
				: cached;
		}

		// Legacy `pi` rows never need tokens: the host highlighter owns classification.
		let batch: BashTokenBatch | undefined;
		if (syntaxMode === "semantic") {
			batch = tokenCache.get(key);
			if (batch === undefined || batch.source !== key) {
				try {
					batch = tokenize(key);
				} catch {
					return theme.fg("accent", buildCommandDisplay(args));
				}
				// The batch must cover the input exactly once, in order.
				if (
					batch.source !== key ||
					batch.starts.length !== batch.kinds.length ||
					(batch.starts.length > 0 && batch.starts[0] !== 0)
				) {
					return theme.fg("accent", buildCommandDisplay(args));
				}
				tokenCache.set(key, batch, tokenCacheBytes(batch));
			}
		}

		// Fail-open semantic -> legacy highlightCode -> plain accent row.
		const semantic = batch ? paintSemantic(batch, theme, colors, colorMode) : undefined;
		const painted =
			semantic ?? paintLegacy(syntaxMode === "semantic" ? buildCommandDisplay(args) : key, theme);
		const segment =
			painted !== undefined
				? cachePainted(key, painted, theme, syntaxMode, colors, colorMode, admit)
				: cachePainted(
						key,
						{
							text: theme.fg("accent", buildCommandDisplay(args)),
							signatureTokens: ["accent"],
						},
						theme,
						syntaxMode,
						colors,
						colorMode,
						admit,
					);
		return syntaxMode === "semantic" && prefix
			? `${theme.fg("muted", `${prefix} `)}${segment}`
			: segment;
	}
	const spinnerStatesByToolCallId = new Map<string, BashSpinnerState>();
	let nextSyntheticToolCallId = 0;

	function toStateCarrier(value: unknown): BashSpinnerStateCarrier | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		return value as BashSpinnerStateCarrier;
	}

	function getSyntheticToolCallId(
		carrier: BashSpinnerStateCarrier | undefined,
	): string | undefined {
		if (!carrier) {
			return undefined;
		}

		if (!carrier[BASH_SPINNER_TOOL_CALL_ID_KEY]) {
			carrier[BASH_SPINNER_TOOL_CALL_ID_KEY] = `state:${++nextSyntheticToolCallId}`;
		}
		return carrier[BASH_SPINNER_TOOL_CALL_ID_KEY];
	}

	function getToolCallId(context: BashCallRenderContextLike): string | undefined {
		if (typeof context.toolCallId === "string" && context.toolCallId.trim().length > 0) {
			return context.toolCallId;
		}
		return getSyntheticToolCallId(toStateCarrier(context.state));
	}

	function getOrCreateSpinnerState(
		toolCallId: string | undefined,
		carrier: BashSpinnerStateCarrier | undefined,
	): BashSpinnerState | undefined {
		if (!toolCallId) {
			return undefined;
		}

		let state = spinnerStatesByToolCallId.get(toolCallId);
		if (!state) {
			state = { frameIndex: 0 };
			spinnerStatesByToolCallId.set(toolCallId, state);
			while (spinnerStatesByToolCallId.size > 16) {
				const first = spinnerStatesByToolCallId.entries().next().value;
				if (!first) break;
				stopSpinner(first[0], first[1]);
			}
		}
		if (carrier) {
			carrier[BASH_SPINNER_STATE_KEY] = state;
		}
		return state;
	}

	function stopSpinner(toolCallId: string | undefined, state: BashSpinnerState | undefined): void {
		if (!state) {
			return;
		}

		if (state.timer) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
		state.frameIndex = 0;
		state.startedAt = undefined;
		state.target = undefined;
		if (toolCallId) {
			spinnerStatesByToolCallId.delete(toolCallId);
		}
	}

	function renderBashCall(
		args: BashCallArgs,
		theme: BashCallRenderTheme,
		context: BashCallRenderContextLike,
	): Text {
		const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
		const carrier = toStateCarrier(context.state);
		const toolCallId = getToolCallId(context);
		const spinnerState = getOrCreateSpinnerState(toolCallId, carrier);
		const shouldSpin = context.executionStarted && context.isPartial;
		// Streaming prefixes must not flush the session caches; the paint itself still
		// uses the one-row transient cache so spinner ticks stay cheap.
		const admit = !(context.isPartial || context.argsComplete === false);

		if (!shouldSpin) {
			stopSpinner(toolCallId, spinnerState);
			text.setText(
				buildBashCallText(args, theme, undefined, undefined, commandSegment(args, theme, admit)),
			);
			return text;
		}

		if (spinnerState) {
			spinnerState.target = { text, args, theme, invalidate: context.invalidate };
			spinnerState.startedAt ??= Date.now();
			if (!spinnerState.timer && typeof context.invalidate === "function") {
				const timer = setInterval(() => {
					spinnerState.frameIndex = (spinnerState.frameIndex + 1) % BASH_SPINNER_FRAMES.length;
					const target = spinnerState.target;
					if (!target) return;
					target.text.setText(
						buildBashCallText(
							target.args,
							target.theme,
							BASH_SPINNER_FRAMES[spinnerState.frameIndex],
							Date.now() - (spinnerState.startedAt ?? Date.now()),
							commandSegment(target.args, target.theme, false),
						),
					);
					target.invalidate?.();
				}, BASH_SPINNER_INTERVAL_MS);
				spinnerState.timer = timer;
			}
		}

		const spinnerFrame = spinnerState ? BASH_SPINNER_FRAMES[spinnerState.frameIndex] : undefined;
		const elapsedMs =
			spinnerState?.startedAt !== undefined ? Date.now() - spinnerState.startedAt : undefined;
		text.setText(
			buildBashCallText(args, theme, spinnerFrame, elapsedMs, commandSegment(args, theme, false)),
		);
		return text;
	}

	return {
		renderCall: renderBashCall,
		release(context: BashCallRenderContextLike) {
			const id = getToolCallId(context);
			stopSpinner(id, id ? spinnerStatesByToolCallId.get(id) : undefined);
		},
		dispose() {
			for (const [id, state] of spinnerStatesByToolCallId) stopSpinner(id, state);
			tokenCache.clear();
			paintedCache.clear();
			transient = undefined;
			paletteMemo = undefined;
			lastColors = undefined;
			lastColorMode = undefined;
			lastMode = undefined;
		},
	};
}
export type BashProgress = ReturnType<typeof createBashProgress>;
