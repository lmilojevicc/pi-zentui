import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({
	execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: probe.exec }),
}));

import { readGitStatus } from "../extensions/zentui/git";

const specs = [
	"rebase-merge",
	"rebase-apply",
	"MERGE_HEAD",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
	"BISECT_LOG",
];
let root: string;
let paths: string[];
let status: string;
let pathOutput: string;
let failed: string[];
let failure: Error;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "zentui-git-probes-"));
	paths = specs.map((spec) => join(root, "worktrees", "linked", spec));
	pathOutput = `${paths.join("\n")}\n`;
	status = "# branch.oid abcdef\n# branch.head main\n# branch.ab +2 -1\n? fresh.txt\n";
	failed = [];
	failure = new Error("transient");
	probe.exec.mockReset().mockImplementation(async (_command, args: string[]) => {
		const subcommand = args[0] === "-c" ? args[2] : args[0];
		if (failed.includes(subcommand)) throw failure;
		if (subcommand === "status") return { stdout: status };
		if (subcommand === "stash") return { stdout: "stash@{0}: WIP\nstash@{1}: WIP\n" };
		if (subcommand === "describe") return { stdout: "v1.2.3\n" };
		if (subcommand === "diff") return { stdout: "10\t2\tfile\n-\t-\tbinary\n" };
		if (args.includes("--is-inside-work-tree")) return { stdout: "true\n" };
		// Supports the old baseline as well, so the count failure measures its real path.
		if (!args.includes("--path-format=absolute"))
			return { stdout: `${paths[specs.indexOf(args.at(-1) ?? "")]}\n` };
		return { stdout: pathOutput };
	});
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function marker(index: number) {
	mkdirSync(join(paths[index], ".."), { recursive: true });
	writeFileSync(paths[index], "operation\n");
}

describe("readGitStatus subprocess demand", () => {
	it("reads complete default status with exactly three processes, not eight", async () => {
		const result = await readGitStatus(root);
		expect(result).toMatchObject({
			kind: "ok",
			status: { branch: "main", stashed: 2, dirty: true, ahead: 2, behind: 1 },
		});
		expect(probe.exec).toHaveBeenCalledTimes(3);
		expect(probe.exec.mock.calls.map((call) => call[1][0])).toEqual([
			"status",
			"stash",
			"rev-parse",
		]);
		expect(probe.exec).toHaveBeenLastCalledWith(
			"git",
			["rev-parse", "--path-format=absolute", ...specs.flatMap((spec) => ["--git-path", spec])],
			{ cwd: root, timeout: 2000 },
		);
	});

	it("runs index-refreshing probes without optional locks", async () => {
		await readGitStatus(root, { readMetrics: true });
		const refreshing = probe.exec.mock.calls.filter(
			(call) => call[1].includes("status") || call[1].includes("diff"),
		);
		expect(refreshing).toHaveLength(2);
		for (const call of refreshing) expect(call[2].env.GIT_OPTIONAL_LOCKS).toBe("0");
	});

	it("uses one process for branch-only/minimalist demand", async () => {
		const result = await readGitStatus(root, { readStash: false, readOperationState: false });
		expect.soft(result).toMatchObject({
			kind: "ok",
			status: { branch: "main", stashed: 0, dirty: true },
		});
		expect(probe.exec).toHaveBeenCalledTimes(1);
	});

	it("keeps exact tags and metrics as separate optional probes", async () => {
		const result = await readGitStatus(root, {
			readExactTag: true,
			readMetrics: true,
			ignoreSubmodules: true,
		});
		expect(result).toMatchObject({
			kind: "ok",
			status: {
				commit: { oid: "abcdef", tag: "v1.2.3", detached: false },
				metrics: { added: 10, deleted: 2 },
			},
		});
		expect(probe.exec).toHaveBeenCalledTimes(5);
		expect(probe.exec).toHaveBeenCalledWith(
			"git",
			["-c", "diff.autoRefreshIndex=false", "diff", "HEAD", "--numstat", "--ignore-submodules=all"],
			expect.objectContaining({ cwd: root, timeout: 2000 }),
		);
	});

	it.each([false, true])("reads fresh linked-worktree rebase paths (apply=%s)", async (apply) => {
		const rebase = paths[apply ? 1 : 0];
		mkdirSync(rebase, { recursive: true });
		writeFileSync(join(rebase, "msgnum"), "3\n");
		writeFileSync(join(rebase, "end"), "10\n");
		marker(2);
		expect(await readGitStatus(root)).toMatchObject({
			kind: "ok",
			status: { gitStateLabel: "REBASING 3/10" },
		});
		rmSync(rebase, { recursive: true });
		expect(await readGitStatus(root)).toMatchObject({
			kind: "ok",
			status: { gitStateLabel: "MERGING" },
		});
		expect(probe.exec).toHaveBeenCalledTimes(6);
	});

	it.each([
		[2, "MERGING"],
		[3, "CHERRY-PICKING"],
		[4, "REVERTING"],
		[5, "BISECTING"],
	] as const)("uses distinct operation path %s", async (index, label) => {
		marker(index);
		expect(await readGitStatus(root)).toMatchObject({
			kind: "ok",
			status: { gitStateLabel: label },
		});
	});

	it.each(["empty", "extra", "relative", "embedded-newline", "nul"])(
		"fails open on %s path output",
		async (invalid) => {
			marker(2);
			if (invalid === "empty") pathOutput = "";
			if (invalid === "extra") pathOutput += "/unexpected\n";
			if (invalid === "relative") pathOutput = specs.join("\n");
			if (invalid === "embedded-newline")
				pathOutput = pathOutput.replace("worktrees", "work\ntrees");
			if (invalid === "nul") pathOutput = pathOutput.replace("worktrees", "work\0trees");
			expect(await readGitStatus(root)).toMatchObject({
				kind: "ok",
				status: { branch: "main", gitState: undefined },
			});
			expect(probe.exec).toHaveBeenCalledTimes(3);
		},
	);

	it("preserves spaces in absolute operation paths", async () => {
		paths = specs.map((spec) => join(root, " directory ", spec));
		pathOutput = `${paths.join("\n")}\n`;
		marker(2);
		expect(await readGitStatus(root)).toMatchObject({
			kind: "ok",
			status: { gitStateLabel: "MERGING" },
		});
	});

	it("silently falls back for optional probe failures", async () => {
		failed = ["stash", "describe", "diff", "rev-parse"];
		expect(await readGitStatus(root, { readExactTag: true, readMetrics: true })).toMatchObject({
			kind: "ok",
			status: { stashed: 0, gitState: undefined, commit: { tag: null }, metrics: null },
		});
	});

	it("distinguishes absent repos from transient status failures", async () => {
		failed = ["status"];
		failure = new Error("fatal: not a git repository");
		expect(await readGitStatus(root)).toEqual({ kind: "not_a_repo" });
		expect(probe.exec).toHaveBeenCalledTimes(2);
		failure = new Error("temporary index lock");
		probe.exec.mockClear();
		expect(await readGitStatus(root)).toEqual({ kind: "error" });
		expect(probe.exec).toHaveBeenCalledTimes(3);
	});
});
