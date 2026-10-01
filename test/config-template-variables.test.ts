import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	mergeConfig,
	savePolishedCopyFriendlyEditorStylePatch,
	savePolishedEditorStylePatch,
	saveStarshipFooterStylePatch,
} from "../extensions/zentui/config";

const key = "@scope/usage:quota";
describe("owner-local template aliases", () => {
	it("normalizes each style independently and rejects reserved Footer aliases", () => {
		const config = mergeConfig({
			components: {
				editor: {
					styles: {
						opencode: { variables: { quota: key, model: key }, extensionColorMode: "zentui" },
						"opencode-copy-friendly": { variables: { jobs: "@scope/jobs:queue" } },
					},
				},
				footer: {
					styles: {
						starship: { variables: { quota: key, branch: key, cost: key, extensions: key } },
					},
				},
			},
		});
		expect(config.components.editor.styles.opencode.variables).toEqual({ quota: key });
		expect(config.components.editor.styles["opencode-copy-friendly"].variables).toEqual({
			jobs: "@scope/jobs:queue",
		});
		expect(config.components.footer.styles.starship.variables).toEqual({ quota: key });
		expect(config.components.footer.styles.starship.extensionColorMode).toBeUndefined();
	});
	it("saves and resets aliases without enabling consumers or rewriting other owners", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-template-aliases-"));
		const path = join(dir, "zentui.json");
		try {
			const initial = {
				future: 1,
				components: {
					editor: { enabled: false },
					footer: { style: "hidden", future: "keep" },
					workingLine: { enabled: false },
				},
			};
			writeFileSync(path, JSON.stringify(initial));
			const read = () => JSON.parse(readFileSync(path, "utf8"));
			savePolishedEditorStylePatch(
				{ variables: { quota: key }, extensionColorMode: "zentui" },
				path,
			);
			expect(read().components.footer).toEqual(initial.components.footer);
			expect(read().components.editor.enabled).toBe(false);
			const editor = read().components.editor;
			saveStarshipFooterStylePatch(
				{ variables: { quota: key }, extensionColorMode: "original" },
				path,
			);
			expect(read().components.editor).toEqual(editor);
			expect(read().components.footer.style).toBe("hidden");
			saveStarshipFooterStylePatch({ variables: { quota: null }, extensionColorMode: null }, path);
			expect(read().components.footer.styles.starship.variables).toBeUndefined();
			expect(read().components.footer.styles.starship.extensionColorMode).toBeUndefined();
			savePolishedCopyFriendlyEditorStylePatch({ variables: { copy: key } }, path);
			savePolishedEditorStylePatch({ variables: { quota: null }, extensionColorMode: null }, path);
			expect(read().components.editor.styles.opencode.variables).toBeUndefined();
			expect(read().components.editor.styles["opencode-copy-friendly"].variables).toEqual({
				copy: key,
			});
			expect(read().components.workingLine).toEqual(initial.components.workingLine);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
