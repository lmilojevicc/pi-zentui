import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState, modelLabelFor, syncState } from "../extensions/zentui/state";

function makeCtx(model: unknown) {
	return {
		model,
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => undefined,
	} as unknown as ExtensionContext;
}

const model = { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai" };

describe("syncState model label", () => {
	it("retains raw model fields and formats independent label sources", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx(model), "");
		expect(state.modelId).toBe("gpt-5.6-terra");
		expect(state.modelName).toBe("GPT-5.6 Terra");
		expect(state.modelLabel).toBe("gpt-5.6-terra");
		expect(modelLabelFor(state, "id")).toBe("gpt-5.6-terra");
		expect(modelLabelFor(state, "name")).toBe("GPT-5.6 Terra");
	});

	it("falls back to the id when the name is empty", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx({ ...model, name: "" }), "");
		expect(modelLabelFor(state, "name")).toBe("gpt-5.6-terra");
		expect(state.modelName).toBe("");
	});

	it("shows no-model when there is no active model and clears raw fields", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx(undefined), "");
		expect(modelLabelFor(state, "name")).toBe("no-model");
		expect(modelLabelFor(state, "id")).toBe("no-model");
		expect(state.modelId).toBe("");
		expect(state.modelName).toBe("");
		expect(state.modelLabel).toBe("no-model");
	});

	it("stores cache atoms and clears optional markers on later synchronization", () => {
		const entry = {
			type: "message",
			message: {
				role: "assistant",
				usage: {
					input: 100,
					output: 20,
					cacheRead: 1_200,
					cacheWrite: 300,
					cost: { total: 1 },
				},
			},
		};
		const ctx = {
			...makeCtx(model),
			sessionManager: { getBranch: () => [entry], getEntries: () => [entry] },
		};
		const state = createInitialState(emptyGitStatus());

		syncState(state, ctx as never, "", {
			subscription: true,
			autoCompaction: true,
		});
		expect(state).toMatchObject({
			cacheReadLabel: "R1.2k",
			cacheWriteLabel: "W300",
			subscription: true,
			autoCompaction: true,
		});
		expect(state.tokenLabel).not.toContain("R1.2k");

		syncState(state, makeCtx(model), "", {});
		expect(state).toMatchObject({
			cacheReadLabel: "",
			cacheWriteLabel: "",
			subscription: false,
			autoCompaction: false,
		});
	});
});
