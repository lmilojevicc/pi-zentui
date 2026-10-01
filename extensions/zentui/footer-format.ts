/**
 * Starship-style footer format string parser and renderer.
 *
 * Pure module (no TUI/config imports) so it is fully unit-testable.
 *
 * Supports conditional groups: `( ... )` is dropped when every nested
 * variable (and nested group) renders empty.
 */

export type FormatToken =
	| { kind: "text"; value: string }
	| { kind: "var"; name: string }
	| { kind: "fill" }
	| { kind: "group"; tokens: FormatToken[] };

export type CompactBoundaryKind = "space" | "separator";

export type CompactFormatChunk =
	| { kind: "tokens"; tokens: FormatToken[]; boundary: CompactBoundaryKind }
	| { kind: "extensions"; boundary: CompactBoundaryKind };

/** Cached syntax is deeply readonly; public parser/compiler results remain mutable. */
export type ReadonlyFormatToken =
	| Readonly<Exclude<FormatToken, { kind: "group" }>>
	| { readonly kind: "group"; readonly tokens: readonly ReadonlyFormatToken[] };

type ReadonlyCompactChunk =
	| {
			readonly kind: "tokens";
			readonly tokens: readonly ReadonlyFormatToken[];
			readonly boundary: CompactBoundaryKind;
	  }
	| { readonly kind: "extensions"; readonly boundary: CompactBoundaryKind };

export type CompiledCompactChunk = ReadonlyCompactChunk & {
	readonly references: readonly string[];
};

export type CompiledFooterFormat = {
	readonly tokens: readonly ReadonlyFormatToken[];
	readonly references: readonly string[];
	readonly compact: {
		readonly left: readonly CompiledCompactChunk[];
		readonly right: readonly CompiledCompactChunk[];
		readonly alignRight: boolean;
	};
};

type SyntaxEntry = {
	tokens: readonly ReadonlyFormatToken[];
	compact: {
		left: readonly ReadonlyCompactChunk[];
		right: readonly ReadonlyCompactChunk[];
		alignRight: boolean;
	};
	names: readonly string[];
	canonicalNames?: readonly string[];
	compiled?: CompiledFooterFormat;
};

// Format text only: no session, config object, rendered output, or theme is retained.
const syntaxCache = new Map<string, SyntaxEntry>();
const SYNTAX_CACHE_LIMIT = 32;

function freezeTokens(tokens: FormatToken[]): readonly ReadonlyFormatToken[] {
	for (const token of tokens) {
		if (token.kind === "group") freezeTokens(token.tokens);
		Object.freeze(token);
	}
	return Object.freeze(tokens);
}

function canonicalVariableName(name: string, aliases: Readonly<Record<string, string>>): string {
	const alias = aliases[name];
	// Inherited string aliases are supported, but Object.prototype methods are not aliases.
	return typeof alias === "string" ? alias : name;
}

/** Share bounded syntax/analysis across rendering and dependency-demand checks. */
export function compiledFooterFormat(
	format: string,
	aliases: Readonly<Record<string, string>> = {},
): CompiledFooterFormat {
	let entry = syntaxCache.get(format);
	if (!entry) {
		const tokens = parseFooterFormat(format);
		const compact = compileCompactFormatSplit(tokens);
		const names = new Set<string>();
		const visit = (items: FormatToken[]) => {
			for (const token of items) {
				if (token.kind === "group") visit(token.tokens);
				else if (token.kind === "var") names.add(token.name);
			}
		};
		visit(tokens);
		const freezeChunks = (chunks: CompactFormatChunk[]) =>
			Object.freeze(
				chunks.map((chunk) => {
					if (chunk.kind === "tokens") freezeTokens(chunk.tokens);
					return Object.freeze(chunk);
				}),
			);
		entry = {
			tokens: freezeTokens(tokens),
			compact: Object.freeze({
				left: freezeChunks(compact.left),
				right: freezeChunks(compact.right),
				alignRight: compact.alignRight,
			}),
			names: Object.freeze([...names]),
		};
		if (syntaxCache.size >= SYNTAX_CACHE_LIMIT) {
			const oldest = syntaxCache.keys().next().value;
			if (oldest !== undefined) syntaxCache.delete(oldest);
		}
	} else {
		syntaxCache.delete(format);
	}
	syntaxCache.set(format, entry);
	// Compare only names that occur in this syntax, including structural variables.
	// This observes in-place alias edits without retaining mutable caller objects.
	if (
		entry.compiled &&
		entry.names.every(
			(name, i) => canonicalVariableName(name, aliases) === entry.canonicalNames?.[i],
		)
	) {
		return entry.compiled;
	}
	const references = (tokens: readonly ReadonlyFormatToken[]) =>
		Object.freeze([...collectFooterFormatReferences(tokens, aliases)]);
	const analyzeChunks = (chunks: readonly ReadonlyCompactChunk[]) =>
		Object.freeze(
			chunks.map((chunk) =>
				Object.freeze({
					...chunk,
					references:
						chunk.kind === "tokens" ? references(chunk.tokens) : Object.freeze([] as string[]),
				}),
			),
		);
	entry.canonicalNames = Object.freeze(
		entry.names.map((name) => canonicalVariableName(name, aliases)),
	);
	entry.compiled = Object.freeze({
		tokens: entry.tokens,
		references: references(entry.tokens),
		compact: Object.freeze({
			left: analyzeChunks(entry.compact.left),
			right: analyzeChunks(entry.compact.right),
			alignRight: entry.compact.alignRight,
		}),
	});
	return entry.compiled;
}

const TOKEN_REGEX = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Tokenize a format string into text/var/fill/group tokens.
 *
 * `$name` and `${name}` both produce a variable token. A variable named
 * `fill` becomes a fill token instead. Parentheses form conditional groups
 * that drop entirely when all nested vars are empty.
 */
export function parseFooterFormat(format: string): FormatToken[] {
	if (!format) return [];
	return parseTokenSlice(format, 0, format.length, true).tokens;
}

function parseTokenSlice(
	format: string,
	start: number,
	end: number,
	topLevel = false,
): { tokens: FormatToken[]; nextIndex: number } {
	const tokens: FormatToken[] = [];
	let index = start;
	let textStart = start;

	const flushText = (until: number) => {
		if (until > textStart) {
			tokens.push({ kind: "text", value: format.slice(textStart, until) });
		}
	};

	while (index < end) {
		const ch = format[index];

		if (ch === "(") {
			flushText(index);
			const nested = parseTokenSlice(format, index + 1, end, false);
			tokens.push({ kind: "group", tokens: nested.tokens });
			index = nested.nextIndex;
			textStart = index;
			continue;
		}

		if (ch === ")") {
			// Nested groups close on `)`. Unmatched top-level `)` is literal text so
			// trailing tokens like `$cwd) $tokens` are not discarded.
			if (topLevel) {
				index += 1;
				continue;
			}
			flushText(index);
			return { tokens, nextIndex: index + 1 };
		}

		if (ch === "$") {
			TOKEN_REGEX.lastIndex = index;
			const match = TOKEN_REGEX.exec(format);
			if (match && match.index === index && match.index < end) {
				const full = match[0];
				const matchEnd = match.index + full.length;
				if (matchEnd > end) {
					index += 1;
					continue;
				}
				flushText(index);
				const name = match[1] ?? match[2] ?? "";
				if (name === "fill") {
					tokens.push({ kind: "fill" });
				} else {
					tokens.push({ kind: "var", name });
				}
				index = matchEnd;
				textStart = index;
				continue;
			}
		}

		index += 1;
	}

	flushText(end);
	return { tokens, nextIndex: end };
}

/**
 * Render tokens into `{ left, middle, right }` based on `$fill` markers.
 *
 * - No fill: everything → `left`; `middle` and `right` are `""`.
 * - One fill: tokens before → `left`, tokens after → `right`; `middle` is `""`.
 * - Two fills: before the first → `left`, between the two → `middle`
 *   (centered by the caller via the existing middle-zone logic), after the
 *   second → `right`.
 * - Additional fills beyond the first two are ignored.
 * - `$fill` inside a group is ignored (renders empty).
 *
 * Text tokens contribute their `value` verbatim (unstyled/plain); var tokens
 * contribute `renderVariable(name)` (already styled by caller). No automatic
 * spaces are inserted — the user controls all spacing.
 */
export function renderFormatSplit(
	tokens: readonly ReadonlyFormatToken[],
	renderVariable: (name: string) => string,
): { left: string; middle: string; right: string } {
	const fillIndices = findTopLevelFillIndices(tokens);

	if (fillIndices.length === 0) {
		return {
			left: renderTokenSlice(tokens, 0, tokens.length, renderVariable),
			middle: "",
			right: "",
		};
	}

	const first = fillIndices[0];
	const second = fillIndices[1];

	if (first === undefined) {
		return {
			left: renderTokenSlice(tokens, 0, tokens.length, renderVariable),
			middle: "",
			right: "",
		};
	}

	if (second === undefined) {
		return {
			left: renderTokenSlice(tokens, 0, first, renderVariable),
			middle: "",
			right: renderTokenSlice(tokens, first + 1, tokens.length, renderVariable),
		};
	}

	return {
		left: renderTokenSlice(tokens, 0, first, renderVariable),
		middle: renderTokenSlice(tokens, first + 1, second, renderVariable),
		right: renderTokenSlice(tokens, second + 1, tokens.length, renderVariable),
	};
}

/** Compact uses only the first top-level fill; later fills remain nonstructural. */
export function compileCompactFormatSplit(tokens: FormatToken[]): {
	left: CompactFormatChunk[];
	right: CompactFormatChunk[];
	alignRight: boolean;
} {
	const first = tokens.findIndex((token) => token.kind === "fill");
	return first < 0
		? { left: compileCompactFormat(tokens), right: [], alignRight: false }
		: {
				left: compileCompactFormat(tokens.slice(0, first)),
				right: compileCompactFormat(tokens.slice(first + 1)),
				alignRight: true,
			};
}

export function compileCompactFormat(tokens: FormatToken[]): CompactFormatChunk[] {
	const chunks: CompactFormatChunk[] = [];
	let current: FormatToken[] = [];
	let incomingBoundary: CompactBoundaryKind = "space";

	const flush = () => {
		const normalized = trimBoundaryWhitespace(current);
		current = [];
		if (normalized.length === 0) return;
		if (
			normalized.length === 1 &&
			normalized[0]?.kind === "var" &&
			normalized[0].name === "extensions"
		) {
			chunks.push({ kind: "extensions", boundary: incomingBoundary });
			return;
		}
		chunks.push({ kind: "tokens", tokens: normalized, boundary: incomingBoundary });
	};

	for (const token of tokens) {
		if (token.kind === "var" && (token.name === "wrap" || token.name === "wrap_sep")) {
			flush();
			incomingBoundary = token.name === "wrap_sep" ? "separator" : "space";
			continue;
		}
		if (token.kind === "fill") continue;
		current.push(token);
	}
	flush();
	return chunks;
}

function trimBoundaryWhitespace(tokens: FormatToken[]): FormatToken[] {
	const result = tokens.map((token) => (token.kind === "text" ? { ...token } : token));
	while (result[0]?.kind === "text") {
		result[0].value = result[0].value.replace(/^\s+/, "");
		if (result[0].value) break;
		result.shift();
	}
	while (result.at(-1)?.kind === "text") {
		const last = result.at(-1);
		if (last?.kind !== "text") break;
		last.value = last.value.replace(/\s+$/, "");
		if (last.value) break;
		result.pop();
	}
	return result;
}

export function renderFormatTokens(
	tokens: readonly ReadonlyFormatToken[],
	renderVariable: (name: string) => string,
): string {
	return renderTokenSlice(tokens, 0, tokens.length, renderVariable);
}

export function collectFooterFormatReferences(
	tokens: readonly ReadonlyFormatToken[],
	aliases: Record<string, string> = {},
): Set<string> {
	const references = new Set<string>();
	const visit = (items: readonly ReadonlyFormatToken[]) => {
		for (const token of items) {
			if (token.kind === "group") {
				visit(token.tokens);
				continue;
			}
			if (token.kind !== "var") continue;
			const canonical = canonicalVariableName(token.name, aliases);
			if (canonical !== "wrap" && canonical !== "wrap_sep" && canonical !== "extensions") {
				references.add(canonical);
			}
		}
	};
	visit(tokens);
	return references;
}

function findTopLevelFillIndices(tokens: readonly ReadonlyFormatToken[]): number[] {
	const fillIndices: number[] = [];
	for (let index = 0; index < tokens.length; index++) {
		if (tokens[index]?.kind === "fill") fillIndices.push(index);
	}
	return fillIndices;
}

function renderTokenSlice(
	tokens: readonly ReadonlyFormatToken[],
	start: number,
	end: number,
	renderVariable: (name: string) => string,
): string {
	let result = "";
	for (let i = start; i < end; i++) {
		const token = tokens[i];
		if (!token) continue;
		result += renderToken(token, renderVariable);
	}
	return result;
}

function renderToken(token: ReadonlyFormatToken, renderVariable: (name: string) => string): string {
	if (token.kind === "text") return token.value;
	if (token.kind === "var") return renderVariable(token.name);
	if (token.kind === "fill") return "";
	// group
	const rendered = token.tokens.map((child) => renderToken(child, renderVariable)).join("");
	if (isGroupEmpty(token, renderVariable)) return "";
	return rendered;
}

/**
 * Separator vars only style gaps between content; they must not keep a group
 * alive when every real content var is empty (e.g. `($sep$tokens)` drops if
 * tokens is empty).
 */
const NON_CONTENT_VARS = new Set(["sep", "separator"]);

/**
 * A group is empty iff every content var leaf is empty and every nested group
 * is empty. Text-only groups (no vars) always show. `$sep` / `$separator` are
 * ignored for emptiness so orphan themed pipes do not force a group to render.
 */
function isGroupEmpty(
	group: ReadonlyFormatToken & { kind: "group" },
	renderVariable: (name: string) => string,
): boolean {
	let sawContentVarOrGroup = false;
	for (const child of group.tokens) {
		if (child.kind === "var") {
			if (NON_CONTENT_VARS.has(child.name)) continue;
			sawContentVarOrGroup = true;
			if (renderVariable(child.name) !== "") return false;
		} else if (child.kind === "group") {
			sawContentVarOrGroup = true;
			if (!isGroupEmpty(child, renderVariable)) return false;
		}
	}
	// Text-only groups (or groups with only $sep) are shown only when no content vars.
	// Groups that only contain $sep still count as empty so they drop.
	return sawContentVarOrGroup || groupOnlyNonContentVars(group);
}

function groupOnlyNonContentVars(group: ReadonlyFormatToken & { kind: "group" }): boolean {
	let sawSep = false;
	for (const child of group.tokens) {
		if (child.kind === "text") {
			if (child.value.trim() !== "") return false;
			continue;
		}
		if (child.kind === "var") {
			if (!NON_CONTENT_VARS.has(child.name)) return false;
			sawSep = true;
			continue;
		}
		if (child.kind === "group") return false;
		if (child.kind === "fill") continue;
	}
	return sawSep;
}

/** One optional SGR sequence (`\x1b[…m`). */
const ANSI_ONE_SRC = "\u001b\\[[0-9;]*m";

/**
 * One ` | ` separator unit, plain or with a single ANSI wrapper on either side
 * of the spaces/pipe (matches `renderStyle(..., " | ")` output).
 */
const SEP_UNIT_SRC = `(?:${ANSI_ONE_SRC})?\\s+\\|\\s+(?:${ANSI_ONE_SRC})?`;

/**
 * Join non-empty parts with a separator (segment-mode style).
 * Useful when building right-side metrics without orphan pipes.
 */
export function joinNonEmpty(parts: string[], separator: string): string {
	return parts.filter(Boolean).join(separator);
}

/**
 * Tidy a rendered format left/middle/right slice:
 * - collapse repeated pipe separators (plain or simple ANSI-wrapped) into one
 * - strip leading/trailing pipe separators
 * - strip leading/trailing whitespace
 * - drop slices that are only ANSI / whitespace after cleanup
 */
export function stripOrphanSeparators(rendered: string): string {
	if (!rendered) return rendered;

	// Collapse consecutive separator units, keeping the first (preserves themed color).
	const consecutive = new RegExp(`(${SEP_UNIT_SRC})(?:${SEP_UNIT_SRC})+`, "g");
	let result = rendered.replace(consecutive, "$1");

	// Strip leading / trailing separator units.
	result = result.replace(new RegExp(`^(?:${SEP_UNIT_SRC})+`), "");
	result = result.replace(new RegExp(`(?:${SEP_UNIT_SRC})+$`), "");

	// Strip leading / trailing plain whitespace left by empty groups.
	result = result.replace(/^\s+/, "").replace(/\s+$/, "");

	// Pure ANSI (or empty) leftovers are not useful content.
	if (result.replace(new RegExp(ANSI_ONE_SRC, "g"), "").trim() === "") return "";

	return result;
}
