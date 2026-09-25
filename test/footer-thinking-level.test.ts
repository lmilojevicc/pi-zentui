import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

const disposals: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
});

function createFooter(getThinkingLevel?: () => string | undefined) {
	const config = structuredClone(defaultConfig);
	const starship = config.components.footer.styles.starship;
	starship.format = "$model $provider( $thinkingLevel)";
	starship.segments.modelInfo = false;
	const state = createInitialState(emptyGitStatus());
	state.modelId = "test-model";
	state.providerLabel = "Test";
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
			getThinkingLevel,
		},
	);
	const footer = factory?.(
		{ requestRender() {} } as never,
		{ fg: (_color: string, text: string) => text } as Theme,
		{ onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() } as never,
	);
	if (!footer) throw new Error("footer was not installed");
	disposals.push(() => footer.dispose?.());
	return {
		starship,
		state,
		render(width = 160) {
			const rows = footer.render(width);
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			return stripVTControlCharacters(rows.join("\n")).trim();
		},
	};
}

describe("footer thinking level", () => {
	it.each(["minimal", "low", "medium", "high", "xhigh", "future-level"])(
		"renders active level %s without requiring model capability metadata",
		(level) => {
			const footer = createFooter(() => level);
			expect(footer.render()).toBe(`test-model Test ${level}`);
			footer.state.modelId = "";
			expect(footer.render()).toBe(`no-model Test ${level}`);
		},
	);

	it.each([undefined, "", "off", "OFF", "Off", " \t\n", "\u001b[31mOFF\u001b[0m"])(
		"omits inactive level %j and conditional labels/separators",
		(level) => {
			const footer = createFooter(() => level);
			footer.starship.format = "$model($sep thinking: $" + "{thinkingLevel})";
			expect(footer.render()).toBe("test-model");
		},
	);

	it("omits the variable when the optional getter is missing", () => {
		expect(createFooter().render()).toBe("test-model Test");
	});

	it("reads the live level on each render without synchronization or editor installation", () => {
		let level = "high";
		const footer = createFooter(() => level);
		expect(footer.render()).toBe("test-model Test high");
		level = "low";
		expect(footer.render()).toBe("test-model Test low");
		level = "off";
		expect(footer.render()).toBe("test-model Test");
	});

	it("uses the same sanitized value in wide and forced compact templates", () => {
		const footer = createFooter(() => "\u001b[31mfuture\u001b[0m\n\tlevel\u0007");
		footer.starship.format = `${"wide-".repeat(20)}$thinkingLevel`;
		footer.starship.compactFormat = "compact: $" + "{thinkingLevel}";
		footer.starship.responsive = true;
		expect(footer.render()).toBe(`${"wide-".repeat(20)}future level`);
		expect(footer.render(32)).toBe("compact: future level");
		for (const width of [0, 1, 2, 5, 10, 16, 24]) {
			expect(footer.render(width)).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
		}
	});

	it("keeps both templates authoritative and the built-in model info unchanged", () => {
		let level = "future-level";
		const footer = createFooter(() => level);
		footer.starship.format = "$model $provider";
		expect(footer.render()).toBe("test-model Test");
		footer.starship.format = "wide-".repeat(30);
		footer.starship.responsive = true;
		expect(footer.render(24)).not.toContain("future-level");
		footer.starship.format = "";
		footer.starship.segments.modelInfo = true;
		const builtIn = footer.render();
		expect(builtIn).toContain("test-model");
		expect(builtIn).not.toContain("future-level");
		level = "off";
		expect(footer.render()).toBe(builtIn);
	});
});
