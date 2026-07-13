import { describe, expect, it } from "vitest";
import { emptyGitStatus } from "../extensions/zentui/git";
import { applyProjectRefreshToState } from "../extensions/zentui/project-state";
import { createInitialState } from "../extensions/zentui/state";

describe("applyProjectRefreshToState", () => {
	it("keeps last-good git and runtime on transient errors", () => {
		const state = createInitialState({
			...emptyGitStatus(),
			branch: "main",
			modified: 2,
		});
		state.runtime = { name: "nodejs", symbol: "n", style: "bold green", version: "v22" };

		applyProjectRefreshToState(state, {
			cwd: "/repo",
			previousCwd: "/repo",
			git: { kind: "error" },
			runtime: { kind: "error" },
		});

		expect(state.branch).toBe("main");
		expect(state.modified).toBe(2);
		expect(state.runtime?.name).toBe("nodejs");
	});

	it("clears git when not a repo", () => {
		const state = createInitialState({
			...emptyGitStatus(),
			branch: "main",
			dirty: true,
			modified: 1,
		});

		applyProjectRefreshToState(state, {
			cwd: "/tmp",
			previousCwd: "/tmp",
			git: { kind: "not_a_repo" },
			runtime: { kind: "ok", runtime: undefined },
		});

		expect(state.branch).toBeUndefined();
		expect(state.modified).toBe(0);
		expect(state.dirty).toBe(false);
	});

	it("clears previous project state on cwd change before applying results", () => {
		const state = createInitialState({
			...emptyGitStatus(),
			branch: "old-branch",
			modified: 3,
		});
		state.runtime = { name: "python", symbol: "p", style: "yellow bold", version: "v3" };

		applyProjectRefreshToState(state, {
			cwd: "/new",
			previousCwd: "/old",
			git: { kind: "error" },
			runtime: { kind: "error" },
		});

		expect(state.branch).toBeUndefined();
		expect(state.modified).toBe(0);
		expect(state.runtime).toBeUndefined();
	});

	it("applies ok git/runtime results", () => {
		const state = createInitialState(emptyGitStatus());
		const nextCwd = applyProjectRefreshToState(state, {
			cwd: "/repo",
			previousCwd: undefined,
			git: {
				kind: "ok",
				status: {
					...emptyGitStatus(),
					branch: "feat",
					gitState: "REBASING",
					gitStateLabel: "REBASING 1/2",
				},
			},
			runtime: {
				kind: "ok",
				runtime: { name: "bun", symbol: "b", style: "bold red", version: "v1" },
			},
		});

		expect(nextCwd).toBe("/repo");
		expect(state.branch).toBe("feat");
		expect(state.gitStateLabel).toBe("REBASING 1/2");
		expect(state.runtime?.name).toBe("bun");
	});

	it("applies ok packageVersion result and clears it when manifest disappears", () => {
		const state = createInitialState(emptyGitStatus());

		applyProjectRefreshToState(state, {
			cwd: "/repo",
			previousCwd: "/repo",
			git: { kind: "ok", status: emptyGitStatus() },
			runtime: { kind: "ok", runtime: undefined },
			packageVersion: {
				kind: "ok",
				result: { ecosystem: "nodejs", version: "1.2.3" },
			},
		});
		expect(state.packageVersion).toEqual({ ecosystem: "nodejs", version: "1.2.3" });

		applyProjectRefreshToState(state, {
			cwd: "/repo",
			previousCwd: "/repo",
			git: { kind: "ok", status: emptyGitStatus() },
			runtime: { kind: "ok", runtime: undefined },
			packageVersion: { kind: "ok", result: null },
		});
		expect(state.packageVersion).toBeUndefined();
	});

	it("keeps last-good packageVersion on transient error", () => {
		const state = createInitialState(emptyGitStatus());
		state.packageVersion = { ecosystem: "rust", version: "0.4.2" };

		applyProjectRefreshToState(state, {
			cwd: "/repo",
			previousCwd: "/repo",
			git: { kind: "ok", status: emptyGitStatus() },
			runtime: { kind: "ok", runtime: undefined },
			packageVersion: { kind: "error" },
		});
		expect(state.packageVersion).toEqual({ ecosystem: "rust", version: "0.4.2" });
	});

	it("clears packageVersion on cwd change even when no result is provided", () => {
		const state = createInitialState(emptyGitStatus());
		state.packageVersion = { ecosystem: "python", version: "2.0.0" };

		applyProjectRefreshToState(state, {
			cwd: "/new",
			previousCwd: "/old",
			git: { kind: "error" },
			runtime: { kind: "error" },
		});
		expect(state.packageVersion).toBeUndefined();
	});

	it("clears commit and metrics on cwd change", () => {
		const state = createInitialState(emptyGitStatus());
		state.commit = { oid: "abc123", detached: true, tag: "v1" };
		state.metrics = { added: 10, deleted: 5 };

		applyProjectRefreshToState(state, {
			cwd: "/new",
			previousCwd: "/old",
			git: { kind: "error" },
			runtime: { kind: "error" },
		});
		expect(state.commit).toBeUndefined();
		expect(state.metrics).toBeUndefined();
	});
});
