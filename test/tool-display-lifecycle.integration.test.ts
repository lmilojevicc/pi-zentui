import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionContext,
	initTheme,
	type Theme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ToolRendererResolver,
	ToolRenderers,
} from "../extensions/zentui/tool-display/host-contract.js";

const isolated = vi.hoisted(() => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	const root = `/tmp/zentui-tool-display-integration-${process.pid}`;
	process.env.PI_CODING_AGENT_DIR = joinPath(root, "agent");
	function joinPath(root: string, child: string) {
		return `${root}/${child}`;
	}
	return { previous, root };
});
const settings = vi.hoisted(() => ({
	deps: undefined as
		| Parameters<
				typeof import("../extensions/zentui/settings-command").registerZentuiSettingsCommand
		  >[1]
		| undefined,
}));
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, deps: NonNullable<typeof settings.deps>) {
		settings.deps = deps;
	},
}));

import zentui from "../extensions/zentui/index";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller";
import { PendingPreimages } from "../extensions/zentui/tool-display/pending";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets";
import type { ToolDisplayRenderContext } from "../extensions/zentui/tool-display/renderers";

const agent = join(isolated.root, "agent");
const configPath = join(agent, "zentui.json");
const workspace = join(isolated.root, "workspace");
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing test capability");
	return value;
}
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
const nativeRead = createReadToolDefinition(workspace) as unknown as ToolRenderers;
const nativeWrite = createWriteToolDefinition(workspace) as unknown as ToolRenderers;
const foreign: ToolRenderers = {
	renderCall: () => new Text("foreign call", 0, 0),
	renderResult: () => new Text("foreign result", 0, 0),
};
const result = {
	content: [{ type: "text" as const, text: "one\ntwo\nthree" }],
	details: undefined,
};
const options = { expanded: false, isPartial: false };
function row(id = "id", args: unknown = { path: "short.txt" }): ToolDisplayRenderContext {
	return {
		args,
		toolCallId: id,
		cwd: workspace,
		state: {},
		expanded: false,
		argsComplete: true,
		executionStarted: false,
		isPartial: true,
		showImages: false,
		isError: false,
		lastComponent: undefined,
		invalidate() {},
	};
}
function save(toolDisplay: object = {}) {
	writeFileSync(
		configPath,
		JSON.stringify({
			projectRefreshIntervalMs: 0,
			components: {
				editor: { enabled: false },
				userMessages: { enabled: false },
				selectorBorders: { enabled: false },
				thinkingSteps: { enabled: false },
				workingLine: { enabled: false },
				footer: { style: "native" },
				toolDisplay,
			},
		}),
	);
}
function runtime({ supported = true, skinOnly = false, order = "after" } = {}) {
	const handlers = new Map<string, Array<(event: never, ctx: ExtensionContext) => unknown>>();
	const chain: ToolRendererResolver[] = [];
	let downstream: ToolRenderers = nativeRead;
	let source = "builtin";
	const tools = new Map<string, ToolRenderers>();
	const foreignResolver: ToolRendererResolver = (name, next) =>
		name === "read" && downstream === foreign ? foreign : next();
	if (order === "before") chain.push(foreignResolver);
	const api = {
		on(name: string, fn: (event: never, ctx: ExtensionContext) => unknown) {
			handlers.set(name, [...(handlers.get(name) ?? []), fn]);
		},
		registerCommand() {},
		registerEntryRenderer() {},
		getThinkingLevel: () => "off",
		registerTool: vi.fn(),
		getAllTools: () => [
			{
				name: "read",
				sourceInfo: { source, path: source === "builtin" ? "builtin:read" : "/foreign" },
			},
			{ name: "write", sourceInfo: { source: "builtin", path: "builtin:write" } },
		],
		...(supported
			? { registerToolRenderer: vi.fn((resolver: ToolRendererResolver) => chain.push(resolver)) }
			: {}),
	};
	const ui = {
		theme,
		getEditorComponent: () => undefined,
		setEditorComponent: vi.fn(),
		setFooter: vi.fn(),
		notify: vi.fn(),
	};
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: workspace,
		getContextUsage: () => undefined,
		sessionManager: { getBranch: () => [], getSessionName: () => undefined },
		ui,
	} as unknown as ExtensionContext;
	zentui(api as never, { skinOnly });
	if (order === "after") chain.push(foreignResolver);
	const deps = required(settings.deps);
	const resolve = (name: string) => {
		const walk = (index: number): ToolRenderers | undefined =>
			index < chain.length
				? chain[index](name, () => walk(index + 1))
				: name === "read"
					? downstream
					: name === "write"
						? nativeWrite
						: tools.get(name);
		return walk(0);
	};
	return {
		api,
		ctx,
		deps,
		resolve,
		chain,
		tools,
		ui,
		foreign() {
			downstream = foreign;
		},
		foreignDefinition() {
			source = "extension";
		},
		async emit(name: string, event: object = {}) {
			for (const fn of handlers.get(name) ?? []) await fn(event as never, ctx);
		},
	};
}
beforeEach(() => {
	rmSync(isolated.root, { recursive: true, force: true });
	mkdirSync(agent, { recursive: true });
	mkdirSync(workspace);
	writeFileSync(join(workspace, "short.txt"), "original\n");
	save();
});
afterAll(() => {
	rmSync(isolated.root, { recursive: true, force: true });
	if (isolated.previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = isolated.previous;
});

describe("tool-display lifecycle integration", () => {
	it.each(["malformed", "unreadable", "missing", "config-only"])(
		"never bridges %s upstream storage; dormant saves and explicit disable remain local",
		async (kind) => {
			const upstream = join(agent, "extensions/pi-tool-display/config.json");
			mkdirSync(join(agent, "extensions/pi-tool-display"), { recursive: true });
			if (kind === "unreadable") mkdirSync(upstream);
			else if (kind !== "missing")
				writeFileSync(
					upstream,
					kind === "malformed"
						? "{bad-json"
						: '{"enabled":true,"customToolOverrides":{"keep":true}}',
				);
			const bytes =
				kind === "malformed" || kind === "config-only" ? readFileSync(upstream) : undefined;
			const h = runtime();
			await h.emit("session_start");
			expect(h.resolve("read")).toBe(nativeRead);
			required(h.deps.setToolDisplayComponent)({ readOutputMode: "preview" }, h.ctx);
			expect(required(h.deps.getToolDisplayStatus)().active).toBe(false);
			required(h.deps.setToolDisplayComponent)({ enabled: true }, h.ctx);
			expect(h.resolve("read")).not.toBe(nativeRead);
			required(h.deps.setToolDisplayComponent)({ enabled: false }, h.ctx);
			expect(h.resolve("read")).toBe(nativeRead);
			if (bytes) expect(readFileSync(upstream)).toEqual(bytes);
			else if (kind === "missing") expect(() => readFileSync(upstream)).toThrow();
			else expect(() => readFileSync(upstream)).toThrow();
			expect(h.api.registerTool).not.toHaveBeenCalled();
			await h.emit("session_shutdown", { reason: "quit" });
		},
	);
	it("enable -> hand edit -> disable applies on each intended reload with one neutral resolver per runtime", async () => {
		let old: ToolRenderers | undefined;
		for (const config of [
			{ enabled: true, style: "balanced" },
			{ enabled: true, style: "verbose" },
			{ enabled: false, style: "verbose" },
		]) {
			save(config);
			const h = runtime();
			await h.emit("session_start");
			const renderer = h.resolve("read");
			const lines = renderer
				?.renderResult?.(result, options, theme, row())
				.render(80)
				.map((line) => line.trimEnd());
			if (!config.enabled) expect(renderer).toBe(nativeRead);
			else
				expect(lines).toEqual(
					config.style === "balanced"
						? ["↳ loaded 3 lines • Ctrl+O to expand"]
						: ["one", "two", "three"],
				);
			expect(h.chain).toHaveLength(2);
			await h.emit("session_start");
			expect(h.chain).toHaveLength(2);
			await h.emit("session_shutdown", { reason: "reload" });
			expect(h.resolve("read")).toBe(nativeRead);
			old = renderer;
		}
		expect(old).toBe(nativeRead);
	});
	it.each(["before", "after"])(
		"preserves foreign rendering/definitions, late/resumed tools and metadata in %s load order",
		async (order) => {
			save({
				enabled: true,
				customToolOverrides: { mcp__demo__echo: { enabled: true, kind: "mcp" } },
			});
			const h = runtime({ order });
			await h.emit("session_start");
			h.foreign();
			expect(h.resolve("read")).toBe(foreign);
			required(h.deps.setToolDisplayComponent)({ builtinRendererOverrides: { read: true } }, h.ctx);
			if (order === "before") expect(h.resolve("read")).toBe(foreign);
			h.foreignDefinition();
			expect(h.resolve("read")).toBe(foreign);
			const resumed = h.resolve("mcp__demo__echo");
			expect(resumed?.renderCall).toBeTypeOf("function");
			const original = {
				...foreign,
				execute: vi.fn(),
				parameters: {},
				promptSnippet: "keep",
				promptGuidelines: ["keep"],
			};
			h.tools.set("mcp__demo__echo", original);
			expect(h.resolve("mcp__demo__echo")).toBe(original);
			required(h.deps.setToolDisplayComponent)(
				{
					customToolOverrides: { mcp__demo__echo: { overrideExistingRenderers: true } },
					mcpOutputMode: "summary",
				},
				h.ctx,
			);
			expect(
				h
					.resolve("mcp__demo__echo")
					?.renderResult?.(result, options, theme, row("late"))
					.render(80)
					.map((line) => line.trimEnd()),
			).toEqual(["↳ 3 lines returned • Ctrl+O to expand"]);
			expect(h.resolve("unlisted")).toBeUndefined();
			expect(original.execute).not.toHaveBeenCalled();
			expect(original.promptSnippet).toBe("keep");
			await h.emit("session_shutdown", { reason: "reload" });
			expect(h.resolve("mcp__demo__echo")).toBe(original);
		},
	);
	it.each([
		{ supported: false, skinOnly: false },
		{ supported: true, skinOnly: true },
	])("unsupported/OMP remains dormant without dependency assumptions: %j", async (host) => {
		save({ enabled: true });
		const h = runtime(host);
		await h.emit("session_start");
		expect(required(h.deps.getToolDisplayStatus)()).toMatchObject({
			available: false,
			active: false,
		});
		expect(h.resolve("read")).toBe(nativeRead);
		required(h.deps.setToolDisplayComponent)({ previewLines: 17 }, h.ctx);
		expect(JSON.parse(readFileSync(configPath, "utf8")).components.toolDisplay.previewLines).toBe(
			17,
		);
		expect(h.api.registerTool).not.toHaveBeenCalled();
		await h.emit("session_shutdown", { reason: "quit" });
	});
	it("ignores missing message content without preview reads or changes to execution", async () => {
		const h = runtime();
		await h.emit("session_start");
		await expect(
			h.emit("message_update", { message: { role: "assistant" } }),
		).resolves.toBeUndefined();
		expect(h.api.registerTool).not.toHaveBeenCalled();
		await h.emit("session_shutdown", { reason: "quit" });
	});
	it("leaves Thinking/User messages untouched and handles narrow/streaming/error/old history", async () => {
		const descriptor = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render");
		save({ enabled: true, style: "verbose" });
		const h = runtime();
		await h.emit("session_start");
		const before = JSON.parse(readFileSync(configPath, "utf8")).components;
		required(h.deps.setToolDisplayComponent)({ previewLines: 1 }, h.ctx);
		const after = JSON.parse(readFileSync(configPath, "utf8")).components;
		expect(after.thinkingSteps).toEqual(before.thinkingSteps);
		expect(after.userMessages).toEqual(before.userMessages);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")).toEqual(
			descriptor,
		);
		const renderer = required(h.resolve("read"));
		for (const width of [1, 7, 17, 40, 160]) {
			const lines = required(renderer.renderResult)(
				result,
				{ ...options, isPartial: true },
				theme,
				row(),
			).render(width);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		const errorRow = { ...row("error"), isError: true };
		expect(
			required(renderer.renderResult)(
				{ content: [{ type: "text", text: "harmless failure" }], details: undefined },
				options,
				theme,
				errorRow,
			)
				.render(80)
				.map((line) => line.trimEnd())
				.join("\n"),
		).toContain("harmless failure");
		const history = required(required(h.resolve("write")).renderCall)(
			{ path: "short.txt", content: "new\n" },
			theme,
			row("old-history"),
		);
		expect(
			stripVTControlCharacters(
				history
					.render(80)
					.map((line) => line.trimEnd())
					.join("\n"),
			),
		).toContain("no live preimage");
		await h.emit("session_shutdown", { reason: "quit" });
	});
	it.each([{ path: "s" }, {}, { path: null }, { path: 42 }, { path: "" }])(
		"F3 waits for completed same-row arguments instead of freezing streamed path %j",
		async (partial) => {
			save({ enabled: true });
			writeFileSync(join(workspace, "s"), "prefix-file must not be snapshotted\n");
			writeFileSync(join(workspace, "sample.ts"), "final-target before write\n");
			const h = runtime();
			await h.emit("session_start");
			initTheme("dark", false);
			const observe = vi.spyOn(PendingPreimages.prototype, "observe");
			try {
				const id = "streamed-write";
				const args = { path: "sample.ts", content: "final-target after write\n" };
				const messageUpdate = (arguments_: unknown) =>
					h.emit("message_update", {
						message: {
							role: "assistant",
							content: [{ type: "toolCall", id, name: "write", arguments: arguments_ }],
						},
					});
				// Pi dispatches extension events before updating the public TUI row.
				await messageUpdate({});
				const component = new ToolExecutionComponent(
					"write",
					id,
					{},
					{ showImages: false },
					h.resolve("write"),
					{ requestRender() {} } as never,
					workspace,
				);
				await messageUpdate(partial);
				component.updateArgs(partial);
				await messageUpdate(args);
				component.updateArgs(args);
				expect(observe).not.toHaveBeenCalled();
				// message_end marks arguments complete before execution-start dispatch.
				component.setArgsComplete();
				expect(observe).not.toHaveBeenCalled();
				await h.emit("tool_execution_start", { toolCallId: id, toolName: "write", args });
				expect(observe).toHaveBeenCalledExactlyOnceWith(id, "write", args, workspace);
				const cache = observe.mock.contexts[0] as PendingPreimages;
				expect(cache.get(id, "write", args, workspace)).toEqual({
					exists: true,
					content: "final-target before write\n",
				});
				expect(cache.get(id, "write", { path: "s" }, workspace)).toBeUndefined();
				expect(stripVTControlCharacters(component.render(100).join("\n"))).toContain(
					"final-target before write",
				);
				component.markExecutionStarted();
				writeFileSync(join(workspace, "sample.ts"), args.content);
				await messageUpdate(args);
				await h.emit("tool_execution_start", { toolCallId: id, toolName: "write", args });
				expect(observe).toHaveBeenCalledOnce();
				expect(cache.get(id, "write", args, workspace)?.content).toBe(
					"final-target before write\n",
				);
			} finally {
				observe.mockRestore();
				await h.emit("session_shutdown", { reason: "quit" });
			}
		},
	);
	it("F3 completed path mismatch skips collection until fresh matching pre-execution proof", () => {
		const pending = new PendingPreimages();
		const observe = vi.spyOn(pending, "observe");
		const controller = createToolDisplayController(
			{
				getAllTools: () => [
					{ name: "write", sourceInfo: { source: "builtin", path: "builtin:write" } },
				],
			},
			() => normalizeToolDisplayConfig({ enabled: true }),
			{ nativeRenderers: { write: nativeWrite }, pending },
		);
		const context = row("path-mismatch", { path: "short.txt", content: "new\n" });
		const renderer = required(controller.resolver("write", () => nativeWrite));
		required(renderer.renderCall)(context.args, theme, context);
		const args = { path: "final.txt", content: "created\n" };
		controller.observePending(
			{ toolCallId: context.toolCallId, toolName: "write", args },
			workspace,
		);
		expect(observe).not.toHaveBeenCalled();
		required(renderer.renderCall)(args, theme, { ...context, args });
		controller.observePending(
			{ toolCallId: context.toolCallId, toolName: "write", args },
			workspace,
		);
		expect(pending.get(context.toolCallId, "write", args, workspace)).toEqual({
			exists: false,
			content: "",
		});
		controller.dispose();
	});
	it("captures only proven same-call live previews and clears on tree/session/reload/release boundaries", async () => {
		save({ enabled: true });
		const h = runtime();
		await h.emit("session_start");
		const args = { path: "short.txt", content: "new\n" };
		const context = row("live", args);
		const call = required(required(h.resolve("write")).renderCall)(args, theme, context);
		await h.emit("tool_execution_start", { toolCallId: "live", toolName: "write", args });
		expect(
			call
				.render(80)
				.map((line) => line.trimEnd())
				.join("\n"),
		).toContain("original");
		for (const boundary of [
			"session_before_tree",
			"session_tree",
			"session_before_fork",
			"session_before_switch",
			"session_start",
		]) {
			await h.emit(boundary);
			expect(
				call
					.render(80)
					.map((line) => line.trimEnd())
					.join("\n"),
			).toContain("no live preimage");
		}
		required(h.deps.setToolDisplayComponent)({ enabled: false }, h.ctx);
		await h.emit("tool_execution_start", { toolCallId: "live", toolName: "write", args });
		await h.emit("session_shutdown", { reason: "new" });
		await h.emit("session_start");
		expect(required(h.deps.getToolDisplayStatus)().available).toBe(true);
		await h.emit("session_shutdown", { reason: "reload" });
		expect(h.resolve("write")).toBe(nativeWrite);
	});
});

describe("same-row pending ownership proof", () => {
	it.each([
		"fresh",
		"foreign",
		"disabled",
		"per-tool",
		"released",
		"disposed",
		"cleared",
		"nested",
		"wrong-cwd",
	])("does not collect for %s events", (reason) => {
		let config = normalizeToolDisplayConfig({ enabled: true });
		let next = nativeWrite;
		const pending = new PendingPreimages();
		const observe = vi.spyOn(pending, "observe");
		const controller = createToolDisplayController(
			{
				getAllTools: () => [
					{ name: "write", sourceInfo: { source: "builtin", path: "builtin:write" } },
				],
			},
			() => config,
			{ nativeRenderers: { write: nativeWrite }, pending },
		);
		const context = row("proof");
		const renderer = required(controller.resolver("write", () => next));
		if (reason !== "fresh") required(renderer.renderCall)(context.args, theme, context);
		if (reason === "foreign") next = foreign;
		if (reason === "disabled") config = normalizeToolDisplayConfig({ enabled: false });
		if (reason === "per-tool")
			config = normalizeToolDisplayConfig({
				enabled: true,
				registerToolOverrides: { write: false },
			});
		if (reason === "released") {
			config.enabled = false;
			required(renderer.renderCall)(context.args, theme, context)
				.render(80)
				.map((line) => line.trimEnd());
			config.enabled = true;
		}
		if (reason === "disposed") controller.dispose();
		if (reason === "cleared") controller.clearPending();
		controller.observePending(
			{
				toolCallId: "proof",
				toolName: "write",
				args: context.args,
				...(reason === "nested" ? { parentToolCallId: "parent" } : {}),
			},
			reason === "wrong-cwd" ? "/elsewhere" : workspace,
		);
		expect(observe).not.toHaveBeenCalled();
		expect(pending.size).toBe(0);
	});
	it("bounds and expires row evidence; history callbacks alone never read", () => {
		vi.useFakeTimers();
		try {
			const pending = new PendingPreimages();
			const observe = vi.spyOn(pending, "observe");
			const controller = createToolDisplayController(
				{
					getAllTools: () => [
						{ name: "write", sourceInfo: { source: "builtin", path: "builtin:write" } },
					],
				},
				() => normalizeToolDisplayConfig({ enabled: true }),
				{ nativeRenderers: { write: nativeWrite }, pending },
			);
			for (let i = 0; i < 32; i++)
				required(required(controller.resolver("write", () => nativeWrite)).renderCall)(
					row().args,
					theme,
					row(String(i)),
				)
					.render(80)
					.map((line) => line.trimEnd());
			expect(observe).not.toHaveBeenCalled();
			controller.observePending(
				{ toolCallId: "0", toolName: "write", args: row().args },
				workspace,
			);
			expect(observe).not.toHaveBeenCalled();
			vi.advanceTimersByTime(60_000);
			controller.observePending(
				{ toolCallId: "31", toolName: "write", args: row().args },
				workspace,
			);
			expect(observe).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
