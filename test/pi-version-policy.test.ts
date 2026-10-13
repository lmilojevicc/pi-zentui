import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const compatibilityScripts = [
	"test/behavior-compatibility.mjs",
	"test/thinking-experimental-tui.mjs",
];

const ompPackages = ["pi-ai", "pi-coding-agent", "pi-tui"].map((name) => `@oh-my-pi/${name}`);

function expectCoherentOmpPins(pins: string[], minimum: string) {
	expect(pins).toHaveLength(3);
	for (const pin of pins) {
		expect(pin).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
		expect(pin).toBe(pins[0]);
		const parts = pin.split(".").map(Number);
		const floor = minimum.split(".").map(Number);
		const difference = parts.map((part, index) => part - floor[index]).find((part) => part !== 0);
		expect(difference ?? 0).toBeGreaterThanOrEqual(0);
	}
}

describe("Pi minimum version policy", () => {
	it("declares 1.0.0 for all public peers and keeps optional lock metadata synchronized", () => {
		const manifest = JSON.parse(read("package.json"));
		const lock = JSON.parse(read("package-lock.json"));
		for (const name of ["pi-ai", "pi-coding-agent", "pi-tui"]) {
			expect(manifest.peerDependencies[`@earendil-works/${name}`]).toBe(">=1.0.0");
			for (const scope of ["@earendil-works", "@oh-my-pi"]) {
				expect(manifest.peerDependenciesMeta[`${scope}/${name}`]).toEqual({ optional: true });
			}
			expect(manifest.peerDependencies[`@oh-my-pi/${name}`]).toBe(">=18.4.10");
			expect(lock.packages[`node_modules/@oh-my-pi/${name}`].version).toBe(
				manifest.devDependencies[`@oh-my-pi/${name}`],
			);
		}
		expectCoherentOmpPins(
			ompPackages.map((name) => manifest.devDependencies[name]),
			manifest.peerDependencies[ompPackages[0]].slice(2),
		);
		expect(lock.packages[""].peerDependencies).toEqual(manifest.peerDependencies);
		expect(lock.packages[""].peerDependenciesMeta).toEqual(manifest.peerDependenciesMeta);
		expect(lock.packages[""].devDependencies).toEqual(manifest.devDependencies);
		expect(lock.packages[""].version).toBe(manifest.version);
		expect(lock.version).toBe(manifest.version);
	});

	it.each(["18.4.10", "18.8.9", "18.10.0", "19.0.0"])(
		"accepts coherent exact OMP pins at or above the minimum: %s",
		(version) => {
			expectCoherentOmpPins([version, version, version], "18.4.10");
		},
	);

	it.each([
		["18.8.9", "18.8.8", "18.8.9"],
		["^18.8.9", "^18.8.9", "^18.8.9"],
		["18.8.9-beta.1", "18.8.9-beta.1", "18.8.9-beta.1"],
		["18.4.9", "18.4.9", "18.4.9"],
		["18.3.99", "18.3.99", "18.3.99"],
		["17.99.99", "17.99.99", "17.99.99"],
	])("rejects incoherent, unpinned, or below-minimum OMP pins: %j", (...pins) => {
		expect(() => expectCoherentOmpPins(pins, "18.4.10")).toThrow();
	});

	it("retains all compatibility jobs at exact 1.0.0 and 1.0.3", () => {
		const ci = read(".github/workflows/ci.yml");
		for (const job of [
			"thinking-experimental-tui",
			"behavior-component-compatibility",
			"supported-pi-compatibility",
		]) {
			expect(ci).toContain(`  ${job}:`);
		}
		expect(ci).toContain('pi-version: ["1.0.0", "1.0.3"]');
		expect(ci).toContain("run: npm run typecheck");
		expect(ci).toContain("15m npm test");
		for (const path of compatibilityScripts) {
			expect(read(path)).toContain('?? ["1.0.0", "1.0.3"]');
		}
	});

	it("removes retired default-lane setup without weakening public-family pins", () => {
		for (const path of [".github/workflows/ci.yml", ...compatibilityScripts]) {
			const source = read(path);
			expect(source).not.toMatch(/0\.\d+\.\d+/);
			expect(source).not.toContain("pi-server");
			expect(source).not.toContain('startsWith("1.")');
			for (const name of ["pi-agent-core", "chord", "pi-codemode", "pi-mcp", "pi-telemetry"]) {
				expect(source).toContain(name);
			}
		}
	});

	it("documents only the supported minimum and tested host matrix", () => {
		const readme = read("README.md");
		const configuration = read("docs/configuration.md");
		expect(readme).toContain("coding agent 1.0.0 or newer");
		expect(readme).toContain("exact Pi versions 1.0.0 and 1.0.3");
		expect(configuration).toContain("requires Pi 1.0.0 or newer");
		expect(configuration).toContain("minimum is 1.0.0");
		expect(configuration).toContain("matrix covers Pi 1.0.0 and 1.0.3");
		for (const source of [readme, configuration]) {
			expect(source).not.toMatch(/(?:minimum is|requires Pi|coding agent) 0\.\d+\.\d+/);
			expect(source).not.toMatch(/(?:exact Pi versions|supported Pi|matrix covers Pi) 0\./);
		}
		expect(read("docs/tool-display.md")).not.toContain("older supported Pi hosts");
	});
});
