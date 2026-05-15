import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectRuntime, runtimeMetadata } from "../extensions/zentui/runtime";

function starshipRuntimeModules(): string[] {
	const toml = readFileSync("test/fixtures/starship-nerd-font-symbols.toml", "utf8");
	return Array.from(toml.matchAll(/^\[([^\]]+)\]/gm), (match) => match[1]).sort();
}

function makeProject(entries: Array<{ path: string; dir?: boolean }>): {
	cwd: string;
	names: string[];
} {
	const cwd = mkdtempSync(join(tmpdir(), "zentui-runtime-"));
	for (const entry of entries) {
		const fullPath = join(cwd, entry.path);
		if (entry.dir) mkdirSync(fullPath, { recursive: true });
		else writeFileSync(fullPath, "", "utf8");
	}
	return { cwd, names: entries.map((entry) => entry.path) };
}

describe("runtimeMetadata", () => {
	it("covers Starship Nerd Font runtime and language modules with icons and Starship styles", () => {
		const byName = new Map(runtimeMetadata.map((runtime) => [runtime.name, runtime]));

		expect([...byName.keys()].sort()).toEqual(starshipRuntimeModules());
		expect(byName.get("bun")).toMatchObject({
			symbol: "",
			style: "bold red",
		});
		expect(byName.get("deno")).toMatchObject({
			symbol: "",
			style: "green bold",
		});
		expect(byName.get("golang")).toMatchObject({
			symbol: "",
			style: "bold cyan",
		});
		expect(byName.get("java")).toMatchObject({
			symbol: "",
			style: "red dimmed",
		});
		expect(byName.get("nodejs")).toMatchObject({
			symbol: "",
			style: "bold green",
		});
		expect(byName.get("opa")).toMatchObject({
			symbol: "",
			style: "bold blue",
		});
		expect(byName.get("zig")).toMatchObject({
			symbol: "",
			style: "bold yellow",
		});
		for (const runtime of runtimeMetadata) {
			expect(Object.keys(runtime).sort()).toEqual(["name", "style", "symbol"]);
			expect(runtime.style).not.toMatch(/^#[0-9A-F]{6}$/);
		}
	});
});

describe("detectRuntime", () => {
	it("prefers bun over node when both markers exist", () => {
		const project = makeProject([{ path: "package.json" }, { path: "bun.lock" }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("bun");
	});

	it("detects deno from config files", () => {
		const project = makeProject([{ path: "deno.json" }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("deno");
		expect(runtime.style).toBe("green bold");
	});

	it("keeps existing node priority when node and go markers both exist", () => {
		const project = makeProject([{ path: "package.json" }, { path: "go.mod" }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("nodejs");
	});

	it("keeps existing runtime detection markers narrow", () => {
		for (const marker of ["index.js", "script.py", "Main.java", "lib.rs", "main.go"]) {
			const project = makeProject([{ path: marker }]);
			expect(detectRuntime(project.cwd, project.names)).toBeUndefined();
		}
	});

	it("prefers newly added tool-specific markers over legacy runtime markers", () => {
		const maven = makeProject([{ path: "pom.xml" }]);
		const gradle = makeProject([{ path: "build.gradle" }]);
		const xmake = makeProject([{ path: "xmake.lua" }]);

		expect(detectRuntime(maven.cwd, maven.names)?.name).toBe("maven");
		expect(detectRuntime(gradle.cwd, gradle.names)?.name).toBe("gradle");
		expect(detectRuntime(xmake.cwd, xmake.names)?.name).toBe("xmake");
	});

	it("keeps java reachable with a Java-specific marker", () => {
		const project = makeProject([{ path: ".java-version" }]);
		expect(detectRuntime(project.cwd, project.names)?.name).toBe("java");
	});

	it("detects lua from top-level lua directory", () => {
		const project = makeProject([{ path: "lua", dir: true }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("lua");
	});

	it.each([
		["buf", "buf.yaml", "bold blue"],
		["c", "hello.c", "bold 149"],
		["cpp", "hello.cpp", "bold 149"],
		["elixir", "mix.exs", "bold purple"],
		["gleam", "gleam.toml", "bold #FFAFF3"],
		["julia", "Project.toml", "bold purple"],
		["opa", "policy.rego", "bold blue"],
		["pixi", "pixi.toml", "yellow bold"],
		["swift", "Package.swift", "bold 202"],
		["xmake", "xmake.lua", "bold green"],
		["zig", "build.zig", "bold yellow"],
	])("detects %s projects from Starship markers", (name, marker, style) => {
		const project = makeProject([{ path: marker }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe(name);
		expect(runtime.style).toBe(style);
	});

	it.each([
		["conda", { CONDA_DEFAULT_ENV: "py312" }, "bold green"],
		["guix_shell", { GUIX_ENVIRONMENT: "/gnu/store/profile" }, "yellow bold"],
		["meson", { MESON_DEVENV: "1", MESON_PROJECT_NAME: "zentui" }, "blue bold"],
		["nix_shell", { IN_NIX_SHELL: "pure" }, "bold blue"],
		["spack", { SPACK_ENV: "dev" }, "bold blue"],
	])("detects %s from Starship environment markers", (name, env, style) => {
		const project = makeProject([]);
		const runtime = detectRuntime(project.cwd, project.names, env);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe(name);
		expect(runtime.style).toBe(style);
	});
});
