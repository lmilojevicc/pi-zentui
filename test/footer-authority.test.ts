import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

it("keeps explicit template authority when resizing from disabled built-in cwd/enabled cost to compact", () => {
	const config = structuredClone(defaultConfig);
	const starship = config.components.footer.styles.starship;
	starship.format = "";
	starship.responsive = true;
	starship.segments.cwd = false;
	starship.segments.cost = true;
	const templates = [starship.format, starship.compactFormat];
	const state = createInitialState(emptyGitStatus());
	state.branch = "a-very-long-branch-forcing-compact-fallback";
	state.costLabel = "$12.34";
	state.tokenLabel = "123456 input / 98765 output";
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	installFooter(
		{
			cwd: "/repo/CWD",
			getContextUsage: () => ({ percent: 12, contextWindow: 200000 }),
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
		{ fg: (_color: string, text: string) => text } as Theme,
		{ onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() } as never,
	);
	expect(footer).toBeDefined();
	const render = (width: number) => {
		const rows = footer?.render(width) ?? [];
		expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
		return stripVTControlCharacters(rows.join("\n"));
	};
	try {
		const wide = render(200);
		expect(wide).not.toContain("CWD");
		expect(wide).toContain("$12.34");
		// The unchanged default compact template includes $cwd but not $cost.
		const compact = render(24);
		expect(compact).toContain("CWD");
		expect(compact).not.toContain("$12.34");
		expect(render(200)).toBe(wide);
		expect([starship.format, starship.compactFormat]).toEqual(templates);
		starship.format = "$cwd";
		expect(render(200)).toContain("CWD");
		expect(render(200)).not.toContain("$12.34");
		expect(starship.segments).toMatchObject({ cwd: false, cost: true });
	} finally {
		footer?.dispose?.();
	}
});
