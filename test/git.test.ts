import { describe, expect, it } from "vitest";
import { emptyGitStatus, parseGitStatusPorcelain } from "../extensions/zentui/git";

describe("parseGitStatusPorcelain", () => {
	it("returns empty status for empty output", () => {
		expect(parseGitStatusPorcelain("", false)).toEqual(emptyGitStatus());
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
			true,
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
			stashed: true,
		});
	});

	it("hides detached head as no branch", () => {
		const status = parseGitStatusPorcelain("# branch.head (detached)", false);
		expect(status.branch).toBeUndefined();
	});
});
