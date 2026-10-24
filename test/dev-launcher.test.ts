import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dev launcher is the only cross-platform path from `npm run pi:dev` to a CLI.
 * `--dry-run` makes its resolution observable without starting a TUI, so these tests
 * pin the contract scripts in package.json rely on. Pi's own flags are never consumed.
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

// The helper is ESM-only and untyped; a computed specifier keeps it out of the type graph.
const devCommandUrl = new URL("../scripts/dev-command.mjs", import.meta.url).href;
const devCommand = (await import(devCommandUrl)) as {
	quoteWin32Arg(value: string): string;
	win32Invocation(input: { file: string; args: string[]; comspec?: string }): {
		file: string;
		args: string[];
		line: string;
	};
	buildInvocation(input: {
		bin?: string;
		env?: Record<string, string | undefined>;
		platform?: string;
		entry?: string;
		keepExtensions?: boolean;
		forwarded?: string[];
		exists?: (value: string) => boolean;
		comspec?: string;
	}): { file: string; args: string[]; line: string };
};

describe("scripts/dev.mjs", () => {
	it("resolves pi from PATH with an isolated entry instead of a hard-coded prefix", () => {
		const run = launch(["--bin", "pi", "--entry", "./extensions/zentui/index.ts", "--dry-run"]);
		expect(run.status).toBe(0);
		expect(run.stdout).toBe("pi --no-extensions -e ./extensions/zentui/index.ts");
		expect(run.stdout).not.toContain("homebrew");
	});

	it("keeps the documented PI_BIN and OMP_BIN overrides", () => {
		expect(
			launch(["--bin", "pi", "--entry", "./extensions/zentui/index.ts", "--dry-run"], {
				PI_BIN: "/opt/homebrew/bin/pi",
			}).stdout,
		).toBe("/opt/homebrew/bin/pi --no-extensions -e ./extensions/zentui/index.ts");
		expect(launch(["--bin", "omp", "--dry-run"], { OMP_BIN: "/usr/local/bin/omp" }).stdout).toBe(
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
			"--dry-run",
		]);
		expect(run.stdout).toBe("pi -e ./extensions/zentui/index.ts");
	});

	it("keeps install and plugin commands free of dev-session flags", () => {
		expect(launch(["--bin", "pi", "--dry-run", "--", "install", "./", "-l"]).stdout).toBe(
			"pi install ./ -l",
		);
		expect(launch(["--bin", "omp", "--dry-run", "--", "plugin", "link", "./"]).stdout).toBe(
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
			"--dry-run",
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

	it("passes Pi flags through instead of consuming them", () => {
		const run = launch([
			"--bin",
			"pi",
			"--entry",
			"./extensions/zentui/index.ts",
			"--dry-run",
			"--print",
			"summarize",
		]);
		expect(run.status).toBe(0);
		expect(run.stdout).toBe("pi --no-extensions -e ./extensions/zentui/index.ts --print summarize");
	});

	it("accepts a PI_BIN value that carries its own arguments", () => {
		const run = launch(["--bin", "pi", "--entry", "./extensions/zentui/index.ts", "--dry-run"], {
			PI_BIN: "node /x/cli.js",
		});
		expect(run.status).toBe(0);
		expect(run.stdout).toBe("node /x/cli.js --no-extensions -e ./extensions/zentui/index.ts");
	});

	it("resolves an executable whose directory has a space as one token", () => {
		const directory = mkdtempSync(join(tmpdir(), "zentui dev "));
		const executable = join(directory, "pi");
		try {
			writeFileSync(executable, "#!/bin/sh\nexit 0\n");
			chmodSync(executable, 0o755);
			const run = launch(["--bin", "pi", "--entry", "./extensions/zentui/index.ts", "--dry-run"], {
				PI_BIN: executable,
			});
			expect(run.status).toBe(0);
			// One token: the display quotes it, it was not split at the space.
			expect(run.stdout).toBe(`"${executable}" --no-extensions -e ./extensions/zentui/index.ts`);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rejects an unknown --bin with usage instead of guessing", () => {
		const run = launch(["--bin", "nope", "--dry-run"]);
		expect(run.status).toBe(2);
		expect(run.stderr).toContain("unknown --bin nope");
	});
});

describe("scripts/dev-command.mjs", () => {
	it("quotes only what cmd.exe treats as syntax", () => {
		expect(devCommand.quoteWin32Arg("provider/model name")).toBe('"provider/model name"');
		expect(devCommand.quoteWin32Arg("a&b")).toBe('"a&b"');
		expect(devCommand.quoteWin32Arg("plain")).toBe("plain");
		expect(devCommand.quoteWin32Arg('say "hi"')).toBe('"say ""hi"""');
	});

	it("spawns a real executable directly on win32", () => {
		const invocation = devCommand.win32Invocation({
			file: "C:\\Program Files\\nodejs\\node.exe",
			args: ["/x/cli.js", "--no-extensions"],
			comspec: "C:\\Windows\\system32\\cmd.exe",
		});
		expect(invocation.file).toBe("C:\\Program Files\\nodejs\\node.exe");
		expect(invocation.args).toEqual(["/x/cli.js", "--no-extensions"]);
		expect(invocation.line).toBe('"C:\\Program Files\\nodejs\\node.exe" /x/cli.js --no-extensions');
	});

	it("wraps only a .cmd/.bat shim in cmd /d /s /c", () => {
		const invocation = devCommand.win32Invocation({
			file: "C:\\Program Files\\pi\\pi.cmd",
			args: ["--no-extensions", "-e", "./extensions/zentui/index.ts"],
			comspec: "C:\\Windows\\system32\\cmd.exe",
		});
		expect(invocation.file).toBe("C:\\Windows\\system32\\cmd.exe");
		expect(invocation.args).toEqual([
			"/d",
			"/s",
			"/c",
			// `cmd /s /c` strips the outer pair; the shim keeps its own quotes.
			'""C:\\Program Files\\pi\\pi.cmd" --no-extensions -e ./extensions/zentui/index.ts"',
		]);
		expect(invocation.line).toBe(
			'C:\\Windows\\system32\\cmd.exe /d /s /c ""C:\\Program Files\\pi\\pi.cmd" --no-extensions -e ./extensions/zentui/index.ts"',
		);
	});

	it("routes a bare name through cmd so npm .cmd shims resolve via PATHEXT", () => {
		const invocation = devCommand.buildInvocation({
			bin: "pi",
			env: {},
			platform: "win32",
			entry: "./extensions/zentui/index.ts",
			exists: () => false,
			comspec: "C:\\Windows\\system32\\cmd.exe",
		});
		// spawnSync without a shell never walks PATHEXT, so a bare `pi` (pi.cmd from npm)
		// must go through the interpreter instead of failing with ENOENT.
		expect(invocation.file).toBe("C:\\Windows\\system32\\cmd.exe");
		expect(invocation.args[3]).toBe('"pi --no-extensions -e ./extensions/zentui/index.ts"');
	});

	it("resolves the entry and forwarded arguments per platform", () => {
		const posix = devCommand.buildInvocation({
			bin: "pi",
			env: {},
			platform: "linux",
			entry: "./extensions/zentui/index.ts",
			forwarded: ["--model", "provider/model"],
			exists: () => false,
		});
		expect(posix.line).toBe(
			"pi --no-extensions -e ./extensions/zentui/index.ts --model provider/model",
		);
		const win32 = devCommand.buildInvocation({
			bin: "pi",
			env: { PI_BIN: "C:\\Program Files\\pi\\pi.cmd" },
			platform: "win32",
			entry: "./extensions/zentui/index.ts",
			forwarded: ["--print", "summarize"],
			exists: (value) => value === "C:\\Program Files\\pi\\pi.cmd",
			comspec: "C:\\Windows\\system32\\cmd.exe",
		});
		expect(win32.file).toBe("C:\\Windows\\system32\\cmd.exe");
		expect(win32.args[3]).toBe(
			'""C:\\Program Files\\pi\\pi.cmd" --no-extensions -e ./extensions/zentui/index.ts --print summarize"',
		);
	});
});
