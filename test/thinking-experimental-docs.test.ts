import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("Thinking (Experimental) documentation", () => {
	it("documents private restart gating, native Markdown rows, all modes, and bounded ownership", () => {
		for (const path of ["README.md", "docs/configuration.md"]) {
			const documentation = readFileSync(join(root, path), "utf8");
			expect(documentation).toContain("Thinking (Experimental)");
			expect(documentation).toMatch(/0\.80\.5.*0\.83\.0.*0\.84\.0.*0\.84\.4/s);
			expect(documentation).toMatch(/restart/i);
			expect(documentation).toMatch(/native.*Markdown|Pi `Markdown`/i);
			expect(documentation).toMatch(/256/);
			expect(documentation).toMatch(/Working line/);
		}
	});

	it("uses the public Thinking copy and states the restart exception exactly", () => {
		const readme = readFileSync(join(root, "README.md"), "utf8");
		expect(readme).toContain(
			"Most changes apply live; Thinking (Experimental) changes are saved and require restarting Pi.",
		);
		expect(readFileSync(join(root, "docs/configuration.md"), "utf8")).toContain(
			"Rail parses each native contiguous thinking run",
		);
		for (const path of [
			"README.md",
			"docs/configuration.md",
			"extensions/zentui/settings-command.ts",
		]) {
			const source = readFileSync(join(root, path), "utf8");
			expect(source, path).not.toMatch(/Thinking steps(?: mode)?/);
		}
	});

	it("keeps both adapted MIT notices adjacent in packaged renderer source", () => {
		const source = readFileSync(join(root, "extensions/zentui/thinking-experimental.ts"), "utf8");
		expect(source).toContain("Copyright (c) 2026 Zach Yuen");
		expect(source).toContain("Copyright (c) 2026 Marc Mironescu / FluxGear");
		expect(source.match(/Permission is hereby granted, free of charge/g)).toHaveLength(2);
		expect(source).not.toMatch(/setWorkingMessage|setWorkingVisible/);
	});
});
