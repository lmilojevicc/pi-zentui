import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { disposeFixedEditor, installFixedEditorProbe } from "../extensions/zentui/fixed-editor";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

afterEach(() => {
	disposeFixedEditor();
	vi.useRealTimers();
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
