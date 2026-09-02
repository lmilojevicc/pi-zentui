import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionContext,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThinkingStepsComponentConfig } from "../extensions/zentui/config";
import { ZENTUI_PROTOTYPE_PATCH_REGISTRY } from "../extensions/zentui/prototype-patch-registry";
import {
	THINKING_EXPERIMENTAL_MAX_TRACKED_COMPONENTS,
	ThinkingExperimentalController,
} from "../extensions/zentui/thinking-experimental";

initTheme("dark", false);

const prototype = AssistantMessageComponent.prototype;
const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "updateContent");
const identity = (text: string) => text;
const markdownTheme = Object.fromEntries(
	[
		"heading",
		"link",
		"linkUrl",
		"code",
		"codeBlock",
		"codeBlockBorder",
		"quote",
		"quoteBorder",
		"hr",
		"listBullet",
		"bold",
		"italic",
		"strikethrough",
		"underline",
	].map((key) => [key, identity]),
) as unknown as MarkdownTheme;

function message(thinking: string, timestamp = 1_000, answer?: string): AssistantMessage {
	return messageWithContent(
		[{ type: "thinking", thinking }, ...(answer ? [{ type: "text" as const, text: answer }] : [])],
		timestamp,
	);
}

function messageWithContent(
	content: AssistantMessage["content"],
	timestamp = 1_000,
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function plain(lines: string[]): string[] {
	return lines.map((line) =>
		line
			.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
			.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
			.trimEnd(),
	);
}

function context() {
	let inputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let inputRegistrations = 0;
	const stopInput = vi.fn();
	const forbidden = {
		setWorkingMessage: vi.fn(),
		setWorkingVisible: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setFooter: vi.fn(),
		setStatus: vi.fn(),
		setEditorComponent: vi.fn(),
		setHiddenThinkingLabel: vi.fn(),
	};
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			...forbidden,
			theme: { fg: (_color: string, text: string) => text },
			onTerminalInput(handler: typeof inputHandler) {
				inputRegistrations += 1;
				inputHandler = handler;
				return stopInput;
			},
		},
		sessionManager: { getEntries: () => [] },
	} as unknown as ExtensionContext;
	return {
		ctx,
		forbidden,
		input: (data: string) => inputHandler?.(data),
		inputRegistrations: () => inputRegistrations,
		stopInput,
	};
}

function component(hideThinkingBlock = false): AssistantMessageComponent {
	return new AssistantMessageComponent(
		undefined,
		hideThinkingBlock,
		markdownTheme,
		"Thinking...",
		1,
		[],
	);
}

// npm keeps Pi's own Pi-TUI package nested, while Pi's source loader deliberately
// supplies one virtual-module identity. Bridge only the unit host to model that loader.
function bridgeSourceLoadedMarkdownIdentity(): void {
	const native = originalDescriptor?.value as (this: unknown, ...args: unknown[]) => unknown;
	const constructors = new Map<string, object>([
		["Markdown", Markdown.prototype],
		["Spacer", Spacer.prototype],
		["Text", Text.prototype],
	]);
	Object.defineProperty(prototype, "updateContent", {
		...originalDescriptor,
		value: function sourceLoadedIdentityBridge(this: unknown, ...args: unknown[]) {
			const result = Reflect.apply(native, this, args);
			const children = (this as { contentContainer?: { children?: object[] } }).contentContainer
				?.children;
			for (const child of children ?? []) {
				const expected = constructors.get(child.constructor.name);
				if (expected && Object.getPrototypeOf(child) !== expected)
					Object.setPrototypeOf(child, expected);
			}
			return result;
		},
	});
}

function installLegacyThinkingRenderer(
	afterNative?: (container: { children: Component[] }, children: Component[]) => void,
): void {
	Object.defineProperty(prototype, "updateContent", {
		...originalDescriptor,
		value: function legacyThinkingChildren(
			this: { contentContainer?: { children: Component[] } },
			value: AssistantMessage,
		) {
			const children: Component[] = [new Spacer(1)];
			for (const [index, part] of value.content.entries()) {
				if (part.type === "thinking" && part.thinking.trim()) {
					children.push(
						new Markdown(part.thinking.trim(), 1, 0, markdownTheme, {
							color: identity,
							italic: true,
						}),
					);
					if (value.content.slice(index + 1).some((next) => next.type !== "toolCall")) {
						children.push(new Spacer(1));
					}
				} else if (part.type === "text" && part.text.trim()) {
					children.push(new Markdown(part.text.trim(), 1, 0, markdownTheme));
				}
			}
			const container = this.contentContainer ?? { children: [] };
			container.children = children;
			this.contentContainer = container;
			afterNative?.(container, children);
			return value;
		},
	});
}

const controllers = new Set<ThinkingExperimentalController>();

afterEach(() => {
	for (const controller of controllers) controller.shutdown();
	controllers.clear();
	if (originalDescriptor) Object.defineProperty(prototype, "updateContent", originalDescriptor);
	delete (prototype as unknown as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
	vi.useRealTimers();
});

function controller(
	config: ThinkingStepsComponentConfig,
	now: () => number = Date.now,
	requestRender = vi.fn(),
	getHostKeybindings?: () => {
		getDefinition(action: string): unknown;
		getKeys?(action: string): string[];
		matches(data: string, action: string): boolean;
	},
	getHostKeyText?: (action: string) => string,
): ThinkingExperimentalController {
	const value = new ThinkingExperimentalController(
		() => config,
		requestRender,
		now,
		getHostKeybindings,
		getHostKeyText,
	);
	controllers.add(value);
	return value;
}

describe("Thinking (Experimental) private assistant decorator", () => {
	it.each(["rail", "tree"] as const)(
		"installs %s only at enabled startup, preserves hidden native thinking, and owns no input",
		(mode) => {
			bridgeSourceLoadedMarkdownIdentity();
			const host = context();
			const value = controller({ enabled: true, mode });
			expect(value.startSession(host.ctx)).toEqual({ applied: true });
			expect(value.state).toMatchObject({ active: true, activeMode: mode });
			expect(host.inputRegistrations()).toBe(0);
			const visible = component(false);
			visible.updateContent(message("# One\n# Two", 1_000), true);
			const output = plain(visible.render(80)).join("\n");
			expect(output).toContain(mode === "rail" ? "│ • Two" : "└─ • Two");
			const hidden = component(true);
			hidden.updateContent(message("\x1b[31m# Hidden\x1b[0m", 2_000), true);
			const hiddenOutput = plain(hidden.render(80)).join("\n");
			expect(hiddenOutput).toContain("Thinking...");
			expect(hiddenOutput).not.toContain("Hidden");
		},
	);

	it.each(["rail", "tree"] as const)(
		"renders SGR-decorated thinking in %s and preserves mixed unsafe source natively",
		(mode) => {
			bridgeSourceLoadedMarkdownIdentity();
			const unsafeSource = "\x1b[38;2;137;180;250m# Native fallback\x1b[39m\x1b[2J";
			const expectedNative = component();
			expectedNative.updateContent(message(unsafeSource, 3_000), true);

			const value = controller({ enabled: true, mode });
			expect(value.startSession(context().ctx)).toEqual({ applied: true });
			const decorated = component();
			decorated.updateContent(
				message(
					"\x1b[38;2;137;180;250m# First\x1b[39m\n\x1b[38;2;186;194;222m# Second\x1b[39m",
					2_000,
				),
				true,
			);
			const decoratedRows = decorated.render(80);
			const decoratedPlain = plain(decoratedRows).join("\n");
			expect(decoratedPlain).toContain(mode === "rail" ? "│ • Second" : "└─ • Second");
			expect(decoratedRows.join("\n")).not.toContain("\x1b[38;2;137;180;250m");
			expect(decoratedRows.join("\n")).not.toContain("\x1b[38;2;186;194;222m");

			const unsafe = component();
			unsafe.updateContent(message(unsafeSource, 3_000), true);
			expect(unsafe.render(80)).toEqual(expectedNative.render(80));
		},
	);

	it("preconfigures while disabled and requires restart for first enable and post-disable re-enable", () => {
		const config: ThinkingStepsComponentConfig = { enabled: false, mode: "tree" };
		const host = context();
		const value = controller(config);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		expect(Object.getOwnPropertyDescriptor(prototype, "updateContent")).toEqual(originalDescriptor);

		config.mode = "streaming";
		expect(value.reconcile()).toEqual({ applied: true });
		config.enabled = true;
		expect(value.reconcile()).toEqual({
			applied: false,
			reason: "Saved: Streaming · Active: Native · restart required",
		});
		expect(config).toEqual({ enabled: true, mode: "streaming" });
		expect(Object.getOwnPropertyDescriptor(prototype, "updateContent")).toEqual(originalDescriptor);
		expect(value.state).toMatchObject({
			available: true,
			active: false,
			restartRequired: true,
		});
		expect(value.state.reason).toBeUndefined();
		expect(host.input("\x14")).toBeUndefined();
		expect(host.inputRegistrations()).toBe(0);
		expect(host.stopInput).not.toHaveBeenCalled();

		value.shutdown();
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		expect(prototype.updateContent).not.toBe(originalDescriptor?.value);
		expect(value.state).toMatchObject({
			available: true,
			active: true,
			restartRequired: false,
		});
		expect(host.inputRegistrations()).toBe(1);
		config.enabled = false;
		expect(value.reconcile()).toEqual({ applied: true });
		expect(value.state).toMatchObject({ active: false, restartRequired: false });
		config.enabled = true;
		expect(value.reconcile()).toMatchObject({ applied: false });
		expect(value.state).toMatchObject({ active: false, restartRequired: true });
	});

	it("switches startup Streaming to Tree to Rail live with one redraw and releases resources", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, () => 2_000, requestRender);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		const current = message("# One\n# Two\n# Three\n# Four\n# Five\n# Six", 1_000);
		(current as { stopReason: string }).stopReason = "pending";
		assistant.updateContent(current, true);
		expect(plain(assistant.render(80)).join("\n")).toContain("Thinking 0.0s");
		expect(host.inputRegistrations()).toBe(1);
		expect(vi.getTimerCount()).toBe(1);

		config.mode = "tree";
		expect(value.reconcile()).toEqual({ applied: true });
		expect(plain(assistant.render(80)).join("\n")).toContain("└─ • Six");
		expect(requestRender).toHaveBeenCalledTimes(1);
		expect(host.stopInput).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);

		config.mode = "rail";
		expect(value.reconcile()).toEqual({ applied: true });
		expect(plain(assistant.render(80)).join("\n")).toContain("│ • Six");
		expect(requestRender).toHaveBeenCalledTimes(2);
		expect(host.inputRegistrations()).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
		expect(value.reconcile()).toEqual({ applied: true });
		expect(requestRender).toHaveBeenCalledTimes(2);
		for (const method of Object.values(host.forbidden)) expect(method).not.toHaveBeenCalled();
	});

	it("keeps a structural mode active and acquires no resources when Streaming is selected", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "tree" };
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, () => 2_000, requestRender);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		assistant.updateContent(message("# One\n# Two", 1_000), true);

		config.mode = "streaming";
		expect(value.reconcile()).toEqual({
			applied: false,
			reason: "Saved: Streaming · Active: Tree · restart required",
		});
		expect(value.state).toMatchObject({
			rendererAvailable: true,
			streamingAvailable: true,
			active: true,
			activeMode: "tree",
			restartRequired: true,
		});
		expect(plain(assistant.render(80)).join("\n")).toContain("└─ • Two");
		expect(requestRender).not.toHaveBeenCalled();
		expect(host.inputRegistrations()).toBe(0);
		expect(host.stopInput).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("fails open native when startup Streaming cannot own listener cleanup", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		let leakedHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
		(
			host.ctx.ui as unknown as { onTerminalInput: (handler: typeof leakedHandler) => unknown }
		).onTerminalInput = (handler) => {
			leakedHandler = handler;
			return { notCleanup: true };
		};
		const value = controller(config);
		expect(value.startSession(host.ctx)).toMatchObject({
			applied: false,
			reason: expect.stringContaining("cleanup is unavailable"),
		});
		expect(value.state).toMatchObject({
			rendererAvailable: true,
			streamingAvailable: false,
			active: false,
			restartRequired: true,
		});
		const assistant = component();
		assistant.updateContent(message("startup native reasoning"), true);
		expect(plain(assistant.render(80)).join("\n")).toContain("startup native reasoning");
		expect(leakedHandler?.("\x14")).toBeUndefined();
		value.shutdown();
		expect(leakedHandler?.("\x14")).toBeUndefined();
	});

	it("does not fold the first pending Streaming message when timer startup fails", () => {
		let nativeChildren: Component[] | undefined;
		installLegacyThinkingRenderer((_container, children) => {
			nativeChildren = children;
		});
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		const value = controller(config, () => 2_000);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const interval = vi.spyOn(globalThis, "setInterval").mockImplementationOnce(() => {
			throw new Error("timer denied");
		});
		const assistant = component();
		const pending = message("first pending native reasoning", 1_000);
		(pending as { stopReason: string }).stopReason = "pending";
		expect(() => assistant.updateContent(pending, true)).not.toThrow();
		interval.mockRestore();

		const children = (assistant as unknown as { contentContainer: { children: Component[] } })
			.contentContainer.children;
		expect(children).toBe(nativeChildren);
		expect(children.every((child, index) => child === nativeChildren?.[index])).toBe(true);
		expect(plain(assistant.render(80)).join("\n")).toContain("first pending native reasoning");
		expect(value.state).toMatchObject({
			rendererAvailable: true,
			streamingAvailable: false,
			active: false,
			restartRequired: true,
			reason: "Pi's thinking timer is unavailable",
		});
		expect(value.diagnostics).toMatchObject({ trackedComponents: 0, activeComponents: 0 });
		expect(host.stopInput).toHaveBeenCalledTimes(1);
	});

	it("fails a live transition transactionally when a tracked layout becomes incompatible", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "rail" };
		const host = context();
		const value = controller(config, () => 5_000);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		const original = message("# Original Rail", 1_000);
		(original as { stopReason: string }).stopReason = "pending";
		assistant.updateContent(original, true);
		const tracked = (
			value as unknown as { states: WeakMap<object, { args: unknown[] }> }
		).states.get(assistant);
		expect(tracked).toBeDefined();
		if (tracked) tracked.args = [message("incompatible native replacement", 2_000), true];

		config.mode = "tree";
		const result = value.reconcile();
		expect(result).toEqual({
			applied: false,
			reason:
				"Saved: Tree · Active: Native · Renderer unavailable · restart required · Pi's private assistant renderer shape is incompatible",
		});
		expect(value.state).toMatchObject({
			available: false,
			active: false,
			restartRequired: true,
			reason: "Pi's private assistant renderer shape is incompatible",
		});
		expect(value.state.activeMode).toBeUndefined();
		expect(value.diagnostics).toMatchObject({ trackedComponents: 0, activeComponents: 0 });
		expect(plain(assistant.render(80)).join("\n")).toContain("incompatible native replacement");
		expect(host.stopInput).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("contains throwing listener cleanup while leaving the selected structural mode active", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		host.stopInput.mockImplementation(() => {
			throw new Error("cleanup denied");
		});
		const value = controller(config);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		assistant.updateContent(message("# Transition cleanup"), false);
		config.mode = "tree";
		let result: ReturnType<ThinkingExperimentalController["reconcile"]> | undefined;
		expect(() => {
			result = value.reconcile();
		}).not.toThrow();
		expect(result).toEqual({
			applied: true,
			reason:
				"Saved: Tree · Active: Tree · Streaming unavailable · Pi's terminal input listener cleanup is unavailable",
		});
		expect(value.state).toMatchObject({
			active: true,
			activeMode: "tree",
			streamingAvailable: false,
			restartRequired: false,
		});
		expect(plain(assistant.render(80)).join("\n")).toContain("└─ · Transition cleanup");
		expect(() => value.shutdown()).not.toThrow();
	});

	it("disables Streaming to native with a canonical warning when cleanup throws", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		host.stopInput.mockImplementation(() => {
			throw new Error("cleanup denied");
		});
		const value = controller(config);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		const pending = message("# Disable cleanup");
		(pending as { stopReason: string }).stopReason = "pending";
		assistant.updateContent(pending, true);
		expect(vi.getTimerCount()).toBe(1);

		config.enabled = false;
		expect(value.reconcile()).toEqual({
			applied: true,
			reason:
				"Saved: Disabled · Active: Native · Streaming unavailable · Pi's terminal input listener cleanup is unavailable",
		});
		expect(value.state).toMatchObject({
			active: false,
			streamingAvailable: false,
			streamingPoisoned: true,
			restartRequired: false,
			reason: "Pi's terminal input listener cleanup is unavailable",
		});
		expect(host.stopInput).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		expect(host.input("\x14")).toBeUndefined();
		const nativeOutput = plain(assistant.render(80)).join("\n");
		expect(nativeOutput).toContain("Disable cleanup");
		expect(nativeOutput).not.toContain("Thinking 0.0s");

		expect(value.reconcile()).toEqual({ applied: true });
		expect(host.stopInput).toHaveBeenCalledTimes(1);
		expect(value.state).toMatchObject({
			streamingAvailable: false,
			streamingPoisoned: true,
		});
	});

	it("keeps a failed timer handle inert and retries its cleanup at shutdown", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, Date.now, requestRender);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		const pending = message("# Timer cleanup");
		(pending as { stopReason: string }).stopReason = "pending";
		assistant.updateContent(pending, true);
		expect(vi.getTimerCount()).toBe(1);
		const clear = vi.spyOn(globalThis, "clearInterval").mockImplementationOnce(() => {
			throw new Error("timer cleanup denied");
		});

		config.mode = "tree";
		expect(value.reconcile()).toEqual({
			applied: true,
			reason:
				"Saved: Tree · Active: Tree · Streaming unavailable · Pi's thinking timer cleanup is unavailable",
		});
		expect(value.state).toMatchObject({
			active: true,
			activeMode: "tree",
			streamingAvailable: false,
			streamingPoisoned: true,
			restartRequired: false,
			reason: "Pi's thinking timer cleanup is unavailable",
		});
		expect(host.stopInput).toHaveBeenCalledTimes(1);
		expect(host.input("\x14")).toBeUndefined();
		expect(host.inputRegistrations()).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
		expect(
			(value as unknown as { interval?: ReturnType<typeof setInterval> }).interval,
		).toBeDefined();
		const rendersAfterTransition = requestRender.mock.calls.length;
		vi.advanceTimersByTime(2_000);
		expect(clear).toHaveBeenCalledTimes(1);
		expect(requestRender).toHaveBeenCalledTimes(rendersAfterTransition);
		expect(value.diagnostics.lastTimerWork).toBe(0);
		expect(plain(assistant.render(80)).join("\n")).toContain("└─ • Timer cleanup");

		expect(() => value.shutdown()).not.toThrow();
		expect(clear).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
		expect(
			(value as unknown as { interval?: ReturnType<typeof setInterval> }).interval,
		).toBeUndefined();
	});

	it("keeps an always-throwing cleared timer callback inert with an honest reason", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		const config: ThinkingStepsComponentConfig = { enabled: true, mode: "streaming" };
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, Date.now, requestRender);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		const pending = message("# Permanent timer cleanup");
		(pending as { stopReason: string }).stopReason = "pending";
		assistant.updateContent(pending, true);
		const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {
			throw new Error("timer cleanup denied");
		});

		config.mode = "rail";
		expect(value.reconcile()).toEqual({
			applied: true,
			reason:
				"Saved: Rail · Active: Rail · Streaming unavailable · Pi's thinking timer cleanup is unavailable",
		});
		const rendersAfterTransition = requestRender.mock.calls.length;
		vi.advanceTimersByTime(2_000);
		expect(clear).toHaveBeenCalledTimes(1);
		expect(requestRender).toHaveBeenCalledTimes(rendersAfterTransition);
		expect(host.inputRegistrations()).toBe(1);
		expect(value.state).toMatchObject({
			active: true,
			activeMode: "rail",
			streamingAvailable: false,
			streamingPoisoned: true,
			reason: "Pi's thinking timer cleanup is unavailable",
		});

		expect(() => value.shutdown()).not.toThrow();
		expect(clear).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(1);
		expect(
			(value as unknown as { interval?: ReturnType<typeof setInterval> }).interval,
		).toBeDefined();
		expect(value.state.reason).toBe("Pi's thinking timer cleanup is unavailable");
	});

	it("renders the final five native terminal rows, toggles full native reasoning, and refolds", () => {
		bridgeSourceLoadedMarkdownIdentity();
		let now = 8_100;
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const value = controller(config, () => now);
		value.startSession(host.ctx);
		const assistant = component();
		const reasoning = Array.from({ length: 8 }, (_, index) => `rendered row ${index + 1}  `).join(
			"\n",
		);
		const current = message(reasoning, 7_000, "Final **answer**");
		assistant.updateContent(current, true);
		const collapsed = plain(assistant.render(40));
		expect(collapsed).toContain(" Thinking 0.0s  (ctrl+t to expand)");
		expect(collapsed.some((line) => line.includes("rendered row 1"))).toBe(false);
		for (const row of [4, 5, 6, 7, 8])
			expect(collapsed.some((line) => line.includes(`rendered row ${row}`))).toBe(true);
		expect(collapsed.some((line) => line.includes("Final answer"))).toBe(true);

		expect(host.input("\x14")).toEqual({ consume: true });
		const expanded = plain(assistant.render(40));
		expect(expanded.some((line) => line.includes("Thinking "))).toBe(false);
		expect(expanded.some((line) => line.includes("rendered row 1"))).toBe(true);
		expect(host.input("\x14")).toEqual({ consume: true });
		expect(plain(assistant.render(40))).toContain(" Thinking 0.0s  (ctrl+t to expand)");

		now = 12_300;
		assistant.updateContent(current, false);
		const completed = plain(assistant.render(40));
		expect(completed).toContain(" Thought for 4.2s  (ctrl+t to expand)");
		expect(completed.filter((line) => line.includes("rendered row"))).toEqual([]);
	});

	it("maps equal and colliding text/thinking sources by exact ordered child identity", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const value = controller(config, () => 2_000);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });

		const collision = component();
		collision.updateContent(
			messageWithContent([
				{ type: "thinking", thinking: "A" },
				{ type: "text", text: "B" },
				{ type: "thinking", thinking: "B" },
			]),
			false,
		);
		const collisionFolded = plain(collision.render(80)).join("\n");
		expect(collisionFolded).toContain("Thought");
		expect(collisionFolded).not.toMatch(/^ A$/m);
		expect(collisionFolded.match(/^ B$/gm)).toHaveLength(1);
		expect(host.input("\x14")).toEqual({ consume: true });
		const collisionExpanded = plain(collision.render(80)).join("\n");
		expect(collisionExpanded.match(/^ A$/gm)).toHaveLength(1);
		expect(collisionExpanded.match(/^ B$/gm)).toHaveLength(2);
		expect(host.input("\x14")).toEqual({ consume: true });

		const equal = component();
		equal.updateContent(
			messageWithContent([
				{ type: "text", text: "SAME" },
				{ type: "thinking", thinking: "SAME" },
			]),
			false,
		);
		const equalFolded = plain(equal.render(80)).join("\n");
		expect(equalFolded.match(/^ SAME$/gm)).toHaveLength(1);
		expect(equalFolded).toContain("Thought");
		expect(host.input("\x14")).toEqual({ consume: true });
		expect(
			plain(equal.render(80))
				.join("\n")
				.match(/^ SAME$/gm),
		).toHaveLength(2);
	});

	it("coalesces contiguous thinking and preserves separated runs across tool-only boundaries", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const value = controller(config);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const contiguous = component();
		contiguous.updateContent(
			messageWithContent([
				{ type: "thinking", thinking: "contiguous A" },
				{ type: "thinking", thinking: "contiguous B" },
			]),
			false,
		);
		const contiguousFolded = plain(contiguous.render(80)).join("\n");
		expect(contiguousFolded).toContain("Thought");
		expect(contiguousFolded).not.toContain("contiguous A");
		expect(contiguousFolded).not.toContain("contiguous B");

		const separated = component();
		separated.updateContent(
			messageWithContent([
				{ type: "thinking", thinking: "separated A" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: {} },
				{ type: "thinking", thinking: "separated B" },
			]),
			false,
		);
		const separatedFolded = plain(separated.render(80)).join("\n");
		expect(separatedFolded.match(/Thought/g)).toHaveLength(1);
		expect(separatedFolded).not.toContain("separated A");
		expect(separatedFolded).not.toContain("separated B");
		expect(host.input("\x14")).toEqual({ consume: true });
		const separatedExpanded = plain(separated.render(80)).join("\n");
		expect(separatedExpanded).toContain("separated A");
		expect(separatedExpanded).toContain("separated B");
	});

	it.each(["rail", "tree"] as const)(
		"groups a legacy adjacent thinking run into one %s title and run-level selection",
		(mode) => {
			installLegacyThinkingRenderer();
			const value = controller({ enabled: true, mode });
			expect(value.startSession(context().ctx)).toEqual({ applied: true });
			const assistant = component();
			assistant.updateContent(
				messageWithContent([
					{
						type: "thinking",
						thinking: ["# Legacy 1", "# Legacy 2", "# Legacy 3", "# Legacy 4"].join("\n"),
					},
					{
						type: "thinking",
						thinking: ["# Legacy 5", "# Legacy 6", "# Legacy 7", "# Legacy 8"].join("\n"),
					},
				]),
				true,
			);
			const output = plain(assistant.render(80));
			const titleRows = output.filter((row) => row.includes("Thinking"));
			const labelRows = output.filter((row) => row.includes("Legacy"));
			expect(titleRows).toHaveLength(1);
			expect(labelRows).toHaveLength(mode === "rail" ? 8 : 5);
			expect(labelRows.at(0)).toContain(mode === "rail" ? "Legacy 1" : "Legacy 4");
			expect(labelRows.at(-1)).toContain("Legacy 8");
			const titleIndex = output.findIndex((row) => row.includes("Thinking"));
			expect(output.slice(titleIndex, titleIndex + labelRows.length + 1)).not.toContain("");
		},
	);

	it.each(["modern", "legacy"] as const)(
		"marks only an actually open final thinking run in exact %s streaming layouts",
		(layout) => {
			if (layout === "modern") bridgeSourceLoadedMarkdownIdentity();
			else installLegacyThinkingRenderer();
			for (const mode of ["rail", "tree"] as const) {
				const value = controller({ enabled: true, mode });
				expect(value.startSession(context().ctx)).toEqual({ applied: true });
				const fixtures = [
					{
						name: "thinking→text→thinking",
						content: [
							{ type: "thinking" as const, thinking: "# Before" },
							{ type: "text" as const, text: "boundary" },
							{ type: "thinking" as const, thinking: "# After" },
						],
						rail: [" │ Thinking", " │ Before", " boundary", " │ Thinking", " │ • After"],
						tree: [" ┆ Thinking", " └─ · Before", " boundary", " ┆ Thinking", " └─ • After"],
					},
					{
						name: "thinking→tool→thinking",
						content: [
							{ type: "thinking" as const, thinking: "# Before" },
							{ type: "toolCall" as const, id: "tool", name: "read", arguments: {} },
							{ type: "thinking" as const, thinking: "# After" },
						],
						rail: [" │ Thinking", " │ Before", " │ Thinking", " │ • After"],
						tree: [" ┆ Thinking", " └─ · Before", " ┆ Thinking", " └─ • After"],
					},
					{
						name: "thinking→text",
						content: [
							{ type: "thinking" as const, thinking: "# Before" },
							{ type: "text" as const, text: "boundary" },
						],
						rail: [" │ Thinking", " │ Before", " boundary"],
						tree: [" ┆ Thinking", " └─ · Before", " boundary"],
					},
				] as const;
				for (const fixture of fixtures) {
					const assistant = component();
					assistant.updateContent(messageWithContent([...fixture.content]), true);
					const exactRows = plain(assistant.render(80)).filter(Boolean);
					expect(exactRows, `${layout} ${mode} ${fixture.name}`).toEqual(fixture[mode]);
				}
				value.shutdown();
				controllers.delete(value);
			}
		},
	);

	it("does not invoke an accessor setter that mutates native children before throwing", () => {
		let originalChildren: Component[] = [];
		const setter = vi.fn((replacement: Component[]) => {
			originalChildren.splice(0, originalChildren.length, ...replacement);
			throw new Error("atomic replacement rejected");
		});
		installLegacyThinkingRenderer((container, children) => {
			originalChildren = children;
			Object.defineProperty(container, "children", {
				configurable: true,
				get: () => children,
				set: setter,
			});
		});
		const value = controller({ enabled: true, mode: "rail" });
		value.startSession(context().ctx);
		const assistant = component();
		expect(() =>
			assistant.updateContent(
				messageWithContent([
					{ type: "thinking", thinking: "# Atomic 1" },
					{ type: "thinking", thinking: "# Atomic 2" },
				]),
				true,
			),
		).not.toThrow();
		const children = (assistant as unknown as { contentContainer: { children: Component[] } })
			.contentContainer.children;
		expect(setter).not.toHaveBeenCalled();
		expect(children).toBe(originalChildren);
		expect(children.map((child) => child.constructor.name)).toEqual([
			"Spacer",
			"Markdown",
			"Spacer",
			"Markdown",
		]);
		expect(children.some((child) => child.constructor.name === "ThinkingStepsRows")).toBe(false);
		expect(value.diagnostics.trackedComponents).toBe(0);
	});

	it.each(["nonwritable", "inherited"] as const)(
		"retains native identity and output for a %s children property",
		(shape) => {
			let originalChildren: Component[] = [];
			installLegacyThinkingRenderer((container, children) => {
				originalChildren = children;
				if (shape === "nonwritable") {
					Object.defineProperty(container, "children", {
						configurable: true,
						writable: false,
						value: children,
					});
				} else {
					delete (container as { children?: Component[] }).children;
					const inherited = Object.create(Object.getPrototypeOf(container)) as {
						children: Component[];
					};
					inherited.children = children;
					Object.setPrototypeOf(container, inherited);
				}
			});
			const value = controller({ enabled: true, mode: "tree" });
			value.startSession(context().ctx);
			const assistant = component();
			assistant.updateContent(message("# Native identity"), true);
			const container = (assistant as unknown as { contentContainer: { children: Component[] } })
				.contentContainer;
			expect(container.children).toBe(originalChildren);
			const output = plain(assistant.render(80)).join("\n");
			expect(output).toContain("Native identity");
			expect(output).not.toMatch(/[│┆][ •]? Thinking|[└├]─/);
			expect(value.diagnostics.trackedComponents).toBe(0);
		},
	);

	it("propagates the predecessor's exact thrown object without decoration containment", () => {
		const marker = { source: "predecessor" };
		Object.defineProperty(prototype, "updateContent", {
			...originalDescriptor,
			value() {
				throw marker;
			},
		});
		const value = controller({ enabled: true, mode: "tree" });
		value.startSession(context().ctx);
		let caught: unknown;
		try {
			component().updateContent(message("# Never decorated"), true);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBe(marker);
		expect(value.diagnostics.trackedComponents).toBe(0);
	});

	it.each([
		["rail", "hidden"],
		["rail", "no-thinking"],
		["tree", "hidden"],
		["tree", "no-thinking"],
	] as const)(
		"drops stale %s state when an authoritative %s predecessor mutates then throws",
		(mode, transition) => {
			bridgeSourceLoadedMarkdownIdentity();
			const native = prototype.updateContent;
			const marker = { source: `${mode}-${transition}` };
			let throwAfterMutation = false;
			Object.defineProperty(prototype, "updateContent", {
				...Object.getOwnPropertyDescriptor(prototype, "updateContent"),
				value: function mutateThenThrow(this: unknown, ...args: unknown[]) {
					const result = Reflect.apply(native, this, args);
					if (throwAfterMutation) throw marker;
					return result;
				},
			});
			const requestRender = vi.fn();
			const value = controller({ enabled: true, mode }, Date.now, requestRender);
			value.startSession(context().ctx);
			const assistant = component(false);
			const stale = message("# Stale custom thinking", 84_000);
			value.beginMessage({ message: stale });
			assistant.updateContent(stale, true);
			expect(value.diagnostics).toMatchObject({ trackedComponents: 1, activeComponents: 1 });

			const authoritative =
				transition === "hidden" ? stale : message("", 84_001, "Authoritative text after failure");
			if (transition === "hidden")
				(assistant as unknown as { hideThinkingBlock: boolean }).hideThinkingBlock = true;
			throwAfterMutation = true;
			let caught: unknown;
			try {
				assistant.updateContent(authoritative, false);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBe(marker);
			expect(value.diagnostics).toMatchObject({ trackedComponents: 0, activeComponents: 0 });
			expect((value as unknown as { timings: Map<number, unknown> }).timings.has(84_000)).toBe(
				false,
			);
			expect(
				(value as unknown as { currentMessage?: AssistantMessage }).currentMessage,
			).toBeUndefined();
			expect(requestRender).not.toHaveBeenCalled();

			value.shutdown();
			expect(requestRender).not.toHaveBeenCalled();
			const output = plain(assistant.render(80)).join("\n");
			if (transition === "hidden") {
				expect(output).toContain("Thinking...");
				expect(output).not.toContain("Stale custom thinking");
			} else {
				expect(output).toContain("Authoritative text after failure");
				expect(output).not.toContain("Stale custom thinking");
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"drops %s ownership after a visible-to-native-hidden authoritative host update",
		(mode) => {
			bridgeSourceLoadedMarkdownIdentity();
			const value = controller({ enabled: true, mode });
			value.startSession(context().ctx);
			const assistant = component(false);
			const current = message("# Visible\n# Latest", 81_000);
			assistant.updateContent(current, true);
			expect(value.diagnostics.trackedComponents).toBe(1);
			assistant.setHideThinkingBlock(true);
			assistant.updateContent(current, true);
			expect(value.diagnostics).toMatchObject({ trackedComponents: 0, activeComponents: 0 });
			expect((value as unknown as { timings: Map<number, unknown> }).timings.has(81_000)).toBe(
				false,
			);
			value.shutdown();
			const rendered = plain(assistant.render(80)).join("\n");
			expect(rendered).toContain("Thinking...");
			expect(rendered).not.toContain("Visible");
		},
	);

	it.each(["rail", "tree"] as const)(
		"does not replay stale visible %s args when native-hidden ownership is displaced",
		(mode) => {
			bridgeSourceLoadedMarkdownIdentity();
			const value = controller({ enabled: true, mode });
			value.startSession(context().ctx);
			const assistant = component(false);
			const current = message("# Stale visible", 82_000);
			assistant.updateContent(current, true);
			assistant.setHideThinkingBlock(true);
			assistant.updateContent(current, true);
			const zentuiWrapper = prototype.updateContent;
			Object.defineProperty(prototype, "updateContent", {
				...Object.getOwnPropertyDescriptor(prototype, "updateContent"),
				value: function successor(this: unknown, ...args: unknown[]) {
					return Reflect.apply(zentuiWrapper, this, args);
				},
			});
			expect(value.state.displaced).toBe(true);
			const rendered = plain(assistant.render(80)).join("\n");
			expect(rendered).toContain("Thinking...");
			expect(rendered).not.toContain("Stale visible");
		},
	);

	it.each(["streaming", "rail", "tree"] as const)(
		"drops %s ownership on an authoritative thinking-to-no-thinking update",
		(mode) => {
			bridgeSourceLoadedMarkdownIdentity();
			const value = controller({ enabled: true, mode });
			value.startSession(context().ctx);
			const assistant = component();
			assistant.updateContent(message("# Old thinking", 83_000), true);
			expect(value.diagnostics.trackedComponents).toBe(1);
			assistant.updateContent(message("", 83_001, "Authoritative text only"), false);
			expect(value.diagnostics).toMatchObject({ trackedComponents: 0, activeComponents: 0 });
			expect((value as unknown as { timings: Map<number, unknown> }).timings.has(83_000)).toBe(
				false,
			);
			value.shutdown();
			const rendered = plain(assistant.render(80)).join("\n");
			expect(rendered).toContain("Authoritative text only");
			expect(rendered).not.toContain("Old thinking");
		},
	);

	it("keeps Streaming temporarily visible while active, then restores the latest native-hidden state", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const value = controller({ enabled: true, mode: "streaming" }, () => 90_000);
		value.startSession(context().ctx);
		const assistant = component(false);
		const current = message("# Temporarily shown", 89_000);
		assistant.updateContent(current, true);
		assistant.setHideThinkingBlock(true);
		assistant.updateContent(current, true);
		expect(value.diagnostics.trackedComponents).toBe(1);
		expect(plain(assistant.render(80)).join("\n")).toContain("Thinking 0.0s");
		value.shutdown();
		const rendered = plain(assistant.render(80)).join("\n");
		expect(rendered).toContain("Thinking...");
		expect(rendered).not.toContain("Temporarily shown");
	});

	it.each(["count", "order", "text", "constructor"] as const)(
		"fails open through one marker-free native rerender on a %s mismatch",
		(mismatch) => {
			bridgeSourceLoadedMarkdownIdentity();
			const bridged = prototype.updateContent as (this: unknown, ...args: unknown[]) => unknown;
			let calls = 0;
			Object.defineProperty(prototype, "updateContent", {
				...Object.getOwnPropertyDescriptor(prototype, "updateContent"),
				value: function mismatchedNative(this: unknown, ...args: unknown[]) {
					calls += 1;
					const result = Reflect.apply(bridged, this, args);
					if (calls !== 1) return result;
					const children = (
						this as { contentContainer?: { children?: Array<Record<string, unknown>> } }
					).contentContainer?.children;
					if (!children) return result;
					const markdownIndexes = children.flatMap((child, index) =>
						child.constructor === Markdown ? [index] : [],
					);
					if (mismatch === "count") children.pop();
					else if (mismatch === "order") {
						const first = markdownIndexes[0];
						const second = markdownIndexes[1];
						if (first !== undefined && second !== undefined)
							[children[first], children[second]] = [children[second], children[first]];
					} else {
						const first = markdownIndexes[0];
						const child = first === undefined ? undefined : children[first];
						if (child && mismatch === "text") child.text = "__ZENTUI_MISMATCH_MARKER__";
						if (child && mismatch === "constructor") Object.setPrototypeOf(child, {});
					}
					return result;
				},
			});
			const config: ThinkingStepsComponentConfig = {
				enabled: true,
				mode: "streaming",
			};
			const value = controller(config);
			expect(value.startSession(context().ctx)).toEqual({ applied: true });
			const assistant = component();
			assistant.updateContent(
				messageWithContent([
					{ type: "thinking", thinking: "native A" },
					{ type: "text", text: "native B" },
					{ type: "thinking", thinking: "native C" },
				]),
				false,
			);
			expect(calls).toBe(2);
			expect(value.state).toMatchObject({ available: false, active: false });
			const rendered = plain(assistant.render(80)).join("\n");
			expect(rendered).toContain("native A");
			expect(rendered).toContain("native B");
			expect(rendered).toContain("native C");
			expect(rendered).not.toMatch(/Thinking \d|Thought(?: for)?|ZENTUI_MISMATCH_MARKER/);
		},
	);

	it("omits the expansion hint when a live render does not overflow", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const value = controller(config, () => 2_000);
		value.startSession(host.ctx);
		const assistant = component();
		assistant.updateContent(message("one  \ntwo", 1_000), true);
		const rendered = plain(assistant.render(80)).join("\n");
		expect(rendered).toContain("Thinking 0.0s");
		expect(rendered).not.toContain("to expand");
	});

	it("coalesces activation, timer, completion, and deactivation redraws", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, Date.now, requestRender);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		expect(requestRender).toHaveBeenCalledTimes(0);

		const current = message("live redraw reasoning", 5_000);
		(current as { stopReason: string }).stopReason = "pending";
		value.beginMessage({ message: current });
		const assistant = component();
		assistant.updateContent(current, true);
		expect(requestRender).toHaveBeenCalledTimes(0);
		vi.advanceTimersByTime(1_000);
		expect(requestRender).toHaveBeenCalledTimes(1);
		value.updateMessage({ message: current, assistantMessageEvent: { type: "text_delta" } });
		expect(requestRender).toHaveBeenCalledTimes(2);
		expect(plain(assistant.render(40)).join("\n")).toContain("Thought for 1.0s");

		config.enabled = false;
		expect(value.reconcile()).toEqual({ applied: true });
		expect(value.state).toMatchObject({ active: false, restartRequired: false });
		value.shutdown();
		expect(requestRender).toHaveBeenCalledTimes(3);
		expect(plain(assistant.render(40)).join("\n")).not.toMatch(/Thinking \d|Thought for/);
		expect(plain(assistant.render(40)).join("\n")).toContain("live redraw reasoning");
	});

	it("freezes on stream boundaries, uses Thought without invented restored duration, and cleans resources", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, Date.now, requestRender);
		value.startSession(host.ctx);
		const current = message("private reasoning", 5_000);
		value.beginMessage({ message: current });
		const assistant = component();
		assistant.updateContent(current, true);
		const beforeTimer = requestRender.mock.calls.length;
		vi.advanceTimersByTime(1_000);
		expect(requestRender.mock.calls.length - beforeTimer).toBe(1);
		value.updateMessage({ message: current, assistantMessageEvent: { type: "text_delta" } });
		vi.setSystemTime(20_000);
		assistant.updateContent(current, true);
		expect(plain(assistant.render(80)).join("\n")).toContain("Thought for 1.0s");

		const restored = component();
		restored.updateContent(message("old reasoning", 99), false);
		expect(plain(restored.render(80)).join("\n")).toContain("Thought  (ctrl+t to expand)");
		expect(plain(restored.render(80)).join("\n")).not.toContain("Thought for");

		config.enabled = false;
		expect(value.reconcile()).toEqual({ applied: true });
		expect(value.state).toMatchObject({ active: false, restartRequired: false });
		value.shutdown();
		expect(plain(assistant.render(80)).join("\n")).toContain("private reasoning");
		expect(host.stopInput).toHaveBeenCalledTimes(1);
		for (const method of Object.values(host.forbidden)) expect(method).not.toHaveBeenCalled();
	});

	it("refreshes Pi's latest visible↔hidden preference on every host update and restores ownership", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const value = controller(config, () => 2_000);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		const reasoning = message(
			Array.from({ length: 8 }, (_, index) => `preference row ${index + 1}  `).join("\n"),
			1_000,
		);
		const visibleToHidden = component(false);
		const visibleToHiddenState = visibleToHidden as unknown as { hideThinkingBlock: boolean };
		visibleToHidden.updateContent(reasoning, true);
		visibleToHidden.setHideThinkingBlock(true);
		visibleToHidden.updateContent(reasoning, true);
		expect(Object.hasOwn(visibleToHidden, "hideThinkingBlock")).toBe(true);
		expect(visibleToHiddenState.hideThinkingBlock).toBe(true);
		expect(plain(visibleToHidden.render(80)).join("\n")).toContain("Thinking 0.0s");

		const hiddenToVisible = component(true);
		const hiddenToVisibleState = hiddenToVisible as unknown as { hideThinkingBlock: boolean };
		hiddenToVisible.updateContent(reasoning, true);
		hiddenToVisible.setHideThinkingBlock(false);
		hiddenToVisible.updateContent(reasoning, true);
		expect(Object.hasOwn(hiddenToVisible, "hideThinkingBlock")).toBe(true);
		expect(hiddenToVisibleState.hideThinkingBlock).toBe(false);
		expect(plain(hiddenToVisible.render(80)).join("\n")).toContain("Thinking 0.0s");

		config.enabled = false;
		expect(value.reconcile()).toEqual({ applied: true });
		expect(value.state).toMatchObject({ active: false, restartRequired: false });
		value.shutdown();
		const hiddenNative = plain(visibleToHidden.render(80)).join("\n");
		expect(hiddenNative).toContain("Thinking...");
		expect(hiddenNative).not.toContain("preference row");
		expect(Object.hasOwn(visibleToHidden, "hideThinkingBlock")).toBe(true);
		expect(visibleToHiddenState.hideThinkingBlock).toBe(true);
		const visibleNative = plain(hiddenToVisible.render(80)).join("\n");
		expect(visibleNative).toContain("preference row 1");
		expect(visibleNative).not.toMatch(/Thinking \d|Thought(?: for)?/);
		expect(Object.hasOwn(hiddenToVisible, "hideThinkingBlock")).toBe(true);
		expect(hiddenToVisibleState.hideThinkingBlock).toBe(false);

		value.shutdown();
		expect(visibleToHiddenState.hideThinkingBlock).toBe(true);
		expect(hiddenToVisibleState.hideThinkingBlock).toBe(false);
		for (const method of Object.values(host.forbidden)) expect(method).not.toHaveBeenCalled();
	});

	it("honors discovered remaps, falls back only without a definition, and ignores key releases", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const remapped = {
			getDefinition: vi.fn(() => ({ defaultKeys: "ctrl+y" })),
			getKeys: vi.fn(() => ["ctrl+y"]),
			matches: vi.fn((data: string) => data === "\x19" || data.includes("121;5")),
		};
		const host = context();
		const value = controller(
			config,
			Date.now,
			vi.fn(),
			() => remapped,
			() => "ctrl+y",
		);
		value.startSession(host.ctx);
		const assistant = component();
		assistant.updateContent(message("remapped reasoning", 1_000), true);
		expect(host.input("\x14")).toBeUndefined();
		expect(plain(assistant.render(80)).join("\n")).toContain("Thinking");
		expect(host.input("\x19")).toEqual({ consume: true });
		expect(plain(assistant.render(80)).join("\n")).toContain("remapped reasoning");
		expect(host.input("\x1b[121;5:3u")).toEqual({ consume: true });
		expect(plain(assistant.render(80)).join("\n")).toContain("remapped reasoning");
		expect(host.input("\x19")).toEqual({ consume: true });
		expect(plain(assistant.render(80)).join("\n")).toContain("Thinking");

		value.shutdown();
		controllers.delete(value);
		const fallbackHost = context();
		const fallback = controller(config, Date.now, vi.fn(), () => ({
			getDefinition: () => undefined,
			matches: () => false,
		}));
		fallback.startSession(fallbackHost.ctx);
		const fallbackAssistant = component();
		fallbackAssistant.updateContent(message("fallback reasoning", 2_000), true);
		expect(fallbackHost.input("\x14")).toEqual({ consume: true });
		expect(plain(fallbackAssistant.render(80)).join("\n")).toContain("fallback reasoning");
	});

	it("accepts symbol and modified-symbol bindings and uses labels only when provided", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const cases = [
			{ key: "?", data: "question", keyText: "Question mark", label: "Question mark" },
			{ key: "/", data: "slash", keyText: "", label: "/" },
			{ key: "-", data: "minus", keyText: "   ", label: "-" },
			{ key: "ctrl+]", data: "modified-bracket", keyText: "Ctrl+]", label: "Ctrl+]" },
		] as const;
		for (const testCase of cases) {
			const host = context();
			const bindings = {
				getDefinition: vi.fn(() => ({})),
				getKeys: vi.fn(() => [testCase.key]),
				matches: vi.fn((data: string) => data === testCase.data),
			};
			const value = controller(
				config,
				Date.now,
				vi.fn(),
				() => bindings,
				() => testCase.keyText,
			);
			expect(value.startSession(host.ctx)).toEqual({ applied: true });
			const assistant = component();
			assistant.updateContent(
				message(Array.from({ length: 8 }, (_, index) => `symbol row ${index + 1}`).join("\n")),
				true,
			);
			expect(plain(assistant.render(80)).join("\n")).toContain(`(${testCase.label} to expand)`);
			expect(host.input(testCase.data)).toEqual({ consume: true });
			expect(bindings.matches).toHaveBeenCalledWith(testCase.data, "app.thinking.toggle");
			expect(plain(assistant.render(80)).join("\n")).toContain("symbol row 1");
			value.shutdown();
			controllers.delete(value);
		}
	});

	it("rejects empty and nonstring bindings and deactivates on a throwing matcher", () => {
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		for (const keys of [[], [""], [null], [42]]) {
			const value = controller(config, Date.now, vi.fn(), () => ({
				getDefinition: () => ({}),
				getKeys: () => keys as unknown as string[],
				matches: () => false,
			}));
			expect(value.startSession(context().ctx)).toMatchObject({
				applied: false,
				reason: expect.stringContaining("no usable configured binding"),
			});
			expect(value.state).toMatchObject({
				rendererAvailable: true,
				streamingAvailable: false,
				active: false,
			});
			value.shutdown();
			controllers.delete(value);
		}

		bridgeSourceLoadedMarkdownIdentity();
		const host = context();
		const throwing = controller(
			config,
			Date.now,
			vi.fn(),
			() => ({
				getDefinition: () => ({}),
				getKeys: () => ["ctrl+y"],
				matches: () => {
					throw new Error("matcher failure");
				},
			}),
			() => "ctrl+y",
		);
		expect(throwing.startSession(host.ctx)).toEqual({ applied: true });
		const assistant = component();
		assistant.updateContent(message("must restore native", 3_000), true);
		expect(plain(assistant.render(80)).join("\n")).toContain("Thinking");
		expect(host.input("\x19")).toBeUndefined();
		expect(throwing.state).toMatchObject({
			rendererAvailable: true,
			streamingAvailable: false,
			active: false,
			reason: "Pi's thinking-toggle matcher failed at runtime",
		});
		const restored = plain(assistant.render(80)).join("\n");
		expect(restored).toContain("must restore native");
		expect(restored).not.toMatch(/Thinking \d|Thought(?: for)?/);
	});

	it("bounds settled history, restores an evicted native-hidden fold, and times only active refs", () => {
		bridgeSourceLoadedMarkdownIdentity();
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const requestRender = vi.fn();
		const value = controller(config, Date.now, requestRender);
		expect(value.startSession(context().ctx)).toEqual({ applied: true });
		const first = component(true);
		first.updateContent(message("evicted native-hidden reasoning", 1), false);
		for (let index = 1; index <= THINKING_EXPERIMENTAL_MAX_TRACKED_COMPONENTS; index += 1) {
			component().updateContent(message(`settled reasoning ${index}`, index + 1), false);
		}
		expect(value.diagnostics).toMatchObject({
			trackedComponents: THINKING_EXPERIMENTAL_MAX_TRACKED_COMPONENTS,
			activeComponents: 0,
		});
		const restored = plain(first.render(80)).join("\n");
		expect(restored).toContain("Thinking...");
		expect(restored).not.toContain("evicted native-hidden reasoning");
		expect((first as unknown as { hideThinkingBlock: boolean }).hideThinkingBlock).toBe(true);

		const live = component();
		const pending = message("only active timer work", 50_000);
		(pending as { stopReason: string }).stopReason = "pending";
		live.updateContent(pending, true);
		expect(value.diagnostics).toMatchObject({
			trackedComponents: THINKING_EXPERIMENTAL_MAX_TRACKED_COMPONENTS,
			activeComponents: 1,
		});
		vi.advanceTimersByTime(1_000);
		expect(value.diagnostics.lastTimerWork).toBe(1);
		value.updateMessage({ message: pending, assistantMessageEvent: { type: "text_delta" } });
		expect(value.diagnostics.activeComponents).toBe(0);
	});

	it("bounds current-session timings even for text-only assistant events", () => {
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const value = controller(config, () => 50_000);
		value.startSession(context().ctx);
		for (let index = 0; index < 300; index += 1) {
			const textOnly = message("", index + 1, `answer ${index}`);
			textOnly.content = [{ type: "text", text: `answer ${index}` }];
			value.beginMessage({ message: textOnly });
			value.endMessage({ message: textOnly });
		}
		const timings = (value as unknown as { timings: Map<number, unknown> }).timings;
		expect(timings.size).toBe(256);
		expect(timings.has(1)).toBe(false);
		expect(timings.has(300)).toBe(true);
	});

	it("derives a pending live render without a boolean argument and keeps completed messages settled", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const value = controller(config, () => 5_000);
		value.startSession(context().ctx);
		const live = message("live no-argument reasoning", 4_000);
		(live as { stopReason: string }).stopReason = "pending";
		const liveAssistant = component();
		liveAssistant.updateContent(live);
		expect(plain(liveAssistant.render(80)).join("\n")).toContain("Thinking 0.0s");

		const completed = component();
		completed.updateContent(message("completed no-argument reasoning", 3_000));
		expect(plain(completed.render(80)).join("\n")).toContain("Thought");
		expect(plain(completed.render(80)).join("\n")).not.toContain("Thinking 0.0s");
	});

	it("logically displaces an older same-adapter controller while preserving the shared wrapper", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const firstHost = context();
		const firstRender = vi.fn();
		const first = controller(config, Date.now, firstRender);
		first.startSession(firstHost.ctx);
		const wrapper = prototype.updateContent;
		const assistant = component();
		assistant.updateContent(
			message(
				Array.from({ length: 8 }, (_, index) => `first owner row ${index + 1}  `).join("\n"),
				1_000,
			),
			false,
		);
		expect(plain(assistant.render(80)).join("\n")).toContain("Thought");

		const secondHost = context();
		const secondRender = vi.fn();
		const second = controller(config, Date.now, secondRender);
		expect(second.startSession(secondHost.ctx)).toEqual({ applied: true });
		expect(prototype.updateContent).toBe(wrapper);
		expect(firstHost.input("\x14")).toBeUndefined();
		expect(first.state).toMatchObject({ active: false, displaced: true });
		const restored = plain(assistant.render(80)).join("\n");
		expect(restored).not.toMatch(/Thinking \d|Thought(?: for)?/);
		expect(restored).toContain("first owner row 1");
		expect(restored).toContain("first owner row 8");
		expect(firstRender).toHaveBeenCalledTimes(1);
		expect(secondRender).toHaveBeenCalledTimes(0);
		expect(second.state).toMatchObject({ active: true, displaced: false });
		first.shutdown();
		controllers.delete(first);
		expect(prototype.updateContent).toBe(wrapper);
		second.shutdown();
		controllers.delete(second);
		expect(prototype.updateContent).not.toBe(wrapper);
	});

	it("aborts a failed multi-component fold and restores every original hidden state once", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, () => 5_000, requestRender);
		value.startSession(host.ctx);
		const early = component();
		const laterHidden = component(true);
		const earlyMessage = message("early original reasoning", 1_000);
		const hiddenMessage = message("later native hidden reasoning", 2_000);
		early.updateContent(earlyMessage, true);
		laterHidden.updateContent(hiddenMessage, true);

		const states = (
			value as unknown as {
				states: WeakMap<object, { args: unknown[] }>;
			}
		).states;
		const earlyState = states.get(early);
		expect(earlyState).toBeDefined();
		if (earlyState) earlyState.args = [message("incompatible replacement", 1_000), true];
		value.updateMessage({
			message: earlyMessage,
			assistantMessageEvent: { type: "text_delta" },
		});

		expect(value.state).toMatchObject({ available: false, active: false });
		expect(requestRender).toHaveBeenCalledTimes(1);
		const earlyNative = plain(early.render(80)).join("\n");
		expect(earlyNative).toContain("incompatible replacement");
		expect(earlyNative).not.toMatch(/Thinking \d|Thought(?: for)?/);
		const laterNative = plain(laterHidden.render(80)).join("\n");
		expect(laterNative).toContain("Thinking...");
		expect(laterNative).not.toContain("later native hidden reasoning");
		expect((laterHidden as unknown as { hideThinkingBlock: boolean }).hideThinkingBlock).toBe(true);
	});

	it("makes a permanent renderer-shape failure reject retries", () => {
		const native = originalDescriptor?.value as (this: unknown, ...args: unknown[]) => unknown;
		Object.defineProperty(prototype, "updateContent", {
			...originalDescriptor,
			value: function incompatible(this: { contentContainer?: { children?: object[] } }) {
				this.contentContainer = { children: [] };
			},
		});
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const value = controller(config);
		expect(value.startSession(host.ctx)).toEqual({ applied: true });
		Reflect.apply(prototype.updateContent, {}, [message("incompatible")]);
		expect(value.state).toMatchObject({ available: false, active: false });
		expect(value.startSession(host.ctx)).toMatchObject({ applied: false });
		expect(prototype.updateContent).not.toBe(native);
	});

	it("fails open on foreign displacement and compare-and-swap cleanup preserves the successor", () => {
		bridgeSourceLoadedMarkdownIdentity();
		const config: ThinkingStepsComponentConfig = {
			enabled: true,
			mode: "streaming",
		};
		const host = context();
		const requestRender = vi.fn();
		const value = controller(config, Date.now, requestRender);
		value.startSession(host.ctx);
		const assistant = component();
		assistant.updateContent(
			message(
				Array.from({ length: 8 }, (_, index) => `displaced native row ${index + 1}  `).join("\n"),
				1_000,
			),
			false,
		);
		expect(plain(assistant.render(80)).join("\n")).toContain("Thought");
		const zentuiWrapper = prototype.updateContent;
		const foreign = function foreignUpdate(this: unknown, ...args: unknown[]) {
			return Reflect.apply(zentuiWrapper, this, args);
		};
		Object.defineProperty(prototype, "updateContent", {
			...Object.getOwnPropertyDescriptor(prototype, "updateContent"),
			value: foreign,
		});
		expect(value.state).toMatchObject({
			available: false,
			active: false,
			displaced: true,
			restartRequired: true,
		});
		const restored = plain(assistant.render(80)).join("\n");
		expect(restored).not.toMatch(/Thinking \d|Thought(?: for)?/);
		expect(restored).toContain("displaced native row 1");
		expect(restored).toContain("displaced native row 8");
		expect(requestRender).toHaveBeenCalledTimes(1);
		expect(host.stopInput).toHaveBeenCalledTimes(1);
		value.shutdown();
		expect(prototype.updateContent).toBe(foreign);
	});
});
