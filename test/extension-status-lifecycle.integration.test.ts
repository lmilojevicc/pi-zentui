import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ path: "" }));
vi.mock("../extensions/zentui/config", async (original) => {
	const actual = await original<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists() {},
		loadConfig: () => actual.mergeConfig(JSON.parse(readFileSync(disk.path, "utf8"))),
		saveExtensionStatusDefaultChoice: (
			value: Parameters<typeof actual.saveExtensionStatusDefaultChoice>[0],
			style: Parameters<typeof actual.saveExtensionStatusDefaultChoice>[1],
		) => actual.saveExtensionStatusDefaultChoice(value, style, disk.path),
		saveExtensionStatusChoice: (
			key: string,
			value: Parameters<typeof actual.saveExtensionStatusChoice>[1],
			style: Parameters<typeof actual.saveExtensionStatusChoice>[2],
		) => actual.saveExtensionStatusChoice(key, value, style, disk.path),
		saveExtensionStatusColorMode: (key: string, value: "zentui" | "original") =>
			actual.saveExtensionStatusColorMode(key, value, disk.path),
		saveHiddenExtensionStatusColorMode: (key: string, value: "zentui" | "original") =>
			actual.saveHiddenExtensionStatusColorMode(key, value, disk.path),
		saveFooterComponentPatch: (patch: Parameters<typeof actual.saveFooterComponentPatch>[0]) =>
			actual.saveFooterComponentPatch(patch, disk.path),
	};
});
vi.mock("../extensions/zentui/git", async (original) => {
	const actual = await original<typeof import("../extensions/zentui/git")>();
	return {
		...actual,
		readGitStatus: async () => ({ kind: "ok", status: actual.emptyGitStatus() }),
	};
});
vi.mock("../extensions/zentui/runtime", () => ({
	readRuntimeInfo: async () => ({ kind: "ok", runtime: undefined }),
}));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: async () => ({ kind: "ok", result: null }),
}));

import { mergeConfig } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

initTheme("dark", false);
type Component = {
	render(width: number): string[];
	handleInput?(data: string): void;
	dispose?(): void;
};
type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { handler(args: string, ctx: unknown): Promise<void> };
const raw = () => JSON.parse(readFileSync(disk.path, "utf8"));

function setup(style: "native" | "hidden" | "starship" | "disabled", mode = "tui") {
	const config = {
		projectRefreshIntervalMs: 0,
		components: {
			editor: { enabled: false },
			userMessages: { enabled: false },
			selectorBorders: { enabled: false },
			footer: {
				...(style === "disabled" ? { enabled: false } : { style }),
				styles: {
					starship: {
						extensionStatuses: { placements: { off: "off" }, colorModes: { off: "original" } },
					},
				},
			},
		},
	};
	writeFileSync(disk.path, JSON.stringify(config));
	const handlers = new Map<string, Handler[]>();
	let command: Command | undefined;
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand(name: string, value: Command) {
			if (name === "zentui") command = value;
		},
		registerEntryRenderer() {},
		getThinkingLevel: () => "off",
	} as never);
	const provider = new Map<string, string>();
	let footer: Component | undefined;
	let panel: Component | undefined;
	const theme = {
		fg: (_: string, value: string) => value,
		bold: (value: string) => value,
		italic: (value: string) => value,
		underline: (value: string) => value,
		strikethrough: (value: string) => value,
		getThinkingBorderColor: () => (value: string) => value,
	} as unknown as Theme;
	const ctx = {
		mode,
		hasUI: mode === "tui",
		cwd: "/tmp/zentui-status-integration",
		getContextUsage: () => undefined,
		sessionManager: { getBranch: () => [], getEntries: () => [], getSessionName: () => undefined },
		ui: {
			theme,
			setStatus: vi.fn((key: string, value: string | undefined) => {
				if (value === undefined) provider.delete(key);
				else provider.set(key, value);
			}),
			setFooter: vi.fn((factory: ((...args: unknown[]) => Component) | undefined) => {
				footer?.dispose?.();
				footer = factory?.({ requestRender() {} }, theme, {
					onBranchChange: () => () => {},
					getExtensionStatuses: () => provider,
				});
			}),
			setEditorComponent: vi.fn(),
			getEditorComponent: () => undefined,
			getEditorText: () => "",
			setEditorText() {},
			onTerminalInput: () => () => {},
			notify: vi.fn(),
			async custom(factory: (...args: unknown[]) => Component) {
				panel = factory({ requestRender() {} }, theme, {}, () => {});
			},
		},
	};
	const setter = ctx.ui.setStatus;
	return {
		ctx,
		provider,
		setter,
		config,
		footer: () => footer,
		async emit(name: string) {
			for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
		},
		async open(route: string) {
			await command?.handler(route, ctx);
		},
		rows: () => panel?.render(200).join("\n") ?? "",
		change(label: string) {
			for (let i = 0; i < 50; i++) {
				if (
					panel?.render(200).some((line) => stripVTControlCharacters(line).includes(`→ ${label}`))
				) {
					panel.handleInput?.("\r");
					return;
				}
				panel?.handleInput?.("\x1b[B");
			}
			throw new Error(`Missing row ${label}: ${panel?.render(200).join("\n")}`);
		},
	};
}

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "zentui-status-lifecycle-"));
	disk.path = join(dir, "zentui.json");
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("independent extension status lifecycle", () => {
	it.each(["native", "disabled", "hidden", "starship"] as const)(
		"discovers and filters third-party publications under %s without Footer takeover",
		async (style) => {
			const h = setup(style);
			await h.emit("session_start");
			try {
				const footerCalls = h.ctx.ui.setFooter.mock.calls.length;
				expect(footerCalls).toBe(style === "native" || style === "disabled" ? 0 : 1);
				expect(h.setter).not.toHaveBeenCalled();
				const wrapper = h.ctx.ui.setStatus;
				h.ctx.ui.setStatus("third-party", "RAW_STATUS");
				h.ctx.ui.setStatus("off", "LOCAL_OFF");
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual(["LOCAL_OFF RAW_STATUS"]);
				const beforeOpen = readFileSync(disk.path, "utf8");
				await h.open("extensions");
				expect(readFileSync(disk.path, "utf8")).toBe(beforeOpen);
				expect(h.rows()).toContain("third-party placement");
				expect(h.rows()).toContain("Default placement");
				for (let i = 0; i < (style === "hidden" ? 3 : 1); i++) h.change("Default placement");
				expect(h.provider.size).toBe(0);
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual([]);
				expect(raw().components.extensionStatuses.defaultVisibility).toBe("hide");
				expect(raw().components.footer).toEqual(h.config.components.footer);
				h.ctx.ui.setStatus("third-party", "LATEST_STATUS");
				h.change("third-party placement"); // Default -> Off
				h.change("third-party placement"); // Off -> Left (explicit Show)
				expect(h.provider.get("third-party")).toBe("LATEST_STATUS");
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual(["LATEST_STATUS"]);
				for (let i = 0; i < 4; i++) h.change("third-party placement"); // Left -> Default -> Off
				expect(h.provider.has("third-party")).toBe(false);
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual([]);
				for (let i = 0; i < 4; i++) h.change("third-party placement"); // Off -> Default
				expect(raw().components.extensionStatuses.visibility).toEqual({});
				h.change("Default placement");
				expect(h.provider.get("third-party")).toBe("LATEST_STATUS");
				expect(h.provider.get("off")).toBe("LOCAL_OFF");
				if (style === "hidden")
					expect(h.footer()?.render(160)).toEqual(["LOCAL_OFF LATEST_STATUS"]);
				if (style === "starship") {
					expect(h.footer()?.render(200).join("\n")).toContain("LATEST_STATUS");
					expect(h.footer()?.render(200).join("\n")).not.toContain("LOCAL_OFF");
				}
				h.change("Default placement");
				h.ctx.ui.setStatus("third-party", undefined);
				h.ctx.ui.setStatus("off", undefined);
				for (let i = 0; i < 3; i++) h.change("Default placement");
				expect(h.provider.size).toBe(0);
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual([]);
				expect(h.ctx.ui.setFooter).toHaveBeenCalledTimes(footerCalls);
				expect(h.ctx.ui.setStatus).toBe(wrapper);
				expect(h.ctx.ui.setEditorComponent).not.toHaveBeenCalled();
				for (const owner of ["editor", "userMessages", "selectorBorders"] as const)
					expect(raw().components[owner]).toEqual(h.config.components[owner]);
			} finally {
				await h.emit("session_shutdown");
			}
			expect(h.ctx.ui.setStatus).toBe(h.setter);
		},
	);

	it("keeps Native layout untouched while saving dormant Starship choices and applying Off", async () => {
		const h = setup("native");
		const saved = raw();
		saved.components.footer.enabled = false;
		saved.components.footer.styles.starship.extensionStatuses.defaultPlacement = "off";
		const hidden = { placements: { off: "middle" }, colorModes: { off: "zentui" } };
		saved.components.extensionStatuses = { visibility: { off: "show" }, hidden };
		writeFileSync(disk.path, JSON.stringify(saved));
		await h.emit("session_start");
		try {
			h.ctx.ui.setStatus("off", "RAW");
			const beforeOpen = readFileSync(disk.path, "utf8");
			await h.open("extensions");
			expect(readFileSync(disk.path, "utf8")).toBe(beforeOpen);
			const rows = stripVTControlCharacters(h.rows());
			expect(rows).toMatch(/Default placement\s+Right/);
			expect(rows).toMatch(/off placement\s+Right/);
			expect(rows).toContain("Native uses Pi's layout");
			h.change("off placement"); // Right -> Default, ignoring dormant Starship Off
			expect(raw().components.extensionStatuses.visibility).toEqual({});
			expect(raw().components.footer.styles.starship.extensionStatuses.placements).toEqual({});
			expect(h.provider.get("off")).toBe("RAW");
			h.change("Default placement"); // Right -> Off
			expect(h.provider.has("off")).toBe(false);
			h.change("off placement"); // Default -> Off
			h.change("off placement"); // Off -> Left explicitly shows even with default Off
			expect(h.provider.get("off")).toBe("RAW");
			expect(raw().components.footer.styles.starship.extensionStatuses.placements).toEqual({
				off: "left",
			});
			h.change("off color"); // Original -> Zentui (Starship only)
			expect(h.provider.get("off")).toBe("RAW");
			expect(raw().components.footer.styles.starship.extensionStatuses.colorModes).toEqual({
				off: "zentui",
			});
			for (let i = 0; i < 3; i++) h.change("off placement"); // Left -> Default
			expect(h.provider.has("off")).toBe(false);
			expect(raw().components.extensionStatuses.hidden).toEqual(hidden);
			expect(raw().components.footer).toMatchObject({ style: "native", enabled: false });
			expect(h.ctx.ui.setFooter).not.toHaveBeenCalled();
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("keeps active visibility and placement unchanged after a settings save fails", async () => {
		const h = setup("hidden");
		await h.emit("session_start");
		try {
			h.ctx.ui.setStatus("key", "RAW");
			await h.open("extensions");
			writeFileSync(disk.path, "{broken");
			h.change("key placement"); // Default -> Off fails before applying live state
			expect(readFileSync(disk.path, "utf8")).toBe("{broken");
			expect(h.provider.get("key")).toBe("RAW");
			expect(h.footer()?.render(80)).toEqual(["RAW"]);
			expect(stripVTControlCharacters(h.rows())).toMatch(/key placement\s+Default/);
			expect(h.ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("corrupt or unreadable"),
				"error",
			);
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("keeps visibility across Footer transitions and reload, releasing only current-session suppression", async () => {
		const h = setup("native");
		await h.emit("session_start");
		try {
			h.ctx.ui.setStatus("third-party", "LATEST");
			await h.open("extensions");
			h.change("Default placement");
			const wrapper = h.ctx.ui.setStatus;
			for (const style of ["starship", "hidden", "native"]) {
				await h.open("footer");
				h.change("Footer style");
				expect(mergeConfig(raw()).components.footer.style).toBe(style);
				expect(raw().components.extensionStatuses.defaultVisibility).toBe("hide");
				expect(h.ctx.ui.setStatus).toBe(wrapper);
				expect(h.provider.size).toBe(0);
			}
			await h.emit("session_shutdown");
			expect(h.provider.get("third-party")).toBe("LATEST");
			await h.emit("session_start");
			h.ctx.ui.setStatus("third-party", "NEXT_SESSION");
			expect(h.provider.size).toBe(0);
			await h.open("extensions");
			expect(h.rows()).toContain("third-party placement");
		} finally {
			await h.emit("session_shutdown");
		}
		expect(h.provider.get("third-party")).toBe("NEXT_SESSION");
	});

	it.each(["starship", "hidden"] as const)(
		"uses already-owned %s getter data only for discovery, never suppression provenance",
		async (style) => {
			const h = setup(style);
			h.provider.set("before-observation", "PREEXISTING");
			await h.emit("session_start");
			try {
				await h.open("extensions");
				expect(h.rows()).toContain("before-observation placement");
				for (let i = 0; i < (style === "hidden" ? 3 : 1); i++) h.change("Default placement");
				expect(h.setter).not.toHaveBeenCalled();
				expect(h.provider.get("before-observation")).toBe("PREEXISTING");
				if (style === "hidden") {
					expect(h.footer()?.render(160)).toEqual([]);
					h.change("before-observation placement"); // Default -> Off
					h.change("before-observation placement"); // Off -> Left, presentation only
					expect(h.footer()?.render(160)).toEqual(["PREEXISTING"]);
					expect(h.setter).not.toHaveBeenCalled();
				}
				expect(h.ctx.ui.setFooter).toHaveBeenCalledTimes(1);
			} finally {
				await h.emit("session_shutdown");
			}
			expect(h.setter).not.toHaveBeenCalled();
		},
	);

	it("places Hidden statuses through settings, preserving visibility/latest/delete and per-mode preferences", async () => {
		const h = setup("hidden");
		await h.emit("session_start");
		try {
			for (const key of ["l", "m", "r"]) h.ctx.ui.setStatus(key, key.toUpperCase());
			await h.open("extensions");
			expect(h.rows()).toContain("Default placement");
			expect(h.rows()).not.toContain("Starship placement");
			expect(h.rows()).not.toContain("Starship color");
			h.change("Default placement"); // Left -> Middle
			for (let i = 0; i < 2; i++) h.change("l placement"); // Default -> Left
			for (let i = 0; i < 4; i++) h.change("r placement"); // Default -> Right
			expect(h.footer()?.render(21)).toEqual(["L         M         R"]);
			expect(raw().components.footer).toEqual(h.config.components.footer);
			expect(h.ctx.ui.setFooter).toHaveBeenCalledTimes(1);
			for (let i = 0; i < 2; i++) h.change("Default placement"); // Middle -> Off
			// Explicit positive choices stay visible when the default is Off.
			expect(h.footer()?.render(21)).toEqual(["L                   R"]);
			h.ctx.ui.setStatus("r", "RR");
			h.change("r placement"); // Right -> Default
			h.change("r placement"); // Default -> Off
			h.change("r placement"); // Off -> Left
			expect(h.footer()?.render(21)).toEqual(["L RR"]);
			h.ctx.ui.setStatus("r", undefined);
			expect(h.footer()?.render(21)).toEqual(["L"]);
			h.change("Default placement"); // Off -> Left
			expect(h.footer()?.render(21)).toEqual(["L M"]);
			h.ctx.ui.setStatus("r", "R");
			for (let i = 0; i < 3; i++) h.change("r placement"); // Left -> Default
			expect(raw().components.extensionStatuses.hidden.placements).toEqual({ l: "left" });
			expect(h.footer()?.render(21)).toEqual(["L M R"]);
			const hidden = raw().components.extensionStatuses.hidden;
			await h.open("footer");
			h.change("Footer style"); // Hidden -> Native
			await h.open("extensions");
			expect(h.rows()).toContain("Default placement");
			expect(h.rows()).not.toContain("Hidden placement");
			await h.open("footer");
			h.change("Footer style"); // Native -> Starship
			await h.open("extensions");
			h.change("Default placement"); // Right -> Off
			expect(raw().components.extensionStatuses.hidden).toEqual(hidden);
			expect(h.provider.has("r")).toBe(false);
			await h.open("footer");
			h.change("Footer style"); // Starship -> Hidden
			expect(h.footer()?.render(21)).toEqual(["L"]);
			expect(h.ctx.ui.setFooter).toHaveBeenCalledTimes(4);
			expect(raw().components.extensionStatuses.hidden).toEqual(hidden);
			expect(raw().components.footer.styles.starship.extensionStatuses.colorModes).toEqual(
				h.config.components.footer.styles.starship.extensionStatuses.colorModes,
			);
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("applies Hidden color choices immediately without changing publications, visibility or Starship preferences", async () => {
		const h = setup("hidden");
		h.ctx.ui.theme.fg = (color, text) => (color === "muted" ? `\x1b[90m${text}\x1b[0m` : text);
		await h.emit("session_start");
		try {
			const original = "\x1b[32mBUILD\x1b[0m";
			h.ctx.ui.setStatus("demo:build", original);
			await h.open("extensions");
			expect(h.rows()).toContain("demo:build color");
			expect(h.footer()?.render(80)).toEqual([original]);
			h.change("demo:build color"); // Original -> Zentui
			expect(h.footer()?.render(80)).toEqual(["\x1b[90mBUILD\x1b[0m"]);
			expect(raw().components.extensionStatuses.hidden.colorModes).toEqual({
				"demo:build": "zentui",
			});
			expect(h.provider.get("demo:build")).toBe(original);
			expect(raw().components.footer).toEqual(h.config.components.footer);
			expect(raw().components.extensionStatuses).not.toHaveProperty("defaultVisibility");
			h.ctx.ui.setStatus("demo:build", "\x1b[33mLATEST\x1b[0m");
			expect(h.footer()?.render(80)).toEqual(["\x1b[90mLATEST\x1b[0m"]);
			for (let i = 0; i < 3; i++) h.change("Default placement"); // Left -> Off
			expect(h.footer()?.render(80)).toEqual([]);
			h.change("demo:build placement"); // Default -> Off
			h.change("demo:build placement"); // Off -> Left
			expect(h.footer()?.render(80)).toEqual(["\x1b[90mLATEST\x1b[0m"]);
			h.change("demo:build color"); // Zentui -> Original
			expect(h.footer()?.render(80)).toEqual(["\x1b[33mLATEST\x1b[0m"]);
			expect(raw().components.extensionStatuses.hidden.colorModes).toEqual({});
			expect(h.ctx.ui.setFooter).toHaveBeenCalledTimes(1);
			expect(raw().components.footer).toEqual(h.config.components.footer);
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it("does not let a stale settings panel change the replacement session", async () => {
		const h = setup("native");
		await h.emit("session_start");
		await h.open("extensions");
		await h.emit("session_start");
		try {
			h.change("Default placement");
			expect(raw().components).not.toHaveProperty("extensionStatuses");
			h.ctx.ui.setStatus("new-session", "shown");
			expect(h.provider.get("new-session")).toBe("shown");
		} finally {
			await h.emit("session_shutdown");
		}
	});

	it.each(["rpc", "json", "print"])("does not decorate in %s", async (mode) => {
		const h = setup("native", mode);
		await h.emit("session_start");
		expect(h.ctx.ui.setStatus).toBe(h.setter);
		expect(h.ctx.ui.setFooter).not.toHaveBeenCalled();
		await h.emit("session_shutdown");
	});
});
