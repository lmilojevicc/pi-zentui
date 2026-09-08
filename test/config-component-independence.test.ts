import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (original) => {
	const actual = await original<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: vi.fn(actual.renameSync),
		writeFileSync: vi.fn(actual.writeFileSync),
	};
});

import { componentColor, componentColorKeys } from "../extensions/zentui/component-colors";
import {
	hasUnsupportedComponentStyle,
	mergeConfig,
	migrateComponentSelections,
	saveAccentRailEditorStylePatch,
	saveComponentColor,
	saveEditorComponentPatch,
	saveExtensionStatusPlacement,
	saveFooterComponentPatch,
	saveMinimalistEditorStylePatch,
	savePolishedCopyFriendlyEditorStylePatch,
	savePolishedEditorStylePatch,
	saveSelectorBordersComponentPatch,
	saveStarshipFooterStylePatch,
	saveSubagentSummaryComponentPatch,
	saveThinkingStepsComponentPatch,
	saveUserMessagesComponentPatch,
	saveWorkingLineComponentPatch,
} from "../extensions/zentui/config";

function withFile(initial: unknown, run: (path: string, dir: string) => void) {
	const dir = fs.mkdtempSync(join(tmpdir(), "zentui-independent-"));
	const path = join(dir, "zentui.json");
	try {
		if (initial !== undefined) fs.writeFileSync(path, JSON.stringify(initial));
		vi.clearAllMocks();
		run(path, dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
const raw = (path: string) => JSON.parse(fs.readFileSync(path, "utf8"));
afterEach(() => vi.clearAllMocks());

const ownerSaves = [
	["subagentSummary", (p: string) => saveSubagentSummaryComponentPatch({ enabled: true }, p)],
	["editor", (p: string) => saveEditorComponentPatch({ colorSource: "terminal" }, p)],
	["editor", (p: string) => savePolishedEditorStylePatch({ completionMenu: "native" }, p)],
	[
		"editor",
		(p: string) => savePolishedCopyFriendlyEditorStylePatch({ metadataFormat: "$model" }, p),
	],
	["editor", (p: string) => saveAccentRailEditorStylePatch({ transparent: true }, p)],
	["editor", (p: string) => saveMinimalistEditorStylePatch({ showCost: false }, p)],
	["userMessages", (p: string) => saveUserMessagesComponentPatch({ enabled: false }, p)],
	["selectorBorders", (p: string) => saveSelectorBordersComponentPatch({ enabled: false }, p)],
	["footer", (p: string) => saveFooterComponentPatch({ colorSource: "terminal" }, p)],
	["footer", (p: string) => saveStarshipFooterStylePatch({ format: "$cwd $branch" }, p)],
	["footer", (p: string) => saveExtensionStatusPlacement("future", "left", p)],
	["workingLine", (p: string) => saveWorkingLineComponentPatch({ enabled: true }, p)],
	["thinkingSteps", (p: string) => saveThinkingStepsComponentPatch({ enabled: true }, p)],
] as const;

describe("owner-only component persistence", () => {
	it.each(ownerSaves)("snapshots only %s and preserves unrelated raw JSON", (owner, save) => {
		const initial = {
			unknown: { keep: true },
			features: { editor: false, copyFriendly: true },
			colors: { git: "red", future: { keep: true } },
			components: Object.fromEntries(
				[
					"editor",
					"userMessages",
					"selectorBorders",
					"footer",
					"workingLine",
					"thinkingSteps",
					"subagentSummary",
					"future",
				].map((key) => [
					key,
					{
						style: `future-${key}`,
						enabled: "future-enabled",
						colorSource: "future-source",
						colors: { accent: "invalid", future: { keep: true } },
						styles: { future: { nested: [false, 17] } },
					},
				]),
			),
		};
		withFile(initial, (path) => {
			save(path);
			const saved = raw(path);
			for (const other of Object.keys(initial.components))
				if (other !== owner) expect(saved.components[other]).toEqual(initial.components[other]);
			expect(saved.components[owner].style).toBe(`future-${owner}`);
			expect(saved.components[owner].colors).toEqual(initial.components[owner]?.colors);
			expect(saved.components[owner].styles.future).toEqual({ nested: [false, 17] });
			expect({ ...saved, components: undefined }).toEqual({ ...initial, components: undefined });
		});
	});
	it("leaves untouched owners legacy-derived until migration", () =>
		withFile(
			{ features: { editor: false, copyFriendly: true }, colorSources: { editor: "terminal" } },
			(path) => {
				savePolishedEditorStylePatch({ completionMenu: "native" }, path);
				const saved = raw(path);
				expect(Object.keys(saved.components)).toEqual(["editor"]);
				expect(saved.components.editor).toMatchObject({
					enabled: false,
					style: "opencode-copy-friendly",
					colorSource: "terminal",
				});
				saved.features = { editor: true, copyFriendly: false };
				saved.colorSources.editor = "theme";
				const config = mergeConfig(saved);
				expect(config.components.editor).toMatchObject({
					enabled: false,
					style: "opencode-copy-friendly",
					colorSource: "terminal",
				});
				expect(config.components.userMessages.enabled).toBe(true);
				expect(config.components.selectorBorders).toMatchObject({
					enabled: true,
					colorSource: "theme",
				});
			},
		));
	it.each(Object.keys(componentColorKeys) as Array<keyof typeof componentColorKeys>)(
		"isolates %s overrides, preserves invalid/future keys, and deletes on reset",
		(owner) =>
			withFile(
				{
					colors: { editorAccent: "red", cwdText: "green", workingLineLow: "yellow" },
					components: {
						[owner]: { colors: { future: { keep: true }, invalid: 123 } },
						future: { style: "new" },
					},
				},
				(path) => {
					const key = componentColorKeys[owner][0];
					const inherited = componentColor(mergeConfig(raw(path)), owner, key);
					for (const value of ["fg:202", "", "   "]) {
						const config = saveComponentColor(owner, key, value, path);
						expect(componentColor(config, owner, key)).toBe(value);
						expect(config.components[owner].colors).toEqual({ [key]: value });
						expect(raw(path).components[owner].colors).toEqual({
							future: { keep: true },
							invalid: 123,
							[key]: value,
						});
						expect(raw(path).components.future).toEqual({ style: "new" });
					}
					const before = fs.readFileSync(path, "utf8");
					expect(() => saveComponentColor(owner, key, "unknown-style", path)).toThrow();
					expect(fs.readFileSync(path, "utf8")).toBe(before);
					const config = saveComponentColor(owner, key, undefined, path);
					expect(componentColor(config, owner, key)).toBe(inherited);
					expect(raw(path).components[owner].colors).not.toHaveProperty(key);
				},
			),
	);
});

describe("explicit component selection migration", () => {
	it("atomically snapshots effective choices, is idempotent, and never freezes raw colors", () =>
		withFile(
			{
				features: { editor: false, copyFriendly: true, statusLine: false },
				colorSources: { editor: "terminal", userMessages: "terminal", starship: "terminal" },
				editorModelLabel: "name",
				contextThresholds: { warning: 50, error: 85 },
				editorMetadataFormat: "$model_id",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Footer format syntax.
				footerFormat: "${branch} $fill $cost",
				colors: { cwdText: "red", git: "green", editorAccent: "blue", future: [1] },
				components: {
					userMessages: { styles: { framed: { copyFriendly: true, future: true } } },
					editor: { styles: { polished: { copyFriendly: true, future: "keep" } } },
					footer: { enabled: false },
					workingLine: { intervalMs: 70, messages: { mode: "append", values: ["Wait"] } },
					future: { colorSource: "future" },
				},
			},
			(path, dir) => {
				const initial = raw(path);
				const before = mergeConfig(initial);
				const migrated = migrateComponentSelections(path);
				expect(migrated).toEqual(before);
				expect(fs.renameSync).toHaveBeenCalledTimes(1);
				expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
				const saved = raw(path);
				expect(saved.colors).toEqual(initial.colors);
				for (const owner of Object.keys(componentColorKeys))
					expect(saved.components[owner]).not.toHaveProperty("colors");
				expect(saved.components.future).toEqual(initial.components.future);
				expect(saved.components.editor.styles.polished.future).toBe("keep");
				expect(saved.components.userMessages.styles.framed.future).toBe(true);
				const bytes = fs.readFileSync(path, "utf8");
				migrateComponentSelections(path);
				expect(fs.readFileSync(path, "utf8")).toBe(bytes);
				expect(fs.readdirSync(dir)).toEqual(["zentui.json"]);
				saved.features = { editor: true, statusLine: true, copyFriendly: false };
				saved.colorSources = { editor: "theme", userMessages: "theme", starship: "theme" };
				saved.editorModelLabel = "id";
				saved.contextThresholds = { warning: 10, error: 20 };
				saved.editorMetadataFormat = "$provider";
				saved.footerFormat = "$cwd";
				saved.components.footer.enabled = true;
				expect(mergeConfig(saved).components).toEqual(migrated.components);
				saved.colors.cwdText = "purple";
				saved.colors.git = "yellow";
				saved.colors.editorAccent = "cyan";
				const changed = mergeConfig(saved);
				expect(componentColor(changed, "footer", "cwd")).toBe("purple");
				expect(componentColor(changed, "editor", "cwd")).toBe("purple");
				expect(componentColor(changed, "editor", "gitBranch")).toBe("yellow");
				expect(componentColor(changed, "userMessages", "accent")).toBe("cyan");
			},
		));
	it("preserves unsupported selected styles and raw invalid local overrides", () =>
		withFile(
			{
				components: {
					editor: { style: "future-editor", colors: { accent: "unsupported", future: true } },
				},
			},
			(path) => {
				const config = migrateComponentSelections(path);
				expect(hasUnsupportedComponentStyle(config, "editor")).toBe(true);
				expect(raw(path).components.editor.colors).toEqual({ accent: "unsupported", future: true });
				expect(config.components.editor.colors).toEqual({});
			},
		));
	it("keeps bytes and removes temporary files on failed rename", () =>
		withFile({ unknown: true }, (path, dir) => {
			const before = fs.readFileSync(path, "utf8");
			vi.mocked(fs.renameSync).mockImplementationOnce(() => {
				throw new Error("rename failed");
			});
			expect(() => migrateComponentSelections(path)).toThrow("rename failed");
			expect(fs.readFileSync(path, "utf8")).toBe(before);
			expect(fs.readdirSync(dir)).toEqual(["zentui.json"]);
		}));
	it("refuses corrupt JSON and dangling symlinks without writing", () =>
		withFile(undefined, (path, dir) => {
			fs.writeFileSync(path, "{broken");
			expect(() => migrateComponentSelections(path)).toThrow(/Refusing/);
			expect(fs.readFileSync(path, "utf8")).toBe("{broken");
			fs.unlinkSync(path);
			fs.symlinkSync(join(dir, "missing"), path);
			expect(() => migrateComponentSelections(path)).toThrow(/Refusing/);
			expect(fs.lstatSync(path).isSymbolicLink()).toBe(true);
			expect(fs.readdirSync(dir)).toEqual(["zentui.json"]);
		}));
	it("writes the latest symlink target atomically while retaining mode", () =>
		withFile({ features: { editor: false } }, (path, dir) => {
			const link = join(dir, "link.json");
			fs.symlinkSync(path, link);
			fs.chmodSync(path, 0o600);
			const config = migrateComponentSelections(link);
			expect(config.components.editor.enabled).toBe(false);
			expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
			expect(fs.statSync(path).mode & 0o777).toBe(0o600);
			expect(fs.readdirSync(dir).sort()).toEqual(["link.json", "zentui.json"]);
		}));
});
