import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { ExecResult } from "@oh-my-pi/pi-coding-agent/exec/exec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type OmpLookupContext,
	OmpTemplateLookups,
} from "../extensions/zentui/omp-template-lookups";

const collectors: OmpTemplateLookups[] = [];
const prNames = new Set(["pr_number", "pr_url"]);
const quotaNames = new Set(["usage_quota"]);
const allNames = new Set([...prNames, ...quotaNames]);

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function commandResult(stdout: string, code = 0): ExecResult {
	return { stdout, stderr: "", code, killed: false };
}

function report(overrides: Record<string, unknown> = {}) {
	return {
		provider: "openai-codex",
		fetchedAt: Date.now(),
		metadata: { accountId: "account-a", email: "a@example.test" },
		limits: [
			{
				id: "5h",
				label: "5 Hour",
				scope: { provider: "openai-codex", shared: true },
				window: { id: "5h", label: "5 Hour", resetsAt: Date.now() + 600_000 },
				amount: { unit: "percent", usedFraction: 0.2 },
			},
		],
		...overrides,
	};
}

function fixture() {
	const state = {
		branch: "feature/topic",
		root: "/project",
		gitDir: "/project/.git",
		remotes:
			"origin\tgit@github.com:owner/project.git (fetch)\norigin\tgit@github.com:owner/project.git (push)\n",
		noRepo: false,
		detached: false,
		noPr: false,
		repoOutput: JSON.stringify({
			nameWithOwner: "owner/project",
			url: "https://github.com/owner/project",
			defaultBranchRef: { name: "main" },
		}),
		prOutput: JSON.stringify({ number: 42, url: "https://github.com/owner/project/pull/42" }),
		pendingPr: undefined as Promise<ExecResult> | undefined,
		reports: [report()] as unknown,
	};
	const oauth = {
		selected: { accountId: "account-a", email: "a@example.test" } as unknown,
		identity: vi.fn(function (this: { selected: unknown }) {
			return this.selected;
		}),
	};
	const fetch = vi.fn(async (_signal?: AbortSignal): Promise<unknown> => state.reports);
	const session = { modelRegistry: { authStorage: { oauth } }, fetchUsageReports: fetch };
	const context: OmpLookupContext = {
		session,
		sessionId: "session-a",
		cwd: "/project",
		provider: "openai-codex",
		modelId: "gpt-5",
	};
	const exec = vi.fn<ExtensionAPI["exec"]>(async (command, args) => {
		if (command === "git") {
			if (args[0] === "rev-parse")
				return commandResult(`${state.root}\n${state.gitDir}\n`, state.noRepo ? 128 : 0);
			if (args[0] === "symbolic-ref")
				return commandResult(`${state.branch}\n`, state.detached ? 1 : 0);
			if (args[0] === "remote") return commandResult(state.remotes);
		}
		if (command === "gh") {
			if (args[0] === "repo") return commandResult(state.repoOutput);
			if (args[0] === "pr")
				return state.pendingPr ?? commandResult(state.prOutput, state.noPr ? 1 : 0);
		}
		throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
	});
	const repaint = vi.fn();
	const lookup = new OmpTemplateLookups(exec, repaint);
	collectors.push(lookup);
	return { state, oauth, fetch, context, exec, repaint, lookup };
}

// Drain the finite, promise-only git/gh pipeline; production schedules no timers.
async function settle() {
	for (let turn = 0; turn < 40; turn++) await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000);
});
afterEach(() => {
	for (const collector of collectors.splice(0)) collector.dispose();
	vi.useRealTimers();
});

it("performs no I/O or public capability reads without explicit variable demand", async () => {
	const f = fixture();
	const capability = vi.fn(() => {
		throw new Error("Must remain untouched");
	});
	const session = Object.defineProperties(
		{},
		{
			modelRegistry: { get: capability },
			fetchUsageReports: { get: capability },
		},
	);
	for (const names of [new Set<string>(), new Set(["usage", "pr", "unknown", "session_id"])])
		expect(f.lookup.read({ ...f.context, session }, names)).toEqual({});
	await settle();
	expect(f.exec).not.toHaveBeenCalled();
	expect(capability).not.toHaveBeenCalled();
	expect(f.fetch).not.toHaveBeenCalled();
	expect(f.repaint).not.toHaveBeenCalled();
});

it("loads asynchronously, publishes only demanded values, and reuses synchronous snapshots", async () => {
	const f = fixture();
	expect(f.lookup.read(f.context, allNames)).toEqual({});
	expect(f.lookup.read(f.context, allNames)).toEqual({});
	expect(f.fetch).toHaveBeenCalledOnce();
	await settle();
	expect(f.lookup.read(f.context, allNames)).toEqual({
		usage_quota: "5 Hour: 80% left",
	});
	const calls = f.exec.mock.calls.length;
	expect(f.lookup.read(f.context, new Set(["pr_number"]))).toEqual({});
	expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 80% left" });
	expect(f.exec).toHaveBeenCalledTimes(calls);
	expect(f.fetch).toHaveBeenCalledOnce();
	expect(f.repaint).toHaveBeenCalledOnce();
});

it("keeps quota-only reads independent from project commands and PR-only reads from account APIs", async () => {
	const f = fixture();
	f.lookup.read(f.context, quotaNames);
	await settle();
	expect(f.exec).not.toHaveBeenCalled();
	const accountCalls = f.oauth.identity.mock.calls.length;
	f.lookup.read(f.context, prNames);
	await settle();
	expect(f.fetch).toHaveBeenCalledOnce();
	expect(f.oauth.identity).toHaveBeenCalledTimes(accountCalls);
	expect(f.lookup.read(f.context, prNames)).toEqual({});
});

it("leaves PR/CI collection to the demand-controlled shared collector", async () => {
	const f = fixture();
	expect(f.lookup.read(f.context, new Set(["pr_number", "pr_url", "ci"]))).toEqual({});
	await settle();
	expect(f.exec).not.toHaveBeenCalled();
	expect(f.fetch).not.toHaveBeenCalled();
	expect(f.oauth.identity).not.toHaveBeenCalled();
});

describe("usage quota", () => {
	it("formats named percentage windows and legitimate zero remaining units", async () => {
		const f = fixture();
		f.state.reports = [
			report({
				limits: [
					{
						id: "fast",
						label: "Fast",
						scope: { provider: "openai-codex", shared: true },
						window: { id: "5h", label: "5 Hour" },
						amount: { unit: "percent", remainingFraction: 0 },
					},
					{
						id: "requests",
						label: "Requests",
						scope: { provider: "openai-codex", modelId: "gpt-5" },
						window: { id: "daily", label: "Daily" },
						amount: { unit: "requests", remaining: 0 },
					},
					{
						id: "credits",
						label: "Credits",
						scope: { provider: "openai-codex", shared: true },
						amount: { unit: "credits", remaining: 1.25 },
					},
				],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({
			usage_quota:
				"Fast (5 Hour): 0% left | Requests (Daily): 0 requests left | Credits: 1.25 credits left",
		});
	});

	it.each([
		{ usedFraction: 1.2, unit: "percent" },
		{ used: 120, limit: 100, unit: "requests" },
		{ used: 100, unit: "percent" },
		{ remaining: 0, limit: 100, unit: "tokens" },
	])("renders exhausted/overage amounts without fabricating a reset: %s", async (amount) => {
		const f = fixture();
		f.state.reports = [report({ limits: [{ ...report().limits[0], amount }] })];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 0% left" });
	});

	it.each([
		{ usedFraction: NaN, unit: "percent" },
		{ remaining: Infinity, unit: "tokens" },
		{ usedFraction: "0.2", unit: "percent" },
		{ remaining: -1, unit: "requests" },
		{ remainingFraction: 1.1, unit: "percent" },
		{ used: 0, limit: 0, unit: "tokens" },
		{ remaining: 11, limit: 10, unit: "credits" },
		{ remaining: 101, unit: "percent" },
		{ remaining: 5, unit: "bogus" },
		{ remaining: 5, unit: "unknown" },
		{},
		null,
	])("omits malformed or unavailable amounts %s", async (amount) => {
		const f = fixture();
		const base = report();
		f.state.reports = [report({ limits: [{ ...base.limits[0], amount }] })];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it.each([
		{ provider: "anthropic" },
		{ metadata: { accountId: "account-b", email: "a@example.test" } },
		{ metadata: { accountId: "account-a", email: "b@example.test" } },
		{ metadata: {} },
		{ fetchedAt: NaN },
		{ fetchedAt: 1_000_001 },
		{ limits: {} },
	])(
		"rejects wrong-provider, wrong-account, ambiguous or malformed reports %s",
		async (overrides) => {
			const f = fixture();
			f.state.reports = [report(overrides)];
			f.lookup.read(f.context, quotaNames);
			await settle();
			expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		},
	);

	it.each([
		{ provider: "anthropic", shared: true },
		{ provider: "openai-codex", modelId: "another-model", shared: true },
		{ provider: "openai-codex", shared: true, accountId: "account-b" },
	])("rejects unproven active model or credential scope %s", async (scope) => {
		const f = fixture();
		f.state.reports = [report({ limits: [{ ...report().limits[0], scope }] })];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it("rejects another organization even when the report matches the active account", async () => {
		const f = fixture();
		f.oauth.selected = { accountId: "account-a", email: "a@example.test", orgId: "selected-org" };
		f.state.reports = [
			report({
				limits: [
					{
						...report().limits[0],
						scope: { provider: "openai-codex", orgId: "another-org" },
					},
				],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it("accepts provider-wide Cursor quotas without a model ID or shared flag", async () => {
		const f = fixture();
		f.context.provider = "cursor";
		f.context.modelId = "auto";
		f.state.reports = [
			report({
				provider: "cursor",
				limits: [
					{
						...report().limits[0],
						id: "monthly",
						label: "Monthly",
						scope: { provider: "cursor", windowId: "monthly" },
						window: { id: "monthly", label: "Monthly", resetsAt: Date.now() + 600_000 },
					},
				],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "Monthly: 80% left" });
	});

	it("accepts a provider-resolved Gemini project, but still rejects a conflicting stored project", async () => {
		const f = fixture();
		f.context.provider = "google-gemini-cli";
		f.context.modelId = "gemini-2.5-pro";
		f.state.reports = [
			report({
				provider: "google-gemini-cli",
				limits: [
					{
						...report().limits[0],
						scope: {
							provider: "google-gemini-cli",
							modelId: "gemini-2.5-pro",
							projectId: "resolved-project",
						},
					},
				],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 80% left" });
		f.oauth.selected = {
			accountId: "account-a",
			email: "a@example.test",
			projectId: "another-project",
		};
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it("matches public project/org routing and an exact model without mixing siblings", async () => {
		const f = fixture();
		f.oauth.selected = { projectId: "PROJECT-A", orgId: "ORG-A" };
		const limit = report().limits[0];
		f.state.reports = [
			report({
				metadata: { projectId: "project-a", orgId: "org-a" },
				limits: [
					{
						...limit,
						scope: {
							provider: "openai-codex",
							modelId: "gpt-5",
							projectId: "project-a",
							orgId: "org-a",
						},
					},
				],
			}),
			report({ metadata: { projectId: "project-b", orgId: "org-a" } }),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 80% left" });
	});

	it("omits multiple account reports matching only one email, including a malformed sibling", async () => {
		const f = fixture();
		f.oauth.selected = { email: "a@example.test" };
		f.state.reports = [
			report(),
			report({
				metadata: { accountId: "account-b", email: "a@example.test" },
				limits: [{ ...report().limits[0], amount: { unit: "percent", usedFraction: NaN } }],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it("does not attribute even a single credential report without a proven active identity", async () => {
		const f = fixture();
		f.oauth.selected = undefined;
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		expect(f.fetch).toHaveBeenCalledOnce();
	});

	it("caches quota for five minutes and refreshes only on subsequent quota demand", async () => {
		const f = fixture();
		f.lookup.read(f.context, quotaNames);
		await settle();
		vi.setSystemTime(1_299_999);
		expect(f.lookup.read(f.context, quotaNames).usage_quota).toBe("5 Hour: 80% left");
		expect(f.fetch).toHaveBeenCalledOnce();
		vi.setSystemTime(1_300_000);
		f.lookup.read(f.context, new Set());
		expect(f.fetch).toHaveBeenCalledOnce();
		f.state.reports = [
			report({
				limits: [{ ...report().limits[0], amount: { unit: "percent", usedFraction: 0.6 } }],
			}),
		];
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 40% left" });
		expect(f.fetch).toHaveBeenCalledTimes(2);
	});

	it("omits expired windows and never treats a past reset as fresh full quota", async () => {
		const f = fixture();
		const limit = report().limits[0];
		f.state.reports = [
			report({
				limits: [
					{ ...limit, window: { id: "5h", label: "5 Hour", resetsAt: Date.now() - 1 } },
					{
						...limit,
						id: "daily",
						label: "Daily",
						window: { id: "daily", label: "Daily", resetsAt: Date.now() + 1_000 },
					},
				],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "Daily: 80% left" });
		vi.setSystemTime(1_001_000);
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		expect(f.fetch).toHaveBeenCalledTimes(2);
	});

	it.each(["throw", "null", "malformed", "missing", "throwing-getter"])(
		"negative-caches %s public report capabilities",
		async (kind) => {
			const f = fixture();
			if (kind === "throw") f.fetch.mockRejectedValue(new Error("reports unavailable"));
			if (kind === "null") f.state.reports = null;
			if (kind === "malformed") f.state.reports = {};
			if (kind === "missing")
				f.context.session = { modelRegistry: { authStorage: { oauth: f.oauth } } };
			const getter = vi.fn(() => {
				throw new Error("capability unavailable");
			});
			if (kind === "throwing-getter")
				f.context.session = Object.defineProperty(
					{ modelRegistry: { authStorage: { oauth: f.oauth } } },
					"fetchUsageReports",
					{ get: getter },
				);
			f.lookup.read(f.context, quotaNames);
			await settle();
			for (let repaint = 0; repaint < 10; repaint++)
				expect(f.lookup.read(f.context, quotaNames)).toEqual({});
			await settle();
			if (kind === "throwing-getter") expect(getter).toHaveBeenCalledOnce();
			else if (kind !== "missing") expect(f.fetch).toHaveBeenCalledOnce();
			vi.setSystemTime(1_300_000);
			f.lookup.read(f.context, quotaNames);
			await settle();
			if (kind === "throwing-getter") expect(getter).toHaveBeenCalledTimes(2);
			else if (kind !== "missing") expect(f.fetch).toHaveBeenCalledTimes(2);
		},
	);

	it("guards throwing account routing getters and does not guess an account", async () => {
		const f = fixture();
		f.context.session = Object.defineProperty({ fetchUsageReports: f.fetch }, "modelRegistry", {
			get() {
				throw new Error("unavailable registry");
			},
		});
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it("invalidates the active-account snapshot and ignores reports fetched for the previous account", async () => {
		const f = fixture();
		const oldReports = deferred<unknown>();
		f.fetch.mockReturnValueOnce(oldReports.promise);
		f.lookup.read(f.context, quotaNames);
		const oldSignal = f.fetch.mock.calls[0][0];
		f.oauth.selected = { accountId: "account-b", email: "b@example.test" };
		f.state.reports = [
			report({
				metadata: { accountId: "account-b", email: "b@example.test" },
				limits: [{ ...report().limits[0], amount: { unit: "percent", usedFraction: 0.6 } }],
			}),
		];
		f.lookup.read(f.context, quotaNames);
		await settle();
		oldReports.resolve([report()]);
		await settle();
		expect(oldSignal?.aborted).toBe(true);
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 40% left" });
		expect(f.repaint).toHaveBeenCalledOnce();
	});

	it.each(["provider", "modelId"] as const)(
		"does not refresh quota without an active %s",
		async (field) => {
			const f = fixture();
			f.context[field] = undefined;
			f.lookup.read(f.context, quotaNames);
			await settle();
			expect(f.lookup.read(f.context, quotaNames)).toEqual({});
			expect(f.fetch).not.toHaveBeenCalled();
			expect(f.oauth.identity).not.toHaveBeenCalled();
		},
	);

	it.each([null, { id: "5h", label: "5 Hour", resetsAt: NaN }, { resetsAt: "later" }])(
		"omits malformed quota windows %s",
		async (window) => {
			const f = fixture();
			f.state.reports = [report({ limits: [{ ...report().limits[0], window }] })];
			f.lookup.read(f.context, quotaNames);
			await settle();
			expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		},
	);

	it("rejects malformed public identities rather than falling back to another matching field", async () => {
		const f = fixture();
		f.oauth.selected = { accountId: 123, email: "a@example.test" };
		f.lookup.read(f.context, quotaNames);
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
	});

	it("ignores a quota completion if public account routing changed before another read", async () => {
		const f = fixture();
		const old = deferred<unknown>();
		f.fetch.mockReturnValueOnce(old.promise);
		f.lookup.read(f.context, quotaNames);
		f.oauth.selected = { accountId: "account-b", email: "b@example.test" };
		old.resolve([report()]);
		await settle();
		expect(f.repaint).not.toHaveBeenCalled();
		f.state.reports = [
			report({
				metadata: { accountId: "account-b", email: "b@example.test" },
				limits: [{ ...report().limits[0], amount: { unit: "percent", usedFraction: 0.6 } }],
			}),
		];
		expect(f.lookup.read(f.context, quotaNames)).toEqual({});
		await settle();
		expect(f.lookup.read(f.context, quotaNames)).toEqual({ usage_quota: "5 Hour: 40% left" });
	});
});

it.each(["session", "sessionId", "modelId", "provider", "cwd"] as const)(
	"ignores older quota completion after %s context changes",
	async (field) => {
		const f = fixture();
		const oldReports = deferred<unknown>();
		const oldPr = deferred<ExecResult>();
		f.fetch.mockReturnValueOnce(oldReports.promise);
		f.state.pendingPr = oldPr.promise;
		f.lookup.read(f.context, allNames);
		await settle();
		const oldSignal = f.fetch.mock.calls[0][0];
		const next = { ...f.context };
		if (field === "session") next.session = { ...f.context.session };
		else next[field] = `${next[field]}-next`;
		f.state.pendingPr = undefined;
		f.state.prOutput = JSON.stringify({
			number: 43,
			url: "https://github.com/owner/project/pull/43",
		});
		f.state.reports = [
			report({
				provider: next.provider,
				limits: [
					{
						...report().limits[0],
						scope: { provider: next.provider, shared: true },
						amount: { unit: "percent", usedFraction: 0.6 },
					},
				],
			}),
		];
		expect(f.lookup.read(next, allNames)).toEqual({});
		await settle();
		oldReports.resolve([report()]);
		oldPr.resolve(
			commandResult(
				JSON.stringify({ number: 42, url: "https://github.com/owner/project/pull/42" }),
			),
		);
		await settle();
		expect(oldSignal?.aborted).toBe(true);
		expect(f.lookup.read(next, allNames)).toEqual({
			usage_quota: "5 Hour: 40% left",
		});
		expect(f.repaint).toHaveBeenCalledOnce();
	},
);

it("aborts and ignores outstanding lookups after disposal", async () => {
	const f = fixture();
	const reports = deferred<unknown>();
	const pr = deferred<ExecResult>();
	f.fetch.mockReturnValueOnce(reports.promise);
	f.state.pendingPr = pr.promise;
	f.lookup.read(f.context, allNames);
	await settle();
	f.lookup.dispose();
	reports.resolve([report()]);
	pr.resolve(commandResult(f.state.prOutput));
	await settle();
	expect(f.fetch.mock.calls[0][0]?.aborted).toBe(true);
	expect(f.exec.mock.calls.every(([, , options]) => options?.signal?.aborted)).toBe(true);
	expect(f.lookup.read(f.context, allNames)).toEqual({});
	expect(f.repaint).not.toHaveBeenCalled();
});
