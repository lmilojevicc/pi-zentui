import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { EventUsageTotalsController, getUsageTotals } from "../extensions/zentui/format";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState, syncState } from "../extensions/zentui/state";

function harness() {
	const usage = { input: 10, output: 2, cacheRead: 30, cacheWrite: 5, cost: { total: 1 } };
	const entries = [{ type: "message", id: "one", message: { role: "assistant", usage } }];
	const identity = { session: "session", leaf: "one" as string | null };
	const manager = {
		getSessionId: vi.fn(() => identity.session),
		getLeafId: vi.fn(() => identity.leaf),
		getEntries: vi.fn(() => [...entries]),
		getBranch: vi.fn(() => entries.slice(-1)),
	};
	const ctx = {
		sessionManager: manager,
		getContextUsage: () => undefined,
	} as unknown as ExtensionContext;
	return { ctx, manager, entries, identity, usage, controller: new EventUsageTotalsController() };
}

describe("EventUsageTotalsController", () => {
	it("reuses one immutable snapshot without reading entries or usage on unchanged syncs", () => {
		const h = harness();
		const input = vi.fn(() => 10);
		Object.defineProperty(h.usage, "input", { get: input });
		const first = h.controller.resolve(h.ctx, true);
		for (let i = 0; i < 100; i++) expect(h.controller.resolve(h.ctx, true)).toBe(first);
		expect(h.manager.getEntries).toHaveBeenCalledTimes(1);
		expect(input).toHaveBeenCalledTimes(1);
		expect(Object.isFrozen(first)).toBe(true);
	});

	it("invalidates explicitly for same-leaf in-place edits and middle replacements", () => {
		const h = harness();
		const first = h.controller.resolve(h.ctx, true);
		h.usage.input = 25;
		// Leaf identity is deliberately not advertised as arbitrary mutation detection.
		expect(h.controller.resolve(h.ctx, true)).toBe(first);
		expect(getUsageTotals(h.ctx).input).toBe(25);
		h.controller.invalidate();
		expect(h.controller.resolve(h.ctx, true).input).toBe(25);
		h.entries[0] = {
			...h.entries[0],
			message: { role: "toolResult", usage: { ...h.usage, input: 50 } },
		};
		h.controller.invalidate();
		expect(h.controller.resolve(h.ctx, true).input).toBe(50);
	});

	it("refreshes on manager/session/leaf changes, including empty null leaf and A→B→A", () => {
		const h = harness();
		h.entries.length = 0;
		h.identity.leaf = null;
		expect(h.controller.resolve(h.ctx, true).input).toBe(0);
		h.controller.resolve(h.ctx, true);
		expect(h.manager.getEntries).toHaveBeenCalledTimes(1);
		h.entries.push({
			type: "message",
			id: "first",
			message: { role: "assistant", usage: h.usage },
		});
		h.identity.leaf = "first";
		expect(h.controller.resolve(h.ctx, true).input).toBe(10);
		h.identity.session = "replacement";
		h.usage.input = 20;
		expect(h.controller.resolve(h.ctx, true).input).toBe(20);
		const other = harness();
		expect(h.controller.resolve(other.ctx, true).input).toBe(10);
		h.usage.input = 30;
		expect(h.controller.resolve(h.ctx, true).input).toBe(30);
		expect(h.manager.getEntries).toHaveBeenCalledTimes(4);
	});

	it("does no history or identity work without demand; reactivation reads fresh usage", () => {
		const h = harness();
		h.controller.resolve(h.ctx, false);
		expect(h.manager.getSessionId).not.toHaveBeenCalled();
		expect(h.manager.getEntries).not.toHaveBeenCalled();
		h.controller.resolve(h.ctx, true);
		expect(h.controller.resolve(h.ctx, false).input).toBe(0);
		h.usage.input = 35;
		expect(h.controller.resolve(h.ctx, true).input).toBe(35);
		expect(h.manager.getEntries).toHaveBeenCalledTimes(2);
	});

	it.each(["missing", "throwing", "invalid-session", "invalid-leaf", "undefined-leaf"])(
		"falls back to mutation-safe reads for %s identity and recovers",
		(mode) => {
			const h = harness();
			h.controller.resolve(h.ctx, true);
			if (mode === "missing") Object.assign(h.manager, { getLeafId: undefined });
			if (mode === "throwing")
				h.manager.getLeafId.mockImplementation(() => {
					throw new Error("unsupported");
				});
			if (mode === "invalid-session") h.identity.session = "";
			if (mode === "invalid-leaf") h.identity.leaf = "";
			if (mode === "undefined-leaf") h.manager.getLeafId.mockReturnValue(undefined as never);
			h.usage.input = 40;
			expect(h.controller.resolve(h.ctx, true).input).toBe(40);
			h.usage.input = 50;
			expect(h.controller.resolve(h.ctx, true).input).toBe(50);
			h.identity.session = "session";
			h.manager.getLeafId = vi.fn(() => "one");
			h.usage.input = 60;
			expect(h.controller.resolve(h.ctx, true).input).toBe(60);
			h.controller.resolve(h.ctx, true);
			expect(h.manager.getEntries).toHaveBeenCalledTimes(4);
		},
	);

	it("retains generic branch-only fallback for older hosts", () => {
		const h = harness();
		Object.assign(h.manager, { getEntries: undefined });
		expect(h.controller.resolve(h.ctx, true).input).toBe(10);
		h.usage.input = 90;
		expect(h.controller.resolve(h.ctx, true).input).toBe(90);
		expect(h.manager.getBranch).toHaveBeenCalledTimes(2);
	});

	it("does not pin a failed history read", () => {
		const h = harness();
		h.controller.resolve(h.ctx, true);
		h.controller.invalidate();
		h.manager.getEntries.mockImplementationOnce(() => {
			throw new Error("read failed");
		});
		expect(() => h.controller.resolve(h.ctx, true)).toThrow("read failed");
		h.usage.input = 70;
		expect(h.controller.resolve(h.ctx, true).input).toBe(70);
	});

	it("syncState accepts event-owned totals but defaults to generic mutation detection", () => {
		const h = harness();
		const state = createInitialState(emptyGitStatus());
		const usageTotals = h.controller.resolve(h.ctx, true);
		h.manager.getEntries.mockClear();
		syncState(state, h.ctx, "", {}, { usageTotals, includeContextLabel: false });
		expect(h.manager.getEntries).not.toHaveBeenCalled();
		expect(state).toMatchObject({
			tokenLabel: "↑10 ↓2 66.7%",
			costLabel: "$1.000",
			cacheReadLabel: "R30",
			cacheWriteLabel: "W5",
		});
		h.usage.input = 100;
		syncState(state, h.ctx, "");
		expect(state.usageTotals.input).toBe(100);
		expect(h.manager.getEntries).toHaveBeenCalledTimes(1);
	});
});
