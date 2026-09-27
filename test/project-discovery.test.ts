import * as fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ version: vi.fn() }));
vi.mock("node:child_process", () => ({
	execFile: Object.assign(vi.fn(), {
		[Symbol.for("nodejs.util.promisify.custom")]: probes.version,
	}),
}));
vi.mock("node:fs", async (original) => {
	const actual = await original<typeof import("node:fs")>();
	return {
		...actual,
		readdirSync: vi.fn(actual.readdirSync),
		statSync: vi.fn(actual.statSync),
		existsSync: vi.fn(actual.existsSync),
		readFileSync: vi.fn(actual.readFileSync),
	};
});
vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>();
	return {
		...actual,
		readdir: vi.fn(actual.readdir),
		stat: vi.fn(actual.stat),
		readFile: vi.fn(actual.readFile),
	};
});

import { readPackageVersion, readPackageVersionResult } from "../extensions/zentui/package-version";
import { ProjectDiscovery } from "../extensions/zentui/project-discovery";
import {
	clearRuntimeInfoCache,
	detectRuntime,
	readRuntimeInfo,
} from "../extensions/zentui/runtime";

let cwd: string;
const envKeys = [
	"CONDA_DEFAULT_ENV",
	"PIXI_ENVIRONMENT_NAME",
	"GUIX_ENVIRONMENT",
	"MESON_DEVENV",
	"MESON_PROJECT_NAME",
	"IN_NIX_SHELL",
	"SPACK_ENV",
];
function write(name: string, content = "") {
	fs.writeFileSync(join(cwd, name), content);
}
async function refresh() {
	const discovery = new ProjectDiscovery(cwd);
	return Promise.all([readRuntimeInfo(cwd, discovery), readPackageVersionResult(cwd, discovery)]);
}
beforeEach(() => {
	cwd = fs.mkdtempSync(join(tmpdir(), "zentui-discovery-"));
	for (const key of envKeys) vi.stubEnv(key, "");
	clearRuntimeInfoCache();
	vi.clearAllMocks();
	probes.version.mockResolvedValue({ stdout: "v1.2.3", stderr: "" });
});
afterEach(async () => {
	vi.restoreAllMocks();
	const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	vi.mocked(asyncFs.stat).mockReset().mockImplementation(actual.stat);
	vi.mocked(asyncFs.readFile).mockReset().mockImplementation(actual.readFile);
	vi.unstubAllEnvs();
	fs.rmSync(cwd, { recursive: true, force: true });
	clearRuntimeInfoCache();
});

// Model filesystem resolution, not the platform: tests run both policies on any volume.
async function mockCaseResolution(insensitive: boolean, names: string[]) {
	const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	const resolvePath = (path: unknown) => {
		const requested = String(path);
		const name = basename(requested);
		const alternate = names.find((entry) => entry.toLowerCase() === name.toLowerCase());
		if (!alternate || names.includes(name)) return requested;
		if (insensitive) return join(cwd, alternate);
		throw Object.assign(new Error("case-sensitive lookup"), { code: "ENOENT" });
	};
	vi.mocked(asyncFs.stat).mockImplementation(
		async (path, options) => actual.stat(resolvePath(path), options) as never,
	);
	vi.mocked(asyncFs.readFile).mockImplementation(
		async (path, options) => actual.readFile(resolvePath(path), options) as never,
	);
}

describe("filesystem filename semantics", () => {
	it("matches synchronous lookup on the actual filesystem for alternate-case names", async () => {
		write("PACKAGE.JSON", '{"version":"1"}');
		const expectedRuntime = detectRuntime(cwd, ["PACKAGE.JSON"], {});
		const expectedPackage = readPackageVersion(cwd);
		expect(await refresh()).toMatchObject([
			{ runtime: expectedRuntime ? { name: expectedRuntime.name } : undefined },
			{ result: expectedPackage },
		]);
		fs.rmSync(join(cwd, "PACKAGE.JSON"));
		fs.mkdirSync(join(cwd, "GRADLE"));
		const expectedFolder = detectRuntime(cwd, ["GRADLE"], {});
		expect((await refresh())[0]).toMatchObject({
			runtime: expectedFolder ? { name: expectedFolder.name } : undefined,
		});
	});

	it.each([false, true])(
		"defers alternate-case manifest/marker resolution to fs (insensitive=%s)",
		async (insensitive) => {
			write("PACKAGE.JSON", '{"version":"1"}');
			await mockCaseResolution(insensitive, ["PACKAGE.JSON"]);
			expect(await refresh()).toMatchObject([
				{ runtime: insensitive ? { name: "nodejs" } : undefined },
				{ result: insensitive ? { ecosystem: "nodejs", version: "1" } : null },
			]);
			expect(asyncFs.readdir).toHaveBeenCalledTimes(1);
			expect(asyncFs.stat).toHaveBeenCalledTimes(1);
			expect(asyncFs.stat).toHaveBeenCalledWith(join(cwd, "package.json"));
			expect(asyncFs.readFile).toHaveBeenCalledTimes(1);
			expect(asyncFs.readFile).toHaveBeenCalledWith(join(cwd, "package.json"), "utf8");
			for (const operation of [fs.readdirSync, fs.statSync, fs.existsSync, fs.readFileSync])
				expect(operation).not.toHaveBeenCalled();
			write("PACKAGE.JSON", '{"version":"222"}');
			expect((await refresh())[1]).toMatchObject({
				result: insensitive ? { version: "222" } : null,
			});
			expect(probes.version).toHaveBeenCalledTimes(insensitive ? 2 : 0);
		},
	);

	it.each([false, true])(
		"preserves manifest priority and read-failure recovery (insensitive=%s)",
		async (insensitive) => {
			write("PACKAGE.JSON", '{"version":"1"}');
			write("deno.json", '{"version":"2"}');
			await mockCaseResolution(insensitive, ["PACKAGE.JSON", "deno.json"]);
			expect(await readPackageVersionResult(cwd)).toMatchObject({
				result: { version: insensitive ? "1" : "2" },
			});
			const read = vi.mocked(asyncFs.readFile).getMockImplementation();
			if (!read) throw new Error("missing filesystem mock");
			vi.mocked(asyncFs.readFile).mockImplementationOnce((path, options) =>
				String(path) === join(cwd, "package.json")
					? Promise.reject(new Error("denied"))
					: (read(path, options) as never),
			);
			expect(await readPackageVersionResult(cwd)).toMatchObject({ result: { version: "2" } });
			expect(await readPackageVersionResult(cwd)).toMatchObject({
				result: { version: insensitive ? "1" : "2" },
			});
		},
	);

	it.each([false, true])(
		"keeps alternate-case folder type and symlink checks (insensitive=%s)",
		async (insensitive) => {
			write("GRADLE");
			await mockCaseResolution(insensitive, ["GRADLE"]);
			expect((await refresh())[0]).toMatchObject({ runtime: undefined });
			fs.rmSync(join(cwd, "GRADLE"));
			fs.mkdirSync(join(cwd, "GRADLE"));
			expect((await refresh())[0]).toMatchObject({
				runtime: insensitive ? { name: "gradle" } : undefined,
			});
			fs.rmSync(join(cwd, "GRADLE"), { recursive: true });
			fs.symlinkSync("target", join(cwd, "GRADLE"));
			expect((await refresh())[0]).toMatchObject({ runtime: undefined });
			fs.mkdirSync(join(cwd, "target"));
			expect((await refresh())[0]).toMatchObject({
				runtime: insensitive ? { name: "gradle" } : undefined,
			});
		},
	);

	it("invalidates versions for alternate-case manager marker changes", async () => {
		write("package.json", "{}");
		write(".TOOL-VERSIONS", "nodejs 22");
		await mockCaseResolution(true, ["package.json", ".TOOL-VERSIONS"]);
		await refresh();
		await refresh();
		expect(probes.version).toHaveBeenCalledTimes(1);
		write(".TOOL-VERSIONS", "nodejs 100");
		await refresh();
		expect(probes.version).toHaveBeenCalledTimes(2);
	});
});

describe("refresh-scoped project discovery", () => {
	it("shares one scan and marker stat, reads fresh manifests each refresh, with no sync I/O", async () => {
		write("package.json", '{"version":"1.0.0"}');
		for (let i = 0; i < 10; i++) {
			expect(await refresh()).toMatchObject([
				{ runtime: { name: "nodejs" } },
				{ result: { version: "1.0.0" } },
			]);
		}
		expect(asyncFs.readdir).toHaveBeenCalledTimes(10);
		expect(asyncFs.stat).toHaveBeenCalledTimes(10);
		expect(asyncFs.readFile).toHaveBeenCalledTimes(10);
		expect(probes.version).toHaveBeenCalledTimes(1);
		for (const operation of [fs.readdirSync, fs.statSync, fs.existsSync, fs.readFileSync])
			expect(operation).not.toHaveBeenCalled();
		write("package.json", '{"version":"22.0.0"}');
		expect((await refresh())[1]).toMatchObject({ result: { version: "22.0.0" } });
		expect(probes.version).toHaveBeenCalledTimes(2);
		expect(asyncFs.readdir).toHaveBeenCalledTimes(11);
		expect(asyncFs.readFile).toHaveBeenCalledTimes(11);
	});

	it("performs one scan and zero absent-marker stats/reads for an empty project", async () => {
		expect(await refresh()).toEqual([
			{ kind: "ok", runtime: undefined },
			{ kind: "ok", result: null },
		]);
		expect(asyncFs.readdir).toHaveBeenCalledTimes(1);
		expect(asyncFs.stat).not.toHaveBeenCalled();
		expect(asyncFs.readFile).not.toHaveBeenCalled();
	});

	it("keeps discovery lazy and private to each refresh, including rejected scans", async () => {
		new ProjectDiscovery(cwd);
		expect(asyncFs.readdir).not.toHaveBeenCalled();
		vi.mocked(asyncFs.readdir).mockRejectedValueOnce(new Error("denied"));
		expect(await refresh()).toEqual([{ kind: "error" }, { kind: "error" }]);
		expect(asyncFs.readdir).toHaveBeenCalledTimes(1);
		write("package.json", '{"version":"1"}');
		expect(await refresh()).toMatchObject([
			{ runtime: { name: "nodejs" } },
			{ result: { version: "1" } },
		]);
		expect(asyncFs.readdir).toHaveBeenCalledTimes(2);
	});

	it("still reads a known manifest when listing is denied, without sync fallback", async () => {
		write("package.json", '{"version":"1"}');
		vi.mocked(asyncFs.readdir).mockRejectedValueOnce(new Error("denied"));
		expect(await refresh()).toEqual([
			{ kind: "error" },
			{ kind: "ok", result: { ecosystem: "nodejs", version: "1" } },
		]);
		expect(asyncFs.readFile).toHaveBeenCalledTimes(1);
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});

	it("recovers negative lookups, deletion, malformed content and unreadable candidates", async () => {
		expect((await refresh())[1]).toEqual({ kind: "ok", result: null });
		write("package.json", '{"version":"1"}');
		write("Chart.yaml", "version: 2");
		expect((await refresh())[1]).toMatchObject({ result: { version: "1" } });
		vi.mocked(asyncFs.readFile).mockRejectedValueOnce(new Error("denied"));
		expect((await refresh())[1]).toMatchObject({ result: { ecosystem: "helm", version: "2" } });
		expect((await refresh())[1]).toMatchObject({ result: { version: "1" } });
		write("package.json", "malformed");
		expect((await refresh())[1]).toMatchObject({ result: { version: "2" } });
		fs.rmSync(join(cwd, "package.json"));
		fs.rmSync(join(cwd, "Chart.yaml"));
		expect(await refresh()).toEqual([
			{ kind: "ok", runtime: undefined },
			{ kind: "ok", result: null },
		]);
	});

	it("preserves file-source priority over extension sources and fresh workspace manifests", async () => {
		write("a.cabal", "version: 3");
		write("z.cabal", "version: 4");
		write("x.gemspec", "spec.version = '5'");
		write("Chart.yaml", "version: 2");
		write("Cargo.toml", '[package]\nversion.workspace = true\n[workspace]\nversion = "1"');
		for (const expected of ["1", "2", "3", "4", "5"]) {
			const sync = readPackageVersion(cwd);
			expect(await readPackageVersionResult(cwd)).toEqual({ kind: "ok", result: sync });
			expect(sync?.version).toBe(expected);
			fs.rmSync(
				join(
					cwd,
					{
						"1": "Cargo.toml",
						"2": "Chart.yaml",
						"3": "a.cabal",
						"4": "z.cabal",
						"5": "x.gemspec",
					}[expected] as string,
				),
			);
		}
	});

	it("uses fresh types and symlink targets without probing a marker twice", async () => {
		write("gradle");
		expect((await refresh())[0]).toEqual({ kind: "ok", runtime: undefined });
		fs.rmSync(join(cwd, "gradle"));
		fs.mkdirSync(join(cwd, "gradle"));
		expect((await refresh())[0]).toMatchObject({ runtime: { name: "gradle" } });
		fs.rmSync(join(cwd, "gradle"), { recursive: true });
		fs.symlinkSync("target", join(cwd, "package.json"));
		expect((await refresh())[0]).toEqual({ kind: "ok", runtime: undefined });
		write("target", '{"version":"6"}');
		vi.mocked(asyncFs.stat).mockClear();
		expect(await refresh()).toMatchObject([
			{ runtime: { name: "nodejs" } },
			{ result: { version: "6" } },
		]);
		expect(asyncFs.stat).toHaveBeenCalledTimes(1);
		fs.rmSync(join(cwd, "target"));
		expect((await refresh())[0]).toEqual({ kind: "ok", runtime: undefined });
	});

	it("invalidates unchanged entries on effective environment and PATH changes", async () => {
		expect((await refresh())[0]).toEqual({ kind: "ok", runtime: undefined });
		vi.stubEnv("CONDA_DEFAULT_ENV", "test");
		expect((await refresh())[0]).toMatchObject({ runtime: { name: "conda" } });
		vi.stubEnv("PIXI_ENVIRONMENT_NAME", "test");
		expect((await refresh())[0]).toMatchObject({ runtime: { name: "pixi" } });
		vi.stubEnv("PIXI_ENVIRONMENT_NAME", "");
		vi.stubEnv("CONDA_DEFAULT_ENV", "");
		expect((await refresh())[0]).toEqual({ kind: "ok", runtime: undefined });
		write("package.json", "{}");
		await refresh();
		probes.version.mockClear();
		await refresh();
		expect(probes.version).not.toHaveBeenCalled();
		vi.stubEnv("PATH", `${process.env.PATH}:/new/bin`);
		await refresh();
		expect(probes.version).toHaveBeenCalledTimes(1);
		write(".tool-versions", "nodejs 22");
		await refresh();
		expect(probes.version).toHaveBeenCalledTimes(2);
		write(".tool-versions", "nodejs 100");
		await refresh();
		expect(probes.version).toHaveBeenCalledTimes(3);
	});

	it("does not carry discovery or failures across cwd revisits", async () => {
		const a = cwd;
		const b = join(cwd, "nested");
		fs.mkdirSync(b);
		write("package.json", '{"version":"1"}');
		expect((await refresh())[1]).toMatchObject({ result: { version: "1" } });
		cwd = b;
		expect((await refresh())[1]).toEqual({ kind: "ok", result: null });
		write("package.json", '{"version":"2"}');
		expect((await refresh())[1]).toMatchObject({ result: { version: "2" } });
		cwd = a;
		write("package.json", '{"version":"3"}');
		expect((await refresh())[1]).toMatchObject({ result: { version: "3" } });
		expect(asyncFs.readdir).toHaveBeenCalledTimes(4);
	});

	it("retries failed marker metadata on the next refresh", async () => {
		write("package.json", '{"version":"1"}');
		vi.mocked(asyncFs.stat).mockRejectedValueOnce(new Error("temporary"));
		await refresh();
		await refresh();
		expect(asyncFs.stat).toHaveBeenCalledTimes(2);
		expect(probes.version).toHaveBeenCalledTimes(2);
		await refresh();
		expect(probes.version).toHaveBeenCalledTimes(2);
	});

	it.each([
		["package.json", '{"version":"1"}'],
		["deno.json", '{"version":"1"}'],
		["deno.jsonc", '// comment\n{"version":"1"}'],
		["pom.xml", "<project><version>1</version></project>"],
		["gradle.properties", "version=1"],
		["pyproject.toml", '[project]\nversion = "1"'],
		["setup.cfg", "[metadata]\nversion = 1"],
		["Cargo.toml", '[package]\nversion = "1"'],
		["composer.json", '{"version":"1"}'],
		["shard.yml", "version: 1"],
		["pubspec.yaml", "version: 1"],
		["pubspec.yml", "version: 1"],
		["mix.exs", 'version: "1"'],
		["elm.json", '{"version":"1"}'],
		["fpm.toml", '[project]\nversion = "1"'],
		["gleam.toml", 'version = "1"'],
		["x.cabal", "version: 1"],
		["Chart.yaml", "version: 1"],
		["Project.toml", 'version = "1"'],
		["meson.build", "project('x', version: '1')"],
		["x.nimble", 'version = "1"'],
		["x.gemspec", "spec.version = '1'"],
		["v.mod", "version: '1'"],
		["xmake.lua", 'set_version("1")'],
	])("matches the synchronous manifest reader for %s", async (file, raw) => {
		write(file, raw);
		const result = readPackageVersion(cwd);
		expect(result?.version).toBe("1");
		expect(await readPackageVersionResult(cwd)).toEqual({ kind: "ok", result });
	});

	it.each([
		["xmake.lua", "package.json"],
		["bun.lock", "package.json"],
		["bunfig.toml", "package.json"],
		["deno.json", "package.json"],
		["main.cpp", "main.c"],
		["gradle", "main.lua"],
	])("preserves sync detection priority for %s and %s", async (first, second) => {
		write(first);
		write(second);
		const runtime = detectRuntime(cwd, [first, second], {});
		expect(await readRuntimeInfo(cwd)).toMatchObject({
			kind: "ok",
			runtime: runtime ? { name: runtime.name } : undefined,
		});
	});
});
