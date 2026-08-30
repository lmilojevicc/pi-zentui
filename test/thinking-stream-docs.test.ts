import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("Streaming (Experimental) bounded-scope documentation", () => {
	it("states the 256-component retention, native eviction, and bounded toggle contract", () => {
		const read = (path: string) => readFileSync(join(root, path), "utf8");
		const readme = read("README.md");
		const configuration = read("docs/configuration.md");
		const source = read("extensions/zentui/thinking-stream-experimental.ts");

		for (const documentation of [readme, configuration]) {
			expect(documentation).toMatch(/most recent 256 retained assistant components/);
			expect(documentation).toMatch(/restores? (?:its )?native rendering/);
			expect(documentation).toMatch(/no longer (?:changed|refold)/);
		}
		expect(source).toContain(
			"Bounds expand/refold ownership to the most recent retained session components.",
		);
		expect(source).not.toContain("allowing global expand/refold");
	});
});
