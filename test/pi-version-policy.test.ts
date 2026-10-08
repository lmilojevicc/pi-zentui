import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Pi minimum version policy", () => {
	it("declares 0.85.0 for all public peers and keeps the lockfile synchronized", () => {
		const manifest = JSON.parse(read("package.json"));
		const lock = JSON.parse(read("package-lock.json"));
		for (const name of ["pi-ai", "pi-coding-agent", "pi-tui"]) {
			expect(manifest.peerDependencies[`@earendil-works/${name}`]).toBe(">=0.85.0");
		}
		expect(lock.packages[""].peerDependencies).toEqual(manifest.peerDependencies);
		expect(lock.version).toBe(manifest.version);
	});

	it("retains all compatibility jobs at the minimum and current tested versions", () => {
		const ci = read(".github/workflows/ci.yml");
		for (const job of [
			"thinking-experimental-tui",
			"behavior-component-compatibility",
			"supported-pi-compatibility",
		]) {
			expect(ci).toContain(`  ${job}:`);
		}
		expect(ci).toContain('pi-version: ["0.85.0", "0.87.1", "1.0.3"]');
		expect(ci).toContain("run: npm run typecheck");
		for (const path of ["test/behavior-compatibility.mjs", "test/thinking-experimental-tui.mjs"]) {
			const script = read(path);
			expect(script).toContain('?? ["0.85.0", "0.87.1", "1.0.3"]');
			expect(script).not.toMatch(/0\.8[0-4]\.\d+/);
		}
		expect(ci).not.toMatch(/0\.8[0-4]\.\d+/);
	});
});
