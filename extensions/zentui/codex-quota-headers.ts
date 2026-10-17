import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexQuota } from "./codex-quota";

const OFFICIAL_OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Headers only arrive with responses, so idle sessions get a far longer horizon than polling. */
const HEADER_STALE_AFTER = 30 * 60_000;
const FIVE_HOUR_WINDOW_MINUTES = 300;
const WEEK_WINDOW_MINUTES = 10_080;

type HeaderQuota = { quota: CodexQuota; resetAt?: number };

function isOfficialOpenAiUrl(value: unknown): boolean {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return (
			url.origin === "https://api.openai.com" &&
			url.pathname.replace(/\/+$/, "") === "/v1" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}

/** Headers are trusted only when both the model and provider route to OpenAI's own API. */
export function hasOfficialOpenAiRoute(
	registry: ExtensionContext["modelRegistry"],
	model: ExtensionContext["model"],
): boolean {
	try {
		if (
			model?.provider !== "openai" ||
			!isOfficialOpenAiUrl(model.baseUrl) ||
			typeof registry.getProvider !== "function"
		)
			return false;
		const provider = registry.getProvider("openai");
		return provider?.id === "openai" && isOfficialOpenAiUrl(provider.baseUrl);
	} catch {
		return false;
	}
}

function number(value: string | undefined, integer: boolean): number | undefined {
	if (value === undefined || !(integer ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(value.trim()))
		return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parses the `x-codex-{primary,secondary}-*` family emitted by Codex-enabled OpenAI responses.
 * Like the polled endpoint, windows are labeled by duration rather than position.
 */
export function parseCodexQuotaHeaders(headers: unknown): HeaderQuota | undefined {
	if (headers === null || typeof headers !== "object" || Array.isArray(headers)) return undefined;
	const lower = new Map<string, string>();
	for (const [name, value] of Object.entries(headers))
		if (typeof value === "string") lower.set(name.toLowerCase(), value);
	const quota: CodexQuota = {};
	let resetAt: number | undefined;
	for (const window of ["primary", "secondary"]) {
		const used = number(lower.get(`x-codex-${window}-used-percent`), false);
		if (used === undefined || used > 100) continue;
		const minutes = number(lower.get(`x-codex-${window}-window-minutes`), true);
		const key =
			minutes === FIVE_HOUR_WINDOW_MINUTES
				? "fiveHour"
				: minutes === WEEK_WINDOW_MINUTES
					? "week"
					: undefined;
		if (!key) continue;
		quota[key] = Math.round(100 - used);
		const reset = number(lower.get(`x-codex-${window}-reset-at`), true);
		if (reset !== undefined && Number.isSafeInteger(reset))
			resetAt = resetAt === undefined ? reset * 1000 : Math.min(resetAt, reset * 1000);
	}
	return quota.fiveHour !== undefined || quota.week !== undefined ? { quota, resetAt } : undefined;
}

/**
 * Passive quota for the official `openai` provider. It never reads credentials or makes requests;
 * values exist only after a matching provider response and vanish with the eligible route.
 */
export class CodexHeaderQuota {
	private value?: HeaderQuota & { receivedAt: number };

	constructor(
		private readonly getContext: () => ExtensionContext | undefined,
		private readonly changed: () => void,
	) {}

	private eligible(): boolean {
		const ctx = this.getContext();
		return Boolean(ctx && hasOfficialOpenAiRoute(ctx.modelRegistry, ctx.model));
	}

	record(headers: unknown): void {
		if (!this.eligible()) {
			this.clear();
			return;
		}
		const parsed = parseCodexQuotaHeaders(headers);
		if (!parsed) return;
		this.value = { ...parsed, receivedAt: Date.now() };
		this.changed();
	}

	/** Drops values the moment the active route stops being eligible. */
	reconcile(): void {
		if (!this.eligible()) this.clear();
	}

	get(): CodexQuota | undefined {
		this.reconcile();
		if (!this.value) return undefined;
		const now = Date.now();
		return {
			...this.value.quota,
			lastSuccess: this.value.receivedAt,
			stale:
				now - this.value.receivedAt >= HEADER_STALE_AFTER ||
				(this.value.resetAt !== undefined && now >= this.value.resetAt),
		};
	}

	clear(): void {
		this.value = undefined;
	}
}
