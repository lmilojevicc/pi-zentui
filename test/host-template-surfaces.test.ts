import { stripVTControlCharacters as plain } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { mergeConfig, type ZentuiConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import {
	HOST_TEMPLATE_VARIABLES,
	type HostTemplateValues,
} from "../extensions/zentui/host-template-values";
import { renderMinimalistFrame } from "../extensions/zentui/minimalist-editor";
import {
	MINIMALIST_FORMAT_SLOTS,
	type MinimalistFormats,
} from "../extensions/zentui/minimalist-template";
import { createInitialState } from "../extensions/zentui/state";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
const disposals: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
});
const emptySlots = Object.fromEntries(
	MINIMALIST_FORMAT_SLOTS.map((slot) => [slot, ""]),
) as MinimalistFormats;
const editorStyles = ["opencode", "opencode-copy-friendly", "minimalist"] as const;

function editorRows(
	style: (typeof editorStyles)[number],
	format: string,
	hostTemplateValues?: HostTemplateValues,
	variables: Record<string, string> = {},
	width = 160,
) {
	const config = mergeConfig({ components: { editor: { style } } });
	config.components.editor.styles[style].variables = variables;
	const customVariables = new Map([["pkg.shadow", "SHADOW"]]);
	if (style === "minimalist") {
		config.components.editor.styles.minimalist.formats = { ...emptySlots, topLeft: format };
		return renderMinimalistFrame({
			width,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", hostTemplateValues, customVariables },
			uiTheme: theme,
			config,
		});
	}
	config.components.editor.styles[style].metadataFormat = format;
	return renderPolishedEditorFrame({
		width,
		editorLines: ["draft"],
		uiTheme: theme,
		config,
		modelMeta: { modelLabel: "", providerLabel: "", hostTemplateValues, customVariables },
	});
}

function footerHarness(
	config: ZentuiConfig,
	getHostTemplateValues?: (names: ReadonlySet<string>) => HostTemplateValues | undefined,
	customVariables: ReadonlyMap<string, string> = new Map(),
) {
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	installFooter(
		{
			cwd: "/repo",
			getContextUsage: () => undefined,
			sessionManager: { getSessionName: () => undefined },
			ui: {
				setFooter(value: typeof factory) {
					factory = value;
				},
			},
		} as unknown as ExtensionContext,
		createInitialState(emptyGitStatus()),
		() => config,
		{
			setRequestRender() {},
			scheduleProjectRefresh() {},
			getHostTemplateValues,
			getCustomVariables: () => customVariables,
		},
	);
	const footer = factory?.({ requestRender() {} } as never, theme, {
		onBranchChange: () => () => {},
		getExtensionStatuses: () => new Map(),
	} as never);
	if (!footer) throw new Error("footer was not installed");
	disposals.push(() => footer.dispose?.());
	return (width = 160) => footer.render(width);
}

function footerConfig(format: string, compactFormat = "") {
	const config = mergeConfig({ components: { footer: { style: "starship" } } });
	Object.assign(config.components.footer.styles.starship, {
		format,
		compactFormat,
		responsive: Boolean(compactFormat),
	});
	return config;
}

const unsafeValue =
	"\x1b[31mSAFE\x1b[0m\x1b[2J\x1b]8;;https://evil.invalid\x07LINK\x1b]8;;\x07\u009b2J\u009d0;SECRET\u009c\n\tTEXT\x07";

describe("explicit host template builtins", () => {
	it.each(HOST_TEMPLATE_VARIABLES)("renders %s through each editor and Footer format", (name) => {
		const hostValues = { [name]: "HOST-VALUE" };
		const format = `(host: $${name})`;
		for (const style of editorStyles) {
			expect(plain(editorRows(style, format, hostValues).join("\n"))).toContain("host: HOST-VALUE");
			expect(plain(editorRows(style, format).join("\n"))).not.toContain("host:");
		}
		const config = footerConfig(format, `compact: \${${name}}`);
		const render = footerHarness(config, () => hostValues);
		expect(plain(render().join("\n")).trim()).toBe("host: HOST-VALUE");
		config.components.footer.styles.starship.format = `${"wide".repeat(60)}${format}`;
		expect(plain(render(32).join("\n")).trim()).toBe("compact: HOST-VALUE");
	});

	it("renders a PR URL as ordinary safe text without generating terminal hyperlinks", () => {
		const prUrl = "https://github.com/example/repo/pull/42";
		for (const style of editorStyles) {
			const rows = editorRows(style, "$pr_url", { pr_url: prUrl });
			expect(plain(rows.join("\n"))).toContain(prUrl);
			expect(rows.join("\n")).not.toContain("\x1b]8;");
		}
		const rows = footerHarness(footerConfig("$pr_url"), () => ({ pr_url: prUrl }))();
		expect(plain(rows.join("\n")).trim()).toBe(prUrl);
		expect(rows.join("\n")).not.toContain("\x1b]8;");
	});

	it.each(editorStyles)(
		"omits missing conditional labels and sanitizes host strings in %s",
		(style) => {
			const format = "BASE( / $pr_number)( / $pr_url)( / $plan_mode)( / $goal_mode)";
			expect(plain(editorRows(style, format).join("\n"))).toContain("BASE");
			expect(plain(editorRows(style, format).join("\n"))).not.toContain("/");
			const rows = editorRows(style, format, { pr_url: unsafeValue, goal_mode: "\x1b[2J" });
			expect(plain(rows.join("\n"))).toContain("BASE / SAFELINK TEXT");
			expect(rows.join("\n")).not.toContain("\x1b[2J");
			expect(rows.join("\n")).not.toContain("\x1b]8;");
			expect(plain(rows.join("\n"))).not.toContain("evil.invalid");
		},
	);

	it("sanitizes Footer wide, compact and narrow layouts and hides unavailable groups", () => {
		let values: HostTemplateValues | undefined;
		const format = "BASE( / $pr_url)( / $plan_mode)( / $goal_mode)";
		const config = footerConfig(format, format);
		const render = footerHarness(config, () => values);
		expect(plain(render().join("\n")).trim()).toBe("BASE");
		values = { pr_url: unsafeValue, goal_mode: "\x1b[2J" };
		expect(plain(render().join("\n")).trim()).toBe("BASE / SAFELINK TEXT");
		config.components.footer.styles.starship.format = "wide".repeat(60);
		expect(plain(render(32).join("\n")).trim()).toBe("BASE / SAFELINK TEXT");
		for (const width of [0, 1, 2, 5, 10, 16, 24]) {
			const rows = render(width);
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			expect(rows.join("\n")).not.toContain("\x1b[2J");
			expect(rows.join("\n")).not.toContain("\x1b]8;");
			expect(plain(rows.join("\n"))).not.toMatch(/evil\.invalid|plan_mode|goal_mode/);
		}
	});

	it("rejects reserved aliases during normalization and preserves builtin precedence at rendering", () => {
		const reserved = Object.fromEntries(
			HOST_TEMPLATE_VARIABLES.map((name) => [name, "pkg.shadow"]),
		);
		const variables = { ...reserved, build: "pkg.build" };
		const config = mergeConfig({
			components: {
				editor: {
					styles: {
						opencode: { variables },
						"opencode-copy-friendly": { variables },
						minimalist: { variables },
					},
				},
				footer: { styles: { starship: { variables } } },
			},
		});
		for (const style of editorStyles)
			expect(config.components.editor.styles[style].variables).toEqual({ build: "pkg.build" });
		expect(config.components.footer.styles.starship.variables).toEqual({ build: "pkg.build" });
		for (const name of HOST_TEMPLATE_VARIABLES) {
			for (const style of editorStyles) {
				const rows = editorRows(style, `$${name}`, { [name]: "HOST" }, reserved);
				expect(plain(rows.join("\n"))).toContain("HOST");
				expect(plain(rows.join("\n"))).not.toContain("SHADOW");
			}
		}
		const footer = footerConfig("$session_id( / $plan_mode)");
		footer.components.footer.styles.starship.variables = reserved;
		const renderFooter = footerHarness(
			footer,
			() => ({ session_id: "HOST" }),
			new Map([["pkg.shadow", "SHADOW"]]),
		);
		expect(plain(renderFooter().join("\n")).trim()).toBe("HOST");
	});

	it("keeps host values stable when atomic custom content forces recomposition", () => {
		const config = footerConfig("$session_id( / $build)");
		config.components.footer.styles.starship.variables = { build: "pkg.build" };
		let sessionId = "FIRST";
		const render = footerHarness(
			config,
			() => {
				const result = { session_id: sessionId };
				sessionId = "NEXT";
				return result;
			},
			new Map([["pkg.build", "X".repeat(80)]]),
		);
		expect(plain(render(20).join("\n")).trim()).toBe("FIRST");
		expect(plain(render(20).join("\n")).trim()).toBe("NEXT");
	});

	it("requests only referenced host values and leaves demand-free rendering producer-independent", () => {
		const config = footerConfig("$session_id", "compact: $plan_mode");
		const render = footerHarness(config, (names) => {
			const permitted = ["plan_mode", "session_id"];
			if ([...names].some((name) => !permitted.includes(name)))
				throw new Error("unreferenced host demand");
			return {
				session_id: names.has("session_id") ? "SESSION" : undefined,
				plan_mode: names.has("plan_mode") ? "PLAN" : undefined,
			};
		});
		expect(plain(render().join("\n")).trim()).toBe("SESSION");
		config.components.footer.styles.starship.format = "wide".repeat(60);
		expect(plain(render(32).join("\n")).trim()).toBe("compact: PLAN");
		config.components.footer.styles.starship.responsive = false;
		config.components.footer.styles.starship.format = "LITERAL";
		const demandFree = footerHarness(config, () => {
			throw new Error("unexpected host demand");
		});
		expect(plain(demandFree().join("\n")).trim()).toBe("LITERAL");
	});
});

it("joins missing/supplied OMP host fields on every shared surface and regenerates Footer probes", () => {
	const format = "$session_id$join_sep$plan_mode$join_sep$pr_number";
	for (const hostValues of [
		undefined,
		{ session_id: "S" },
		{ pr_number: "42" },
		{ session_id: "S", pr_number: "42" },
		{ session_id: "S", plan_mode: "PLAN", pr_number: "42" },
	]) {
		const fields = [hostValues?.session_id, hostValues?.plan_mode, hostValues?.pr_number].filter(
			Boolean,
		);
		for (const style of editorStyles) {
			const output = plain(editorRows(style, format, hostValues).join("\n"));
			if (fields.length)
				expect(output).toContain(fields.join(style === "minimalist" ? " – " : " · "));
			else expect(output).not.toMatch(/[·–]/);
		}
		const config = footerConfig(format, format);
		const render = footerHarness(config, () => hostValues);
		expect(plain(render().join("\n")).trim()).toBe(fields.join(" | "));
		config.components.footer.styles.starship.format = "wide".repeat(60);
		expect(plain(render(32).join("\n")).trim()).toBe(fields.join(" | "));
	}
	const joinedCustom = "$session_id$join_sep$build$join_sep$pr_number";
	const config = footerConfig(joinedCustom, joinedCustom);
	config.components.footer.styles.starship.variables = { build: "pkg.build" };
	const render = footerHarness(
		config,
		() => ({ session_id: "S", pr_number: "42" }),
		new Map([["pkg.build", "X".repeat(80)]]),
	);
	expect(plain(render(20).join("\n")).trim()).toBe("S | 42");
	config.components.footer.styles.starship.format = "wide".repeat(60);
	expect(plain(render(20).join("\n")).trim()).toBe("S | 42");
});
