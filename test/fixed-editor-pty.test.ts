import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CapturedPty, spawnCapturedPty } from "./helpers/pi-pty";
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

let activeSession: PtySession | undefined;

async function cleanupSession(session: PtySession): Promise<void> {
	session.cleanup ??= (async () => {
		await session.pty.close();
		await rm(session.agentDirectory, { recursive: true, force: true });
		await expect(access(session.agentDirectory)).rejects.toThrow();
	})();
	await session.cleanup;
}

afterEach(async () => {
	const session = activeSession;
	activeSession = undefined;
	if (session) await cleanupSession(session);
});

async function launch(): Promise<CapturedPty> {
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
			},
		);
		session = { pty, agentDirectory };
		activeSession = session;
		const entered = await pty.waitFor("\x1b[?1049h", 15_000);
		await pty.waitFor("\x1b[?1002h", 15_000, entered);
		return pty;
	} catch (error) {
		if (session) {
			await cleanupSession(session);
		} else {
			await rm(agentDirectory, { recursive: true, force: true });
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
			await expect(pty.waitFor("never", 50)).rejects.toThrow("PTY timeout");
			await cleanupSession(session);
			expect(pty.hasExited()).toBe(true);
			await expect(access(agentDirectory)).rejects.toThrow();
		},
		5_000,
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
		async (_name, stop) => {
			const pty = await launch();
			const boundary = pty.output().length;
			await stop(pty);
			await finishPi(pty);
			assertSafeReset(pty.output(), boundary);
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
			await runExitCommand(pty, "/quit");
		},
		30_000,
	);
});
