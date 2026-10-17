import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	CodexHeaderQuota,
	hasOfficialOpenAiRoute,
	parseCodexQuotaHeaders,
} from "../extensions/zentui/codex-quota-headers";

const headers = (overrides: Record<string, string> = {}) => ({
	"x-codex-primary-used-percent": "20",
	"x-codex-primary-window-minutes": "300",
	"x-codex-secondary-used-percent": "40.4",
	"x-codex-secondary-window-minutes": "10080",
	...overrides,
});

describe("parseCodexQuotaHeaders", () => {
	it("maps windows by duration, rounding remaining percentages", () => {
		expect(parseCodexQuotaHeaders(headers())?.quota).toEqual({ fiveHour: 80, week: 60 });
		expect(
			parseCodexQuotaHeaders(
				headers({
					"x-codex-primary-window-minutes": "10080",
					"x-codex-secondary-window-minutes": "300",
				}),
			)?.quota,
		).toEqual({ fiveHour: 60, week: 80 });
	});

	it("matches header names case-insensitively", () => {
		expect(
			parseCodexQuotaHeaders({
				"X-Codex-Primary-Used-Percent": "100",
				"X-CODEX-PRIMARY-WINDOW-MINUTES": "300",
			})?.quota,
		).toEqual({ fiveHour: 0 });
	});

	it("accepts partial families and ignores a window without a recognized duration", () => {
		expect(
			parseCodexQuotaHeaders({
				"x-codex-secondary-used-percent": "10",
				"x-codex-secondary-window-minutes": "10080",
			})?.quota,
		).toEqual({ week: 90 });
		for (const minutes of [undefined, "", "60", "300.0", "-300", "abc"]) {
			expect(
				parseCodexQuotaHeaders({
					"x-codex-primary-used-percent": "10",
					...(minutes === undefined ? {} : { "x-codex-primary-window-minutes": minutes }),
				}),
			).toBeUndefined();
		}
	});

	it("ignores malformed or out-of-range values without affecting the other window", () => {
		for (const used of ["", "abc", "NaN", "Infinity", "-1", "100.1", "101", "1e2", " ", "0x10"]) {
			expect(
				parseCodexQuotaHeaders(headers({ "x-codex-primary-used-percent": used }))?.quota,
			).toEqual({ week: 60 });
		}
		for (const invalid of [undefined, null, "headers", 3, [], {}, { "x-other": "1" }])
			expect(parseCodexQuotaHeaders(invalid)).toBeUndefined();
	});

	it("reports the earliest valid reset time in milliseconds", () => {
		expect(
			parseCodexQuotaHeaders(
				headers({
					"x-codex-primary-reset-at": "2000",
					"x-codex-secondary-reset-at": "1000",
				}),
			)?.resetAt,
		).toBe(1_000_000);
		expect(
			parseCodexQuotaHeaders(headers({ "x-codex-primary-reset-at": "soon" }))?.resetAt,
		).toBeUndefined();
	});
});

const model = (overrides: object = {}) => ({
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	...overrides,
});
const registry = (
	provider: object | undefined = { id: "openai", baseUrl: "https://api.openai.com/v1" },
) => ({ getProvider: () => provider }) as unknown as ExtensionContext["modelRegistry"];
const asModel = (value: object | undefined) => value as ExtensionContext["model"];

describe("hasOfficialOpenAiRoute", () => {
	it("accepts only the official provider on the official base URL", () => {
		expect(hasOfficialOpenAiRoute(registry(), asModel(model()))).toBe(true);
		expect(
			hasOfficialOpenAiRoute(registry(), asModel(model({ baseUrl: "https://api.openai.com/v1/" }))),
		).toBe(true);
		for (const rejected of [
			model({ provider: "openai-codex" }),
			model({ provider: "azure-openai-responses" }),
			model({ baseUrl: "https://proxy.example/v1" }),
			model({ baseUrl: "https://api.openai.com.evil.example/v1" }),
			model({ baseUrl: "https://user:pw@api.openai.com/v1" }),
			model({ baseUrl: "https://api.openai.com/v1?x=1" }),
			model({ baseUrl: "https://api.openai.com/v2" }),
			model({ baseUrl: "http://api.openai.com/v1" }),
			model({ baseUrl: undefined }),
			undefined,
		])
			expect(hasOfficialOpenAiRoute(registry(), asModel(rejected))).toBe(false);
	});

	it("rejects provider overrides and registries without public routing metadata", () => {
		expect(
			hasOfficialOpenAiRoute(
				registry({ id: "openai", baseUrl: "https://proxy.example/v1" }),
				asModel(model()),
			),
		).toBe(false);
		expect(
			hasOfficialOpenAiRoute(
				{ getProvider: () => undefined } as unknown as ExtensionContext["modelRegistry"],
				asModel(model()),
			),
		).toBe(false);
		expect(hasOfficialOpenAiRoute({} as ExtensionContext["modelRegistry"], asModel(model()))).toBe(
			false,
		);
		expect(
			hasOfficialOpenAiRoute(
				{
					getProvider: () => {
						throw new Error("boom");
					},
				} as unknown as ExtensionContext["modelRegistry"],
				asModel(model()),
			),
		).toBe(false);
	});
});

describe("CodexHeaderQuota", () => {
	let active: object | undefined;
	let changed: Mock<() => void>;
	let store: CodexHeaderQuota;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000_000);
		active = model();
		changed = vi.fn<() => void>();
		store = new CodexHeaderQuota(
			() => ({ model: active, modelRegistry: registry() }) as unknown as ExtensionContext,
			changed,
		);
	});
	afterEach(() => vi.useRealTimers());

	it("shows nothing until eligible headers arrive", () => {
		expect(store.get()).toBeUndefined();
		store.record({ "content-type": "text/event-stream" });
		expect(store.get()).toBeUndefined();
		expect(changed).not.toHaveBeenCalled();
	});

	it("publishes eligible headers and replaces the snapshot completely", () => {
		store.record(headers());
		expect(store.get()).toEqual({
			fiveHour: 80,
			week: 60,
			lastSuccess: 1_000_000_000,
			stale: false,
		});
		expect(changed).toHaveBeenCalledOnce();
		store.record({
			"x-codex-primary-used-percent": "90",
			"x-codex-primary-window-minutes": "300",
		});
		expect(store.get()).toMatchObject({ fiveHour: 10 });
		expect(store.get()?.week).toBeUndefined();
		store.record({ "x-codex-primary-used-percent": "bad" });
		expect(store.get()).toMatchObject({ fiveHour: 10 });
	});

	it("ignores headers for other providers, proxies, and missing models", () => {
		for (const other of [
			model({ provider: "anthropic" }),
			model({ provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api" }),
			model({ baseUrl: "https://proxy.example/v1" }),
			undefined,
		]) {
			active = other;
			store.record(headers());
			expect(store.get()).toBeUndefined();
		}
		expect(changed).not.toHaveBeenCalled();
	});

	it("clears when the active route becomes ineligible and stays cleared on return", () => {
		store.record(headers());
		active = model({ provider: "anthropic" });
		store.reconcile();
		active = model();
		expect(store.get()).toBeUndefined();
	});

	it("marks values stale by age or an elapsed reset, never fabricating replacements", () => {
		store.record(headers());
		vi.advanceTimersByTime(30 * 60_000 - 1);
		expect(store.get()?.stale).toBe(false);
		vi.advanceTimersByTime(1);
		expect(store.get()).toMatchObject({ fiveHour: 80, week: 60, stale: true });
		vi.setSystemTime(1_000_000_000);
		store.record(headers({ "x-codex-primary-reset-at": "1000001" }));
		expect(store.get()?.stale).toBe(false);
		vi.advanceTimersByTime(1000);
		expect(store.get()?.stale).toBe(true);
	});
});
