import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

type FooterFactory = (
	tui: { requestRender(): void },
	theme: Theme,
	data: {
		onBranchChange(callback: () => void): () => void;
		getExtensionStatuses(): Map<string, string>;
	},
) => { render(width: number): string[] };

function theme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
}

describe("Footer repository path rendering", () => {
	it("uses the same repository cwd in built-in, custom, and final responsive fallback output", () => {
		let footerFactory: FooterFactory | undefined;
		const cwd = "/repo/extensions/zentui";
		const context = {
			cwd,
			model: { contextWindow: 100_000 },
			getContextUsage: () => ({ percent: 10, tokens: 10_000, contextWindow: 100_000 }),
			sessionManager: { getSessionName: () => undefined },
			ui: {
				setFooter(factory: FooterFactory | undefined) {
					footerFactory = factory;
				},
			},
		};
		const config = structuredClone(defaultConfig);
		config.icons.cwd = "";
		config.components.footer.styles.starship.pathDisplay = {
			mode: "repository",
			depth: 0,
		};
		const render = (width: number) => {
			installFooter(context as never, createInitialState(emptyGitStatus()), () => config, {
				setRequestRender() {},
				scheduleProjectRefresh() {},
				getRepositoryRoot: () => "/repo",
			});
			const footer = footerFactory?.({ requestRender() {} }, theme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			});
			return footer?.render(width).join("\n") ?? "";
		};

		const starship = config.components.footer.styles.starship;
		starship.responsive = false;
		starship.format = "";
		const builtIn = render(160);
		expect(builtIn).toMatch(/(?:^|\s)extensions\/zentui(?:\s|$)/);
		expect(builtIn).not.toContain("/repo/extensions/zentui");

		starship.format = "$cwd";
		const custom = render(160);
		expect(custom.trim()).toBe("extensions/zentui");
		expect(custom).not.toContain("/repo/extensions/zentui");

		starship.responsive = true;
		starship.format = "X".repeat(100);
		starship.compactFormat = "$cwd";
		const compact = render(50);
		expect(compact.trim()).toBe("extensions/zentui");
		expect(compact).not.toContain("/repo/extensions/zentui");
	});

	it("only asks for a repository root in repository mode", () => {
		let footerFactory: FooterFactory | undefined;
		const config = structuredClone(defaultConfig);
		config.icons.cwd = "";
		const getRepositoryRoot = vi.fn(() => "/repo");
		installFooter(
			{
				cwd: "/repo/extensions/zentui",
				model: { contextWindow: 100_000 },
				getContextUsage: () => ({ percent: 10, tokens: 10_000, contextWindow: 100_000 }),
				sessionManager: { getSessionName: () => undefined },
				ui: {
					setFooter(factory: FooterFactory | undefined) {
						footerFactory = factory;
					},
				},
			} as never,
			createInitialState(emptyGitStatus()),
			() => config,
			{
				setRequestRender() {},
				scheduleProjectRefresh() {},
				getRepositoryRoot,
			},
		);
		const footer = footerFactory?.({ requestRender() {} }, theme(), {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map(),
		});

		config.components.footer.styles.starship.pathDisplay.mode = "basename";
		footer?.render(160);
		config.components.footer.styles.starship.pathDisplay.mode = "full";
		footer?.render(160);
		expect(getRepositoryRoot).not.toHaveBeenCalled();

		config.components.footer.styles.starship.pathDisplay.mode = "repository";
		footer?.render(160);
		expect(getRepositoryRoot).toHaveBeenCalledTimes(1);
		expect(getRepositoryRoot).toHaveBeenCalledWith("/repo/extensions/zentui");
	});
});
