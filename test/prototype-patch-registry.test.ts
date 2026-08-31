import { describe, expect, it, vi } from "vitest";
import {
	installPrototypePatch,
	isPrototypePatchCurrent,
	ZENTUI_PROTOTYPE_PATCH_REGISTRY,
} from "../extensions/zentui/prototype-patch-registry";

describe("prototype patch registry updateContent ownership", () => {
	it("forwards every argument, reuses its wrapper, and restores an inherited predecessor", () => {
		const predecessor = vi.fn(function (this: { value: number }, ...args: unknown[]) {
			return [this.value, ...args];
		});
		const parent = { updateContent: predecessor };
		const target = Object.create(parent) as object & {
			updateContent: (...args: unknown[]) => unknown;
		};
		const behavior = vi.fn(({ predecessor: previous, receiver, args }) =>
			Reflect.apply(previous, receiver, args),
		);
		const cleanupFirst = installPrototypePatch(
			target,
			"updateContent",
			"thinking-experimental-update-content",
			behavior,
		);
		const wrapper = target.updateContent;
		expect(target.updateContent.call({ value: 7 }, "message", true, "future-argument")).toEqual([
			7,
			"message",
			true,
			"future-argument",
		]);
		expect(behavior.mock.calls[0]?.[0].args).toEqual(["message", true, "future-argument"]);
		const cleanupSecond = installPrototypePatch(
			target,
			"updateContent",
			"thinking-experimental-update-content",
			behavior,
		);
		expect(target.updateContent).toBe(wrapper);
		expect(cleanupFirst.token).not.toBe(cleanupSecond.token);
		expect(
			isPrototypePatchCurrent(
				target,
				"updateContent",
				"thinking-experimental-update-content",
				cleanupFirst.token,
			),
		).toBe(false);
		expect(
			isPrototypePatchCurrent(
				target,
				"updateContent",
				"thinking-experimental-update-content",
				cleanupSecond.token,
			),
		).toBe(true);
		cleanupFirst();
		expect(target.updateContent).toBe(wrapper);
		expect(target.updateContent.call({ value: 8 }, "newest")).toEqual([8, "newest"]);
		cleanupSecond();
		expect(Object.hasOwn(target, "updateContent")).toBe(false);
		expect(target.updateContent).toBe(predecessor);
		expect(
			(target as unknown as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
		).toBeUndefined();
	});

	it("preserves an exact own descriptor and never restores over a foreign successor", () => {
		const target = {} as { updateContent: (...args: unknown[]) => unknown };
		const predecessor = function predecessor() {};
		const descriptor = {
			value: predecessor,
			writable: false,
			enumerable: false,
			configurable: true,
		};
		Object.defineProperty(target, "updateContent", descriptor);
		const cleanup = installPrototypePatch(
			target,
			"updateContent",
			"thinking-experimental-update-content",
			({ predecessor: previous, receiver, args }) => Reflect.apply(previous, receiver, args),
		);
		expect(Object.getOwnPropertyDescriptor(target, "updateContent")).toMatchObject({
			writable: false,
			enumerable: false,
			configurable: true,
		});
		const foreign = function foreign() {};
		Object.defineProperty(target, "updateContent", { ...descriptor, value: foreign });
		expect(
			isPrototypePatchCurrent(target, "updateContent", "thinking-experimental-update-content"),
		).toBe(false);
		cleanup();
		expect(target.updateContent).toBe(foreign);
	});

	it("rejects missing, noncallable, and nonconfigurable targets without leaving registry state", () => {
		for (const target of [{}, { updateContent: 1 }]) {
			expect(() =>
				installPrototypePatch(
					target,
					"updateContent",
					"thinking-experimental-update-content",
					() => undefined,
				),
			).toThrow(/predecessor is not a function/);
			expect(
				(target as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
			).toBeUndefined();
		}
		const fixed = {} as { updateContent: () => void };
		Object.defineProperty(fixed, "updateContent", {
			value: () => {},
			writable: false,
			configurable: false,
		});
		expect(() =>
			installPrototypePatch(
				fixed,
				"updateContent",
				"thinking-experimental-update-content",
				() => undefined,
			),
		).toThrow();
		expect(
			(fixed as unknown as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
		).toBeUndefined();
	});
});
