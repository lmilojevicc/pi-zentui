import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

describe("footer status hyperlinks", () => {
	it.each([20, 40, 80, 160])("preserves a linked status at %i columns", (width) => {
		let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
		const ctx = {
			cwd: "/repo",
			getContextUsage: () => undefined,
			sessionManager: { getSessionName: () => undefined },
			ui: {
				setFooter(value: typeof factory) {
					factory = value;
				},
			},
		} as unknown as ExtensionContext;
		const config = structuredClone(defaultConfig);
		const style = config.components.footer.styles.starship;
		style.format = "demo$fill";
		style.compactFormat = "$extensions";
		style.extensionStatuses.colorModes.pr = "original";
		const url = "https://example.com/pull/123";
		const linked = `\x1b]8;;${url}\x07PR #123\x1b]8;;\x07 | pending`;
		installFooter(ctx, createInitialState(emptyGitStatus()), () => config, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = factory?.(
			{ requestRender() {} } as never,
			{ fg: (_color: string, text: string) => text } as Theme,
			{
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map([["pr", linked]]),
			} as never,
		);
		const lines = footer?.render(width) ?? [];
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		expect(lines.join("\n")).toContain(`\x1b]8;;${url}\x07PR #123\x1b]8;;\x07`);
		footer?.dispose?.();
	});
});
