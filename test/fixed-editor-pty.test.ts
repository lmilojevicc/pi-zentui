import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CapturedPty,
	probeOwnedProcessGroup,
	signalOwnedProcessGroup,
	spawnCapturedPty,
	terminateWindowsPty,
} from "./helpers/pi-pty";
import { OwnedTerminalStateParser } from "./helpers/terminal-state";

const run = process.env.RUN_FIXED_EDITOR_PTY === "1" ? it : it.skip;
const root = resolve(import.meta.dirname, "..");
const reset =
	"\x1b[?2026h\x1b[r\x1b[?1002l\x1b[?1006l\x1b[?1000l\x1b[?1007l\x1b[?7h\x1b[?25h\x1b[?1049l\x1b[?2026l";
type PtySession = {
	pty: CapturedPty;
	agentDirectory: string;
	cleanup?: Promise<void>;
};

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

function processGroupExists(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

function processGroupId(pid: number): number {
	return Number(
		execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim(),
	);
}

function processState(pid: number): string {
	return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
		encoding: "utf8",
	}).trim();
}

let activeSession: PtySession | undefined;

async function cleanupSession(session: PtySession): Promise<void> {
	if (!session.cleanup) {
		const attempt = (async () => {
			await session.pty.close();
			await rm(session.agentDirectory, { recursive: true, force: true });
			await expect(access(session.agentDirectory)).rejects.toThrow();
		})();
		session.cleanup = attempt;
		void attempt.catch(() => {
			if (session.cleanup === attempt) session.cleanup = undefined;
		});
	}
	await session.cleanup;
}

afterEach(async () => {
	const session = activeSession;
	activeSession = undefined;
	if (session) await cleanupSession(session);
});

async function launch(keyboardMode: "kitty" | "modifyOtherKeys" = "kitty"): Promise<CapturedPty> {
	const agentDirectory = await mkdtemp(join(tmpdir(), "zentui-pty-"));
	let session: PtySession | undefined;
	try {
		await mkdir(agentDirectory, { recursive: true });
		await writeFile(
			join(agentDirectory, "zentui.json"),
			JSON.stringify({
				layout: { fixedEditor: { enabled: true, mouseScroll: true, copyNotice: false } },
			}),
		);
		const pi = join(root, "node_modules/.bin/pi");
		const pty = spawnCapturedPty(
			pi,
			[
				"--no-extensions",
				"-e",
				"./extensions/zentui/index.ts",
				"--no-session",
				"--no-context-files",
			],
			{
				cwd: root,
				keyboardMode,
				env: {
					...Object.fromEntries(
						Object.entries(process.env).filter(
							(entry): entry is [string, string] => entry[1] !== undefined,
						),
					),
					TERM: "xterm-256color",
					PI_OFFLINE: "1",
					PI_CODING_AGENT_DIR: agentDirectory,
				},
				gracefulExitInput: "\x03\x03",
			},
		);
		session = { pty, agentDirectory };
		activeSession = session;
		const entered = await pty.waitFor("\x1b[?1049h", 15_000);
		await pty.waitFor("\x1b[?1002h", 15_000, entered);
		return pty;
	} catch (error) {
		try {
			if (session) await cleanupSession(session);
			else await rm(agentDirectory, { recursive: true, force: true });
		} catch (cleanupError) {
			if (error instanceof Error) {
				error.message += `\nPTY cleanup also failed: ${String(cleanupError)}`;
				throw error;
			}
			throw new AggregateError([error, cleanupError], "PTY launch and cleanup failed");
		}
		throw error;
	}
}

function assertSafeReset(output: string, from: number): number {
	const index = output.indexOf(reset, from);
	expect(index).toBeGreaterThanOrEqual(from);
	const parser = new OwnedTerminalStateParser({
		buffer: "alternate",
		autowrap: false,
		cursorVisible: false,
		mouse1000: true,
		mouse1002: true,
		mouse1006: true,
		alternateScroll: true,
		scrollRegion: { top: 2, bottom: 8 },
	});
	parser.feed(output.slice(index, index + reset.length));
	expect(parser.isSafe()).toBe(true);
	expect(output.slice(index, index + reset.length)).toBe(reset);
	return index;
}

function assertFullTerminalCleanup(
	output: string,
	keyboardMode: "kitty" | "modifyOtherKeys",
): void {
	const parser = new OwnedTerminalStateParser(
		{},
		keyboardMode === "kitty" ? { primary: { kittyFlags: 3, kittyStack: [1] } } : {},
		keyboardMode === "kitty",
	);
	parser.feed(output);
	expect(parser.keyboardUnderflows).toEqual([]);
	expect(
		parser.isSafe(keyboardMode === "kitty" ? { kittyFlags: 3, kittyStack: [1] } : undefined),
	).toBe(true);
	expect(parser.screen("primary").bracketedPaste).toBe(false);
	expect(parser.screen("primary").modifyOtherKeys).toBe(0);
	expect(parser.screen("alternate").kittyFlags).toBe(0);
	expect(parser.screen("alternate").kittyStack).toEqual([]);
	expect(parser.screen("alternate").bracketedPaste).toBe(false);
	expect(parser.screen("alternate").modifyOtherKeys).toBe(0);
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return predicate();
}

async function runCommand(
	pty: CapturedPty,
	text: string,
	acknowledgement: string,
	timeoutMs = 10_000,
): Promise<number> {
	const boundary = pty.output().length;
	pty.pty.write(`${text}\r`);
	try {
		return await pty.waitFor(acknowledgement, 2_000, boundary);
	} catch {
		// Pi may use the first Enter to accept the slash-command completion.
		pty.pty.write("\r");
		return pty.waitFor(acknowledgement, timeoutMs, boundary);
	}
}

async function runExitCommand(pty: CapturedPty, text: string): Promise<void> {
	pty.pty.write(`${text}\r`);
	if (!(await waitUntil(() => pty.hasExited(), 2_000))) {
		// Bounded retry only when the first Enter accepted autocomplete instead of executing.
		pty.pty.write("\r");
	}
	await pty.waitForExit(15_000);
}

async function finishPi(pty: CapturedPty): Promise<void> {
	await pty.waitForExit(15_000);
}

describe("PTY cleanup platform helpers", () => {
	it("uses signal-less node-pty termination on Windows", () => {
		const argumentCounts: number[] = [];
		terminateWindowsPty((...args: never[]) => argumentCounts.push(args.length));
		expect(argumentCounts).toEqual([0]);
	});

	it("surfaces EPERM immediately when probing or signaling an owned process group", () => {
		const calls: Array<[number, NodeJS.Signals | 0]> = [];
		const permissionError = Object.assign(new Error("denied"), { code: "EPERM" });
		const deny = (pid: number, signal: NodeJS.Signals | 0) => {
			calls.push([pid, signal]);
			throw permissionError;
		};
		expect(() => probeOwnedProcessGroup(42, deny)).toThrow(
			"Permission denied inspecting owned PTY process group 42",
		);
		expect(() => signalOwnedProcessGroup(42, "SIGTERM", deny)).toThrow(
			"Permission denied signaling owned PTY process group 42",
		);
		expect(calls).toEqual([
			[-42, 0],
			[-42, "SIGTERM"],
		]);
	});
});

describe("fixed editor real PTY cleanup", () => {
	run(
		"awaits an exact timed-out child exit before removing its agent directory",
		async () => {
			const agentDirectory = await mkdtemp(join(tmpdir(), "zentui-pty-cleanup-"));
			const pty = spawnCapturedPty(
				process.execPath,
				["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
				{
					cwd: root,
					env: Object.fromEntries(
						Object.entries(process.env).filter(
							(entry): entry is [string, string] => entry[1] !== undefined,
						),
					),
				},
			);
			const session = { pty, agentDirectory };
			activeSession = session;
			await pty.waitFor("ready", 2_000);
			await expect(pty.waitForExit(50)).rejects.toThrow("PTY timeout");
			await cleanupSession(session);
			expect(pty.hasExited()).toBe(true);
			await expect(access(agentDirectory)).rejects.toThrow();
		},
		5_000,
	);

	run(
		"kills an owned PTY group whose leader and child ignore graceful signals",
		async () => {
			if (process.platform === "win32") return;
			const agentDirectory = await mkdtemp(join(tmpdir(), "zentui-pty-group-"));
			const stubbornChild = [
				"for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, () => {});",
				"if (process.send) process.send('ready');",
				"setInterval(() => {}, 1000);",
			].join("");
			const stubbornLeader = [
				"const { spawn } = require('node:child_process');",
				"for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(signal, () => {});",
				`const child = spawn(process.execPath, ['-e', ${JSON.stringify(stubbornChild)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });`,
				"child.once('message', (message) => { if (message === 'ready') process.stdout.write('ready ' + process.pid + ' ' + child.pid); });",
				"setInterval(() => {}, 1000);",
			].join("");
			const pty = spawnCapturedPty(process.execPath, ["-e", stubbornLeader], {
				cwd: root,
				env: Object.fromEntries(
					Object.entries(process.env).filter(
						(entry): entry is [string, string] => entry[1] !== undefined,
					),
				),
				gracefulExitInput: "\x03\x03",
			});
			const session = { pty, agentDirectory };
			activeSession = session;
			await pty.waitFor("ready ", 2_000);
			const match = pty.output().match(/ready (\d+) (\d+)/);
			expect(match).not.toBeNull();
			const leaderPid = Number(match?.[1]);
			const childPid = Number(match?.[2]);
			expect(leaderPid).toBe(pty.pty.pid);
			expect(processGroupId(leaderPid)).toBe(leaderPid);
			expect(processGroupId(childPid)).toBe(leaderPid);
			expect(processGroupExists(leaderPid)).toBe(true);

			const firstClose = pty.close();
			expect(pty.close()).toBe(firstClose);
			await firstClose;
			await cleanupSession(session);

			expect(pty.cleanupActions()).toEqual([
				"write-graceful-exit",
				"group-SIGCONT",
				"group-SIGTERM",
				"group-SIGCONT",
				"group-SIGKILL",
			]);
			expect(processExists(leaderPid)).toBe(false);
			expect(processExists(childPid)).toBe(false);
			expect(processGroupExists(leaderPid)).toBe(false);
		},
		8_000,
	);

	run(
		"cleans an OS-stopped Pi group without a test-body SIGCONT",
		async () => {
			if (process.platform === "win32") return;
			const pty = await launch("kitty");
			const session = activeSession;
			expect(session).toBeDefined();
			const pid = pty.pty.pid;
			expect(processGroupId(pid)).toBe(pid);
			process.kill(-pid, "SIGSTOP");
			expect(
				await waitUntil(() => {
					try {
						return processState(pid).includes("T");
					} catch {
						return false;
					}
				}, 2_000),
			).toBe(true);
			expect(processState(pid)).toContain("T");

			if (session) await cleanupSession(session);

			expect(pty.hasExited()).toBe(true);
			expect(processExists(pid)).toBe(false);
			expect(processGroupExists(pid)).toBe(false);
			expect(pty.cleanupActions()[0]).toBe("write-graceful-exit");
			expect(pty.cleanupActions()).toContain("group-SIGCONT");
		},
		30_000,
	);

	run.each([
		[
			"quit",
			async (pty: CapturedPty) => {
				await runExitCommand(pty, "/quit");
			},
		],
		[
			"Ctrl+C",
			async (pty: CapturedPty) => {
				pty.pty.write("\x03\x03");
			},
		],
		[
			"Ctrl+D",
			async (pty: CapturedPty) => {
				pty.pty.write("\x04");
			},
		],
		[
			"SIGHUP",
			async (pty: CapturedPty) => {
				process.kill(pty.pty.pid, "SIGHUP");
			},
		],
		[
			"SIGTERM",
			async (pty: CapturedPty) => {
				process.kill(pty.pty.pid, "SIGTERM");
			},
		],
	] as const)(
		"restores terminal state after %s",
		async (name, stop) => {
			const pty = await launch();
			const boundary = pty.output().length;
			await stop(pty);
			await finishPi(pty);
			const resetIndex = assertSafeReset(pty.output(), boundary);
			expect(pty.output().indexOf("\x1b[<u", resetIndex)).toBeGreaterThan(resetIndex);
			expect(pty.output().indexOf("\x1b[?2004l", resetIndex)).toBeGreaterThan(resetIndex);
			assertFullTerminalCleanup(pty.output(), "kitty");
			if (name === "quit") {
				const session = activeSession;
				expect(session).toBeDefined();
				if (session) await cleanupSession(session);
				expect(pty.cleanupActions()).toEqual([]);
			}
		},
		30_000,
	);

	run(
		"isolates live-disable reset before later shutdown",
		async () => {
			const pty = await launch();
			const boundary = pty.output().length;
			await runCommand(pty, "/zentui fixed-editor disable", reset);
			const resetIndex = assertSafeReset(pty.output(), boundary);
			expect(pty.output().slice(resetIndex + reset.length)).not.toContain("\x1b[?1049h");
			const liveParser = new OwnedTerminalStateParser(
				{},
				{
					primary: { kittyFlags: 3, kittyStack: [1] },
				},
			);
			liveParser.feed(pty.output().slice(0, resetIndex + reset.length));
			expect(liveParser.state.buffer).toBe("primary");
			expect(liveParser.screen("primary").kittyFlags).toBe(7);
			expect(liveParser.screen("primary").bracketedPaste).toBe(true);
			expect(liveParser.keyboardUnderflows).toEqual([]);
			await runExitCommand(pty, "/quit");
			assertFullTerminalCleanup(pty.output(), "kitty");
		},
		30_000,
	);

	run(
		"exits before suspend cleanup and re-enters after resume",
		async () => {
			const pty = await launch("kitty");
			const boundary = pty.output().length;
			pty.pty.write("\x1a");
			const resetIndex = await pty.waitFor(reset, 15_000, boundary);
			await pty.waitFor("\x1b[?2004l", 15_000, resetIndex);
			const suspended = new OwnedTerminalStateParser(
				{},
				{
					primary: { kittyFlags: 3, kittyStack: [1] },
				},
			);
			suspended.feed(pty.output().slice(0, pty.output().length));
			expect(suspended.isSafe({ kittyFlags: 3, kittyStack: [1] })).toBe(true);

			process.kill(pty.pty.pid, "SIGCONT");
			const reentered = await pty.waitFor("\x1b[?1049h", 15_000, resetIndex + reset.length);
			await pty.waitFor("\x1b[?1002h", 15_000, reentered);
			await runExitCommand(pty, "/quit");
			assertFullTerminalCleanup(pty.output(), "kitty");
		},
		35_000,
	);

	run(
		"restores modifyOtherKeys fallback on the primary screen",
		async () => {
			const pty = await launch("modifyOtherKeys");
			const boundary = pty.output().length;
			await runExitCommand(pty, "/quit");
			const resetIndex = assertSafeReset(pty.output(), boundary);
			expect(pty.output().indexOf("\x1b[>4;0m", resetIndex)).toBeGreaterThan(resetIndex);
			expect(pty.output().indexOf("\x1b[?2004l", resetIndex)).toBeGreaterThan(resetIndex);
			assertFullTerminalCleanup(pty.output(), "modifyOtherKeys");
		},
		30_000,
	);
});
