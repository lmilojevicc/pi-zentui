import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 2_000;

export type GitOperationState =
	| "REBASING"
	| "MERGING"
	| "CHERRY-PICKING"
	| "REVERTING"
	| "BISECTING";

export type GitStatusSummary = {
	branch?: string;
	dirty: boolean;
	ahead: number;
	behind: number;
	conflicted: number;
	untracked: number;
	stashed: number;
	modified: number;
	staged: number;
	renamed: number;
	deleted: number;
	typechanged: number;
	gitState?: GitOperationState;
	gitStateLabel?: string;
};

export type GitReadResult =
	| { kind: "ok"; status: GitStatusSummary }
	| { kind: "not_a_repo" }
	| { kind: "error" };

export type GitStatePaths = {
	rebaseMerge?: string;
	rebaseApply?: string;
	mergeHead?: string;
	cherryPickHead?: string;
	revertHead?: string;
	bisectLog?: string;
	rebaseMsgnum?: string;
	rebaseEnd?: string;
};

export function emptyGitStatus(): GitStatusSummary {
	return {
		branch: undefined,
		dirty: false,
		ahead: 0,
		behind: 0,
		conflicted: 0,
		untracked: 0,
		stashed: 0,
		modified: 0,
		staged: 0,
		renamed: 0,
		deleted: 0,
		typechanged: 0,
		gitState: undefined,
		gitStateLabel: undefined,
	};
}

export function parseGitStatusPorcelain(stdoutText: string, stashCount: number): GitStatusSummary {
	const status = emptyGitStatus();
	status.stashed = stashCount;

	for (const line of stdoutText.split(/\r?\n/)) {
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const branch = line.slice("# branch.head ".length).trim();
			status.branch = branch && branch !== "(detached)" ? branch : undefined;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+)\s+-(\d+)/);
			if (match) {
				status.ahead = Number(match[1] ?? 0);
				status.behind = Number(match[2] ?? 0);
			}
			continue;
		}
		if (line.startsWith("#")) continue;

		status.dirty = true;

		if (line.startsWith("? ")) {
			status.untracked += 1;
			continue;
		}
		if (line.startsWith("u ")) {
			status.conflicted += 1;
			continue;
		}
		if (!(line.startsWith("1 ") || line.startsWith("2 "))) continue;

		const xy = line.split(" ")[1] ?? "..";
		const x = xy[0] ?? ".";
		const y = xy[1] ?? ".";

		if (x === "R") status.renamed += 1;
		else if (x === "D") status.deleted += 1;
		else if (x === "T") status.typechanged += 1;
		else if (x !== "." && x !== " ") status.staged += 1;

		if (y === "M") status.modified += 1;
		else if (y === "D") status.deleted += 1;
		else if (y === "T") status.typechanged += 1;
	}

	return status;
}

function readOptionalText(path: string | undefined): string | undefined {
	if (!path || !existsSync(path)) return undefined;
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return undefined;
	}
}

/**
 * Pure git operation-state detector. Paths that exist (truthy strings that
 * callers verified with `existsSync`) select the active state in Starship order.
 */
export function detectGitState(paths: GitStatePaths): {
	gitState?: GitOperationState;
	gitStateLabel?: string;
} {
	if (paths.rebaseMerge || paths.rebaseApply) {
		const msgnum = readOptionalText(paths.rebaseMsgnum);
		const end = readOptionalText(paths.rebaseEnd);
		if (msgnum && end) {
			return { gitState: "REBASING", gitStateLabel: `REBASING ${msgnum}/${end}` };
		}
		return { gitState: "REBASING", gitStateLabel: "REBASING" };
	}
	if (paths.mergeHead) return { gitState: "MERGING", gitStateLabel: "MERGING" };
	if (paths.cherryPickHead) {
		return { gitState: "CHERRY-PICKING", gitStateLabel: "CHERRY-PICKING" };
	}
	if (paths.revertHead) return { gitState: "REVERTING", gitStateLabel: "REVERTING" };
	if (paths.bisectLog) return { gitState: "BISECTING", gitStateLabel: "BISECTING" };
	return {};
}

async function resolveGitPath(cwd: string, pathSpec: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", pathSpec], {
			cwd,
			timeout: GIT_COMMAND_TIMEOUT_MS,
		});
		const resolved = (typeof stdout === "string" ? stdout : String(stdout)).trim();
		if (!resolved) return undefined;
		return resolved.startsWith("/") ? resolved : join(cwd, resolved);
	} catch {
		return undefined;
	}
}

async function readGitOperationState(cwd: string): Promise<{
	gitState?: GitOperationState;
	gitStateLabel?: string;
}> {
	const [rebaseMerge, rebaseApply, mergeHead, cherryPickHead, revertHead, bisectLog] =
		await Promise.all([
			resolveGitPath(cwd, "rebase-merge"),
			resolveGitPath(cwd, "rebase-apply"),
			resolveGitPath(cwd, "MERGE_HEAD"),
			resolveGitPath(cwd, "CHERRY_PICK_HEAD"),
			resolveGitPath(cwd, "REVERT_HEAD"),
			resolveGitPath(cwd, "BISECT_LOG"),
		]);

	const existing = (path: string | undefined) => (path && existsSync(path) ? path : undefined);
	const rebaseDir = existing(rebaseMerge) ?? existing(rebaseApply);

	return detectGitState({
		rebaseMerge: existing(rebaseMerge),
		rebaseApply: existing(rebaseApply),
		mergeHead: existing(mergeHead),
		cherryPickHead: existing(cherryPickHead),
		revertHead: existing(revertHead),
		bisectLog: existing(bisectLog),
		rebaseMsgnum: rebaseDir ? join(rebaseDir, "msgnum") : undefined,
		rebaseEnd: rebaseDir ? join(rebaseDir, "end") : undefined,
	});
}

function isNotARepoError(error: unknown): boolean {
	const message =
		error instanceof Error
			? `${error.message}\n${"stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : ""}`
			: String(error);
	return /not a git repository|outside repository|not a git repo/i.test(message);
}

export async function readGitStatus(cwd: string): Promise<GitReadResult> {
	try {
		const [{ stdout: statusStdout }, stashResult] = await Promise.all([
			execFileAsync("git", ["status", "--porcelain=2", "--branch"], {
				cwd,
				timeout: GIT_COMMAND_TIMEOUT_MS,
			}),
			execFileAsync("git", ["stash", "list"], {
				cwd,
				timeout: GIT_COMMAND_TIMEOUT_MS,
			}).catch(() => ({ stdout: "" })),
		]);
		const stdoutText = typeof statusStdout === "string" ? statusStdout : String(statusStdout);
		const stashStdout =
			typeof stashResult.stdout === "string" ? stashResult.stdout : String(stashResult.stdout);
		const stashCount = stashStdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
		const status = parseGitStatusPorcelain(stdoutText, stashCount);
		const operation = await readGitOperationState(cwd);
		return {
			kind: "ok",
			status: {
				...status,
				...operation,
			},
		};
	} catch (error) {
		if (isNotARepoError(error)) return { kind: "not_a_repo" };

		// Distinguish not-a-repo vs transient with a cheap rev-parse on the error path.
		try {
			const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
				cwd,
				timeout: GIT_COMMAND_TIMEOUT_MS,
			});
			const inside = (typeof stdout === "string" ? stdout : String(stdout)).trim();
			if (inside !== "true") return { kind: "not_a_repo" };
			return { kind: "error" };
		} catch (inner) {
			if (isNotARepoError(inner)) return { kind: "not_a_repo" };
			return { kind: "error" };
		}
	}
}
