import { describe, expect, it } from "vitest";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState, syncState } from "../extensions/zentui/state";

function makeCtx(model: unknown) {
	return {
		model,
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => undefined,
	} as never;
}

const model = { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai" };

describe("syncState modelLabel", () => {
	it("shows the model id when modelLabel is 'id' and retains raw model fields", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx(model), "", "id");
		expect(state.modelLabel).toBe("gpt-5.6-terra");
		expect(state.modelId).toBe("gpt-5.6-terra");
		expect(state.modelName).toBe("GPT-5.6 Terra");
	});

	it("shows the model name when modelLabel is 'name'", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx(model), "", "name");
		expect(state.modelLabel).toBe("GPT-5.6 Terra");
	});

	it("falls back to the id when the name is empty without changing the raw name", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx({ ...model, name: "" }), "", "name");
		expect(state.modelLabel).toBe("gpt-5.6-terra");
		expect(state.modelId).toBe("gpt-5.6-terra");
		expect(state.modelName).toBe("");
	});

	it("shows no-model when there is no active model and clears raw fields", () => {
		const state = createInitialState(emptyGitStatus());
		syncState(state, makeCtx(undefined), "", "name");
		expect(state.modelLabel).toBe("no-model");
		expect(state.modelId).toBe("");
		expect(state.modelName).toBe("");
	});
});
