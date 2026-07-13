import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	__test__,
	PACKAGE_VERSION_ECOSYSTEMS,
	readPackageVersion,
} from "../extensions/zentui/package-version";

function makeProject(files: Record<string, string>): string {
	const cwd = mkdtempSync(join(tmpdir(), "zentui-package-version-"));
	for (const [name, content] of Object.entries(files)) {
		const full = join(cwd, name);
		if (name.includes("/")) {
			mkdirSync(join(cwd, name.slice(0, name.indexOf("/"))), { recursive: true });
		}
		writeFileSync(full, content, "utf8");
	}
	return cwd;
}

function expectEcosystem(cwd: string, ecosystem: string, version: string) {
	const result = readPackageVersion(cwd);
	expect(result).not.toBeNull();
	if (result === null) throw new Error("expected package version result");
	expect(result.ecosystem).toBe(ecosystem);
	expect(result.version).toBe(version);
}

describe("readPackageVersion", () => {
	it("returns null when no manifest is present", () => {
		const cwd = makeProject({});
		expect(readPackageVersion(cwd)).toBeNull();
	});

	it("parses package.json for npm/bun projects (top-level `version`)", () => {
		const cwd = makeProject({
			"package.json": JSON.stringify({ name: "demo", version: "1.2.3" }),
		});
		expectEcosystem(cwd, "nodejs", "1.2.3");
	});

	it("strips surrounding quotes from package.json values", () => {
		const cwd = makeProject({
			"package.json": JSON.stringify({ name: "demo", version: '"2.0.0"' }, null, 2),
		});
		expect(readPackageVersion(cwd)?.version).toBe("2.0.0");
	});

	it("returns null for malformed package.json JSON without throwing", () => {
		const cwd = makeProject({ "package.json": "{ this is not json" });
		expect(readPackageVersion(cwd)).toBeNull();
	});

	it("parses deno.json and deno.jsonc", () => {
		const denoJson = makeProject({ "deno.json": JSON.stringify({ version: "0.1.0" }) });
		const denoJsonc = makeProject({
			"deno.jsonc": `// leading comment\n${JSON.stringify({ version: "0.2.0" })}`,
		});
		expect(readPackageVersion(denoJson)?.version).toBe("0.1.0");
		expect(readPackageVersion(denoJsonc)?.version).toBe("0.2.0");
	});

	it("parses Maven pom.xml first child <version>", () => {
		const cwd = makeProject({
			"pom.xml":
				"<project><modelVersion>4.0.0</modelVersion><version>3.1.4</version><artifactId>x</artifactId></project>",
		});
		expectEcosystem(cwd, "maven", "3.1.4");
	});

	it("parses Gradle gradle.properties", () => {
		const cwd = makeProject({ "gradle.properties": "version=4.5.6\ngroup=com.example\n" });
		expectEcosystem(cwd, "gradle", "4.5.6");
	});

	it("parses Python pyproject.toml [project].version", () => {
		const cwd = makeProject({
			"pyproject.toml": `[project]\nname = "x"\nversion = "1.0.0"\n`,
		});
		expectEcosystem(cwd, "python", "1.0.0");
	});

	it("parses Python pyproject.toml poetry fallback", () => {
		const cwd = makeProject({
			"pyproject.toml": `[tool.poetry]\nname = "x"\nversion = "2.0.0"\n`,
		});
		expectEcosystem(cwd, "python", "2.0.0");
	});

	it("parses Python setup.cfg [metadata].version", () => {
		const cwd = makeProject({
			"setup.cfg": "[metadata]\nname = x\nversion = 3.2.1\n[options]\ninstall_requires = []\n",
		});
		expectEcosystem(cwd, "python", "3.2.1");
	});

	it("parses Rust Cargo.toml [package].version", () => {
		const cwd = makeProject({
			"Cargo.toml": `[package]\nname = "x"\nversion = "0.4.2"\nedition = "2021"\n`,
		});
		expectEcosystem(cwd, "rust", "0.4.2");
	});

	it("parses Rust Cargo.toml workspace-inherited version", () => {
		const cwd = makeProject({
			"Cargo.toml": `[package]\nname = "x"\nversion.workspace = true\n\n[workspace]\nversion = "0.9.0"\n`,
		});
		expectEcosystem(cwd, "rust", "0.9.0");
	});

	it("parses PHP composer.json version", () => {
		const cwd = makeProject({
			"composer.json": JSON.stringify({ name: "demo/demo", version: "1.4.0" }),
		});
		expectEcosystem(cwd, "php", "1.4.0");
	});

	it("parses Crystal shard.yml top-level version", () => {
		const cwd = makeProject({
			"shard.yml": `name: x\nversion: 0.3.0\n\ndependencies:\n  yaml: ~> 1.0\n`,
		});
		expectEcosystem(cwd, "crystal", "0.3.0");
	});

	it("parses Dart pubspec.yaml version", () => {
		const cwd = makeProject({
			"pubspec.yaml": `name: x\nversion: 2.5.0\nenvironment:\n  sdk: ">=3.0.0"\n`,
		});
		expectEcosystem(cwd, "dart", "2.5.0");
	});

	it("parses Dart pubspec.yml fallback", () => {
		const cwd = makeProject({
			"pubspec.yml": `name: x\nversion: 2.6.0\n`,
		});
		expectEcosystem(cwd, "dart", "2.6.0");
	});

	it("parses Elixir mix.exs project version literal", () => {
		const cwd = makeProject({
			"mix.exs":
				'defmodule Demo.MixProject do\n  use Mix.Project\n\n  def project do\n    [\n      app: :demo,\n      version: "1.7.3",\n      elixir: "~> 1.14"\n    ]\n  end\nend\n',
		});
		expectEcosystem(cwd, "elixir", "1.7.3");
	});

	it("parses elm.json top-level version", () => {
		const cwd = makeProject({
			"elm.json": JSON.stringify({
				type: "application",
				"source-directories": ["src"],
				"elm-version": "0.19.1",
				version: "1.0.0",
				dependencies: { direct: {}, indirect: {} },
				"test-dependencies": { direct: {}, indirect: {} },
			}),
		});
		expectEcosystem(cwd, "elm", "1.0.0");
	});

	it("parses Fortran fpm.toml version", () => {
		const cwd = makeProject({
			"fpm.toml": `[package]\nname = "x"\nversion = "0.2.1"\n`,
		});
		expectEcosystem(cwd, "fortran", "0.2.1");
	});

	it("parses Gleam gleam.toml top-level version", () => {
		const cwd = makeProject({
			"gleam.toml": `name = "x"\nversion = "1.0.0"\ndescription = "demo"\n`,
		});
		expectEcosystem(cwd, "gleam", "1.0.0");
	});

	it("parses Haskell *.cabal version in package stanza", () => {
		const cwd = makeProject({
			"x.cabal": `cabal-version: 2.4\nname: x\nversion: 0.6.0\n\nlibrary\n  exposed-modules: X\n  build-depends: base >= 4.14\n`,
		});
		expectEcosystem(cwd, "haskell", "0.6.0");
	});

	it("parses Helm Chart.yaml chart version", () => {
		const cwd = makeProject({
			"Chart.yaml":
				'apiVersion: v2\nname: x\ndescription: demo\nversion: 0.1.2\nappVersion: "1.0.0"\n',
		});
		expectEcosystem(cwd, "helm", "0.1.2");
	});

	it("parses Julia Project.toml top-level version", () => {
		const cwd = makeProject({
			"Project.toml": `name = "X"\nversion = "0.5.2"\n\n[deps]\n\n[compat]\n`,
		});
		expectEcosystem(cwd, "julia", "0.5.2");
	});

	it("parses Meson meson.build static project() version literal", () => {
		const cwd = makeProject({
			"meson.build":
				"project('x', 'c', version: '0.3.0', license: 'MIT')\n\n executable('x', 'main.c')\n",
		});
		expectEcosystem(cwd, "meson", "0.3.0");
	});

	it("parses Nim *.nimble top-level version", () => {
		const cwd = makeProject({
			"x.nimble": `# Package\nversion       = "0.2.1"\nauthor        = "x"\ndescription   = "demo"\nlicense       = "MIT"\n\nrequires "nim >= 1.6"\n`,
		});
		expectEcosystem(cwd, "nim", "0.2.1");
	});

	it("parses Ruby *.gemspec spec.version assignment", () => {
		const cwd = makeProject({
			"x.gemspec": `Gem::Specification.new do |s|\n  s.name = 'x'\n  s.version = '1.2.0'\n  s.summary = 'demo'\nend\n`,
		});
		expectEcosystem(cwd, "ruby", "1.2.0");
	});

	it("parses Vlang v.mod module version", () => {
		const cwd = makeProject({
			"v.mod": `Module {\n\tname: 'x'\n\tversion: '0.4.0'\n\tdescription: 'demo'\n\tauthor: 'x'\n}\n`,
		});
		expectEcosystem(cwd, "vlang", "0.4.0");
	});

	it("parses Xmake xmake.lua static set_version literal", () => {
		const cwd = makeProject({
			"xmake.lua": `add_rules("mode.debug", "mode.release")\nset_version("1.6.0")\n\ntarget("demo")\n`,
		});
		expectEcosystem(cwd, "xmake", "1.6.0");
	});

	it("returns null for manifests without a parseable version (silent fallback)", () => {
		const cases: Array<[string, string]> = [
			["package.json", JSON.stringify({ name: "demo" })],
			["deno.json", JSON.stringify({ name: "demo" })],
			["Cargo.toml", `[package]\nname = "x"\nedition = "2021"\n`],
			["pyproject.toml", `[project]\nname = "x"\n`],
			["meson.build", "project('x', 'c')\n"],
			["xmake.lua", "add_rules('mode.debug')\n"],
		];
		for (const [file, content] of cases) {
			const cwd = makeProject({ [file]: content });
			expect(readPackageVersion(cwd)).toBeNull();
		}
	});

	it("prefers package.json over Chart.yaml when both exist (deterministic priority)", () => {
		const cwd = makeProject({
			"package.json": JSON.stringify({ version: "1.0.0" }),
			"Chart.yaml": "apiVersion: v2\nversion: 2.0.0\n",
		});
		const result = readPackageVersion(cwd);
		expect(result).not.toBeNull();
		expect(result?.ecosystem).toBe("nodejs");
		expect(result?.version).toBe("1.0.0");
	});

	it("strips a single leading 'v' from semver versions", () => {
		const cwd = makeProject({
			"package.json": JSON.stringify({ version: "v3.2.1" }),
		});
		expect(readPackageVersion(cwd)?.version).toBe("3.2.1");
	});

	it("does not shell out and survives missing manifests silently", () => {
		const cwd = mkdtempSync(join(tmpdir(), "zentui-empty-project-"));
		expect(readPackageVersion(cwd)).toBeNull();
	});

	it("exposes PACKAGE_VERSION_ECOSYSTEMS as a stable, sorted-ish list", () => {
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("bun");
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("nodejs");
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("python");
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("rust");
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("haskell");
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("ruby");
		expect(PACKAGE_VERSION_ECOSYSTEMS).toContain("nim");
	});
});

describe("cleanVersion", () => {
	const { cleanVersion } = __test__;

	it.each([
		["1.2.3", "1.2.3"],
		['"1.2.3"', "1.2.3"],
		["'1.2.3'", "1.2.3"],
		["  1.2.3  ", "1.2.3"],
		["v3.2.1", "3.2.1"],
		["0.0.1-alpha", "0.0.1-alpha"],
	])("cleans %j -> %j", (input, expected) => {
		expect(cleanVersion(input)).toBe(expected);
	});

	it.each(["", "   ", "not a version", "1.2.3 with spaces", "{1.2.3}"])("rejects %j", (input) => {
		expect(cleanVersion(input)).toBeUndefined();
	});
});
