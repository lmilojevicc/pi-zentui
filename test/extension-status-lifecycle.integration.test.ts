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
		saveExtensionStatusDefaultVisibility: (value: "show" | "hide") =>
			actual.saveExtensionStatusDefaultVisibility(value, disk.path),
		saveExtensionStatusVisibility: (key: string, value: "show" | "hide" | undefined) =>
			actual.saveExtensionStatusVisibility(key, value, disk.path),
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
				await h.open("extensions");
				expect(h.rows()).toContain("third-party visibility");
				expect(h.rows()).toContain("Default visibility");
				h.change("Default visibility");
				expect(h.provider.size).toBe(0);
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual([]);
				expect(raw().components.extensionStatuses.defaultVisibility).toBe("hide");
				expect(raw().components.footer).toEqual(h.config.components.footer);
				h.ctx.ui.setStatus("third-party", "LATEST_STATUS");
				h.change("third-party visibility"); // Default -> Show
				expect(h.provider.get("third-party")).toBe("LATEST_STATUS");
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual(["LATEST_STATUS"]);
				h.change("third-party visibility"); // Show -> Hide
				expect(h.provider.has("third-party")).toBe(false);
				if (style === "hidden") expect(h.footer()?.render(160)).toEqual([]);
				h.change("third-party visibility"); // Hide -> Default
				expect(raw().components.extensionStatuses.visibility).toEqual({});
				h.change("Default visibility");
				expect(h.provider.get("third-party")).toBe("LATEST_STATUS");
				expect(h.provider.get("off")).toBe("LOCAL_OFF");
				if (style === "hidden")
					expect(h.footer()?.render(160)).toEqual(["LOCAL_OFF LATEST_STATUS"]);
				if (style === "starship") {
					expect(h.footer()?.render(200).join("\n")).toContain("LATEST_STATUS");
					expect(h.footer()?.render(200).join("\n")).not.toContain("LOCAL_OFF");
				}
				h.change("Default visibility");
				h.ctx.ui.setStatus("third-party", undefined);
				h.ctx.ui.setStatus("off", undefined);
				h.change("Default visibility");
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

	it("keeps visibility across Footer transitions and reload, releasing only current-session suppression", async () => {
		const h = setup("native");
		await h.emit("session_start");
		try {
			h.ctx.ui.setStatus("third-party", "LATEST");
			await h.open("extensions");
			h.change("Default visibility");
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
			expect(h.rows()).toContain("third-party visibility");
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
				expect(h.rows()).toContain("before-observation visibility");
				h.change("Default visibility");
				expect(h.setter).not.toHaveBeenCalled();
				expect(h.provider.get("before-observation")).toBe("PREEXISTING");
				if (style === "hidden") {
					expect(h.footer()?.render(160)).toEqual([]);
					h.change("before-observation visibility"); // Default -> Show, presentation only
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

	it("does not let a stale settings panel change the replacement session", async () => {
		const h = setup("native");
		await h.emit("session_start");
		await h.open("extensions");
		await h.emit("session_start");
		try {
			h.change("Default visibility");
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
