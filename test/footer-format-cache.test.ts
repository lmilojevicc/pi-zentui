import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import {
	collectFooterFormatReferences,
	compileCompactFormatSplit,
	compiledFooterFormat,
	parseFooterFormat,
	renderFormatTokens,
} from "../extensions/zentui/footer-format";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

afterEach(() => vi.restoreAllMocks());

describe("bounded immutable footer syntax", () => {
	it("reuses compact boundary compilation across 100 lookups and alias edits", () => {
		const format = "  CACHE-COMPACT-LITERAL  $directory $wrap $tokens";
		const replace = String.prototype.replace;
		let boundaryTrims = 0;
		vi.spyOn(String.prototype, "replace").mockImplementation(function (
			this: string,
			search: unknown,
			replacement: unknown,
		) {
			if (
				String(this) === "  CACHE-COMPACT-LITERAL  " &&
				search instanceof RegExp &&
				search.source === "^\\s+"
			)
				boundaryTrims += 1;
			return Reflect.apply(replace, this, [search, replacement]);
		});
		const aliases = { directory: "cwd" };
		const first = compiledFooterFormat(format, aliases);
		for (let i = 0; i < 100; i++) expect(compiledFooterFormat(format, aliases)).toBe(first);
		expect(boundaryTrims).toBe(1);
		aliases.directory = "git_branch";
		const changed = compiledFooterFormat(format, aliases);
		expect(changed.tokens).toBe(first.tokens);
		expect(changed.references).toEqual(["git_branch", "tokens"]);
		expect(changed.compact.left[0]?.references).toEqual(["git_branch"]);
		expect(boundaryTrims).toBe(1);
	});

	it("deep freezes shared trees, chunks and references without changing mutable public helpers", () => {
		const format = "freeze-test ($cwd($sep$tokens)) $fill $extensions $wrap_sep $cost";
		const compiled = compiledFooterFormat(format);
		const assertFrozen = (value: unknown) => {
			if (!value || typeof value !== "object") return;
			expect(Object.isFrozen(value)).toBe(true);
			for (const child of Object.values(value)) assertFrozen(child);
		};
		assertFrozen(compiled);
		expect(() => Reflect.set(compiled.tokens[0] as object, "value", "corrupt")).not.toThrow();
		expect(Reflect.set(compiled.tokens[0] as object, "value", "corrupt")).toBe(false);
		const publicTokens = parseFooterFormat(format);
		const publicCompact = compileCompactFormatSplit(publicTokens);
		publicTokens.push({ kind: "var", name: "new_var" });
		publicCompact.left.splice(0);
		const refs = collectFooterFormatReferences(publicTokens);
		refs.clear();
		expect(compiledFooterFormat(format)).toBe(compiled);
		expect(compiled.references).toEqual(["cwd", "sep", "tokens", "cost"]);
		expect(renderFormatTokens(compiled.tokens, (name) => name)).not.toContain("new_var");
		expect(compiled.compact.left.length).toBeGreaterThan(0);
	});

	it("observes alias additions, removals, structural names and inherited values immediately", () => {
		const format = "alias-test $directory $wrap $extensions";
		const aliases: Record<string, string> = { directory: "cwd" };
		expect(compiledFooterFormat(format, aliases).references).toEqual(["cwd"]);
		aliases.wrap = "tokens";
		aliases.extensions = "cost";
		expect(compiledFooterFormat(format, aliases).references).toEqual(["cwd", "tokens", "cost"]);
		delete aliases.directory;
		expect(compiledFooterFormat(format, aliases).references).toEqual([
			"directory",
			"tokens",
			"cost",
		]);
		const inherited = Object.create({ directory: "git_branch" });
		expect(compiledFooterFormat(format, inherited).references).toEqual(["git_branch"]);
	});

	it("evicts least-recently-used syntax after 32 entries, retaining no unbounded alias variants", () => {
		const first = compiledFooterFormat("eviction-first $cwd");
		for (let i = 0; i < 31; i++) compiledFooterFormat(`eviction-${i} $cwd`);
		expect(compiledFooterFormat("eviction-first $cwd")).toBe(first);
		for (let i = 31; i < 63; i++) compiledFooterFormat(`eviction-${i} $cwd`);
		expect(compiledFooterFormat("eviction-first $cwd")).not.toBe(first);
		const aliases = { cwd: "tokens" };
		const variant = compiledFooterFormat("variant $cwd", aliases);
		aliases.cwd = "cost";
		compiledFooterFormat("variant $cwd", aliases);
		aliases.cwd = "tokens";
		expect(compiledFooterFormat("variant $cwd", aliases)).not.toBe(variant);
	});
});

it("keeps live theme, statuses, widths and in-place format edits outside cached syntax", () => {
	const config = structuredClone(defaultConfig);
	const starship = config.components.footer.styles.starship;
	starship.format = "live-wide $tokens $fill $extensions";
	starship.compactFormat = "live-compact $tokens $wrap $extensions";
	starship.extensionStatuses.colorModes.pr = "original";
	config.components.footer.colorSource = "theme";
	const state = createInitialState(emptyGitStatus());
	state.tokenLabel = "123";
	const statuses = new Map([["pr", "ready"]]);
	let color = "31";
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
		state,
		() => config,
		{
			setRequestRender() {},
			scheduleProjectRefresh() {},
		},
	);
	const footer = factory?.(
		{ requestRender() {} } as never,
		{
			fg: (_: string, text: string) => `\x1b[${color}m${text}\x1b[0m`,
		} as Theme,
		{ onBranchChange: () => () => {}, getExtensionStatuses: () => statuses } as never,
	);
	if (!footer) throw new Error("footer missing");
	try {
		const initial = footer.render(160).join("");
		expect(initial).toContain("\x1b[31m");
		expect(initial).toContain("123");
		expect(initial).toContain("ready");
		color = "32";
		state.tokenLabel = "456";
		statuses.set("pr", "\x1b]8;;https://example.com\x07linked\x1b]8;;\x07");
		const updated = footer.render(160).join("");
		expect(updated).toContain("\x1b[32m");
		expect(updated).not.toContain("\x1b[31m");
		expect(updated).toContain("456");
		expect(updated).toContain("https://example.com");
		expect(updated).not.toContain("ready");
		for (const width of [1, 8, 20, 40, 160]) {
			expect(footer.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		starship.format = `${"long ".repeat(40)}$tokens`;
		starship.compactFormat = "edited-compact $tokens";
		expect(footer.render(30).join("")).toContain("edited-compact");
		starship.format = "edited-wide $tokens";
		expect(footer.render(160).join("")).toContain("edited-wide");
	} finally {
		footer.dispose?.();
	}
});
