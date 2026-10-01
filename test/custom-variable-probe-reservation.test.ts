import { stripVTControlCharacters as plain } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
} as unknown as Theme;
const key = "@scope/quota";

function fixture(format: string, compact = false, value = "X") {
	const config = mergeConfig({
		components: {
			footer: {
				style: "starship",
				styles: {
					starship: {
						format: compact ? "force compact ".repeat(50) : format,
						compactFormat: format,
						responsive: compact,
						compactMaxLines: 2,
						variables: { quota: key },
					},
				},
			},
		},
	});
	const getSessionName = vi.fn(() => "\ue000");
	const getThinkingLevel = vi.fn(() => "\ue001");
	const getRepositoryRoot = vi.fn(() => "/tmp");
	const getContextUsage = vi.fn(() => null);
	const getCodexQuota = vi.fn(() => undefined);
	let component: { render(width: number): string[] } | undefined;
	installFooter(
		{
			cwd: "/tmp/project",
			model: { provider: "test" },
			getContextUsage,
			sessionManager: { getSessionName },
			ui: {
				setFooter(factory: (...args: never[]) => typeof component) {
					component = factory(
						{ requestRender() {} } as never,
						theme as never,
						{
							getExtensionStatuses: () => new Map([["plugin", "STATUS"]]),
							onBranchChange: () => () => {},
						} as never,
					);
				},
			},
		} as never,
		createInitialState(emptyGitStatus()),
		() => config,
		{
			setRequestRender() {},
			scheduleProjectRefresh() {},
			getThinkingLevel,
			getRepositoryRoot,
			getCodexQuota,
			getCustomVariables: () => new Map([[key, value]]),
		},
	);
	return {
		config,
		getSessionName,
		getThinkingLevel,
		getRepositoryRoot,
		getContextUsage,
		getCodexQuota,
		render(width: number) {
			if (!component) throw new Error("missing footer");
			return component.render(width);
		},
	};
}

describe("Footer custom probe reservation", () => {
	it.each(["session_name", "thinkingLevel"])("does not replace $%s with an alias", (name) => {
		const f = fixture(`$${name} $quota`);
		f.getThinkingLevel.mockReturnValue("\ue000");
		expect(plain(f.render(40).join("\n"))).toContain("\ue000 X");
	});

	it.each([false, true])("preserves dynamic builtin glyphs (compact=%s)", (compact) => {
		const f = fixture("$session_name $thinkingLevel $quota", compact);
		f.getThinkingLevel.mockReturnValue("\ue000");
		const rows = f.render(40);
		expect(plain(rows.join("\n"))).toContain("\ue000 \ue000 X");
		expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true);
	});

	it("reserves distinct referenced builtin glyphs", () => {
		const f = fixture("($session_name $thinkingLevel $quota)");
		expect(plain(f.render(40).join("\n"))).toContain("\ue000 \ue001 X");
	});

	it("snapshots repeated thinking references without evaluating unrelated callbacks", () => {
		const f = fixture("($thinkingLevel $thinkingLevel $quota)");
		f.getThinkingLevel.mockReturnValueOnce("\ue000").mockReturnValue("changed");
		expect(plain(f.render(80).join("\n"))).toContain("\ue000 \ue000 X");
		expect(f.getThinkingLevel).toHaveBeenCalledTimes(1);
		expect(f.getSessionName).not.toHaveBeenCalled();
		expect(f.getRepositoryRoot).not.toHaveBeenCalled();
		expect(f.getContextUsage).not.toHaveBeenCalled();
		expect(f.getCodexQuota).not.toHaveBeenCalled();
	});

	it("reuses builtin snapshots when a partial custom value triggers fallback", () => {
		const f = fixture("$session_name $thinkingLevel $quota", false, "too long to fit");
		f.getSessionName.mockReturnValueOnce("\ue000").mockReturnValue("changed");
		f.getThinkingLevel.mockReturnValueOnce("\ue001").mockReturnValue("changed");
		expect(plain(f.render(8).join("\n"))).toContain("\ue000 \ue001");
		expect(f.getSessionName).toHaveBeenCalledTimes(1);
		expect(f.getThinkingLevel).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])(
		"keeps styled aliases atomic across bounded widths (compact=%s)",
		(compact) => {
			const raw = "\x1b[31mXX\x1b]8;;https://example.com\x07 link\x1b]8;;\x07\x1b[0m";
			const f = fixture("$session_name $thinkingLevel $quota", compact, raw);
			for (let width = 1; width <= 60; width++) {
				const rows = f.render(width);
				const text = plain(rows.join("\n"));
				expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
				expect(text).not.toMatch(/[\ue002-\uf8ff]/);
				if (text.includes("XX")) expect(text).toContain("XX link");
			}
			const wide = f.render(80).join("\n");
			expect(wide).toContain("\x1b[31m");
			expect(wide).toContain("https://example.com");
		},
	);
});
