import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CiState,
	formatCi,
	type GithubContext,
	type GithubExec,
	GithubStatusCollector,
	githubTemplateValues,
} from "../extensions/zentui/github-status";

type ExecResult = Awaited<ReturnType<GithubExec>>;
const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const collectors: GithubStatusCollector[] = [];
const context: GithubContext = { cwd: "/project", scopeKey: "session-a" };
const completed = (conclusion: unknown) => ({
	__typename: "CheckRun",
	status: "COMPLETED",
	conclusion,
});
const legacy = (state: unknown) => ({ __typename: "StatusContext", state });
const result = (stdout: string, code = 0): ExecResult => ({
	stdout,
	code,
	stderr: "",
	killed: false,
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function fixture() {
	const state = {
		root: "/project",
		gitDir: "/project/.git",
		branch: "feature/topic",
		remotes:
			"origin\tgit@github.com:owner/project.git (fetch)\norigin\tgit@github.com:owner/project.git (push)\n",
		head: HEAD,
		detached: false,
		noRepo: false,
		noPr: false,
		repo: {
			nameWithOwner: "owner/project",
			url: "https://github.com/owner/project",
			defaultBranchRef: { name: "main" },
		},
		pr: {
			number: 42,
			url: "https://github.com/owner/project/pull/42",
			headRefOid: HEAD,
			state: "OPEN",
			statusCheckRollup: [completed("SUCCESS")] as unknown,
		},
		repoOutput: undefined as string | undefined,
		prOutput: undefined as string | undefined,
		pendingPr: undefined as Promise<ExecResult> | undefined,
	};
	// This is the only executor used in the entire file: no subprocess or network adapter.
	const exec = vi.fn<GithubExec>(async (command, args) => {
		if (command === "git") {
			if (args[0] === "rev-parse" && args[1] === "--show-toplevel")
				return result(`${state.root}\n${state.gitDir}\n`, state.noRepo ? 128 : 0);
			if (args[0] === "symbolic-ref") return result(`${state.branch}\n`, state.detached ? 1 : 0);
			if (args[0] === "remote") return result(state.remotes);
			if (args[0] === "rev-parse" && args[1] === "--verify") return result(`${state.head}\n`);
		}
		if (command === "gh" && args[0] === "repo")
			return result(state.repoOutput ?? JSON.stringify(state.repo));
		if (command === "gh" && args[0] === "pr")
			return (
				state.pendingPr ?? result(state.prOutput ?? JSON.stringify(state.pr), state.noPr ? 1 : 0)
			);
		throw new Error(`Unexpected fixture query: ${command} ${args.join(" ")}`);
	});
	const onChange = vi.fn();
	let now = 1_000_000;
	const collector = new GithubStatusCollector(exec, onChange, () => now);
	collectors.push(collector);
	return {
		state,
		exec,
		onChange,
		collector,
		setTime: (at: number) => {
			now = at;
		},
		start: async () => {
			collector.reconcile(context, true);
			await collector.refresh();
		},
		values: () => githubTemplateValues(collector.snapshot()),
		ghCalls: (kind: string) =>
			exec.mock.calls.filter(([command, args]) => command === "gh" && args[0] === kind),
		gitCalls: () => exec.mock.calls.filter(([command]) => command === "git"),
	};
}

async function settle() {
	for (let turn = 0; turn < 100; turn++) await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	for (const collector of collectors.splice(0)) collector.dispose();
	expect(vi.getTimerCount()).toBe(0);
	vi.useRealTimers();
});

it("is passive until both demand and explicit refresh, with no idle timers", async () => {
	const f = fixture();
	await f.collector.refresh();
	f.collector.reconcile(context, false);
	await f.collector.refresh();
	expect(f.collector.snapshot()).toBeUndefined();
	f.collector.reconcile(context, true);
	for (let read = 0; read < 10; read++) expect(f.values()).toEqual({});
	expect(f.exec).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
	await f.collector.refresh();
	expect(f.values()).toEqual({ pr_number: "42", pr_url: f.state.pr.url, ci: "CI passing" });
	expect(vi.getTimerCount()).toBe(0);
});

it("coalesces same-generation refreshes, freezes selectors, and rechecks all identity fields", async () => {
	const f = fixture();
	f.collector.reconcile(context, true);
	const first = f.collector.refresh();
	expect(f.collector.refresh()).toBe(first);
	expect(f.collector.snapshot()?.pending).toBe(true);
	await first;
	expect(f.ghCalls("repo").map(([, args]) => args)).toEqual([
		["repo", "view", "--json", "nameWithOwner,defaultBranchRef,url"],
	]);
	expect(f.ghCalls("pr").map(([, args]) => args)).toEqual([
		[
			"pr",
			"view",
			"feature/topic",
			"--repo",
			"owner/project",
			"--json",
			"number,url,headRefOid,state,statusCheckRollup",
		],
	]);
	const identityArgs = [
		["rev-parse", "--show-toplevel", "--absolute-git-dir"],
		["symbolic-ref", "--quiet", "--short", "HEAD"],
		["remote", "-v"],
		["rev-parse", "--verify", "HEAD"],
	];
	expect(f.gitCalls().map(([, args]) => args)).toEqual([...identityArgs, ...identityArgs]);
	for (const [command, , options] of f.exec.mock.calls) {
		expect(options.cwd).toBe(context.cwd);
		expect(options.timeout).toBe(command === "git" ? 2000 : 10000);
		expect(options.signal).toBeInstanceOf(AbortSignal);
	}
	expect(f.collector.snapshot()?.pending).toBe(false);
});

it("returns detached immutable snapshots and copies integration context", async () => {
	const f = fixture();
	const supplied = { ...context };
	f.collector.reconcile(supplied, true);
	supplied.cwd = "/other";
	await f.collector.refresh();
	const snap = f.collector.snapshot();
	expect(snap?.context.cwd).toBe("/project");
	expect(snap?.identity?.headOid).toBe(HEAD);
	for (const part of [snap, snap?.context, snap?.identity, snap?.pr])
		expect(Object.isFrozen(part)).toBe(true);
	expect(f.collector.snapshot()).not.toBe(snap);
	expect(f.collector.snapshot()?.pr).not.toBe(snap?.pr);
});

describe("repository and URL safety", () => {
	it.each([
		"https://github.com/owner/project.git",
		"http://github.com/owner/project.git",
		"ssh://git@github.com/owner/project.git",
		"git@github.com:owner/project.git",
		"git@github.com:owner/project.git/",
		"https://github.com/OWNER/PROJECT.git",
	])("accepts the existing fetch-remote convention %s", async (remote) => {
		const f = fixture();
		f.state.remotes = `origin\t${remote} (fetch)\n`;
		await f.start();
		expect(f.values().pr_number).toBe("42");
	});

	it.each([
		"https://elsewhere.test/owner/project.git",
		"https://github.com/other/project.git",
		"https://github.com:8443/owner/project.git",
		"file:///owner/project.git",
		"ftp://github.com/owner/project.git",
		"https://github.com/owner/project.git%0a",
	])("rejects unrelated or unsupported remote %s", async (remote) => {
		const f = fixture();
		f.state.remotes = `origin\t${remote} (fetch)\n`;
		await f.start();
		expect(f.values()).toEqual({});
		expect(f.ghCalls("pr")).toHaveLength(0);
	});

	it("never proves a repository from a push-only remote", async () => {
		const f = fixture();
		f.state.remotes = "origin\tgit@github.com:owner/project.git (push)\n";
		await f.start();
		expect(f.values()).toEqual({});
	});

	it("preserves validated enterprise origins and HTTPS ports", async () => {
		const f = fixture();
		f.state.repo.url = "https://github.example.test:8443/owner/project";
		f.state.remotes = "origin\thttps://github.example.test:8443/owner/project.git (fetch)\n";
		f.state.pr.url = `${f.state.repo.url}/pull/42`;
		await f.start();
		expect(f.values().pr_url).toBe(f.state.pr.url);
	});

	it.each([
		"http://github.com/owner/project",
		"https://user:secret@github.com/owner/project",
		"https://github.com/owner/project\n",
		"https://github.com/owner/project?x=1",
		"https://github.com/owner/project#x",
		"https://github.com/owner/project?",
		"https://github.com/owner/project%0a",
		"https://github.com/other/project",
		"https://github.com/owner\\project",
		"javascript:alert(1)",
	])("rejects unsafe repository URL %s", async (url) => {
		const f = fixture();
		f.state.repo.url = url;
		await f.start();
		expect(f.values()).toEqual({});
		expect(f.ghCalls("pr")).toHaveLength(0);
	});

	it.each([
		"-owner/project",
		"owner/-project",
		"owner/project/more",
		"owner/pro ject",
		"owner/project\n",
		"../project",
	])("rejects unsafe repository selector %s", async (name) => {
		const f = fixture();
		f.state.repo.nameWithOwner = name;
		f.state.repo.url = `https://github.com/${name}`;
		await f.start();
		expect(f.values()).toEqual({});
	});

	it.each([
		"javascript:alert(1)",
		"http://github.com/owner/project/pull/42",
		"https://user:secret@github.com/owner/project/pull/42",
		"https://github.com/owner/project/pull/42\n",
		"https://github.com/owner/project/pull/42%0a",
		"https://elsewhere.test/owner/project/pull/42",
		"https://github.com/other/project/pull/42",
		"https://github.com/owner/project/pull/41",
		"https://github.com/owner/project/pull/42?redirect=evil",
		"https://github.com/owner/project/pull/42#x",
		"https:\\github.com\\owner\\project\\pull\\42",
	])("rejects unsafe or mismatched PR URL %s", async (url) => {
		const f = fixture();
		f.state.pr.url = url;
		await f.start();
		expect(f.values()).toEqual({});
	});
});

describe("absent or invalid PR data", () => {
	it.each(["default", "detached", "no-repo", "no-remote", "no-pr", "closed", "merged"])(
		"fails quiet for %s",
		async (kind) => {
			const f = fixture();
			if (kind === "default") f.state.branch = "main";
			if (kind === "detached") f.state.detached = true;
			if (kind === "no-repo") f.state.noRepo = true;
			if (kind === "no-remote") f.state.remotes = "";
			if (kind === "no-pr") f.state.noPr = true;
			if (kind === "closed") f.state.pr.state = "CLOSED";
			if (kind === "merged") f.state.pr.state = "MERGED";
			await f.start();
			expect(f.values()).toEqual({});
			if (!["no-pr", "closed", "merged"].includes(kind)) expect(f.ghCalls("pr")).toHaveLength(0);
		},
	);

	it.each(["", "short", "a".repeat(39), "g".repeat(40), `${HEAD}\nextra`])(
		"rejects non-full local commit %s",
		async (head) => {
			const f = fixture();
			f.state.head = head;
			await f.start();
			expect(f.values()).toEqual({});
			expect(f.ghCalls("repo")).toHaveLength(0);
		},
	);

	it.each(["-option", "feature\nother", "feature other"])(
		"rejects unsafe branches %s",
		async (branch) => {
			const f = fixture();
			f.state.branch = branch;
			await f.start();
			expect(f.values()).toEqual({});
			expect(f.ghCalls("repo")).toHaveLength(0);
		},
	);

	it.each(["root", "gitDir"] as const)("requires absolute %s", async (field) => {
		const f = fixture();
		f.state[field] = "relative";
		await f.start();
		expect(f.values()).toEqual({});
	});

	it.each(["not json", "null", "[]", "{}"])(
		"rejects malformed repo or PR output %s",
		async (output) => {
			for (const field of ["repoOutput", "prOutput"] as const) {
				const f = fixture();
				f.state[field] = output;
				await f.start();
				expect(f.values()).toEqual({});
			}
		},
	);

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", null])(
		"rejects unsafe PR number %s",
		async (number) => {
			const f = fixture();
			f.state.prOutput = JSON.stringify({ ...f.state.pr, number });
			await f.start();
			expect(f.values()).toEqual({});
		},
	);

	it.each([undefined, "", "short", "g".repeat(40)])(
		"rejects malformed PR head %s",
		async (headRefOid) => {
			const f = fixture();
			f.state.prOutput = JSON.stringify({ ...f.state.pr, headRefOid });
			await f.start();
			expect(f.values()).toEqual({});
		},
	);

	it("supports a full SHA256 commit identity", async () => {
		const f = fixture();
		f.state.head = "c".repeat(64);
		f.state.pr.headRefOid = f.state.head;
		await f.start();
		expect(f.values().ci).toBe("CI passing");
	});
});

describe("honest CI aggregation", () => {
	it.each(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"])(
		"reports CheckRun %s as failed",
		async (conclusion) => {
			const f = fixture();
			f.state.pr.statusCheckRollup = [completed(conclusion)];
			await f.start();
			expect(f.values().ci).toBe("CI failed");
		},
	);

	it.each(["QUEUED", "IN_PROGRESS", "PENDING", "REQUESTED", "WAITING"])(
		"reports CheckRun %s as running",
		async (status) => {
			const f = fixture();
			f.state.pr.statusCheckRollup = [{ __typename: "CheckRun", status, conclusion: null }];
			await f.start();
			expect(f.values().ci).toBe("CI running");
		},
	);

	it.each([
		["SUCCESS", "CI passing"],
		["FAILURE", "CI failed"],
		["ERROR", "CI failed"],
		["PENDING", "CI running"],
		["EXPECTED", "CI running"],
		["error", "CI failed"],
		["UNKNOWN", undefined],
		[null, undefined],
	])("handles legacy StatusContext %s", async (state, ci) => {
		const f = fixture();
		f.state.pr.statusCheckRollup = [legacy(state)];
		await f.start();
		expect(f.values().ci).toBe(ci);
	});

	it.each([
		[[], "CI no checks"],
		[[completed("SKIPPED"), completed("NEUTRAL")], "CI no checks"],
		[[completed("SUCCESS"), completed("NEUTRAL"), completed("SKIPPED")], "CI passing"],
		[[completed("SUCCESS"), legacy("SUCCESS")], "CI passing"],
		[[completed("SUCCESS"), completed("MYSTERY")], undefined],
		[[completed("SUCCESS"), completed(null)], undefined],
		[[{ status: "COMPLETED", conclusion: "SUCCESS" }], "CI passing"],
		[[{ state: "SUCCESS" }], "CI passing"],
		[[{ __typename: "Different", state: "SUCCESS" }], undefined],
		[[{ __typename: "StatusContext", status: "COMPLETED", conclusion: "SUCCESS" }], undefined],
		[[{ state: "SUCCESS", status: "COMPLETED", conclusion: "SUCCESS" }], undefined],
		[[{ status: "MYSTERY", conclusion: "SUCCESS" }], undefined],
		[[{ conclusion: "SUCCESS" }], undefined],
		[[{ status: "IN_PROGRESS" }, completed("SUCCESS"), {}], "CI running"],
		[[{ status: "IN_PROGRESS" }, completed("FAILURE"), {}], "CI failed"],
		[[legacy("ERROR"), legacy("PENDING"), completed("SUCCESS")], "CI failed"],
		[[null], undefined],
		[[{}], undefined],
		[["SUCCESS"], undefined],
		[null, undefined],
		[{}, undefined],
	])("aggregates fixture %j without inventing green", async (checks, ci) => {
		const f = fixture();
		f.state.pr.statusCheckRollup = checks;
		await f.start();
		expect(f.values().pr_number).toBe("42");
		expect(f.values().ci).toBe(ci);
	});

	it("marks local-unpushed or mismatched heads stale even with passing remote checks", async () => {
		const f = fixture();
		f.state.pr.headRefOid = OTHER_HEAD;
		await f.start();
		expect(f.values()).toEqual({ pr_number: "42", pr_url: f.state.pr.url, ci: "CI stale" });
	});

	it("never invokes worktree-content or history queries", async () => {
		const f = fixture();
		await f.start();
		expect(
			f.gitCalls().every(([, args]) => ["rev-parse", "symbolic-ref", "remote"].includes(args[0])),
		).toBe(true);
	});
});

describe("identity-qualified positive and negative caching", () => {
	it("checks identity on every cached refresh while reusing repo and PR API responses", async () => {
		const f = fixture();
		await f.start();
		f.setTime(1_029_999);
		await f.collector.refresh();
		expect(f.gitCalls()).toHaveLength(16);
		expect(f.ghCalls("repo")).toHaveLength(1);
		expect(f.ghCalls("pr")).toHaveLength(1);
		f.setTime(1_030_000);
		expect(f.values().ci).toBe("CI stale");
		expect(f.values().pr_number).toBe("42");
		await f.collector.refresh();
		expect(f.ghCalls("repo")).toHaveLength(1);
		expect(f.ghCalls("pr")).toHaveLength(2);
		expect(f.values().ci).toBe("CI passing");
	});

	it("starts TTL at completed API fetch, not refresh start", async () => {
		const f = fixture();
		const pending = deferred<ExecResult>();
		f.state.pendingPr = pending.promise;
		f.collector.reconcile(context, true);
		const refresh = f.collector.refresh();
		await settle();
		f.setTime(1_025_000);
		pending.resolve(result(JSON.stringify(f.state.pr)));
		await refresh;
		expect(f.collector.snapshot()?.fetchedAt).toBe(1_025_000);
		expect(f.collector.snapshot()?.expiresAt).toBe(1_055_000);
	});

	it.each(["no-pr", "malformed-pr", "malformed-repo", "closed"])(
		"negative caches %s and retries after expiry",
		async (kind) => {
			const f = fixture();
			if (kind === "no-pr") f.state.noPr = true;
			if (kind === "malformed-pr") f.state.prOutput = "not json";
			if (kind === "malformed-repo") f.state.repoOutput = "not json";
			if (kind === "closed") f.state.pr.state = "CLOSED";
			await f.start();
			const ghCount = f.ghCalls("repo").length + f.ghCalls("pr").length;
			f.state.noPr = false;
			f.state.prOutput = undefined;
			f.state.repoOutput = undefined;
			f.state.pr.state = "OPEN";
			f.setTime(1_029_999);
			await f.collector.refresh();
			expect(f.values()).toEqual({});
			expect(f.ghCalls("repo").length + f.ghCalls("pr").length).toBe(ghCount);
			expect(f.gitCalls()).toHaveLength(16);
			f.setTime(1_030_000);
			await f.collector.refresh();
			expect(f.values().ci).toBe("CI passing");
		},
	);

	it("suppresses expired green while refresh waits and clears it on failure", async () => {
		const f = fixture();
		await f.start();
		f.setTime(1_030_000);
		const pending = deferred<ExecResult>();
		f.state.pendingPr = pending.promise;
		const refresh = f.collector.refresh();
		await settle();
		expect(f.collector.snapshot()?.pending).toBe(true);
		expect(f.values().ci).toBe("CI stale");
		pending.resolve(result("auth/network unavailable", 1));
		await refresh;
		expect(f.values()).toEqual({});
		expect(f.collector.snapshot()?.ci).toBe("unknown");
		f.state.pendingPr = undefined;
		await f.collector.refresh();
		expect(f.values()).toEqual({});
		expect(f.ghCalls("pr")).toHaveLength(2);
	});

	it.each(["root", "gitDir", "branch", "remotes", "head"] as const)(
		"clears old publishable values when cached %s changes",
		async (field) => {
			const f = fixture();
			await f.start();
			if (field === "head") f.state.head = OTHER_HEAD;
			else if (field === "remotes")
				f.state.remotes += "backup\tgit@github.com:owner/project.git (fetch)\n";
			else f.state[field] += "-changed";
			const pending = deferred<ExecResult>();
			f.state.pendingPr = pending.promise;
			const refresh = f.collector.refresh();
			await settle();
			expect(f.values()).toEqual({});
			expect(f.collector.snapshot()?.pending).toBe(true);
			pending.resolve(result(JSON.stringify(f.state.pr)));
			await refresh;
			expect(f.values().ci).toBe(field === "head" ? "CI stale" : "CI passing");
			expect(f.ghCalls("repo")).toHaveLength(2);
			expect(f.ghCalls("pr")).toHaveLength(2);
		},
	);

	it("clears cached green on an identity error without using the API cache", async () => {
		const f = fixture();
		await f.start();
		f.state.noRepo = true;
		await f.collector.refresh();
		expect(f.values()).toEqual({});
		expect(f.collector.snapshot()?.identity).toBeUndefined();
		f.state.noRepo = false;
		await f.collector.refresh();
		expect(f.ghCalls("pr")).toHaveLength(2);
	});

	it("does not claim green on clock regression or nonfinite time", async () => {
		const f = fixture();
		await f.start();
		f.setTime(999_999);
		expect(f.values().ci).toBe("CI stale");
		f.setTime(Number.NaN);
		expect(f.values().ci).toBe("CI stale");
		await f.collector.refresh();
		expect(f.values().ci).toBe("CI stale");
		f.setTime(1_001_000);
		expect(f.values().ci).toBe("CI stale");
		await f.collector.refresh();
		expect(f.values().ci).toBe("CI passing");
		expect(f.ghCalls("pr")).toHaveLength(3);
	});
});

describe("races and lifecycle", () => {
	it.each(["root", "gitDir", "branch", "remotes", "head"] as const)(
		"rejects a %s change during the PR query",
		async (field) => {
			const f = fixture();
			const pending = deferred<ExecResult>();
			f.state.pendingPr = pending.promise;
			f.collector.reconcile(context, true);
			const refresh = f.collector.refresh();
			await settle();
			if (field === "head") f.state.head = OTHER_HEAD;
			else f.state[field] += "-changed";
			pending.resolve(result(JSON.stringify(f.state.pr)));
			await refresh;
			expect(f.values()).toEqual({});
			expect(f.collector.snapshot()?.pending).toBe(false);
		},
	);

	it("also rejects identity races around negative API results", async () => {
		const f = fixture();
		const pending = deferred<ExecResult>();
		f.state.pendingPr = pending.promise;
		f.collector.reconcile(context, true);
		const refresh = f.collector.refresh();
		await settle();
		f.state.branch = "next-branch";
		pending.resolve(result("no PR", 1));
		await refresh;
		f.state.pendingPr = undefined;
		await f.collector.refresh();
		expect(f.values().ci).toBe("CI passing");
		expect(f.ghCalls("pr")).toHaveLength(2);
	});

	it("rechecks identity even on cache hits and rejects changes during that recheck", async () => {
		const f = fixture();
		await f.start();
		const base = f.exec.getMockImplementation();
		if (!base) throw new Error("Missing fixture executor");
		let headChecks = 0;
		f.exec.mockImplementation(async (command, args, options) => {
			if (command === "git" && args[1] === "--verify" && ++headChecks === 2)
				f.state.head = OTHER_HEAD;
			return base(command, args, options);
		});
		await f.collector.refresh();
		expect(f.values()).toEqual({});
		expect(f.ghCalls("pr")).toHaveLength(1);
	});

	it.each(["cwd", "scopeKey", "demand", "invalidate", "dispose"])(
		"aborts %s and cannot publish a late completion over the new generation",
		async (kind) => {
			const f = fixture();
			const pending = deferred<ExecResult>();
			f.state.pendingPr = pending.promise;
			f.collector.reconcile(context, true);
			const refresh = f.collector.refresh();
			await settle();
			const signal = f.ghCalls("pr")[0][2].signal;
			if (kind === "cwd") f.collector.reconcile({ ...context, cwd: "/other" }, true);
			if (kind === "scopeKey") f.collector.reconcile({ ...context, scopeKey: "session-b" }, true);
			if (kind === "demand") f.collector.reconcile(context, false);
			if (kind === "invalidate") f.collector.invalidate();
			if (kind === "dispose") f.collector.dispose();
			expect(signal.aborted).toBe(true);
			expect(f.values()).toEqual({});
			await refresh; // Settles even though the injected executor has not resolved.
			f.state.pendingPr = undefined;
			f.state.pr.number = 43;
			f.state.pr.url = "https://github.com/owner/project/pull/43";
			if (kind === "demand") f.collector.reconcile(context, true);
			await f.collector.refresh();
			const notifications = f.onChange.mock.calls.length;
			pending.resolve(
				result(
					JSON.stringify({
						...f.state.pr,
						number: 42,
						url: "https://github.com/owner/project/pull/42",
					}),
				),
			);
			await settle();
			expect(f.onChange).toHaveBeenCalledTimes(notifications);
			expect(f.values().pr_number).toBe(kind === "dispose" ? undefined : "43");
			if (kind === "dispose") {
				const calls = f.exec.mock.calls.length;
				f.collector.reconcile(context, true);
				f.collector.invalidate();
				f.collector.dispose();
				await f.collector.refresh();
				expect(f.exec).toHaveBeenCalledTimes(calls);
				expect(f.onChange).toHaveBeenCalledTimes(notifications);
			}
		},
	);

	it("invalidate clears PR/CI and metadata cache synchronously without starting queries", async () => {
		const f = fixture();
		await f.start();
		const calls = f.exec.mock.calls.length;
		f.collector.invalidate();
		expect(f.values()).toEqual({});
		expect(f.exec).toHaveBeenCalledTimes(calls);
		await f.collector.refresh();
		expect(f.ghCalls("repo")).toHaveLength(2);
	});

	it("guards throwing callbacks and reentrant demand loss", async () => {
		const f = fixture();
		f.onChange.mockImplementation(() => {
			throw new Error("surface unavailable");
		});
		await f.start();
		expect(f.values().ci).toBe("CI passing");
		f.onChange.mockImplementation(() => {
			f.collector.reconcile(context, false);
		});
		await f.collector.refresh();
		expect(f.collector.snapshot()).toBeUndefined();
	});
});

describe("bounds, timeouts and errors", () => {
	it.each(["git", "gh"])(
		"enforces %s deadlines with abort even for an executor that never resolves",
		async (command) => {
			const f = fixture();
			const base = f.exec.getMockImplementation();
			if (!base) throw new Error("Missing fixture executor");
			let blocked = false;
			let timedSignal: AbortSignal | undefined;
			f.exec.mockImplementation((name, args, options) => {
				if (!blocked && name === command) {
					blocked = true;
					timedSignal = options.signal;
					return new Promise(() => {});
				}
				return base(name, args, options);
			});
			f.collector.reconcile(context, true);
			const refresh = f.collector.refresh();
			await settle();
			await vi.advanceTimersByTimeAsync(command === "git" ? 2000 : 10000);
			await refresh;
			expect(timedSignal?.aborted).toBe(true);
			expect(f.values()).toEqual({});
			expect(f.collector.snapshot()?.pending).toBe(false);
		},
	);

	it.each(["throw", "code", "killed", "bad-stdout"])(
		"clears earlier success on %s network/executor failure",
		async (kind) => {
			const f = fixture();
			await f.start();
			f.setTime(1_030_000);
			const base = f.exec.getMockImplementation();
			if (!base) throw new Error("Missing fixture executor");
			f.exec.mockImplementation(async (command, args, options) => {
				if (command === "gh") {
					if (kind === "throw") throw new Error("network unavailable");
					if (kind === "code") return result("", 1);
					if (kind === "killed") return { ...result(JSON.stringify(f.state.pr)), killed: true };
					return { ...result(""), stdout: undefined as unknown as string };
				}
				return base(command, args, options);
			});
			await f.collector.refresh();
			expect(f.values()).toEqual({});
		},
	);

	it.each(["repoOutput", "prOutput"] as const)(
		"rejects oversized %s before parsing",
		async (field) => {
			const f = fixture();
			f.state[field] = " ".repeat(1024 * 1024 + 1);
			await f.start();
			expect(f.values()).toEqual({});
		},
	);

	it("applies the stdout limit in UTF-8 bytes, not just string units", async () => {
		const f = fixture();
		f.state.prOutput = JSON.stringify({ ...f.state.pr, extra: "🙂".repeat(300_000) });
		await f.start();
		expect(f.values()).toEqual({});
	});

	it("accepts 1024 checks but never claims green beyond the rollup safety cap", async () => {
		const f = fixture();
		f.state.pr.statusCheckRollup = Array.from({ length: 1024 }, () => completed("SUCCESS"));
		await f.start();
		expect(f.values().ci).toBe("CI passing");
		f.state.pr.statusCheckRollup = Array.from({ length: 1025 }, () => completed("SUCCESS"));
		f.collector.invalidate();
		await f.collector.refresh();
		expect(f.values().pr_number).toBe("42");
		expect(f.values().ci).toBeUndefined();
	});
});

it.each([
	["unknown", ""],
	["no-checks", "CI no checks"],
	["running", "CI running"],
	["failed", "CI failed"],
	["passing", "CI passing"],
	["stale", "CI stale"],
])("formats %s without styling", (state, expected) => {
	expect(formatCi(state as CiState)).toBe(expected);
	expect(githubTemplateValues(undefined)).toEqual({});
});

it.each([
	["0", "https://github.com/owner/project/pull/0"],
	["9007199254740992", "https://github.com/owner/project/pull/9007199254740992"],
	["42", "https://user:secret@github.com/owner/project/pull/42"],
	["42", "https://github.com/owner/project/pull/42?x=1"],
	["42", "https://github.com/owner/project/pull/43"],
	["42", "javascript:alert(1)"],
])("template helper does not expose unvalidated PR %s / %s", (number, url) => {
	expect(
		githubTemplateValues({
			context,
			ci: "unknown",
			pending: false,
			pr: { number, url, headOid: HEAD },
		}),
	).toEqual({});
});

it("rechecks identity around repo metadata fetches, not only PR fetches", async () => {
	const f = fixture();
	const pending = deferred<ExecResult>();
	const base = f.exec.getMockImplementation();
	if (!base) throw new Error("Missing fixture executor");
	f.exec.mockImplementation((command, args, options) =>
		command === "gh" && args[0] === "repo" ? pending.promise : base(command, args, options),
	);
	f.collector.reconcile(context, true);
	const refresh = f.collector.refresh();
	await settle();
	f.state.branch = "new-branch";
	pending.resolve(result(JSON.stringify(f.state.repo)));
	await refresh;
	expect(f.values()).toEqual({});
	expect(f.ghCalls("pr")[0][1][2]).toBe("feature/topic");
});

it("reuses validated repo metadata for five minutes without extending its TTL on PR refresh", async () => {
	const f = fixture();
	await f.start();
	for (const at of [1_030_000, 1_060_000, 1_299_999]) {
		f.setTime(at);
		await f.collector.refresh();
		expect(f.ghCalls("repo")).toHaveLength(1);
	}
	expect(f.ghCalls("pr")).toHaveLength(4);
	f.setTime(1_300_000);
	await f.collector.refresh();
	expect(f.ghCalls("repo")).toHaveLength(2);
	expect(f.ghCalls("pr")).toHaveLength(5);
	expect(f.values().ci).toBe("CI passing");
});

it("eventually discovers a changed remote default branch after cached default-branch skips", async () => {
	const f = fixture();
	f.state.branch = "main";
	await f.start();
	expect(f.values()).toEqual({});
	f.state.repo.defaultBranchRef.name = "trunk";
	for (const at of [1_030_000, 1_299_999]) {
		f.setTime(at);
		await f.collector.refresh();
		expect(f.ghCalls("repo")).toHaveLength(1);
		expect(f.ghCalls("pr")).toHaveLength(0);
		expect(f.values()).toEqual({});
	}
	f.setTime(1_300_000);
	await f.collector.refresh();
	expect(f.ghCalls("repo")).toHaveLength(2);
	expect(f.ghCalls("pr")[0][1][2]).toBe("main");
	expect(f.values().ci).toBe("CI passing");
});

it("skips a newly default branch at metadata expiry, even if the PR cache is still fresh", async () => {
	const f = fixture();
	await f.start();
	f.setTime(1_299_999);
	await f.collector.refresh();
	f.state.repo.defaultBranchRef.name = f.state.branch;
	f.setTime(1_300_000);
	await f.collector.refresh();
	expect(f.ghCalls("repo")).toHaveLength(2);
	expect(f.ghCalls("pr")).toHaveLength(2);
	expect(f.values()).toEqual({});
});

it("negative caches failed metadata revalidation for thirty seconds without keeping old green", async () => {
	const f = fixture();
	await f.start();
	f.state.repoOutput = "invalid json";
	f.setTime(1_300_000);
	await f.collector.refresh();
	expect(f.values()).toEqual({});
	f.state.repoOutput = undefined;
	f.setTime(1_329_999);
	await f.collector.refresh();
	expect(f.ghCalls("repo")).toHaveLength(2);
	expect(f.values()).toEqual({});
	f.setTime(1_330_000);
	await f.collector.refresh();
	expect(f.ghCalls("repo")).toHaveLength(3);
	expect(f.values().ci).toBe("CI passing");
});

it.each(["network", "checks"])(
	"drops an earlier green claim immediately on %s failure while final identity verification waits",
	async (kind) => {
		const f = fixture();
		await f.start();
		f.setTime(1_299_999);
		await f.collector.refresh();
		expect(f.values().ci).toBe("CI passing");
		f.setTime(1_300_000); // Metadata expiry forces I/O even though the PR cache is fresh.
		if (kind === "network") f.state.noPr = true;
		else f.state.pr.statusCheckRollup = [completed("FAILURE")];
		const afterPaths = deferred<ExecResult>();
		const base = f.exec.getMockImplementation();
		if (!base) throw new Error("Missing fixture executor");
		let paths = 0;
		f.exec.mockImplementation((command, args, options) => {
			if (command === "git" && args[1] === "--show-toplevel" && ++paths === 2)
				return afterPaths.promise;
			return base(command, args, options);
		});
		const refresh = f.collector.refresh();
		await settle();
		expect(f.values()).toEqual({});
		expect(f.collector.snapshot()?.pending).toBe(true);
		afterPaths.resolve(result(`${f.state.root}\n${f.state.gitDir}\n`));
		await refresh;
		expect(f.values().ci).toBe(kind === "network" ? undefined : "CI failed");
	},
);
