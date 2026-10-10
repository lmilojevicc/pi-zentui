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
	"docs/configuration.md",
	"docs/footer-format.md",
	"docs/tool-display.md",
	"docs/tool-display-attribution.md",
	"extensions/zentui/tool-display/controller.ts",
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

const attribution = readFileSync("docs/tool-display-attribution.md", "utf8");
const toolTypes = readFileSync("extensions/zentui/tool-display/types.ts", "utf8");
for (const notice of [attribution, toolTypes]) {
	assert.match(notice, /Copyright \(c\) 2026 MasuRii/);
	assert.match(notice, /Permission is hereby granted, free of charge/);
}
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const deps of [manifest.dependencies, manifest.peerDependencies, manifest.devDependencies]) {
	assert.ok(
		!deps?.["pi-tool-display"],
		"native rendering must not depend on upstream installation",
	);
}
