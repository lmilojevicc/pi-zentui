import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type IPty, spawn } from "node-pty";

type ProcessGroupSignal = (pid: number, signal: NodeJS.Signals | 0) => void;

export function probeOwnedProcessGroup(
	pid: number,
	signalProcess: ProcessGroupSignal = process.kill,
): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 1)
		throw new Error(`Refusing to inspect unsafe PTY process group ${pid}`);
	try {
		signalProcess(-pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		if (code === "EPERM")
			throw new Error(`Permission denied inspecting owned PTY process group ${pid}`, {
				cause: error,
			});
		throw error;
	}
}

export function signalOwnedProcessGroup(
	pid: number,
	signal: NodeJS.Signals,
	signalProcess: ProcessGroupSignal = process.kill,
): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 1)
		throw new Error(`Refusing to signal unsafe PTY process group ${pid}`);
	try {
		signalProcess(-pid, signal);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		if (code === "EPERM")
			throw new Error(`Permission denied signaling owned PTY process group ${pid}`, {
				cause: error,
			});
		throw error;
	}
}

export function terminateWindowsPty(kill: () => void): void {
	kill();
}

export type CapturedPty = {
	pty: IPty;
	output: () => string;
	waitFor: (needle: string, timeoutMs?: number, from?: number) => Promise<number>;
	waitForExit: (timeoutMs?: number) => Promise<void>;
	hasExited: () => boolean;
	cleanupActions: () => readonly string[];
	close: () => Promise<void>;
};

export function spawnCapturedPty(
	file: string,
	args: string[],
	options: {
		cwd: string;
		env: Record<string, string>;
		keyboardMode?: "kitty" | "modifyOtherKeys";
		gracefulExitInput?: string;
	},
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
	let emulatorPending = "";
	terminal.onData((chunk) => {
		data += chunk;
		if (!options.keyboardMode) return;
		emulatorPending += chunk;
		while (true) {
			const kittyQuery = emulatorPending.indexOf("\x1b[?u");
			const attributesQuery = emulatorPending.indexOf("\x1b[c");
			const indexes = [kittyQuery, attributesQuery].filter((index) => index >= 0);
			if (indexes.length === 0) break;
			const index = Math.min(...indexes);
			if (index === kittyQuery) {
				emulatorPending = emulatorPending.slice(index + "\x1b[?u".length);
				if (options.keyboardMode === "kitty") terminal.write("\x1b[?7u");
			} else {
				emulatorPending = emulatorPending.slice(index + "\x1b[c".length);
				terminal.write("\x1b[?1;2c");
			}
		}
		const lastEscape = emulatorPending.lastIndexOf("\x1b");
		emulatorPending = lastEscape >= 0 ? emulatorPending.slice(lastEscape) : "";
	});
	let exited = false;
	let exitDescription = "";
	let resolveExactExit!: () => void;
	const exactExit = new Promise<void>((resolve) => {
		resolveExactExit = resolve;
	});
	terminal.onExit(({ exitCode, signal }) => {
		exited = true;
		exitDescription = `exitCode=${exitCode}, signal=${signal}`;
		resolveExactExit();
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
	const delay = (timeoutMs: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
	const waitForExit = async (timeoutMs = 12_000): Promise<void> => {
		if (exited) return;
		const completed = await Promise.race([
			exactExit.then(() => true),
			delay(timeoutMs).then(() => false),
		]);
		if (!completed) throw new Error(`PTY timeout waiting for exit\n${diagnostics()}`);
	};
	const cleanupActions: string[] = [];
	const pid = terminal.pid;
	const ownedGroupExists = (): boolean => {
		if (process.platform === "win32") return false;
		try {
			return probeOwnedProcessGroup(pid);
		} catch (error) {
			throw new Error(`PTY process-group inspection failed: ${String(error)}\n${diagnostics()}`, {
				cause: error,
			});
		}
	};
	const signalOwnedGroup = (signal: NodeJS.Signals): boolean => {
		try {
			const signaled = signalOwnedProcessGroup(pid, signal);
			if (signaled) cleanupActions.push(`group-${signal}`);
			return signaled;
		} catch (error) {
			throw new Error(`PTY process-group ${signal} failed: ${String(error)}\n${diagnostics()}`, {
				cause: error,
			});
		}
	};
	const waitForOwnedTreeExit = async (timeoutMs: number): Promise<boolean> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (exited && !ownedGroupExists()) return true;
			if (exited) await delay(20);
			else await Promise.race([exactExit, delay(20)]);
		}
		return exited && !ownedGroupExists();
	};
	// forkpty makes pid the owned session/process-group leader. Deliberately detached
	// descendants are outside this group; Pi's TERM handler gets time to clean those.
	const closeUnix = async (): Promise<void> => {
		if (!Number.isSafeInteger(pid) || pid <= 1)
			throw new Error(`Refusing to clean unsafe PTY process group ${pid}\n${diagnostics()}`);
		if (exited && !ownedGroupExists()) return;
		if (options.gracefulExitInput && !exited) {
			terminal.write(options.gracefulExitInput);
			cleanupActions.push("write-graceful-exit");
		}
		if (ownedGroupExists()) signalOwnedGroup("SIGCONT");
		if (await waitForOwnedTreeExit(300)) return;
		if (ownedGroupExists()) signalOwnedGroup("SIGTERM");
		if (await waitForOwnedTreeExit(700)) return;
		if (ownedGroupExists()) {
			signalOwnedGroup("SIGCONT");
			signalOwnedGroup("SIGKILL");
		}
		await waitForExit(2_000);
		if (!(await waitForOwnedTreeExit(2_000)))
			throw new Error(`PTY process group survived cleanup\n${diagnostics()}`);
	};
	const closeWindows = async (): Promise<void> => {
		if (exited) return;
		if (options.gracefulExitInput) {
			terminal.write(options.gracefulExitInput);
			cleanupActions.push("write-graceful-exit");
			if (await Promise.race([exactExit.then(() => true), delay(300).then(() => false)])) return;
		}
		terminateWindowsPty(() => terminal.kill());
		cleanupActions.push("pid-kill");
		await waitForExit(2_000);
	};
	let closePromise: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closePromise) return closePromise;
		const attempt = process.platform === "win32" ? closeWindows() : closeUnix();
		closePromise = attempt;
		void attempt.catch(() => {
			if (closePromise === attempt) closePromise = undefined;
		});
		return attempt;
	};
	return {
		pty: terminal,
		output: () => data,
		waitFor,
		waitForExit,
		hasExited: () => exited,
		cleanupActions: () => [...cleanupActions],
		close,
	};
}
