import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as plain } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ComponentSettingsDeps,
	customValueColorKeys,
	editCustomValueColors,
} from "../extensions/zentui/component-settings";
import {
	mergeConfig,
	migrateComponentSelections,
	saveCustomValueColor,
	saveEditorComponentPatch,
} from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { renderMinimalistFrame } from "../extensions/zentui/minimalist-editor";
import { MINIMALIST_FORMAT_SLOTS } from "../extensions/zentui/minimalist-template";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";
import { createInitialState } from "../extensions/zentui/state";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";
import { buildWorkingLineFrames } from "../extensions/zentui/working-line";

const key = "vendor.package/value";
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
} as Theme;
const disposals: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
});
function configuration(style: "minimalist" | "opencode" | "opencode-copy-friendly" = "minimalist") {
	return mergeConfig({
		components: {
			editor: {
				style,
				colorSource: "terminal",
				customValueColors: { [key]: "bold fg:202" },
				styles: {
					minimalist: {
						formats: Object.fromEntries(
							MINIMALIST_FORMAT_SLOTS.map((slot) => [
								slot,
								slot === "topLeft" ? "$ci $second $extensions" : "",
							]),
						),
						variables: { ci: key, second: key },
					},
					...(style !== "minimalist"
						? { [style]: { metadataFormat: "$ci $second", variables: { ci: key, second: key } } }
						: {}),
				},
			},
			footer: {
				style: "starship",
				colorSource: "terminal",
				customValueColors: { [key]: "fg:201" },
				styles: {
					starship: {
						format: "$ci $second",
						compactFormat: "$ci",
						responsive: true,
						variables: { ci: key, second: key },
					},
				},
			},
		},
	});
}
function editor(config: ReturnType<typeof configuration>, raw: string) {
	const customVariables = new Map([[key, raw]]);
	if (config.components.editor.style === "minimalist")
		return renderMinimalistFrame({
			width: 160,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "",
				customVariables,
				hostTemplateValues: {
					ci: "CI passing",
					pr_number: "42",
					pr_url: "https://github.com/owner/project/pull/42",
					token_rate: "~48 tok/s",
				},
			},
			uiTheme: theme,
			config,
		}).join("\n");
	return renderPolishedEditorFrame({
		width: 160,
		editorLines: ["draft"],
		modelMeta: {
			modelLabel: "",
			providerLabel: "",
			customVariables,
			hostTemplateValues: {
				ci: "CI passing",
				pr_number: "42",
				pr_url: "https://github.com/owner/project/pull/42",
				token_rate: "~48 tok/s",
			},
		},
		uiTheme: theme,
		config,
	}).join("\n");
}
function footer(config: ReturnType<typeof configuration>, raw: string) {
	let component: { render(width: number): string[]; dispose?(): void } | undefined;
	installFooter(
		{
			cwd: "/project",
			sessionManager: { getSessionName: () => undefined },
			getContextUsage: () => undefined,
			ui: {
				setFooter(factory: (...args: never[]) => typeof component) {
					component = factory(
						{ requestRender() {} } as never,
						theme as never,
						{ onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() } as never,
					);
				},
			},
		} as never,
		createInitialState(emptyGitStatus()),
		() => config,
		{
			setRequestRender() {},
			scheduleProjectRefresh() {},
			getCustomVariables: () => new Map([[key, raw]]),
			getHostTemplateValues: () => ({
				ci: "CI passing",
				pr_number: "42",
				pr_url: "https://github.com/owner/project/pull/42",
				token_rate: "~48 tok/s",
			}),
		},
	);
	const result = component;
	if (!result) throw new Error("missing footer");
	disposals.push(() => result.dispose?.());
	return (width = 160) => result.render(width).join("\n");
}

describe("owner-local publisher color consumers", () => {
	it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
		"applies publisher ID overrides to every alias without changing other owners in %s",
		(style) => {
			const config = configuration(style);
			const raw = "\x1b[31mVALUE\x1b[0m";
			const result = editor(config, raw);
			expect(result.match(/\x1b\[1;38;5;202mVALUE/g)).toHaveLength(2);
			expect(result).not.toContain("\x1b[31m");
			expect(result).not.toContain("CI passing");
			const render = footer(config, raw);
			expect(render().match(/\x1b\[38;5;201mVALUE/g)).toHaveLength(2);
			config.components.footer.styles.starship.format = "wide".repeat(60);
			expect(render(20)).toContain("\x1b[38;5;201mVALUE");
			config.components.editor.customValueColors = { [key]: "" };
			const unstyled = editor(config, raw);
			expect(plain(unstyled)).toContain("VALUE");
			expect(unstyled).not.toContain("\x1b[31m");
			expect(unstyled).not.toContain("38;5;202");
			expect(render(20)).toContain("38;5;201");
			delete config.components.editor.customValueColors;
			expect(editor(config, raw)).toContain("\x1b[31mVALUE");
			config.components.editor.styles[style].extensionColorMode = "zentui";
			expect(editor(config, raw)).not.toContain("\x1b[31m");
		},
	);
	it("styles Minimalist aggregate publishers and does not reinterpret Footer's legacy status aggregate", () => {
		const config = configuration();
		config.components.editor.styles.minimalist.variables = {};
		const result = editor(config, "\x1b[31mVALUE\x1b[0m");
		expect(result).toContain("\x1b[1;38;5;202mVALUE");
		expect(result).toContain("CI passing");
		config.components.footer.styles.starship.format = "$extensions";
		expect(plain(footer(config, "VALUE")()).trim()).toBe("");
	});
	it.each(["disabled", "classic", "kitt"] as const)(
		"styles Working rate independently from animated tiers (%s), default-off and safe",
		(textAnimation) => {
			const config = mergeConfig({
				components: {
					workingLine: {
						textAnimation,
						segments: { tokenRate: true },
						colors: { low: "blue", mid: "green", high: "cyan", tokenRate: "fg:202" },
					},
				},
			});
			for (const animateSpinnerColor of [false, true]) {
				config.components.workingLine.animateSpinnerColor = animateSpinnerColor;
				const frames = buildWorkingLineFrames(
					config.components.workingLine,
					config.colors,
					theme,
					"準備中",
					{ tokenRate: "~48 tok/s" },
				);
				expect(plain(frames.frames[0])).toContain("~48 tok/s");
				for (const frame of frames.frames) expect(frame).toContain("\x1b[38;5;202m");
			}
			config.components.workingLine.segments.tokenRate = false;
			expect(
				buildWorkingLineFrames(config.components.workingLine, config.colors, theme, "ready", {
					tokenRate: "~48 tok/s",
				}).row,
			).not.toContain("tok/s");
		},
	);
});

describe("sparse custom value color persistence", () => {
	it("saves/resets exactly one raw leaf and retains unknown, invalid, other-owner and legacy data", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-live-colors-"));
		const path = join(dir, "config.json");
		try {
			const raw = {
				unknown: { nested: "retain" },
				colors: { extensionStatus: "red" },
				components: {
					editor: {
						customValueColors: { [key]: "red", saved: "fg:999", sibling: "blue" },
						unknown: 42,
						styles: { minimalist: { variables: { ci: key } } },
					},
					footer: { customValueColors: { [key]: "cyan" }, future: [1, 2, 3] },
				},
			};
			writeFileSync(path, JSON.stringify(raw));
			const saved = saveCustomValueColor("editor", key, "", path);
			expect(saved.components.editor.customValueColors?.[key]).toBe("");
			let disk = JSON.parse(readFileSync(path, "utf8"));
			expect(disk.components.footer).toEqual(raw.components.footer);
			expect(disk.unknown).toEqual(raw.unknown);
			expect(disk.components.editor.customValueColors).toEqual({
				[key]: "",
				saved: "fg:999",
				sibling: "blue",
			});
			saveEditorComponentPatch({ enabled: false }, path);
			migrateComponentSelections(path);
			disk = JSON.parse(readFileSync(path, "utf8"));
			expect(disk.components.editor.customValueColors).toEqual({
				[key]: "",
				saved: "fg:999",
				sibling: "blue",
			});
			expect(disk.components.footer.customValueColors).toEqual(
				raw.components.footer.customValueColors,
			);
			saveCustomValueColor("editor", key, undefined, path);
			disk = JSON.parse(readFileSync(path, "utf8"));
			expect(disk.components.editor.customValueColors).toEqual({
				saved: "fg:999",
				sibling: "blue",
			});
			const before = readFileSync(path, "utf8");
			for (const [publisher, value] of [
				["__proto__", "red"],
				[key, "fg:999"],
				["bad key", "red"],
			])
				expect(() => saveCustomValueColor("editor", publisher, value, path)).toThrow();
			expect(readFileSync(path, "utf8")).toBe(before);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("retains ci aliases on normalized selection saves and rejects every other host reservation", () => {
		const config = mergeConfig({
			components: {
				editor: {
					styles: {
						minimalist: { variables: { ci: key, pr_number: key } },
						opencode: { variables: { ci: key, token_rate: key } },
						"opencode-copy-friendly": { variables: { ci: key, pr_url: key } },
					},
				},
				footer: { styles: { starship: { variables: { ci: key, token_rate: key } } } },
			},
		});
		for (const style of ["minimalist", "opencode", "opencode-copy-friendly"] as const)
			expect(config.components.editor.styles[style].variables).toEqual({ ci: key });
		expect(config.components.footer.styles.starship.variables).toEqual({ ci: key });
	});
});

function settings() {
	const config = configuration();
	const lifecycle = new SessionLifecycle();
	lifecycle.start();
	const ui = {
		select: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(async () => undefined),
		editor: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(async () => undefined),
		notify: vi.fn(),
		getEditorText: () => "draft",
		setEditorText: vi.fn(),
	};
	const deps: ComponentSettingsDeps = {
		sessionLifecycle: lifecycle,
		getConfig: () => config,
		migrateSelections() {},
		setComponentColor() {},
		getCustomVariables: () => new Map([["current/key", "value"]]),
		setCustomValueColor: vi.fn(),
	};
	return { config, lifecycle, ui, deps, ctx: { hasUI: true, ui } as never };
}
describe("individual publisher settings", () => {
	it("lists valid current, aliased and saved publisher IDs, never alias names or builtin roles", () => {
		const h = settings();
		h.config.components.editor.customValueColors = { saved: "", __proto__: "red" };
		expect(customValueColorKeys(h.config, "editor", h.deps.getCustomVariables?.())).toEqual([
			"current/key",
			"saved",
			key,
		]);
	});
	it.each(["", "bold fg:202", undefined] as const)(
		"saves deliberate style or resets one leaf: %s",
		async (value) => {
			const h = settings();
			h.ui.select
				.mockResolvedValueOnce(key)
				.mockResolvedValueOnce(value === undefined ? "Reset / inherit" : "Edit override");
			h.ui.editor.mockResolvedValueOnce(value);
			await editCustomValueColors(h.ctx, h.deps, "editor");
			expect(h.deps.setCustomValueColor).toHaveBeenCalledExactlyOnceWith(
				"editor",
				key,
				value,
				h.ctx,
			);
		},
	);
	it.each(["cancel", "invalid", "stale", "restart"])("does not write on %s", async (mode) => {
		const h = settings();
		h.ui.select.mockResolvedValueOnce(key).mockResolvedValueOnce("Edit override");
		h.ui.editor.mockImplementationOnce(async () => {
			if (mode === "stale" || mode === "restart") {
				h.lifecycle.shutdown();
				if (mode === "restart") h.lifecycle.start();
			}
			return mode === "cancel" ? undefined : "fg:999";
		});
		await editCustomValueColors(h.ctx, h.deps, "footer");
		expect(h.deps.setCustomValueColor).not.toHaveBeenCalled();
		if (mode === "stale" || mode === "restart") expect(h.ui.notify).not.toHaveBeenCalled();
	});
});

it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
	"uses independent built-in roles rather than publisher overrides in %s and both Footer formats",
	(style) => {
		const config = configuration(style);
		const format = "$pr_number $pr_url $ci $token_rate";
		const values = ["42", "https://github.com/owner/project/pull/42", "CI passing", "~48 tok/s"];
		config.components.editor.styles[style].variables = {};
		if (style === "minimalist")
			config.components.editor.styles.minimalist.formats = Object.fromEntries(
				MINIMALIST_FORMAT_SLOTS.map((slot) => [slot, slot === "topLeft" ? format : ""]),
			);
		else config.components.editor.styles[style].metadataFormat = format;
		config.components.editor.colors = {
			prNumber: "fg:201",
			prUrl: "fg:202",
			ci: "fg:203",
			tokenRate: "fg:204",
		};
		config.components.footer.colors = {
			prNumber: "fg:205",
			prUrl: "fg:206",
			ci: "fg:207",
			tokenRate: "fg:208",
		};
		Object.assign(config.components.footer.styles.starship, {
			variables: {},
			format,
			compactFormat: format,
		});
		const result = editor(config, "IGNORED PUBLISHER");
		for (const [i, value] of values.entries())
			expect(result).toContain(`\x1b[38;5;${201 + i}m${value}`);
		const render = footer(config, "IGNORED PUBLISHER");
		for (const [i, value] of values.entries())
			expect(render()).toContain(`\x1b[38;5;${205 + i}m${value}`);
		config.components.footer.styles.starship.format = "wide".repeat(100);
		for (const [i, value] of values.entries())
			expect(render(120)).toContain(`\x1b[38;5;${205 + i}m${value}`);
	},
);

it.each(MINIMALIST_FORMAT_SLOTS)(
	"supports Pi metadata in Minimalist %s without changing generated defaults",
	(slot) => {
		const config = configuration();
		config.components.editor.styles.minimalist.variables = {};
		config.components.editor.styles.minimalist.formats = Object.fromEntries(
			MINIMALIST_FORMAT_SLOTS.map((name) => [name, name === slot ? "$ci $token_rate" : ""]),
		);
		const result = editor(config, "");
		expect(plain(result)).toContain("CI passing ~48 tok/s");
	},
);

it("keeps the rate styled once, within width, when grapheme segmentation is unavailable", async () => {
	vi.resetModules();
	const fresh = await import("../extensions/zentui/working-line");
	// biome-ignore lint/complexity/useArrowFunction: Intl.Segmenter is a constructor.
	const segmenter = vi.spyOn(Intl, "Segmenter").mockImplementation(function () {
		throw new Error("unavailable");
	});
	try {
		for (const textAnimation of ["disabled", "classic", "kitt"] as const) {
			const config = mergeConfig({
				components: {
					workingLine: {
						textAnimation,
						animateSpinnerColor: true,
						colorSource: "terminal",
						segments: { tokenRate: true },
						colors: { tokenRate: "fg:202" },
					},
				},
			});
			const generated = fresh.buildWorkingLineFrames(
				config.components.workingLine,
				config.colors,
				theme,
				"界 👩🏽‍💻",
				{ tokenRate: "~48 tok/s" },
			);
			for (const frame of generated.frames) {
				expect(frame).toContain("\x1b[38;5;202m~48 tok/s");
				expect(plain(frame).match(/~48 tok\/s/g)).toHaveLength(1);
				expect(plain(frame).length).toBeLessThan(80);
			}
		}
	} finally {
		segmenter.mockRestore();
		vi.resetModules();
	}
});
