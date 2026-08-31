import { describe, expect, it } from "vitest";
import {
	parseThinkingSteps,
	THINKING_STEPS_MAX_INPUT_LENGTH,
	THINKING_STEPS_MAX_LABEL_LENGTH,
	THINKING_STEPS_MAX_STEPS,
} from "../extensions/zentui/thinking-steps";

describe("Thinking-step structural parser", () => {
	it("derives headings, top-level lists, and prose while retaining bodies", () => {
		expect(
			parseThinkingSteps(
				"# Inspect\nbody\n\n- Check API\n  - nested body\n\nProse label\nprose body",
			),
		).toEqual([
			{ number: 1, label: "Inspect", body: "body" },
			{ number: 2, label: "Check API", body: "  - nested body" },
			{ number: 3, label: "Prose label", body: "prose body" },
		]);
	});

	it("keeps fences, Mermaid, display math, and nested structure opaque", () => {
		const source = [
			"# Analyze",
			"```mermaid",
			"# hidden",
			"```",
			"$$",
			"- hidden",
			"$$",
			"  1. nested",
			"# Done",
		].join("\n");
		const steps = parseThinkingSteps(source);
		expect(steps?.map((step) => step.label)).toEqual(["Analyze", "Done"]);
		expect(steps?.[0]?.body).toContain("```mermaid\n# hidden\n```");
		expect(steps?.[0]?.body).toContain("$$\n- hidden\n$$");
	});

	it.each([
		"",
		"\x1b]0;owned\x07",
		"```\n# unterminated",
		"$$\nvalue",
		"> unsupported quote\n# Later",
		"  orphan\n# Later",
		"# tab\tlabel",
	])("fails open for malformed or unsafe input", (source) => {
		expect(parseThinkingSteps(source)).toBeUndefined();
	});

	it("normalizes CRLF and enforces inclusive parser bounds", () => {
		expect(parseThinkingSteps("# One\r\nbody\r\n# Two")?.map((step) => step.label)).toEqual([
			"One",
			"Two",
		]);
		const exactInput = `Intro\n${"x".repeat(THINKING_STEPS_MAX_INPUT_LENGTH - 6)}`;
		expect(parseThinkingSteps(exactInput)).toHaveLength(1);
		expect(parseThinkingSteps(`${exactInput}x`)).toBeUndefined();
		expect(parseThinkingSteps(`# ${"a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH)}`)).toHaveLength(1);
		expect(
			parseThinkingSteps(`# ${"a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH + 1)}`),
		).toBeUndefined();
		const exactSteps = Array.from(
			{ length: THINKING_STEPS_MAX_STEPS },
			(_, index) => `# Step ${index}`,
		).join("\n");
		expect(parseThinkingSteps(exactSteps)).toHaveLength(THINKING_STEPS_MAX_STEPS);
		expect(parseThinkingSteps(`${exactSteps}\n# overflow`)).toBeUndefined();
	});
});
