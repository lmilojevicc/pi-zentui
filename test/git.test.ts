import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	detectGitState,
	emptyGitStatus,
	parseGitNumstat,
	parseGitStatusPorcelain,
	readGitStatus,
} from "../extensions/zentui/git";

describe("readGitStatus with real Git", () => {
	it.each([false, true])("preserves a stat-stale index (readMetrics=%s)", async (readMetrics) => {
		const root = mkdtempSync(join(tmpdir(), "zentui-git-index-"));
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
		try {
			git("init", "-b", "main");
			git("config", "user.name", "Zentui Test");
			git("config", "user.email", "zentui@example.invalid");
			git("config", "commit.gpgSign", "false");
			// Ensure the probe overrides auto-refresh even when enabled in repository config.
			git("config", "diff.autoRefreshIndex", "true");
			const stale = join(root, "unchanged.txt");
			writeFileSync(stale, "unchanged\n");
			utimesSync(stale, 946684800, 946684800);
			writeFileSync(join(root, "staged.txt"), "before\n");
			writeFileSync(join(root, "unstaged.txt"), "before\n");
			git("add", ".");
			git("commit", "-m", "initial");
			writeFileSync(join(root, "staged.txt"), "before\nstaged\n");
			git("add", "staged.txt");
			writeFileSync(join(root, "unstaged.txt"), "after\nextra\n");
			// Only stat data changes: diff would otherwise refresh this clean entry on disk.
			utimesSync(stale, 978307200, 978307200);
			const indexPath = join(root, ".git", "index");
			const indexBefore = readFileSync(indexPath);

			expect(
				await readGitStatus(root, {
					readMetrics,
					readStash: false,
					readOperationState: false,
				}),
			).toMatchObject({
				kind: "ok",
				status: {
					branch: "main",
					dirty: true,
					staged: 1,
					modified: 1,
					untracked: 0,
					metrics: readMetrics ? { added: 3, deleted: 1 } : undefined,
				},
			});
			expect(readFileSync(indexPath).equals(indexBefore)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("parseGitStatusPorcelain", () => {
	it("returns empty status for empty output", () => {
		expect(parseGitStatusPorcelain("", 0)).toEqual(emptyGitStatus());
	});

	it("emptyGitStatus clears commit and metrics", () => {
		const empty = emptyGitStatus();
		expect(empty.commit).toBeUndefined();
		expect(empty.metrics).toBeUndefined();
	});

	it("parses branch, ahead/behind, and file states", () => {
		const status = parseGitStatusPorcelain(
			[
				"# branch.head main",
				"# branch.ab +2 -1",
				"1 .M N... 100644 100644 100644 abc abc file.txt",
				"1 M. N... 100644 100644 100644 abc abc staged.txt",
				"2 R. N... 100644 100644 100644 abc abc R100 old.ts\tnew.ts",
				"? untracked.ts",
				"u UU N... 100644 100644 100644 100644 abc abc conflict.ts",
			].join("\n"),
			1,
		);

		expect(status).toMatchObject({
			branch: "main",
			dirty: true,
			ahead: 2,
			behind: 1,
			modified: 1,
			staged: 1,
			renamed: 1,
			untracked: 1,
			conflicted: 1,
			stashed: 1,
		});
	});

	it("hides detached head as no branch", () => {
		const status = parseGitStatusPorcelain("# branch.head (detached)", 0);
		expect(status.branch).toBeUndefined();
	});

	it("captures branch.oid and detached flag", () => {
		const detached = parseGitStatusPorcelain(
			["# branch.oid a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "# branch.head (detached)"].join(
				"\n",
			),
			0,
		);
		expect(detached.branch).toBeUndefined();
		expect(detached.commit).toEqual({
			oid: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
			detached: true,
			tag: null,
		});
	});

	it("captures branch.oid on a normal branch and reports detached=false", () => {
		const onBranch = parseGitStatusPorcelain(
			["# branch.oid deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "# branch.head main"].join("\n"),
			0,
		);
		expect(onBranch.branch).toBe("main");
		expect(onBranch.commit?.oid).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
		expect(onBranch.commit?.detached).toBe(false);
	});

	it("treats unborn branch.oid (initial) as null and skips commit info without branch headers", () => {
		const unborn = parseGitStatusPorcelain(
			["# branch.oid (initial)", "# branch.head main (no commits)"].join("\n"),
			0,
		);
		expect(unborn.commit?.oid).toBeNull();
		// No branch headers at all → no commit info.
		expect(parseGitStatusPorcelain("", 0).commit).toBeUndefined();
	});
});

describe("detectGitState", () => {
	function fixture(files: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), "zentui-git-state-"));
		const paths: Record<string, string> = {};
		for (const [name, content] of Object.entries(files)) {
			const full = join(root, name);
			const slash = name.indexOf("/");
			if (slash > 0) {
				mkdirSync(join(root, name.slice(0, slash)), { recursive: true });
			}
			writeFileSync(full, content, "utf8");
			paths[name] = full;
		}
		return { root, paths };
	}

	function requirePath(paths: Record<string, string>, key: string): string {
		const value = paths[key];
		if (!value) throw new Error(`missing fixture path ${key}`);
		return value;
	}

	it("detects REBASING with step counts from rebase-merge", () => {
		const { paths } = fixture({
			"rebase-merge/msgnum": "3\n",
			"rebase-merge/end": "10\n",
		});
		const msgnum = requirePath(paths, "rebase-merge/msgnum");
		const end = requirePath(paths, "rebase-merge/end");
		const rebaseMerge = join(msgnum, "..");
		expect(
			detectGitState({
				rebaseMerge,
				rebaseMsgnum: msgnum,
				rebaseEnd: end,
			}),
		).toEqual({ gitState: "REBASING", gitStateLabel: "REBASING 3/10" });
	});

	it("detects MERGING / CHERRY-PICKING / REVERTING / BISECTING", () => {
		const { paths } = fixture({
			MERGE_HEAD: "abc",
			CHERRY_PICK_HEAD: "def",
			REVERT_HEAD: "ghi",
			BISECT_LOG: "log",
		});
		expect(detectGitState({ mergeHead: requirePath(paths, "MERGE_HEAD") })).toEqual({
			gitState: "MERGING",
			gitStateLabel: "MERGING",
		});
		expect(detectGitState({ cherryPickHead: requirePath(paths, "CHERRY_PICK_HEAD") })).toEqual({
			gitState: "CHERRY-PICKING",
			gitStateLabel: "CHERRY-PICKING",
		});
		expect(detectGitState({ revertHead: requirePath(paths, "REVERT_HEAD") })).toEqual({
			gitState: "REVERTING",
			gitStateLabel: "REVERTING",
		});
		expect(detectGitState({ bisectLog: requirePath(paths, "BISECT_LOG") })).toEqual({
			gitState: "BISECTING",
			gitStateLabel: "BISECTING",
		});
	});

	describe("parseGitNumstat", () => {
		it("sums added/deleted across text files", () => {
			expect(
				parseGitNumstat(["10\t5\tsrc/a.ts", "3\t0\tsrc/b.ts", "0\t7\tsrc/c.ts"].join("\n")),
			).toEqual({ added: 13, deleted: 12 });
		});

		it("skips binary rows (-\t-)", () => {
			expect(parseGitNumstat("-\t-\tasset.png\n5\t2\tsrc.ts")).toEqual({ added: 5, deleted: 2 });
		});

		it("handles rename rows (old\tnew path)", () => {
			expect(parseGitNumstat("0\t0\told.ts\tnew.ts")).toEqual({ added: 0, deleted: 0 });
			expect(parseGitNumstat("5\t1\told.ts\tnew.ts")).toEqual({ added: 5, deleted: 1 });
		});

		it("handles CRLF line endings", () => {
			expect(parseGitNumstat("3\t2\ta.ts\r\n1\t1\tb.ts\r\n")).toEqual({
				added: 4,
				deleted: 3,
			});
		});

		it("ignores malformed lines", () => {
			expect(
				parseGitNumstat(["garbage", "", "abc\tdef\tnotnum", "5\t2\tok.ts"].join("\n")),
			).toEqual({ added: 5, deleted: 2 });
		});

		it("returns zeros for empty output", () => {
			expect(parseGitNumstat("")).toEqual({ added: 0, deleted: 0 });
		});
	});

	it("prefers rebase over merge", () => {
		const { paths } = fixture({
			"rebase-apply/msgnum": "1\n",
			"rebase-apply/end": "2\n",
			MERGE_HEAD: "abc",
		});
		const msgnum = requirePath(paths, "rebase-apply/msgnum");
		const end = requirePath(paths, "rebase-apply/end");
		const rebaseApply = join(msgnum, "..");
		expect(
			detectGitState({
				rebaseApply,
				mergeHead: requirePath(paths, "MERGE_HEAD"),
				rebaseMsgnum: msgnum,
				rebaseEnd: end,
			}).gitState,
		).toBe("REBASING");
	});

	it("returns empty when no state files exist", () => {
		expect(detectGitState({})).toEqual({});
	});
});
