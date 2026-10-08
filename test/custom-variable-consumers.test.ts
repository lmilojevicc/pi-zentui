import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { mergeConfig, type ZentuiConfig } from "../extensions/zentui/config";
import {
	editorDemandsCustomVariable,
	footerDemandsCustomVariable,
} from "../extensions/zentui/custom-variable-demand";
import {
	AtomicTemplateValues,
	normalizeTemplateVariables,
} from "../extensions/zentui/custom-variable-format";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";

const key = "@scope/usage:quota";
const value = "CC $459/1200";
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;
function footer(
	config: ZentuiConfig,
	values = new Map([[key, value]]),
	statuses = new Map<string, string>(),
) {
	let component: { render(width: number): string[] } | undefined;
	installFooter(
		{
			cwd: "/tmp/project",
			model: { provider: "test" },
			getContextUsage: () => null,
			sessionManager: { getSessionName: () => undefined },
			ui: {
				setFooter(factory: (...args: never[]) => typeof component) {
					component = factory(
						{ requestRender() {} } as never,
						theme as never,
						{ getExtensionStatuses: () => statuses, onBranchChange: () => () => {} } as never,
					);
				},
			},
		} as never,
		createInitialState(emptyGitStatus()),
		() => config,
		{ setRequestRender() {}, scheduleProjectRefresh() {}, getCustomVariables: () => values },
	);
	return {
		render(width: number) {
			if (!component) throw new Error("missing footer");
			return component.render(width);
		},
	};
}
function configuration(
	format = "$model( · $quota)",
	style: "opencode" | "opencode-copy-friendly" = "opencode",
) {
	return mergeConfig({
		components: {
			editor: {
				colorSource: "theme",
				style,
				styles: { [style]: { metadataFormat: format, variables: { quota: key } } },
			},
			footer: {
				style: "starship",
				styles: { starship: { format: "$quota", variables: { quota: key }, responsive: false } },
			},
		},
	});
}
function editor(config: ZentuiConfig, width: number, text = value) {
	return renderPolishedEditorFrame({
		width,
		editorLines: ["draft"],
		uiTheme: theme,
		config,
		modelMeta: {
			modelLabel: "model",
			providerLabel: "test",
			customVariables: new Map([[key, text]]),
		},
	});
}

describe("custom value template consumers", () => {
	it.each(["opencode", "opencode-copy-friendly"] as const)(
		"renders safe whole aliases in %s, yielding before builtins at narrow widths",
		(style) => {
			const config = configuration(undefined, style);
			expect(editor(config, 100).join("\n")).toContain(`model · ${value}`);
			for (const width of [5, 10, 15, 30, 60, 100]) {
				const rows = editor(config, width);
				expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
				const rendered = stripVTControlCharacters(rows.join("\n"));
				if (rendered.includes("CC")) expect(rendered).toContain(value);
				if (width === 10) {
					expect(rendered).toContain("model");
					expect(rendered).not.toContain("CC");
				}
			}
		},
	);
	it("keeps incoming SGR/links safe and changes only owner-local custom color mode", () => {
		const config = configuration("$quota");
		const raw = "\x1b[31mCC $459/1200\x1b]8;;https://example.com\x07 link\x1b]52;c;bad\x07";
		const original = editor(config, 100, raw).join("\n");
		expect(original).toContain("\x1b[31m");
		expect(original).toContain("https://example.com");
		expect(original).not.toContain("]52;");
		config.components.editor.styles.opencode.extensionColorMode = "zentui";
		const neutral = editor(config, 100, raw).join("\n");
		expect(neutral).not.toContain("\x1b[31m");
		expect(neutral).not.toContain("https://example.com");
		expect(config.components.footer.styles.starship.extensionColorMode).toBeUndefined();
	});
	it("renders aliases in wide Footer templates and omits partial values as a unit", () => {
		const f = footer(configuration());
		expect(f.render(80).join("\n")).toContain(value);
		for (const width of [1, 2, 4, 6, 10, 14, 20, 80]) {
			const rows = f.render(width);
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			const text = stripVTControlCharacters(rows.join("\n"));
			if (text.includes("CC")) expect(text).toContain(value);
			expect(text).not.toMatch(/[\ue000-\uf8ff]/);
		}
	});
	it("packs explicit compact aliases without redefining the existing $extensions status token", () => {
		const config = configuration();
		Object.assign(config.components.footer.styles.starship, {
			format:
				"a single very long literal that cannot fit this width and forces compact rendering $quota",
			compactFormat: "$quota$wrap$extensions",
			compactMaxLines: 2,
			responsive: true,
		});
		const f = footer(config, new Map([[key, value]]), new Map([["status-plugin", "PR #123"]]));
		const rows = f.render(20);
		expect(rows.join("\n")).toContain(value);
		expect(rows.join("\n")).toContain("PR #123");
		expect(rows.every((row) => visibleWidth(row) <= 20)).toBe(true);
		const narrow = f.render(8).join("\n");
		expect(narrow).not.toMatch(/[\ue000-\uf8ff]/);
		expect(narrow).not.toContain("CC");
	});
	it("handles repeated aliases, wide graphemes, styled fragments and compact early truncation safely", () => {
		const config = configuration();
		const raw = "\x1b[31m月\x1b[32m quota🙂\x1b[0m";
		Object.assign(config.components.footer.styles.starship, {
			format: "$quota · $quota",
			responsive: true,
			compactFormat: "$cwd $quota",
			compactMaxLines: 1,
		});
		const f = footer(config, new Map([[key, raw]]));
		for (const width of [3, 6, 10, 15, 20, 30, 80]) {
			const rows = f.render(width);
			const text = stripVTControlCharacters(rows.join("\n"));
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			expect(text).not.toMatch(/[\ue000-\uf8ff]/);
			if (text.includes("月")) expect(text).toContain("月 quota🙂");
		}
	});
	it("reports independent consumer demand, with compact-only references active only when responsive", () => {
		const config = configuration("$model");
		expect(editorDemandsCustomVariable(config, key)).toBe(false);
		expect(footerDemandsCustomVariable(config, key)).toBe(true);
		config.components.footer.styles.starship.format = "$cwd";
		config.components.footer.styles.starship.compactFormat = "$quota";
		expect(footerDemandsCustomVariable(config, key)).toBe(false);
		config.components.footer.styles.starship.responsive = true;
		expect(footerDemandsCustomVariable(config, key)).toBe(true);
		config.components.footer.style = "hidden";
		expect(footerDemandsCustomVariable(config, key)).toBe(false);
	});
	it("reserves builtin/structural/prototype names and Unicode controls", () => {
		expect(
			normalizeTemplateVariables(
				{ model: key, extensions: key, constructor: key, quota: key, invalid: "pkg\u009bquota" },
				["model"],
			),
		).toEqual({ quota: key });
	});
	it("internal probes avoid input collisions and detect early partial cropping", () => {
		const atomic = new AtomicTemplateValues(new Map([[key, value]]), ["\ue000"]);
		const probe = atomic.resolve(key);
		expect(probe).not.toContain("\ue000");
		expect(visibleWidth(probe)).toBe(visibleWidth(value));
		expect(atomic.omitted([probe], [probe])).toEqual([]);
		expect(atomic.restore([probe])).toEqual([value]);
		expect(atomic.omitted([probe.slice(0, 3)], [probe.slice(0, 3)])).toEqual([key]);
	});
});
