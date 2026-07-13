/**
 * Icon mode defaults and resolvers.
 *
 * Nerd defaults must stay byte-identical to historical `defaultConfig.icons`.
 * User string overrides always win over mode defaults.
 */

export type IconMode = "auto" | "nerd" | "ascii";

export type IconGlyphs = {
	cwd: string;
	git: string;
	ahead: string;
	behind: string;
	diverged: string;
	conflicted: string;
	untracked: string;
	stashed: string;
	modified: string;
	staged: string;
	renamed: string;
	deleted: string;
	typechanged: string;
	cacheHit: string;
	editorPrompt: string;
	rail: string;
	username: string;
	time: string;
	os: string;
	package: string;
};

export type ResolvedIcons = IconGlyphs & { mode: IconMode };

export const ICON_GLYPH_KEYS = [
	"cwd",
	"git",
	"ahead",
	"behind",
	"diverged",
	"conflicted",
	"untracked",
	"stashed",
	"modified",
	"staged",
	"renamed",
	"deleted",
	"typechanged",
	"cacheHit",
	"editorPrompt",
	"rail",
	"username",
	"time",
	"os",
	"package",
] as const satisfies readonly (keyof IconGlyphs)[];

/**
 * Historical Nerd Font defaults (byte-identical to prior defaultConfig.icons).
 *
 * New defaults (e.g. `package`) come from the Starship Nerd Font preset
 * (https://starship.rs/presets/nerd-font), which is the project's
 * authoritative glyph source per user direction.
 */
export const NERD_DEFAULT_ICONS: IconGlyphs = {
	cwd: "",
	git: "",
	ahead: "↑",
	behind: "↓",
	diverged: "⇕",
	conflicted: "=",
	untracked: "?",
	stashed: "$",
	modified: "!",
	staged: "+",
	renamed: "»",
	deleted: "✘",
	typechanged: "T",
	cacheHit: "󰆼",
	editorPrompt: "",
	rail: "│",
	username: "",
	time: "",
	os: "",
	// Starship Nerd Font preset — `package` module glyph.
	package: "",
};

export const ASCII_DEFAULT_ICONS: IconGlyphs = {
	cwd: "",
	git: "*",
	ahead: "^",
	behind: "v",
	diverged: "^v",
	conflicted: "=",
	untracked: "?",
	stashed: "$",
	modified: "!",
	staged: "+",
	renamed: ">",
	deleted: "x",
	typechanged: "T",
	cacheHit: "c",
	editorPrompt: "",
	rail: "|",
	username: "@",
	time: "t",
	os: "o",
	package: "pkg",
};

export const OS_PLATFORM_ICONS_NERD: Record<string, string> = {
	darwin: "\uf179",
	linux: "\uf17c",
	win32: "\uf17a",
};

export const OS_PLATFORM_ICONS_ASCII: Record<string, string> = {
	darwin: "mac",
	linux: "linux",
	win32: "win",
};

/** Short ASCII labels keyed by runtime `name`. */
export const RUNTIME_ASCII_SYMBOLS: Record<string, string> = {
	xmake: "xm",
	maven: "mvn",
	gradle: "grd",
	bun: "bun",
	deno: "deno",
	lua: "lua",
	nodejs: "node",
	python: "py",
	golang: "go",
	rust: "rs",
	java: "java",
	ruby: "rb",
	php: "php",
	buf: "buf",
	cmake: "cmake",
	cpp: "c++",
	c: "c",
	cobol: "cob",
	conda: "conda",
	crystal: "cr",
	dart: "dart",
	dotnet: ".net",
	elixir: "ex",
	elm: "elm",
	erlang: "erl",
	fennel: "fnl",
	fortran: "f90",
	gleam: "glm",
	guix_shell: "guix",
	haskell: "hs",
	haxe: "hx",
	helm: "helm",
	julia: "jl",
	kotlin: "kt",
	meson: "meson",
	mojo: "mojo",
	nim: "nim",
	nix_shell: "nix",
	ocaml: "ml",
	odin: "odin",
	opa: "opa",
	perl: "pl",
	pixi: "pixi",
	pulumi: "pul",
	purescript: "purs",
	raku: "raku",
	red: "red",
	rlang: "R",
	scala: "scala",
	solidity: "sol",
	spack: "spack",
	swift: "swift",
	terraform: "tf",
	typst: "typ",
	vagrant: "vag",
	vlang: "v",
	zig: "zig",
};

export function isIconMode(value: unknown): value is IconMode {
	return value === "auto" || value === "nerd" || value === "ascii";
}

export function normalizeIconMode(value: unknown): IconMode {
	return isIconMode(value) ? value : "auto";
}

export function modeDefaultIcons(mode: IconMode): IconGlyphs {
	return mode === "ascii" ? { ...ASCII_DEFAULT_ICONS } : { ...NERD_DEFAULT_ICONS };
}

export function resolveConfiguredIcons(
	mode: IconMode,
	overrides: Partial<IconGlyphs> = {},
): ResolvedIcons {
	const base = modeDefaultIcons(mode);
	const rail =
		typeof overrides.rail === "string" && overrides.rail.trim().length > 0
			? overrides.rail
			: base.rail;
	return {
		mode,
		...base,
		...overrides,
		rail,
	};
}

/**
 * Honor a custom `icons.os` when it differs from the mode default.
 * Otherwise map by platform for the active mode.
 */
export function resolveOsIcon(
	configuredOsIcon: string,
	mode: IconMode = "auto",
	platform: string = process.platform,
): string {
	const modeDefault = modeDefaultIcons(mode).os;
	if (configuredOsIcon !== modeDefault) return configuredOsIcon;
	const platformMap = mode === "ascii" ? OS_PLATFORM_ICONS_ASCII : OS_PLATFORM_ICONS_NERD;
	return platformMap[platform] ?? configuredOsIcon;
}

export function resolveRuntimeSymbol(
	name: string,
	nerdSymbol: string,
	mode: IconMode = "auto",
): string {
	if (mode !== "ascii") return nerdSymbol;
	return RUNTIME_ASCII_SYMBOLS[name] ?? (name.slice(0, 3) || "*");
}

/**
 * Resolve the package-version segment icon for the active mode.
 *
 * Honors a configured `icons.package` override; otherwise falls back to the
 * mode default (Nerd Font preset / ASCII label).
 */
export function resolvePackageIcon(configuredPackageIcon: string, mode: IconMode = "auto"): string {
	const modeDefault = modeDefaultIcons(mode).package;
	if (typeof configuredPackageIcon === "string" && configuredPackageIcon.length > 0) {
		return configuredPackageIcon;
	}
	return modeDefault;
}
