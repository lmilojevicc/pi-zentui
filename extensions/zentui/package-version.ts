/**
 * Project package version detection (Starship `package` module parity).
 *
 * Pure file parsing only — no shell-outs, no parent-directory traversal,
 * no render-time reads. The reader operates on the current cwd and the
 * same top-level entries the runtime detector sees, then hands back a
 * silent null when no manifest is present or any parser fails.
 *
 * Supported manifest sources (intersected with runtimes Zentui detects):
 *   bun / nodejs → package.json
 *   deno         → deno.json / deno.jsonc
 *   maven        → pom.xml
 *   gradle       → gradle.properties
 *   python       → pyproject.toml, setup.cfg
 *   rust         → Cargo.toml (package.version or workspace-inherited)
 *   php          → composer.json
 *   crystal      → shard.yml
 *   dart         → pubspec.yaml, pubspec.yml
 *   elixir       → mix.exs
 *   elm          → elm.json
 *   fortran      → fpm.toml
 *   gleam        → gleam.toml
 *   haskell      → *.cabal
 *   helm         → Chart.yaml
 *   julia        → Project.toml
 *   meson        → meson.build
 *   nim          → *.nimble
 *   ruby         → *.gemspec
 *   vlang        → v.mod
 *   xmake        → xmake.lua
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageVersionResult = {
	/** Starship ecosystem key — matches `runtimeMetadata[].name` where it exists. */
	ecosystem: string;
	/** Raw version string as authored in the manifest. */
	version: string;
};

export type PackageVersionReadResult =
	| { kind: "ok"; result: PackageVersionResult | null }
	| { kind: "error" };

/**
 * A single manifest source. `kind` selects the lookup mode:
 *   "file"        — try each of `files` exactly (cheap, no scan).
 *   "extensions"  — pick the first entry in `cwd` whose extension matches one in `files`.
 * `parse` receives the raw file text and either returns a cleaned version
 * string or `undefined`. Parsers must be total (never throw); any
 * failure means `undefined`.
 */
type ManifestSource = {
	files: readonly string[];
	parse: (raw: string) => string | undefined;
	kind?: "file" | "extensions";
};

export const PACKAGE_VERSION_ECOSYSTEMS = [
	"bun",
	"nodejs",
	"deno",
	"maven",
	"gradle",
	"python",
	"rust",
	"php",
	"crystal",
	"dart",
	"elixir",
	"elm",
	"fortran",
	"gleam",
	"haskell",
	"helm",
	"julia",
	"meson",
	"nim",
	"ruby",
	"vlang",
	"xmake",
] as const;

// --- String cleaning -----------------------------------------------------

/**
 * Strip surrounding quotes / leading `v` and trim trailing metadata.
 * Empty / whitespace-only values return `undefined`.
 */
function cleanVersion(value: string | undefined): string | undefined {
	if (!value) return undefined;
	let text = value.trim();
	if (!text) return undefined;

	if (text.length >= 2) {
		const first = text[0];
		const last = text[text.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			text = text.slice(1, -1);
		}
	}

	while (text.startsWith("v") || text.startsWith("V")) {
		// Only strip `v` when the next char is a digit — `v3.2.1` → `3.2.1`,
		// but a bare word like `via` is left alone.
		const next = text[1];
		if (!next || next < "0" || next > "9") break;
		text = text.slice(1);
	}

	text = text.trim();
	if (!text) return undefined;

	// Reject obvious junk (whitespace, control chars, braces).
	if (/[\s\r\n\t]/.test(text)) return undefined;
	if (/[{}\\<>]/.test(text)) return undefined;

	return text;
}

// --- JSON helpers --------------------------------------------------------

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * Strip `//` and `/* * /` comments so JSON-with-comments can be parsed by
 * `JSON.parse`. Quoted strings are preserved. Only used for `.jsonc`.
 */
function stripJsonComments(raw: string): string {
	let result = "";
	let inString = false;
	let stringQuote = "";
	let inBlockComment = false;
	let inLineComment = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		const next = raw[i + 1];
		if (inLineComment) {
			if (ch === "\n") {
				inLineComment = false;
				result += "\n";
			}
			continue;
		}
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i += 1;
			}
			continue;
		}
		if (inString) {
			result += ch;
			if (ch === "\\" && next !== undefined) {
				result += next;
				i += 1;
			} else if (ch === stringQuote) {
				inString = false;
			}
			continue;
		}
		if (ch === "/" && next === "/") {
			inLineComment = true;
			i += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlockComment = true;
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = true;
			stringQuote = ch;
			result += ch;
			continue;
		}
		result += ch;
	}
	return result;
}

function safeJsoncParse(raw: string): unknown {
	try {
		return JSON.parse(stripJsonComments(raw));
	} catch {
		return undefined;
	}
}

function readJsonVersionField(raw: string, key: string): string | undefined {
	const parsed = safeJsonParse(raw);
	if (!parsed || typeof parsed !== "object") return undefined;
	const value = (parsed as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function readJsoncVersionField(raw: string, key: string): string | undefined {
	const parsed = safeJsoncParse(raw);
	if (!parsed || typeof parsed !== "object") return undefined;
	const value = (parsed as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

// --- TOML helpers --------------------------------------------------------

/**
 * Parse only the static `key = "value"` (or `key = 'value'`) assignment of a
 * simple TOML section header (e.g. `[project]`, `[tool.poetry]`, `[workspace]`).
 * Sufficient for the manifest keys we care about; inline tables and
 * multi-line arrays fall back to `undefined`.
 *
 * Sections are matched as a leading `[name]` (or `[[name]]`) header; key
 * matches continue until the next section header or end of file.
 */
function readTomlSectionKeyValue(raw: string, section: string, key: string): string | undefined {
	const lines = raw.split(/\r?\n/);
	let inTargetSection = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const headerMatch = trimmed.match(/^\[\[?([^\]]+)\]?\]\s*$/);
		if (headerMatch) {
			const name = (headerMatch[1] ?? "").trim();
			inTargetSection = name === section;
			continue;
		}

		if (!inTargetSection) continue;

		const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
		if (!match) continue;
		const candidateKey = match[1] ?? "";
		if (candidateKey !== key) continue;

		let value = (match[2] ?? "").trim();
		const trailingComment = value.indexOf("#");
		if (trailingComment >= 0 && !isInsideString(value, trailingComment)) {
			value = value.slice(0, trailingComment).trim();
		}
		return value || undefined;
	}

	return undefined;
}

/** A key-value pair at the top of a TOML file, before any section header. */
function readTopLevelTomlValue(raw: string, key: string): string | undefined {
	const lines = raw.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("[")) return undefined; // entered a section
		const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/);
		if (!match) continue;
		const candidateKey = match[1] ?? "";
		if (candidateKey !== key) continue;
		return trimQuotes((match[2] ?? "").trim());
	}
	return undefined;
}

function trimQuotes(value: string): string {
	if (value.length < 2) return value;
	const first = value[0];
	const last = value[value.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return value.slice(1, -1);
	}
	return value;
}

function isInsideString(value: string, index: number): boolean {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < index; i++) {
		const ch = value[i];
		if (ch === "\\") {
			i += 1;
			continue;
		}
		if (!inDouble && ch === "'") inSingle = !inSingle;
		else if (!inSingle && ch === '"') inDouble = !inDouble;
	}
	return inSingle || inDouble;
}

// --- YAML helper (line-oriented; supports only top-level `key:`) ---------

function readYamlTopLevelValue(raw: string, key: string): string | undefined {
	const lines = raw.split(/\r?\n/);
	const target = `${key}:`;
	for (const line of lines) {
		if (line.startsWith(" ") || line.startsWith("\t")) continue;
		if (!line.startsWith(target)) continue;
		const value = line.slice(target.length).trim();
		return value || undefined;
	}
	return undefined;
}

// --- Per-ecosystem parsers -----------------------------------------------

/**
 * Locate a `package` stanza in a `.cabal` file and extract its `version`
 * field. Modern cabal files (>= 1.12) drop the explicit `package`
 * keyword; the file itself IS the package stanza, with `library`,
 * `executable`, `test-suite`, `common`, etc. stanzas delimited by
 * column-0 openers. We accept both indented (`  version: …`) and
 * top-level (`version: …`) `version:` lines up to the first stanza opener.
 */
function extractCabalPackageVersion(raw: string): string | undefined {
	const lines = raw.split(/\r?\n/);
	let packageStart = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (/^package\s*$/i.test(line.trim())) {
			packageStart = i + 1;
			break;
		}
	}

	for (let i = packageStart; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.trim() === "") continue;
		if (line.trim().startsWith("--")) continue;
		// A non-indented, non-empty line closes the package stanza.
		if (!/^\s/.test(line)) break;
		const match = line.match(/^\s*version\s*:\s*(.+?)\s*$/i);
		if (match) return cleanVersion(match[1]);
	}

	// Legacy form: `version:` lives at column 0 alongside `name:`, before
	// any stanza opener (e.g. `library`).
	for (let i = packageStart; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("--")) continue;
		// First non-keyword, non-empty line ends the package section.
		if (!/^[a-zA-Z][\w-]*\s*:/.test(trimmed)) break;
		const match = trimmed.match(/^version\s*:\s*(.+?)\s*$/i);
		if (match) return cleanVersion(match[1]);
	}

	return undefined;
}

const parsers: readonly ManifestSource[] = [
	// npm / bun — package.json
	{
		files: ["package.json"],
		parse: (raw) => cleanVersion(readJsonVersionField(raw, "version")),
	},
	// deno — deno.json / deno.jsonc
	{
		files: ["deno.json", "deno.jsonc"],
		parse: (raw) => cleanVersion(readJsoncVersionField(raw, "version")),
	},
	// maven — pom.xml: project/version (direct child, simple case).
	{
		files: ["pom.xml"],
		parse: (raw) => {
			const match = raw.match(/<project\b[^>]*>[\s\S]*?<version>\s*([^<]+?)\s*<\/version>/i);
			return cleanVersion(match?.[1]);
		},
	},
	// gradle — gradle.properties key=value
	{
		files: ["gradle.properties"],
		parse: (raw) => {
			for (const line of raw.split(/\r?\n/)) {
				const match = line.match(/^\s*version\s*[:=]\s*(.+?)\s*$/i);
				if (match) return cleanVersion(match[1]);
			}
			return undefined;
		},
	},
	// python — pyproject.toml ([project].version or [tool.poetry].version)
	{
		files: ["pyproject.toml"],
		parse: (raw) => {
			const project = cleanVersion(readTomlSectionKeyValue(raw, "project", "version"));
			if (project) return project;
			return cleanVersion(readTomlSectionKeyValue(raw, "tool.poetry", "version"));
		},
	},
	// python — setup.cfg ([metadata].version)
	{
		files: ["setup.cfg"],
		parse: (raw) => cleanVersion(readTomlSectionKeyValue(raw, "metadata", "version")),
	},
	// rust — Cargo.toml ([package].version, with workspace inheritance)
	{
		files: ["Cargo.toml"],
		parse: (raw) => {
			// Direct assignment wins (string literal version).
			const direct = readTomlSectionKeyValue(raw, "package", "version");
			const directClean = cleanVersion(direct);
			if (directClean && !/^\s*version\s*\.\s*workspace\s*=\s*true/i.test(direct ?? "")) {
				return directClean;
			}

			// Workspace inheritance: package declares `version.workspace = true`
			// and the [workspace] block carries the actual version.
			if (!/\bversion\s*\.\s*workspace\s*=\s*true/i.test(raw)) return undefined;
			const workspaceMatch = raw.match(/\[workspace\][\s\S]*?version\s*=\s*["']([^"']+)["']/i);
			return cleanVersion(workspaceMatch?.[1]);
		},
	},
	// php — composer.json
	{
		files: ["composer.json"],
		parse: (raw) => cleanVersion(readJsonVersionField(raw, "version")),
	},
	// crystal — shard.yml (top-level `version: …`)
	{
		files: ["shard.yml"],
		parse: (raw) => cleanVersion(readYamlTopLevelValue(raw, "version")),
	},
	// dart — pubspec.yaml / pubspec.yml (top-level `version: …`)
	{
		files: ["pubspec.yaml", "pubspec.yml"],
		parse: (raw) => cleanVersion(readYamlTopLevelValue(raw, "version")),
	},
	// elixir — mix.exs: `version: "…"` as a Mix.Project option (string literal form).
	{
		files: ["mix.exs"],
		parse: (raw) => {
			const match = raw.match(/(?:^|\n)\s*version\s*:\s*["']([^"']+)["']/);
			return cleanVersion(match?.[1]);
		},
	},
	// elm — elm.json: top-level `version` (only present in 0.19.0 application projects).
	{
		files: ["elm.json"],
		parse: (raw) => cleanVersion(readJsonVersionField(raw, "version")),
	},
	// fortran — fpm.toml: [package] or [project] version.
	{
		files: ["fpm.toml"],
		parse: (raw) => {
			const fromPackage = cleanVersion(readTomlSectionKeyValue(raw, "package", "version"));
			if (fromPackage) return fromPackage;
			return cleanVersion(readTomlSectionKeyValue(raw, "project", "version"));
		},
	},
	// gleam — gleam.toml top-level version
	{
		files: ["gleam.toml"],
		parse: (raw) => cleanVersion(readTopLevelTomlValue(raw, "version")),
	},
	// haskell — *.cabal: `version:` inside a `package` stanza.
	{
		files: [".cabal"],
		kind: "extensions",
		parse: (raw) => extractCabalPackageVersion(raw),
	},
	// helm — Chart.yaml: top-level `version:` (chart version, distinct from appVersion)
	{
		files: ["Chart.yaml"],
		parse: (raw) => cleanVersion(readYamlTopLevelValue(raw, "version")),
	},
	// julia — Project.toml: top-level `version = "…"`
	{
		files: ["Project.toml"],
		parse: (raw) => cleanVersion(readTopLevelTomlValue(raw, "version")),
	},
	// meson — meson.build: static `project(..., version: '…')` form only.
	{
		files: ["meson.build"],
		parse: (raw) => {
			const match = raw.match(/\bproject\s*\([^)]*?\bversion\s*:\s*['"]([^'"]+)['"]/);
			return cleanVersion(match?.[1]);
		},
	},
	// nim — *.nimble: top-level `version = "…"` (ignore indented blocks).
	{
		files: [".nimble"],
		kind: "extensions",
		parse: (raw) => cleanVersion(readTopLevelTomlValue(raw, "version")),
	},
	// ruby — *.gemspec: `spec.version = "…"` static literal.
	{
		files: [".gemspec"],
		kind: "extensions",
		parse: (raw) => {
			const quoted = raw.match(/\b(?:spec\.|\.)?version\s*=\s*["']([^"']+)["']/);
			if (quoted) return cleanVersion(quoted[1]);
			return undefined;
		},
	},
	// vlang — v.mod: `version: '…'` after the module block.
	{
		files: ["v.mod"],
		parse: (raw) => {
			const match = raw.match(/\bversion\s*:\s*['"]([^'']+)['"]/);
			if (match) return cleanVersion(match[1]);
			const numeric = raw.match(/\bversion\s*:\s*([0-9][^\s,]+)/);
			return cleanVersion(numeric?.[1]);
		},
	},
	// xmake — xmake.lua: static `set_version("…")` form only.
	{
		files: ["xmake.lua"],
		parse: (raw) => {
			const match = raw.match(/^\s*set_version\s*\(\s*["']([^"']+)["']\s*\)/m);
			return cleanVersion(match?.[1]);
		},
	},
];

// --- File lookup ---------------------------------------------------------

function ecosystemFor(file: string): string {
	const lower = file.toLowerCase();
	if (lower === "package.json") return "nodejs";
	if (lower === "pom.xml") return "maven";
	if (lower === "gradle.properties") return "gradle";
	if (lower === "deno.json" || lower === "deno.jsonc") return "deno";
	if (lower === "pyproject.toml") return "python";
	if (lower === "setup.cfg") return "python";
	if (lower === "cargo.toml") return "rust";
	if (lower === "composer.json") return "php";
	if (lower === "shard.yml") return "crystal";
	if (lower === "pubspec.yaml" || lower === "pubspec.yml") return "dart";
	if (lower === "mix.exs") return "elixir";
	if (lower === "elm.json") return "elm";
	if (lower === "fpm.toml") return "fortran";
	if (lower === "gleam.toml") return "gleam";
	if (lower.endsWith(".cabal")) return "haskell";
	if (lower === "chart.yaml") return "helm";
	if (lower === "project.toml") return "julia";
	if (lower === "meson.build") return "meson";
	if (lower.endsWith(".nimble")) return "nim";
	if (lower.endsWith(".gemspec")) return "ruby";
	if (lower === "v.mod") return "vlang";
	if (lower === "xmake.lua") return "xmake";
	return "unknown";
}

function safeReadFile(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Test if a `cwd` entry basename ends with one of the given extensions.
 * `extensions` should include the leading dot.
 */
function hasAnyExtension(name: string, extensions: readonly string[]): boolean {
	const lower = name.toLowerCase();
	for (const ext of extensions) {
		if (lower.endsWith(ext)) return true;
	}
	return false;
}

export function readPackageVersion(cwd: string): PackageVersionResult | null {
	// File-mode readers: cheap `existsSync` checks in deterministic order.
	for (let i = 0; i < parsers.length; i++) {
		const source = parsers[i];
		if (!source || source.kind === "extensions") continue;
		for (const file of source.files) {
			const full = join(cwd, file);
			if (!existsSync(full)) continue;
			const raw = safeReadFile(full);
			if (raw === undefined) continue;
			let version: string | undefined;
			try {
				version = source.parse(raw);
			} catch {
				continue;
			}
			if (version) return { ecosystem: ecosystemFor(file), version };
		}
	}

	// Extension-mode readers: one readdir, then try each candidate against
	// its parser. The reading order matches `parsers` declaration order so
	// Haskell (`*.cabal`) is preferred over Ruby (`*.gemspec`) when both
	// exist (very rare; deterministic and documented).
	let entries: readonly string[];
	try {
		entries = readdirSync(cwd);
	} catch {
		return null;
	}

	for (let i = 0; i < parsers.length; i++) {
		const source = parsers[i];
		if (source?.kind !== "extensions") continue;
		for (const entry of entries) {
			if (!hasAnyExtension(entry, source.files)) continue;
			const full = join(cwd, entry);
			const raw = safeReadFile(full);
			if (raw === undefined) continue;
			let version: string | undefined;
			try {
				version = source.parse(raw);
			} catch {
				continue;
			}
			if (version) return { ecosystem: ecosystemFor(entry), version };
		}
	}

	return null;
}

/**
 * Async wrapper for use from the project-refresh path. `null` results from
 * `readPackageVersion` (no manifest present) are surfaced as `ok` with a
 * null result so the caller can distinguish "no manifest in this cwd"
 * (clear state) from "could not read cwd" / parse failure (error, keep
 * last-good). The synchronous reader never throws on its own; we still
 * wrap defensively so callers using this through a scheduler cannot be
 * broken by future filesystem exceptions.
 */
export async function readPackageVersionResult(cwd: string): Promise<PackageVersionReadResult> {
	try {
		return { kind: "ok", result: readPackageVersion(cwd) };
	} catch {
		return { kind: "error" };
	}
}

/**
 * Exposed for testing — the parser table and the `cleanVersion` helper.
 * Lets unit tests cover every ecosystem and edge case without writing
 * temporary filesystem fixtures.
 */
export const __test__ = {
	parsers,
	cleanVersion,
	ecosystemFor,
	hasAnyExtension,
};
