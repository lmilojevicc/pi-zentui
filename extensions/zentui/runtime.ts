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

type RuntimeCandidate = RuntimeMetadata & {
	detect: (cwd: string, entries: string[], env: RuntimeEnvironment) => boolean;
	version: (cwd: string) => Promise<string | undefined>;
};

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

function defineRuntime(
	metadata: RuntimeMetadata,
	detection: DetectionSpec,
	version: (cwd: string) => Promise<string | undefined> = noVersion,
): RuntimeCandidate {
	return {
		...metadata,
		detect: (cwd, entries, env) => matchesDetection(cwd, entries, detection, env),
		version,
	};
}

const runtimes: RuntimeCandidate[] = [
	defineRuntime(
		{
			name: "buf",
			symbol: "",
			style: "bold blue",
		},
		{ files: ["buf.yaml", "buf.gen.yaml", "buf.work.yaml"] },
		versionFromCommands([{ command: "buf", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "bun",
			symbol: "",
			style: "bold red",
		},
		{ files: ["bun.lock", "bun.lockb"] },
		async () => prefixVersion(await runVersion("bun", ["--version"])),
	),
	defineRuntime(
		{
			name: "deno",
			symbol: "",
			style: "green bold",
		},
		{
			files: ["deno.json", "deno.jsonc", "deno.lock"],
		},
		async () => extractVersion(await runVersion("deno", ["--version"]), /deno\s+([0-9][^\s]*)/i),
	),
	defineRuntime(
		{
			name: "cmake",
			symbol: "",
			style: "bold blue",
		},
		{ files: ["CMakeLists.txt", "CMakeCache.txt"] },
		versionFromCommands([{ command: "cmake", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "cpp",
			symbol: "",
			style: "bold 149",
		},
		{ extensions: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "tcc"] },
		versionFromCommands([
			{ command: "c++", args: ["--version"] },
			{ command: "g++", args: ["--version"] },
			{ command: "clang++", args: ["--version"] },
		]),
	),
	defineRuntime(
		{
			name: "c",
			symbol: "",
			style: "bold 149",
		},
		{ extensions: ["c", "h"] },
		versionFromCommands([
			{ command: "cc", args: ["--version"] },
			{ command: "gcc", args: ["--version"] },
			{ command: "clang", args: ["--version"] },
		]),
	),
	defineRuntime(
		{
			name: "cobol",
			symbol: "",
			style: "bold blue",
		},
		{ extensions: ["cbl", "cob", "CBL", "COB"] },
		versionFromCommands([{ command: "cobc", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "conda",
			symbol: "",
			style: "bold green",
		},
		{
			env: (env) => Boolean(env.CONDA_DEFAULT_ENV?.trim()) && !env.PIXI_ENVIRONMENT_NAME,
		},
	),
	defineRuntime(
		{
			name: "crystal",
			symbol: "",
			style: "bold red",
		},
		{ extensions: ["cr"], files: ["shard.yml"] },
		versionFromCommands([{ command: "crystal", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "dart",
			symbol: "",
			style: "bold blue",
		},
		{
			extensions: ["dart"],
			files: ["pubspec.yaml", "pubspec.yml", "pubspec.lock"],
			folders: [".dart_tool"],
		},
		versionFromCommands([{ command: "dart", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "dotnet",
			symbol: "",
			style: "bold blue",
		},
		{
			extensions: ["csproj", "fsproj", "xproj"],
			files: [
				"global.json",
				"project.json",
				"Directory.Build.props",
				"Directory.Build.targets",
				"Packages.props",
			],
		},
		versionFromCommands([{ command: "dotnet", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "elixir",
			symbol: "",
			style: "bold purple",
		},
		{ files: ["mix.exs"] },
		versionFromCommands([
			{ command: "elixir", args: ["--version"], pattern: /Elixir\s+([0-9][^\s]*)/i },
		]),
	),
	defineRuntime(
		{
			name: "elm",
			symbol: "",
			style: "cyan bold",
		},
		{
			extensions: ["elm"],
			files: ["elm.json", "elm-package.json", ".elm-version"],
			folders: ["elm-stuff"],
		},
		versionFromCommands([{ command: "elm", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "erlang",
			symbol: "",
			style: "bold red",
		},
		{ files: ["rebar.config", "erlang.mk"] },
		versionFromCommands([{ command: "erl", args: ["-version"] }]),
	),
	defineRuntime(
		{
			name: "fennel",
			symbol: "",
			style: "bold green",
		},
		{ extensions: ["fnl"] },
		versionFromCommands([{ command: "fennel", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "fortran",
			symbol: "",
			style: "bold purple",
		},
		{
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
		versionFromCommands([
			{ command: "gfortran", args: ["--version"] },
			{ command: "flang", args: ["--version"] },
			{ command: "flang-new", args: ["--version"] },
		]),
	),
	defineRuntime(
		{
			name: "gleam",
			symbol: "",
			style: "bold #FFAFF3",
		},
		{ extensions: ["gleam"], files: ["gleam.toml"] },
		versionFromCommands([{ command: "gleam", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "golang",
			symbol: "",
			style: "bold cyan",
		},
		{ files: ["go.mod"] },
		async () => extractVersion(await runVersion("go", ["version"]), /go version go([0-9][^\s]*)/i),
	),
	defineRuntime(
		{
			name: "gradle",
			symbol: "",
			style: "bold bright-cyan",
		},
		{ files: ["build.gradle", "build.gradle.kts"], folders: ["gradle"] },
		versionFromCommands([
			{ command: "gradle", args: ["--version"], pattern: /Gradle\s+([0-9][^\s]*)/i },
		]),
	),
	defineRuntime(
		{
			name: "guix_shell",
			symbol: "",
			style: "yellow bold",
		},
		{ env: (env) => Boolean(env.GUIX_ENVIRONMENT?.trim()) },
	),
	defineRuntime(
		{
			name: "haskell",
			symbol: "",
			style: "bold purple",
		},
		{ extensions: ["hs", "cabal", "hs-boot"], files: ["stack.yaml", "cabal.project"] },
		versionFromCommands([{ command: "ghc", args: ["--numeric-version"] }]),
	),
	defineRuntime(
		{
			name: "haxe",
			symbol: "",
			style: "bold fg:202",
		},
		{
			extensions: ["hx", "hxml"],
			files: ["haxelib.json", "hxformat.json", ".haxerc"],
			folders: [".haxelib", "haxe_libraries"],
		},
		versionFromCommands([{ command: "haxe", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "helm",
			symbol: "",
			style: "bold white",
		},
		{ files: ["helmfile.yaml", "Chart.yaml"] },
		versionFromCommands([{ command: "helm", args: ["version", "--short"] }]),
	),
	defineRuntime(
		{
			name: "java",
			symbol: "",
			style: "red dimmed",
		},
		{ files: [".java-version"] },
		async () => {
			const output = await runVersion("java", ["-version"]);
			const quoted = output?.match(/"([0-9][^"]*)"/);
			if (quoted?.[1]) return prefixVersion(quoted[1]);
			const plain = output?.match(/version\s+([0-9][^\s]*)/i);
			return prefixVersion(plain?.[1]);
		},
	),
	defineRuntime(
		{
			name: "julia",
			symbol: "",
			style: "bold purple",
		},
		{ extensions: ["jl"], files: ["Project.toml", "Manifest.toml"] },
		versionFromCommands([{ command: "julia", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "kotlin",
			symbol: "",
			style: "bold blue",
		},
		{ extensions: ["kt", "kts"] },
		versionFromCommands([{ command: "kotlin", args: ["-version"] }]),
	),
	defineRuntime(
		{
			name: "lua",
			symbol: "",
			style: "bold blue",
		},
		{
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
		async () => {
			const lua = await runVersion("lua", ["-v"]);
			const luaMatch = lua?.match(/Lua\s+([0-9][^\s]*)/i);
			if (luaMatch?.[1]) return prefixVersion(luaMatch[1]);
			const luajit = await runVersion("luajit", ["-v"]);
			const luajitMatch = luajit?.match(/LuaJIT\s+([0-9][^\s]*)/i);
			return prefixVersion(luajitMatch?.[1]);
		},
	),
	defineRuntime(
		{
			name: "maven",
			symbol: "",
			style: "bold bright-cyan",
		},
		{ files: ["pom.xml"] },
		versionFromCommands([
			{ command: "mvn", args: ["--version"], pattern: /Apache Maven\s+([0-9][^\s]*)/i },
		]),
	),
	defineRuntime(
		{
			name: "meson",
			symbol: "󰔷",
			style: "blue bold",
		},
		{
			env: (env) => env.MESON_DEVENV === "1" && Boolean(env.MESON_PROJECT_NAME?.trim()),
		},
	),
	defineRuntime(
		{
			name: "mojo",
			symbol: "󰈸",
			style: "bold 208",
		},
		{ extensions: ["mojo", "🔥"] },
		versionFromCommands([{ command: "mojo", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "nim",
			symbol: "",
			style: "bold yellow",
		},
		{ extensions: ["nim", "nims", "nimble"], files: ["nim.cfg"] },
		versionFromCommands([{ command: "nim", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "nix_shell",
			symbol: "",
			style: "bold blue",
		},
		{ env: (env) => env.IN_NIX_SHELL === "pure" || env.IN_NIX_SHELL === "impure" },
	),
	defineRuntime(
		{
			name: "nodejs",
			symbol: "",
			style: "bold green",
		},
		{
			files: ["package.json", ".node-version", ".nvmrc"],
			excludedFiles: ["bunfig.toml", "bun.lock", "bun.lockb"],
		},
		async () => prefixVersion(await runVersion("node", ["--version"])),
	),
	defineRuntime(
		{
			name: "python",
			symbol: "",
			style: "yellow bold",
		},
		{
			files: [
				"requirements.txt",
				".python-version",
				"pyproject.toml",
				"Pipfile",
				"setup.py",
				"setup.cfg",
			],
		},
		async () => {
			const python3 = await runVersion("python3", ["--version"]);
			const python3Match = python3?.match(/Python\s+([0-9][^\s]*)/i);
			if (python3Match?.[1]) return prefixVersion(python3Match[1]);
			const python = await runVersion("python", ["--version"]);
			const pythonMatch = python?.match(/Python\s+([0-9][^\s]*)/i);
			return prefixVersion(pythonMatch?.[1]);
		},
	),
	defineRuntime(
		{
			name: "rust",
			symbol: "󱘗",
			style: "bold red",
		},
		{ files: ["Cargo.toml"] },
		async () => extractVersion(await runVersion("rustc", ["--version"]), /rustc\s+([0-9][^\s]*)/i),
	),
	defineRuntime(
		{
			name: "ruby",
			symbol: "",
			style: "bold red",
		},
		{ files: ["Gemfile", ".ruby-version"] },
		async () => extractVersion(await runVersion("ruby", ["--version"]), /ruby\s+([0-9][^\s]*)/i),
	),
	defineRuntime(
		{
			name: "php",
			symbol: "",
			style: "147 bold",
		},
		{ files: ["composer.json"] },
		async () => extractVersion(await runVersion("php", ["--version"]), /PHP\s+([0-9][^\s]*)/i),
	),
	defineRuntime(
		{
			name: "ocaml",
			symbol: "",
			style: "bold yellow",
		},
		{
			extensions: ["opam", "ml", "mli", "re", "rei"],
			files: ["dune", "dune-project", "jbuild", "jbuild-ignore", ".merlin"],
			folders: ["_opam", "esy.lock"],
		},
		versionFromCommands([{ command: "ocaml", args: ["-version"] }]),
	),
	defineRuntime(
		{
			name: "odin",
			symbol: "󰟢",
			style: "bold bright-blue",
		},
		{ extensions: ["odin"] },
		versionFromCommands([{ command: "odin", args: ["version"] }]),
	),
	defineRuntime(
		{
			name: "opa",
			symbol: "",
			style: "bold blue",
		},
		{ extensions: ["rego"] },
		versionFromCommands([{ command: "opa", args: ["version"] }]),
	),
	defineRuntime(
		{
			name: "perl",
			symbol: "",
			style: "bold 149",
		},
		{
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
		versionFromCommands([{ command: "perl", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "pixi",
			symbol: "󰏗",
			style: "yellow bold",
		},
		{
			files: ["pixi.toml", "pixi.lock"],
			env: (env) => Boolean(env.PIXI_ENVIRONMENT_NAME?.trim()),
		},
		versionFromCommands([{ command: "pixi", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "pulumi",
			symbol: "",
			style: "bold 5",
		},
		{ files: ["Pulumi.yaml", "Pulumi.yml"] },
		versionFromCommands([{ command: "pulumi", args: ["version"] }]),
	),
	defineRuntime(
		{
			name: "purescript",
			symbol: "",
			style: "bold white",
		},
		{ extensions: ["purs"], files: ["spago.dhall", "spago.yaml", "spago.lock"] },
		versionFromCommands([{ command: "purs", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "raku",
			symbol: "󱖊",
			style: "bold 149",
		},
		{ extensions: ["p6", "pm6", "pod6", "raku", "rakumod"], files: ["META6.json"] },
		versionFromCommands([{ command: "raku", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "red",
			symbol: "󱍼",
			style: "red bold",
		},
		{ extensions: ["red", "reds"] },
		versionFromCommands([{ command: "red", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "rlang",
			symbol: "󰟔",
			style: "blue bold",
		},
		{
			extensions: ["R", "Rd", "Rmd", "Rproj", "Rsx"],
			files: ["DESCRIPTION"],
			folders: [".Rproj.user"],
		},
		versionFromCommands([{ command: "R", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "scala",
			symbol: "",
			style: "red dimmed",
		},
		{
			extensions: ["sbt", "scala"],
			files: [".scalaenv", ".sbtenv", "build.sbt"],
			folders: [".metals"],
		},
		versionFromCommands([{ command: "scala", args: ["-version"] }]),
	),
	defineRuntime(
		{
			name: "solidity",
			symbol: "",
			style: "bold blue",
		},
		{ extensions: ["sol"] },
		versionFromCommands([{ command: "solc", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "spack",
			symbol: "",
			style: "bold blue",
		},
		{ env: (env) => Boolean(env.SPACK_ENV?.trim()) },
	),
	defineRuntime(
		{
			name: "swift",
			symbol: "",
			style: "bold 202",
		},
		{ extensions: ["swift"], files: ["Package.swift"] },
		versionFromCommands([
			{ command: "swift", args: ["--version"], pattern: /Swift version\s+([0-9][^\s]*)/i },
		]),
	),
	defineRuntime(
		{
			name: "terraform",
			symbol: "",
			style: "bold 105",
		},
		{ extensions: ["tf", "tfplan", "tfstate"], folders: [".terraform"] },
		versionFromCommands([
			{ command: "terraform", args: ["version"] },
			{ command: "tofu", args: ["version"] },
		]),
	),
	defineRuntime(
		{
			name: "typst",
			symbol: "",
			style: "bold #0093A7",
		},
		{ extensions: ["typ"], files: ["template.typ"] },
		versionFromCommands([{ command: "typst", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "vagrant",
			symbol: "",
			style: "cyan bold",
		},
		{ files: ["Vagrantfile"] },
		versionFromCommands([{ command: "vagrant", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "vlang",
			symbol: "",
			style: "blue bold",
		},
		{ extensions: ["v"], files: ["v.mod", "vpkg.json", ".vpkg-lock.json"] },
		versionFromCommands([{ command: "v", args: ["version"] }]),
	),
	defineRuntime(
		{
			name: "xmake",
			symbol: "",
			style: "bold green",
		},
		{ files: ["xmake.lua"] },
		versionFromCommands([{ command: "xmake", args: ["--version"] }]),
	),
	defineRuntime(
		{
			name: "zig",
			symbol: "",
			style: "bold yellow",
		},
		{ extensions: ["zig"], files: ["build.zig"] },
		versionFromCommands([{ command: "zig", args: ["version"] }]),
	),
];

export const runtimeMetadata: RuntimeMetadata[] = runtimes.map(({ name, symbol, style }) => ({
	name,
	symbol,
	style,
}));

const priorityRuntimeOrder = ["xmake", "maven", "gradle"] as const;
const legacyRuntimeOrder = [
	"bun",
	"deno",
	"lua",
	"nodejs",
	"python",
	"golang",
	"rust",
	"java",
	"ruby",
	"php",
] as const;
const orderedRuntimeNames = new Set<string>([...priorityRuntimeOrder, ...legacyRuntimeOrder]);
const runtimesByName = new Map(runtimes.map((runtime) => [runtime.name, runtime]));

export function detectRuntime(
	cwd: string,
	entries: string[],
	env: RuntimeEnvironment = process.env,
): RuntimeCandidate | undefined {
	for (const name of priorityRuntimeOrder) {
		const runtime = runtimesByName.get(name);
		if (runtime?.detect(cwd, entries, env)) return runtime;
	}

	for (const name of legacyRuntimeOrder) {
		const runtime = runtimesByName.get(name);
		if (runtime?.detect(cwd, entries, env)) return runtime;
	}

	for (const runtime of runtimes) {
		if (orderedRuntimeNames.has(runtime.name)) continue;
		if (runtime.detect(cwd, entries, env)) return runtime;
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
