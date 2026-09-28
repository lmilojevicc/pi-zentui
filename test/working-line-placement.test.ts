import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { WorkingLineController } from "../extensions/zentui/working-line";

function harness(capability?: () => boolean) {
	const config = structuredClone(defaultConfig);
	Object.assign(config.components.workingLine, {
		enabled: true,
		placement: "border",
		textAnimation: "disabled",
		spinnerIntervalMs: 1000,
		messages: { custom: true, values: ["Stable"] },
	});
	config.components.workingLine.segments.elapsed = false;
	config.components.workingLine.segments.thought = false;
	const ui = {
		setWorkingMessage: vi.fn((_message?: string) => {}),
		setWorkingIndicator: vi.fn((_options?: { frames?: string[]; intervalMs?: number }) => {}),
		setWorkingVisible: vi.fn((_visible: boolean) => {}),
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
		capability,
	);
	const requestRender = vi.fn();
	controller.setRequestRender(requestRender);
	const start = () => {
		expect(controller.startSession(ctx).applied).toBe(true);
		controller.startAgent(ctx);
	};
	return { config, ui, ctx, controller, requestRender, start };
}

describe("working-line border placement controller", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("reconciles stable-frame placement and capability changes without rebuilding frames", () => {
		let capable = true;
		const h = harness(() => capable);
		h.start();
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false]]);
		expect(h.controller.currentWorkingLineFrame()).toContain("Stable");
		const writes = h.ui.setWorkingIndicator.mock.calls.length;
		h.config.components.workingLine.placement = "above";
		expect(h.controller.reconcile(h.ctx).applied).toBe(true);
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
		h.controller.reconcile(h.ctx);
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		h.config.components.workingLine.placement = "border";
		h.controller.reconcile(h.ctx);
		h.controller.reconcile(h.ctx);
		expect(h.controller.currentWorkingLineFrame()).toContain("Stable");
		expect(vi.getTimerCount()).toBe(1);
		capable = false;
		h.controller.reconcile(h.ctx);
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
		capable = true;
		h.controller.reconcile(h.ctx);
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true], [false], [true], [false]]);
		expect(h.ui.setWorkingIndicator).toHaveBeenCalledTimes(writes);
	});

	it.each(["default", "false", "throws"])("fails above with %s renderer capability", (kind) => {
		const h = harness(
			kind === "default"
				? undefined
				: () => {
						if (kind === "throws") throw new Error("editor getter unavailable");
						return false;
					},
		);
		const choices = structuredClone(h.config);
		h.start();
		expect(h.controller.isAvailable()).toBe(true);
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.ui.setWorkingVisible).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		expect(h.config).toEqual(choices);
	});

	it("fails above when visibility is unavailable without claiming a no-op hide", () => {
		const h = harness(() => true);
		Object.defineProperty(h.ui, "setWorkingVisible", { value: undefined, configurable: true });
		h.start();
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.controller.isAvailable()).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		const visible = vi.fn();
		Object.defineProperty(h.ui, "setWorkingVisible", { value: visible });
		h.controller.reconcile(h.ctx);
		expect(visible.mock.calls).toEqual([[false]]);
		h.controller.dispose(h.ctx);
		expect(visible.mock.calls).toEqual([[false], [true]]);
	});

	it("treats legacy input placement as above without rewriting it", () => {
		const h = harness(() => true);
		Object.assign(h.config.components.workingLine, { placement: "input" });
		h.start();
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.ui.setWorkingVisible).not.toHaveBeenCalled();
		expect(h.config.components.workingLine.placement).toBe("input");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("restores with the captured setter if the visibility API later disappears or throws", () => {
		const h = harness(() => true);
		h.start();
		const originalSetter = h.ui.setWorkingVisible;
		Object.defineProperty(h.ui, "setWorkingVisible", {
			get: () => {
				throw new Error("API unavailable");
			},
		});
		expect(() => h.controller.reconcile(h.ctx)).not.toThrow();
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(originalSetter.mock.calls).toEqual([[false], [true]]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("restores a native hide that mutates then throws and exposes no border frame", () => {
		const h = harness(() => true);
		let visible = true;
		h.ui.setWorkingVisible.mockImplementation((value) => {
			visible = value;
			if (!value) throw new Error("hide failed after mutation");
		});
		expect(() => h.start()).not.toThrow();
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(visible).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		expect(h.controller.isAvailable()).toBe(true);
		h.ui.setWorkingVisible.mockImplementation((value) => {
			visible = value;
		});
		h.controller.reconcile(h.ctx);
		expect(visible).toBe(false);
		expect(h.controller.currentWorkingLineFrame()).toContain("Stable");
	});

	it("retries visibility restoration after double indicator failure and disable/reset", () => {
		const h = harness(() => true);
		h.start();
		let failRestore = true;
		h.ui.setWorkingVisible.mockImplementation((visible) => {
			if (visible && failRestore) throw new Error("restore unavailable");
		});
		h.ui.setWorkingIndicator.mockImplementation((options) => {
			if (options) throw new Error("update and recovery unavailable");
		});
		h.config.components.workingLine.spinnerIntervalMs = 100;
		expect(h.controller.reconcile(h.ctx).applied).toBe(false);
		expect(h.controller.isAvailable()).toBe(false);
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		expect(vi.getTimerCount()).toBe(0);
		h.config.components.workingLine.enabled = false;
		expect(() => h.controller.reconcile(h.ctx)).not.toThrow();
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true], [true]]);
		failRestore = false;
		h.controller.dispose(h.ctx);
		h.controller.dispose(h.ctx);
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true], [true], [true]]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("recovery uses current capability instead of restoring stale border placement", () => {
		let capable = true;
		const h = harness(() => capable);
		h.start();
		h.ui.setWorkingIndicator.mockImplementationOnce(() => {
			capable = false;
			throw new Error("update failed");
		});
		h.config.components.workingLine.spinnerIntervalMs = 100;
		expect(h.controller.reconcile(h.ctx).applied).toBe(false);
		expect(h.controller.isAvailable()).toBe(true);
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reschedules generated animation cadence once and cancels all above ticks", () => {
		const h = harness(() => true);
		h.start();
		vi.advanceTimersByTime(999);
		expect(h.requestRender).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		h.config.components.workingLine.spinnerIntervalMs = 100;
		h.controller.reconcile(h.ctx);
		expect(h.ui.setWorkingIndicator.mock.lastCall?.[0]?.intervalMs).toBe(100);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(50);
		h.controller.reconcile(h.ctx);
		vi.advanceTimersByTime(49);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(h.requestRender).toHaveBeenCalledTimes(2);
		h.config.components.workingLine.placement = "above";
		h.controller.reconcile(h.ctx);
		vi.advanceTimersByTime(1000);
		expect(vi.getTimerCount()).toBe(0);
		expect(h.requestRender).toHaveBeenCalledTimes(2);
		h.config.components.workingLine.placement = "border";
		h.controller.reconcile(h.ctx);
		vi.advanceTimersByTime(100);
		expect(h.requestRender).toHaveBeenCalledTimes(3);
	});

	it("uses the generated animation quantum rather than only the spinner interval", () => {
		const h = harness(() => true);
		h.config.components.workingLine.textAnimation = "classic";
		h.config.components.workingLine.textIntervalMs = 60;
		h.start();
		const interval = h.ui.setWorkingIndicator.mock.lastCall?.[0]?.intervalMs;
		expect(interval).toBe(30);
		vi.advanceTimersByTime(29);
		expect(h.requestRender).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
	});

	it.each(["frame", "tick"])("detects renderer loss on %s without metric updates", (path) => {
		let capable = true;
		const h = harness(() => capable);
		h.start();
		capable = false;
		if (path === "frame") expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		else vi.advanceTimersByTime(1000);
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(["disable", "finish", "dispose", "restart"])("releases border on %s", (action) => {
		const h = harness(() => true);
		h.start();
		if (action === "disable") {
			h.config.components.workingLine.enabled = false;
			h.controller.reconcile(h.ctx);
		} else if (action === "finish") h.controller.finishAgent(h.ctx);
		else if (action === "dispose") h.controller.dispose(h.ctx);
		else h.controller.startSession(h.ctx);
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		expect(vi.getTimerCount()).toBe(0);
		h.config.components.workingLine.enabled = true;
		h.controller.startSession(h.ctx);
		h.controller.startAgent(h.ctx);
		expect(h.controller.currentWorkingLineFrame()).toContain("Stable");
		expect(vi.getTimerCount()).toBe(1);
	});

	it("restores the original UI when replaced or when public Working methods disappear", () => {
		const h = harness(() => true);
		h.start();
		const replacement = {
			setWorkingMessage: vi.fn(),
			setWorkingIndicator: vi.fn(),
			setWorkingVisible: vi.fn(),
		};
		h.ctx.ui = replacement;
		expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
		expect(h.ui.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		expect(replacement.setWorkingVisible).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		h.controller.reconcile(h.ctx);
		expect(h.ui.setWorkingIndicator).toHaveBeenLastCalledWith();
		expect(replacement.setWorkingVisible.mock.calls).toEqual([[false]]);
		Object.defineProperty(replacement, "setWorkingIndicator", { value: undefined });
		expect(h.controller.reconcile(h.ctx).applied).toBe(false);
		expect(replacement.setWorkingVisible.mock.calls).toEqual([[false], [true]]);
		expect(h.controller.isAvailable()).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
});
