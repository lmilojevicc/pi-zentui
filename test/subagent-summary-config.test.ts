import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("node:fs", async (original) => {
	const actual = await original<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: vi.fn(actual.renameSync),
		writeFileSync: vi.fn(actual.writeFileSync),
	};
});

import {
	mergeConfig,
	migrateComponentSelections,
	saveComponentColor,
	saveComponentPreset,
	saveSubagentSummaryComponentPatch,
} from "../extensions/zentui/config";
import { componentPresets } from "../extensions/zentui/presets";

const dirs: string[] = [];
function fixture(value: unknown = {}) {
	const dir = fs.mkdtempSync(join(tmpdir(), "zentui-subagent-config-"));
	dirs.push(dir);
	const path = join(dir, "zentui.json");
	fs.writeFileSync(path, JSON.stringify(value));
	vi.clearAllMocks();
	return {
		dir,
		path,
		bytes: () => fs.readFileSync(path, "utf8"),
		raw: () => JSON.parse(fs.readFileSync(path, "utf8")),
	};
}
afterEach(() => {
	vi.clearAllMocks();
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test.each([undefined, null, "true", 1, {}, false])(
	"canonical summary defaults off for %j",
	(enabled) => {
		expect(
			mergeConfig({
				features: { editor: true, statusLine: true },
				components: { subagentSummary: { enabled } },
			}).components.subagentSummary.enabled,
		).toBe(false);
	},
);
test("owner saves preserve future fields, unrelated choices/colors and explicit resets", () => {
	const initial = {
		colors: { cwd: "red" },
		components: {
			subagentSummary: { future: [1] },
			editor: { style: "future", colors: { accent: "blue" } },
			future: { enabled: "future" },
		},
	};
	const f = fixture(initial);
	saveSubagentSummaryComponentPatch({ enabled: true }, f.path);
	expect(f.raw()).toEqual({
		...initial,
		components: { ...initial.components, subagentSummary: { enabled: true, future: [1] } },
	});
	saveComponentColor("editor", "accent", undefined, f.path);
	expect(f.raw().components.subagentSummary).toEqual({ enabled: true, future: [1] });
	expect(f.raw().components.editor.colors).toEqual({});
	saveSubagentSummaryComponentPatch({ enabled: false }, f.path);
	expect(f.raw().components.subagentSummary).toEqual({ enabled: false, future: [1] });
});
test("all-owner migration snapshots the new selection without importing or touching preview JSON; presets never change it", () => {
	for (const enabled of [false, true]) {
		const f = fixture({
			colors: { cwd: "red" },
			components: { subagentSummary: { enabled, future: true } },
		});
		const legacy = join(f.dir, "zentui-subagents.json");
		fs.writeFileSync(legacy, '{"enabled":true,"unshipped":true}');
		for (const preset of componentPresets) {
			saveComponentPreset(preset, f.path);
			expect(f.raw().components.subagentSummary).toEqual({ enabled, future: true });
		}
		migrateComponentSelections(f.path);
		expect(f.raw().components.subagentSummary).toEqual({ enabled, future: true });
		expect(f.raw().colors).toEqual({ cwd: "red" });
		expect(fs.readFileSync(legacy, "utf8")).toBe('{"enabled":true,"unshipped":true}');
	}
	const missing = fixture();
	fs.writeFileSync(join(missing.dir, "zentui-subagents.json"), '{"enabled":true}');
	migrateComponentSelections(missing.path);
	expect(missing.raw().components.subagentSummary).toEqual({ enabled: false });
});
test.each(["{broken", "null", "[]"])("refuses corrupt/nonobject %s unchanged", (bytes) => {
	const f = fixture();
	fs.writeFileSync(f.path, bytes);
	vi.clearAllMocks();
	expect(() => saveSubagentSummaryComponentPatch({ enabled: true }, f.path)).toThrow(/Refusing/);
	expect(f.bytes()).toBe(bytes);
	expect(fs.renameSync).not.toHaveBeenCalled();
	expect(fs.writeFileSync).not.toHaveBeenCalled();
	expect(fs.readdirSync(f.dir)).toEqual(["zentui.json"]);
});
test.each(["write", "rename"])(
	"atomic %s failure preserves data and cleans temporary files",
	(operation) => {
		const f = fixture({ keep: "original" });
		const before = f.bytes();
		const mock = operation === "write" ? vi.mocked(fs.writeFileSync) : vi.mocked(fs.renameSync);
		mock.mockImplementationOnce(() => {
			throw new Error("EACCES");
		});
		expect(() => saveSubagentSummaryComponentPatch({ enabled: true }, f.path)).toThrow("EACCES");
		expect(f.bytes()).toBe(before);
		expect(fs.readdirSync(f.dir)).toEqual(["zentui.json"]);
	},
);
test("preserves symlink/target mode and rejects dangling links", () => {
	const f = fixture({ keep: true });
	fs.chmodSync(f.path, 0o640);
	const link = join(f.dir, "linked.json");
	fs.symlinkSync(f.path, link);
	saveSubagentSummaryComponentPatch({ enabled: true }, link);
	expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
	expect(fs.statSync(f.path).mode & 0o777).toBe(0o640);
	expect(f.raw()).toEqual({ keep: true, components: { subagentSummary: { enabled: true } } });
	fs.unlinkSync(f.path);
	expect(() => saveSubagentSummaryComponentPatch({ enabled: false }, link)).toThrow();
	expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
	expect(fs.readdirSync(f.dir)).toEqual(["linked.json"]);
});
