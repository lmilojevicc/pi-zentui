import { expect, test } from "vitest";
import {
	cleanSubagentText,
	projectSubagentSummary,
	subagentSummaryLines,
} from "../extensions/zentui/subagent-summary-view";

const now = 100_000;
const run = (id: string, state = "running", extra = {}) => ({ id, label: id, state, ...extra });
const project = (runs: unknown[], omitted = {}) =>
	projectSubagentSummary(
		{ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs, omitted } },
		now,
	);

test.each(["queued", "running"])("v1 active %s ignores endedAt", (state) => {
	expect(project([run("active", state, { endedAt: 0 })]).rows).toHaveLength(1);
});
test.each(["complete", "failed", "partial", "paused", "stopped", "rejected"])(
	"v1 terminal %s requires its own recent endedAt",
	(state) => {
		for (const endedAt of [undefined, null, "99999", NaN, Infinity, -1, now + 1, now - 10_001]) {
			const result = project([
				run("old", state, { endedAt, startedAt: now, generatedAt: now, updatedAt: now }),
			]);
			expect(result.rows).toEqual([]);
			expect(result.omitted.display).toBe(false);
		}
		for (const endedAt of [now, now - 10_000, now - 1])
			expect(project([run("recent", state, { endedAt })]).rows).toHaveLength(1);
	},
);
test("active parents precede children and children are fair round-robin with explicit parent labels", () => {
	const children = (id: string) =>
		Array.from({ length: 8 }, (_, index) => run(`${id}-${index}`, "running", { kind: "step" }));
	const result = project([
		run("a", "running", { children: children("a") }),
		run("b", "queued", { children: children("b") }),
	]);
	expect(result.rows.map((row) => row.label)).toEqual([
		"a",
		"b",
		"a › a-0",
		"b › b-0",
		"a › a-1",
		"b › b-1",
	]);
	expect(result.omitted.display).toBe(true);
	expect(subagentSummaryLines(result)).toHaveLength(8);
});
test("active parents cannot be hidden by an earlier chain's children or terminal runs", () => {
	const result = project([
		run("done", "complete", { endedAt: now }),
		...Array.from({ length: 6 }, (_, index) =>
			run(`r${index}`, "running", { children: [run("step", "running", { kind: "step" })] }),
		),
	]);
	expect(result.rows.map((row) => row.label)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
});
test("unknown neutral states precede newest terminal states, and only immediate step children qualify", () => {
	const result = project([
		run("old", "failed", { endedAt: now - 2 }),
		run("new", "complete", { endedAt: now }),
		run("neutral", "pending"),
		run("expired", "paused", {
			endedAt: 1,
			children: [
				run("child", "running", { kind: "step" }),
				run("not-step", "running", { kind: "subagent" }),
			],
		}),
	]);
	expect(result.rows.map((row) => row.label)).toEqual(["expired › child", "neutral", "new", "old"]);
});
test("reevaluates retention on every snapshot without first-seen or generated timestamps", () => {
	const data = {
		asyncSnapshot: {
			kind: "pi-subagents.async-status-snapshot",
			version: 1,
			generatedAt: now + 30_000,
			runs: [run("done", "complete", { endedAt: now })],
		},
	};
	expect(projectSubagentSummary(data, now + 10_000).rows).toHaveLength(1);
	expect(subagentSummaryLines(projectSubagentSummary(data, now + 10_001))).toEqual([]);
});
test.each(["runs", "children", "byteLimitExceeded"])(
	"preserves upstream omission-only %s",
	(key) => {
		const result = project([], { [key]: key === "byteLimitExceeded" ? true : 2 });
		expect(result.omitted[key as keyof typeof result.omitted]).toBe(true);
		expect(subagentSummaryLines(result)).toEqual([
			"Subagents · use /subagents-fleet for details",
			"  More fleet details available in /subagents-fleet",
		]);
	},
);
test("bounds inspection before touching excess entries, and expired rows aren't overflow", () => {
	const unreadable = new Proxy(
		{},
		{
			get() {
				throw new Error("outside cap");
			},
		},
	);
	const runs = Array.from({ length: 20 }, (_, index) =>
		run(`${index}`, "complete", {
			endedAt: 1,
			children: [
				...Array.from({ length: 8 }, () => run("old", "complete", { kind: "step", endedAt: 1 })),
				unreadable,
			],
		}),
	);
	const result = project([...runs, unreadable]);
	expect(result.rows).toEqual([]);
	expect(result.omitted).toEqual({
		runs: false,
		children: false,
		byteLimitExceeded: false,
		inspection: true,
		display: false,
	});
});
test("bounds 4MiB strings before sanitization and never serializes unused payload", () => {
	const huge = "x".repeat(4 * 1024 * 1024);
	const result = project([
		run("bounded", huge, {
			label: huge,
			activity: { currentTool: huge },
			transcript: {
				toJSON() {
					throw new Error("unused");
				},
			},
		}),
	]);
	const row = result.rows[0];
	expect(row.label).toHaveLength(240);
	expect(row.state).toHaveLength(240);
	expect(row.action).toHaveLength(240);
	expect(subagentSummaryLines(result).join("").length).toBeLessThan(1000);
});
test("strips raw OSC, VT, C0/C1 and repairs invalid surrogates while preserving Unicode", () => {
	const text = "😀漢字é";
	expect(
		cleanSubagentText(
			`\x1b]8;;https://unsafe\x07${text}\x1b]8;;\x07\x1b[31m\x00\x9b\x9d\x85\ud800x\udc00`,
		),
	).toBe(`${text} �x�`);
	expect(cleanSubagentText(`${"a".repeat(239)}😀`)).toBe(`${"a".repeat(239)}�`);
});
test.each([
	null,
	{},
	{ asyncSnapshot: { kind: "wrong", version: 1, runs: [] } },
	{ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 2, runs: [] } },
])("fails closed on incompatible snapshot %j", (data) => {
	expect(projectSubagentSummary(data, now).compatible).toBe(false);
});
