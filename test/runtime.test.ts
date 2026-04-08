import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectRuntime } from "../extensions/zentui/runtime";

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
	});

	it("detects lua from top-level lua directory", () => {
		const project = makeProject([{ path: "lua", dir: true }]);
		const runtime = detectRuntime(project.cwd, project.names);
		if (!runtime) throw new Error("expected runtime");
		expect(runtime.name).toBe("lua");
	});
});
