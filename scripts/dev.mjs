#!/usr/bin/env node
/**
 * Universal dev launcher for local Pi/OMP runs.
 *
 * Resolves the CLI from PATH instead of a hard-coded Homebrew prefix, keeps the
 * historical `PI_BIN` / `OMP_BIN` overrides, and forwards extra arguments (so
 * `npm run pi:dev -- --model provider/model` keeps working on every platform).
 *
 * Usage:
 *   node scripts/dev.mjs --bin pi --entry ./extensions/zentui/index.ts [-- <args>]
 *   node scripts/dev.mjs --bin omp -- plugin link ./
 *   node scripts/dev.mjs --bin pi --entry ./extensions/zentui/index.ts --print
 *   npm run pi:dev -- --keep-extensions -- --session <id>
 */
import { spawnSync } from "node:child_process";

const BIN_FLAGS = { pi: "PI_BIN", omp: "OMP_BIN" };

function usage(message) {
	if (message) process.stderr.write(`dev: ${message}\n`);
	process.stderr.write(
		[
			"Usage: node scripts/dev.mjs --bin <pi|omp> [--entry <path>] [--print] [-- <args...>]",
			"",
			"  --bin <name>     CLI to launch (default: pi). Env override: PI_BIN / OMP_BIN.",
			"  --entry <path>   Add -e <path> (an isolated dev session unless --keep-extensions).",
			"  --keep-extensions",
			"                   Load <entry> alongside the installed extensions. Needed when the",
			"                   session depends on an extension-provided model/provider (e.g.",
			"                   commandcode) or when resuming a session that used one.",
			"  --print          Print the resolved command instead of running it.",
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
let print = false;
let keepExtensions = false;
const forwarded = [];

for (let index = 0; index < argv.length; index++) {
	const arg = argv[index];
	if (arg === "--") {
		forwarded.push(...argv.slice(index + 1));
		break;
	}
	if (arg === "--print") {
		print = true;
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

// Environment wins over PATH so existing PI_BIN/OMP_BIN workflows keep working.
const override = BIN_FLAGS[bin];
const executable = (override ? process.env[override] : undefined) || bin;
// `--no-extensions -e <entry>` is the isolated dev session; install/plugin commands
// take their own arguments and must not inherit it. `--keep-extensions` keeps the
// installed packages so extension-provided providers/models stay available.
const args = [
	...(entry ? [...(keepExtensions ? [] : ["--no-extensions"]), "-e", entry] : []),
	...forwarded,
];

if (print) {
	process.stdout.write(`${[executable, ...args].map(quote).join(" ")}\n`);
	process.exit(0);
}

const result = spawnSync(executable, args, {
	stdio: "inherit",
	// Windows resolves `pi`/`omp` through .cmd shims only with a shell.
	shell: process.platform === "win32",
});

if (result.error) {
	const hint = override ? `${override}=/absolute/path/to/${bin}` : `${bin} must be on PATH`;
	process.stderr.write(
		`dev: could not launch "${executable}" (${result.error.message}). ${hint}\n`,
	);
	process.exit(127);
}

process.exit(result.status ?? (result.signal ? 1 : 0));

function quote(value) {
	return /[\s"'\\$`]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}
