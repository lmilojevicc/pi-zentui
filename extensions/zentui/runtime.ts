import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 2500;

export type RuntimeInfo = {
	name: string;
	symbol: string;
	version?: string;
};

type RuntimeCandidate = {
	name: string;
	symbol: string;
	detect: (cwd: string, entries: string[]) => boolean;
	version: (cwd: string) => Promise<string | undefined>;
};

function hasAnyFile(cwd: string, names: string[]): boolean {
	return names.some((name) => existsSync(join(cwd, name)));
}

function hasLuaFile(entries: string[]): boolean {
	return entries.some((entry) => entry.endsWith(".lua"));
}

function hasAnyEntry(entries: string[], names: string[]): boolean {
	return names.some((name) => entries.includes(name));
}

async function runVersion(
	command: string,
	args: string[] = [],
	cwd?: string,
): Promise<string | undefined> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
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

const runtimes: RuntimeCandidate[] = [
	{
		name: "bun",
		symbol: "",
		detect: (cwd) => hasAnyFile(cwd, ["bun.lock", "bun.lockb"]),
		version: async () => prefixVersion(await runVersion("bun", ["--version"])),
	},
	{
		name: "deno",
		symbol: "",
		detect: (cwd) => hasAnyFile(cwd, ["deno.json", "deno.jsonc", "deno.lock"]),
		version: async () => {
			const output = await runVersion("deno", ["--version"]);
			const match = output?.match(/deno\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "lua",
		symbol: "",
		detect: (cwd, entries) =>
			hasAnyFile(cwd, ["stylua.toml", ".stylua.toml", ".luarc.json", ".luarc.jsonc", "init.lua"]) ||
			hasAnyEntry(entries, ["lua"]) ||
			hasLuaFile(entries),
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
		detect: (cwd) => hasAnyFile(cwd, ["package.json", ".nvmrc", ".node-version"]),
		version: async () => prefixVersion(await runVersion("node", ["--version"])),
	},
	{
		name: "python",
		symbol: "",
		detect: (cwd) =>
			hasAnyFile(cwd, [
				"pyproject.toml",
				"requirements.txt",
				"setup.py",
				"setup.cfg",
				"Pipfile",
				".python-version",
			]),
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
		detect: (cwd) => hasAnyFile(cwd, ["go.mod"]),
		version: async () => {
			const output = await runVersion("go", ["version"]);
			const match = output?.match(/go version go([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "rust",
		symbol: "󱘗",
		detect: (cwd) => hasAnyFile(cwd, ["Cargo.toml"]),
		version: async () => {
			const output = await runVersion("rustc", ["--version"]);
			const match = output?.match(/rustc\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "java",
		symbol: "",
		detect: (cwd) => hasAnyFile(cwd, ["pom.xml", "build.gradle", "build.gradle.kts"]),
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
		detect: (cwd) => hasAnyFile(cwd, ["Gemfile", ".ruby-version"]),
		version: async () => {
			const output = await runVersion("ruby", ["--version"]);
			const match = output?.match(/ruby\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "php",
		symbol: "",
		detect: (cwd) => hasAnyFile(cwd, ["composer.json"]),
		version: async () => {
			const output = await runVersion("php", ["--version"]);
			const match = output?.match(/PHP\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
];

export function detectRuntime(cwd: string, entries: string[]): RuntimeCandidate | undefined {
	for (const runtime of runtimes) {
		if (runtime.detect(cwd, entries)) return runtime;
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
		version: await runtime.version(cwd),
	};
}
