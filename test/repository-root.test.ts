import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	findRepositoryRoot,
	RepositoryRootController,
	repositoryRootForCwd,
	updateRepositoryRootState,
} from "../extensions/zentui/repository-root";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("repository root discovery", () => {
	it.each(["directory", "file"] as const)("finds the nearest .git %s", (markerKind) => {
		const parent = mkdtempSync(join(tmpdir(), "zentui-repository-root-"));
		const root = join(parent, "repo");
		const nested = join(root, "extensions", "zentui");
		try {
			mkdirSync(nested, { recursive: true });
			if (markerKind === "directory") mkdirSync(join(root, ".git"));
			else writeFileSync(join(root, ".git"), "gitdir: ../worktrees/repo\n");
			expect(findRepositoryRoot(nested)).toBe(root);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});
});

describe("repository root state", () => {
	it("keeps A invalid through A→B→A until the fresh A generation completes", async () => {
		const parent = mkdtempSync(join(tmpdir(), "zentui-repository-transition-"));
		const rootA = join(parent, "repo-a");
		const cwdA = join(rootA, "src");
		const rootB = join(parent, "repo-b");
		const cwdB = join(rootB, "lib");
		const controller = new RepositoryRootController();
		try {
			mkdirSync(join(rootA, ".git"), { recursive: true });
			mkdirSync(cwdA, { recursive: true });
			mkdirSync(join(rootB, ".git"), { recursive: true });
			mkdirSync(cwdB, { recursive: true });

			const initialA = controller.request(cwdA);
			expect(controller.update(initialA, true)).toBe(rootA);
			expect(controller.rootForCwd(cwdA)).toBe(rootA);

			const oldAResult = deferred();
			const oldARequest = controller.request(cwdA);
			const oldARefresh = oldAResult.promise.then(() => controller.update(oldARequest, true));
			const bResult = deferred();
			const bRequest = controller.request(cwdB);
			const bRefresh = bResult.promise.then(() => controller.update(bRequest, true));
			const freshAResult = deferred();
			const freshARequest = controller.request(cwdA);
			const freshARefresh = freshAResult.promise.then(() => controller.update(freshARequest, true));

			expect(controller.rootForCwd(cwdA)).toBeUndefined();
			bResult.resolve();
			expect(await bRefresh).toBeUndefined();
			expect(controller.rootForCwd(cwdA)).toBeUndefined();
			oldAResult.resolve();
			expect(await oldARefresh).toBeUndefined();
			expect(controller.rootForCwd(cwdA)).toBeUndefined();

			freshAResult.resolve();
			expect(await freshARefresh).toBe(rootA);
			expect(controller.rootForCwd(cwdA)).toBe(rootA);
			expect(controller.rootForCwd(cwdB)).toBeUndefined();
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it("updates and clears roots across repository and cwd transitions", () => {
		let state = updateRepositoryRootState("/repo-a/src", true, () => "/repo-a");
		expect(repositoryRootForCwd(state, "/repo-a/src", () => true)).toBe("/repo-a");
		expect(repositoryRootForCwd(state, "/repo-b/lib", () => true)).toBeUndefined();

		state = updateRepositoryRootState("/repo-b/lib", true, () => "/repo-b");
		expect(repositoryRootForCwd(state, "/repo-b/lib", () => true)).toBe("/repo-b");

		state = updateRepositoryRootState("/tmp", false);
		expect(repositoryRootForCwd(state, "/tmp", () => true)).toBeUndefined();
	});

	it("clears missing roots and lookup failures instead of reusing stale state", () => {
		const failed = updateRepositoryRootState("/repo/src", true, () => {
			throw new Error("lookup failed");
		});
		expect(failed).toEqual({ cwd: "/repo/src" });
		expect(repositoryRootForCwd(failed, "/repo/src", () => true)).toBeUndefined();

		const missing = updateRepositoryRootState("/repo/src", true, () => "/repo");
		expect(repositoryRootForCwd(missing, "/repo/src", () => false)).toBeUndefined();
		expect(
			repositoryRootForCwd(missing, "/repo/src", () => {
				throw new Error("marker lookup failed");
			}),
		).toBeUndefined();
	});
});
