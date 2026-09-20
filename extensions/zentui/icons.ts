/**
 * Icon mode defaults and resolvers.
 *
 * Nerd defaults must stay byte-identical to historical `defaultConfig.icons`,
 * except where intentionally changed to match the Starship Nerd Font preset.
 * User string overrides always win over mode defaults.
 */

export type IconMode = "auto" | "nerd" | "ascii";
export type EffectiveIconMode = Exclude<IconMode, "auto">;
export type IconEnvironment = Readonly<Record<string, string | undefined>>;

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

export type ResolvedIcons = IconGlyphs & {
	/** Canonical user choice; Auto is never replaced with an environment-specific value. */
	mode: IconMode;
	/** Runtime-only mode derived from the canonical choice and current environment. */
	effectiveMode: EffectiveIconMode;
	/** Runtime-only provenance needed when an override equals the active mode default. */
	osOverridden: boolean;
};

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
 * Nerd Font defaults.
 *
 * The `cwd` icon is intentionally empty — Starship's `directory` module
 * has no default symbol. Other defaults match historical values; new
 * additions (e.g. `package`) come from the Starship Nerd Font preset
 * (https://starship.rs/presets/nerd-font).
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

export function detectAutoIconMode(env: IconEnvironment): EffectiveIconMode {
	if (env.ZENTUI_NERD_FONTS === "1") return "nerd";
	if (env.ZENTUI_NERD_FONTS === "0") return "ascii";

	const termProgram = env.TERM_PROGRAM?.toLowerCase();
	if (termProgram === "iterm.app" || termProgram === "wezterm" || termProgram === "ghostty") {
		return "nerd";
	}
	if (env.KITTY_WINDOW_ID?.trim() || env.ALACRITTY_SOCKET?.trim()) return "nerd";
	return "ascii";
}

export function resolveEffectiveIconMode(
	mode: IconMode,
	env: IconEnvironment = process.env,
): EffectiveIconMode {
	return mode === "auto" ? detectAutoIconMode(env) : mode;
}

export function modeDefaultIcons(mode: IconMode, env: IconEnvironment = process.env): IconGlyphs {
	return resolveEffectiveIconMode(mode, env) === "ascii"
		? { ...ASCII_DEFAULT_ICONS }
		: { ...NERD_DEFAULT_ICONS };
}

export function resolveConfiguredIcons(
	mode: IconMode,
	overrides: Partial<IconGlyphs> = {},
	env: IconEnvironment = process.env,
): ResolvedIcons {
	const effectiveMode = resolveEffectiveIconMode(mode, env);
	const base = modeDefaultIcons(effectiveMode);
	const rail =
		typeof overrides.rail === "string" && overrides.rail.trim().length > 0
			? overrides.rail
			: base.rail;
	return {
		mode,
		effectiveMode,
		...base,
		...overrides,
		rail,
		osOverridden: typeof overrides.os === "string",
	};
}

/** Map the active mode default by platform while preserving explicit `icons.os` overrides. */
export function resolveOsIcon(
	configuredOsIcon: string,
	mode: IconMode = "auto",
	platform: string = process.platform,
	env: IconEnvironment = process.env,
	osOverridden = false,
): string {
	if (osOverridden) return configuredOsIcon;
	const effectiveMode = resolveEffectiveIconMode(mode, env);
	const modeDefault = modeDefaultIcons(effectiveMode).os;
	if (configuredOsIcon !== modeDefault) return configuredOsIcon;
	const platformMap = effectiveMode === "ascii" ? OS_PLATFORM_ICONS_ASCII : OS_PLATFORM_ICONS_NERD;
	return platformMap[platform] ?? configuredOsIcon;
}

export function resolveRuntimeSymbol(
	name: string,
	nerdSymbol: string,
	mode: IconMode = "auto",
	env: IconEnvironment = process.env,
): string {
	if (resolveEffectiveIconMode(mode, env) !== "ascii") return nerdSymbol;
	return RUNTIME_ASCII_SYMBOLS[name] ?? (name.slice(0, 3) || "*");
}

/**
 * Resolve the package-version segment icon for the active mode.
 *
 * Honors a configured `icons.package` override; otherwise falls back to the
 * mode default (Nerd Font preset / ASCII label).
 */
export function resolvePackageIcon(
	configuredPackageIcon: string,
	mode: IconMode = "auto",
	env: IconEnvironment = process.env,
): string {
	const modeDefault = modeDefaultIcons(mode, env).package;
	if (typeof configuredPackageIcon === "string" && configuredPackageIcon.length > 0) {
		return configuredPackageIcon;
	}
	return modeDefault;
}
