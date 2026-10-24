/**
 * Semantic Bash command tokenizer and foreground-only painter for the `$ <command>`
 * tool-call row. No filesystem, PATH, process, or environment access: classification
 * is purely lexical, so rendering never blocks on the host and never executes input.
 *
 * Invariant: the tokens of a batch cover the input exactly once, in order, from byte 0
 * to the end of the input. Tokens are stored as `(kind, start)` pairs so tokenizing a
 * long command allocates two small integer arrays instead of one object and one string
 * per token.
 */
const MAX_DEPTH = 32;
/** Bounded `name[...]` lookahead: a 33-byte bound would reject `m["a longer key"]`. */
const MAX_SUBSCRIPT_LOOKAHEAD = 64;

export const BASH_TOKEN_KINDS = [
	"command",
	"builtin",
	"keyword",
	"variable",
	"assignmentName",
	"assignmentOp",
	"string",
	"number",
	"glob",
	"path",
	"option",
	"operator",
	"redirection",
	"substDelim",
	"arith",
	"continuation",
	"comment",
	"heredocBody",
	"heredocEnd",
	"arg",
	"space",
] as const;
export type BashTokenKind = (typeof BASH_TOKEN_KINDS)[number];

export interface BashToken {
	readonly kind: BashTokenKind;
	readonly text: string;
}

/** Numeric kind codes used by the tokenizer/painter hot paths. */
const K_COMMAND = 0;
const K_BUILTIN = 1;
const K_KEYWORD = 2;
const K_VARIABLE = 3;
const K_ASSIGNMENT_NAME = 4;
const K_ASSIGNMENT_OP = 5;
const K_STRING = 6;
const K_NUMBER = 7;
const K_GLOB = 8;
const K_PATH = 9;
const K_OPTION = 10;
const K_OPERATOR = 11;
const K_REDIRECTION = 12;
const K_SUBST_DELIM = 13;
const K_ARITH = 14;
const K_CONTINUATION = 15;
const K_COMMENT = 16;
const K_HEREDOC_BODY = 17;
const K_HEREDOC_END = 18;
const K_ARG = 19;
const K_SPACE = 20;
const KIND_COUNT = 21;
/** Token/byte counts above which a row is dense enough to degrade gracefully. */
const DEGRADE_MIN_TOKENS = 256;
const DEGRADE_MIN_CHARS = 1024;
/**
 * Hard per-row budget of 96 opening foreground SGRs plus their resets (≤ 193 SGRs total,
 * since a row can also close with one reset). A long dense row keeps the color of its
 * leading words and the tail after the budget stays at the terminal default: the host's
 * ANSI-aware wrapping then stays linear in the row's visible width, and one pathological
 * command can never multiply every repaint of the card. Rows under the degrade threshold
 * never reach this bound.
 */
const MAX_PAINTED_SPANS = 96;
/** Absolute per-row ceiling for rows below the degrade threshold. */
const MAX_TOTAL_SPANS = 1024;
const LOW_SIGNAL_KIND = new Uint8Array(KIND_COUNT);
for (const code of [
	K_NUMBER,
	K_OPTION,
	K_OPERATOR,
	K_REDIRECTION,
	K_SUBST_DELIM,
	K_ARITH,
	K_CONTINUATION,
	K_HEREDOC_END,
]) {
	LOW_SIGNAL_KIND[code] = 1;
}
const KIND_CODE: Readonly<Record<BashTokenKind, number>> = {
	command: K_COMMAND,
	builtin: K_BUILTIN,
	keyword: K_KEYWORD,
	variable: K_VARIABLE,
	assignmentName: K_ASSIGNMENT_NAME,
	assignmentOp: K_ASSIGNMENT_OP,
	string: K_STRING,
	number: K_NUMBER,
	glob: K_GLOB,
	path: K_PATH,
	option: K_OPTION,
	operator: K_OPERATOR,
	redirection: K_REDIRECTION,
	substDelim: K_SUBST_DELIM,
	arith: K_ARITH,
	continuation: K_CONTINUATION,
	comment: K_COMMENT,
	heredocBody: K_HEREDOC_BODY,
	heredocEnd: K_HEREDOC_END,
	arg: K_ARG,
	space: K_SPACE,
};

export type BashRole =
	| "verb"
	| "keyword"
	| "literal"
	| "flag"
	| "path"
	| "variable"
	| "structural"
	| "redirect"
	| "quiet";

/**
 * Palette variant A (semantic). Roles resolve their candidates in order against the
 * live theme; a resolved color already owned by another role is skipped unless the
 * role declares a merge, then the role borrows a declared source before staying
 * unpainted (terminal default). Collisions never reuse a color silently.
 */
export const BASH_ROLE_ORDER: readonly BashRole[] = [
	"verb",
	"keyword",
	"literal",
	"flag",
	"path",
	"variable",
	"structural",
	"redirect",
	"quiet",
];

export const BASH_ROLE_TOKENS: Readonly<Record<BashRole, readonly string[]>> = {
	verb: ["success", "syntaxFunction", "accent"],
	keyword: ["syntaxKeyword", "syntaxType", "accent"],
	literal: ["warning", "syntaxString", "mdCode"],
	flag: ["syntaxNumber", "mdCode", "bashMode"],
	path: ["mdLinkUrl", "syntaxFunction", "accent"],
	variable: ["accent", "syntaxVariable", "mdLink", "syntaxType", "syntaxString", "error"],
	structural: ["syntaxPunctuation", "muted", "dim"],
	redirect: ["syntaxOperator", "syntaxFunction", "accent"],
	quiet: ["syntaxComment", "muted", "dim"],
};

/** Variant A declares no intentional merges; collisions fall through, borrow, or stay base. */
export const BASH_ROLE_MERGES: readonly (readonly BashRole[])[] = [];

/** Declared borrow table: a role with no free candidate may reuse this resolved source. */
export const BASH_ROLE_BORROWS: Readonly<Partial<Record<BashRole, readonly BashRole[]>>> = {
	redirect: ["structural"],
	quiet: ["structural"],
};

/** Every primary and fallback theme token the semantic palette can sample. */
export const BASH_SYNTAX_THEME_TOKENS: readonly string[] = [
	...new Set(BASH_ROLE_ORDER.flatMap((role) => BASH_ROLE_TOKENS[role])),
];

export const BASH_KIND_ROLES: Readonly<Record<BashTokenKind, BashRole | null>> = {
	command: "verb",
	builtin: "verb",
	keyword: "keyword",
	string: "literal",
	option: "flag",
	number: "flag",
	path: "path",
	glob: "path",
	variable: "variable",
	assignmentName: "variable",
	operator: "structural",
	continuation: "structural",
	substDelim: "structural",
	assignmentOp: "structural",
	arith: "structural",
	redirection: "redirect",
	comment: "quiet",
	// Heredoc payload is what the user reads: literal text keeps AA contrast on light
	// themes, where every quiet candidate is already owned by path/structural.
	heredocBody: "literal",
	heredocEnd: "quiet",
	arg: null,
	space: null,
};

export interface BashPaletteColor {
	readonly role: BashRole;
	readonly token: string | null;
	/** Opening foreground SGR, or undefined when the role stays terminal default. */
	readonly ansi: string | undefined;
	readonly borrowedFrom?: BashRole;
}

export interface BashPalette {
	readonly roles: Readonly<Record<BashRole, BashPaletteColor>>;
	/** Per-kind opening SGR; arg/space are always undefined (terminal default). */
	readonly kindAnsi: Readonly<Record<BashTokenKind, string | undefined>>;
	/** Per-numeric-kind opening SGR used by the painter's inner loop. */
	readonly kindAnsiByCode: readonly (string | undefined)[];
	/** Tokens actually resolved for this palette; used for the non-colors revision probe. */
	readonly usedTokens: readonly string[];
	readonly unpainted: readonly BashRole[];
}

export interface BashPaletteTheme {
	fg(color: string, text: string): string;
	/** Pi's stable theme proxy exposes the current instance's concrete color record. */
	readonly colors?: object;
	getColorMode?(): string;
	getFgAnsi?(color: string): string;
}

const KEYWORDS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"for",
	"while",
	"until",
	"do",
	"done",
	"case",
	"esac",
	"in",
	"function",
	"select",
	"coproc",
]);
const KEYWORDS_RESUME_COMMAND = new Set([
	"if",
	"then",
	"else",
	"elif",
	"while",
	"until",
	"do",
	"coproc",
]);
const BUILTINS = new Set([
	"[",
	"alias",
	"bg",
	"builtin",
	"cd",
	"command",
	"declare",
	"dirs",
	"disown",
	"echo",
	"enable",
	"eval",
	"exec",
	"exit",
	"export",
	"false",
	"fc",
	"fg",
	"getopts",
	"hash",
	"help",
	"history",
	"jobs",
	"kill",
	"let",
	"local",
	"logout",
	"mapfile",
	"popd",
	"printf",
	"pushd",
	"pwd",
	"read",
	"readarray",
	"readonly",
	"return",
	"set",
	"shift",
	"shopt",
	"source",
	"suspend",
	"test",
	"times",
	"trap",
	"true",
	"type",
	"typeset",
	"ulimit",
	"umask",
	"unalias",
	"unset",
	"wait",
]);
const MAX_KEYWORD_LENGTH = 8;
const MAX_WRAPPER_NAME_LENGTH = 8;
const COMPARISON_OPERATORS = new Set([
	"=",
	"==",
	"!=",
	"=~",
	"<",
	">",
	"-eq",
	"-ne",
	"-lt",
	"-le",
	"-gt",
	"-ge",
]);
const EXEC_OPTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

interface WrapperDefinition {
	readonly optsWithValue: ReadonlySet<string>;
	readonly positionals: number;
	readonly assignments: boolean;
}
interface WrapperState {
	readonly optsWithValue: ReadonlySet<string>;
	positionals: number;
	readonly assignments: boolean;
	pendingValue: boolean;
}
const WRAPPERS = new Map<string, WrapperDefinition>();
function defineWrapper(
	name: string,
	optsWithValue: readonly string[],
	positionals = 0,
	assignments = false,
): void {
	WRAPPERS.set(name, { optsWithValue: new Set(optsWithValue), positionals, assignments });
}
defineWrapper(
	"sudo",
	[
		"-u",
		"-g",
		"-h",
		"-p",
		"-C",
		"-D",
		"-r",
		"-t",
		"-T",
		"-U",
		"-R",
		"--user",
		"--group",
		"--host",
		"--prompt",
		"--role",
		"--type",
		"--other-user",
		"--chdir",
		"--chroot",
		"--close-from",
		"--command-timeout",
	],
	0,
	true,
);
defineWrapper("doas", ["-u", "-C"]);
defineWrapper("time", [], 0, true);
defineWrapper("env", ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"], 0, true);
defineWrapper("timeout", ["-s", "-k", "--signal", "--kill-after"], 1);
defineWrapper("nice", ["-n", "--adjustment"]);
defineWrapper("nohup", []);
defineWrapper("command", ["-a"]);
defineWrapper("builtin", []);
defineWrapper("exec", ["-a"]);
defineWrapper("xargs", [
	"-n",
	"-I",
	"-P",
	"-L",
	"-s",
	"-d",
	"-a",
	"-E",
	"-J",
	"-R",
	"--max-args",
	"--replace",
	"--max-procs",
	"--max-lines",
	"--max-chars",
	"--delimiter",
	"--arg-file",
	"--eof",
	"--max-replace-args",
]);
defineWrapper("stdbuf", ["-i", "-o", "-e", "--input", "--output", "--error"]);
defineWrapper("setsid", []);
defineWrapper("ionice", [
	"-c",
	"-n",
	"-p",
	"-t",
	"-P",
	"-u",
	"--class",
	"--classdata",
	"--pid",
	"--uid",
]);
defineWrapper(
	"chrt",
	["-p", "-o", "-T", "-D", "-P", "--pid", "--sched-runtime", "--deadline", "--period"],
	1,
);
defineWrapper("taskset", ["-p"], 1);

/**
 * Every command-position word resolves with a single hash lookup instead of one
 * `KEYWORDS`/`WRAPPERS`/`BUILTINS` probe per set. The value packs the token kind with
 * the command-position action: resume (`if`/`then`/`do`/…), `for` header,
 * `function` declaration, the `time` keyword, a wrapper, or a plain word.
 */
const CMD_RESUME = 1;
const CMD_FOR_HEADER = 2;
const CMD_FUNCTION = 3;
const CMD_TIME = 4;
const CMD_WRAPPER = 5;
const COMMAND_CLASS = new Map<string, number>();
function defineCommandClass(word: string, kind: number, action: number): void {
	COMMAND_CLASS.set(word, (kind << 3) | action);
}
for (const word of KEYWORDS) {
	defineCommandClass(
		word,
		K_KEYWORD,
		KEYWORDS_RESUME_COMMAND.has(word)
			? CMD_RESUME
			: word === "for" || word === "select"
				? CMD_FOR_HEADER
				: word === "function"
					? CMD_FUNCTION
					: 0,
	);
}
for (const word of BUILTINS) {
	if (!KEYWORDS.has(word))
		defineCommandClass(word, K_BUILTIN, WRAPPERS.has(word) ? CMD_WRAPPER : 0);
}
for (const word of WRAPPERS.keys()) {
	if (word === "time") defineCommandClass(word, K_KEYWORD, CMD_TIME);
	else if (!COMMAND_CLASS.has(word))
		defineCommandClass(word, BUILTINS.has(word) ? K_BUILTIN : K_COMMAND, CMD_WRAPPER);
}

const STOP_NONE = 0;
const STOP_BACKTICK = 1;
const STOP_PAREN = 2;

// Table-driven ASCII scans keep the tokenizer's per-byte hot loops branch-light.
const SPACE_CODE = new Uint8Array(128);
for (const code of [32, 9, 10, 13]) SPACE_CODE[code] = 1;
/** Bytes that end an unquoted word. `(`, `\`, and `$` are handled separately. */
const WORD_STOP = new Uint8Array(128);
for (const code of [32, 9, 10, 13, 59, 124, 38, 40, 41, 60, 62, 96, 39, 34, 36, 92]) {
	WORD_STOP[code] = 1;
}

function isSpaceCode(code: number): boolean {
	return code < 128 && SPACE_CODE[code] === 1;
}
/** `$[A-Za-z_][A-Za-z0-9_]*` or `$[0-9@*#$?!\-_]+`; -1 when `$` starts no variable. */
function scanVariableEnd(text: string, start: number): number {
	let index = start + 1;
	let code = text.charCodeAt(index);
	if (isAlphaCode(code)) {
		index++;
		while (index < text.length) {
			code = text.charCodeAt(index);
			if (!isWordCode(code)) break;
			index++;
		}
		return index;
	}
	if (
		(code >= 48 && code <= 57) ||
		code === 64 ||
		code === 42 ||
		code === 35 ||
		code === 36 ||
		code === 63 ||
		code === 33 ||
		code === 45 ||
		code === 95
	) {
		index++;
		while (index < text.length) {
			code = text.charCodeAt(index);
			if (
				!(code >= 48 && code <= 57) &&
				code !== 64 &&
				code !== 42 &&
				code !== 35 &&
				code !== 36 &&
				code !== 63 &&
				code !== 33 &&
				code !== 45 &&
				code !== 95
			)
				break;
			index++;
		}
		return index;
	}
	return -1;
}
function isAlphaCode(code: number): boolean {
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}
function isDigitCode(code: number): boolean {
	return code >= 48 && code <= 57;
}
function isWordCode(code: number): boolean {
	return isAlphaCode(code) || isDigitCode(code);
}

/** `-?\d+(\.\d+)?([eE][+-]?\d+)?` without a regex or a temporary string. */
function isNumberRange(text: string, start: number, end: number): boolean {
	let index = start;
	if (index < end && text.charCodeAt(index) === 45) index++;
	let digits = 0;
	while (index < end && isDigitCode(text.charCodeAt(index))) {
		index++;
		digits++;
	}
	if (index < end && text.charCodeAt(index) === 46) {
		index++;
		let fraction = 0;
		while (index < end && isDigitCode(text.charCodeAt(index))) {
			index++;
			fraction++;
		}
		if (fraction === 0) return false;
		digits += fraction;
	}
	if (digits === 0) return false;
	if (index < end) {
		const code = text.charCodeAt(index);
		if (code !== 101 && code !== 69) return false;
		index++;
		if (index < end) {
			const sign = text.charCodeAt(index);
			if (sign === 43 || sign === 45) index++;
		}
		let exponent = 0;
		while (index < end && isDigitCode(text.charCodeAt(index))) {
			index++;
			exponent++;
		}
		if (exponent === 0) return false;
	}
	return index === end;
}

/** `-3` stays an option-like flag byte pattern; `-3.5` and `-10` are values. */
function isNegativeNumberLikeRange(text: string, start: number, end: number): boolean {
	if (!isNumberRange(text, start, end)) return false;
	for (let index = start; index < end; index++) {
		if (text.charCodeAt(index) === 46) return true;
	}
	// Magnitude >= 10 (same threshold as the historical `Number(word)` check).
	let index = start;
	if (text.charCodeAt(index) === 45) index++;
	let value = 0;
	for (; index < end && isDigitCode(text.charCodeAt(index)); index++) {
		value = value * 10 + (text.charCodeAt(index) - 48);
		if (value >= 10) return true;
	}
	return false;
}

function looksLikeOptionRange(text: string, start: number, end: number): boolean {
	if (end - start < 2 || text.charCodeAt(start) !== 45) return false;
	const second = text.charCodeAt(start + 1);
	if (second === 45) return end - start > 2 && text.charCodeAt(start + 2) !== 61;
	if (second === 61) return false;
	if (isDigitCode(second) || second === 46) return !isNegativeNumberLikeRange(text, start, end);
	return isWordCode(second);
}

function classifyValueAt(text: string, start: number, end: number): number {
	const first = text.charCodeAt(start);
	// Skip the numeric/path/glob scans for the common letter-leading argument.
	if (first >= 48 && first <= 57) {
		if (isNumberRange(text, start, end)) return K_NUMBER;
	} else if (first === 46) {
		if (isNumberRange(text, start, end)) return K_NUMBER;
	} else if (first === 45 && end - start > 1) {
		if (isNumberRange(text, start, end)) return K_NUMBER;
	}
	// One scan for both path/glob evidence and the `scheme://` URI prefix.
	let path = first === 126 || first === 47;
	if (first === 46) {
		if (end - start === 1) path = true;
		else {
			const second = text.charCodeAt(start + 1);
			if ((second === 46 && end - start === 2) || second === 47) path = true;
		}
	}
	const globAllowed = first !== 45;
	let glob =
		globAllowed &&
		(first === 42 ||
			first === 63 ||
			first === 91 ||
			((first === 64 || first === 33 || first === 43) && text.charCodeAt(start + 1) === 40));
	for (let index = start + 1; index < end; index++) {
		const code = text.charCodeAt(index);
		if (code === 47) {
			path = true;
			continue;
		}
		if (code === 58 && text.charCodeAt(index + 1) === 47 && text.charCodeAt(index + 2) === 47)
			return K_ARG;
		if (globAllowed && (code === 42 || code === 63 || code === 91)) glob = true;
		else if (
			globAllowed &&
			(code === 64 || code === 33 || code === 43) &&
			text.charCodeAt(index + 1) === 40
		)
			glob = true;
	}
	if (path) return K_PATH;
	if (glob) return K_GLOB;
	return K_ARG;
}

function equalsAt(text: string, start: number, end: number, literal: string): boolean {
	if (end - start !== literal.length) return false;
	for (let index = 0; index < literal.length; index++) {
		if (text.charCodeAt(start + index) !== literal.charCodeAt(index)) return false;
	}
	return true;
}

function newWrapper(name: string): WrapperState | null {
	const definition = WRAPPERS.get(name);
	return definition
		? {
				optsWithValue: definition.optsWithValue,
				positionals: definition.positionals,
				assignments: definition.assignments,
				pendingValue: false,
			}
		: null;
}

/** Returns the index after `name(+)=`, or -1 when no assignment starts here. */
function scanAssignment(text: string, start: number): number {
	const length = text.length;
	const first = text.charCodeAt(start);
	if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95)) return -1;
	let index = start + 1;
	while (index < length) {
		const code = text.charCodeAt(index);
		if (
			(code >= 97 && code <= 122) ||
			(code >= 65 && code <= 90) ||
			(code >= 48 && code <= 57) ||
			code === 95
		)
			index++;
		else break;
	}
	if (text.charCodeAt(index) === 91) {
		// Array subscript: name[...]=. The lookahead is bounded, so an `a[` run that never
		// closes costs a constant scan per byte instead of a quadratic one; past the window
		// the word degrades to a plain command/glob, which is accepted.
		const limit = Math.min(length, index + MAX_SUBSCRIPT_LOOKAHEAD);
		let close = -1;
		for (let scan = index + 1; scan < limit; scan++) {
			if (text.charCodeAt(scan) === 93) {
				close = scan;
				break;
			}
		}
		if (close < 0) return -1;
		index = close + 1;
	}
	if (text.charCodeAt(index) === 43) index++;
	if (text.charCodeAt(index) !== 61) return -1;
	return index + 1;
}

function findArithmeticEnd(text: string, start: number): number {
	let depth = 0;
	for (let index = start; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 92) {
			index++;
			continue;
		}
		if (code === 40) depth++;
		else if (code === 41) {
			if (depth === 0 && text.charCodeAt(index + 1) === 41) return index;
			depth = Math.max(0, depth - 1);
		}
	}
	return text.length;
}

function findBalancedBrace(text: string, start: number): number {
	let depth = 1;
	for (let index = start; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code === 92) {
			index++;
			continue;
		}
		if (code === 123) depth++;
		else if (code === 125) {
			depth--;
			if (depth === 0) return index + 1;
		}
	}
	return text.length;
}

/** Returns the index after the matching `)`, or -1 when unbalanced. */
function findMatchingParen(text: string, start: number): number {
	let depth = 1;
	let index = start;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code === 92) {
			index += 2;
			continue;
		}
		if (code === 39) {
			const close = text.indexOf("'", index + 1);
			index = close < 0 ? text.length : close + 1;
			continue;
		}
		if (code === 34) {
			index++;
			while (index < text.length) {
				const inner = text.charCodeAt(index);
				if (inner === 92) {
					index += 2;
					continue;
				}
				index++;
				if (inner === 34) break;
			}
			continue;
		}
		if (code === 40) depth++;
		else if (code === 41) {
			depth--;
			if (depth === 0) return index + 1;
		}
		index++;
	}
	return -1;
}

function isExtglobPrefix(code: number): boolean {
	return code === 64 || code === 42 || code === 43 || code === 63 || code === 33;
}
function isGlobTokenStart(text: string, index: number): boolean {
	const code = text.charCodeAt(index);
	if (!isExtglobPrefix(code) || text.charCodeAt(index + 1) !== 40) return false;
	if (index === 0) return true;
	const previous = text.charCodeAt(index - 1);
	return (
		isSpaceCode(previous) ||
		previous === 59 ||
		previous === 124 ||
		previous === 38 ||
		previous === 40 ||
		previous === 41 ||
		previous === 123 ||
		previous === 125 ||
		previous === 60 ||
		previous === 62
	);
}

interface Heredoc {
	terminator: string;
	stripTabs: boolean;
}
interface ScanContext {
	heredocs: Heredoc[];
}
type TokenPush = (kind: number, start: number) => void;

const CASE_SUBJECT = 0;
const CASE_IN = 1;
const CASE_PATTERN = 2;
const CASE_BODY = 3;
function consumeHeredocs(
	text: string,
	start: number,
	context: ScanContext,
	push: TokenPush,
): number {
	let index = start;
	while (context.heredocs.length > 0) {
		const heredoc = context.heredocs[0];
		let matched = false;
		while (index < text.length) {
			const newline = text.indexOf("\n", index);
			const lineEnd = newline < 0 ? text.length : newline;
			const chunkEnd = newline < 0 ? text.length : newline + 1;
			// CRLF bodies end their lines with \r; the terminator comparison ignores it.
			let compareEnd = lineEnd;
			if (compareEnd > index && text.charCodeAt(compareEnd - 1) === 13) compareEnd--;
			let compareStart = index;
			if (heredoc.stripTabs) {
				while (compareStart < compareEnd && text.charCodeAt(compareStart) === 9) compareStart++;
			}
			if (equalsAt(text, compareStart, compareEnd, heredoc.terminator)) {
				push(K_HEREDOC_END, index);
				index = chunkEnd;
				matched = true;
				break;
			}
			push(K_HEREDOC_BODY, index);
			index = chunkEnd;
		}
		context.heredocs.shift();
		if (!matched && index >= text.length) break;
	}
	return index;
}

function scanDollar(
	text: string,
	start: number,
	depth: number,
	context: ScanContext,
	push: TokenPush,
): number | null {
	if (text.startsWith("$((", start)) {
		const end = findArithmeticEnd(text, start + 3);
		push(K_SUBST_DELIM, start);
		push(K_ARITH, start + 3);
		if (text.startsWith("))", end)) {
			push(K_SUBST_DELIM, end);
			return end + 2;
		}
		return end;
	}
	if (text.startsWith("$(", start)) {
		push(K_SUBST_DELIM, start);
		const end = scanCommand(text, start + 2, STOP_PAREN, depth + 1, context, push);
		let index = end;
		if (text.charCodeAt(index) === 41) {
			push(K_SUBST_DELIM, index);
			index++;
		}
		return index;
	}
	if (text.startsWith("${", start)) {
		const end = findBalancedBrace(text, start + 2);
		push(K_VARIABLE, start);
		return end;
	}
	const end = scanVariableEnd(text, start);
	if (end > start) {
		push(K_VARIABLE, start);
		return end;
	}
	return null;
}

function scanDoubleQuotes(
	text: string,
	start: number,
	depth: number,
	context: ScanContext,
	push: TokenPush,
): number {
	const length = text.length;
	let index = start + 1;
	let bufferStart = start;
	while (index < length) {
		const code = text.charCodeAt(index);
		if (code === 92) {
			index += 2;
			continue;
		}
		if (code === 34) {
			push(K_STRING, bufferStart);
			return index + 1;
		}
		if (code === 36 || code === 96) {
			if (index > bufferStart) push(K_STRING, bufferStart);
			if (code === 96) {
				push(K_SUBST_DELIM, index);
				const end = scanCommand(text, index + 1, STOP_BACKTICK, depth + 1, context, push);
				index = end;
				if (text.charCodeAt(index) === 96) {
					push(K_SUBST_DELIM, index);
					index++;
				}
			} else {
				const end = scanDollar(text, index, depth, context, push);
				if (end === null) {
					push(K_STRING, index);
					index++;
				} else index = end;
			}
			bufferStart = index;
			continue;
		}
		index++;
	}
	if (index > bufferStart) push(K_STRING, bufferStart);
	return length;
}

function scanRedirection(
	text: string,
	start: number,
): { end: number; heredoc: boolean; stripTabs: boolean; target: boolean } {
	const length = text.length;
	let index = start;
	let code = text.charCodeAt(index);
	if (isDigitCode(code)) {
		while (index < length && isDigitCode(text.charCodeAt(index))) index++;
		code = text.charCodeAt(index);
	} else if (code === 123) {
		const close = text.indexOf("}", index + 1);
		if (close > index) {
			index = close + 1;
			code = text.charCodeAt(index);
		}
	}
	if (code === 38) {
		// &> / &>>
		index += 2;
		if (text.charCodeAt(index) === 62) index++;
		return { end: index, heredoc: false, stripTabs: false, target: true };
	}
	if (code === 60) {
		const next = text.charCodeAt(index + 1);
		if (next === 60) {
			const third = text.charCodeAt(index + 2);
			if (third === 60) return { end: index + 3, heredoc: false, stripTabs: false, target: true };
			if (third === 45) return { end: index + 3, heredoc: true, stripTabs: true, target: false };
			return { end: index + 2, heredoc: true, stripTabs: false, target: false };
		}
		if (next === 38) {
			index += 2;
			const dup = text.charCodeAt(index);
			if (dup === 45) index++;
			else while (index < length && isDigitCode(text.charCodeAt(index))) index++;
			return { end: index, heredoc: false, stripTabs: false, target: false };
		}
		if (next === 62) return { end: index + 2, heredoc: false, stripTabs: false, target: true };
		return { end: index + 1, heredoc: false, stripTabs: false, target: true };
	}
	if (code === 62) {
		const next = text.charCodeAt(index + 1);
		if (next === 62) return { end: index + 2, heredoc: false, stripTabs: false, target: true };
		if (next === 38) {
			index += 2;
			const dup = text.charCodeAt(index);
			if (dup === 45) index++;
			else while (index < length && isDigitCode(text.charCodeAt(index))) index++;
			return { end: index, heredoc: false, stripTabs: false, target: false };
		}
		if (next === 124) return { end: index + 2, heredoc: false, stripTabs: false, target: true };
		return { end: index + 1, heredoc: false, stripTabs: false, target: true };
	}
	return { end: index + 1, heredoc: false, stripTabs: false, target: false };
}

function normalizeHeredocWord(word: string): string {
	// A trailing backslash-newline is a continuation, not part of the delimiter.
	const continued = word.replace(/\\\r?\n$/, "");
	return continued.replace(/\\(.)/g, "$1");
}

function scanCommand(
	text: string,
	start: number,
	stop: number,
	depth: number,
	context: ScanContext,
	push: TokenPush,
): number {
	const length = text.length;
	let index = start;
	let commandPosition = true;
	let endOfOptions = false;
	let wrapper: WrapperState | null = null;
	let forHeader = false;
	let afterAssignmentOp = false;
	let expectRedirectionTarget = false;
	let expectHeredocDelimiter = false;
	let heredocStripTabs = false;
	// Accumulated heredoc delimiter parts: `<<E'O'F` registers `EOF`, not `E`.
	let heredocDelimiter = "";
	// Index where the last word part ended, so a `#` glued to a quote/expansion is a word
	// byte and not a comment start.
	let wordPartEnd = -1;
	let parenDepth = 0;
	let assignmentParenDepth = 0;
	let execPending = false;
	let inConditional = false;
	const caseStack: number[] = [];

	const resetCommand = (): void => {
		commandPosition = true;
		endOfOptions = false;
		wrapper = null;
		forHeader = false;
		afterAssignmentOp = false;
		expectRedirectionTarget = false;
		expectHeredocDelimiter = false;
		heredocDelimiter = "";
		execPending = false;
		assignmentParenDepth = 0;
	};
	const registerHeredoc = (terminator: string): void => {
		context.heredocs.push({ terminator, stripTabs: heredocStripTabs });
		expectHeredocDelimiter = false;
		heredocDelimiter = "";
	};
	/** A quoted/variable/substitution word consumes the command or assignment value slot. */
	const settleWord = (): void => {
		// A quoted, variable or substitution part is part of the assignment value: the
		// value ends at whitespace, an operator, a `(` or a redirection, not after one part.
		if (afterAssignmentOp) return;
		if (expectRedirectionTarget) {
			expectRedirectionTarget = false;
			return;
		}
		if (inConditional) return;
		const phase = caseStack.length > 0 ? caseStack[caseStack.length - 1] : -1;
		if (phase === CASE_SUBJECT) {
			caseStack[caseStack.length - 1] = CASE_IN;
			commandPosition = false;
			return;
		}
		if (wrapper) {
			if (wrapper.pendingValue) {
				wrapper.pendingValue = false;
				return;
			}
			wrapper = null;
			commandPosition = false;
			return;
		}
		if (commandPosition) commandPosition = false;
	};

	// Nested commands past the safety depth emit one ARG token for the remainder.
	const tooDeep = depth > MAX_DEPTH;
	while (index < length) {
		const code = text.charCodeAt(index);

		// The delimiter word ends at whitespace or a metacharacter; register the parts
		// accumulated so far (`<<E'O'F` is the delimiter `EOF`).
		if (expectHeredocDelimiter && heredocDelimiter !== "" && endsHeredocWord(code))
			registerHeredoc(heredocDelimiter);

		if (stop !== STOP_NONE) {
			if (stop === STOP_BACKTICK && code === 96) return index;
			// A `)` that closes a case pattern (`a)`) does not end a `$( … )`.
			if (
				stop === STOP_PAREN &&
				code === 41 &&
				parenDepth === 0 &&
				(caseStack.length === 0 || caseStack[caseStack.length - 1] !== CASE_PATTERN)
			)
				return index;
		}

		if (code === 92) {
			const next = text.charCodeAt(index + 1);
			if (next === 10) {
				push(K_CONTINUATION, index);
				index += 2;
				continue;
			}
			if (next === 13 && text.charCodeAt(index + 2) === 10) {
				push(K_CONTINUATION, index);
				index += 3;
				continue;
			}
		}

		if (code === 32) {
			// Space is by far the commonest whitespace byte; skip the general scan.
			let next = index + 1;
			while (text.charCodeAt(next) === 32) next++;
			push(K_SPACE, index);
			index = next;
			if (afterAssignmentOp) afterAssignmentOp = false;
			continue;
		}
		if (isSpaceCode(code)) {
			let next = index;
			let newline = -1;
			while (next < length && isSpaceCode(text.charCodeAt(next))) {
				if (text.charCodeAt(next) === 10 && newline < 0) newline = next;
				next++;
			}
			if (context.heredocs.length > 0 && newline >= 0) {
				// Only the newline terminating the command line starts the bodies.
				const lineEnd = newline + 1;
				push(K_SPACE, index);
				index = consumeHeredocs(text, lineEnd, context, push);
				if (assignmentParenDepth === 0) resetCommand();
				continue;
			}
			push(K_SPACE, index);
			index = next;
			// A newline inside an array literal does not end the command word list.
			if (newline >= 0) {
				if (assignmentParenDepth === 0) resetCommand();
			}
			// An empty assignment value (`FOO= cmd`) ends at the whitespace; a value
			// can never be separated from `=` by a space.
			else if (afterAssignmentOp) afterAssignmentOp = false;
			continue;
		}

		if (code === 59 || code === 124 || (code === 38 && text.charCodeAt(index + 1) !== 62)) {
			// Operators are the commonest non-space token in flag/pipe-dense rows, so they
			// are dispatched before the quote/redirection/paren checks.
			const operatorStart = index;
			index++;
			if (code === 59) {
				if (text.charCodeAt(index) === 59) {
					index++;
					if (text.charCodeAt(index) === 38) index++;
				} else if (text.charCodeAt(index) === 38) {
					index++;
				}
			} else if (code === 124) {
				const next = text.charCodeAt(index);
				if (next === 124 || next === 38) index++;
			} else if (text.charCodeAt(index) === 38) {
				index++;
			}
			push(K_OPERATOR, operatorStart);
			const phase = caseStack.length > 0 ? caseStack[caseStack.length - 1] : -1;
			// `;;`, `;;&`, `;&` end a case item; compare bytes instead of allocating the
			// operator substring on every `;`/`|`/`&` (operator-dense rows are common).
			const caseTerminator =
				phase === CASE_BODY &&
				index - operatorStart >= 2 &&
				text.charCodeAt(operatorStart) === 59 &&
				(text.charCodeAt(operatorStart + 1) === 59 || text.charCodeAt(operatorStart + 1) === 38);
			if (caseTerminator) {
				caseStack[caseStack.length - 1] = CASE_PATTERN;
				commandPosition = true;
			} else if (inConditional || phase === CASE_PATTERN) {
				commandPosition = false;
			} else {
				commandPosition = true;
			}
			endOfOptions = false;
			wrapper = null;
			forHeader = false;
			afterAssignmentOp = false;
			expectRedirectionTarget = false;
			execPending = false;
			continue;
		}

		if (
			code === 35 &&
			index !== wordPartEnd &&
			!afterAssignmentOp &&
			!expectRedirectionTarget &&
			!expectHeredocDelimiter
		) {
			// A `#` at a fresh word boundary is a comment; glued to a word part it is a word.
			let end = text.indexOf("\n", index);
			if (end < 0) end = length;
			push(K_COMMENT, index);
			index = end;
			continue;
		}

		if (tooDeep) {
			push(K_ARG, index);
			index = length;
			break;
		}

		if (code === 39) {
			// Single quote: literal, so the whole run (or the unterminated tail) is one string.
			const tokenStart = index;
			const close = text.indexOf("'", index + 1);
			const end = close < 0 ? length : close + 1;
			push(K_STRING, tokenStart);
			index = end;
			wordPartEnd = end;
			if (expectHeredocDelimiter) {
				heredocDelimiter += text.slice(tokenStart + 1, close < 0 ? length : close);
				continue;
			}
			settleWord();
			continue;
		}
		if (code === 36 && text.charCodeAt(index + 1) === 39) {
			// ANSI-C quoting $'...'
			const tokenStart = index;
			let end = index + 2;
			while (end < length) {
				const inner = text.charCodeAt(end);
				if (inner === 92) {
					end += 2;
					continue;
				}
				if (inner === 39) {
					end++;
					break;
				}
				end++;
			}
			push(K_STRING, tokenStart);
			const closed = text.charCodeAt(end - 1) === 39;
			index = end;
			wordPartEnd = end;
			if (expectHeredocDelimiter) {
				heredocDelimiter += text.slice(tokenStart + 2, closed ? end - 1 : end);
				continue;
			}
			settleWord();
			continue;
		}
		if (code === 34) {
			const tokenStart = index;
			const end = scanDoubleQuotes(text, index, depth, context, push);
			const closed = end > tokenStart + 1 && text.charCodeAt(end - 1) === 34;
			index = end;
			wordPartEnd = end;
			if (expectHeredocDelimiter) {
				heredocDelimiter += text.slice(tokenStart + 1, closed ? end - 1 : end);
				continue;
			}
			settleWord();
			continue;
		}
		if (code === 96) {
			const tokenStart = index;
			push(K_SUBST_DELIM, tokenStart);
			const end = scanCommand(text, index + 1, STOP_BACKTICK, depth + 1, context, push);
			index = end;
			if (text.charCodeAt(index) === 96) {
				push(K_SUBST_DELIM, index);
				index++;
			}
			wordPartEnd = index;
			if (expectHeredocDelimiter) {
				expectHeredocDelimiter = false;
				heredocDelimiter = "";
				continue;
			}
			settleWord();
			continue;
		}

		if ((code === 60 || code === 62) && text.charCodeAt(index + 1) === 40) {
			// Process substitution is one argument-like word.
			push(K_SUBST_DELIM, index);
			const end = scanCommand(text, index + 2, STOP_PAREN, depth + 1, context, push);
			index = end;
			if (text.charCodeAt(index) === 41) {
				push(K_SUBST_DELIM, index);
				index++;
			}
			wordPartEnd = index;
			if (expectHeredocDelimiter) {
				expectHeredocDelimiter = false;
				heredocDelimiter = "";
			} else settleWord();
			continue;
		}

		if (code === 36) {
			const tokenStart = index;
			const end = scanDollar(text, tokenStart, depth, context, push);
			if (end !== null) {
				index = end;
				wordPartEnd = end;
				if (expectHeredocDelimiter) {
					// `<<$X` uses the literal expansion text as the delimiter.
					heredocDelimiter += text.slice(tokenStart, end);
					continue;
				}
				settleWord();
				continue;
			}
			push(K_ARG, tokenStart);
			index++;
			wordPartEnd = index;
			settleWord();
			continue;
		}

		if (inConditional && (code === 60 || code === 62)) {
			push(K_OPERATOR, index);
			index++;
			continue;
		}

		if (
			(code === 64 || code === 42 || code === 43 || code === 63 || code === 33) &&
			isGlobTokenStart(text, index)
		) {
			const end = findMatchingParen(text, index + 2);
			const stopIndex = end < 0 ? length : end;
			push(K_GLOB, index);
			index = stopIndex;
			wordPartEnd = stopIndex;
			settleWord();
			continue;
		}

		if (
			code === 40 &&
			text.charCodeAt(index + 1) === 40 &&
			(commandPosition || forHeader || inConditional)
		) {
			// Arithmetic command and `for ((...))` header stay one token.
			const end = findArithmeticEnd(text, index + 2);
			const stopIndex = text.startsWith("))", end) ? end + 2 : end;
			push(K_ARITH, index);
			index = stopIndex;
			if (forHeader) {
				forHeader = false;
				commandPosition = true;
			} else if (afterAssignmentOp) {
				afterAssignmentOp = false;
			} else {
				commandPosition = !inConditional;
			}
			continue;
		}

		const fdStart =
			code === 60 ||
			code === 62 ||
			(code === 38 && text.charCodeAt(index + 1) === 62) ||
			(isDigitCode(code) && isRedirectionFd(text, index)) ||
			(code === 123 && isBraceRedirection(text, index));
		if (fdStart) {
			// A redirection ends any assignment value (`FOO=bar>baz cmd`).
			afterAssignmentOp = false;
			const redirection = scanRedirection(text, index);
			push(K_REDIRECTION, index);
			index = redirection.end;
			if (redirection.heredoc) {
				expectHeredocDelimiter = true;
				heredocDelimiter = "";
				heredocStripTabs = redirection.stripTabs;
				expectRedirectionTarget = false;
			} else if (redirection.target) {
				expectRedirectionTarget = true;
			} else {
				expectRedirectionTarget = false;
			}
			continue;
		}

		if (code === 40) {
			push(K_OPERATOR, index);
			index++;
			if (assignmentParenDepth > 0) {
				assignmentParenDepth++;
				continue;
			}
			// `name=(...)` / `name+=(...)`: an array literal, not a subshell. Its
			// elements are values, so the first element never arms command position.
			if (afterAssignmentOp || (index > 1 && text.charCodeAt(index - 2) === 61)) {
				assignmentParenDepth = 1;
				afterAssignmentOp = false;
				commandPosition = false;
				endOfOptions = false;
				wrapper = null;
				expectRedirectionTarget = false;
				execPending = false;
				continue;
			}
			parenDepth++;
			commandPosition = true;
			endOfOptions = false;
			wrapper = null;
			afterAssignmentOp = false;
			expectRedirectionTarget = false;
			execPending = false;
			continue;
		}
		if (code === 41) {
			push(K_OPERATOR, index);
			index++;
			if (assignmentParenDepth > 0) {
				assignmentParenDepth--;
				commandPosition = false;
				endOfOptions = false;
				wrapper = null;
				continue;
			}
			parenDepth = Math.max(0, parenDepth - 1);
			const phase = caseStack.length > 0 ? caseStack[caseStack.length - 1] : -1;
			if (phase === CASE_PATTERN) {
				caseStack[caseStack.length - 1] = CASE_BODY;
				commandPosition = true;
			} else commandPosition = false;
			endOfOptions = false;
			wrapper = null;
			continue;
		}
		if (code === 123 || code === 125) {
			const next = text.charCodeAt(index + 1);
			const operator =
				Number.isNaN(next) ||
				isSpaceCode(next) ||
				next === 59 ||
				next === 124 ||
				next === 38 ||
				next === 40 ||
				next === 41 ||
				next === 60 ||
				next === 62;
			if (operator) {
				push(K_OPERATOR, index);
				index++;
				commandPosition = code === 123;
				endOfOptions = false;
				wrapper = null;
				expectRedirectionTarget = false;
				continue;
			}
		}
		if (code === 33) {
			if (inConditional) {
				if (text.charCodeAt(index + 1) === 61) {
					push(K_OPERATOR, index);
					index += 2;
				} else {
					push(K_OPERATOR, index);
					index++;
				}
				continue;
			}
			const previous = index === 0 ? -1 : text.charCodeAt(index - 1);
			const atWordStart =
				index === 0 ||
				isSpaceCode(previous) ||
				previous === 59 ||
				previous === 124 ||
				previous === 38 ||
				previous === 40 ||
				previous === 41 ||
				previous === 123 ||
				previous === 125 ||
				previous === 60 ||
				previous === 62;
			// `!` negates only a command word; elsewhere it is an ordinary word byte.
			if (commandPosition && atWordStart) {
				push(K_OPERATOR, index);
				index++;
				continue;
			}
		}

		if (
			// `env -- FOO=1 cmd` and `sudo -- VAR=x cmd` still assign after `--`, so the
			// end-of-options marker does not end assignment parsing.
			(commandPosition || wrapper?.assignments) &&
			assignmentParenDepth === 0 &&
			!afterAssignmentOp &&
			!expectRedirectionTarget &&
			!expectHeredocDelimiter
		) {
			const assignmentEnd = scanAssignment(text, index);
			if (assignmentEnd > 0) {
				const plus = text.charCodeAt(assignmentEnd - 2) === 43;
				push(K_ASSIGNMENT_NAME, index);
				push(K_ASSIGNMENT_OP, plus ? assignmentEnd - 2 : assignmentEnd - 1);
				index = assignmentEnd;
				afterAssignmentOp = true;
				continue;
			}
		}

		// A word: stop only at shell metacharacters, honoring backslash escapes.
		const wordStart = index;
		let wordEnd = index;
		while (wordEnd < length) {
			const inner = text.charCodeAt(wordEnd);
			if (inner < 128) {
				if (WORD_STOP[inner] === 0) {
					wordEnd++;
					continue;
				}
				if (inner === 40) {
					if (wordEnd > wordStart && isExtglobPrefix(text.charCodeAt(wordEnd - 1))) {
						const close = findMatchingParen(text, wordEnd + 1);
						wordEnd = close < 0 ? length : close;
						continue;
					}
					break;
				}
				if (inner === 92) {
					wordEnd += text.charCodeAt(wordEnd + 1) === 13 ? 3 : 2;
					continue;
				}
				break;
			}
			wordEnd++;
		}
		if (wordEnd === wordStart) {
			// Unhandled single byte (for example a stray backslash): never loop.
			push(K_ARG, index);
			index++;
			continue;
		}
		index = wordEnd;
		wordPartEnd = wordEnd;

		if (assignmentParenDepth > 0) {
			push(classifyValueAt(text, wordStart, wordEnd), wordStart);
			continue;
		}
		if (expectHeredocDelimiter) {
			heredocDelimiter += normalizeHeredocWord(text.slice(wordStart, wordEnd));
			push(K_ARG, wordStart);
			continue;
		}
		if (afterAssignmentOp) {
			// A plain word continues the assignment value (`PATH=$PATH:/go/bin go build`).
			push(classifyValueAt(text, wordStart, wordEnd), wordStart);
			continue;
		}
		if (expectRedirectionTarget) {
			expectRedirectionTarget = false;
			push(classifyValueAt(text, wordStart, wordEnd), wordStart);
			continue;
		}
		if (inConditional) {
			if (equalsAt(text, wordStart, wordEnd, "]]")) {
				push(K_KEYWORD, wordStart);
				inConditional = false;
				commandPosition = false;
				continue;
			}
			const operator = COMPARISON_OPERATORS.has(text.slice(wordStart, wordEnd));
			push(operator ? K_OPERATOR : classifyValueAt(text, wordStart, wordEnd), wordStart);
			continue;
		}
		if (caseStack.length > 0) {
			const phase = caseStack[caseStack.length - 1];
			if (phase === CASE_SUBJECT) {
				push(classifyValueAt(text, wordStart, wordEnd), wordStart);
				caseStack[caseStack.length - 1] = CASE_IN;
				commandPosition = false;
				continue;
			}
			if (phase === CASE_IN) {
				if (equalsAt(text, wordStart, wordEnd, "in")) {
					push(K_KEYWORD, wordStart);
					caseStack[caseStack.length - 1] = CASE_PATTERN;
					commandPosition = false;
				} else if (equalsAt(text, wordStart, wordEnd, "esac")) {
					push(K_KEYWORD, wordStart);
					caseStack.pop();
					commandPosition = false;
				} else push(classifyValueAt(text, wordStart, wordEnd), wordStart);
				continue;
			}
			if (phase === CASE_PATTERN) {
				// Only `a|esac)` keeps `esac` as a pattern; everywhere else it closes the case
				// (bash rejects `esac)` at the start of a pattern list).
				if (equalsAt(text, wordStart, wordEnd, "esac") && !isCasePatternWord(text, wordStart)) {
					push(K_KEYWORD, wordStart);
					caseStack.pop();
					commandPosition = false;
				} else push(classifyValueAt(text, wordStart, wordEnd), wordStart);
				continue;
			}
			// Body words are ordinary arguments unless esac starts a command.
			if (equalsAt(text, wordStart, wordEnd, "esac") && commandPosition) {
				push(K_KEYWORD, wordStart);
				caseStack.pop();
				commandPosition = false;
				continue;
			}
		}
		if (forHeader) {
			if (equalsAt(text, wordStart, wordEnd, "in")) {
				push(K_KEYWORD, wordStart);
				forHeader = false;
				commandPosition = false;
			} else push(K_VARIABLE, wordStart);
			continue;
		}
		if (wrapper) {
			if (wrapper.pendingValue) {
				wrapper.pendingValue = false;
				push(classifyValueAt(text, wordStart, wordEnd), wordStart);
				continue;
			}
			const first = text.charCodeAt(wordStart);
			if (!endOfOptions && equalsAt(text, wordStart, wordEnd, "--")) {
				push(K_OPTION, wordStart);
				endOfOptions = true;
				continue;
			}
			if (!endOfOptions && first === 45 && wordEnd - wordStart > 1) {
				// Any `-...` word in wrapper state is an option; glued values stay with it.
				if (text.charCodeAt(wordStart + 1) === 45) {
					let equals = -1;
					for (let scan = wordStart + 2; scan < wordEnd; scan++) {
						if (text.charCodeAt(scan) === 61) {
							equals = scan;
							break;
						}
					}
					if (equals > wordStart + 2) {
						push(K_OPTION, wordStart);
						push(K_ASSIGNMENT_OP, equals);
						if (equals + 1 < wordEnd) push(classifyValueAt(text, equals + 1, wordEnd), equals + 1);
					} else {
						push(K_OPTION, wordStart);
						if (wrapper.optsWithValue.has(text.slice(wordStart, wordEnd)))
							wrapper.pendingValue = true;
					}
				} else {
					const prefix = text.slice(wordStart, wordStart + 2);
					if (wordEnd - wordStart > 2 && wrapper.optsWithValue.has(prefix)) {
						let valueStart = wordStart + 2;
						if (text.charCodeAt(valueStart) === 61) valueStart++;
						push(K_OPTION, wordStart);
						if (valueStart < wordEnd) push(classifyValueAt(text, valueStart, wordEnd), valueStart);
					} else {
						push(K_OPTION, wordStart);
						if (wrapper.optsWithValue.has(text.slice(wordStart, wordEnd)))
							wrapper.pendingValue = true;
						// A short cluster whose last letter takes a value (`sudo -iu deploy psql`).
						else if (wordEnd - wordStart > 2 && wrapper.optsWithValue.has(`-${text[wordEnd - 1]}`))
							wrapper.pendingValue = true;
					}
				}
				continue;
			}
			if (wrapper.positionals > 0) {
				wrapper.positionals--;
				push(
					isNumberRange(text, wordStart, wordEnd)
						? K_NUMBER
						: classifyValueAt(text, wordStart, wordEnd),
					wordStart,
				);
				continue;
			}
			// The wrapper's command word. A wrapper word re-arms the next wrapper so
			// `sudo … env A=1 cmd`, `time nice -n 10 cmd`, and `timeout 5 xargs …` keep
			// painting the real command as the verb.
			const wordLength = wordEnd - wordStart;
			if (wordLength > MAX_WRAPPER_NAME_LENGTH) {
				push(K_COMMAND, wordStart);
				wrapper = null;
				commandPosition = false;
				endOfOptions = false;
				continue;
			}
			const word = text.slice(wordStart, wordEnd);
			const commandClass = COMMAND_CLASS.get(word);
			push(commandClass === undefined ? K_COMMAND : commandClass >> 3, wordStart);
			wrapper = word === "time" ? newWrapper("time") : newWrapper(word);
			commandPosition = false;
			endOfOptions = false;
			continue;
		}
		if (commandPosition) {
			const wordLength = wordEnd - wordStart;
			// Most command words are plain binaries; skip the keyword/wrapper/builtin
			// lookups and the substring for single-byte and long words.
			if (wordLength === 1) {
				push(text.charCodeAt(wordStart) === 91 ? K_BUILTIN : K_COMMAND, wordStart);
				commandPosition = false;
				endOfOptions = false;
				continue;
			}
			if (wordLength > MAX_KEYWORD_LENGTH) {
				push(K_COMMAND, wordStart);
				commandPosition = false;
				endOfOptions = false;
				continue;
			}
			if (equalsAt(text, wordStart, wordEnd, "[[")) {
				push(K_KEYWORD, wordStart);
				inConditional = true;
				commandPosition = false;
				continue;
			}
			if (equalsAt(text, wordStart, wordEnd, "case")) {
				push(K_KEYWORD, wordStart);
				caseStack.push(CASE_SUBJECT);
				commandPosition = false;
				continue;
			}
			if (equalsAt(text, wordStart, wordEnd, "esac")) {
				push(K_KEYWORD, wordStart);
				commandPosition = false;
				continue;
			}
			const word = text.slice(wordStart, wordEnd);
			const commandClass = COMMAND_CLASS.get(word);
			if (commandClass === undefined) {
				push(K_COMMAND, wordStart);
				commandPosition = false;
				endOfOptions = false;
				continue;
			}
			push(commandClass >> 3, wordStart);
			const action = commandClass & 7;
			if (action === 0) {
				commandPosition = false;
			} else if (action === CMD_RESUME) {
				commandPosition = true;
			} else if (action === CMD_FOR_HEADER) {
				forHeader = true;
				commandPosition = true;
			} else if (action === CMD_WRAPPER) {
				wrapper = newWrapper(word);
				commandPosition = false;
				endOfOptions = false;
			} else if (action === CMD_TIME) {
				wrapper = newWrapper("time");
				commandPosition = false;
				endOfOptions = false;
			} else {
				commandPosition = true;
			}
			continue;
		}
		if (execPending) {
			execPending = false;
			push(BUILTINS.has(text.slice(wordStart, wordEnd)) ? K_BUILTIN : K_COMMAND, wordStart);
			continue;
		}
		if (!endOfOptions && equalsAt(text, wordStart, wordEnd, "--")) {
			push(K_OPTION, wordStart);
			endOfOptions = true;
			continue;
		}
		if (!endOfOptions && looksLikeOptionRange(text, wordStart, wordEnd)) {
			let equals = -1;
			for (let scan = wordStart + 1; scan < wordEnd; scan++) {
				if (text.charCodeAt(scan) === 61) {
					equals = scan;
					break;
				}
			}
			if (equals > wordStart + 1) {
				push(K_OPTION, wordStart);
				push(K_ASSIGNMENT_OP, equals);
				if (equals + 1 < wordEnd) push(classifyValueAt(text, equals + 1, wordEnd), equals + 1);
			} else push(K_OPTION, wordStart);
			// Guard the substring allocation: exec options are a tiny prefix class.
			if (wordEnd - wordStart >= 3 && text.charCodeAt(wordStart) === 45) {
				const second = text.charCodeAt(wordStart + 1);
				if ((second === 101 || second === 111) && EXEC_OPTIONS.has(text.slice(wordStart, wordEnd)))
					execPending = true;
			}
			continue;
		}
		push(classifyValueAt(text, wordStart, wordEnd), wordStart);
	}

	// EOF: pending heredocs never started; every byte was already emitted.
	context.heredocs.length = 0;
	return index;
}

/** Bytes that end an unquoted heredoc delimiter word (or continue past it). */
function endsHeredocWord(code: number): boolean {
	return (
		isSpaceCode(code) ||
		code === 59 ||
		code === 124 ||
		code === 38 ||
		code === 40 ||
		code === 41 ||
		code === 60 ||
		code === 62
	);
}

/**
 * `a|esac)` and `(esac)` are pattern lists whose entry is the word `esac`, so the word is
 * a pattern directly after a pattern `|` or after the `(` that opens a pattern list. At
 * the start of a list bash rejects `esac)`/`esac|a)` as a syntax error, so there `esac`
 * always terminates the case (and, inside `$( … )`, the following `)` closes it).
 */
function isCasePatternWord(text: string, wordStart: number): boolean {
	let index = wordStart - 1;
	while (index >= 0) {
		const code = text.charCodeAt(index);
		if (code === 32 || code === 9) {
			index--;
			continue;
		}
		return code === 124 || code === 40;
	}
	return false;
}

function isRedirectionFd(text: string, start: number): boolean {
	let index = start;
	while (index < text.length && isDigitCode(text.charCodeAt(index))) index++;
	const code = text.charCodeAt(index);
	return code === 60 || code === 62;
}
function isBraceRedirection(text: string, start: number): boolean {
	// `{varname}>` / `{varname}<`. Bound the lookahead so `{`-heavy input is linear.
	const first = text.charCodeAt(start + 1);
	if (!isWordCode(first)) return false;
	const limit = Math.min(text.length, start + 34);
	for (let index = start + 2; index < limit; index++) {
		const code = text.charCodeAt(index);
		if (code === 125) {
			const after = text.charCodeAt(index + 1);
			return after === 60 || after === 62;
		}
		if (!isWordCode(code)) return false;
	}
	return false;
}

/** Tokenized command text: numeric kinds and start offsets into `source`. */
export interface BashTokenBatch {
	readonly source: string;
	readonly kinds: readonly number[];
	readonly starts: readonly number[];
}

/** Tokenize once into two packed integer arrays; no per-token object or substring. */
export function tokenizeBashBatch(text: string): BashTokenBatch {
	// Two packed integer arrays: one token per byte is the worst case, so start small (a
	// byte count read costs nothing to over-allocate a little) and grow once to the worst
	// case. Typed stores keep every write and the painter's read path free of hole checks.
	const capacity = Math.min(text.length, 1024);
	const kinds: number[] = new Array(capacity);
	const starts: number[] = new Array(capacity);
	let count = 0;
	let lastStart = -1;
	const push: TokenPush = (kind, start) => {
		// Tokens are contiguous and non-empty; skipping duplicate starts drops empty
		// spans without ever merging two real tokens.
		if (start <= lastStart) return;
		if (count >= kinds.length) kinds.length = starts.length = text.length;
		kinds[count] = kind;
		starts[count] = start;
		count++;
		lastStart = start;
	};
	const context: ScanContext = { heredocs: [] };
	const end = scanCommand(text, 0, STOP_NONE, 0, context, push);
	if (end < text.length) push(K_ARG, end);
	kinds.length = count;
	starts.length = count;
	return { source: text, kinds, starts };
}

export function tokenizeBash(text: string): BashToken[] {
	const batch = tokenizeBashBatch(text);
	const tokens: BashToken[] = [];
	for (let index = 0; index < batch.kinds.length; index++) {
		const start = batch.starts[index];
		const end = index + 1 < batch.starts.length ? batch.starts[index + 1] : text.length;
		tokens.push({ kind: BASH_TOKEN_KINDS[batch.kinds[index]], text: text.slice(start, end) });
	}
	return tokens;
}

const SGR_CHANNEL = "(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})";
// Keep the accepted palette form identical to what the display validator accepts.
const FOREGROUND_SGR = new RegExp(
	`^(?:\\x1b\\[(?:3[0-7]|9[0-7]|38;5;${SGR_CHANNEL}|38;2;${SGR_CHANNEL};${SGR_CHANNEL};${SGR_CHANNEL})m)+$`,
);
const TRAILING_SGR = /\x1b\[[0-9;]*m$/;
const DIM_SGR = /\x1b\[2m/g;

/** Opening foreground SGR for a theme token; undefined stays terminal default. */
function tokenAnsi(theme: BashPaletteTheme, token: string): string | undefined {
	try {
		let ansi: string | undefined;
		if (typeof theme.getFgAnsi === "function") {
			ansi = theme.getFgAnsi(token);
		} else {
			const sample = theme.fg(token, "");
			ansi = sample.replace(TRAILING_SGR, "");
		}
		if (!ansi || ansi === "\x1b[39m") return undefined;
		// Faint is a text attribute, not a foreground color; the row only paints color.
		if (ansi.includes("\x1b[2m")) ansi = ansi.replace(DIM_SGR, "");
		return ansi && FOREGROUND_SGR.test(ansi) ? ansi : undefined;
	} catch {
		return undefined;
	}
}

function sharesMerge(first: BashRole, second: BashRole): boolean {
	return BASH_ROLE_MERGES.some((group) => group.includes(first) && group.includes(second));
}

/** Palettes are immutable per concrete theme color record; sessions reuse them. */
const PALETTE_CACHE = new WeakMap<object, BashPalette>();

export function resolveBashPalette(theme: BashPaletteTheme): BashPalette {
	// A stable color record identifies the theme revision without sampling it. Hosts
	// without `colors` stay uncached so an in-place sample change is always observed.
	let colors: object | undefined;
	try {
		const candidate = theme.colors;
		if (candidate && typeof candidate === "object") colors = candidate;
	} catch {
		colors = undefined;
	}
	if (colors !== undefined) {
		const cached = PALETTE_CACHE.get(colors);
		if (cached !== undefined) return cached;
	}
	const palette = resolveBashPaletteUncached(theme);
	if (colors !== undefined) PALETTE_CACHE.set(colors, palette);
	return palette;
}

function resolveBashPaletteUncached(theme: BashPaletteTheme): BashPalette {
	const colors = new Map<string, string | undefined>();
	const ansiFor = (token: string): string | undefined => {
		if (colors.has(token)) return colors.get(token);
		const ansi = tokenAnsi(theme, token);
		colors.set(token, ansi);
		return ansi;
	};
	const baseAnsi = ansiFor("text");
	// The base `arg`/`space` color is owned by the terminal, so no role may reuse it.
	const owners = new Map<string, BashRole | "base">();
	if (baseAnsi) owners.set(baseAnsi, "base");
	const resolved = new Map<BashRole, BashPaletteColor>();
	for (const role of BASH_ROLE_ORDER) {
		let chosen: BashPaletteColor | undefined;
		for (const token of BASH_ROLE_TOKENS[role]) {
			const ansi = ansiFor(token);
			if (!ansi) continue;
			const owner = owners.get(ansi);
			if (owner && owner !== role && (owner === "base" || !sharesMerge(owner, role))) continue;
			chosen = { role, token, ansi };
			break;
		}
		if (!chosen) {
			for (const source of BASH_ROLE_BORROWS[role] ?? []) {
				const borrowed = resolved.get(source);
				if (borrowed?.ansi) {
					chosen = {
						role,
						token: borrowed.token,
						ansi: borrowed.ansi,
						borrowedFrom: source,
					};
					break;
				}
			}
		}
		if (!chosen) continue;
		resolved.set(role, chosen);
		owners.set(chosen.ansi as string, role);
	}
	// Merged groups share one color even when the group resolved out of order.
	for (const group of BASH_ROLE_MERGES) {
		const source = group.map((role) => resolved.get(role)).find(Boolean);
		if (!source) continue;
		for (const role of group) {
			if (!resolved.has(role)) resolved.set(role, { ...source, role });
		}
	}
	const roles = {} as Record<BashRole, BashPaletteColor>;
	const unpainted: BashRole[] = [];
	const usedTokens: string[] = [];
	for (const role of BASH_ROLE_ORDER) {
		const color = resolved.get(role);
		if (!color) {
			roles[role] = { role, token: null, ansi: undefined };
			unpainted.push(role);
		} else {
			roles[role] = color;
			if (color.token && !usedTokens.includes(color.token)) usedTokens.push(color.token);
		}
	}
	const kindAnsi = {} as Record<BashTokenKind, string | undefined>;
	const kindAnsiByCode: (string | undefined)[] = [];
	for (let code = 0; code < KIND_COUNT; code++) {
		const kind = BASH_TOKEN_KINDS[code];
		const role = BASH_KIND_ROLES[kind];
		const ansi = role ? roles[role].ansi : undefined;
		kindAnsi[kind] = ansi;
		kindAnsiByCode.push(ansi);
	}
	return { roles, kindAnsi, kindAnsiByCode, usedTokens, unpainted };
}

const RESET_FOREGROUND = "\x1b[39m";

function isPaintSpace(code: number): boolean {
	return (
		code === 32 ||
		code === 9 ||
		code === 10 ||
		code === 13 ||
		(code >= 128 && isUnicodePaintSpace(code))
	);
}
/**
 * Whitespace exactly as `String.prototype.trim` sees it beyond ASCII. pi-tui treats a
 * token as whitespace with `token.trim() === ""`, so an SGR directly before one of these
 * is attached to the whitespace token and shifts the wrap geometry.
 */
function isUnicodePaintSpace(code: number): boolean {
	if (code === 0xa0 || code === 0x1680) return true;
	if (code >= 0x2000 && code <= 0x200a) return true;
	if (code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f) return true;
	return code === 0x3000 || code === 0xfeff;
}

/**
 * Paint one foreground run per colored *word*. Colors only switch at a visible byte and a
 * run always covers its whole word, so every visible character carries the role the
 * tokenizer gave it; a reset lands after the word, immediately before whitespace.
 *
 * pi-tui's wrapper attaches an SGR that precedes a space to the whitespace token and then
 * re-opens the tracker's active color at the start of the next row, so a row that breaks
 * exactly at a space can count that space as a one-column word and emit an escape-only
 * row when the following word is wider than the row. That artifact is an upstream
 * `wrapSingleLine` quirk: the legacy whole-row accent painter produces it too, and the
 * production `PresentationText` component drops escape-only rows. `validateBashPaint`
 * relocates trailing resets past the whitespace they precede, which keeps the visible
 * bytes and the row geometry identical to plain text in the production path.
 *
 * Adjacent visible bytes of one role share a run (few spans means the host's ANSI-aware
 * wrapping stays cheap), base `arg`/`space` text keeps the terminal default, and a long
 * dense row degrades gracefully: low-signal roles drop out and the row stops painting
 * once it has spent its span budget, returning the rest of the row to the terminal
 * default.
 */
export function paintBashBatch(batch: BashTokenBatch, palette: BashPalette): string {
	const { source, kinds, starts } = batch;
	const count = kinds.length;
	const length = source.length;
	const kindAnsi = palette.kindAnsiByCode;
	// A long, dense row degrades gracefully. The decision is a cheap token/byte estimate
	// instead of a switch-counting pre-pass: painting already visits every token once.
	const degrade = count > DEGRADE_MIN_TOKENS && length > DEGRADE_MIN_CHARS;
	const spanBudget = degrade ? MAX_PAINTED_SPANS : MAX_TOTAL_SPANS;
	let output = "";
	let cursor = 0;
	let spans = 0;
	// Colour changes are emitted at the start of a word and never between a word and the
	// whitespace after it: pi-tui attaches an escape that directly precedes a space to that
	// whitespace token, which turns the space into a zero-width "word" and shifts wrap
	// boundaries (or inserts an escape-only row). Deferring the reset to the next word keeps
	// every whitespace token escape-free, so painted rows wrap exactly like plain text.
	let active: string | undefined;
	// Stops the row once the span budget is spent. The run that exhausts the budget is
	// closed on its own word, so the rest of the row returns to the terminal default
	// instead of inheriting the last role colour and without a zero-width opener/reset.
	let budgetClosed = false;
	outer: for (let index = 0; index < count && spans < spanBudget; index++) {
		const kind = kinds[index];
		const degraded = degrade && LOW_SIGNAL_KIND[kind] === 1;
		const color = degraded ? undefined : kindAnsi[kind];
		const end = index + 1 < count ? starts[index + 1] : length;
		let wordStart = starts[index];
		while (wordStart < end) {
			if (isPaintSpace(source.charCodeAt(wordStart))) {
				wordStart++;
				continue;
			}
			let wordEnd = wordStart + 1;
			while (wordEnd < end) {
				if (isPaintSpace(source.charCodeAt(wordEnd))) break;
				wordEnd++;
			}
			if (color !== active) {
				// Opening this colour spends the last budget slot, so paint just this word and
				// close it here rather than leaving an empty run for the tail reset.
				const exhausts = color !== undefined && spans >= spanBudget - 1;
				if (cursor < wordStart) output += source.slice(cursor, wordStart);
				cursor = wordStart;
				if (color === undefined) {
					output += RESET_FOREGROUND;
				} else {
					output += color;
					spans++;
				}
				active = color;
				if (exhausts) {
					// Paint the word, but leave the run open: its reset is deferred to the first
					// non-space byte in the tail, because an escape immediately before whitespace
					// is attached to that whitespace token by pi-tui and shifts wrap geometry.
					output += source.slice(wordStart, wordEnd);
					cursor = wordEnd;
					budgetClosed = true;
					break outer;
				}
			}
			wordStart = wordEnd;
		}
	}
	if (cursor < length) {
		if (budgetClosed && active !== undefined) {
			// Same placement rule as an ordinary run: cross the whitespace first, then close
			// the colour at a visible byte so every whitespace token stays escape-free.
			let gap = cursor;
			while (gap < length && isPaintSpace(source.charCodeAt(gap))) gap++;
			output += source.slice(cursor, gap);
			output += RESET_FOREGROUND;
			active = undefined;
			output += source.slice(gap);
		} else output += source.slice(cursor);
	}
	// A colour still open at the end of a natural row is closed after its last byte, which
	// can only touch trailing whitespace the same way the legacy accent wrapper does.
	if (active !== undefined) output += RESET_FOREGROUND;
	return output;
}

/** Public object-token entry point; the display path uses `paintBashBatch`. */
export function paintBash(tokens: readonly BashToken[], palette: BashPalette): string {
	let source = "";
	const kinds: number[] = [];
	const starts: number[] = [];
	for (const token of tokens) {
		kinds.push(KIND_CODE[token.kind]);
		starts.push(source.length);
		source += token.text;
	}
	return paintBashBatch({ source, kinds, starts }, palette);
}

/**
 * Stable non-object revision signature for hosts without `theme.colors`. It compares
 * raw theme samples instead of resolving/validating a palette color: the signature only
 * gates cache reuse, palette validation already happened on the cold miss, and a live
 * in-place theme mutation stays observable on every warm hit.
 */
export function bashThemeSignature(theme: BashPaletteTheme, tokens: readonly string[]): string {
	let signature = "";
	for (const token of tokens) {
		try {
			signature += `${
				typeof theme.getFgAnsi === "function" ? theme.getFgAnsi(token) : theme.fg(token, "")
			}\u0000`;
		} catch {
			signature += "\u0000";
		}
	}
	return signature;
}
