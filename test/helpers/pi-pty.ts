import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type IPty, spawn } from "node-pty";

export type CapturedPty = {
	pty: IPty;
	output: () => string;
	waitFor: (needle: string, timeoutMs?: number, from?: number) => Promise<number>;
	waitForExit: (timeoutMs?: number) => Promise<void>;
	hasExited: () => boolean;
	close: (timeoutMs?: number) => Promise<void>;
};

export function spawnCapturedPty(
	file: string,
	args: string[],
	options: { cwd: string; env: Record<string, string> },
): CapturedPty {
	if (process.platform !== "win32") {
		try {
			const entry = createRequire(import.meta.url).resolve("node-pty");
			const root = dirname(dirname(entry));
			chmodSync(
				join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
				0o755,
			);
		} catch {
			// Source builds do not use the prebuilt spawn helper.
		}
	}
	let data = "";
	const terminal = spawn(file, args, {
		name: "xterm-256color",
		cols: 100,
		rows: 30,
		cwd: options.cwd,
		env: options.env,
	});
	terminal.onData((chunk) => {
		data += chunk;
	});
	let exited = false;
	let exitDescription = "";
	terminal.onExit(({ exitCode, signal }) => {
		exited = true;
		exitDescription = `exitCode=${exitCode}, signal=${signal}`;
	});
	const diagnostics = () =>
		`pid=${terminal.pid}${exitDescription ? `, ${exitDescription}` : ""}\n${data.slice(-4000)}`;
	const waitFor = async (needle: string, timeoutMs = 12_000, from = 0): Promise<number> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const index = data.indexOf(needle, from);
			if (index >= 0) return index;
			if (exited)
				throw new Error(
					`PTY exited before ${JSON.stringify(needle)} was observed\n${diagnostics()}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`PTY timeout waiting for ${JSON.stringify(needle)}\n${diagnostics()}`);
	};
	const waitForExit = async (timeoutMs = 12_000): Promise<void> => {
		const deadline = Date.now() + timeoutMs;
		while (!exited && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 20));
		if (!exited) throw new Error(`PTY timeout waiting for exit\n${diagnostics()}`);
	};
	let closePromise: Promise<void> | undefined;
	const close = (timeoutMs = 5_000): Promise<void> => {
		closePromise ??= (async () => {
			if (!exited) {
				try {
					terminal.kill();
				} catch (error) {
					if (!exited)
						throw new Error(`PTY termination failed: ${String(error)}\n${diagnostics()}`);
				}
			}
			await waitForExit(timeoutMs);
		})();
		return closePromise;
	};
	return {
		pty: terminal,
		output: () => data,
		waitFor,
		waitForExit,
		hasExited: () => exited,
		close,
	};
}
