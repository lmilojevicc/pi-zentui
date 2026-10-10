import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PendingPreimages,
	PREIMAGE_MAX_BYTES,
	projectPending,
	readWorkspacePreimage,
} from "../extensions/zentui/tool-display/pending.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "zentui-tool-display-pending-"));
	mkdirSync(join(root, "workspace"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const cwd = () => join(root, "workspace");
describe("tool-display/pending", () => {
	it("reads bounded workspace text and recognizes creates without following paths", () => {
		writeFileSync(join(cwd(), "f"), "original");
		expect(readWorkspacePreimage(cwd(), "f")).toEqual({ exists: true, content: "original" });
		expect(readWorkspacePreimage(cwd(), "new/deep/file")).toEqual({ exists: false, content: "" });
	});
	it("rejects out-of-workspace paths, final/ancestor symlinks, binary and oversized files", () => {
		writeFileSync(join(root, "secret"), "secret");
		symlinkSync(join(root, "secret"), join(cwd(), "link"));
		symlinkSync(root, join(cwd(), "parent"));
		writeFileSync(join(cwd(), "binary"), Buffer.from([0, 1]));
		writeFileSync(join(cwd(), "invalid"), Buffer.from([0xff]));
		writeFileSync(join(cwd(), "huge"), "x".repeat(PREIMAGE_MAX_BYTES + 1));
		for (const path of [
			"../secret",
			join(root, "secret"),
			"link",
			"parent/secret",
			"parent/missing",
			"binary",
			"invalid",
			"huge",
			".",
		])
			expect(readWorkspacePreimage(cwd(), path).notice).toContain("Preview unavailable");
	});
	it("exact projections preserve BOM/CRLF and reject ambiguous/overlapping/incomplete edits", () => {
		const preimage = { exists: true, content: "\ufeffa\r\nb\r\n" };
		expect(projectPending("edit", { oldText: "b", newText: "x" }, preimage).nextContent).toBe(
			"\ufeffa\r\nx\r\n",
		);
		expect(
			projectPending(
				"edit",
				{
					edits: [
						{ oldText: "a", newText: "one" },
						{ oldText: "b", newText: "two" },
					],
				},
				preimage,
			).nextContent,
		).toBe("\ufeffone\r\ntwo\r\n");
		for (const args of [
			{ oldText: "", newText: "x" },
			{ oldText: "missing", newText: "x" },
			{ oldText: "a" },
			{
				edits: [
					{ oldText: "ab", newText: "x" },
					{ oldText: "bc", newText: "y" },
				],
			},
		])
			expect(projectPending("edit", args, { exists: true, content: "abc" }).notice).toContain(
				"Preview unavailable",
			);
		expect(
			projectPending("edit", { oldText: "a", newText: "x" }, { exists: true, content: "aa" })
				.notice,
		).toContain("not unique");
	});
	it("write create/overwrite/unavailable labels are honest and projected size bounded", () => {
		expect(
			projectPending("write", { content: "new" }, { exists: false, content: "" }),
		).toMatchObject({ label: "pending create", nextContent: "new" });
		expect(
			projectPending("write", { content: "new" }, { exists: true, content: "old" }),
		).toMatchObject({ label: "pending overwrite", nextContent: "new" });
		expect(
			projectPending("write", { content: "new" }, { notice: "unreadable" }),
		).not.toHaveProperty("nextContent");
		expect(
			projectPending(
				"write",
				{ content: "x".repeat(PREIMAGE_MAX_BYTES + 1) },
				{ exists: true, content: "old" },
			).notice,
		).toContain("oversized");
	});
	it("only observed live IDs match; no path/history reuse, first snapshot retained, clear/TTL release", () => {
		writeFileSync(join(cwd(), "f"), "old");
		let now = 0;
		const cache = new PendingPreimages(() => now);
		expect(cache.get("history", "write", { path: "f" }, cwd())).toBeUndefined();
		cache.observe("live", "write", { path: "f" }, cwd());
		writeFileSync(join(cwd(), "f"), "new");
		cache.observe("live", "write", { path: "f" }, cwd());
		expect(cache.get("live", "write", { path: "f" }, cwd())?.content).toBe("old");
		expect(cache.get("live", "edit", { path: "f" }, cwd())).toBeUndefined();
		expect(cache.get("live", "write", { path: "other" }, cwd())).toBeUndefined();
		expect(cache.get("live", "write", { path: "f" }, root)).toBeUndefined();
		now = 60_000;
		expect(cache.size).toBe(0);
		cache.observe("next", "edit", { path: "f" }, cwd());
		cache.clear();
		cache.clear();
		expect(cache.size).toBe(0);
	});
	it("bounds entries and total preimage bytes", () => {
		const cache = new PendingPreimages();
		writeFileSync(join(cwd(), "f"), "old");
		for (let i = 0; i < 100; i++) cache.observe(String(i), "write", { path: "f" }, cwd());
		expect(cache.size).toBe(16);
		writeFileSync(join(cwd(), "large"), "x".repeat(PREIMAGE_MAX_BYTES));
		cache.clear();
		for (let i = 0; i < 8; i++) cache.observe(String(i), "write", { path: "large" }, cwd());
		expect(cache.size).toBe(4);
	});
});
