import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 2500;

export type RuntimeMetadata = {
	name: string;
	symbol: string;
	style: string;
};

export type RuntimeInfo = Pick<RuntimeMetadata, "name" | "symbol" | "style"> & {
	version?: string;
};

type RuntimeEnvironment = Record<string, string | undefined>;

type DetectionSpec = {
	extensions?: readonly string[];
	files?: readonly string[];
	folders?: readonly string[];
	env?: (env: RuntimeEnvironment) => boolean;
	excludedFiles?: readonly string[];
};

type VersionCommand = {
	command: string;
	args?: readonly string[];
	pattern?: RegExp;
};

type RuntimeDef = RuntimeMetadata & {
	priority: number;
	detect: DetectionSpec;
	version: (cwd: string) => Promise<string | undefined>;
};

// --- Detection utilities ---

function hasAnyFile(cwd: string, names: readonly string[]): boolean {
	return names.some((name) => existsSync(join(cwd, name)));
}

function hasAnyFolder(cwd: string, names: readonly string[]): boolean {
	return names.some((name) => {
		try {
			return statSync(join(cwd, name)).isDirectory();
		} catch {
			return false;
		}
	});
}

function entryExtensions(entry: string): string[] {
	const baseName = entry.split(/[\\/]/).pop() ?? entry;
	if (!baseName || baseName.startsWith(".")) return [];

	const firstDot = baseName.indexOf(".");
	if (firstDot === -1) return [];

	const extensions = [baseName.slice(firstDot + 1)];
	const lastDot = baseName.lastIndexOf(".");
	if (lastDot !== firstDot) extensions.push(baseName.slice(lastDot + 1));
	return extensions;
}

function hasAnyExtension(entries: readonly string[], extensions: readonly string[]): boolean {
	const extensionSet = new Set(extensions);
	return entries.some((entry) =>
		entryExtensions(entry).some((extension) => extensionSet.has(extension)),
	);
}

function matchesDetection(
	cwd: string,
	entries: string[],
	spec: DetectionSpec,
	env: RuntimeEnvironment,
): boolean {
	if (spec.excludedFiles && hasAnyFile(cwd, spec.excludedFiles)) return false;
	return Boolean(
		(spec.files && hasAnyFile(cwd, spec.files)) ||
			(spec.folders && hasAnyFolder(cwd, spec.folders)) ||
			(spec.extensions && hasAnyExtension(entries, spec.extensions)) ||
			spec.env?.(env),
	);
}

// --- Version utilities ---

async function runVersion(
	command: string,
	args: readonly string[] = [],
	cwd?: string,
): Promise<string | undefined> {
	try {
		const { stdout, stderr } = await execFileAsync(command, [...args], {
			cwd,
			timeout: VERSION_TIMEOUT_MS,
		});
		const text =
			`${typeof stdout === "string" ? stdout : String(stdout)}\n${typeof stderr === "string" ? stderr : String(stderr)}`.trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

function prefixVersion(version: string | undefined): string | undefined {
	if (!version) return undefined;
	return version.startsWith("v") ? version : `v${version}`;
}

function extractVersion(output: string | undefined, pattern?: RegExp): string | undefined {
	if (!output) return undefined;
	const match = output.match(
		pattern ?? /(?:version\s*)?v?([0-9]+(?:\.[0-9A-Za-z][0-9A-Za-z.+_-]*)*)/i,
	);
	return prefixVersion(match?.[1]);
}

function versionFromCommands(
	commands: readonly VersionCommand[],
): () => Promise<string | undefined> {
	return async () => {
		for (const { command, args = [], pattern } of commands) {
			const version = extractVersion(await runVersion(command, args), pattern);
			if (version) return version;
		}
		return undefined;
	};
}

function noVersion(): Promise<undefined> {
	return Promise.resolve(undefined);
}

// --- Priority levels ---
// 10 = build-system runtimes (checked first to avoid language false-positives)
// 50 = common runtimes (bun, deno, node, python, etc.)
// 100 = default (everything else, checked in definition order)

const PRIORITY_BUILD_SYSTEM = 10;
const PRIORITY_COMMON = 50;
const PRIORITY_DEFAULT = 100;

// --- Runtime definitions ---

const runtimes: RuntimeDef[] = [
	{
		name: "xmake",
		symbol: "",
		style: "bold green",
		priority: PRIORITY_BUILD_SYSTEM,
		detect: { files: ["xmake.lua"] },
		version: versionFromCommands([{ command: "xmake", args: ["--version"] }]),
	},
	{
		name: "maven",
		symbol: "",
		style: "bold bright-cyan",
		priority: PRIORITY_BUILD_SYSTEM,
		detect: { files: ["pom.xml"] },
		version: versionFromCommands([
			{ command: "mvn", args: ["--version"], pattern: /Apache Maven\s+([0-9][^\s]*)/i },
		]),
	},
	{
		name: "gradle",
		symbol: "",
		style: "bold bright-cyan",
		priority: PRIORITY_BUILD_SYSTEM,
		detect: { files: ["build.gradle", "build.gradle.kts"], folders: ["gradle"] },
		version: versionFromCommands([
			{ command: "gradle", args: ["--version"], pattern: /Gradle\s+([0-9][^\s]*)/i },
		]),
	},
	{
		name: "bun",
		symbol: "",
		style: "bold red",
		priority: PRIORITY_COMMON,
		detect: { files: ["bun.lock", "bun.lockb"] },
		version: async () => prefixVersion(await runVersion("bun", ["--version"])),
	},
	{
		name: "deno",
		symbol: "",
		style: "green bold",
		priority: PRIORITY_COMMON,
		detect: { files: ["deno.json", "deno.jsonc", "deno.lock"] },
		version: async () =>
			extractVersion(await runVersion("deno", ["--version"]), /deno\s+([0-9][^\s]*)/i),
	},
	{
		name: "lua",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_COMMON,
		detect: {
			extensions: ["lua"],
			files: [
				"stylua.toml",
				".stylua.toml",
				".luarc.json",
				".luarc.jsonc",
				"init.lua",
				".lua-version",
			],
			folders: ["lua"],
			excludedFiles: ["xmake.lua"],
		},
		version: async () => {
			const lua = await runVersion("lua", ["-v"]);
			const luaMatch = lua?.match(/Lua\s+([0-9][^\s]*)/i);
			if (luaMatch?.[1]) return prefixVersion(luaMatch[1]);
			const luajit = await runVersion("luajit", ["-v"]);
			const luajitMatch = luajit?.match(/LuaJIT\s+([0-9][^\s]*)/i);
			return prefixVersion(luajitMatch?.[1]);
		},
	},
	{
		name: "nodejs",
		symbol: "",
		style: "bold green",
		priority: PRIORITY_COMMON,
		detect: {
			files: ["package.json", ".node-version", ".nvmrc"],
			excludedFiles: ["bunfig.toml", "bun.lock", "bun.lockb"],
		},
		version: async () => prefixVersion(await runVersion("node", ["--version"])),
	},
	{
		name: "python",
		symbol: "",
		style: "yellow bold",
		priority: PRIORITY_COMMON,
		detect: {
			files: [
				"requirements.txt",
				".python-version",
				"pyproject.toml",
				"Pipfile",
				"setup.py",
				"setup.cfg",
			],
		},
		version: async () => {
			const python3 = await runVersion("python3", ["--version"]);
			const python3Match = python3?.match(/Python\s+([0-9][^\s]*)/i);
			if (python3Match?.[1]) return prefixVersion(python3Match[1]);
			const python = await runVersion("python", ["--version"]);
			const pythonMatch = python?.match(/Python\s+([0-9][^\s]*)/i);
			return prefixVersion(pythonMatch?.[1]);
		},
	},
	{
		name: "golang",
		symbol: "",
		style: "bold cyan",
		priority: PRIORITY_COMMON,
		detect: { files: ["go.mod"] },
		version: async () =>
			extractVersion(await runVersion("go", ["version"]), /go version go([0-9][^\s]*)/i),
	},
	{
		name: "rust",
		symbol: "󱘗",
		style: "bold red",
		priority: PRIORITY_COMMON,
		detect: { files: ["Cargo.toml"] },
		version: async () =>
			extractVersion(await runVersion("rustc", ["--version"]), /rustc\s+([0-9][^\s]*)/i),
	},
	{
		name: "java",
		symbol: "",
		style: "red dimmed",
		priority: PRIORITY_COMMON,
		detect: { files: [".java-version"] },
		version: async () => {
			const output = await runVersion("java", ["-version"]);
			const quoted = output?.match(/"([0-9][^"]*)"/);
			if (quoted?.[1]) return prefixVersion(quoted[1]);
			const plain = output?.match(/version\s+([0-9][^\s]*)/i);
			return prefixVersion(plain?.[1]);
		},
	},
	{
		name: "ruby",
		symbol: "",
		style: "bold red",
		priority: PRIORITY_COMMON,
		detect: { files: ["Gemfile", ".ruby-version"] },
		version: async () =>
			extractVersion(await runVersion("ruby", ["--version"]), /ruby\s+([0-9][^\s]*)/i),
	},
	{
		name: "php",
		symbol: "",
		style: "147 bold",
		priority: PRIORITY_COMMON,
		detect: { files: ["composer.json"] },
		version: async () =>
			extractVersion(await runVersion("php", ["--version"]), /PHP\s+([0-9][^\s]*)/i),
	},
	{
		name: "buf",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["buf.yaml", "buf.gen.yaml", "buf.work.yaml"] },
		version: versionFromCommands([{ command: "buf", args: ["--version"] }]),
	},
	{
		name: "cmake",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["CMakeLists.txt", "CMakeCache.txt"] },
		version: versionFromCommands([{ command: "cmake", args: ["--version"] }]),
	},
	{
		name: "cpp",
		symbol: "",
		style: "bold 149",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "tcc"] },
		version: versionFromCommands([
			{ command: "c++", args: ["--version"] },
			{ command: "g++", args: ["--version"] },
			{ command: "clang++", args: ["--version"] },
		]),
	},
	{
		name: "c",
		symbol: "",
		style: "bold 149",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["c", "h"] },
		version: versionFromCommands([
			{ command: "cc", args: ["--version"] },
			{ command: "gcc", args: ["--version"] },
			{ command: "clang", args: ["--version"] },
		]),
	},
	{
		name: "cobol",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["cbl", "cob", "CBL", "COB"] },
		version: versionFromCommands([{ command: "cobc", args: ["--version"] }]),
	},
	{
		name: "conda",
		symbol: "",
		style: "bold green",
		priority: PRIORITY_DEFAULT,
		detect: { env: (env) => Boolean(env.CONDA_DEFAULT_ENV?.trim()) && !env.PIXI_ENVIRONMENT_NAME },
		version: noVersion,
	},
	{
		name: "crystal",
		symbol: "",
		style: "bold red",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["cr"], files: ["shard.yml"] },
		version: versionFromCommands([{ command: "crystal", args: ["--version"] }]),
	},
	{
		name: "dart",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["dart"],
			files: ["pubspec.yaml", "pubspec.yml", "pubspec.lock"],
			folders: [".dart_tool"],
		},
		version: versionFromCommands([{ command: "dart", args: ["--version"] }]),
	},
	{
		name: "dotnet",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["csproj", "fsproj", "xproj"],
			files: [
				"global.json",
				"project.json",
				"Directory.Build.props",
				"Directory.Build.targets",
				"Packages.props",
			],
		},
		version: versionFromCommands([{ command: "dotnet", args: ["--version"] }]),
	},
	{
		name: "elixir",
		symbol: "",
		style: "bold purple",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["mix.exs"] },
		version: versionFromCommands([
			{ command: "elixir", args: ["--version"], pattern: /Elixir\s+([0-9][^\s]*)/i },
		]),
	},
	{
		name: "elm",
		symbol: "",
		style: "cyan bold",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["elm"],
			files: ["elm.json", "elm-package.json", ".elm-version"],
			folders: ["elm-stuff"],
		},
		version: versionFromCommands([{ command: "elm", args: ["--version"] }]),
	},
	{
		name: "erlang",
		symbol: "",
		style: "bold red",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["rebar.config", "erlang.mk"] },
		version: versionFromCommands([{ command: "erl", args: ["-version"] }]),
	},
	{
		name: "fennel",
		symbol: "",
		style: "bold green",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["fnl"] },
		version: versionFromCommands([{ command: "fennel", args: ["--version"] }]),
	},
	{
		name: "fortran",
		symbol: "",
		style: "bold purple",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: [
				"f",
				"F",
				"for",
				"FOR",
				"ftn",
				"FTN",
				"f77",
				"F77",
				"f90",
				"F90",
				"f95",
				"F95",
				"f03",
				"F03",
				"f08",
				"F08",
				"f18",
				"F18",
			],
			files: ["fpm.toml"],
		},
		version: versionFromCommands([
			{ command: "gfortran", args: ["--version"] },
			{ command: "flang", args: ["--version"] },
			{ command: "flang-new", args: ["--version"] },
		]),
	},
	{
		name: "gleam",
		symbol: "",
		style: "bold #FFAFF3",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["gleam"], files: ["gleam.toml"] },
		version: versionFromCommands([{ command: "gleam", args: ["--version"] }]),
	},
	{
		name: "guix_shell",
		symbol: "",
		style: "yellow bold",
		priority: PRIORITY_DEFAULT,
		detect: { env: (env) => Boolean(env.GUIX_ENVIRONMENT?.trim()) },
		version: noVersion,
	},
	{
		name: "haskell",
		symbol: "",
		style: "bold purple",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["hs", "cabal", "hs-boot"], files: ["stack.yaml", "cabal.project"] },
		version: versionFromCommands([{ command: "ghc", args: ["--numeric-version"] }]),
	},
	{
		name: "haxe",
		symbol: "",
		style: "bold fg:202",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["hx", "hxml"],
			files: ["haxelib.json", "hxformat.json", ".haxerc"],
			folders: [".haxelib", "haxe_libraries"],
		},
		version: versionFromCommands([{ command: "haxe", args: ["--version"] }]),
	},
	{
		name: "helm",
		symbol: "",
		style: "bold white",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["helmfile.yaml", "Chart.yaml"] },
		version: versionFromCommands([{ command: "helm", args: ["version", "--short"] }]),
	},
	{
		name: "julia",
		symbol: "",
		style: "bold purple",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["jl"], files: ["Project.toml", "Manifest.toml"] },
		version: versionFromCommands([{ command: "julia", args: ["--version"] }]),
	},
	{
		name: "kotlin",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["kt", "kts"] },
		version: versionFromCommands([{ command: "kotlin", args: ["-version"] }]),
	},
	{
		name: "meson",
		symbol: "󰔷",
		style: "blue bold",
		priority: PRIORITY_DEFAULT,
		detect: { env: (env) => env.MESON_DEVENV === "1" && Boolean(env.MESON_PROJECT_NAME?.trim()) },
		version: noVersion,
	},
	{
		name: "mojo",
		symbol: "󰈸",
		style: "bold 208",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["mojo", "🔥"] },
		version: versionFromCommands([{ command: "mojo", args: ["--version"] }]),
	},
	{
		name: "nim",
		symbol: "",
		style: "bold yellow",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["nim", "nims", "nimble"], files: ["nim.cfg"] },
		version: versionFromCommands([{ command: "nim", args: ["--version"] }]),
	},
	{
		name: "nix_shell",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { env: (env) => env.IN_NIX_SHELL === "pure" || env.IN_NIX_SHELL === "impure" },
		version: noVersion,
	},
	{
		name: "ocaml",
		symbol: "",
		style: "bold yellow",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["opam", "ml", "mli", "re", "rei"],
			files: ["dune", "dune-project", "jbuild", "jbuild-ignore", ".merlin"],
			folders: ["_opam", "esy.lock"],
		},
		version: versionFromCommands([{ command: "ocaml", args: ["-version"] }]),
	},
	{
		name: "odin",
		symbol: "󰟢",
		style: "bold bright-blue",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["odin"] },
		version: versionFromCommands([{ command: "odin", args: ["version"] }]),
	},
	{
		name: "opa",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["rego"] },
		version: versionFromCommands([{ command: "opa", args: ["version"] }]),
	},
	{
		name: "perl",
		symbol: "",
		style: "bold 149",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["pl", "pm", "pod"],
			files: [
				"Makefile.PL",
				"Build.PL",
				"cpanfile",
				"cpanfile.snapshot",
				"META.json",
				"META.yml",
				".perl-version",
			],
		},
		version: versionFromCommands([{ command: "perl", args: ["--version"] }]),
	},
	{
		name: "pixi",
		symbol: "󰏗",
		style: "yellow bold",
		priority: PRIORITY_DEFAULT,
		detect: {
			files: ["pixi.toml", "pixi.lock"],
			env: (env) => Boolean(env.PIXI_ENVIRONMENT_NAME?.trim()),
		},
		version: versionFromCommands([{ command: "pixi", args: ["--version"] }]),
	},
	{
		name: "pulumi",
		symbol: "",
		style: "bold 5",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["Pulumi.yaml", "Pulumi.yml"] },
		version: versionFromCommands([{ command: "pulumi", args: ["version"] }]),
	},
	{
		name: "purescript",
		symbol: "",
		style: "bold white",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["purs"], files: ["spago.dhall", "spago.yaml", "spago.lock"] },
		version: versionFromCommands([{ command: "purs", args: ["--version"] }]),
	},
	{
		name: "raku",
		symbol: "󱖊",
		style: "bold 149",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["p6", "pm6", "pod6", "raku", "rakumod"], files: ["META6.json"] },
		version: versionFromCommands([{ command: "raku", args: ["--version"] }]),
	},
	{
		name: "red",
		symbol: "󱍼",
		style: "red bold",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["red", "reds"] },
		version: versionFromCommands([{ command: "red", args: ["--version"] }]),
	},
	{
		name: "rlang",
		symbol: "󰟔",
		style: "blue bold",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["R", "Rd", "Rmd", "Rproj", "Rsx"],
			files: ["DESCRIPTION"],
			folders: [".Rproj.user"],
		},
		version: versionFromCommands([{ command: "R", args: ["--version"] }]),
	},
	{
		name: "scala",
		symbol: "",
		style: "red dimmed",
		priority: PRIORITY_DEFAULT,
		detect: {
			extensions: ["sbt", "scala"],
			files: [".scalaenv", ".sbtenv", "build.sbt"],
			folders: [".metals"],
		},
		version: versionFromCommands([{ command: "scala", args: ["-version"] }]),
	},
	{
		name: "solidity",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["sol"] },
		version: versionFromCommands([{ command: "solc", args: ["--version"] }]),
	},
	{
		name: "spack",
		symbol: "",
		style: "bold blue",
		priority: PRIORITY_DEFAULT,
		detect: { env: (env) => Boolean(env.SPACK_ENV?.trim()) },
		version: noVersion,
	},
	{
		name: "swift",
		symbol: "",
		style: "bold 202",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["swift"], files: ["Package.swift"] },
		version: versionFromCommands([
			{ command: "swift", args: ["--version"], pattern: /Swift version\s+([0-9][^\s]*)/i },
		]),
	},
	{
		name: "terraform",
		symbol: "",
		style: "bold 105",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["tf", "tfplan", "tfstate"], folders: [".terraform"] },
		version: versionFromCommands([
			{ command: "terraform", args: ["version"] },
			{ command: "tofu", args: ["version"] },
		]),
	},
	{
		name: "typst",
		symbol: "",
		style: "bold #0093A7",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["typ"], files: ["template.typ"] },
		version: versionFromCommands([{ command: "typst", args: ["--version"] }]),
	},
	{
		name: "vagrant",
		symbol: "",
		style: "cyan bold",
		priority: PRIORITY_DEFAULT,
		detect: { files: ["Vagrantfile"] },
		version: versionFromCommands([{ command: "vagrant", args: ["--version"] }]),
	},
	{
		name: "vlang",
		symbol: "",
		style: "blue bold",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["v"], files: ["v.mod", "vpkg.json", ".vpkg-lock.json"] },
		version: versionFromCommands([{ command: "v", args: ["version"] }]),
	},
	{
		name: "zig",
		symbol: "",
		style: "bold yellow",
		priority: PRIORITY_DEFAULT,
		detect: { extensions: ["zig"], files: ["build.zig"] },
		version: versionFromCommands([{ command: "zig", args: ["version"] }]),
	},
];

// Sort once at module load — stable sort preserves definition order within same priority
const sortedRuntimes = [...runtimes].sort((a, b) => a.priority - b.priority);

export const runtimeMetadata: RuntimeMetadata[] = runtimes.map(({ name, symbol, style }) => ({
	name,
	symbol,
	style,
}));

export function detectRuntime(
	cwd: string,
	entries: string[],
	env: RuntimeEnvironment = process.env,
): RuntimeDef | undefined {
	for (const runtime of sortedRuntimes) {
		if (matchesDetection(cwd, entries, runtime.detect, env)) return runtime;
	}
	return undefined;
}

export async function readRuntimeInfo(cwd: string): Promise<RuntimeInfo | undefined> {
	let entries: string[] = [];
	try {
		entries = readdirSync(cwd);
	} catch {
		entries = [];
	}

	const runtime = detectRuntime(cwd, entries);
	if (!runtime) return undefined;
	return {
		name: runtime.name,
		symbol: runtime.symbol,
		style: runtime.style,
		version: await runtime.version(cwd),
	};
}
