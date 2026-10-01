import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { FOOTER_FORMAT_ALIASES, mergeConfig } from "../extensions/zentui/config";
import {
	editorDemandsCustomVariable,
	editorMetadataReferences,
	footerDemandsCustomVariable,
} from "../extensions/zentui/custom-variable-demand";
import { normalizeTemplateVariables } from "../extensions/zentui/custom-variable-format";
import { installFooter } from "../extensions/zentui/footer";
import {
	collectFooterFormatReferences,
	compiledFooterFormat,
	parseFooterFormat,
} from "../extensions/zentui/footer-format";
import { emptyGitStatus } from "../extensions/zentui/git";
import { renderMinimalistFrame } from "../extensions/zentui/minimalist-editor";
import { MINIMALIST_FORMAT_SLOTS } from "../extensions/zentui/minimalist-template";
import { createInitialState } from "../extensions/zentui/state";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";

const names = ["toString", "valueOf", "hasOwnProperty"] as const;
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;

function renderFooter(config: ReturnType<typeof mergeConfig>, values: ReadonlyMap<string, string>) {
	let component: { render(width: number): string[] } | undefined;
	installFooter(
		{
			cwd: "/tmp/project",
			getContextUsage: () => null,
			sessionManager: { getSessionName: () => undefined },
			ui: {
				setFooter(factory: (...args: never[]) => typeof component) {
					component = factory(
						{ requestRender() {} } as never,
						theme as never,
						{ getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} } as never,
					);
				},
			},
		} as never,
		createInitialState(emptyGitStatus()),
		() => config,
		{ setRequestRender() {}, scheduleProjectRefresh() {}, getCustomVariables: () => values },
	);
	if (!component) throw new Error("missing footer");
	return component.render(100).join("\n");
}

describe("custom-variable aliases matching Object.prototype names", () => {
	it.each(names)(
		"collects string references for $%s without a configured canonical alias",
		(name) => {
			const format = `($${name})$wrap$directory$fill\${${name}}`;
			expect([...collectFooterFormatReferences(parseFooterFormat(format))]).toEqual([
				name,
				"directory",
			]);
			const compiled = compiledFooterFormat(format, FOOTER_FORMAT_ALIASES);
			expect(compiled.references).toEqual([name, "cwd"]);
			expect(compiled.compact.left[0]?.references).toEqual([name]);
			expect(compiled.compact.right[0]?.references).toEqual([name]);
		},
	);

	it.each(names)(
		"observes own and null-prototype %s alias additions, edits and removals",
		(name) => {
			const format = `cache-prototype-${name} $${name}`;
			for (const aliases of [{}, Object.create(null)] as Record<string, string>[]) {
				const initial = compiledFooterFormat(format, aliases);
				expect(initial.references).toEqual([name]);
				expect(compiledFooterFormat(format, aliases)).toBe(initial);
				aliases[name] = "cwd";
				const added = compiledFooterFormat(format, aliases);
				expect(added.tokens).toBe(initial.tokens);
				expect(added.references).toEqual(["cwd"]);
				expect([...collectFooterFormatReferences(added.tokens, aliases)]).toEqual(["cwd"]);
				aliases[name] = "tokens";
				expect(compiledFooterFormat(format, aliases).references).toEqual(["tokens"]);
				delete aliases[name];
				expect(compiledFooterFormat(format, aliases).references).toEqual([name]);
			}
		},
	);

	it("retains inherited string aliases and observes edits without retaining the map", () => {
		const prototype = { toString: "cwd", directory: "git_branch" };
		const aliases = Object.create(prototype) as Record<string, string>;
		const format = "inherited-string-alias $toString $directory";
		const initial = compiledFooterFormat(format, aliases);
		expect(initial.references).toEqual(["cwd", "git_branch"]);
		expect([...collectFooterFormatReferences(initial.tokens, aliases)]).toEqual([
			"cwd",
			"git_branch",
		]);
		expect(compiledFooterFormat(format, aliases)).toBe(initial);
		prototype.toString = "tokens";
		expect(compiledFooterFormat(format, aliases).references).toEqual(["tokens", "git_branch"]);
		Reflect.set(aliases, "toString", "cost");
		expect(compiledFooterFormat(format, aliases).references).toEqual(["cost", "git_branch"]);
		Reflect.deleteProperty(aliases, "toString");
		expect(compiledFooterFormat(format, aliases).references).toEqual(["tokens", "git_branch"]);
	});

	it.each(names)(
		"keeps configured %s demand and rendering independent for every consumer",
		(name) => {
			const key = `plugin.${name}`;
			const value = `VALUE-${name}`;
			const variables = { [name]: key };
			expect(normalizeTemplateVariables(variables, [])).toEqual(variables);
			const values = new Map([[key, value]]);
			const format = `($${name})`;
			for (const style of ["opencode", "opencode-copy-friendly", "minimalist"] as const) {
				const config = mergeConfig({
					components: {
						editor: {
							style,
							styles: {
								[style]: {
									metadataFormat: format,
									formats: {
										...Object.fromEntries(MINIMALIST_FORMAT_SLOTS.map((slot) => [slot, ""])),
										topLeft: format,
									},
									variables,
								},
							},
						},
						footer: {
							style: "starship",
							styles: { starship: { format, compactFormat: format, variables, responsive: false } },
						},
					},
				});
				expect(editorMetadataReferences(config).has(name)).toBe(true);
				expect(editorDemandsCustomVariable(config, key)).toBe(true);
				expect(editorDemandsCustomVariable(config, "unused")).toBe(false);
				expect(footerDemandsCustomVariable(config, key)).toBe(true);
				const rows =
					style === "minimalist"
						? renderMinimalistFrame({
								width: 100,
								editorLines: ["draft"],
								inputText: "draft",
								metadata: { cwd: "/repo", customVariables: values },
								uiTheme: theme,
								config,
							})
						: renderPolishedEditorFrame({
								width: 100,
								editorLines: ["draft"],
								uiTheme: theme,
								config,
								modelMeta: { modelLabel: "model", providerLabel: "test", customVariables: values },
							});
				expect(rows.join("\n")).toContain(value);
				expect(renderFooter(config, values)).toContain(value);
				const starship = config.components.footer.styles.starship;
				starship.format = "unused";
				expect(footerDemandsCustomVariable(config, key)).toBe(false);
				starship.responsive = true;
				expect(footerDemandsCustomVariable(config, key)).toBe(true);
				starship.format = `${"long ".repeat(40)}$${name}`;
				expect(renderFooter(config, values)).toContain(value);
				config.components.editor.enabled = false;
				expect(editorDemandsCustomVariable(config, key)).toBe(false);
				expect(footerDemandsCustomVariable(config, key)).toBe(true);
			}
		},
	);
});
