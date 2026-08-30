import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

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
	"extensions/zentui/thinking-stream-experimental.ts",
]) {
	assert.ok(
		files.some(({ path }) => path === required),
		`npm pack must include ${required}`,
	);
}

console.log(`Package file assertions passed (${files.length} files total)`);
