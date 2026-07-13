import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectGitState, emptyGitStatus, parseGitStatusPorcelain } from "../extensions/zentui/git";

describe("parseGitStatusPorcelain", () => {
	it("returns empty status for empty output", () => {
		expect(parseGitStatusPorcelain("", 0)).toEqual(emptyGitStatus());
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
