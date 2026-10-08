import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import {
	editorDemandsCustomVariable,
	footerDemandsCustomVariable,
} from "../extensions/zentui/custom-variable-demand";
import type { GithubExec } from "../extensions/zentui/github-status";
import { HostProjectChanges } from "../extensions/zentui/host-project-changes";
import { LiveMetadataController } from "../extensions/zentui/live-metadata";
import {
	editorHostReferences,
	footerHostReferences,
	liveMetadataDemand,
} from "../extensions/zentui/live-metadata-demand";

const owned = { editor: true, footer: true, workingLine: true };
const context = { cwd: "/project", scopeKey: "one" };
const head = "a".repeat(40);
const controllers: LiveMetadataController[] = [];
async function settle() {
	for (let i = 0; i < 100; i++) await Promise.resolve();
}
function fixture(githubNow?: () => number) {
	let now = 0;
	const state = {
		head,
		number: 42,
		fail: false,
		identityFailure: false,
		prResponse: undefined as Promise<Awaited<ReturnType<GithubExec>>> | undefined,
	};
	const exec = vi.fn<GithubExec>(async (command, args) => {
		const result = (stdout: string) => ({ code: 0, stdout });
		if (command === "git") {
			if (args[1] === "--show-toplevel")
				return state.identityFailure
					? { code: 1, stdout: "" }
					: result("/project\n/project/.git\n");
			if (args[0] === "symbolic-ref") return result("feature\n");
			if (args[0] === "remote") return result("origin\tgit@github.com:owner/project.git (fetch)\n");
			if (args[1] === "--verify") return result(state.head);
		}
		if (command === "gh" && args[0] === "repo")
			return result(
				JSON.stringify({
					nameWithOwner: "owner/project",
					url: "https://github.com/owner/project",
					defaultBranchRef: { name: "main" },
				}),
			);
		if (command === "gh" && args[0] === "pr")
			return (
				state.prResponse ??
				(state.fail
					? { code: 1, stdout: "" }
					: result(
							JSON.stringify({
								number: state.number,
								url: `https://github.com/owner/project/pull/${state.number}`,
								headRefOid: head,
								state: "OPEN",
								statusCheckRollup: [
									{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
								],
							}),
						))
			);
		throw new Error("unexpected fixture command");
	});
	const onRate = vi.fn();
	const repaint = vi.fn();
	const ownership = vi.fn();
	const controller = new LiveMetadataController(
		exec,
		onRate,
		repaint,
		ownership,
		() => now,
		githubNow ?? (() => now),
	);
	controllers.push(controller);
	const rate = () => {
		controller.startAgent(true);
		controller.startResponse();
		now = 100;
		controller.rate.messageUpdate({ role: "assistant", usage: { input: 10, output: 10 } });
		now = 600;
		controller.rate.messageUpdate({ role: "assistant", usage: { input: 10, output: 30 } });
		controller.rateChanged();
	};
	return {
		controller,
		exec,
		state,
		onRate,
		repaint,
		ownership,
		rate,
		time: (at: number) => {
			now = at;
		},
		gh: () => exec.mock.calls.filter(([cmd]) => cmd === "gh"),
	};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	for (const c of controllers.splice(0)) c.dispose();
	expect(vi.getTimerCount()).toBe(0);
	vi.useRealTimers();
});

describe("live metadata effective owner demand", () => {
	it("demands rate for the default Working line and releases it on opt-out", () => {
		const config = mergeConfig({});
		expect(config.components.workingLine.enabled).toBe(true);
		expect(config.components.workingLine.segments.tokenRate).toBe(true);
		expect(liveMetadataDemand(config, owned)).toEqual({ github: false, tokenRate: true });
		config.components.workingLine.enabled = false;
		expect(liveMetadataDemand(config, owned)).toEqual({ github: false, tokenRate: false });
	});
	it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
		"honors effective references, ownership and ci aliases in %s",
		(style) => {
			const config = mergeConfig({
				components: {
					editor: {
						style,
						styles: {
							[style]:
								style === "minimalist"
									? { formats: { topMiddle: "($ci)( $token_rate)" } }
									: { metadataFormat: "($ci)( $token_rate)" },
						},
					},
					footer: { style: "native" },
					workingLine: { enabled: false },
				},
			});
			expect(liveMetadataDemand(config, owned)).toEqual({ github: true, tokenRate: true });
			expect(liveMetadataDemand(config, { ...owned, editor: false })).toEqual({
				github: false,
				tokenRate: false,
			});
			config.components.editor.styles[style].variables = { ci: "pkg/build" };
			expect(editorHostReferences(config).has("ci")).toBe(false);
			expect(editorDemandsCustomVariable(config, "pkg/build")).toBe(true);
			expect(liveMetadataDemand(config, owned)).toEqual({ github: false, tokenRate: true });
			config.components.editor.styles[style].variables = { ci: "bad key" };
			expect(editorHostReferences(config).has("ci")).toBe(true);
			config.components.editor.enabled = false;
			expect(liveMetadataDemand(config, owned).github).toBe(false);
		},
	);
	it("merges wide and enabled compact references with style-local alias precedence", () => {
		const config = mergeConfig({
			components: {
				editor: { enabled: false },
				workingLine: { enabled: false },
				footer: {
					style: "starship",
					styles: {
						starship: { format: "$cwd", compactFormat: "(CI: $ci) $token_rate", responsive: true },
					},
				},
			},
		});
		expect(liveMetadataDemand(config, owned)).toEqual({ github: true, tokenRate: true });
		config.components.footer.styles.starship.variables = { ci: "pkg/build" };
		expect(footerHostReferences(config).has("ci")).toBe(false);
		expect(footerDemandsCustomVariable(config, "pkg/build")).toBe(true);
		expect(liveMetadataDemand(config, owned).github).toBe(false);
		config.components.footer.styles.starship.responsive = false;
		expect(liveMetadataDemand(config, owned).tokenRate).toBe(false);
		config.components.footer.style = "native";
		expect(footerHostReferences(config).size).toBe(0);
	});
	it("keeps Working rate independent and preserves OMP-native rate", () => {
		const config = mergeConfig({
			components: {
				editor: { enabled: false },
				footer: { style: "native" },
				workingLine: { enabled: true },
			},
		});
		expect(liveMetadataDemand(config, owned)).toEqual({ github: false, tokenRate: true });
		expect(liveMetadataDemand(config, { ...owned, workingLine: false }).tokenRate).toBe(false);
		expect(liveMetadataDemand(config, owned, false).tokenRate).toBe(false);
		config.components.workingLine.segments.tokenRate = false;
		expect(liveMetadataDemand(config, owned).tokenRate).toBe(false);
	});
	it("unsupported and accent-rail surfaces leave independent Working rate demand intact", () => {
		for (const style of ["future-style", "accent-rail"]) {
			const config = mergeConfig({
				components: {
					editor: { style, styles: { opencode: { metadataFormat: "$ci" } } },
					footer: { style: "future-style", styles: { starship: { format: "$pr_number" } } },
				},
			});
			expect(liveMetadataDemand(config, owned)).toEqual({ github: false, tokenRate: true });
			expect(liveMetadataDemand(config, { ...owned, workingLine: false })).toEqual({
				github: false,
				tokenRate: false,
			});
		}
	});
});

describe("live metadata passive snapshot and scheduler", () => {
	it("does no I/O until demanded, defers start out of render, shares the snapshot, and filters owner names", async () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: false });
		expect(f.controller.read(new Set(["ci"]))).toEqual({});
		expect(f.exec).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		f.controller.reconcile(context, { github: true, tokenRate: false });
		expect(f.exec).not.toHaveBeenCalled();
		await settle();
		expect(f.controller.read(new Set(["ci", "pr_number"]))).toEqual({
			ci: "CI passing",
			pr_number: "42",
		});
		const calls = f.exec.mock.calls.length;
		for (let i = 0; i < 10; i++)
			expect(f.controller.read(new Set(["pr_url"]))).toEqual({
				pr_url: "https://github.com/owner/project/pull/42",
			});
		expect(f.exec).toHaveBeenCalledTimes(calls);
		expect(f.gh()).toHaveLength(2);
		f.controller.reconcile(context, { github: false, tokenRate: false });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.exec).toHaveBeenCalledTimes(calls);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("verifies identity each poll, reuses five-minute repo metadata, and suppresses changed-head CI", async () => {
		const f = fixture();
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		f.time(30_001);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(f.ownership).toHaveBeenCalledOnce();
		expect(f.gh()).toHaveLength(3);
		f.state.head = "b".repeat(40);
		f.time(60_001);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(f.controller.read(new Set(["ci"]))).toEqual({ ci: "CI stale" });
	});
	it("clears on observed tool/project changes and context generations", async () => {
		const f = fixture();
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		f.state.fail = true;
		f.controller.invalidateProject();
		expect(f.controller.read(new Set(["ci"]))).toEqual({});
		await settle();
		expect(f.controller.read(new Set(["ci"]))).toEqual({});
		f.controller.reconcile({ ...context, scopeKey: "two" }, { github: true, tokenRate: false });
		expect(f.controller.read(new Set(["pr_number"]))).toEqual({});
	});
	it("cancels a queued start on demand loss or shutdown and cannot resurrect timers", async () => {
		for (const action of ["release", "dispose"] as const) {
			const f = fixture();
			f.controller.reconcile(context, { github: true, tokenRate: false });
			if (action === "release")
				f.controller.reconcile(context, { github: false, tokenRate: false });
			else f.controller.dispose();
			await settle();
			expect(f.exec).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
			if (action === "dispose") {
				f.controller.reconcile(context, { github: true, tokenRate: true });
				f.controller.setStreaming(true);
				expect(vi.getTimerCount()).toBe(0);
			}
		}
	});
	it("keeps Working live rate stable across chunk gaps, separate from the completed average", async () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: true });
		expect(vi.getTimerCount()).toBe(0);
		f.rate();
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
		const calls = f.repaint.mock.calls.length;
		f.controller.rate.messageUpdate({ role: "assistant", usage: { input: 10, output: 30 } });
		f.controller.rateChanged();
		expect(f.repaint).toHaveBeenCalledTimes(calls);
		f.time(2601);
		expect(f.controller.rate.snapshot()).toBeUndefined();
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
		await vi.advanceTimersByTimeAsync(250);
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		expect(f.repaint).toHaveBeenCalledTimes(calls);
		f.controller.suspendRate();
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
		expect(vi.getTimerCount()).toBe(0);
	});
	it("separates completed average from Working live rate and never spikes live on final correction", () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: true });
		f.rate();
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
		f.time(4000);
		const final = { role: "assistant", usage: { input: 10, output: 120 } };
		const accepted = {
			status: "accepted" as const,
			source: "final" as const,
			tokens: { input: 10, output: 120 },
			displayTokens: { input: 10, output: 120, outputApproximate: false },
		};
		const calls = f.onRate.mock.calls.length;
		f.controller.endResponse(final, accepted);
		expect(f.onRate.mock.calls.slice(calls)).toEqual([]);
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "30 tok/s avg" });
		expect(vi.getTimerCount()).toBe(0);
		f.time(14000);
		f.controller.startResponse();
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "30 tok/s avg" });
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		f.time(14500);
		f.controller.endResponse(final, { status: "duplicate" });
		f.controller.endResponse(final, { status: "rejected" });
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		f.time(16000);
		f.controller.endResponse(
			{ ...final, usage: { input: 10, output: 180 } },
			{
				...accepted,
				tokens: { input: 20, output: 300 },
			},
		);
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "50 tok/s avg" });
		expect(vi.getTimerCount()).toBe(0);
	});
	it("holds across continuation/retry runs and replaces only with a fresh usable live sample", () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: true });
		f.rate();
		f.controller.suspendRate();
		f.time(10_000);
		f.controller.startAgent(false);
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		f.controller.startResponse();
		f.controller.updateResponse({ role: "assistant", usage: { input: 10, output: 10 } });
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		f.time(10_600);
		f.controller.updateResponse({ role: "assistant", usage: { input: 10, output: 70 } });
		expect(f.onRate).toHaveBeenLastCalledWith("100 tok/s");
		f.controller.suspendRate();
		f.controller.startAgent(false);
		f.controller.startResponse();
		expect(f.onRate).toHaveBeenLastCalledWith("100 tok/s");
		f.controller.suspendRate();
		f.controller.startAgent(true);
		expect(f.onRate).toHaveBeenLastCalledWith("— tok/s");
		f.controller.startResponse();
		f.controller.updateResponse({ role: "assistant", usage: { input: 10, output: 1 } });
		f.controller.endResponse(
			{ role: "assistant", usage: { input: 10, output: 999 } },
			{
				status: "accepted",
				source: "final",
				tokens: { input: 10, output: 999 },
				displayTokens: { input: 10, output: 999, outputApproximate: false },
			},
		);
		expect(f.onRate).toHaveBeenLastCalledWith("— tok/s");
		expect(vi.getTimerCount()).toBe(0);
		f.controller.startResponse();
		expect(f.onRate).toHaveBeenLastCalledWith("— tok/s");
	});
	it("repaints changed completed average on partition even with unchanged Working text", () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: true });
		const final = (output: number) =>
			f.controller.endResponse(
				{ role: "assistant", usage: { input: 10, output } },
				{
					status: "accepted",
					source: "final",
					tokens: { input: 10, output },
					displayTokens: { input: 10, output, outputApproximate: false },
				},
			);
		f.controller.startAgent(true);
		f.controller.startResponse();
		f.time(4000);
		final(120);
		f.controller.startAgent(false);
		f.time(14000);
		f.controller.startResponse();
		f.time(16000);
		final(180);
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "50 tok/s avg" });
		const repaints = f.repaint.mock.calls.length;
		const rateCalls = f.onRate.mock.calls.length;
		f.controller.partitionRates();
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "90 tok/s avg" });
		expect(f.repaint).toHaveBeenCalledTimes(repaints + 1);
		expect(f.onRate).toHaveBeenCalledTimes(rateCalls);
		f.controller.partitionRates();
		expect(f.repaint).toHaveBeenCalledTimes(repaints + 1);
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each([40, 100])(
		"preserves a surviving run's fresh %s tok/s sample and polling across Working partition",
		(tokensPerSecond) => {
			const f = fixture();
			f.controller.reconcile(context, { github: false, tokenRate: true });
			f.rate();
			f.controller.suspendRate();
			f.controller.startAgent(false);
			f.controller.startResponse();
			f.controller.updateResponse({ role: "assistant", usage: { input: 10, output: 10 } });
			f.time(1100);
			f.controller.updateResponse({
				role: "assistant",
				usage: { input: 10, output: 10 + tokensPerSecond / 2 },
			});
			const sample = f.controller.rate.snapshot();
			expect(sample?.tokensPerSecond).toBe(tokensPerSecond);
			const average = f.controller.read(new Set(["token_rate"]));
			const calls = f.onRate.mock.calls.length;
			f.controller.partitionRates();
			expect(f.controller.rate.snapshot()).toEqual(sample);
			expect(f.onRate).toHaveBeenLastCalledWith(`${tokensPerSecond} tok/s`);
			expect(f.onRate).toHaveBeenCalledTimes(calls);
			expect(f.controller.read(new Set(["token_rate"]))).toEqual(average);
			expect(vi.getTimerCount()).toBe(1);
		},
	);
	it("never substitutes live rate for the average and an unclosed call leaves it unknown", () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: true });
		f.rate();
		f.controller.suspendRate();
		f.time(1000);
		f.controller.startResponse();
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		f.controller.rate.messageUpdate({ role: "assistant", usage: { input: 10, output: 1 } });
		f.controller.rateChanged();
		f.time(1100);
		const final = { role: "assistant", usage: { input: 10, output: 1000 } };
		f.controller.endResponse(final, {
			status: "accepted",
			source: "final",
			tokens: { input: 20, output: 1030 },
			displayTokens: { input: 20, output: 1030, outputApproximate: false },
		});
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
		expect(f.onRate).toHaveBeenLastCalledWith("40 tok/s");
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each(["scope", "cwd", "demand", "reset", "resetRate", "dispose"] as const)(
		"clears retained state and timers on %s without resurrecting disabled samples",
		(action) => {
			const f = fixture();
			f.controller.reconcile(context, { github: false, tokenRate: true });
			f.rate();
			if (action === "scope" || action === "cwd")
				f.controller.reconcile(
					{ ...context, [action === "scope" ? "scopeKey" : "cwd"]: "other" },
					{ github: false, tokenRate: true },
				);
			else if (action === "demand")
				f.controller.reconcile(context, { github: false, tokenRate: false });
			else f.controller[action]();
			expect(f.controller.read(new Set(["token_rate"]))).toEqual({});
			expect(f.onRate).toHaveBeenLastCalledWith(action === "dispose" ? "40 tok/s" : "");
			expect(vi.getTimerCount()).toBe(0);
			if (action === "demand") {
				f.controller.rate.messageUpdate({ role: "assistant", usage: { input: 10, output: 200 } });
				f.controller.reconcile(context, { github: false, tokenRate: true });
				expect(f.controller.read(new Set(["token_rate"]))).toEqual({});
				f.time(1000);
				f.controller.startResponse();
				expect(f.onRate).toHaveBeenLastCalledWith("— tok/s");
				expect(f.controller.read(new Set(["token_rate"]))).toEqual({ token_rate: "— tok/s avg" });
			}
		},
	);
	it("preserves native OMP token rate, quota, modes and unrelated host values", async () => {
		const f = fixture();
		f.controller.reconcile(context, { github: true, tokenRate: true });
		await settle();
		f.rate();
		const values = f.controller.read(
			new Set(["token_rate", "usage_quota", "plan_mode", "pr_number", "ci"]),
			{
				token_rate: "native 80/s",
				usage_quota: "quota",
				plan_mode: "plan",
				pr_number: "old",
				ci: "old-green",
			},
		);
		expect(values).toEqual({
			token_rate: "native 80/s",
			usage_quota: "quota",
			plan_mode: "plan",
			pr_number: "42",
			ci: "CI passing",
		});
	});
	it("rechecks ownership on active-only rate ticks and promptly stops after loss", async () => {
		const f = fixture();
		f.controller.reconcile(context, { github: false, tokenRate: true });
		f.rate();
		f.ownership.mockImplementation(() =>
			f.controller.reconcile(context, { github: false, tokenRate: false }),
		);
		await vi.advanceTimersByTimeAsync(250);
		expect(vi.getTimerCount()).toBe(0);
		expect(f.controller.read(new Set(["token_rate"]))).toEqual({});
	});
});

it("invalidates observed host branches synchronously but coalesces refresh outside render", async () => {
	const f = fixture();
	const changes = new HostProjectChanges();
	const unsubscribe = changes.subscribe(() => f.controller.invalidateProject());
	f.controller.reconcile(context, { github: true, tokenRate: false });
	await settle();
	expect(f.controller.read(new Set(["ci"]))).toEqual({ ci: "CI passing" });
	const calls = f.exec.mock.calls.length;
	changes.notify();
	changes.notify();
	changes.notify();
	expect(f.controller.read(new Set(["ci", "pr_number"]))).toEqual({});
	expect(f.exec).toHaveBeenCalledTimes(calls);
	await settle();
	expect(f.gh()).toHaveLength(4);
	unsubscribe();
	changes.notify();
	expect(f.controller.read(new Set(["ci"]))).toEqual({ ci: "CI passing" });
	changes.dispose();
});
it("is runtime-local, exception-isolated and suppresses removed listeners even during delivery", () => {
	const one = new HostProjectChanges();
	const two = new HostProjectChanges();
	const listener = vi.fn();
	const other = vi.fn();
	let unsubscribe = () => {};
	one.subscribe(() => {
		unsubscribe();
		throw new Error("closed owner");
	});
	unsubscribe = one.subscribe(listener);
	one.subscribe(other);
	two.subscribe(listener);
	one.notify();
	expect(listener).not.toHaveBeenCalled();
	expect(other).toHaveBeenCalledOnce();
	two.notify();
	expect(listener).toHaveBeenCalledOnce();
	one.dispose();
	one.subscribe(listener);
	one.notify();
	expect(listener).toHaveBeenCalledOnce();
	two.dispose();
});

function deferredPr() {
	let resolve!: (result: Awaited<ReturnType<GithubExec>>) => void;
	const promise = new Promise<Awaited<ReturnType<GithubExec>>>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
function passingPr() {
	return {
		code: 0,
		stdout: JSON.stringify({
			number: 42,
			url: "https://github.com/owner/project/pull/42",
			headRefOid: head,
			state: "OPEN",
			statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
		}),
	};
}

describe("completion/expiry-aware GitHub refresh", () => {
	it("aligns delayed initial and follow-up fetches to expiry and repaints stale before waiting", async () => {
		vi.setSystemTime(0);
		const f = fixture(() => Date.now());
		const initial = deferredPr();
		f.state.prResponse = initial.promise;
		const rendered: Array<{ at: number; ci?: string }> = [];
		f.repaint.mockImplementation(() =>
			rendered.push({ at: Date.now(), ci: f.controller.read(new Set(["ci"])).ci }),
		);
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		expect(f.gh()).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1000);
		initial.resolve(passingPr());
		f.state.prResponse = undefined;
		await settle();
		expect(rendered.at(-1)).toEqual({ at: 1000, ci: "CI passing" });
		const followup = deferredPr();
		f.state.prResponse = followup.promise;
		await vi.advanceTimersByTimeAsync(29_999);
		expect(f.gh()).toHaveLength(2);
		expect(rendered.at(-1)?.ci).toBe("CI passing");
		await vi.advanceTimersByTimeAsync(1);
		expect(f.gh()).toHaveLength(3); // PR refresh at 31s, not a cache-only poll at 30s.
		expect(rendered.at(-1)).toEqual({ at: 31_000, ci: "CI stale" });
		const calls = f.exec.mock.calls.length;
		f.controller.read(new Set(["ci"]));
		expect(f.exec).toHaveBeenCalledTimes(calls);
		await vi.advanceTimersByTimeAsync(5000);
		followup.resolve(passingPr());
		f.state.prResponse = undefined;
		await settle();
		expect(rendered.at(-1)).toEqual({ at: 36_000, ci: "CI passing" });
		await vi.advanceTimersByTimeAsync(29_999);
		expect(f.gh()).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(1);
		expect(f.gh()).toHaveLength(4);
		expect(rendered).toContainEqual({ at: 66_000, ci: "CI stale" });
		expect(
			f.exec.mock.calls.filter(([command, args]) => command === "gh" && args[0] === "repo"),
		).toHaveLength(1);
	});
	it("schedules delayed negative results from completion, clears stale success and retries without spinning", async () => {
		vi.setSystemTime(0);
		const f = fixture(() => Date.now());
		let rendered: string | undefined;
		f.repaint.mockImplementation(() => {
			rendered = f.controller.read(new Set(["ci"])).ci;
		});
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		const failure = deferredPr();
		f.state.prResponse = failure.promise;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(rendered).toBe("CI stale");
		await vi.advanceTimersByTimeAsync(1000);
		failure.resolve({ code: 1, stdout: "" });
		f.state.prResponse = undefined;
		await settle();
		expect(rendered).toBeUndefined();
		expect(f.gh()).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(29_999);
		expect(f.gh()).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(1);
		expect(f.gh()).toHaveLength(4);
		expect(rendered).toBe("CI passing");
	});
	it("uses the base retry cadence for identity failures without an expiry", async () => {
		vi.setSystemTime(0);
		const f = fixture(() => Date.now());
		f.state.identityFailure = true;
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		const calls = f.exec.mock.calls.length;
		await vi.advanceTimersByTimeAsync(29_999);
		expect(f.exec).toHaveBeenCalledTimes(calls);
		await vi.advanceTimersByTimeAsync(1);
		expect(f.exec).toHaveBeenCalledTimes(calls * 2);
		expect(f.gh()).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(1);
	});
	it.each(["loss", "reset", "dispose", "context"] as const)(
		"cancels delayed follow-up work and never rearms after %s",
		async (action) => {
			vi.setSystemTime(0);
			const f = fixture(() => Date.now());
			f.controller.reconcile(context, { github: true, tokenRate: false });
			await settle();
			const followup = deferredPr();
			f.state.prResponse = followup.promise;
			await vi.advanceTimersByTimeAsync(30_000);
			const signal = f.exec.mock.calls
				.filter(([command, args]) => command === "gh" && args[0] === "pr")
				.at(-1)?.[2].signal;
			const calls = f.exec.mock.calls.length;
			if (action === "loss") f.controller.reconcile(context, { github: false, tokenRate: false });
			else if (action === "reset") f.controller.reset();
			else if (action === "dispose") f.controller.dispose();
			else
				f.controller.reconcile(
					{ ...context, scopeKey: "replacement" },
					{ github: false, tokenRate: false },
				);
			expect(signal?.aborted).toBe(true);
			followup.resolve(passingPr());
			await settle();
			expect(f.controller.read(new Set(["ci"]))).toEqual({});
			expect(vi.getTimerCount()).toBe(0);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(f.exec).toHaveBeenCalledTimes(calls);
		},
	);
	it("drops an aborted delayed initial completion and coalesces a fresh generation", async () => {
		vi.setSystemTime(0);
		const f = fixture(() => Date.now());
		const initial = deferredPr();
		f.state.prResponse = initial.promise;
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		f.controller.reset();
		expect(vi.getTimerCount()).toBe(0);
		f.state.prResponse = undefined;
		f.controller.reconcile(
			{ ...context, scopeKey: "replacement" },
			{ github: true, tokenRate: false },
		);
		await settle();
		initial.resolve(passingPr());
		await settle();
		expect(vi.getTimerCount()).toBe(1);
		const calls = f.gh().length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(f.gh()).toHaveLength(calls + 1);
	});
	it("checks ownership at expiry and cancels the expired timer before doing unused work", async () => {
		vi.setSystemTime(0);
		const f = fixture(() => Date.now());
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		const calls = f.exec.mock.calls.length;
		f.ownership.mockImplementation(() =>
			f.controller.reconcile(context, { github: false, tokenRate: false }),
		);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(f.exec).toHaveBeenCalledTimes(calls);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does not rearm expiry work from an unsubscribed owner's queued branch invalidation", async () => {
		vi.setSystemTime(0);
		const f = fixture(() => Date.now());
		const changes = new HostProjectChanges();
		const unsubscribe = changes.subscribe(() => f.controller.invalidateProject());
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		const calls = f.exec.mock.calls.length;
		changes.notify();
		changes.notify();
		unsubscribe();
		f.controller.reset();
		changes.notify();
		await settle();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(f.exec).toHaveBeenCalledTimes(calls);
		expect(vi.getTimerCount()).toBe(0);
		changes.dispose();
	});
});

it("ignores a retired expiry callback without losing the replacement timer handle", async () => {
	vi.setSystemTime(0);
	const timers = vi.spyOn(globalThis, "setTimeout");
	try {
		const f = fixture(() => Date.now());
		f.controller.reconcile(context, { github: true, tokenRate: false });
		await settle();
		const retired = timers.mock.calls.find(([, delay]) => delay === 30_000)?.[0] as
			| (() => void)
			| undefined;
		if (!retired) throw new Error("missing expiry timer");
		f.controller.invalidateProject();
		await settle();
		expect(vi.getTimerCount()).toBe(1);
		const calls = f.exec.mock.calls.length;
		const repaints = f.repaint.mock.calls.length;
		retired();
		await settle();
		expect(f.exec).toHaveBeenCalledTimes(calls);
		expect(f.repaint).toHaveBeenCalledTimes(repaints);
		f.controller.reset();
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		timers.mockRestore();
	}
});
