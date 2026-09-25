import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

const wideFormat =
	"$cwd( in $session_name)( on $git_branch)( $git_status)( $git_state)( via $runtime)$fill$model($sep$provider)($sep$thinkingLevel)($sep$context)( $auto_compaction)($sep$tokens)( $cache_read)( $cache_write)($sep$cost)( $subscription)";
const compactFormat =
	"$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$fill$model$wrap_sep($provider)$wrap_sep($thinkingLevel)$wrap_sep$context$wrap_sep$tokens";
const disposals: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
});

function createFooter(cwd: string, sessionName?: string) {
	const config = structuredClone(defaultConfig);
	const starship = config.components.footer.styles.starship;
	Object.assign(starship, {
		format: wideFormat,
		compactFormat,
		responsive: true,
		compactMaxLines: 2,
		pathDisplay: { mode: "full", depth: 0 },
	});
	const state = createInitialState(emptyGitStatus());
	Object.assign(state, {
		modelId: "gpt-6-astra",
		providerLabel: "OpenAI",
		branch: "feat/footer-thinking-level",
		tokenLabel: "↑1.2k ↓300",
		runtime: { name: "node", symbol: "", version: "v26.9.0", style: "green" },
	});
	let level = "high";
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	installFooter(
		{
			cwd,
			getContextUsage: () => ({ percent: 12.5, tokens: 12500, contextWindow: 100000 }),
			sessionManager: { getSessionName: () => sessionName },
			ui: {
				setFooter(value: typeof factory) {
					factory = value;
				},
			},
		} as unknown as ExtensionContext,
		state,
		() => config,
		{ setRequestRender() {}, scheduleProjectRefresh() {}, getThinkingLevel: () => level },
	);
	const footer = factory?.(
		{ requestRender() {} } as never,
		{ fg: (_color: string, text: string) => text } as Theme,
		{ onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() } as never,
	);
	if (!footer) throw new Error("footer not installed");
	disposals.push(() => footer.dispose?.());
	return {
		starship,
		state,
		setLevel(value: string) {
			level = value;
		},
		render(width: number) {
			const raw = footer.render(width);
			expect(raw.length).toBeLessThanOrEqual(2);
			expect(raw.every((row) => visibleWidth(row) <= width)).toBe(true);
			return raw.map(stripVTControlCharacters);
		},
	};
}

const actualPath = `${homedir()}/Worktrees/zentui/feat/footer-thinking-level`;
describe("footer fill alignment integration", () => {
	it.each([
		[actualPath, undefined],
		[`/projects/${"very-long-project/".repeat(12)}`, undefined],
		[`/projects/${"very-long-project/".repeat(12)}`, "named session with extended project details"],
	] as const)("keeps live metadata right-aligned at every width (%s, %s)", (cwd, name) => {
		const footer = createFooter(cwd, name);
		for (const level of ["high", "low", "off"]) {
			footer.setLevel(level);
			for (const width of [109, 80, 40, 20]) {
				const rows = footer.render(width);
				const text = rows.join("\n");
				expect(text).toContain("gpt-6-astra");
				expect(text).toContain("OpenAI");
				if (level === "off") expect(text).not.toMatch(/\b(high|low|off)\b/);
				else expect(text).toContain(level);
				for (const row of rows) {
					expect(row.trim()).not.toMatch(/^\||\|$/);
					expect(row).not.toMatch(/\|\s*\|/);
					if (/gpt-6-astra|OpenAI/.test(row)) {
						expect(visibleWidth(row.trimEnd())).toBe(width - 1);
						expect(row.endsWith(" ")).toBe(true);
					}
				}
				if (width >= 80) {
					expect(text).toContain("12.5%");
					expect(text).toContain("↑1.2k ↓300");
				} else expect(text).toContain("…");
			}
		}
	});
	it("exercises single-line wide, actual-path reflow, and forced compact", () => {
		const footer = createFooter(actualPath);
		const wide = footer.render(240);
		expect(wide).toHaveLength(1);
		expect(wide[0]?.indexOf("~/Worktrees")).toBeLessThan(wide[0]?.indexOf("gpt-6-astra") ?? 0);
		expect(visibleWidth(wide[0]?.trimEnd() ?? "")).toBe(239);
		const reflow = footer.render(109);
		expect(reflow).toHaveLength(2);
		expect(reflow[0]).toContain("~/Worktrees/zentui/feat/footer-thinking-level");
		expect(reflow[0]).not.toContain("gpt-6-astra");
		expect(reflow[1]).toContain("gpt-6-astra");
		expect(visibleWidth(reflow[1]?.trimEnd() ?? "")).toBe(108);
		footer.starship.format = "force-compact".repeat(40);
		const compact = footer.render(109);
		expect(compact[0]).toContain("~/Worktrees");
		expect(compact[0]).toContain("gpt-6-astra");
	});
	it("bounds long sanitized metadata without promising impossible visibility", () => {
		const footer = createFooter(actualPath);
		footer.state.modelId = `\u001b[31m${"界model".repeat(30)}\n\t\u0007`;
		footer.state.providerLabel = "provider".repeat(30);
		for (const width of [0, 1, 2, 5, 20, 40, 80, 109]) {
			const text = footer.render(width).join("\n");
			expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
		}
	});
});
