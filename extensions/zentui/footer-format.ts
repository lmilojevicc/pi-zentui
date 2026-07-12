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
	tokens: FormatToken[],
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

function findTopLevelFillIndices(tokens: FormatToken[]): number[] {
	const fillIndices: number[] = [];
	for (let index = 0; index < tokens.length; index++) {
		if (tokens[index]?.kind === "fill") fillIndices.push(index);
	}
	return fillIndices;
}

function renderTokenSlice(
	tokens: FormatToken[],
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

function renderToken(token: FormatToken, renderVariable: (name: string) => string): string {
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
	group: FormatToken & { kind: "group" },
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

function groupOnlyNonContentVars(group: FormatToken & { kind: "group" }): boolean {
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
