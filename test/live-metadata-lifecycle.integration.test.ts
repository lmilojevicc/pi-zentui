import { type EventBus, SessionManager, type Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	config: undefined as import("../extensions/zentui/config").PolishedTuiConfig | undefined,
	hooks: undefined as Record<string, (...args: never[]) => unknown> | undefined,
}));
vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		loadConfig() {
			return runtime.config;
		},
		saveEditorComponentPatch(patch: object) {
			Object.assign(runtime.config?.components.editor ?? {}, patch);
			return runtime.config;
		},
		saveFooterComponentPatch(patch: object) {
			Object.assign(runtime.config?.components.footer ?? {}, patch);
			return runtime.config;
		},
		savePolishedEditorStylePatch(patch: object) {
			Object.assign(runtime.config?.components.editor.styles.opencode ?? {}, patch);
			return runtime.config;
		},
		saveMinimalistEditorStylePatch(patch: object) {
			Object.assign(runtime.config?.components.editor.styles.minimalist ?? {}, patch);
			return runtime.config;
		},
	};
});
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, hooks: typeof runtime.hooks) {
		runtime.hooks = hooks;
	},
}));

import { mergeConfig } from "../extensions/zentui/config";
import {
	ZENTUI_VARIABLE_CAPABILITY_EVENT,
	ZENTUI_VARIABLE_EVENT,
} from "../extensions/zentui/custom-variables";
import zentui, { type ZentuiHost } from "../extensions/zentui/index";
import { createOmpUiAdapter } from "../extensions/zentui/omp-ui";

type Editor = {
	render(width: number): string[];
	getText(): string;
	setText(text: string): void;
	getExpandedText(): string;
};
type Factory = (...args: never[]) => Editor;
type Handler = (event: unknown, ctx: unknown) => unknown;
const head = "a".repeat(40);
function harness(mode = "tui", omp = false, host: ZentuiHost = {}) {
	const exec = vi.fn(async (command: string, args: string[]) => {
		const result = (stdout: string) => ({ code: 0, stdout });
		if (command === "git") {
			if (args[1] === "--show-toplevel") return result("/project\n/project/.git\n");
			if (args[0] === "symbolic-ref") return result("feature\n");
			if (args[0] === "remote") return result("origin\tgit@github.com:owner/project.git (fetch)\n");
			if (args[1] === "--verify") return result(head);
		}
		if (command === "gh" && args[0] === "repo")
			return result(
				JSON.stringify({
					nameWithOwner: "owner/project",
					url: "https://github.com/owner/project",
					defaultBranchRef: { name: "main" },
				}),
			);
		if (command === "gh" && args[0] === "pr")
			return result(
				JSON.stringify({
					number: 42,
					url: "https://github.com/owner/project/pull/42",
					headRefOid: head,
					state: "OPEN",
					statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
				}),
			);
		throw new Error("unexpected fixture command");
	});
	const handlers = new Map<string, Handler[]>();
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	const events: EventBus = {
		emit(name, value) {
			for (const listener of listeners.get(name) ?? []) listener(value);
		},
		on(name, listener) {
			const list = listeners.get(name) ?? new Set();
			list.add(listener);
			listeners.set(name, list);
			return () => list.delete(listener);
		},
	};
	let factory: Factory | undefined;
	let editor: Editor | undefined;
	let footer: { render(width: number): string[]; dispose?(): void } | undefined;
	let text = "retained draft";
	const requestRender = vi.fn();
	const theme = {
		fg: (_color: string, value: string) => value,
		bold: (value: string) => value,
		italic: (value: string) => value,
		getThinkingBorderColor: () => (value: string) => value,
	} as unknown as Theme;
	const ui = {
		theme,
		getEditorComponent: () => factory,
		setEditorComponent(value?: Factory) {
			// The real public Pi setter transfers the current editor text to its replacement.
			const draft = editor?.getText() ?? text;
			factory = value;
			editor = value?.(
				{ requestRender, terminal: { rows: 40, columns: 140 } } as never,
				{
					borderColor: (value: string) => value,
					selectList: {
						selectedPrefix: (value: string) => value,
						selectedText: (value: string) => value,
						description: (value: string) => value,
						scrollInfo: (value: string) => value,
						noMatch: (value: string) => value,
					},
				} as never,
				{} as never,
			);
			editor?.setText(draft);
			text = draft;
		},
		getEditorText: () => editor?.getText() ?? text,
		getExpandedEditorText: () => editor?.getExpandedText() ?? text,
		setEditorText(value: string) {
			text = value;
			editor?.setText(value);
		},
		setFooter(value?: (...args: never[]) => NonNullable<typeof footer>) {
			footer?.dispose?.();
			footer = value?.(
				{ requestRender } as never,
				theme as never,
				{ getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} } as never,
			);
		},
		setStatus: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setWorkingMessage: vi.fn(),
		setWorkingVisible: vi.fn(),
	};
	const adapter = omp ? createOmpUiAdapter(ui as never) : undefined;
	const ctx = {
		mode,
		hasUI: mode === "tui",
		cwd: "/tmp/zentui-variable-test",
		ui: adapter?.ui ?? ui,
		sessionManager: SessionManager.inMemory("/tmp/zentui-variable-test"),
		model: { id: "test-model", provider: "test", contextWindow: 100_000 },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 100_000, percent: 1 }),
		isIdle: () => true,
	};
	zentui(
		{
			events,
			registerCommand() {},
			registerEntryRenderer() {},
			on(name: string, handler: Handler) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
			getThinkingLevel: () => "off",
			exec,
		} as never,
		host,
	);
	return {
		ctx,
		ui,
		exec,
		events,
		requestRender,
		registeredEvents: () => new Set(handlers.keys()),
		render: (width = 140) => editor?.render(width).join("\n") ?? "",
		editorText: () => editor?.getText() ?? text,
		renderFooter: () => footer?.render(100).join("\n") ?? "",
		async emit(name: string, payload: unknown = {}) {
			for (const handler of handlers.get(name) ?? []) await handler(payload, ctx);
			if (name === "session_shutdown") adapter?.dispose();
		},
		capability(key = "@scope/usage:quota") {
			const probe = { supported: false, active: false, key };
			events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, probe);
			return probe;
		},
		publish(value?: string) {
			events.emit(ZENTUI_VARIABLE_EVENT, { key: "@scope/usage:quota", text: value });
		},
		hook(name: string, patch: object) {
			runtime.hooks?.[name]?.(patch as never, ctx as never);
		},
	};
}

const emptyFormats = {
	topLeft: "",
	topMiddle: "",
	topRight: "",
	bottomLeft: "",
	bottomMiddle: "",
	bottomRight: "",
};
beforeEach(() => {
	vi.useFakeTimers();
	runtime.config = mergeConfig({
		projectRefreshIntervalMs: 0,
		components: {
			editor: {
				style: "minimalist",
				styles: { minimalist: { formats: { ...emptyFormats, topLeft: "$ci $token_rate" } } },
			},
			footer: {
				style: "starship",
				styles: { starship: { format: "$pr_number $ci $token_rate", responsive: false } },
			},
			userMessages: { enabled: false },
			selectorBorders: { enabled: false },
			workingLine: { enabled: false },
		},
	});
});
afterEach(() => {
	expect(vi.getTimerCount()).toBe(0);
	vi.useRealTimers();
	runtime.hooks = undefined;
});
async function settle() {
	for (let i = 0; i < 100; i++) await Promise.resolve();
}
async function streaming(h: ReturnType<typeof harness>) {
	await h.emit("agent_start");
	await h.emit("turn_start");
	await h.emit("message_update", {
		message: { role: "assistant", responseId: "one", usage: { input: 10, output: 10 } },
	});
	await vi.advanceTimersByTimeAsync(600);
	await h.emit("message_update", {
		message: { role: "assistant", responseId: "one", usage: { input: 10, output: 40 } },
	});
}
describe("live metadata event wiring and owned consumers", () => {
	it("shares one demanded collector across editor/footer and keeps reads passive", async () => {
		const h = harness();
		try {
			await h.emit("session_start");
			h.render();
			await settle();
			expect(h.render()).toContain("CI passing");
			expect(h.renderFooter()).toContain("42 CI passing");
			const calls = h.exec.mock.calls.length;
			for (let i = 0; i < 5; i++) {
				h.render();
				h.renderFooter();
			}
			expect(h.exec).toHaveBeenCalledTimes(calls);
			h.hook("setEditorComponent", { enabled: false });
			expect(h.renderFooter()).toContain("CI passing");
			h.ui.setFooter(undefined);
			await vi.advanceTimersByTimeAsync(0);
			await settle();
			expect(vi.getTimerCount()).toBe(0);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(h.exec).toHaveBeenCalledTimes(calls);
		} finally {
			await h.emit("session_shutdown");
		}
	});
	it.each([
		"model_select",
		"session_before_compact",
		"session_compact",
		"session_before_switch",
		"session_tree",
	])("clears Pi retained rate on %s", async (event) => {
		const h = harness();
		try {
			await h.emit("session_start");
			h.render();
			await streaming(h);
			expect(h.render()).toContain("50 tok/s");
			expect(h.renderFooter()).toContain("50 tok/s");
			await h.emit(event, { toolCallId: "tool", toolName: "bash" });
			expect(h.render()).not.toContain("tok/s");
			expect(h.renderFooter()).not.toContain("tok/s");
		} finally {
			await h.emit("session_shutdown");
		}
	});
	it("retains through gaps/finals/tools/idle but resets the next response to a placeholder", async () => {
		const h = harness();
		try {
			await h.emit("session_start");
			h.render();
			await streaming(h);
			await vi.advanceTimersByTimeAsync(4250);
			expect(h.render()).toContain("50 tok/s");
			expect(h.renderFooter()).toContain("50 tok/s");
			await h.emit("message_end", {
				message: {
					role: "assistant",
					responseId: "one",
					usage: { input: 10, output: 9000 },
					stopReason: "toolUse",
				},
			});
			expect(h.render()).toContain("50 tok/s");
			await h.emit("tool_execution_start", { toolCallId: "tool", toolName: "bash" });
			expect(h.renderFooter()).toContain("50 tok/s");
			await h.emit("tool_execution_end", { toolCallId: "tool" });
			await h.emit("turn_start");
			expect(h.render()).toContain("— tok/s");
			expect(h.renderFooter()).toContain("— tok/s");
			await h.emit("message_update", {
				message: { role: "assistant", responseId: "two", usage: { input: 10, output: 10 } },
			});
			await vi.advanceTimersByTimeAsync(600);
			await h.emit("message_update", {
				message: { role: "assistant", responseId: "two", usage: { input: 10, output: 40 } },
			});
			expect(h.render()).toContain("50 tok/s");
			await h.emit("message_end", {
				message: {
					role: "assistant",
					responseId: "two",
					usage: { input: 10, output: 40 },
					stopReason: "stop",
				},
			});
			expect(h.render()).toContain("50 tok/s");
			await h.emit("agent_end");
			expect(h.renderFooter()).toContain("50 tok/s");
		} finally {
			await h.emit("session_shutdown");
		}
	});
	it("keeps a short response as a placeholder, clears on session replacement, and does not retain disabled demand", async () => {
		const h = harness();
		try {
			await h.emit("session_start");
			h.render();
			await h.emit("agent_start");
			await h.emit("turn_start");
			expect(h.render()).toContain("— tok/s");
			await h.emit("message_end", {
				message: {
					role: "assistant",
					responseId: "short",
					usage: { input: 10, output: 999 },
					stopReason: "stop",
				},
			});
			await h.emit("agent_end");
			expect(h.renderFooter()).toContain("— tok/s");
			await h.emit("session_start");
			expect(h.renderFooter()).not.toContain("tok/s");
			h.render();
			await streaming(h);
			h.hook("setEditorComponent", { enabled: false });
			expect(h.renderFooter()).toContain("50 tok/s");
			h.hook("setFooterComponent", { style: "native" });
			await h.emit("agent_end");
			h.hook("setFooterComponent", { style: "starship" });
			expect(h.renderFooter()).not.toContain("tok/s");
		} finally {
			await h.emit("session_shutdown");
		}
	});
	it("honors alias-only ci without GitHub I/O on either owner", async () => {
		if (!runtime.config) throw new Error("missing config");
		Object.assign(runtime.config.components.editor.styles.minimalist, {
			formats: { ...emptyFormats, topLeft: "$ci" },
			variables: { ci: "@scope/usage:quota" },
		});
		Object.assign(runtime.config.components.footer.styles.starship, {
			format: "$ci",
			variables: { ci: "@scope/usage:quota" },
		});
		const h = harness();
		try {
			await h.emit("session_start");
			h.render();
			h.publish("publisher CI");
			await settle();
			expect(h.render()).toContain("publisher CI");
			expect(h.renderFooter()).toContain("publisher CI");
			expect(h.exec).not.toHaveBeenCalled();
		} finally {
			await h.emit("session_shutdown");
		}
	});
	it("leaves native and headless consumers unused, aborts old session work and drops old snapshots", async () => {
		if (!runtime.config) throw new Error("missing config");
		runtime.config.components.editor.enabled = false;
		runtime.config.components.footer.style = "native";
		const h = harness();
		await h.emit("session_start");
		await settle();
		expect(h.exec).not.toHaveBeenCalled();
		await h.emit("session_shutdown");
		runtime.config.components.editor.enabled = true;
		runtime.config.components.footer.style = "starship";
		const headless = harness("json");
		await headless.emit("session_start");
		await settle();
		expect(headless.exec).not.toHaveBeenCalled();
		await headless.emit("session_shutdown");
		const tui = harness();
		await tui.emit("session_start");
		tui.render();
		await settle();
		expect(tui.renderFooter()).toContain("CI passing");
		await tui.emit("session_start");
		expect(tui.renderFooter()).not.toContain("CI passing");
		await settle();
		expect(tui.renderFooter()).toContain("CI passing");
		await tui.emit("session_shutdown");
	});
	it("supports Working-only rate with editor/footer native and restores independent lifecycle", async () => {
		if (!runtime.config) throw new Error("missing config");
		runtime.config.components.editor.enabled = false;
		runtime.config.components.footer.style = "native";
		runtime.config.components.workingLine.enabled = true;
		runtime.config.components.workingLine.segments.tokenRate = true;
		const h = harness();
		try {
			await h.emit("session_start");
			await h.emit("agent_start");
			await h.emit("turn_start");
			await vi.advanceTimersByTimeAsync(100);
			const placeholder = h.ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as
				| { frames?: string[] }
				| undefined;
			expect(placeholder?.frames?.some((frame) => frame.includes("— tok/s"))).toBe(true);
			await streaming(h);
			await vi.advanceTimersByTimeAsync(100);
			const frames = h.ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as
				| { frames?: string[] }
				| undefined;
			expect(frames?.frames?.some((frame) => frame.includes("50 tok/s"))).toBe(true);
			expect(h.exec).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(4250);
			const gap = h.ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as
				| { frames?: string[] }
				| undefined;
			expect(gap?.frames?.some((frame) => frame.includes("50 tok/s"))).toBe(true);
			await h.emit("tool_execution_start", { toolCallId: "tool", toolName: "bash" });
			const duringTool = h.ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as
				| { frames?: string[] }
				| undefined;
			expect(duringTool?.frames?.some((frame) => frame.includes("tok/s"))).not.toBe(true);
			await h.emit("tool_execution_end", { toolCallId: "tool" });
			await h.emit("agent_end");
			const idle = h.ui.setWorkingIndicator.mock.calls.at(-1)?.[0] as
				| { frames?: string[] }
				| undefined;
			expect(idle?.frames?.some((frame) => frame.includes("tok/s"))).not.toBe(true);
		} finally {
			await h.emit("session_shutdown");
		}
	});
});

it("uses the existing live output estimator with a visible approximate marker", async () => {
	const h = harness();
	try {
		await h.emit("session_start");
		h.render();
		await h.emit("agent_start");
		await h.emit("turn_start");
		const update = (text: string, delta: string) => ({
			message: { role: "assistant", responseId: "estimate", content: [{ type: "text", text }] },
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta,
				partial: { content: [{ type: "text", text }] },
			},
		});
		await h.emit("message_update", update("a".repeat(40), "a".repeat(40)));
		await vi.advanceTimersByTimeAsync(600);
		await h.emit("message_update", update("a".repeat(120), "a".repeat(80)));
		expect(h.render()).toContain("~33 tok/s");
		expect(h.renderFooter()).toContain("~33 tok/s");
		await h.emit("message_end", {
			message: {
				role: "assistant",
				responseId: "estimate",
				usage: { input: 10, output: 999 },
				stopReason: "stop",
			},
		});
		await h.emit("agent_end");
		expect(h.render()).toContain("~33 tok/s");
		expect(h.renderFooter()).toContain("~33 tok/s");
	} finally {
		await h.emit("session_shutdown");
	}
});

it("generation-guards stale host subscriptions and aborts queued invalidation on shutdown", async () => {
	const callbacks: Array<() => void> = [];
	const unsubscribed = vi.fn();
	const h = harness("tui", false, {
		subscribeProjectChanges(callback) {
			callbacks.push(callback);
			return unsubscribed;
		},
	});
	try {
		await h.emit("session_start");
		h.render();
		await settle();
		callbacks[0]();
		expect(h.renderFooter()).not.toContain("CI passing");
		await settle();
		expect(h.renderFooter()).toContain("CI passing");
		await h.emit("session_start");
		h.render();
		await settle();
		callbacks[0]();
		expect(h.renderFooter()).toContain("CI passing");
		expect(unsubscribed).toHaveBeenCalledOnce();
		const calls = h.exec.mock.calls.length;
		callbacks[1]();
		expect(h.renderFooter()).not.toContain("CI passing");
		await h.emit("session_shutdown");
		await settle();
		callbacks[1]();
		await settle();
		expect(h.exec).toHaveBeenCalledTimes(calls);
		expect(unsubscribed).toHaveBeenCalledTimes(2);
	} finally {
		await h.emit("session_shutdown");
	}
});

it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
	"requires actual supported %s decoration and defers render-discovered demand",
	async (style) => {
		if (!runtime.config) throw new Error("missing config");
		runtime.config.components.editor.style = style;
		runtime.config.components.footer.style = "native";
		if (style !== "minimalist")
			runtime.config.components.editor.styles[style].metadataFormat = "$ci";
		const h = harness();
		try {
			await h.emit("session_start");
			await settle();
			expect(h.exec).not.toHaveBeenCalled();
			h.render(1);
			await settle();
			expect(h.exec).not.toHaveBeenCalled();
			h.render();
			expect(h.exec).not.toHaveBeenCalled();
			await settle();
			expect(h.render()).toContain("CI passing");
			const calls = h.exec.mock.calls.length;
			h.ui.setEditorComponent(undefined);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(h.exec).toHaveBeenCalledTimes(calls);
		} finally {
			await h.emit("session_shutdown");
		}
	},
);

it.each([false, true])(
	"does not register Pi-only pre-boundary rate hooks in OMP with metadata enabled=%s",
	(enabled) => {
		if (!runtime.config) throw new Error("missing config");
		runtime.config.components.editor.enabled = enabled;
		runtime.config.components.footer.style = enabled ? "starship" : "native";
		const omp = harness("tui", false, { skinOnly: true });
		expect(omp.registeredEvents().has("session_before_compact")).toBe(false);
		expect(omp.registeredEvents().has("session_before_switch")).toBe(false);
		const pi = harness();
		expect(pi.registeredEvents().has("session_before_compact")).toBe(true);
		expect(pi.registeredEvents().has("session_before_switch")).toBe(true);
	},
);

it("recovers rate after a mid-run model change and tool loop without another agent_start", async () => {
	const h = harness();
	try {
		await h.emit("session_start");
		h.render();
		await streaming(h);
		expect(h.render()).toContain("50 tok/s");
		await h.emit("model_select");
		expect(h.render()).not.toContain("tok/s");
		await h.emit("tool_execution_start", { toolCallId: "tool", toolName: "bash" });
		await h.emit("tool_execution_end", { toolCallId: "tool" });
		await h.emit("turn_start");
		await h.emit("message_update", {
			message: { role: "assistant", responseId: "new-model", usage: { input: 10, output: 10 } },
		});
		expect(h.render()).toContain("— tok/s");
		await vi.advanceTimersByTimeAsync(600);
		await h.emit("message_update", {
			message: { role: "assistant", responseId: "new-model", usage: { input: 10, output: 40 } },
		});
		expect(h.render()).toContain("50 tok/s");
		expect(h.renderFooter()).toContain("50 tok/s");
	} finally {
		await h.emit("session_shutdown");
	}
});
