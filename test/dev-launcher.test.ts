import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The dev launcher is the only cross-platform path from `npm run pi:dev` to a CLI.
 * `--print` makes its resolution observable without starting a TUI, so these tests
 * pin the contract scripts in package.json rely on.
 */
function launch(
	args: string[],
	env: Record<string, string> = {},
): {
	status: number | null;
	stdout: string;
	stderr: string;
} {
	const result = spawnSync(process.execPath, ["scripts/dev.mjs", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

describe("scripts/dev.mjs", () => {
	it("resolves pi from PATH with an isolated entry instead of a hard-coded prefix", () => {
		const run = launch(["--bin", "pi", "--entry", "./extensions/zentui/index.ts", "--print"]);
		expect(run.status).toBe(0);
		expect(run.stdout).toBe("pi --no-extensions -e ./extensions/zentui/index.ts");
		expect(run.stdout).not.toContain("homebrew");
	});

	it("keeps the documented PI_BIN and OMP_BIN overrides", () => {
		expect(
			launch(["--bin", "pi", "--entry", "./extensions/zentui/index.ts", "--print"], {
				PI_BIN: "/opt/homebrew/bin/pi",
			}).stdout,
		).toBe("/opt/homebrew/bin/pi --no-extensions -e ./extensions/zentui/index.ts");
		expect(launch(["--bin", "omp", "--print"], { OMP_BIN: "/usr/local/bin/omp" }).stdout).toBe(
			"/usr/local/bin/omp",
		);
	});

	it("loads installed extensions alongside the entry when asked", () => {
		const run = launch([
			"--bin",
			"pi",
			"--entry",
			"./extensions/zentui/index.ts",
			"--keep-extensions",
			"--print",
		]);
		expect(run.stdout).toBe("pi -e ./extensions/zentui/index.ts");
	});

	it("keeps install and plugin commands free of dev-session flags", () => {
		expect(launch(["--bin", "pi", "--print", "--", "install", "./", "-l"]).stdout).toBe(
			"pi install ./ -l",
		);
		expect(launch(["--bin", "omp", "--print", "--", "plugin", "link", "./"]).stdout).toBe(
			"omp plugin link ./",
		);
	});

	it("forwards arguments after `--` unchanged, including a model selection", () => {
		const run = launch([
			"--bin",
			"pi",
			"--entry",
			"./extensions/zentui/index.ts",
			"--keep-extensions",
			"--print",
			"--",
			"--session",
			"01a160ce",
			"--provider",
			"commandcode",
			"--model",
			"deepseek/deepseek-v4.1-flash",
		]);
		expect(run.stdout).toBe(
			"pi -e ./extensions/zentui/index.ts --session 01a160ce --provider commandcode --model deepseek/deepseek-v4.1-flash",
		);
	});

	it("rejects an unknown --bin with usage instead of guessing", () => {
		const run = launch(["--bin", "nope", "--print"]);
		expect(run.status).toBe(2);
		expect(run.stderr).toContain("unknown --bin nope");
	});
});
