import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const npmCli = process.env.npm_execpath;
const reportJson = execFileSync(
	npmCli ? process.execPath : "npm",
	[...(npmCli ? [npmCli] : []), "pack", "--dry-run", "--json"],
	{ encoding: "utf8" },
);
const report = JSON.parse(reportJson);
const packages = Array.isArray(report) ? report : Object.values(report);
assert.equal(packages.length, 1, "npm pack must report exactly one package");

const files = packages[0]?.files;
assert.ok(Array.isArray(files), "npm pack must report its package file list");
for (const required of [
	"extensions/zentui/thinking-steps.ts",
	"extensions/zentui/thinking-experimental.ts",
	"extensions/zentui/thinking-status.ts",
]) {
	assert.ok(
		files.some(({ path }) => path === required),
		`npm pack must include ${required}`,
	);
}

const renderer = readFileSync("extensions/zentui/thinking-experimental.ts", "utf8");
assert.match(renderer, /Copyright \(c\) 2026 Zach Yuen/);
assert.match(renderer, /Copyright \(c\) 2026 Marc Mironescu \/ FluxGear/);
assert.equal((renderer.match(/Permission is hereby granted, free of charge/g) ?? []).length, 2);

console.log(`Package and license assertions passed (${files.length} files total)`);
