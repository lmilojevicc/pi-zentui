import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

function harness(compact: boolean) {
	const config = mergeConfig({
		components: {
			footer: {
				colorSource: "theme",
				colors: { contextNormal: "success", contextWarning: "warning", contextError: "error" },
				styles: {
					starship: {
						format: compact ? "wide ".repeat(30) : "$auto_compaction",
						compactFormat: "$auto_compaction",
						responsive: compact,
					},
				},
			},
		},
	});
	const state = createInitialState(emptyGitStatus());
	state.autoCompaction = true;
	let percent: number | null = 95;
	let live: { tokens: number } | undefined;
	const getContextUsage = vi.fn(() => ({ percent, tokens: percent, contextWindow: 100 }));
	const fg = vi.fn((color: string, text: string) => {
		const code = color === "error" ? 31 : color === "warning" ? 33 : 32;
		return `\x1b[${code}m${text}\x1b[39m`;
	});
	const getConfig = vi.fn(() => config);
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	installFooter(
		{
			cwd: "/repo",
			model: { provider: "openai-codex", contextWindow: 100 },
			sessionManager: { getSessionName: () => "" },
			getContextUsage,
			ui: {
				setFooter(value: typeof factory) {
					factory = value;
				},
			},
		} as unknown as ExtensionContext,
		state,
		getConfig,
		{
			setRequestRender() {},
			scheduleProjectRefresh() {},
			getLiveContext: () => live,
			getCodexQuota: () => ({ fiveHour: 80, week: 60 }),
		},
	);
	const footer = factory?.(
		{ requestRender() {} } as never,
		{ fg } as unknown as Theme,
		{
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map(),
		} as never,
	);
	if (!footer) throw new Error("footer missing");
	return {
		config,
		state,
		footer,
		getContextUsage,
		getConfig,
		fg,
		setPercent(value: number | null) {
			percent = value;
		},
		setLive(tokens: number) {
			live = { tokens };
		},
	};
}

it.each([
	{ prefix: "", width: 12 },
	{ prefix: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", width: 100 },
])(
	"reuses auto-compaction context color through quota fallback ($width columns)",
	({ prefix, width }) => {
		const h = harness(false);
		try {
			h.config.components.footer.codexQuota = true;
			h.config.components.footer.styles.starship.format = `${prefix}$auto_compaction$fill$codex_quota`;
			const rows = h.footer.render(width).join("");
			expect(rows).toContain("\x1b[31m(auto)\x1b[39m");
			expect(rows).not.toContain("5h");
			expect(h.getConfig).toHaveBeenCalledTimes(2);
			expect(h.getContextUsage).toHaveBeenCalledTimes(1);
		} finally {
			h.footer.dispose?.();
		}
	},
);

describe.each([false, true])("auto-compaction context color (compact=%s)", (compact) => {
	it("resolves one fresh context snapshot for enabled standalone warning/error labels", () => {
		const h = harness(compact);
		try {
			for (const [percent, color, code] of [
				[95, "error", 31],
				[75, "warning", 33],
				[10, "success", 32],
				[null, "success", 32],
			] as const) {
				h.setPercent(percent);
				h.getContextUsage.mockClear();
				h.fg.mockClear();
				expect(h.footer.render(40).join("")).toContain(`\x1b[${code}m(auto)\x1b[39m`);
				expect(h.fg).toHaveBeenCalledWith(color, "(auto)");
				expect(h.getContextUsage).toHaveBeenCalledTimes(1);
			}
			h.setLive(95);
			h.getContextUsage.mockClear();
			expect(h.footer.render(40).join("")).toContain("\x1b[31m(auto)\x1b[39m");
			expect(h.getContextUsage).not.toHaveBeenCalled();
		} finally {
			h.footer.dispose?.();
		}
	});

	it("does not estimate context for disabled or absent auto-compaction labels", () => {
		const h = harness(compact);
		try {
			h.state.autoCompaction = false;
			expect(h.footer.render(40).join("")).not.toContain("(auto)");
			expect(h.getContextUsage).not.toHaveBeenCalled();
			h.state.autoCompaction = true;
			const starship = h.config.components.footer.styles.starship;
			starship.format = "$tokens";
			starship.compactFormat = "$tokens";
			expect(h.footer.render(40).join("")).not.toContain("(auto)");
			expect(h.getContextUsage).not.toHaveBeenCalled();
			starship.compactFormat = "$auto_compaction";
			starship.responsive = false;
			expect(h.footer.render(40).join("")).not.toContain("(auto)");
			expect(h.getContextUsage).not.toHaveBeenCalled();
		} finally {
			h.footer.dispose?.();
		}
	});
});
