import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { renderCluster } from "../extensions/zentui/fixed-editor/cluster";
import { TerminalSplitCompositor } from "../extensions/zentui/fixed-editor/compositor";
import {
	clampScrollOffset,
	parseKeyboardScroll,
	parseMouseEvent,
	parseMouseScroll,
} from "../extensions/zentui/fixed-editor/input";
import {
	findEditorContainerIndex,
	inspectPiTui,
	type PiRenderableCapability,
} from "../extensions/zentui/fixed-editor/pi-compat";
import { highlightSelection, SelectionState } from "../extensions/zentui/fixed-editor/selection";
import {
	DISABLE_ALT_SCROLL,
	DISABLE_MOUSE,
	ENABLE_AUTOWRAP,
	EXIT_ALT_SCREEN,
	emergencyTerminalReset,
	RESET_SCROLL_REGION,
	SHOW_CURSOR,
} from "../extensions/zentui/fixed-editor/terminal-modes";
import { WrappedPolishedEditor } from "../extensions/zentui/ui";
import { OwnedTerminalStateParser } from "./helpers/terminal-state";

function makeValidPiFixture() {
	let rawRows = 24;
	let inputListener:
		| ((data: string) => { consume?: boolean; data?: string } | undefined)
		| undefined;
	const inputListenerDisposer = vi.fn(() => {
		inputListener = undefined;
	});
	const removeInputListener = vi.fn(
		(listener: (data: string) => { consume?: boolean; data?: string } | undefined) => {
			if (inputListener === listener) inputListener = undefined;
		},
	);
	const terminalWrite = vi.fn();
	const terminalDrainInput = vi.fn(async (..._args: unknown[]) => "drained");
	const terminalStop = vi.fn((..._args: unknown[]) => "stopped");
	const makeRenderable = (label: string) => ({
		render(width: number) {
			return [`${label}:${width}`];
		},
	});
	const editorComponent = {
		getText: () => "",
		setText() {},
		handleInput() {},
	};
	const status = makeRenderable("status");
	const above = makeRenderable("above");
	const editor = { ...makeRenderable("editor"), children: [editorComponent] };
	const below = makeRenderable("below");
	const footer = makeRenderable("footer");
	const terminal = {
		columns: 80,
		rows: rawRows,
		write: terminalWrite,
		drainInput: terminalDrainInput,
		stop: terminalStop,
	};
	Object.defineProperty(terminal, "rows", {
		configurable: true,
		enumerable: true,
		get: () => rawRows,
	});
	const rootRender = vi.fn((width: number) =>
		Array.from({ length: 30 }, (_, index) => `root-${index}:${width}`),
	);
	const doRender = vi.fn();
	const requestRender = vi.fn();
	const addInputListener = vi.fn(
		(listener: (data: string) => { consume?: boolean; data?: string } | undefined) => {
			inputListener = listener;
			return inputListenerDisposer;
		},
	);
	const tui = {
		children: [status, above, editor, below, footer],
		focusedComponent: editorComponent,
		terminal,
		render: rootRender,
		doRender,
		requestRender,
		addInputListener,
		removeInputListener,
		hasOverlay: () => false,
		overlayStack: [] as { hidden?: boolean }[],
		hardwareCursorRow: 4,
		previousViewportTop: 1,
	};
	return {
		tui,
		terminal,
		cluster: [status, above, editor, below, footer],
		terminalWrite,
		terminalDrainInput,
		terminalStop,
		rootRender,
		doRender,
		requestRender,
		addInputListener,
		inputListenerDisposer,
		removeInputListener,
		getInputListener: () => inputListener,
		setRows: (rows: number) => {
			rawRows = rows;
		},
	};
}

describe("Pi fixed-editor compatibility", () => {
	it.each([
		[
			"terminal",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "terminal"),
		],
		[
			"terminal write",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "write"),
		],
		[
			"terminal drainInput",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "drainInput"),
		],
		[
			"terminal stop",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "stop"),
		],
		[
			"terminal rows",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "rows"),
		],
		[
			"terminal columns",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.terminal, "columns"),
		],
		[
			"input listener",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "addInputListener"),
		],
		[
			"input listener removal",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "removeInputListener"),
		],
		[
			"forced render",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "requestRender"),
		],
		[
			"children",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "children"),
		],
		[
			"editor layout",
			(fixture: ReturnType<typeof makeValidPiFixture>) => {
				Reflect.set(fixture.tui.children[2], "children", []);
			},
		],
		[
			"render",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "render"),
		],
		[
			"doRender",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "doRender"),
		],
		[
			"overlay visibility",
			(fixture: ReturnType<typeof makeValidPiFixture>) => {
				Reflect.deleteProperty(fixture.tui, "hasOverlay");
				Reflect.deleteProperty(fixture.tui, "overlayStack");
			},
		],
		[
			"hardware cursor row",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "hardwareCursorRow"),
		],
		[
			"viewport top",
			(fixture: ReturnType<typeof makeValidPiFixture>) =>
				Reflect.deleteProperty(fixture.tui, "previousViewportTop"),
		],
	] as const)("rejects a missing %s capability without side effects", (_name, removeCapability) => {
		const fixture = makeValidPiFixture();
		removeCapability(fixture);
		const render = fixture.tui.render;
		const doRender = fixture.tui.doRender;
		const write = fixture.terminal.write;

		expect(inspectPiTui(fixture.tui)).toBeUndefined();
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
		expect(fixture.addInputListener).not.toHaveBeenCalled();
		expect(fixture.tui.render).toBe(render);
		expect(fixture.tui.doRender).toBe(doRender);
		expect(fixture.terminal.write).toBe(write);
	});

	it("fails closed when a private Pi getter or proxy trap throws", () => {
		const fixture = makeValidPiFixture();
		const throwingTui = new Proxy(fixture.tui, {
			get(target, property, receiver) {
				if (property === "children") throw new Error("private shape changed");
				return Reflect.get(target, property, receiver);
			},
		});

		expect(() => inspectPiTui(throwingTui)).not.toThrow();
		expect(inspectPiTui(throwingTui)).toBeUndefined();
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
		expect(fixture.addInputListener).not.toHaveBeenCalled();
	});

	it("rejects non-configurable rows and non-writable render methods before writes", () => {
		const rowsFixture = makeValidPiFixture();
		const rowsDescriptor = Object.getOwnPropertyDescriptor(rowsFixture.terminal, "rows");
		Object.defineProperty(rowsFixture.terminal, "rows", { ...rowsDescriptor, configurable: false });
		expect(inspectPiTui(rowsFixture.tui)).toBeUndefined();
		expect(rowsFixture.terminalWrite).not.toHaveBeenCalled();

		const renderFixture = makeValidPiFixture();
		Object.defineProperty(renderFixture.tui, "render", {
			value: renderFixture.tui.render,
			configurable: true,
			writable: false,
		});
		expect(inspectPiTui(renderFixture.tui)).toBeUndefined();
		expect(renderFixture.terminalWrite).not.toHaveBeenCalled();

		const doRenderFixture = makeValidPiFixture();
		Object.defineProperty(doRenderFixture.tui, "doRender", {
			value: doRenderFixture.tui.doRender,
			configurable: true,
			writable: false,
		});
		expect(inspectPiTui(doRenderFixture.tui)).toBeUndefined();
		expect(doRenderFixture.terminalWrite).not.toHaveBeenCalled();

		const writeFixture = makeValidPiFixture();
		Object.defineProperty(writeFixture.terminal, "write", {
			value: writeFixture.terminal.write,
			configurable: true,
			writable: false,
		});
		expect(inspectPiTui(writeFixture.tui)).toBeUndefined();
		expect(writeFixture.terminalWrite).not.toHaveBeenCalled();

		for (const key of ["drainInput", "stop"] as const) {
			const lifecycleFixture = makeValidPiFixture();
			Object.defineProperty(lifecycleFixture.terminal, key, {
				value: lifecycleFixture.terminal[key],
				configurable: true,
				writable: false,
			});
			expect(inspectPiTui(lifecycleFixture.tui)).toBeUndefined();
			expect(lifecycleFixture.terminalWrite).not.toHaveBeenCalled();
		}

		const frozenFixture = makeValidPiFixture();
		Object.freeze(frozenFixture.tui.children[0]);
		expect(inspectPiTui(frozenFixture.tui)).toBeUndefined();
		expect(frozenFixture.terminalWrite).not.toHaveBeenCalled();
	});

	it("installs from verified capabilities and restores exact identities and descriptors", () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		expect(capabilities).toBeDefined();
		if (!capabilities) return;
		const render = fixture.tui.render;
		const doRender = fixture.tui.doRender;
		const write = fixture.terminal.write;
		const drainInput = fixture.terminal.drainInput;
		const stop = fixture.terminal.stop;
		const rowsDescriptor = Object.getOwnPropertyDescriptor(fixture.terminal, "rows");
		const clusterDescriptors = fixture.cluster.map((component) =>
			Object.getOwnPropertyDescriptor(component, "render"),
		);
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));

		expect(compositor.install()).toBe(true);
		expect(fixture.tui.render).not.toBe(render);
		expect(fixture.tui.doRender).not.toBe(doRender);
		expect(fixture.terminal.write).not.toBe(write);
		expect(fixture.terminal.drainInput).not.toBe(drainInput);
		expect(fixture.terminal.stop).not.toBe(stop);
		expect(fixture.cluster.every((component) => component.render(80).length === 0)).toBe(true);
		expect(fixture.addInputListener).toHaveBeenCalledTimes(1);
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(2);

		compositor.dispose("live");
		compositor.dispose("live");

		expect(fixture.tui.render).toBe(render);
		expect(fixture.tui.doRender).toBe(doRender);
		expect(fixture.terminal.write).toBe(write);
		expect(fixture.terminal.drainInput).toBe(drainInput);
		expect(fixture.terminal.stop).toBe(stop);
		expect(Object.getOwnPropertyDescriptor(fixture.terminal, "rows")).toEqual(rowsDescriptor);
		expect(
			fixture.cluster.map((component) => Object.getOwnPropertyDescriptor(component, "render")),
		).toEqual(clusterDescriptors);
		expect(fixture.inputListenerDisposer).toHaveBeenCalledTimes(1);
		expect(fixture.removeInputListener).toHaveBeenCalledTimes(1);
		expect(fixture.getInputListener()).toBeUndefined();
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(3);
		// Initial viewport population plus the live-disposal repaint.
		expect(fixture.requestRender).toHaveBeenCalledTimes(2);
		expect(fixture.requestRender).toHaveBeenNthCalledWith(1, true);
		expect(fixture.requestRender).toHaveBeenNthCalledWith(2, true);
	});

	it("exits the alternate screen before Pi drain and stop cleanup", async () => {
		const fixture = makeValidPiFixture();
		let drainReceiver: unknown;
		let drainArgs: unknown[] = [];
		let stopReceiver: unknown;
		let stopArgs: unknown[] = [];
		const drainResult = Promise.resolve("original-drain");
		fixture.terminalDrainInput.mockImplementationOnce(function (this: unknown, ...args: unknown[]) {
			drainReceiver = this;
			drainArgs = args;
			expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
			return drainResult;
		});
		fixture.terminalStop.mockImplementationOnce(function (this: unknown, ...args: unknown[]) {
			stopReceiver = this;
			stopArgs = args;
			return "original-stop";
		});
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		const requestsBefore = fixture.requestRender.mock.calls.length;

		const returnedDrain = fixture.terminal.drainInput(250, 10);
		expect(returnedDrain).toBe(drainResult);
		await expect(returnedDrain).resolves.toBe("original-drain");
		expect(drainReceiver).toBe(fixture.terminal);
		expect(drainArgs).toEqual([250, 10]);
		expect(fixture.requestRender).toHaveBeenCalledTimes(requestsBefore);
		const resetWrites = fixture.terminalWrite.mock.calls.filter(
			([write]) => write === emergencyTerminalReset(),
		);
		expect(resetWrites).toHaveLength(1);

		expect(fixture.terminal.stop("suspend")).toBe("original-stop");
		expect(stopReceiver).toBe(fixture.terminal);
		expect(stopArgs).toEqual(["suspend"]);
		expect(
			fixture.terminalWrite.mock.calls.filter(([write]) => write === emergencyTerminalReset()),
		).toHaveLength(1);

		fixture.tui.doRender();
		fixture.tui.doRender();
		expect(
			fixture.terminalWrite.mock.calls
				.slice(-3)
				.some(([write]) => String(write).includes("\x1b[?1049h")),
		).toBe(true);
		compositor.dispose("shutdown");
	});

	it("prepares once when Pi drain chains into terminal stop", async () => {
		const fixture = makeValidPiFixture();
		fixture.terminalDrainInput.mockImplementationOnce(async () => fixture.terminal.stop("nested"));
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: false,
		}));
		expect(compositor.install()).toBe(true);
		await expect(fixture.terminal.drainInput()).resolves.toBe("stopped");
		expect(fixture.terminalStop).toHaveBeenCalledWith("nested");
		expect(
			fixture.terminalWrite.mock.calls.filter(([write]) => write === emergencyTerminalReset()),
		).toHaveLength(1);
		compositor.dispose("shutdown");
	});

	it("always delegates Pi cleanup and retries reset after both reset sinks fail", async () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const fallback = vi.fn(() => {
			throw new Error("fallback failed");
		});
		const compositor = new TerminalSplitCompositor(
			capabilities,
			() => ({ enabled: true, mouseScroll: false, copyNotice: false }),
			undefined,
			undefined,
			fallback,
		);
		expect(compositor.install()).toBe(true);
		fixture.terminalWrite.mockImplementation(() => {
			throw new Error("terminal failed");
		});
		await expect(fixture.terminal.drainInput()).resolves.toBe("drained");
		expect(fixture.terminalDrainInput).toHaveBeenCalledTimes(1);
		expect(fallback).toHaveBeenCalledWith(emergencyTerminalReset());

		fixture.terminalWrite.mockReset();
		expect(fixture.terminal.stop()).toBe("stopped");
		expect(fixture.terminalStop).toHaveBeenCalledTimes(1);
		expect(fixture.terminalWrite).toHaveBeenCalledWith(emergencyTerminalReset());
		compositor.dispose("shutdown");
	});

	it("preserves synchronous Pi stop failures after terminal preparation", () => {
		const fixture = makeValidPiFixture();
		fixture.terminalStop.mockImplementationOnce(() => {
			throw new Error("stop failed");
		});
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: false,
		}));
		expect(compositor.install()).toBe(true);
		expect(() => fixture.terminal.stop()).toThrow("stop failed");
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
		compositor.dispose("shutdown");
	});

	it("preserves cleanup rejection and later third-party lifecycle replacements", async () => {
		const fixture = makeValidPiFixture();
		const rejection = Promise.reject(new Error("drain rejected"));
		fixture.terminalDrainInput.mockReturnValueOnce(rejection);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: false,
		}));
		expect(compositor.install()).toBe(true);
		await expect(fixture.terminal.drainInput()).rejects.toThrow("drain rejected");
		const laterDrain = vi.fn();
		const laterStop = vi.fn();
		fixture.terminal.drainInput = laterDrain;
		fixture.terminal.stop = laterStop;
		compositor.dispose("shutdown");
		expect(fixture.terminal.drainInput).toBe(laterDrain);
		expect(fixture.terminal.stop).toBe(laterStop);
	});

	it("deletes temporary lifecycle wrappers when Pi methods were inherited", () => {
		const fixture = makeValidPiFixture();
		const drainInput = fixture.terminal.drainInput;
		const stop = fixture.terminal.stop;
		const prototype = Object.create(Object.getPrototypeOf(fixture.terminal), {
			drainInput: { configurable: true, writable: true, value: drainInput },
			stop: { configurable: true, writable: true, value: stop },
		});
		Reflect.deleteProperty(fixture.terminal, "drainInput");
		Reflect.deleteProperty(fixture.terminal, "stop");
		Object.setPrototypeOf(fixture.terminal, prototype);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: false,
		}));
		expect(compositor.install()).toBe(true);
		expect(Object.hasOwn(fixture.terminal, "drainInput")).toBe(true);
		expect(Object.hasOwn(fixture.terminal, "stop")).toBe(true);
		compositor.dispose("shutdown");
		expect(Object.hasOwn(fixture.terminal, "drainInput")).toBe(false);
		expect(Object.hasOwn(fixture.terminal, "stop")).toBe(false);
		expect(fixture.terminal.drainInput).toBe(drainInput);
		expect(fixture.terminal.stop).toBe(stop);
	});

	it("rolls back patches when listener registration does not return cleanup", () => {
		const fixture = makeValidPiFixture();
		Reflect.set(
			fixture.tui,
			"addInputListener",
			vi.fn((listener: (data: string) => { consume?: boolean; data?: string } | undefined) => {
				fixture.addInputListener(listener);
				return undefined;
			}),
		);
		const capabilities = inspectPiTui(fixture.tui);
		expect(capabilities).toBeDefined();
		if (!capabilities) return;
		const render = fixture.tui.render;
		const write = fixture.terminal.write;
		const drainInput = fixture.terminal.drainInput;
		const stop = fixture.terminal.stop;
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));

		expect(compositor.install()).toBe(false);
		expect(fixture.tui.render).toBe(render);
		expect(fixture.terminal.write).toBe(write);
		expect(fixture.terminal.drainInput).toBe(drainInput);
		expect(fixture.terminal.stop).toBe(stop);
		expect(fixture.cluster.every((component) => component.render(80).length > 0)).toBe(true);
		expect(fixture.removeInputListener).toHaveBeenCalledTimes(1);
		expect(fixture.getInputListener()).toBeUndefined();
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
	});

	it("requests the first repaint and guards writes until it completes", () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
		expect(fixture.requestRender).toHaveBeenCalledWith(true);
		const writesBefore = fixture.terminalWrite.mock.calls.length;
		fixture.terminal.write("interleaved");
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(writesBefore);
		fixture.tui.doRender();
		expect(fixture.doRender).toHaveBeenCalledTimes(1);
		expect(fixture.terminalWrite.mock.calls.length).toBeGreaterThan(writesBefore);
		compositor.dispose("shutdown");
	});

	it("resolves opaque fallback during initial and later attempted fixed transitions", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(10);
		let editorHeight = 30;
		Reflect.set(fixture.cluster[2], "render", () =>
			Array.from({ length: editorHeight }, (_, index) => `opaque-${index}`),
		);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		const parser = new OwnedTerminalStateParser();

		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		for (const [write] of fixture.terminalWrite.mock.calls) parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(true);
		expect(fixture.terminal.rows).toBe(10);
		expect(fixture.tui.render(80)).toEqual(fixture.rootRender(80));

		// A fixed transition can become invalid before its forced callback runs.
		editorHeight = 1;
		fixture.tui.doRender();
		editorHeight = 30;
		const beforeFallback = fixture.terminalWrite.mock.calls.length;
		fixture.tui.doRender();
		for (const [write] of fixture.terminalWrite.mock.calls.slice(beforeFallback))
			parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(true);
		expect(fixture.terminal.rows).toBe(10);
		expect(fixture.tui.render(80)).toEqual(fixture.rootRender(80));

		// Once the editor fits again, the next transition recovers fixed mode.
		editorHeight = 1;
		fixture.tui.doRender();
		const beforeFixed = fixture.terminalWrite.mock.calls.length;
		fixture.tui.doRender();
		for (const [write] of fixture.terminalWrite.mock.calls.slice(beforeFixed))
			parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(false);
		expect(fixture.terminal.rows).toBeLessThan(10);
		expect(fixture.tui.render(80).length).toBeLessThan(fixture.rootRender(80).length);
		compositor.dispose("shutdown");
	});

	it.each([true, false])(
		"keeps alternate scroll disabled in initial fixed mode (mouseScroll=%s)",
		(mouseScroll) => {
			const fixture = makeValidPiFixture();
			const capabilities = inspectPiTui(fixture.tui);
			if (!capabilities) throw new Error("expected valid fixture");
			const compositor = new TerminalSplitCompositor(capabilities, () => ({
				enabled: true,
				mouseScroll,
				copyNotice: true,
			}));
			const parser = new OwnedTerminalStateParser();

			expect(compositor.install()).toBe(true);
			for (const [write] of fixture.terminalWrite.mock.calls) parser.feed(String(write));
			expect(parser.state.buffer).toBe("alternate");
			expect(parser.state.alternateScroll).toBe(false);

			const previousWrites = fixture.terminalWrite.mock.calls.length;
			fixture.tui.doRender();
			for (const [write] of fixture.terminalWrite.mock.calls.slice(previousWrites))
				parser.feed(String(write));
			expect(parser.state.alternateScroll).toBe(false);
			expect(parser.state.mouse1002).toBe(mouseScroll);
			expect(parser.state.mouse1006).toBe(mouseScroll);

			const beforeDispose = fixture.terminalWrite.mock.calls.length;
			compositor.dispose("shutdown");
			for (const [write] of fixture.terminalWrite.mock.calls.slice(beforeDispose))
				parser.feed(String(write));
			expect(parser.state.alternateScroll).toBe(false);
			expect(parser.isSafe()).toBe(true);
		},
	);

	it("canonically resets when the initial forced repaint request fails", () => {
		const fixture = makeValidPiFixture();
		fixture.requestRender.mockImplementation(() => {
			throw new Error("force render failed");
		});
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(false);
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
		expect(fixture.tui.render).toBe(fixture.rootRender);
		expect(fixture.terminal.write).toBe(fixture.terminalWrite);
	});

	it("canonically resets when the second terminal-entry write fails", () => {
		const fixture = makeValidPiFixture();
		fixture.terminalWrite.mockImplementation((_data: string) => {
			if (fixture.terminalWrite.mock.calls.length === 2) throw new Error("prelude failed");
		});
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(false);
		expect(fixture.terminalWrite.mock.calls[0]?.[0]).toContain("\x1b[?1049h");
		expect(fixture.terminalWrite.mock.calls[1]?.[0]).toContain("\x1b[2J");
		expect(fixture.terminalWrite.mock.calls[2]?.[0]).toBe(emergencyTerminalReset());
		expect(fixture.tui.render).toBe(fixture.rootRender);
		expect(fixture.terminal.write).toBe(fixture.terminalWrite);
	});

	it("falls back when both terminal entry and captured reset writes fail", () => {
		const fixture = makeValidPiFixture();
		fixture.terminalWrite.mockImplementation(() => {
			throw new Error("writer failed");
		});
		const fallback = vi.fn();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(
			capabilities,
			() => ({ enabled: true, mouseScroll: false, copyNotice: true }),
			undefined,
			undefined,
			fallback,
		);
		expect(compositor.install()).toBe(false);
		expect(fallback).toHaveBeenCalledWith(emergencyTerminalReset());
		expect(fixture.tui.render).toBe(fixture.rootRender);
	});

	it("routes a live transition prelude failure through disposal", () => {
		const fixture = makeValidPiFixture();
		Reflect.set(fixture.cluster[2], "render", () => [
			"top",
			`cursor${CURSOR_MARKER}`,
			"body",
			"bottom",
		]);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.setRows(3);
		fixture.terminalWrite.mockImplementation((data: string) => {
			if (data.includes("\x1b[2J")) throw new Error("transition prelude failed");
		});
		expect(() => fixture.tui.doRender()).toThrow("transition prelude failed");
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
		expect(fixture.tui.render).toBe(fixture.rootRender);
		expect(fixture.terminal.write).toBe(fixture.terminalWrite);
		expect(fixture.requestRender).toHaveBeenLastCalledWith(true);
	});

	it("gives overlays raw rows and recovers fixed rows after they close", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(40);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		expect(fixture.requestRender).toHaveBeenCalledWith(true);
		fixture.tui.doRender();
		const patchedRender = fixture.tui.render;
		expect(fixture.terminal.rows).toBeLessThan(40);

		fixture.tui.overlayStack = [{}];
		expect(fixture.terminal.rows).toBe(40);
		expect(patchedRender(80)).toEqual(fixture.rootRender(80));
		fixture.tui.doRender();
		fixture.tui.doRender();
		expect(fixture.terminal.rows).toBe(40);

		fixture.tui.overlayStack = [];
		expect(fixture.terminal.rows).toBe(40);
		fixture.tui.doRender();
		fixture.tui.doRender();
		expect(fixture.terminal.rows).toBeLessThan(40);

		fixture.setRows(12);
		patchedRender(80);
		fixture.terminal.write("update");
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toContain("\u001b[4;1H");
		fixture.requestRender.mockClear();
		fixture.getInputListener()?.("\u001b[<64;1;1M");
		expect(fixture.requestRender).toHaveBeenCalled();
		compositor.dispose("live");
	});

	it("repaints adaptive polished borders through the fixed-editor cluster without stale color", () => {
		const fixture = makeValidPiFixture();
		const uiTheme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			italic: (text: string) => text,
			underline: (text: string) => text,
			strikethrough: (text: string) => text,
			inverse: (text: string) => text,
		} as Theme;
		const renderWidths: number[] = [];
		const base = {
			borderColor: undefined as ((text: string) => string) | undefined,
			render(width: number) {
				renderWidths.push(width);
				return ["─".repeat(width), "fixed editor draft", "─".repeat(width)];
			},
			invalidate: vi.fn(),
			handleInput() {},
			getText: () => "fixed editor draft",
			setText() {},
			isShowingAutocomplete: () => false,
		};
		const editor = new WrappedPolishedEditor(
			base,
			uiTheme,
			() => ({
				...defaultConfig,
				components: {
					...defaultConfig.components,
					editor: { ...defaultConfig.components.editor, borderColorMode: "adaptive" },
				},
			}),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "high",
		);
		const thinkingBorder = (text: string) => `\x1b[34m${text}\x1b[0m`;
		const shellBorder = (text: string) => `\x1b[36m${text}\x1b[0m`;
		editor.borderColor = thinkingBorder;
		Reflect.set(fixture.cluster[2], "render", (width: number) => editor.render(width));

		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		fixture.terminalWrite.mockClear();

		fixture.tui.doRender();
		const thinkingPaint = String(fixture.terminalWrite.mock.calls.at(-1)?.[0] ?? "");
		expect(thinkingPaint.match(/\x1b\[34m/g)).toHaveLength(2);
		expect(thinkingPaint).not.toContain("\x1b[36m");
		expect(fixture.tui.render(80)).toHaveLength(14);

		editor.borderColor = shellBorder;
		editor.invalidate();
		fixture.tui.doRender();
		const shellPaint = String(fixture.terminalWrite.mock.calls.at(-1)?.[0] ?? "");
		expect(shellPaint.match(/\x1b\[36m/g)).toHaveLength(2);
		expect(shellPaint).not.toContain("\x1b[34m");
		expect(base.invalidate).toHaveBeenCalledTimes(1);
		expect(renderWidths).toEqual([78, 78]);
		for (const frame of [thinkingPaint, shellPaint]) {
			const paintedRows = frame.split("\x1b[2K").slice(1);
			expect(paintedRows).toHaveLength(10);
			expect(paintedRows.every((row) => visibleWidth(row) <= 80)).toBe(true);
		}

		compositor.dispose("live");
	});

	it("clears the right-click mouse-resume timer on disposal", () => {
		vi.useFakeTimers();
		try {
			const fixture = makeValidPiFixture();
			const capabilities = inspectPiTui(fixture.tui);
			if (!capabilities) throw new Error("expected valid fixture");
			const compositor = new TerminalSplitCompositor(capabilities, () => ({
				enabled: true,
				mouseScroll: true,
				copyNotice: true,
			}));
			expect(compositor.install()).toBe(true);
			fixture.tui.doRender();
			fixture.getInputListener()?.("\u001b[<2;1;1M");
			expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toContain(DISABLE_MOUSE);

			compositor.dispose("live");
			const writesAfterDispose = fixture.terminalWrite.mock.calls.length;
			vi.advanceTimersByTime(1_200);
			expect(fixture.terminalWrite).toHaveBeenCalledTimes(writesAfterDispose);
		} finally {
			vi.useRealTimers();
		}
	});

	it("resumes mouse reporting only while fixed mode still owns input", () => {
		vi.useFakeTimers();
		try {
			const fixture = makeValidPiFixture();
			fixture.setRows(12);
			const capabilities = inspectPiTui(fixture.tui);
			if (!capabilities) throw new Error("expected valid fixture");
			const compositor = new TerminalSplitCompositor(capabilities, () => ({
				enabled: true,
				mouseScroll: true,
				copyNotice: true,
			}));
			expect(compositor.install()).toBe(true);
			fixture.tui.doRender();
			fixture.getInputListener()?.("\u001b[<2;1;1M");
			const parser = new OwnedTerminalStateParser({
				buffer: "alternate",
				mouse1002: true,
				mouse1006: true,
			});
			parser.feed(String(fixture.terminalWrite.mock.calls.at(-1)?.[0]));
			expect(parser.state.mouse1002).toBe(false);

			vi.advanceTimersByTime(1_200);
			parser.feed(String(fixture.terminalWrite.mock.calls.at(-1)?.[0]));
			expect(parser.state.mouse1002).toBe(true);
			compositor.dispose("shutdown");
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not resume mouse reporting after normal-flow or overlay ownership", () => {
		vi.useFakeTimers();
		try {
			const makeCompositor = () => {
				const fixture = makeValidPiFixture();
				fixture.setRows(12);
				const capabilities = inspectPiTui(fixture.tui);
				if (!capabilities) throw new Error("expected valid fixture");
				const compositor = new TerminalSplitCompositor(capabilities, () => ({
					enabled: true,
					mouseScroll: true,
					copyNotice: true,
				}));
				expect(compositor.install()).toBe(true);
				fixture.tui.doRender();
				return { fixture, compositor };
			};

			const normal = makeCompositor();
			normal.fixture.getInputListener()?.("\u001b[<2;1;1M");
			normal.fixture.setRows(1);
			normal.fixture.tui.doRender();
			normal.fixture.tui.doRender();
			const normalWrites = normal.fixture.terminalWrite.mock.calls.length;
			vi.advanceTimersByTime(1_200);
			expect(normal.fixture.terminalWrite).toHaveBeenCalledTimes(normalWrites);
			normal.compositor.dispose("shutdown");

			const overlay = makeCompositor();
			overlay.fixture.getInputListener()?.("\u001b[<2;1;1M");
			overlay.fixture.tui.overlayStack = [{}];
			const overlayWrites = overlay.fixture.terminalWrite.mock.calls.length;
			vi.advanceTimersByTime(1_200);
			expect(overlay.fixture.terminalWrite).toHaveBeenCalledTimes(overlayWrites);
			overlay.compositor.dispose("shutdown");
		} finally {
			vi.useRealTimers();
		}
	});

	it("copies an ordinary in-range selection and reports the selected text once", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(12);
		const onCopy = vi.fn();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(
			capabilities,
			() => ({ enabled: true, mouseScroll: true, copyNotice: true }),
			onCopy,
		);
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.tui.render(80);
		const listener = fixture.getInputListener();

		expect(listener?.("\u001b[<0;1;1M")).toEqual({ consume: true });
		expect(listener?.("\u001b[<0;4;1m")).toEqual({ consume: true });
		expect(onCopy).toHaveBeenCalledOnce();
		expect(onCopy).toHaveBeenCalledWith("root");
		expect(fixture.tui.render(80).join("\n")).not.toContain("\u001b[48;5;238m");
		compositor.dispose("shutdown");
	});

	it("clears a transcript drag released over the pinned cluster", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(12);
		const onCopy = vi.fn();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(
			capabilities,
			() => ({ enabled: true, mouseScroll: true, copyNotice: true }),
			onCopy,
		);
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.tui.render(80);
		const listener = fixture.getInputListener();
		listener?.("\u001b[<0;1;1M");
		listener?.("\u001b[<32;4;2M");
		expect(fixture.tui.render(80).join("\n")).toContain("\u001b[48;5;238m");

		fixture.requestRender.mockClear();
		expect(listener?.("\u001b[<0;4;8m")).toEqual({ consume: true });
		expect(fixture.requestRender).toHaveBeenCalledTimes(1);
		expect(fixture.tui.render(80).join("\n")).not.toContain("\u001b[48;5;238m");
		listener?.("\u001b[<0;4;2m");
		expect(onCopy).not.toHaveBeenCalled();
		compositor.dispose("shutdown");
	});

	it.each([
		{
			name: "an overlay",
			enter: (fixture: ReturnType<typeof makeValidPiFixture>) => {
				fixture.tui.overlayStack = [{}];
			},
			exit: (fixture: ReturnType<typeof makeValidPiFixture>) => {
				fixture.tui.overlayStack = [];
			},
		},
		{
			name: "a height fallback",
			enter: (fixture: ReturnType<typeof makeValidPiFixture>) => fixture.setRows(1),
			exit: (fixture: ReturnType<typeof makeValidPiFixture>) => fixture.setRows(12),
		},
	])("clears an active transcript drag across $name transition and recovery", ({ enter, exit }) => {
		const fixture = makeValidPiFixture();
		fixture.setRows(12);
		const onCopy = vi.fn();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(
			capabilities,
			() => ({ enabled: true, mouseScroll: true, copyNotice: true }),
			onCopy,
		);
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.tui.render(80);
		const listener = fixture.getInputListener();
		listener?.("\u001b[<0;1;1M");
		listener?.("\u001b[<32;4;2M");
		expect(fixture.tui.render(80).join("\n")).toContain("\u001b[48;5;238m");

		enter(fixture);
		fixture.tui.doRender();
		fixture.tui.doRender();
		exit(fixture);
		fixture.tui.doRender();
		fixture.tui.doRender();

		const recovered = fixture.tui.render(80).join("\n");
		expect(recovered).not.toContain("\u001b[48;5;238m");
		fixture.requestRender.mockClear();
		expect(listener?.("\u001b[<0;4;2m")).toEqual({ consume: true });
		expect(fixture.requestRender).not.toHaveBeenCalled();
		expect(onCopy).not.toHaveBeenCalled();
		expect(fixture.tui.render(80).join("\n")).not.toContain("\u001b[48;5;238m");
		compositor.dispose("shutdown");
	});

	it("suspends installation and rendering at zero terminal rows", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(0);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
		expect(fixture.requestRender).not.toHaveBeenCalled();
		fixture.tui.doRender();
		expect(fixture.doRender).not.toHaveBeenCalled();
		expect(fixture.terminalWrite).not.toHaveBeenCalled();
		fixture.setRows(12);
		fixture.tui.doRender();
		expect(fixture.requestRender).toHaveBeenCalledWith(true);
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(2);
		const parser = new OwnedTerminalStateParser();
		for (const [write] of fixture.terminalWrite.mock.calls) parser.feed(String(write));
		expect(parser.state.buffer).toBe("alternate");
		expect(parser.state.alternateScroll).toBe(false);
		fixture.tui.doRender();
		for (const [write] of fixture.terminalWrite.mock.calls.slice(2)) parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(false);
		compositor.dispose("shutdown");
	});

	it("propagates PageUp and PageDown for overlays and when no transcript range exists", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(40);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.tui.render(80);
		const listener = fixture.getInputListener();
		expect(listener?.("\x1b[5~")).toBeUndefined();
		expect(listener?.("\x1b[6~")).toBeUndefined();
		fixture.tui.overlayStack = [{}];
		expect(listener?.("\x1b[5~")).toBeUndefined();
		expect(listener?.("\x1b[6~")).toBeUndefined();
		compositor.dispose("shutdown");
	});

	it("consumes PageUp and PageDown at transcript boundaries when a range exists", () => {
		const fixture = makeValidPiFixture();
		fixture.setRows(12);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.tui.render(80);
		const listener = fixture.getInputListener();
		expect(listener?.("\x1b[6~")).toEqual({ consume: true });
		expect(listener?.("\x1b[5~")).toEqual({ consume: true });
		for (let index = 0; index < 20; index++) listener?.("\x1b[5~");
		expect(listener?.("\x1b[5~")).toEqual({ consume: true });
		compositor.dispose("shutdown");
	});

	it("guards bidirectional fixed and normal-flow transitions", () => {
		const fixture = makeValidPiFixture();
		Reflect.set(fixture.cluster[2], "render", () => [
			"top",
			`cursor${CURSOR_MARKER}`,
			"body",
			"bottom",
		]);
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		// Complete the initial forced fixed-mode render before testing later transitions.
		fixture.tui.doRender();
		const parser = new OwnedTerminalStateParser();
		for (const [write] of fixture.terminalWrite.mock.calls) parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(false);
		fixture.setRows(3);
		fixture.terminalWrite.mockClear();
		fixture.tui.doRender();
		for (const [write] of fixture.terminalWrite.mock.calls) parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(true);
		expect(String(fixture.terminalWrite.mock.calls[0]?.[0])).toContain("\x1b[2J");
		expect(String(fixture.terminalWrite.mock.calls[0]?.[0])).not.toContain("\x1b[3J");
		const writesDuringGuard = fixture.terminalWrite.mock.calls.length;
		fixture.terminal.write("partial");
		expect(fixture.terminalWrite).toHaveBeenCalledTimes(writesDuringGuard);
		fixture.tui.doRender();
		expect(fixture.tui.render(80)).toEqual(fixture.rootRender(80));
		fixture.setRows(24);
		const beforeFixed = fixture.terminalWrite.mock.calls.length;
		fixture.tui.doRender();
		for (const [write] of fixture.terminalWrite.mock.calls.slice(beforeFixed))
			parser.feed(String(write));
		expect(parser.state.alternateScroll).toBe(false);
		fixture.tui.doRender();
		expect(parser.state.alternateScroll).toBe(false);
		expect(fixture.tui.render(80).length).toBeLessThan(fixture.rootRender(80).length);
		compositor.dispose("shutdown");
	});

	it("continues sibling descriptor restoration after an individual failure", () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const rootRender = fixture.tui.render;
		const terminalWrite = fixture.terminal.write;
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: false,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		const status = fixture.cluster[0];
		const patchedStatus = Object.getOwnPropertyDescriptor(status, "render");
		Object.defineProperty(status, "render", { ...patchedStatus, configurable: false });
		compositor.dispose("shutdown");
		expect(fixture.tui.render).toBe(rootRender);
		expect(fixture.terminal.write).toBe(terminalWrite);
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
	});

	it.each([
		["status render", (f: ReturnType<typeof makeValidPiFixture>) => f.cluster[0], "render"],
		["above render", (f: ReturnType<typeof makeValidPiFixture>) => f.cluster[1], "render"],
		["editor render", (f: ReturnType<typeof makeValidPiFixture>) => f.cluster[2], "render"],
		["below render", (f: ReturnType<typeof makeValidPiFixture>) => f.cluster[3], "render"],
		["footer render", (f: ReturnType<typeof makeValidPiFixture>) => f.cluster[4], "render"],
		["terminal write", (f: ReturnType<typeof makeValidPiFixture>) => f.terminal, "write"],
		["root render", (f: ReturnType<typeof makeValidPiFixture>) => f.tui, "render"],
		["root doRender", (f: ReturnType<typeof makeValidPiFixture>) => f.tui, "doRender"],
		["terminal rows", (f: ReturnType<typeof makeValidPiFixture>) => f.terminal, "rows"],
	] as const)(
		"continues after individual %s descriptor restoration fails",
		(_name, targetFor, key) => {
			const fixture = makeValidPiFixture();
			const capabilities = inspectPiTui(fixture.tui);
			if (!capabilities) throw new Error("expected valid fixture");
			const compositor = new TerminalSplitCompositor(capabilities, () => ({
				enabled: true,
				mouseScroll: false,
				copyNotice: true,
			}));
			expect(compositor.install()).toBe(true);
			const target = targetFor(fixture);
			const descriptor = Object.getOwnPropertyDescriptor(target, key);
			Object.defineProperty(target, key, { ...descriptor, configurable: false });
			compositor.dispose("shutdown");
			expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
			if (key !== "render" || target !== fixture.tui)
				expect(fixture.tui.render).toBe(fixture.rootRender);
			if (key !== "write") expect(fixture.terminal.write).toBe(fixture.terminalWrite);
		},
	);

	it("isolates timer, disposer, and listener-removal failures from terminal reset", () => {
		const fixture = makeValidPiFixture();
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(capabilities, () => ({
			enabled: true,
			mouseScroll: true,
			copyNotice: true,
		}));
		expect(compositor.install()).toBe(true);
		fixture.tui.doRender();
		fixture.getInputListener()?.("\u001b[<2;1;1M");
		fixture.inputListenerDisposer.mockImplementationOnce(() => {
			throw new Error("disposer failed");
		});
		fixture.removeInputListener.mockImplementationOnce(() => {
			throw new Error("removal failed");
		});
		const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation((() => {
			throw new Error("timer failed");
		}) as typeof clearTimeout);
		try {
			compositor.dispose("shutdown");
		} finally {
			clear.mockRestore();
		}
		expect(fixture.inputListenerDisposer).toHaveBeenCalled();
		expect(fixture.removeInputListener).toHaveBeenCalled();
		expect(fixture.terminalWrite.mock.calls.at(-1)?.[0]).toBe(emergencyTerminalReset());
		expect(fixture.tui.render).toBe(fixture.rootRender);
	});

	it("uses the default stdout fallback when the captured reset writer fails", () => {
		const fixture = makeValidPiFixture();
		let failReset = false;
		fixture.terminalWrite.mockImplementation((data: string) => {
			if (failReset && data === emergencyTerminalReset()) throw new Error("writer closed");
		});
		const stdout = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((() => true) as typeof process.stdout.write);
		try {
			const capabilities = inspectPiTui(fixture.tui);
			if (!capabilities) throw new Error("expected valid fixture");
			const compositor = new TerminalSplitCompositor(capabilities, () => ({
				enabled: true,
				mouseScroll: false,
				copyNotice: true,
			}));
			expect(compositor.install()).toBe(true);
			failReset = true;
			compositor.dispose("shutdown");
			expect(stdout).toHaveBeenCalledWith(emergencyTerminalReset());
		} finally {
			stdout.mockRestore();
		}
	});

	it("uses the canonical reset fallback and never repaints on shutdown", () => {
		const fixture = makeValidPiFixture();
		const fallback = vi.fn();
		let failReset = false;
		fixture.terminalWrite.mockImplementation((data: string) => {
			if (failReset && data === emergencyTerminalReset()) throw new Error("writer closed");
		});
		const capabilities = inspectPiTui(fixture.tui);
		if (!capabilities) throw new Error("expected valid fixture");
		const compositor = new TerminalSplitCompositor(
			capabilities,
			() => ({ enabled: true, mouseScroll: true, copyNotice: true }),
			undefined,
			undefined,
			fallback,
		);
		expect(compositor.install()).toBe(true);
		const requestsBefore = fixture.requestRender.mock.calls.length;
		failReset = true;
		compositor.dispose("shutdown");
		expect(fallback).toHaveBeenCalledWith(emergencyTerminalReset());
		expect(fixture.requestRender).toHaveBeenCalledTimes(requestsBefore);
	});
});

describe("input", () => {
	describe("parseMouseScroll", () => {
		it("parses SGR wheel up", () => {
			expect(parseMouseScroll("\x1b[<64;10;5M")).toEqual({ direction: "up", amount: 3 });
		});

		it("parses SGR wheel down", () => {
			expect(parseMouseScroll("\x1b[<65;10;5M")).toEqual({ direction: "down", amount: 3 });
		});

		it("parses wheel with modifiers (shift bit)", () => {
			// 64 | 4 = 68 (wheel up with shift)
			expect(parseMouseScroll("\x1b[<68;10;5M")).toEqual({ direction: "up", amount: 3 });
		});

		it("returns undefined for non-mouse input", () => {
			expect(parseMouseScroll("\x1b[A")).toBeUndefined();
		});

		it("returns undefined for non-wheel mouse (button 0)", () => {
			expect(parseMouseScroll("\x1b[<0;10;5M")).toBeUndefined();
		});
	});

	describe("parseKeyboardScroll", () => {
		it("parses PgUp", () => {
			expect(parseKeyboardScroll("\x1b[5~")).toEqual({ action: "pageUp" });
		});

		it("parses PgDn", () => {
			expect(parseKeyboardScroll("\x1b[6~")).toEqual({ action: "pageDown" });
		});

		it("parses Enter as jumpBottom", () => {
			expect(parseKeyboardScroll("\r")).toEqual({ action: "jumpBottom" });
		});

		it("parses Ctrl+Shift+Up", () => {
			expect(parseKeyboardScroll("\x1b[1;6A")).toEqual({ action: "pageUp" });
		});

		it("parses Ctrl+Shift+Down", () => {
			expect(parseKeyboardScroll("\x1b[1;6B")).toEqual({ action: "pageDown" });
		});

		it("returns undefined for regular keys", () => {
			expect(parseKeyboardScroll("a")).toBeUndefined();
		});

		it("returns undefined for key release", () => {
			expect(parseKeyboardScroll("\x1b[5;2~")).toBeUndefined();
		});
	});

	describe("parseMouseEvent", () => {
		it("parses left button press", () => {
			const ev = parseMouseEvent("\x1b[<0;5;3M");
			expect(ev).toEqual({ button: "left", action: "press", col: 5, row: 3 });
		});

		it("parses left button drag (motion bit set)", () => {
			const ev = parseMouseEvent("\x1b[<32;10;5M");
			expect(ev).toEqual({ button: "left", action: "drag", col: 10, row: 5 });
		});

		it("parses left button release (lowercase m)", () => {
			const ev = parseMouseEvent("\x1b[<0;10;5m");
			expect(ev).toEqual({ button: "left", action: "release", col: 10, row: 5 });
		});

		it("parses right button press", () => {
			const ev = parseMouseEvent("\x1b[<2;7;4M");
			expect(ev).toEqual({ button: "right", action: "press", col: 7, row: 4 });
		});

		it("parses wheel up", () => {
			const ev = parseMouseEvent("\x1b[<64;1;1M");
			expect(ev).toEqual({ button: "wheel-up", action: "press", col: 1, row: 1 });
		});

		it("parses wheel down", () => {
			const ev = parseMouseEvent("\x1b[<65;1;1M");
			expect(ev).toEqual({ button: "wheel-down", action: "press", col: 1, row: 1 });
		});

		it("returns undefined for non-mouse input", () => {
			expect(parseMouseEvent("\x1b[A")).toBeUndefined();
		});
	});

	describe("clampScrollOffset", () => {
		it("clamps within range", () => {
			expect(clampScrollOffset(5, 10)).toBe(5);
		});

		it("clamps negative to 0", () => {
			expect(clampScrollOffset(-3, 10)).toBe(0);
		});

		it("clamps above max", () => {
			expect(clampScrollOffset(15, 10)).toBe(10);
		});

		it("handles maxOffset of 0", () => {
			expect(clampScrollOffset(5, 0)).toBe(0);
		});
	});
});

describe("terminal-modes", () => {
	describe("emergencyTerminalReset", () => {
		it("contains all reset sequences", () => {
			const reset = emergencyTerminalReset();
			expect(reset).toContain(EXIT_ALT_SCREEN);
			expect(reset).toContain(DISABLE_MOUSE);
			expect(reset).toContain(RESET_SCROLL_REGION);
			expect(reset).toContain(DISABLE_ALT_SCROLL);
			expect(reset).toContain(ENABLE_AUTOWRAP);
			expect(reset).toContain(SHOW_CURSOR);
			expect(reset.indexOf(ENABLE_AUTOWRAP)).toBeLessThan(reset.indexOf(EXIT_ALT_SCREEN));
		});
	});
});

describe("cluster", () => {
	function makeComponent(lines: string[] = ["line"]) {
		return { render: () => lines, invalidate: () => {} };
	}

	function makeContainer(children: unknown[]) {
		return { render: () => [], invalidate: () => {}, children };
	}

	function makeCapability(lines: string[]): PiRenderableCapability {
		const target = makeComponent(lines);
		return {
			target,
			render: target.render,
			ownDescriptor: Object.getOwnPropertyDescriptor(target, "render"),
		};
	}

	function makeEditor() {
		return {
			render: () => ["editor"],
			invalidate: () => {},
			getText: () => "",
			setText: () => {},
			handleInput: () => {},
		};
	}

	describe("findEditorContainerIndex", () => {
		it("finds the container with an editor-like child", () => {
			const children = [makeComponent(), makeContainer([makeEditor()]), makeComponent()];
			expect(findEditorContainerIndex(children)).toBe(1);
		});

		it("returns undefined when no editor found", () => {
			const children = [makeComponent(), makeComponent()];
			expect(findEditorContainerIndex(children)).toBeUndefined();
		});

		it("prefers focused component's parent", () => {
			const editor = makeEditor();
			const containerA = makeContainer([editor]);
			const containerB = makeContainer([makeEditor()]);
			const children = [containerA, containerB];
			expect(findEditorContainerIndex(children, editor)).toBe(0);
		});
	});

	describe("renderCluster", () => {
		it("renders and concatenates all cluster components", () => {
			const cluster = {
				status: makeCapability(["status"]),
				aboveWidget: makeCapability(["above"]),
				editor: makeCapability(["editor-line"]),
				belowWidget: makeCapability(["below"]),
				footer: makeCapability(["footer"]),
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.lines).toEqual(["status", "above", "editor-line", "below", "footer"]);
		});

		it("extracts cursor position", () => {
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeCapability([`hello${CURSOR_MARKER}world`]),
				belowWidget: null,
				footer: null,
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.cursor).toEqual({ row: 0, col: 5 });
			expect(result.lines[0]).toBe("helloworld");
		});

		it("selects normal flow rather than cropping an oversized opaque editor", () => {
			const manyLines = Array.from({ length: 30 }, (_, i) => `ed-${i}`);
			const throwingEditor = new Proxy(
				{},
				{
					get() {
						throw new Error("opaque provider trap");
					},
				},
			);
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeCapability(manyLines),
				editorChild: throwingEditor,
				belowWidget: null,
				footer: null,
			};
			expect(() => renderCluster(cluster, 80, 10)).not.toThrow();
			const result = renderCluster(cluster, 80, 10);
			expect(result).toMatchObject({
				mode: "normal-flow",
				lines: [],
				plan: { mode: "normal-flow", reason: "opaque-editor-does-not-fit" },
			});
		});

		it("preserves internal blank lines (low-rail polished padding)", () => {
			// The low-rail polished editor renders truly empty strings as padding:
			// [border, "", text, "", meta, border]. These must survive.
			const editorFrame = ["border", "", "input text", "", "model provider", "border"];
			const cluster = {
				status: null,
				aboveWidget: null,
				editor: makeCapability(editorFrame),
				belowWidget: null,
				footer: null,
			};
			const result = renderCluster(cluster, 80, 24);
			expect(result.lines).toEqual(editorFrame);
		});

		it("strips trailing blank lines from components", () => {
			const cluster = {
				status: makeCapability(["status", "", ""]),
				aboveWidget: null,
				editor: makeCapability(["editor"]),
				belowWidget: null,
				footer: makeCapability(["footer", ""]),
			};
			const result = renderCluster(cluster, 80, 24);
			// Trailing blanks stripped, but content preserved
			expect(result.lines).toEqual(["status", "editor", "footer"]);
		});
	});
});

describe("selection", () => {
	describe("SelectionState", () => {
		it("starts and tracks selection", () => {
			const sel = new SelectionState();
			expect(sel.active).toBe(false);
			sel.start(5, 3);
			expect(sel.active).toBe(true);
			sel.extend(7, 10);
			expect(sel.active).toBe(true);
		});

		it("clears selection", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.clear();
			expect(sel.active).toBe(false);
		});

		it("getRangeForLine returns correct range", () => {
			const sel = new SelectionState();
			sel.start(2, 3);
			sel.extend(5, 8);
			// Line 1 is before selection
			expect(sel.getRangeForLine(1)).toBeNull();
			// Line 2 is start: cols 3..inf
			const r2 = sel.getRangeForLine(2);
			expect(r2?.startCol).toBe(3);
			expect(r2?.endCol).toBe(Number.POSITIVE_INFINITY);
			// Line 3 is middle: cols 0..inf
			const r3 = sel.getRangeForLine(3);
			expect(r3?.startCol).toBe(0);
			expect(r3?.endCol).toBe(Number.POSITIVE_INFINITY);
			// Line 5 is end: cols 0..8
			const r5 = sel.getRangeForLine(5);
			expect(r5?.startCol).toBe(0);
			expect(r5?.endCol).toBe(8);
			// Line 6 is after selection
			expect(sel.getRangeForLine(6)).toBeNull();
		});

		it("getSelectedText extracts text from lines", () => {
			const sel = new SelectionState();
			const lines = ["hello world", "foo bar baz", "qux"];
			sel.start(0, 2);
			sel.extend(1, 7);
			expect(sel.getSelectedText(lines)).toBe("llo world\nfoo bar");
		});

		it("getSelectedText returns empty for single point", () => {
			const sel = new SelectionState();
			sel.start(0, 3);
			sel.extend(0, 3);
			expect(sel.getSelectedText(["hello"])).toBe("");
		});

		it("getSelectedText strips ANSI codes", () => {
			const sel = new SelectionState();
			const lines = ["\x1b[32mhello\x1b[0m world"];
			sel.start(0, 0);
			sel.extend(0, 8);
			expect(sel.getSelectedText(lines)).toBe("hello wo");
		});

		it("handles reverse selection (drag upward)", () => {
			const sel = new SelectionState();
			const lines = ["line0", "line1", "line2"];
			sel.start(2, 3);
			sel.extend(0, 2);
			// Normalized: start=(0,2) end=(2,3)
			expect(sel.getSelectedText(lines)).toBe("ne0\nline1\nlin");
		});
	});

	describe("highlightSelection", () => {
		it("applies inverse video to selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 2);
			sel.extend(0, 5);
			const result = highlightSelection("hello world", 0, sel);
			expect(result).toContain("\x1b[48;5;238m");
			expect(result).toContain("\x1b[49m");
			expect(result).toBe("he\x1b[48;5;238mllo\x1b[49m world");
		});

		it("does not modify non-selected lines", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 3);
			const result = highlightSelection("hello", 5, sel);
			expect(result).toBe("hello");
		});

		it("highlights full line for middle lines", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(2, 5);
			// Line 1 is a middle line — full highlight
			const result = highlightSelection("middle line", 1, sel);
			expect(result).toBe("\x1b[48;5;238mmiddle line\x1b[49m");
		});

		it("preserves ANSI colors in selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 5);
			const result = highlightSelection("\x1b[32mhello\x1b[0m world", 0, sel);
			expect(result).toContain("\x1b[32m"); // green preserved
			expect(result).toContain("\x1b[48;5;238m"); // inverse added
			expect(result).toContain("\x1b[49m"); // inverse off
			expect(result).toContain("\x1b[0m"); // original reset preserved
			expect(result).toContain("hello");
			expect(result).toContain("world");
		});

		it("preserves ANSI colors outside selected region", () => {
			const sel = new SelectionState();
			sel.start(0, 6);
			sel.extend(0, 11);
			const result = highlightSelection("\x1b[32mhello\x1b[0m world", 0, sel);
			expect(result).toContain("\x1b[32mhello\x1b[0m"); // before selection unchanged
			expect(result).toContain("\x1b[48;5;238m"); // inverse on selected part
		});

		it("handles multiple SGR codes within selection", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 11);
			const input = "\x1b[1m\x1b[31mhello\x1b[0m world";
			const result = highlightSelection(input, 0, sel);
			expect(result).toContain("\x1b[1m"); // bold preserved
			expect(result).toContain("\x1b[31m"); // red preserved
			expect(result).toContain("\x1b[48;5;238m"); // inverse added
			expect(result).toContain("\x1b[49m"); // inverse off
		});
	});

	describe("getSelectedText edge cases", () => {
		it("extracts URL from OSC 8 hyperlink", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://pi.dev/changelog\x1b\\Changelog:\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://pi.dev/changelog");
			expect(result).toContain("Changelog:");
		});

		it("handles OSC 8 with BEL terminator", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://example.com");
		});

		it("handles OSC 8 with id parameter", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;id=42;https://example.com\x1b\\link\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://example.com");
			expect(result).not.toContain("id=42");
		});

		it("does not duplicate URL when visible text is the URL", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://example.com\x1b\\https://example.com\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toBe("https://example.com");
		});

		it("handles OSC 8 with empty params (no URL)", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;\x1b\\plain text\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toBe("plain text");
		});

		it("handles multiple OSC 8 links on one line", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line =
				"\x1b]8;;https://a.com\x1b\\A\x1b]8;;\x1b\\ and \x1b]8;;https://b.com\x1b\\B\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("https://a.com");
			expect(result).toContain("https://b.com");
		});

		it("preserves ANSI colors inside OSC 8 text", () => {
			const sel = new SelectionState();
			sel.start(0, 0);
			sel.extend(0, 100);
			const line = "\x1b]8;;https://example.com\x1b\\\x1b[32mClick\x1b[0m\x1b]8;;\x1b\\";
			const result = sel.getSelectedText([line]);
			expect(result).toContain("Click");
			expect(result).toContain("https://example.com");
			expect(result).not.toContain("\x1b[32m");
		});
	});
});
