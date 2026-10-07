import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { HostTemplateValues } from "./host-template-values";

export type OmpLookupContext = {
	session: object;
	sessionId: string;
	cwd: string;
	provider?: string;
	modelId?: string;
};

const QUOTA_CACHE_MS = 5 * 60_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const IDENTITY_FIELDS = ["accountId", "email", "projectId", "orgId"] as const;
const REPORT_IDENTITY_FIELDS = [
	"accountId",
	"account_id",
	"email",
	"projectId",
	"project_id",
	"orgId",
] as const;
const AMOUNT_FIELDS = ["used", "limit", "remaining", "usedFraction", "remainingFraction"] as const;
const USAGE_UNITS: Readonly<Record<string, true>> = {
	percent: true,
	tokens: true,
	requests: true,
	credits: true,
	usd: true,
	minutes: true,
	bytes: true,
	unknown: true,
};

type RecordValue = Record<string, unknown>;
type AccountIdentity = {
	accountId?: string;
	email?: string;
	projectId?: string;
	orgId?: string;
};
type Snapshot<T> = {
	context: OmpLookupContext;
	controller: AbortController;
	pending: boolean;
	expiresAt: number;
	value?: T;
};
type QuotaSnapshot = Snapshot<string> & { identity: string };

function record(value: unknown): RecordValue | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: undefined;
}

function text(value: unknown): string | undefined {
	if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return undefined;
	return value.trim() || undefined;
}

function normalized(value: unknown): string | undefined {
	return text(value)?.toLowerCase();
}

function activeIdentity(context: OmpLookupContext): AccountIdentity | undefined {
	try {
		// Declared public, read-only routing: AgentSession -> ModelRegistry -> AuthStorage.oauth.
		const registry = record(record(context.session)?.modelRegistry);
		const storage = record(registry?.authStorage);
		const oauth = record(storage?.oauth);
		if (!oauth || typeof oauth.identity !== "function" || !context.provider) return undefined;
		const identity = record(oauth.identity.call(oauth, context.provider, context.sessionId));
		if (!identity) return undefined;
		for (const key of IDENTITY_FIELDS)
			if (identity[key] !== undefined && normalized(identity[key]) === undefined) return undefined;
		return {
			accountId: normalized(identity.accountId),
			email: normalized(identity.email),
			projectId: normalized(identity.projectId),
			orgId: normalized(identity.orgId),
		};
	} catch {
		return undefined;
	}
}

function identityKey(identity: AccountIdentity | undefined): string {
	return JSON.stringify([
		identity?.accountId ?? null,
		identity?.email ?? null,
		identity?.projectId ?? null,
		identity?.orgId ?? null,
	]);
}

/** Mirrors the native account matcher, but rejects conflicting scope evidence and ambiguous siblings. */
function matchingAccount(
	metadata: RecordValue,
	scope: RecordValue,
	identity: AccountIdentity,
): AccountIdentity | undefined {
	for (const key of REPORT_IDENTITY_FIELDS)
		if (metadata[key] !== undefined && normalized(metadata[key]) === undefined) return undefined;
	for (const key of IDENTITY_FIELDS)
		if (scope[key] !== undefined && normalized(scope[key]) === undefined) return undefined;
	const metadataAccount = normalized(metadata.accountId) ?? normalized(metadata.account_id);
	const scopeAccount = normalized(scope.accountId);
	const metadataProject = normalized(metadata.projectId) ?? normalized(metadata.project_id);
	const scopeProject = normalized(scope.projectId);
	const metadataOrg = normalized(metadata.orgId);
	const scopeOrg = normalized(scope.orgId);
	if (
		(metadataAccount && scopeAccount && metadataAccount !== scopeAccount) ||
		(metadataProject && scopeProject && metadataProject !== scopeProject) ||
		(metadataOrg && scopeOrg && metadataOrg !== scopeOrg)
	)
		return undefined;
	const account: AccountIdentity = {
		accountId: metadataAccount ?? scopeAccount,
		email: normalized(metadata.email),
		projectId: metadataProject ?? scopeProject,
		orgId: metadataOrg ?? scopeOrg,
	};
	// Project/org are routing qualifiers, not a replacement for a different user's identity.
	if (
		(identity.orgId && account.orgId && identity.orgId !== account.orgId) ||
		(identity.projectId && account.projectId && identity.projectId !== account.projectId)
	)
		return undefined;
	if (
		(identity.accountId && account.accountId && identity.accountId !== account.accountId) ||
		(identity.email && account.email && identity.email !== account.email)
	)
		return undefined;
	if (
		(identity.accountId && identity.accountId === account.accountId) ||
		(identity.email && identity.email === account.email) ||
		(identity.projectId && identity.projectId === account.projectId) ||
		(identity.orgId && !identity.accountId && !identity.email && !identity.projectId)
	)
		return account;
	return undefined;
}

function amountText(value: unknown): string | undefined {
	const amount = record(value);
	if (!amount) return undefined;
	if (typeof amount.unit !== "string" || USAGE_UNITS[amount.unit] !== true) return undefined;
	for (const key of AMOUNT_FIELDS) {
		const number = amount[key];
		if (
			number !== undefined &&
			(typeof number !== "number" || !Number.isFinite(number) || number < 0)
		)
			return undefined;
	}
	const { used, limit, remaining, usedFraction, remainingFraction } = amount as {
		used?: number;
		limit?: number;
		remaining?: number;
		usedFraction?: number;
		remainingFraction?: number;
	};
	if (
		(remainingFraction !== undefined && remainingFraction > 1) ||
		(limit !== undefined && limit <= 0) ||
		(limit !== undefined && remaining !== undefined && remaining > limit) ||
		(amount.unit === "percent" && remaining !== undefined && remaining > 100)
	)
		return undefined;
	let left: number | undefined;
	if (usedFraction !== undefined) left = Math.max(0, 1 - usedFraction);
	else if (remainingFraction !== undefined) left = remainingFraction;
	else if (limit !== undefined && used !== undefined) left = Math.max(0, 1 - used / limit);
	else if (limit !== undefined && remaining !== undefined) left = remaining / limit;
	else if (amount.unit === "percent" && used !== undefined) left = Math.max(0, 1 - used / 100);
	else if (amount.unit === "percent" && remaining !== undefined) left = remaining / 100;
	if (left !== undefined) return `${Number((left * 100).toFixed(1))}% left`;
	if (remaining !== undefined && amount.unit !== "unknown")
		return `${remaining} ${amount.unit} left`;
	return undefined;
}

function quotaValue(
	reports: unknown,
	context: OmpLookupContext,
	identity: AccountIdentity | undefined,
	now: number,
): { value?: string; expiresAt: number } {
	const expiresAt = now + QUOTA_CACHE_MS;
	if (!identity || !Array.isArray(reports)) return { expiresAt };
	const candidates: { label: string; amount: string; resetsAt?: number }[] = [];
	const accounts = new Set<string>();
	for (const value of reports) {
		const report = record(value);
		if (
			!report ||
			report.provider !== context.provider ||
			typeof report.fetchedAt !== "number" ||
			!Number.isFinite(report.fetchedAt) ||
			report.fetchedAt <= 0 ||
			report.fetchedAt > now ||
			!Array.isArray(report.limits)
		)
			continue;
		const metadata = record(report.metadata) ?? {};
		for (const value of report.limits) {
			const limit = record(value);
			const scope = record(limit?.scope);
			if (!limit || !scope || scope.provider !== context.provider) continue;
			if (scope.modelId !== undefined && scope.modelId !== context.modelId) continue;
			const account = matchingAccount(metadata, scope, identity);
			if (!account) continue;
			accounts.add(
				JSON.stringify([
					account.accountId ? ["account", account.accountId] : ["email", account.email ?? null],
					account.projectId ?? null,
					account.orgId ?? null,
				]),
			);
			const label = text(limit.label) ?? text(limit.id);
			const amount = amountText(limit.amount);
			if (!label || !amount) continue;
			const window = record(limit.window);
			if (limit.window !== undefined && !window) continue;
			const resetsAt = window?.resetsAt;
			if (
				resetsAt !== undefined &&
				(typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= now)
			)
				continue;
			const windowLabel = text(window?.label) ?? text(window?.id) ?? text(scope.windowId);
			candidates.push({
				label: windowLabel && windowLabel !== label ? `${label} (${windowLabel})` : label,
				amount,
				resetsAt: resetsAt as number | undefined,
			});
		}
	}
	// An email-only identity must not claim two account/project/organization siblings.
	if (accounts.size !== 1) return { expiresAt };
	const rendered = new Set<string>();
	let validUntil = expiresAt;
	for (const candidate of candidates) {
		rendered.add(`${candidate.label}: ${candidate.amount}`);
		if (candidate.resetsAt !== undefined) validUntil = Math.min(validUntil, candidate.resetsAt);
	}
	return { value: [...rendered].join(" | ") || undefined, expiresAt: validUntil };
}

/** Demand-driven public OMP lookups. No timers, private state, or direct credential handling. */
export class OmpTemplateLookups {
	private context: OmpLookupContext | undefined;
	private quota: QuotaSnapshot | undefined;
	private disposed = false;

	constructor(
		_exec: ExtensionAPI["exec"],
		private readonly requestRender: () => void,
	) {}

	read(context: OmpLookupContext, names: ReadonlySet<string>): HostTemplateValues {
		if (this.disposed) return {};
		if (
			!this.context ||
			this.context.session !== context.session ||
			this.context.sessionId !== context.sessionId ||
			this.context.cwd !== context.cwd ||
			this.context.provider !== context.provider ||
			this.context.modelId !== context.modelId
		) {
			this.quota?.controller.abort();
			this.quota = undefined;
			this.context = { ...context };
		}
		const values: { usage_quota?: string } = {};
		const now = Date.now();
		if (names.has("usage_quota") && context.provider && context.modelId) {
			const identity = activeIdentity(context);
			const key = identityKey(identity);
			if (this.quota && this.quota.identity !== key) {
				this.quota.controller.abort();
				this.quota = undefined;
			}
			if (!this.quota || (!this.quota.pending && now >= this.quota.expiresAt)) {
				this.quota = {
					context: { ...context },
					controller: new AbortController(),
					pending: true,
					expiresAt: 0,
					identity: key,
				};
				void this.loadQuota(this.quota, identity);
			}
			if (this.quota.value && now < this.quota.expiresAt) values.usage_quota = this.quota.value;
		}
		return values;
	}

	dispose(): void {
		this.disposed = true;
		this.quota?.controller.abort();
		this.quota = undefined;
		this.context = undefined;
	}

	private repaint(): void {
		try {
			this.requestRender();
		} catch {
			// A disposed or unavailable render surface must not reject a completed lookup.
		}
	}

	private async loadQuota(
		snapshot: QuotaSnapshot,
		identity: AccountIdentity | undefined,
	): Promise<void> {
		let result: { value?: string; expiresAt: number } = { expiresAt: Date.now() + QUOTA_CACHE_MS };
		try {
			const fetch = record(snapshot.context.session)?.fetchUsageReports;
			if (typeof fetch === "function") {
				// Explicit $usage_quota demand opts into OMP's authenticated public report refresh.
				const reports: unknown = await fetch.call(
					snapshot.context.session,
					snapshot.controller.signal,
				);
				result = quotaValue(reports, snapshot.context, identity, Date.now());
			}
		} catch {
			result = { expiresAt: Date.now() + QUOTA_CACHE_MS };
		}
		if (this.disposed || this.quota !== snapshot || snapshot.controller.signal.aborted) return;
		if (identityKey(activeIdentity(snapshot.context)) !== snapshot.identity) {
			this.quota = undefined;
			return;
		}
		snapshot.value = result.value;
		snapshot.pending = false;
		snapshot.expiresAt = result.expiresAt;
		this.repaint();
	}
}
