import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFooterTelemetry } from "../extensions/zentui/telemetry";

function makeContext(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/tmp/project",
		model: { id: "model", provider: "anthropic" },
		modelRegistry: { isUsingOAuth: () => false },
		isProjectTrusted: () => true,
		...overrides,
	} as unknown as ExtensionContext;
}

function settingsCapability(options: {
	enabled?: unknown;
	errors?: unknown[];
	throwCreate?: boolean;
}) {
	const create = vi.fn(() => {
		if (options.throwCreate) throw new Error("unsupported");
		return {
			drainErrors: () => options.errors ?? [],
			getCompactionEnabled: () => options.enabled,
		};
	});
	return { create };
}

afterEach(() => vi.restoreAllMocks());

describe("resolveFooterTelemetry", () => {
	it("uses the public OAuth and settings capabilities", () => {
		const settingsManager = settingsCapability({ enabled: true });
		const modelRegistry = { isUsingOAuth: vi.fn(() => true) };
		const ctx = makeContext({ modelRegistry, isProjectTrusted: () => false });

		expect(resolveFooterTelemetry(ctx, { settingsManager })).toEqual({
			subscription: true,
			autoCompaction: true,
		});
		expect(modelRegistry.isUsingOAuth).toHaveBeenCalledWith(ctx.model);
		expect(settingsManager.create).toHaveBeenCalledWith("/tmp/project", undefined, {
			projectTrusted: false,
		});
	});

	it("recognizes Kimi subscription mode without an OAuth lookup", () => {
		const isUsingOAuth = vi.fn(() => false);
		const ctx = makeContext({
			model: { id: "kimi", provider: "kimi-coding" },
			modelRegistry: { isUsingOAuth },
		});

		expect(
			resolveFooterTelemetry(ctx, { settingsManager: settingsCapability({ enabled: false }) }),
		).toMatchObject({ subscription: true, autoCompaction: false });
		expect(isUsingOAuth).not.toHaveBeenCalled();
	});

	it("returns explicit false values when supported telemetry is disabled", () => {
		expect(
			resolveFooterTelemetry(makeContext(), {
				settingsManager: settingsCapability({ enabled: false }),
			}),
		).toEqual({ subscription: false, autoCompaction: false });
	});

	it.each([
		[
			"absent capabilities",
			makeContext({ modelRegistry: {}, isProjectTrusted: undefined }),
			{ settingsManager: {} },
			{ subscription: undefined, autoCompaction: undefined },
		],
		[
			"throwing capabilities",
			makeContext({
				modelRegistry: {
					isUsingOAuth: () => {
						throw new Error("nope");
					},
				},
			}),
			{ settingsManager: settingsCapability({ throwCreate: true }) },
			{ subscription: undefined, autoCompaction: undefined },
		],
		[
			"settings load errors",
			makeContext(),
			{ settingsManager: settingsCapability({ enabled: true, errors: [new Error("bad json")] }) },
			{ subscription: false, autoCompaction: undefined },
		],
	] as const)("omits unsupported telemetry for %s", (_name, ctx, capabilities, expected) => {
		expect(resolveFooterTelemetry(ctx, capabilities)).toEqual(expected);
	});

	it("omits subscription without a model", () => {
		expect(
			resolveFooterTelemetry(makeContext({ model: undefined }), {
				settingsManager: settingsCapability({ enabled: false }),
			}),
		).toEqual({ subscription: undefined, autoCompaction: false });
	});
});
