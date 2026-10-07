import { isAbsolute } from "node:path";

export type GithubExec = (
	command: string,
	args: string[],
	options: { cwd: string; timeout: number; signal: AbortSignal },
) => Promise<{ code: number; killed?: boolean; stdout: string; stderr?: string }>;
export type GithubContext = Readonly<{ cwd: string; scopeKey: string }>;
export type GithubIdentity = Readonly<{
	root: string;
	gitDir: string;
	branch: string;
	remotes: string;
	headOid: string;
}>;
export type CiState = "unknown" | "no-checks" | "running" | "failed" | "passing" | "stale";
export type GithubSnapshot = Readonly<{
	context: GithubContext;
	identity?: GithubIdentity;
	pr?: Readonly<{ number: string; url: string; headOid: string }>;
	ci: CiState;
	fetchedAt?: number;
	expiresAt?: number;
	pending: boolean;
}>;

type PullRequest = NonNullable<GithubSnapshot["pr"]>;
type Result = { pr?: PullRequest; ci: CiState };
type ApiCache = Result & { key: string; fetchedAt: number; expiresAt: number };
type Repository = { name: string; url: URL; defaultBranch: string };
type Job = { context: GithubContext; controller: AbortController; promise: Promise<void> };

const CACHE_MS = 30_000;
const REPO_CACHE_MS = 5 * 60_000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_CHECKS = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const FAILURE = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]);
const RUNNING = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "REQUESTED", "WAITING", "EXPECTED"]);

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && !CONTROL_CHARACTERS.test(value)
		? value.trim() || undefined
		: undefined;
}

function oid(value: unknown): string | undefined {
	return typeof value === "string" && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)
		? value.toLowerCase()
		: undefined;
}

function httpsUrl(value: unknown): URL | undefined {
	if (
		typeof value !== "string" ||
		value !== value.trim() ||
		CONTROL_CHARACTERS.test(value) ||
		value.includes("\\") ||
		!/^https:\/\//i.test(value) ||
		/%(?:0[0-9a-f]|1[0-9a-f]|7f|8[0-9a-f]|9[0-9a-f])/i.test(value)
	)
		return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" &&
			url.hostname &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			!value.includes("?") &&
			!value.includes("#")
			? url
			: undefined;
	} catch {
		return undefined;
	}
}

// Keep OMP's fetch-only HTTP(S)/SSH matching, including its HTTP(S) port safeguard.
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

function repository(output: string | undefined, identity: GithubIdentity): Repository | undefined {
	if (output === undefined) return undefined;
	const repo = record(JSON.parse(output));
	const name = text(repo?.nameWithOwner);
	const defaultBranch = text(record(repo?.defaultBranchRef)?.name);
	const url = httpsUrl(repo?.url);
	if (
		!name ||
		!/^\w[\w.-]*\/\w[\w.-]*$/.test(name) ||
		!defaultBranch ||
		!url ||
		url.pathname.replace(/\/$/, "") !== `/${name}` ||
		!repositoryMatchesRemote(url, identity.remotes)
	)
		return undefined;
	return { name, defaultBranch, url };
}

function checkState(value: unknown): CiState {
	const check = record(value);
	if (!check) return "unknown";
	const kind = check.__typename;
	if (kind !== undefined && kind !== "CheckRun" && kind !== "StatusContext") return "unknown";
	if (kind === "StatusContext" || (kind === undefined && "state" in check)) {
		if ("status" in check || "conclusion" in check) return "unknown";
		const state = text(check.state)?.toUpperCase();
		if (state && FAILURE.has(state)) return "failed";
		if (state && RUNNING.has(state)) return "running";
		return state === "SUCCESS" ? "passing" : "unknown";
	}
	if ("state" in check) return "unknown";
	const status = text(check.status)?.toUpperCase();
	const conclusion = text(check.conclusion)?.toUpperCase();
	if (conclusion && FAILURE.has(conclusion)) return "failed";
	if (status && RUNNING.has(status)) return "running";
	if (status !== "COMPLETED") return "unknown";
	if (conclusion === "SUCCESS") return "passing";
	return conclusion === "SKIPPED" || conclusion === "NEUTRAL" ? "no-checks" : "unknown";
}

function aggregateChecks(value: unknown): CiState {
	if (!Array.isArray(value) || value.length > MAX_CHECKS) return "unknown";
	let passing = false;
	let running = false;
	let unknown = false;
	let failed = false;
	for (const check of value) {
		const state = checkState(check);
		passing ||= state === "passing";
		running ||= state === "running";
		unknown ||= state === "unknown";
		failed ||= state === "failed";
	}
	if (failed) return "failed";
	if (running) return "running";
	if (unknown) return "unknown";
	return passing ? "passing" : "no-checks";
}

function pullRequest(output: string | undefined, repo: Repository, headOid: string): Result {
	const empty: Result = { ci: "unknown" };
	if (output === undefined) return empty;
	const pr = record(JSON.parse(output));
	const url = httpsUrl(pr?.url);
	const head = oid(pr?.headRefOid);
	if (
		pr?.state !== "OPEN" ||
		typeof pr.number !== "number" ||
		!Number.isSafeInteger(pr.number) ||
		pr.number <= 0 ||
		!head ||
		!url ||
		url.origin !== repo.url.origin ||
		url.pathname !== `${repo.url.pathname.replace(/\/$/, "")}/pull/${pr.number}`
	)
		return empty;
	return {
		pr: { number: String(pr.number), url: url.href, headOid: head },
		ci: head !== headOid ? "stale" : aggregateChecks(pr.statusCheckRollup),
	};
}

function identityKey(identity: GithubIdentity): string {
	return JSON.stringify([
		identity.root,
		identity.gitDir,
		identity.branch,
		identity.remotes,
		identity.headOid,
	]);
}

/** Passive snapshots, explicit demand-only refreshes, and one bounded active repository cache. */
export class GithubStatusCollector {
	private context: GithubContext | undefined;
	private demanded = false;
	private disposed = false;
	private job: Job | undefined;
	private value: GithubSnapshot | undefined;
	private cache: ApiCache | undefined;
	private repoCache:
		| { key: string; repo: Repository; fetchedAt: number; expiresAt: number }
		| undefined;

	constructor(
		private readonly exec: GithubExec,
		private readonly onChange: () => void,
		private readonly now: () => number = Date.now,
	) {}

	reconcile(context: GithubContext, demanded: boolean): void {
		if (this.disposed) return;
		const changed =
			this.context?.cwd !== context.cwd || this.context?.scopeKey !== context.scopeKey;
		if (!changed && this.demanded === demanded) return;
		this.clear();
		this.context = { ...context };
		this.demanded = demanded;
		this.value = demanded ? { context: this.context, ci: "unknown", pending: false } : undefined;
		this.repaint();
	}

	refresh(): Promise<void> {
		if (this.disposed || !this.demanded || !this.context) return Promise.resolve();
		if (this.job) return this.job.promise;
		const job: Job = {
			context: { ...this.context },
			controller: new AbortController(),
			promise: Promise.resolve(),
		};
		this.job = job;
		this.value = {
			...this.value,
			context: job.context,
			ci: this.value?.ci ?? "unknown",
			pending: true,
		};
		job.promise = Promise.resolve().then(() => this.collect(job));
		this.repaint();
		return job.promise;
	}

	invalidate(): void {
		if (this.disposed) return;
		this.clear();
		if (this.demanded && this.context)
			this.value = { context: this.context, ci: "unknown", pending: false };
		this.repaint();
	}

	snapshot(): GithubSnapshot | undefined {
		if (this.disposed || !this.demanded || !this.value) return undefined;
		const value = this.value;
		const now = this.now();
		const expired =
			value.expiresAt !== undefined &&
			(!Number.isFinite(now) ||
				!Number.isFinite(value.expiresAt) ||
				!Number.isFinite(value.fetchedAt) ||
				now >= value.expiresAt ||
				now < (value.fetchedAt ?? now));
		return Object.freeze({
			...value,
			context: Object.freeze({ ...value.context }),
			identity: value.identity ? Object.freeze({ ...value.identity }) : undefined,
			pr: value.pr ? Object.freeze({ ...value.pr }) : undefined,
			ci: expired && value.ci !== "unknown" ? "stale" : value.ci,
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clear();
		this.context = undefined;
		this.demanded = false;
	}

	private clear(): void {
		this.job?.controller.abort();
		this.job = undefined;
		this.value = undefined;
		this.cache = undefined;
		this.repoCache = undefined;
	}

	private active(job: Job): boolean {
		return !this.disposed && this.demanded && this.job === job && !job.controller.signal.aborted;
	}

	private repaint(): void {
		if (this.disposed) return;
		try {
			this.onChange();
		} catch {
			// An unavailable consumer cannot break collection or cleanup.
		}
	}

	private command(command: string, args: string[], job: Job): Promise<string | undefined> {
		if (!this.active(job)) return Promise.resolve(undefined);
		const timeout = command === "git" ? 2_000 : 10_000;
		const controller = new AbortController();
		// Enforce the deadline even when an executor ignores timeout or abort. No idle timers.
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value?: string) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				job.controller.signal.removeEventListener("abort", abort);
				resolve(value);
			};
			const abort = () => {
				controller.abort();
				finish();
			};
			const timer = setTimeout(abort, timeout);
			job.controller.signal.addEventListener("abort", abort, { once: true });
			Promise.resolve()
				.then(() => {
					if (!this.active(job) || controller.signal.aborted) return undefined;
					return this.exec(command, args, {
						cwd: job.context.cwd,
						timeout,
						signal: controller.signal,
					});
				})
				.then(
					(result) => {
						finish(
							this.active(job) &&
								!controller.signal.aborted &&
								result?.code === 0 &&
								!result.killed &&
								typeof result.stdout === "string" &&
								result.stdout.length <= MAX_STDOUT_BYTES &&
								Buffer.byteLength(result.stdout, "utf8") <= MAX_STDOUT_BYTES
								? result.stdout
								: undefined,
						);
					},
					() => finish(),
				);
		});
	}

	private async identity(job: Job): Promise<GithubIdentity | undefined> {
		const paths = await this.command(
			"git",
			["rev-parse", "--show-toplevel", "--absolute-git-dir"],
			job,
		);
		const branchOutput = await this.command(
			"git",
			["symbolic-ref", "--quiet", "--short", "HEAD"],
			job,
		);
		const remotes = await this.command("git", ["remote", "-v"], job);
		const headOutput = await this.command("git", ["rev-parse", "--verify", "HEAD"], job);
		const roots = paths?.trim().split("\n");
		const branch = text(branchOutput?.trim());
		const headOid = oid(headOutput?.trim());
		if (
			roots?.length !== 2 ||
			!text(roots[0]) ||
			!text(roots[1]) ||
			!isAbsolute(roots[0]) ||
			!isAbsolute(roots[1]) ||
			!branch ||
			branch.startsWith("-") ||
			/\s/.test(branch) ||
			!remotes?.trim() ||
			!headOid
		)
			return undefined;
		return { root: roots[0], gitDir: roots[1], branch, remotes, headOid };
	}

	private async collect(job: Job): Promise<void> {
		const before = await this.identity(job);
		if (!this.active(job)) return;
		if (!before) {
			this.cache = undefined;
			this.repoCache = undefined;
			this.finish(job, { ci: "unknown" });
			return;
		}
		const key = identityKey(before);
		if (this.value?.identity && identityKey(this.value.identity) !== key) {
			this.cache = undefined;
			this.repoCache = undefined;
			this.value = { context: job.context, identity: before, ci: "unknown", pending: true };
			this.repaint();
			if (!this.active(job)) return;
		}
		const now = this.now();
		let cached = this.cache;
		if (
			!cached ||
			cached.key !== key ||
			!Number.isFinite(cached.fetchedAt) ||
			!Number.isFinite(cached.expiresAt) ||
			now < cached.fetchedAt ||
			now >= cached.expiresAt ||
			!Number.isFinite(now) ||
			(this.repoCache !== undefined &&
				(!Number.isFinite(this.repoCache.fetchedAt) ||
					!Number.isFinite(this.repoCache.expiresAt) ||
					now < this.repoCache.fetchedAt ||
					now >= this.repoCache.expiresAt))
		) {
			let result: Result = { ci: "unknown" };
			try {
				const repoKey = JSON.stringify([before.root, before.gitDir, before.remotes]);
				let repo: Repository | undefined;
				if (
					this.repoCache?.key === repoKey &&
					Number.isFinite(now) &&
					now >= this.repoCache.fetchedAt &&
					now < this.repoCache.expiresAt
				) {
					repo = this.repoCache.repo;
				} else {
					this.repoCache = undefined;
					repo = repository(
						await this.command(
							"gh",
							["repo", "view", "--json", "nameWithOwner,defaultBranchRef,url"],
							job,
						),
						before,
					);
					if (repo && this.active(job)) {
						const fetchedAt = this.now();
						this.repoCache = {
							key: repoKey,
							repo,
							fetchedAt,
							expiresAt: fetchedAt + REPO_CACHE_MS,
						};
					}
				}
				if (repo && this.active(job)) {
					if (before.branch !== repo.defaultBranch) {
						result = pullRequest(
							await this.command(
								"gh",
								[
									"pr",
									"view",
									before.branch,
									"--repo",
									repo.name,
									"--json",
									"number,url,headRefOid,state,statusCheckRollup",
								],
								job,
							),
							repo,
							before.headOid,
						);
					}
				}
			} catch {
				// Missing gh, network/auth failures and malformed JSON are negative results.
			}
			if (!this.active(job)) return;
			const fetchedAt = this.now();
			// Do not retain an older green claim while rechecking a failed or changed API result.
			if (
				this.value?.pr &&
				(!result.pr ||
					result.ci !== this.value.ci ||
					result.pr.number !== this.value.pr.number ||
					result.pr.url !== this.value.pr.url ||
					result.pr.headOid !== this.value.pr.headOid)
			) {
				this.value = { context: job.context, identity: before, ci: "unknown", pending: true };
				this.repaint();
				if (!this.active(job)) return;
			}
			cached = { ...result, key, fetchedAt, expiresAt: fetchedAt + CACHE_MS };
		}
		const after = await this.identity(job);
		if (!this.active(job)) return;
		if (!after || identityKey(after) !== key) {
			this.cache = undefined;
			this.repoCache = undefined;
			this.finish(job, { ci: "unknown" }, after);
			return;
		}
		this.cache = cached;
		this.finish(job, cached, before);
	}

	private finish(
		job: Job,
		result: Result & { fetchedAt?: number; expiresAt?: number },
		identity?: GithubIdentity,
	): void {
		if (!this.active(job)) return;
		this.value = {
			context: job.context,
			identity,
			pr: result.pr,
			ci: result.ci,
			fetchedAt: result.fetchedAt,
			expiresAt: result.expiresAt,
			pending: false,
		};
		this.job = undefined;
		this.repaint();
	}
}

export function formatCi(state: CiState): string {
	switch (state) {
		case "no-checks":
			return "CI no checks";
		case "running":
			return "CI running";
		case "failed":
			return "CI failed";
		case "passing":
			return "CI passing";
		case "stale":
			return "CI stale";
		default:
			return "";
	}
}

export function githubTemplateValues(
	snapshot: GithubSnapshot | undefined,
): Readonly<{ pr_number?: string; pr_url?: string; ci?: string }> {
	if (!snapshot) return Object.freeze({});
	const values: { pr_number?: string; pr_url?: string; ci?: string } = {};
	if (snapshot.pr) {
		const number = snapshot.pr.number;
		const url = httpsUrl(snapshot.pr.url);
		if (
			/^[1-9][0-9]*$/.test(number) &&
			Number.isSafeInteger(Number(number)) &&
			url &&
			new RegExp(`^/\\w[\\w.-]*/\\w[\\w.-]*/pull/${number}$`).test(url.pathname)
		) {
			values.pr_number = number;
			values.pr_url = url.href;
		}
	}
	const ci = formatCi(snapshot.ci);
	if (ci) values.ci = ci;
	return Object.freeze(values);
}
