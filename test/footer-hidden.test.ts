import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { installHiddenFooter } from "../extensions/zentui/footer";

function setup(raw: unknown = {}) {
	const config = mergeConfig(raw);
	const statuses = new Map<string, string>();
	const theme = { fg: (_: string, text: string) => `\x1b[90m${text}\x1b[39m` } as Theme;
	const requestRender = vi.fn();
	const onBranchChange = vi.fn();
	const hooks = {
		setRequestRender: vi.fn(),
		setExtensionStatusesGetter: vi.fn(),
		onDispose: vi.fn(),
	};
	let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
	const setFooter = vi.fn((value: typeof factory) => {
		factory = value;
	});
	installHiddenFooter(
		{ ui: { setFooter } } as unknown as ExtensionContext,
		() => config.components.extensionStatuses,
		hooks,
	);
	const component = factory?.({ requestRender } as never, theme, {
		getExtensionStatuses: () => statuses,
		onBranchChange,
	} as never);
	if (!component) throw new Error("Hidden factory missing");
	return { config, statuses, theme, requestRender, onBranchChange, hooks, setFooter, component };
}

describe("Hidden footer status-only presentation", () => {
	it("has no empty row for absent, empty, control-only or globally/per-key hidden statuses", () => {
		const h = setup();
		expect(h.component.render(80)).toEqual([]);
		h.statuses.set("empty", " \n\t ");
		h.statuses.set("controls", "\x1b[31m\x1b[0m\x1b]0;title\x07\x00");
		expect(h.component.render(80)).toEqual([]);
		h.statuses.set("active", "ACTIVE");
		h.config.components.extensionStatuses.defaultVisibility = "hide";
		expect(h.component.render(80)).toEqual([]);
		h.config.components.extensionStatuses.visibility.active = "show";
		expect(h.component.render(80)).toEqual(["ACTIVE"]);
		h.config.components.extensionStatuses.defaultVisibility = "show";
		h.config.components.extensionStatuses.visibility.active = "hide";
		expect(h.component.render(80)).toEqual([]);
		h.component.dispose?.();
	});

	it.each([
		{ extensionStatuses: { defaultPlacement: "off", placements: { a: "off" } } },
		{
			components: {
				footer: {
					styles: {
						starship: {
							extensionStatuses: {
								defaultPlacement: "off",
								placements: { a: "off" },
								colorModes: { a: "zentui" },
							},
						},
					},
				},
			},
		},
	])("ignores legacy/local Starship placement and colors, preserving native key order", (raw) => {
		const h = setup(raw);
		h.statuses.set("Z", "LAST");
		h.statuses.set("a", "\x1b[31mFIRST\x1b[0m");
		expect(h.component.render(80)).toEqual(["\x1b[31mFIRST\x1b[0m LAST"]);
		h.component.dispose?.();
	});

	it("matches native whitespace, ANSI colors, Unicode cropping and dim ellipsis at narrow widths", () => {
		const h = setup();
		const text = "\x1b[32m界 e\u0301 👩‍💻\x1b[0m\n\t  ready\r now";
		h.statuses.set("x", text);
		const nativeText = text
			.replace(/[\r\n\t]/g, " ")
			.replace(/ +/g, " ")
			.trim();
		for (const width of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 18, 80]) {
			const rows = h.component.render(width);
			expect(rows).toEqual([truncateToWidth(nativeText, width, h.theme.fg("dim", "..."))]);
			expect(visibleWidth(rows[0])).toBeLessThanOrEqual(width);
			expect(rows[0]).not.toMatch(/[\r\n\t]/);
		}
		expect(h.component.render(0)).toEqual([]);
		expect(h.component.render(-1)).toEqual([]);
		h.statuses.set("x", "SYNC ready");
		expect(stripVTControlCharacters(h.component.render(8)[0])).toBe("SYNC ...");
		h.component.dispose?.();
	});

	it("removes unsafe terminal controls while preserving safe styles and closed HTTP links", () => {
		const h = setup();
		h.statuses.set(
			"x",
			"\x1b]0;TITLE\x07\x1b]52;c;CLIPBOARD\x07\x1b[2J\x00\x07\x1b[35mOK\x1b[0m\t\x1b]8;;https://example.com\x07LINK",
		);
		expect(h.component.render(80)).toEqual([
			"\x1b[35mOK\x1b[0m \x1b]8;;https://example.com/\x07LINK\x1b]8;;\x07",
		]);
		for (const width of [1, 3, 5, 6, 7]) {
			const row = h.component.render(width)[0];
			expect(visibleWidth(row)).toBeLessThanOrEqual(width);
			expect(row).not.toMatch(/TITLE|CLIPBOARD|\x1b\[2J|\x00/);
			let active = false;
			for (const match of row.matchAll(/\x1b\]8;;([^\x07]*)\x07/g)) active = Boolean(match[1]);
			expect(active).toBe(false);
		}
		h.component.dispose?.();
	});

	it("uses only the authorized factory, exposes live discovery/render callbacks and releases them", () => {
		const h = setup();
		expect(h.setFooter).toHaveBeenCalledTimes(1);
		expect(h.onBranchChange).not.toHaveBeenCalled();
		const getter = h.hooks.setExtensionStatusesGetter.mock.calls[0][0];
		h.statuses.set("a", "LATEST");
		expect(getter()).toBe(h.statuses);
		h.hooks.setRequestRender.mock.calls[0][0]();
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		h.component.invalidate();
		expect(h.component.render(80)).toEqual(["LATEST"]);
		h.component.dispose?.();
		expect(h.hooks.setRequestRender).toHaveBeenLastCalledWith(undefined);
		expect(h.hooks.setExtensionStatusesGetter).toHaveBeenLastCalledWith(undefined);
		expect(h.hooks.onDispose).toHaveBeenCalledTimes(1);
		expect(h.setFooter).toHaveBeenCalledTimes(1);
	});
});
