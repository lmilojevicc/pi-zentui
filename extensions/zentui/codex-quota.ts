import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ZentuiConfig } from "./config";
import { sanitizeEditorMetadataText } from "./editor-metadata-format";
import { collectFooterFormatReferences, parseFooterFormat } from "./footer-format";

const INTERVAL = 60_000;
const TIMEOUT = 10_000;
const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

export type CodexQuota = {
	fiveHour?: number;
	week?: number;
	lastSuccess?: number;
	stale?: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Durations are seconds, not positions: unexpected windows must not inherit a label. */
export function parseCodexQuota(value: unknown): CodexQuota | undefined {
	const limits = record(record(value)?.rate_limit);
	if (!limits) return undefined;
	const result: CodexQuota = {};
	for (const raw of [limits.primary_window, limits.secondary_window]) {
		const window = record(raw);
		if (!window) continue;
		const used = window.used_percent;
		if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100) continue;
		const key =
			window.limit_window_seconds === 18_000
				? "fiveHour"
				: window.limit_window_seconds === 604_800
					? "week"
					: undefined;
		if (key) result[key] = Math.round(100 - used);
	}
	return result.fiveHour !== undefined || result.week !== undefined ? result : undefined;
}

export function editorWantsCodexQuota(config: ZentuiConfig): boolean {
	const editor = config.components.editor;
	if (!editor.enabled || !editor.codexQuota) return false;
	return (
		editor.style === "minimalist" ||
		editor.style === "accent-rail" ||
		collectFooterFormatReferences(
			parseFooterFormat(sanitizeEditorMetadataText(editor.styles[editor.style].metadataFormat)),
		).has("codex_quota")
	);
}

/** No fallback to private storage or older credential APIs. */
export async function resolveCodexToken(
	registry: ExtensionContext["modelRegistry"],
): Promise<string | undefined> {
	if (typeof registry.getProviderAuth !== "function") return undefined;
	const result = await registry.getProviderAuth("openai-codex");
	return typeof result?.auth.apiKey === "string" && result.auth.apiKey
		? result.auth.apiKey
		: undefined;
}

function accountId(token: string): string | undefined {
	try {
		// Unverified JWT decoding is used only for routing/cache isolation, never authorization.
		const payload = record(
			JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")),
		);
		const id = record(payload?.["https://api.openai.com/auth"])?.chatgpt_account_id;
		return typeof id === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(id) ? id : undefined;
	} catch {
		return undefined;
	}
}

function retryDelay(value: string | null): number {
	if (!value) return INTERVAL;
	const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
	const delay = seconds === undefined ? Date.parse(value) - Date.now() : seconds * 1000;
	return Number.isFinite(delay) ? Math.max(INTERVAL, delay) : INTERVAL;
}

/** One session-scoped poller, with demand rechecked before every refresh and publication. */
export class CodexQuotaCollector {
	private active = false;
	private timer?: ReturnType<typeof setTimeout>;
	private request?: AbortController;
	private generation = 0;
	private identity?: string;
	private value: CodexQuota = {};
	private nextRefresh = 0;

	constructor(
		private readonly getContext: () => ExtensionContext | undefined,
		private readonly changed: () => void,
		private readonly fetchUsage: typeof fetch = fetch,
	) {}

	get(): CodexQuota | undefined {
		if (!this.active) return undefined;
		return {
			...this.value,
			stale:
				this.value.stale ||
				(this.value.lastSuccess !== undefined &&
					Date.now() - this.value.lastSuccess >= 2 * INTERVAL),
		};
	}

	reconcile(): void {
		if (!this.getContext()) {
			this.stop();
			return;
		}
		if (this.active) return;
		this.active = true;
		void this.refresh();
	}

	stop(): void {
		this.active = false;
		this.generation++;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.request?.abort();
		this.request = undefined;
		this.identity = undefined;
		this.value = {};
		this.nextRefresh = 0;
	}

	private async refresh(): Promise<void> {
		const ctx = this.getContext();
		if (!this.active || !ctx) {
			this.stop();
			return;
		}
		if (this.request) return;
		const generation = this.generation;
		const controller = new AbortController();
		this.request = controller;
		const current = () =>
			this.active &&
			generation === this.generation &&
			!controller.signal.aborted &&
			Boolean(this.getContext());
		let delay = INTERVAL;
		let authResolved = false;
		// Pi's auth lookup cannot be canceled. Bound waiting and ignore its late result.
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, TIMEOUT);
		const aborted = new Promise<never>((_, reject) => {
			controller.signal.addEventListener(
				"abort",
				() => reject(new Error("Quota refresh canceled")),
				{ once: true },
			);
		});
		try {
			this.changed(); // Age-based stale state is visible while refreshing after sleep.
			await Promise.race([
				aborted,
				(async () => {
					const token = await resolveCodexToken(ctx.modelRegistry);
					if (!current()) return;
					authResolved = true;
					if (!token) {
						this.identity = undefined;
						this.value = {};
						return;
					}
					const account = accountId(token);
					const identity = account
						? `account:${account}`
						: `token:${createHash("sha256").update(token).digest("hex")}`;
					if (identity !== this.identity) {
						this.identity = identity;
						this.value = {};
						this.changed();
					}
					const response = await this.fetchUsage(ENDPOINT, {
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/json",
							originator: "pi",
							...(account ? { "ChatGPT-Account-Id": account } : {}),
						},
						redirect: "error",
						signal: controller.signal,
					});
					if (!current()) return;
					if (!response.ok) void response.body?.cancel().catch(() => {});
					if (response.status === 401 || response.status === 403) {
						this.identity = undefined;
						this.value = {};
						return;
					}
					if (response.status === 429) delay = retryDelay(response.headers.get("retry-after"));
					if (!response.ok) throw new Error("Quota unavailable");
					const parsed = parseCodexQuota(await response.json());
					if (!current()) return;
					if (!parsed) throw new Error("Invalid quota response");
					this.value = { ...parsed, lastSuccess: Date.now(), stale: false };
				})(),
			]);
		} catch {
			if (generation !== this.generation) return;
			// A deadline is transient, not evidence of invalid or missing authentication.
			if (!authResolved && !timedOut) {
				this.identity = undefined;
				this.value = {};
			} else this.value = { ...this.value, stale: this.value.lastSuccess !== undefined };
		} finally {
			clearTimeout(timeout);
			if (generation === this.generation) {
				this.request = undefined;
				if (!this.getContext()) this.stop();
				else {
					this.changed();
					this.nextRefresh = Date.now() + delay;
					this.schedule();
				}
			}
		}
	}

	private schedule(): void {
		// Check ownership and age every minute even during a longer Retry-After.
		this.timer = setTimeout(
			() => {
				if (!this.getContext()) {
					this.stop();
					return;
				}
				this.changed();
				if (Date.now() >= this.nextRefresh) void this.refresh();
				else this.schedule();
			},
			Math.min(INTERVAL, Math.max(0, this.nextRefresh - Date.now())),
		);
		this.timer.unref?.();
	}
}
