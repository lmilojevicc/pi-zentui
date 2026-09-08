import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";

const isolated = vi.hoisted(() => {
	const fs = process.getBuiltinModule("node:fs");
	const path = fs.mkdtempSync(
		`${process.getBuiltinModule("node:os").tmpdir()}/zentui-subagent-lifecycle-`,
	);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = path;
	return { path, previous };
});
const layout = vi.hoisted(() => ({ retain: vi.fn(async () => "failed") }));
vi.mock("../extensions/zentui/accent-rail-layout-patch", async (original) => ({
	...(await original<object>()),
	retainAccentRailLayoutPatchInstallation: layout.retain,
}));

import { initTheme } from "@earendil-works/pi-coding-agent";
import { configPath } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

initTheme("dark", false);

import { SubagentSummaryController } from "../extensions/zentui/subagent-summary";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Command = { handler(args: string, ctx: unknown): Promise<void> };
const initial = (enabled = true) => ({
	projectRefreshIntervalMs: 0,
	components: {
		editor: { enabled: false },
		userMessages: { enabled: false },
		selectorBorders: { enabled: false },
		footer: { style: "native" },
		subagentSummary: { enabled },
	},
	future: { keep: true },
});
const snapshot = {
	asyncSnapshot: {
		kind: "pi-subagents.async-status-snapshot",
		version: 1,
		runs: [{ id: "r", label: "Build", state: "running" }],
	},
};
function harness(context: Record<string, unknown> = {}) {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const events = {
		on(name: string, fn: (data: unknown) => void) {
			const set = listeners.get(name) ?? new Set();
			set.add(fn);
			listeners.set(name, set);
			return () => {
				set.delete(fn);
			};
		},
		emit(name: string, value: unknown) {
			for (const fn of listeners.get(name) ?? []) fn(value);
		},
	};
	const requests: string[] = [];
	events.on("subagents:rpc:v1:request", (raw) =>
		requests.push((raw as { requestId: string }).requestId),
	);
	const widgets = new Map<string, unknown>([["other", ["sentinel"]]]);
	const setWidget = vi.fn((key: string, value: unknown) => {
		if (value === undefined) widgets.delete(key);
		else widgets.set(key, value);
	});
	let panel: { render(width: number): string[]; handleInput(data: string): void };
	const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: isolated.path,
		ui: {
			theme,
			setWidget,
			notify: vi.fn(),
			getEditorComponent: () => undefined,
			getEditorText: () => "",
			setEditorText() {},
			setFooter: vi.fn(),
			setEditorComponent: vi.fn(),
			async custom(factory: (...args: unknown[]) => unknown) {
				panel = factory({ requestRender() {} }, theme, {}, () => {}) as typeof panel;
			},
		},
		sessionManager: { getBranch: () => [], getEntries: () => [], getSessionName: () => undefined },
		getContextUsage: () => undefined,
		...context,
	};
	const pi = {
		events,
		registerCommand(name: string, command: Command) {
			expect(commands.has(name)).toBe(false);
			commands.set(name, command);
		},
		on(name: string, fn: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), fn]);
		},
		registerEntryRenderer() {},
		getThinkingLevel: () => "off",
	};
	zentui(pi as unknown as ExtensionAPI);
	return {
		ctx,
		pi,
		requests,
		listeners,
		commands,
		widgets,
		setWidget,
		panel: () => panel,
		emit: async (name: string) => {
			for (const fn of handlers.get(name) ?? []) await fn({}, ctx);
		},
		reply: (id: string, data = snapshot) =>
			events.emit(`subagents:rpc:v1:reply:${id}`, {
				requestId: id,
				version: 1,
				method: "status",
				success: true,
				data,
			}),
	};
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv("PI_SUBAGENT_CHILD", "");
	writeFileSync(configPath, JSON.stringify(initial()));
	layout.retain.mockImplementation(async () => "failed");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});
afterAll(() => {
	process.getBuiltinModule("node:fs").rmSync(isolated.path, { recursive: true, force: true });
	if (isolated.previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = isolated.previous;
});

test("default extension factory is inert, registers each command once, and clears only owned widgets on tree/shutdown", async () => {
	const h = harness();
	expect(h.commands.size).toBe(2);
	expect([...h.commands.keys()].sort()).toEqual(["zentui", "zentui-subagents"]);
	expect(h.requests).toEqual([]);
	expect(vi.getTimerCount()).toBe(0);
	await h.emit("session_start");
	expect(h.requests).toHaveLength(1);
	h.reply(h.requests[0]);
	await vi.advanceTimersByTimeAsync(0);
	expect(h.widgets.has("zentui-subagent-summary")).toBe(true);
	await h.emit("session_tree");
	expect(h.requests).toHaveLength(2);
	expect(h.widgets.has("zentui-subagent-summary")).toBe(false);
	h.reply(h.requests[0]);
	await vi.advanceTimersByTimeAsync(0);
	expect(h.widgets.has("zentui-subagent-summary")).toBe(false);
	h.reply(h.requests[1]);
	await vi.advanceTimersByTimeAsync(0);
	await h.emit("session_shutdown");
	h.reply(h.requests[1]);
	await vi.advanceTimersByTimeAsync(10_000);
	expect([...h.widgets]).toEqual([["other", ["sentinel"]]]);
	expect(vi.getTimerCount()).toBe(0);
	expect(h.ctx.ui.setFooter).not.toHaveBeenCalled();
	expect(h.ctx.ui.setEditorComponent).not.toHaveBeenCalled();
});
test.each([{ hasUI: false }, { mode: "rpc" }, { mode: undefined }, { mode: "print" }])(
	"enabled summary fails closed in %j",
	async (context) => {
		const h = harness(context);
		await h.emit("session_start");
		await vi.advanceTimersByTimeAsync(10_000);
		expect(h.requests).toEqual([]);
		expect(h.setWidget).not.toHaveBeenCalled();
		await h.emit("session_shutdown");
	},
);
test("child and disabled sessions are inert without consulting preview JSON", async () => {
	writeFileSync(`${isolated.path}/zentui-subagents.json`, '{"enabled":true,"future":1}');
	for (const enabled of [false, true]) {
		writeFileSync(configPath, JSON.stringify(initial(enabled)));
		vi.stubEnv("PI_SUBAGENT_CHILD", enabled ? "1" : "");
		const h = harness();
		await h.emit("session_start");
		expect(h.requests).toEqual([]);
		await h.emit("session_shutdown");
	}
	expect(readFileSync(`${isolated.path}/zentui-subagents.json`, "utf8")).toBe(
		'{"enabled":true,"future":1}',
	);
});
test("failed off stops before persistence, latches through unrelated saves/tree; explicit enable releases", async () => {
	const h = harness();
	await h.emit("session_start");
	h.reply(h.requests[0]);
	await vi.advanceTimersByTimeAsync(0);
	writeFileSync(configPath, "{broken");
	await h.commands.get("zentui-subagents")?.handler("off", h.ctx);
	expect(h.widgets.has("zentui-subagent-summary")).toBe(false);
	expect(readFileSync(configPath, "utf8")).toBe("{broken");
	expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(
		expect.stringContaining("disabled this session; not saved"),
		"warning",
	);
	writeFileSync(configPath, JSON.stringify(initial()));
	await h.commands.get("zentui")?.handler("format $cwd", h.ctx);
	await h.emit("session_tree");
	await vi.advanceTimersByTimeAsync(10_000);
	expect(h.requests).toHaveLength(1);
	await h.commands.get("zentui")?.handler("subagents", h.ctx);
	expect(h.panel().render(220).join("\n")).toContain(
		"Saved: enabled. Effective: disabled. disabled this session; not saved",
	);
	await h.commands.get("zentui-subagents")?.handler("on", h.ctx);
	expect(h.requests).toHaveLength(2);
	expect(JSON.parse(readFileSync(configPath, "utf8")).future).toEqual({ keep: true });
	await h.emit("session_shutdown");
});
test("failed on never starts; menu and aliases save only canonical owner and stale menu cannot save", async () => {
	writeFileSync(configPath, JSON.stringify(initial(false)));
	const h = harness();
	await h.emit("session_start");
	writeFileSync(configPath, "bad");
	await h.commands.get("zentui-subagents")?.handler("on", h.ctx);
	expect(h.requests).toEqual([]);
	writeFileSync(configPath, JSON.stringify(initial(false)));
	await h.commands.get("zentui")?.handler("subagents", h.ctx);
	h.panel().handleInput(" ");
	expect(h.requests).toHaveLength(1);
	expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(initial(true));
	await h.commands.get("zentui-subagents")?.handler("off", h.ctx);
	expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(initial(false));
	await h.emit("session_shutdown");
	const bytes = readFileSync(configPath, "utf8");
	h.panel().handleInput(" ");
	await h.commands.get("zentui-subagents")?.handler("on", h.ctx);
	expect(readFileSync(configPath, "utf8")).toBe(bytes);
	expect(readdirSync(isolated.path).some((file) => file.endsWith(".tmp"))).toBe(false);
});
test("replacement disposes before startup await; stale startup and replies never create a poller", async () => {
	const h = harness();
	await h.emit("session_start");
	let release: (value: string) => void = () => {};
	layout.retain.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = h.emit("session_start");
	h.reply(h.requests[0]);
	await vi.advanceTimersByTimeAsync(0);
	expect(h.widgets.has("zentui-subagent-summary")).toBe(false);
	await h.emit("session_shutdown");
	release("failed");
	await pending;
	await vi.advanceTimersByTimeAsync(5000);
	expect(h.requests).toHaveLength(1);
	expect(vi.getTimerCount()).toBe(0);
});
test("controller tolerates inaccessible mode and preserves local latch until replacement", () => {
	let enabled = true;
	const h = harness();
	const controller = new SubagentSummaryController(h.pi, () => enabled);
	controller.startSession(
		Object.defineProperty({ hasUI: true }, "mode", {
			get() {
				throw new Error("inaccessible");
			},
		}) as ExtensionContext,
	);
	expect(controller.state.status).toBe("unsupported context");
	controller.setEnabled(false, () => {
		throw new Error("save");
	});
	controller.reconcile();
	expect(controller.state).toEqual({
		savedEnabled: true,
		effectiveEnabled: false,
		status: "disabled this session; not saved",
	});
	enabled = false;
	controller.reconcile();
	expect(controller.state.status).toBe("disabled this session; not saved");
	controller.startSession(h.ctx as unknown as ExtensionContext);
	expect(controller.state.status).toBe("disabled");
	controller.dispose();
});

test("successful repeated off preserves local suppression until an explicit enable", () => {
	let enabled = true;
	const h = harness();
	const controller = new SubagentSummaryController(h.pi, () => enabled);
	controller.startSession(h.ctx as unknown as ExtensionContext);
	controller.setEnabled(false, () => {
		throw new Error("failed save");
	});
	controller.setEnabled(false, () => {
		enabled = false;
	});
	expect(controller.state.status).toBe("disabled");
	enabled = true; // An unrelated reload of canonical settings must not release local suppression.
	controller.reconcile();
	expect(controller.state.effectiveEnabled).toBe(false);
	expect(h.requests).toHaveLength(1);
	controller.setEnabled(true, () => {});
	expect(controller.state.effectiveEnabled).toBe(true);
	expect(h.requests).toHaveLength(2);
	controller.dispose();
});

test("inaccessible mode explains the optional component's settings limitation", async () => {
	writeFileSync(configPath, JSON.stringify(initial(false)));
	const h = harness();
	await h.emit("session_start");
	Object.defineProperty(h.ctx, "mode", {
		get() {
			throw new Error("unavailable mode");
		},
	});
	await h.commands.get("zentui")?.handler("subagents", h.ctx);
	expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(
		expect.stringContaining("readable ctx.mode = tui"),
		"warning",
	);
	expect(h.requests).toEqual([]);
	await h.emit("session_shutdown");
});

test("confirmed all-owner migration reconciles canonical enablement but cannot release a failed-off latch", async () => {
	writeFileSync(configPath, JSON.stringify(initial(false)));
	const h = harness();
	Object.assign(h.ctx.ui, { confirm: async () => true });
	await h.emit("session_start");
	writeFileSync(configPath, JSON.stringify(initial(true)));
	await h.commands.get("zentui")?.handler("migrate", h.ctx);
	expect(h.requests).toHaveLength(1);
	writeFileSync(configPath, "{broken");
	await h.commands.get("zentui-subagents")?.handler("off", h.ctx);
	writeFileSync(configPath, JSON.stringify(initial(true)));
	await h.commands.get("zentui")?.handler("migrate", h.ctx);
	await vi.advanceTimersByTimeAsync(10_000);
	expect(h.requests).toHaveLength(1);
	await h.emit("session_shutdown");
});
