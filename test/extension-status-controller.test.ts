import { describe, expect, it, vi } from "vitest";
import type { ExtensionStatusVisibilityConfig } from "../extensions/zentui/config";
import { createExtensionStatusController } from "../extensions/zentui/extension-status-controller";

function harness(defaultVisibility: "show" | "hide" = "show") {
	const policy: ExtensionStatusVisibilityConfig = { defaultVisibility, visibility: {} };
	const provider = new Map<string, string>();
	const original = vi.fn(function (this: unknown, key: string, text: string | undefined) {
		if (text === undefined) provider.delete(key);
		else provider.set(key, text);
		return "result";
	});
	const ui = { setStatus: original as (key: string, text: string | undefined) => void };
	const controller = createExtensionStatusController(() => policy);
	controller.install(ui);
	return { policy, provider, original, ui, controller };
}

describe("independent extension status controller", () => {
	it("observes neutrally, preserving receiver, arguments, result, ANSI and descriptors exactly", () => {
		const h = harness();
		const wrapper = h.ui.setStatus;
		h.controller.install(h.ui);
		h.controller.reconcile();
		expect(h.ui.setStatus).toBe(wrapper);
		expect(h.original).not.toHaveBeenCalled();
		const args = ["a:b", "\x1b[31mraw\x1b[0m", "extra"];
		expect(Reflect.apply(wrapper, h.ui, args)).toBe("result");
		expect(h.original).toHaveBeenCalledExactlyOnceWith(...args);
		expect(h.original.mock.contexts[0]).toBe(h.ui);
		expect(h.controller.snapshot().get("a:b")).toBe(args[1]);
		h.ui.setStatus("a:b", undefined);
		expect(h.controller.snapshot().size).toBe(0);
		h.controller.dispose();
		h.controller.dispose();
		expect(h.original).toHaveBeenCalledTimes(2);
		expect(Object.getOwnPropertyDescriptor(h.ui, "setStatus")).toEqual({
			value: h.original,
			writable: true,
			configurable: true,
			enumerable: true,
		});
	});

	it("filters independent keys and releases only the latest successful hidden publication", () => {
		const h = harness("hide");
		h.policy.visibility = JSON.parse('{"__proto__":"show","a:b":"hide"}');
		h.ui.setStatus("__proto__", "visible");
		h.ui.setStatus("a:b", "old");
		h.ui.setStatus("a:b", "latest");
		h.ui.setStatus("deleted", "gone");
		h.ui.setStatus("deleted", undefined);
		expect([...h.provider]).toEqual([["__proto__", "visible"]]);
		h.policy.visibility["a:b"] = "show";
		h.controller.reconcile();
		expect(h.provider.get("a:b")).toBe("latest");
		delete h.policy.visibility["a:b"];
		h.controller.reconcile();
		expect(h.provider.has("a:b")).toBe(false);
		h.ui.setStatus("a:b", "newest");
		h.controller.dispose();
		expect(h.provider.get("a:b")).toBe("newest");
		expect(h.provider.has("deleted")).toBe(false);
	});

	it("hides previously observed values without unsolicited writes on unchanged policy", () => {
		const h = harness();
		h.ui.setStatus("third-party", "raw");
		h.policy.defaultVisibility = "hide";
		h.controller.reconcile();
		expect(h.provider.size).toBe(0);
		h.controller.reconcile();
		expect(h.original).toHaveBeenCalledTimes(2);
		h.policy.defaultVisibility = "show";
		h.controller.reconcile();
		expect(h.provider.get("third-party")).toBe("raw");
		h.controller.dispose();
		expect(h.original).toHaveBeenCalledTimes(3);
	});

	it.each(["accessor", "frozen", "inherited", "nonwritable", "nonconfigurable"])(
		"fails open for %s setters",
		(shape) => {
			const setter = vi.fn();
			const ui =
				shape === "inherited" ? Object.create({ setStatus: setter }) : { setStatus: setter };
			if (shape === "accessor") Object.defineProperty(ui, "setStatus", { get: () => setter });
			if (shape === "frozen") Object.freeze(ui);
			if (shape === "nonwritable") Object.defineProperty(ui, "setStatus", { writable: false });
			if (shape === "nonconfigurable")
				Object.defineProperty(ui, "setStatus", { configurable: false });
			const descriptor = Object.getOwnPropertyDescriptor(ui, "setStatus");
			const c = createExtensionStatusController(() => ({
				defaultVisibility: "hide",
				visibility: {},
			}));
			c.install(ui);
			ui.setStatus("x", "text");
			c.reconcile();
			c.dispose();
			expect(setter).toHaveBeenCalledExactlyOnceWith("x", "text");
			expect(Object.getOwnPropertyDescriptor(ui, "setStatus")).toEqual(descriptor);
		},
	);

	it.each([true, false])(
		"does not overwrite or replay through a successor (delegates=%s)",
		(delegates) => {
			const h = harness("hide");
			h.ui.setStatus("x", "stale");
			const buried = h.ui.setStatus;
			const successor = vi.fn(function (this: unknown, key: string, value: string | undefined) {
				if (delegates) return buried.call(this, key, value);
			});
			h.ui.setStatus = successor;
			h.ui.setStatus("x", "foreign");
			h.controller.reconcile();
			h.controller.dispose();
			expect(h.ui.setStatus).toBe(successor);
			expect(successor).toHaveBeenCalledTimes(1);
			expect(h.original).toHaveBeenCalledTimes(delegates ? 2 : 1);
			buried.call(h.ui, "x", "after disposal");
			expect(h.provider.get("x")).toBe("after disposal");
		},
	);

	it("leaves changed foreign descriptors alone and deactivates cached wrappers", () => {
		const h = harness("hide");
		h.ui.setStatus("x", "hidden");
		const wrapper = h.ui.setStatus;
		Object.defineProperty(h.ui, "setStatus", { enumerable: false });
		h.controller.dispose();
		expect(Object.getOwnPropertyDescriptor(h.ui, "setStatus")?.enumerable).toBe(false);
		expect(h.ui.setStatus).toBe(wrapper);
		expect(h.original).toHaveBeenCalledTimes(1);
		h.ui.setStatus("x", "shown");
		expect(h.provider.get("x")).toBe("shown");
	});

	it.each([undefined, "failed update"])(
		"does not claim failed publication/deletion: %s",
		(value) => {
			const h = harness("hide");
			h.ui.setStatus("x", "old");
			const error = new Error("predecessor failure");
			h.original.mockImplementationOnce(() => {
				throw error;
			});
			expect(() => h.ui.setStatus("x", value)).toThrow(error);
			expect(h.controller.snapshot().get("x")).toBe(value);
			h.policy.defaultVisibility = "show";
			h.controller.reconcile();
			h.controller.dispose();
			expect(h.original).toHaveBeenCalledTimes(2);
			expect(h.provider.has("x")).toBe(false);
		},
	);

	it("fails open on cleanup failure and clears session observations", () => {
		const h = harness("hide");
		h.ui.setStatus("x", "hidden");
		h.original.mockImplementationOnce(() => {
			throw new Error("cleanup");
		});
		h.controller.dispose();
		h.controller.dispose();
		expect(h.ui.setStatus).toBe(h.original);
		expect(h.controller.snapshot().size).toBe(0);
		expect(h.original).toHaveBeenCalledTimes(2);
	});

	it("releases the old UI and starts a clean new session", () => {
		const h = harness("hide");
		h.ui.setStatus("x", "old session");
		const next = { setStatus: vi.fn() };
		h.controller.install(next);
		expect(h.ui.setStatus).toBe(h.original);
		expect(h.provider.get("x")).toBe("old session");
		expect(h.controller.snapshot().size).toBe(0);
		expect(next.setStatus).not.toBe(h.original);
		next.setStatus("new", "value");
		expect(h.controller.snapshot().get("new")).toBe("value");
		h.controller.dispose();
	});
	it("preserves foreign receivers and neutral errors, and cannot intercept cached predecessors", () => {
		const h = harness();
		const receiver = {};
		Reflect.apply(h.ui.setStatus, receiver, ["foreign", "raw"]);
		expect(h.original.mock.contexts[0]).toBe(receiver);
		const error = new Error("native error");
		h.original.mockImplementationOnce(() => {
			throw error;
		});
		expect(() => h.ui.setStatus("failed", "text")).toThrow(error);
		h.policy.defaultVisibility = "hide";
		h.controller.reconcile();
		expect(h.original).toHaveBeenCalledTimes(2);
		h.original.call(h.ui, "cached", "bypass");
		expect(h.controller.snapshot().has("cached")).toBe(false);
		expect(h.provider.get("cached")).toBe("bypass");
		h.controller.dispose();
	});

	it("does not replay an older outer call over a reentrant publication", () => {
		const h = harness("hide");
		h.original.mockImplementationOnce(() => {
			h.ui.setStatus("x", "newer");
			return "outer";
		});
		h.ui.setStatus("x", "older");
		h.controller.dispose();
		expect(h.provider.get("x")).toBe("newer");
	});

	it.each(["newer", undefined])(
		"keeps reentrant disposal publications neutral without stale replay: %s",
		(value) => {
			const h = harness("hide");
			Object.defineProperty(h.ui, "setStatus", { value: h.original, enumerable: false });
			const descriptor = Object.getOwnPropertyDescriptor(h.ui, "setStatus");
			h.controller.dispose();
			h.controller.install(h.ui);
			h.ui.setStatus("x", "old");
			h.ui.setStatus("y", "stale");
			h.original.mockImplementationOnce((key, text) => {
				if (text !== undefined) h.provider.set(key, text);
				h.ui.setStatus("x", value);
				h.ui.setStatus("y", value);
				return "replayed";
			});
			h.controller.dispose();
			h.controller.dispose();
			expect(h.provider.get("x")).toBe(value);
			expect(h.provider.get("y")).toBe(value);
			expect(h.original.mock.calls).toEqual([
				["x", undefined],
				["y", undefined],
				["x", "old"],
				["x", value],
				["y", value],
			]);
			expect(Object.getOwnPropertyDescriptor(h.ui, "setStatus")).toEqual(descriptor);
			expect(h.controller.snapshot().size).toBe(0);
		},
	);

	it("does not reassert suppression after a reentrant deletion during release", () => {
		const h = harness("hide");
		h.ui.setStatus("x", "hidden");
		h.original.mockImplementationOnce(() => {
			h.ui.setStatus("x", undefined);
			return "deleted";
		});
		h.policy.defaultVisibility = "show";
		h.controller.reconcile();
		h.controller.dispose();
		expect(h.provider.has("x")).toBe(false);
		expect(h.original).toHaveBeenCalledTimes(3);
	});
});
