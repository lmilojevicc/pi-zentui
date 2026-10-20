import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pi loads this package's TypeScript sources through jiti, which probes many candidate
// paths per relative specifier. Extensionless or `.js` specifiers force those probes
// (thousands of statSync calls on every session start), so every relative specifier in
// the shipped sources must point at the exact `.ts` file that exists on disk.
const SPECIFIER_PATTERN =
	/(?:\bfrom\s*|\bimport\s*|\bexport\s*\*\s*from\s*|\bimport\s*\(\s*)(["'])(\.[^"']*)\1/g;

function collectSourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const child = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...collectSourceFiles(child));
		else if (entry.name.endsWith(".ts")) files.push(child);
	}
	return files;
}

function relativeSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(SPECIFIER_PATTERN)) specifiers.push(match[2]);
	return specifiers;
}

const root = resolve(import.meta.dirname, "..");
const sourceFiles = [...collectSourceFiles(join(root, "extensions")), join(root, "omp.ts")];

describe("explicit ts import specifiers", () => {
	it("scans the shipped extension sources", () => {
		expect(sourceFiles.length).toBeGreaterThan(10);
	});

	it("uses explicit .ts specifiers for every relative import and export", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles) {
			const source = readFileSync(file, "utf8");
			for (const specifier of relativeSpecifiers(source)) {
				if (!specifier.endsWith(".ts")) {
					offenders.push(`${file}: ${specifier}`);
					continue;
				}
				const target = resolve(dirname(file), specifier);
				if (!existsSync(target)) offenders.push(`${file}: ${specifier} (missing target)`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("detects relative specifiers so the check cannot silently pass", () => {
		let relative = 0;
		for (const file of sourceFiles) {
			relative += relativeSpecifiers(readFileSync(file, "utf8")).length;
		}
		expect(relative).toBeGreaterThan(100);
	});

	it("keeps bare package specifiers intact", () => {
		const bare = /(?:\bfrom\s*|\bimport\s*|\bexport\s*\*\s*from\s*)(["'])([^."'][^"']*)\1/g;
		const found = new Set<string>();
		for (const file of sourceFiles) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(bare)) found.add(match[2]);
		}
		expect(found.has("@earendil-works/pi-coding-agent")).toBe(true);
		expect(found.has("@earendil-works/pi-tui")).toBe(true);
		for (const specifier of found) {
			expect(specifier.startsWith(".")).toBe(false);
			expect(specifier.endsWith(".ts")).toBe(false);
		}
	});
});
