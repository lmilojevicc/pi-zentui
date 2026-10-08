import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { WorkingLineController } from "../extensions/zentui/working-line";

function harness() {
	const config = structuredClone(defaultConfig);
	Object.assign(config.components.workingLine, {
		enabled: true,
		// Message ownership tests observe the floating Loader unless testing border fallback.
		placement: "above",
		textAnimation: "disabled",
		messages: { custom: true, values: ["Stable"] },
	});
	config.components.workingLine.segments.elapsed = false;
	config.components.workingLine.segments.thought = false;
	let capable = true;
	let message = "Working...";
	let indicator: { frames?: string[]; intervalMs?: number } | undefined;
	let loader: Loader | undefined;
	const row = () => stripVTControlCharacters(loader?.render(120).join("\n") ?? "").trim();
	const activateLoader = () => {
		loader?.stop();
		loader = new Loader(
			{ requestRender() {} } as never,
			(s) => s,
			(s) => s,
			message,
			indicator,
		);
	};
	const shownRows: string[] = [];
	const ui = {
		setWorkingMessage: vi.fn((value?: string) => {
			message = value ?? "Working...";
			loader?.setMessage(message);
		}),
		setWorkingIndicator: vi.fn((value?: typeof indicator) => {
			indicator = value;
			loader?.setIndicator(value);
		}),
		setWorkingVisible: vi.fn((visible: boolean) => {
			loader?.stop();
			loader = undefined;
			if (visible) {
				activateLoader();
				shownRows.push(row());
			}
		}),
	};
	const ctx = { hasUI: true, mode: "tui", ui };
	const theme = {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as Theme;
	const controller = new WorkingLineController(
		() => config,
		() => theme,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		() => capable,
	);
	return {
		config,
		controller,
		ctx,
		ui,
		row,
		shownRows,
		loseBorder: () => {
			capable = false;
		},
		start() {
			controller.startSession(ctx);
			controller.startAgent(ctx);
			if (config.components.workingLine.placement === "above") activateLoader();
		},
		stop() {
			controller.dispose(ctx);
			loader?.stop();
		},
	};
}

describe("working-line message ownership", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it.each(["external preview", undefined])("clears %s on a visible repaint", (external) => {
		const h = harness();
		h.start();
		h.ui.setWorkingMessage(external);
		expect(h.row()).toContain(external ?? "Working...");
		const writes = h.ui.setWorkingIndicator.mock.calls.length;
		h.controller.updateTokens({ input: 12, output: 3 }, h.ctx);
		expect(h.row()).toMatch(/Stable · ↑12 ↓3$/);
		expect(h.ui.setWorkingIndicator).toHaveBeenCalledTimes(writes + 1);
		h.stop();
	});

	it.each(["tokens", "metrics", "flush", "reconcile", "turn"])(
		"clears a reset on unchanged static %s without rebuilding or restarting animation",
		(boundary) => {
			const h = harness();
			h.start();
			h.controller.updateTokens({ input: 12, output: 3 }, h.ctx);
			vi.advanceTimersByTime(100);
			const before = h.row();
			const writes = h.ui.setWorkingIndicator.mock.calls.length;
			const timers = vi.getTimerCount();
			h.ui.setWorkingMessage();
			if (boundary === "tokens") h.controller.updateTokens({ input: 12, output: 3 }, h.ctx);
			else if (boundary === "metrics")
				h.controller.updateMetrics({ input: 12, output: 3 }, undefined, h.ctx);
			else if (boundary === "flush")
				h.controller.flushMetrics({ input: 12, output: 3 }, undefined, h.ctx);
			else if (boundary === "reconcile") h.controller.reconcile(h.ctx);
			else h.controller.startTurn(h.ctx);
			expect(h.row()).toBe(before);
			expect(h.ui.setWorkingIndicator).toHaveBeenCalledTimes(writes);
			expect(vi.getTimerCount()).toBe(timers);
			h.stop();
		},
	);

	it.each(["frame", "tick", "reconcile", "finish"])(
		"clears hidden resets before Border -> Above on %s with unchanged frames",
		(boundary) => {
			const h = harness();
			h.config.components.workingLine.placement = "border";
			h.start();
			const writes = h.ui.setWorkingIndicator.mock.calls.length;
			const messages = h.ui.setWorkingMessage.mock.calls.length;
			h.controller.currentWorkingLineFrame();
			vi.advanceTimersByTime(100);
			// Rendering/ticking an embedded frame does not write public message state.
			expect(h.ui.setWorkingMessage).toHaveBeenCalledTimes(messages);
			h.ui.setWorkingMessage();
			if (boundary === "reconcile") {
				h.config.components.workingLine.placement = "above";
				h.controller.reconcile(h.ctx);
			} else if (boundary === "finish") h.controller.finishAgent(h.ctx);
			else {
				h.loseBorder();
				if (boundary === "frame") h.controller.currentWorkingLineFrame();
				else vi.advanceTimersByTime(100);
			}
			expect(h.shownRows).toHaveLength(1);
			expect(h.shownRows[0]).toMatch(/Stable$/);
			expect(h.row()).toMatch(/Stable$/);
			expect(h.ui.setWorkingIndicator).toHaveBeenCalledTimes(writes);
			h.stop();
		},
	);

	it.each(["refresh", "fallback"])(
		"recovers a transient message-setter failure on %s",
		(boundary) => {
			const h = harness();
			if (boundary === "fallback") h.config.components.workingLine.placement = "border";
			h.start();
			h.ui.setWorkingMessage("external preview");
			h.ui.setWorkingMessage.mockImplementationOnce(() => {
				throw new Error("message unavailable");
			});
			if (boundary === "fallback") {
				h.loseBorder();
				expect(() => h.controller.currentWorkingLineFrame()).not.toThrow();
			} else h.controller.updateTokens(undefined, h.ctx);
			expect(h.controller.isAvailable()).toBe(true);
			expect(h.row()).toMatch(/Stable$/);
			h.stop();
		},
	);

	it.each(["refresh", "fallback"])(
		"releases once after persistent message failure on %s",
		(boundary) => {
			const h = harness();
			if (boundary === "fallback") h.config.components.workingLine.placement = "border";
			h.start();
			const setMessage = h.ui.setWorkingMessage.getMockImplementation();
			h.ui.setWorkingMessage.mockImplementation((value) => {
				setMessage?.(value);
				if (value === "") throw new Error("message mutated then failed");
			});
			if (boundary === "fallback") {
				h.loseBorder();
				expect(() => h.controller.currentWorkingLineFrame()).not.toThrow();
			} else h.controller.updateTokens(undefined, h.ctx);
			expect(h.controller.isAvailable()).toBe(false);
			expect(h.row()).toContain("Working...");
			expect(h.row()).not.toContain("Stable");
			expect(
				h.ui.setWorkingMessage.mock.calls.filter(([value]) => value === undefined),
			).toHaveLength(1);
			expect(
				h.ui.setWorkingIndicator.mock.calls.filter(([value]) => value === undefined),
			).toHaveLength(1);
			h.ui.setWorkingMessage("successor");
			const messages = h.ui.setWorkingMessage.mock.calls.length;
			h.controller.updateTokens({ input: 3, output: 4 }, h.ctx);
			h.controller.finishAgent(h.ctx);
			h.controller.currentWorkingLineFrame();
			h.stop();
			expect(h.ui.setWorkingMessage).toHaveBeenCalledTimes(messages);
			expect(h.row()).toContain("successor");
		},
	);

	it.each(["disabled", "disposed"])("leaves %s surfaces alone", (state) => {
		const h = harness();
		if (state === "disabled") h.config.components.workingLine.enabled = false;
		h.start();
		if (state === "disposed") h.controller.dispose(h.ctx);
		h.ui.setWorkingMessage("successor");
		const messages = h.ui.setWorkingMessage.mock.calls.length;
		const indicators = h.ui.setWorkingIndicator.mock.calls.length;
		h.controller.updateTokens({ input: 1, output: 1 }, h.ctx);
		h.controller.flushMetrics(undefined, undefined, h.ctx);
		h.controller.finishAgent(h.ctx);
		if (state === "disabled") h.controller.reconcile(h.ctx);
		vi.advanceTimersByTime(2000);
		h.stop();
		expect(h.ui.setWorkingMessage).toHaveBeenCalledTimes(messages);
		expect(h.ui.setWorkingIndicator).toHaveBeenCalledTimes(indicators);
		expect(h.row()).toContain("successor");
	});
});
