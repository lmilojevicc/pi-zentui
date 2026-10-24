#!/usr/bin/env node
/**
 * Universal dev launcher for local Pi/OMP runs.
 *
 * Resolves the CLI from PATH instead of a hard-coded Homebrew prefix, keeps the
 * historical `PI_BIN` / `OMP_BIN` overrides (including values that carry arguments),
 * and forwards extra arguments (so `npm run pi:dev -- --model provider/model`
 * keeps working on every platform). The launcher never consumes a Pi flag: only
 * `--bin`, `--entry`, `--keep-extensions`, `--dry-run`, `--help` and `--` are its own.
 *
 * Usage:
 *   node scripts/dev.mjs --bin pi --entry ./extensions/zentui/index.ts [-- <args>]
 *   node scripts/dev.mjs --bin omp -- plugin link ./
 *   node scripts/dev.mjs --bin pi --entry ./extensions/zentui/index.ts --dry-run
 *   npm run pi:dev -- --keep-extensions -- --session <id>
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { buildInvocation } from "./dev-command.mjs";

const BIN_FLAGS = { pi: "PI_BIN", omp: "OMP_BIN" };

function usage(message) {
	if (message) process.stderr.write(`dev: ${message}\n`);
	process.stderr.write(
		[
			"Usage: node scripts/dev.mjs --bin <pi|omp> [--entry <path>] [--dry-run] [-- <args...>]",
			"",
			"  --bin <name>     CLI to launch (default: pi). Env override: PI_BIN / OMP_BIN.",
			"  --entry <path>   Add -e <path> (an isolated dev session unless --keep-extensions).",
			"  --keep-extensions",
			"                   Load <entry> alongside the installed extensions. Needed when the",
			"                   session depends on an extension-provided model/provider (e.g.",
			"                   commandcode) or when resuming a session that used one.",
			"  --dry-run        Print the resolved command instead of running it.",
			"  --               Everything after this is forwarded unchanged.",
			"",
			"Examples:",
			"  npm run pi:dev -- --model commandcode/deepseek/deepseek-v4.1-flash",
			"  PI_BIN=/opt/homebrew/bin/pi npm run pi:dev",
			"",
		].join("\n"),
	);
	process.exit(message ? 2 : 0);
}

const argv = process.argv.slice(2);
let bin = "pi";
let entry;
let dryRun = false;
let keepExtensions = false;
const forwarded = [];

for (let index = 0; index < argv.length; index++) {
	const arg = argv[index];
	if (arg === "--") {
		forwarded.push(...argv.slice(index + 1));
		break;
	}
	if (arg === "--dry-run") {
		dryRun = true;
		continue;
	}
	if (arg === "--keep-extensions") {
		keepExtensions = true;
		continue;
	}
	if (arg === "--bin" || arg === "--entry") {
		const value = argv[index + 1];
		if (value === undefined) usage(`${arg} needs a value`);
		if (arg === "--bin") bin = value;
		else entry = value;
		index++;
		continue;
	}
	if (arg === "--help" || arg === "-h") usage();
	forwarded.push(arg);
}

if (bin !== "pi" && bin !== "omp" && !BIN_FLAGS[bin]) usage(`unknown --bin ${bin}`);

const invocation = buildInvocation({
	bin,
	env: process.env,
	platform: process.platform,
	entry,
	keepExtensions,
	forwarded,
	exists: existsSync,
});

if (dryRun) {
	process.stdout.write(`${invocation.line}\n`);
	process.exit(0);
}

// No shell: a real executable is spawned directly and a `.cmd`/`.bat` shim is wrapped
// in `cmd /d /s /c` with correctly quoted arguments (see scripts/dev-command.mjs).
const result = spawnSync(invocation.file, invocation.args, {
	stdio: "inherit",
	// `cmd /d /s /c "<quoted command>"` must reach cmd exactly as built.
	windowsVerbatimArguments: invocation.verbatim === true,
});

if (result.error) {
	const override = BIN_FLAGS[bin];
	const hint = override ? `${override}=/absolute/path/to/${bin}` : `${bin} must be on PATH`;
	process.stderr.write(
		`dev: could not launch "${invocation.file}" (${result.error.message}). ${hint}\n`,
	);
	process.exit(127);
}

// A shim that cmd found but could not run reports its own status; pass it through.
process.exit(result.status ?? (result.signal ? 1 : 0));
