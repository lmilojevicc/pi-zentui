import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { disposeFixedEditor, installFixedEditorProbe } from "../extensions/zentui/fixed-editor";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

afterEach(() => {
	disposeFixedEditor();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("SessionLifecycle", () => {
	it("cancels owned timeouts, rejects old generations, and shuts down twice safely", () => {
		vi.useFakeTimers();
		const lifecycle = new SessionLifecycle();
		const calls: string[] = [];
		const oldGeneration = lifecycle.start();
		lifecycle.defer(() => calls.push("old"));

		lifecycle.shutdown();
		lifecycle.shutdown();
		const currentGeneration = lifecycle.start();
		lifecycle.defer(() => calls.push("current"));
		vi.runAllTimers();

		expect(calls).toEqual(["current"]);
		expect(lifecycle.isCurrent(oldGeneration)).toBe(false);
		expect(lifecycle.isCurrent(currentGeneration)).toBe(true);
	});

	it("drops queued microtasks from an old generation", async () => {
		const lifecycle = new SessionLifecycle();
		const calls: string[] = [];
		lifecycle.start();
		lifecycle.queueMicrotask(() => calls.push("old"));
		lifecycle.start();
		lifecycle.queueMicrotask(() => calls.push("current"));

		await Promise.resolve();

		expect(calls).toEqual(["current"]);
	});
});

describe("fixed-editor probe lifecycle", () => {
	it("fails closed with one warning when queued compatibility inspection throws", async () => {
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		let widgetFactory: ((tui: unknown) => { render(): string[] }) | undefined;
		const terminalWrite = vi.fn();
		const addInputListener = vi.fn(() => () => {});
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const ctx = {
			hasUI: true,
			ui: {
				setWidget(key: string, factory: unknown) {
					if (key === "zentui-fixed-editor-probe" && typeof factory === "function") {
						widgetFactory = factory as typeof widgetFactory;
					}
				},
			},
		};
		installFixedEditorProbe(
			ctx as never,
			() => ({
				...defaultConfig,
				fixedEditor: { ...defaultConfig.fixedEditor, enabled: true },
			}),
			lifecycle,
		);
		const tui = new Proxy(
			{
				terminal: { columns: 80, rows: 24, write: terminalWrite },
				render: () => [],
				doRender() {},
				addInputListener,
				removeInputListener() {},
			},
			{
				get(target, property, receiver) {
					if (property === "children") throw new Error("private getter changed");
					return Reflect.get(target, property, receiver);
				},
			},
		);
		widgetFactory?.(tui).render();
		widgetFactory?.(tui).render();

		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(warning).toHaveBeenCalledTimes(1);
		expect(terminalWrite).not.toHaveBeenCalled();
		expect(addInputListener).not.toHaveBeenCalled();
	});

	it("cannot install from queued probe microtasks after disposal", async () => {
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		let widgetFactory: ((tui: unknown) => { render(): string[] }) | undefined;
		const terminalWrite = vi.fn();
		const ctx = {
			hasUI: true,
			ui: {
				setWidget(key: string, factory: unknown) {
					if (key === "zentui-fixed-editor-probe" && typeof factory === "function") {
						widgetFactory = factory as typeof widgetFactory;
					}
				},
			},
		};
		installFixedEditorProbe(
			ctx as never,
			() => ({
				...defaultConfig,
				fixedEditor: { ...defaultConfig.fixedEditor, enabled: true },
			}),
			lifecycle,
		);
		const component = widgetFactory?.({ terminal: { write: terminalWrite } });
		component?.render();

		disposeFixedEditor();
		await Promise.resolve();
		await Promise.resolve();

		expect(terminalWrite).not.toHaveBeenCalled();
	});
});
