import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("Thinking (Experimental) documentation", () => {
	it("documents live transitions, restart gating, native Markdown rows, all modes, and bounded ownership", () => {
		for (const path of ["README.md", "docs/configuration.md"]) {
			const documentation = readFileSync(join(root, path), "utf8");
			expect(documentation).toContain("Thinking (Experimental)");
			expect(documentation).toMatch(/0\.80\.5.*0\.82\.1.*0\.83\.0.*0\.84\.0.*0\.84\.4/s);
			expect(documentation).toMatch(/switch.*live|live switching/i);
			expect(documentation).toMatch(/restart/i);
			expect(documentation).toMatch(/native.*Markdown|Pi `Markdown`/i);
			expect(documentation).toMatch(/strict(?: 7-bit CSI)? SGR styling is stripped/i);
			expect(documentation).toMatch(/every other terminal control/i);
			expect(documentation).toMatch(/256/);
			expect(documentation).toMatch(/Working line/);
		}
	});

	it("uses the public Thinking copy and states the live boundary exactly", () => {
		const readme = readFileSync(join(root, "README.md"), "utf8");
		expect(readme).toContain(
			"Active Streaming can switch live to Rail or Tree, and Rail and Tree can switch live between each other. Entering Streaming from a structural mode, first enable, and re-enable after a live disable require restarting Pi.",
		);
		expect(readme).not.toMatch(
			/switches Rail, Tree, and Streaming live|Entering Streaming transactionally|Streaming → Tree → Rail → Streaming/,
		);
		const configuration = readFileSync(join(root, "docs/configuration.md"), "utf8");
		expect(configuration).toContain("Rail parses each native contiguous thinking run");
		expect(configuration).not.toMatch(/Streaming → Tree → Rail → Streaming/);
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
