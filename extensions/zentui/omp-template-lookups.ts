import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { HostTemplateValues } from "./host-template-values";

export type OmpLookupContext = {
	session: object;
	sessionId: string;
	cwd: string;
	provider?: string;
	modelId?: string;
};

const PR_CACHE_MS = 30_000;
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
type PullRequest = { number: string; url: string };
type QuotaSnapshot = Snapshot<string> & { identity: string };
type RepoIdentity = { root: string; gitDir: string; branch: string; remotes: string };

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

function httpsUrl(value: unknown): URL | undefined {
	if (
		typeof value !== "string" ||
		value !== value.trim() ||
		CONTROL_CHARACTERS.test(value) ||
		!/^https:\/\//i.test(value) ||
		/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
	)
		return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname && !url.username && !url.password
			? url
			: undefined;
	} catch {
		return undefined;
	}
}

function repositoryMatchesRemote(repoUrl: URL, remotes: string): boolean {
	const repositoryPath = repoUrl.pathname.replace(/\/$/, "").toLowerCase();
	for (const line of remotes.split("\n")) {
		const remote = /^\S+\s+(\S+)\s+\(fetch\)$/.exec(line)?.[1];
		if (!remote || CONTROL_CHARACTERS.test(remote)) continue;
		let hostname: string;
		let path: string;
		const ssh = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(remote);
		if (ssh && !remote.includes("://")) {
			hostname = ssh[1].toLowerCase();
			path = `/${ssh[2]}`;
		} else {
			try {
				const url = new URL(remote);
				if (!["https:", "http:", "ssh:"].includes(url.protocol)) continue;
				hostname = url.hostname;
				path = url.pathname;
				if (url.protocol !== "ssh:" && url.port !== repoUrl.port) continue;
			} catch {
				continue;
			}
		}
		if (
			hostname === repoUrl.hostname &&
			path
				.replace(/\/$/, "")
				.replace(/\.git$/, "")
				.toLowerCase() === repositoryPath
		)
			return true;
	}
	return false;
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
	private pr: Snapshot<PullRequest> | undefined;
	private quota: QuotaSnapshot | undefined;
	private disposed = false;

	constructor(
		private readonly exec: ExtensionAPI["exec"],
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
			this.pr?.controller.abort();
			this.quota?.controller.abort();
			this.pr = undefined;
			this.quota = undefined;
			this.context = { ...context };
		}
		const values: { pr_number?: string; pr_url?: string; usage_quota?: string } = {};
		const now = Date.now();
		if (names.has("pr_number") || names.has("pr_url")) {
			if (!this.pr || (!this.pr.pending && now >= this.pr.expiresAt)) {
				this.pr = {
					context: { ...context },
					controller: new AbortController(),
					pending: true,
					expiresAt: 0,
				};
				void this.loadPullRequest(this.pr);
			}
			if (this.pr.value && now < this.pr.expiresAt) {
				if (names.has("pr_number")) values.pr_number = this.pr.value.number;
				if (names.has("pr_url")) values.pr_url = this.pr.value.url;
			}
		}
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

	invalidateProject(cwd?: string): void {
		if (this.disposed || (cwd !== undefined && this.pr?.context.cwd !== cwd)) return;
		const hadValue = this.pr?.value !== undefined;
		this.pr?.controller.abort();
		this.pr = undefined;
		if (hadValue) this.repaint();
	}

	dispose(): void {
		this.disposed = true;
		this.pr?.controller.abort();
		this.quota?.controller.abort();
		this.pr = undefined;
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

	private async command(
		command: string,
		args: string[],
		snapshot: Snapshot<unknown>,
	): Promise<string | undefined> {
		if (snapshot.controller.signal.aborted) return undefined;
		const result = await this.exec(command, args, {
			cwd: snapshot.context.cwd,
			timeout: command === "git" ? 2_000 : 10_000,
			signal: snapshot.controller.signal,
		});
		return !snapshot.controller.signal.aborted &&
			result.code === 0 &&
			!result.killed &&
			typeof result.stdout === "string"
			? result.stdout
			: undefined;
	}

	private async repository(snapshot: Snapshot<unknown>): Promise<RepoIdentity | undefined> {
		const paths = await this.command(
			"git",
			["rev-parse", "--show-toplevel", "--absolute-git-dir"],
			snapshot,
		);
		if (paths === undefined) return undefined;
		const roots = paths.trim().split("\n");
		if (roots.length !== 2 || !text(roots[0]) || !text(roots[1])) return undefined;
		const branchOutput = await this.command(
			"git",
			["symbolic-ref", "--quiet", "--short", "HEAD"],
			snapshot,
		);
		const branch = text(branchOutput?.trim());
		if (!branch || branch.startsWith("-")) return undefined;
		const remotes = await this.command("git", ["remote", "-v"], snapshot);
		if (!remotes?.trim()) return undefined;
		return { root: roots[0], gitDir: roots[1], branch, remotes };
	}

	private async loadPullRequest(snapshot: Snapshot<PullRequest>): Promise<void> {
		let value: PullRequest | undefined;
		try {
			const before = await this.repository(snapshot);
			if (before) {
				const repoOutput = await this.command(
					"gh",
					["repo", "view", "--json", "nameWithOwner,defaultBranchRef,url"],
					snapshot,
				);
				const repo = repoOutput === undefined ? undefined : record(JSON.parse(repoOutput));
				const repoName = text(repo?.nameWithOwner);
				const defaultBranch = text(record(repo?.defaultBranchRef)?.name);
				const repoUrl = httpsUrl(repo?.url);
				if (
					repoName &&
					/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoName) &&
					!repoName.startsWith("-") &&
					defaultBranch &&
					repoUrl &&
					repoUrl.pathname.replace(/\/$/, "") === `/${repoName}` &&
					before.branch !== defaultBranch &&
					repositoryMatchesRemote(repoUrl, before.remotes)
				) {
					// Freeze both selectors: a branch/repository change cannot redirect gh mid-request.
					const output = await this.command(
						"gh",
						["pr", "view", before.branch, "--repo", repoName, "--json", "number,url"],
						snapshot,
					);
					const pr = output === undefined ? undefined : record(JSON.parse(output));
					const url = httpsUrl(pr?.url);
					if (
						pr &&
						typeof pr.number === "number" &&
						Number.isSafeInteger(pr.number) &&
						pr.number > 0 &&
						url &&
						url.origin === repoUrl.origin &&
						url.pathname === `${repoUrl.pathname.replace(/\/$/, "")}/pull/${pr.number}` &&
						!url.search &&
						!url.hash
					) {
						const after = await this.repository(snapshot);
						if (
							after &&
							before.root === after.root &&
							before.gitDir === after.gitDir &&
							before.branch === after.branch &&
							before.remotes === after.remotes
						)
							value = { number: String(pr.number), url: url.href };
					}
				}
			}
		} catch {
			// Missing git/gh, no PR, and malformed output are negative cached results.
		}
		if (this.disposed || this.pr !== snapshot || snapshot.controller.signal.aborted) return;
		snapshot.value = value;
		snapshot.pending = false;
		snapshot.expiresAt = Date.now() + PR_CACHE_MS;
		this.repaint();
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
