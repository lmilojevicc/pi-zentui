import { type ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CodexQuotaCollector,
	editorWantsCodexQuota,
	parseCodexQuota,
	resolveCodexToken,
} from "../extensions/zentui/codex-quota";
import { codexQuotaText } from "../extensions/zentui/codex-quota-display";
import { mergeConfig } from "../extensions/zentui/config";

const window = (used_percent: unknown, limit_window_seconds: unknown = 18_000) => ({
	used_percent,
	limit_window_seconds,
});
const payload = (
	primary_window: unknown = window(20),
	secondary_window: unknown = window(40, 604_800),
) => ({ rate_limit: { primary_window, secondary_window } });
const token = (account: string, rotation = 1) =>
	`header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account }, rotation })).toString("base64url")}.signature`;
const flush = () => vi.advanceTimersByTimeAsync(0);

it("parses exact durations independently of order, percentages, and partial data", () => {
	expect(parseCodexQuota(payload())).toEqual({ fiveHour: 80, week: 60 });
	expect(parseCodexQuota(payload(window(100, 604_800), window(0)))).toEqual({
		fiveHour: 100,
		week: 0,
	});
	expect(parseCodexQuota(payload(window(25.6), null))).toEqual({ fiveHour: 74 });
	for (const invalid of [null, "", "0", NaN, Infinity, -1, 101, true]) {
		expect(parseCodexQuota(payload(window(invalid), window(50, 604_800)))).toEqual({ week: 50 });
	}
	for (const duration of [null, "18000", 0, -1, 18_001, 86_400, 604_799, NaN, Infinity]) {
		expect(parseCodexQuota(payload(window(0, duration), null))).toBeUndefined();
	}
	for (const invalid of [
		null,
		[],
		{},
		{ rate_limit: null },
		{ rate_limit: [] },
		payload(null, "bad"),
	]) {
		expect(parseCodexQuota(invalid)).toBeUndefined();
	}
});

it("uses parsed template references and requires independent editor consent", () => {
	const config = mergeConfig({});
	expect(editorWantsCodexQuota(config)).toBe(false);
	config.components.editor.codexQuota = true;
	for (const style of [
		"opencode",
		"opencode-copy-friendly",
		"minimalist",
		"accent-rail",
	] as const) {
		config.components.editor.style = style;
		expect(editorWantsCodexQuota(config)).toBe(true);
	}
	config.components.editor.style = "opencode";
	config.components.editor.styles.opencode.metadataFormat = "$codex_quota_other";
	expect(editorWantsCodexQuota(config)).toBe(false);
	config.components.editor.styles.opencode.metadataFormat = `(\${codex_quota})`;
	expect(editorWantsCodexQuota(config)).toBe(true);
	config.components.editor.enabled = false;
	expect(editorWantsCodexQuota(config)).toBe(false);
});

it("uses the installed host's public auth capability with a synthetic runtime", async () => {
	if (typeof ModelRegistry.prototype.getProviderAuth !== "function") {
		expect(await resolveCodexToken(Object.create(ModelRegistry.prototype))).toBeUndefined();
		return;
	}
	const getAuth = vi.fn(async () => ({ auth: { apiKey: "synthetic-host-token" } }));
	const registry = new ModelRegistry({ getAuth } as never);
	expect(await resolveCodexToken(registry)).toBe("synthetic-host-token");
	expect(getAuth).toHaveBeenCalledWith("openai-codex");
});

it("fails open on older hosts without trying legacy/private auth paths", async () => {
	const legacy = vi.fn();
	expect(await resolveCodexToken({ getApiKeyForProvider: legacy } as never)).toBeUndefined();
	expect(legacy).not.toHaveBeenCalled();
});

describe("session-scoped quota collection", () => {
	let enabled: boolean;
	let auth: ReturnType<typeof vi.fn>;
	let http: ReturnType<typeof vi.fn<typeof fetch>>;
	let collector: CodexQuotaCollector;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		enabled = false;
		auth = vi.fn(async () => ({ auth: { apiKey: token("account-a") } }));
		http = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload()));
		collector = new CodexQuotaCollector(
			() =>
				enabled
					? ({ modelRegistry: { getProviderAuth: auth } } as unknown as ExtensionContext)
					: undefined,
			vi.fn(),
			http,
		);
	});
	afterEach(() => {
		collector.stop();
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});
	const start = async () => {
		enabled = true;
		collector.reconcile();
		await flush();
	};

	it("has no auth, requests or timers without demand; coalesces events and polls while idle", async () => {
		collector.reconcile();
		expect(collector.get()).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);
		expect(auth).not.toHaveBeenCalled();
		await start();
		for (let i = 0; i < 50; i++) collector.reconcile();
		expect(http).toHaveBeenCalledOnce();
		expect(auth).toHaveBeenCalledWith("openai-codex");
		expect(http.mock.calls[0]).toEqual([
			"https://chatgpt.com/backend-api/wham/usage",
			{
				headers: {
					Authorization: `Bearer ${token("account-a")}`,
					Accept: "application/json",
					originator: "pi",
					"ChatGPT-Account-Id": "account-a",
				},
				redirect: "error",
				signal: expect.any(AbortSignal),
			},
		]);
		expect(codexQuotaText(collector.get())).toBe("5h 80% | week 60%");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(http).toHaveBeenCalledTimes(2);
		enabled = false;
		collector.reconcile();
		expect(collector.get()).toBeUndefined();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(http).toHaveBeenCalledTimes(2);
	});

	it.each(["network", "invalid", "server", "timeout"])(
		"marks retained values stale on %s, replaces partial data on recovery",
		async (failure) => {
			await start();
			if (failure === "network") http.mockRejectedValueOnce(new Error("offline"));
			if (failure === "invalid") http.mockResolvedValueOnce(Response.json({}));
			if (failure === "server") http.mockResolvedValueOnce(new Response("", { status: 500 }));
			if (failure === "timeout") http.mockImplementationOnce(() => new Promise(() => {}));
			await vi.advanceTimersByTimeAsync(70_000);
			expect(codexQuotaText(collector.get())).toBe("5h 80% | week 60% stale");
			http.mockResolvedValueOnce(Response.json(payload(null, window(100, 604_800))));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(codexQuotaText(collector.get())).toBe("5h -- | week 0%");
		},
	);

	it("shows initial placeholders and clears values on missing/rejected authentication", async () => {
		http.mockRejectedValueOnce(new Error("offline"));
		await start();
		expect(codexQuotaText(collector.get())).toBe("5h -- | week --");
		await vi.advanceTimersByTimeAsync(60_000);
		for (const status of [401, 403]) {
			http.mockResolvedValueOnce(new Response("", { status }));
			await vi.advanceTimersByTimeAsync(60_000);
			expect(codexQuotaText(collector.get())).toBe("5h -- | week --");
			await vi.advanceTimersByTimeAsync(60_000);
		}
		auth.mockResolvedValueOnce(undefined);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexQuotaText(collector.get())).toBe("5h -- | week --");
	});

	it("isolates accounts while preserving same-account token rotation", async () => {
		await start();
		auth.mockResolvedValueOnce({ auth: { apiKey: token("account-a", 2) } });
		http.mockRejectedValueOnce(new Error("offline"));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(collector.get()).toMatchObject({ fiveHour: 80, stale: true });
		auth.mockResolvedValueOnce({ auth: { apiKey: token("account-b") } });
		http.mockRejectedValueOnce(new Error("offline"));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexQuotaText(collector.get())).toBe("5h -- | week --");
	});

	it("invalidates conservatively on opaque credential change", async () => {
		auth.mockResolvedValue({ auth: { apiKey: "opaque-a" } });
		await start();
		expect(http.mock.calls[0]?.[1]?.headers).not.toHaveProperty("ChatGPT-Account-Id");
		auth.mockResolvedValue({ auth: { apiKey: "opaque-b" } });
		http.mockRejectedValueOnce(new Error("offline"));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexQuotaText(collector.get())).toBe("5h -- | week --");
	});

	it.each(["180", new Date(1_000_000 + 240_000).toUTCString()])(
		"honors Retry-After %s without retry storms",
		async (retry) => {
			await start();
			http.mockResolvedValueOnce(
				new Response("", { status: 429, headers: { "Retry-After": retry } }),
			);
			await vi.advanceTimersByTimeAsync(60_000);
			await vi.advanceTimersByTimeAsync(179_999);
			collector.reconcile();
			expect(http).toHaveBeenCalledTimes(2);
			expect(collector.get()?.stale).toBe(true);
			await vi.advanceTimersByTimeAsync(1);
			expect(http).toHaveBeenCalledTimes(3);
		},
	);

	it("ages snapshots on sleep and releases lost demand on the timer", async () => {
		await start();
		vi.setSystemTime(Date.now() + 180_000);
		expect(collector.get()?.stale).toBe(true);
		enabled = false;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(http).toHaveBeenCalledOnce();
		expect(collector.get()).toBeUndefined();
	});

	it("retains stale quota on an auth deadline, ignores late auth, then recovers", async () => {
		await start();
		let resolve!: (value: unknown) => void;
		auth.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		await vi.advanceTimersByTimeAsync(70_000);
		expect(codexQuotaText(collector.get())).toBe("5h 80% | week 60% stale");
		expect(http).toHaveBeenCalledOnce();
		resolve({ auth: { apiKey: token("late-account") } });
		await flush();
		expect(http).toHaveBeenCalledOnce();
		expect(codexQuotaText(collector.get())).toBe("5h 80% | week 60% stale");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexQuotaText(collector.get())).toBe("5h 80% | week 60%");
		auth.mockRejectedValueOnce(new Error("invalid authentication"));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(codexQuotaText(collector.get())).toBe("5h -- | week --");
	});

	it("bounds slow auth and ignores late auth after stop/re-enable", async () => {
		let resolve!: (value: unknown) => void;
		auth.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		await start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(http).not.toHaveBeenCalled();
		collector.stop();
		await start();
		resolve({ auth: { apiKey: token("old-account") } });
		await flush();
		expect(http).toHaveBeenCalledOnce();
		expect(collector.get()?.fiveHour).toBe(80);
	});

	it("aborts and ignores late HTTP results from an earlier generation", async () => {
		let resolve!: (value: Response) => void;
		http.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		await start();
		const signal = http.mock.calls[0]?.[1]?.signal;
		collector.stop();
		expect(signal?.aborted).toBe(true);
		await start();
		resolve(Response.json(payload(window(99))));
		await flush();
		expect(collector.get()?.fiveHour).toBe(80);
	});
});
