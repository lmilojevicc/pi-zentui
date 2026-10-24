/**
 * Pure command resolution for `scripts/dev.mjs`.
 *
 * Kept free of side effects (no spawn, no process/fs access) so the cross-platform
 * quoting and shim rules can be unit-tested without starting a CLI.
 */

/** Environment override per launcher name. */
export const BIN_FLAGS = { pi: "PI_BIN", omp: "OMP_BIN" };

/**
 * Resolve a CLI name or environment override into a file plus prefix arguments.
 *
 * A value that names an existing file is used verbatim (so a path with spaces works).
 * Otherwise it is split on whitespace, which lets `PI_BIN="node /x/cli.js"` run that
 * script. Quotes are not interpreted: a quoted path with a space must exist as written.
 */
export function resolveCommand(raw, exists) {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return { file: "", prefixArgs: [] };
	if (exists(value)) return { file: value, prefixArgs: [] };
	const [file, ...prefixArgs] = value.split(/\s+/);
	return { file, prefixArgs };
}

/** POSIX shell rendering for `--dry-run`; matches the historical launcher output. */
function quotePosix(value) {
	return /[\s"'\\$`]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

/**
 * `cmd.exe` argument quoting. Quoting is required for whitespace and every character
 * cmd treats as syntax; embedded quotes are doubled, which is how cmd parses `""`.
 */
export function quoteWin32Arg(value) {
	if (!/[\s"&|<>^()%!]/.test(value)) return value;
	return `"${value.replaceAll('"', '""')}"`;
}

/**
 * A bare name (no directory, no extension) is resolved by the command interpreter on
 * Windows: `spawnSync` without a shell only finds `.com`/`.exe` and does not walk
 * PATHEXT, so an npm-global `pi.cmd` would never be found.
 */
function isBareName(file) {
	return !/[\\/]/.test(file) && !/\.[^\\/.]+$/.test(file);
}

/**
 * Windows invocation. A real executable is spawned directly; `.cmd`/`.bat` shims and
 * bare names need the command interpreter. `cmd /s /c` strips the outer quote pair, so
 * the whole command is wrapped in one extra pair: `cmd /d /s /c ""<file>" <quoted args>"`.
 * `%VAR%` expands even inside quotes, so nothing else is escaped or rewritten.
 */
export function win32Invocation({ file, args, comspec }) {
	const command = [file, ...args].map(quoteWin32Arg).join(" ");
	if (!/\.(?:cmd|bat)$/i.test(file) && !isBareName(file)) {
		return { file, args: [...args], verbatim: false, line: command };
	}
	const shell = comspec || process.env.ComSpec || "cmd.exe";
	const shellArgs = ["/d", "/s", "/c", `"${command}"`];
	return {
		file: shell,
		args: shellArgs,
		// Without this, libuv re-quotes the `/c` payload with backslash escapes that cmd
		// does not understand, so the shim is never launched.
		verbatim: true,
		// The `/c` payload already is one quoted command line; quote only the prefix.
		line: `${[shell, ...shellArgs.slice(0, -1)].map(quoteWin32Arg).join(" ")} ${shellArgs[3]}`,
	};
}

/**
 * Resolve the launcher's arguments into the exact process to spawn and the line
 * `--dry-run` prints. Environment wins over PATH so existing PI_BIN/OMP_BIN workflows
 * keep working, including values that carry their own arguments.
 */
export function buildInvocation({
	bin = "pi",
	env = {},
	platform = process.platform,
	entry,
	keepExtensions = false,
	forwarded = [],
	exists = (value) => Boolean(value),
	comspec,
}) {
	const override = BIN_FLAGS[bin];
	const resolved = resolveCommand((override ? env[override] : undefined) || bin, exists);
	// `--no-extensions -e <entry>` is the isolated dev session; install/plugin commands
	// take their own arguments and must not inherit it. `--keep-extensions` keeps the
	// installed packages so extension-provided providers/models stay available.
	const args = [
		...resolved.prefixArgs,
		...(entry ? [...(keepExtensions ? [] : ["--no-extensions"]), "-e", entry] : []),
		...forwarded,
	];
	if (platform === "win32") return win32Invocation({ file: resolved.file, args, comspec });
	return {
		file: resolved.file,
		args,
		verbatim: false,
		line: [resolved.file, ...args].map(quotePosix).join(" "),
	};
}
