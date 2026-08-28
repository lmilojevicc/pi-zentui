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
assert.ok(
	files.some(({ path }) => path === "extensions/zentui/thinking-steps.ts"),
	"npm pack must include extensions/zentui/thinking-steps.ts",
);

console.log(
	`Package file assertion passed: extensions/zentui/thinking-steps.ts (${files.length} files total)`,
);
