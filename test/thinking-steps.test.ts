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

	it("strips SGR around structural Markdown before parsing", () => {
		const plain = "# Inspect\nbody\n\n- Check API\n  nested\n\nProse label\nprose body";
		const sgr = "\x1b[38;2;137;180;250m";
		const muted = "\x1b[38;2;186;194;222m";
		const reset = "\x1b[39m";
		const decorated = `${sgr}#${reset} ${muted}Inspect${reset}\n${sgr}body${reset}\n\n${muted}-${reset} Check API\n  ${sgr}nested${reset}\n\n${muted}Prose label${reset}\n${sgr}prose body${reset}`;
		const expected = parseThinkingSteps(plain);
		const actual = parseThinkingSteps(decorated);
		expect(actual).toEqual(expected);
		for (const step of actual ?? []) {
			expect(`${step.label}\n${step.body}`).not.toMatch(/[\x1b\x80-\x9f]/);
		}
	});

	it("strips complete SGR at every source boundary without changing steps", () => {
		const source = "# One\nbody\n\n- Two\n  nested";
		const expected = parseThinkingSteps(source);
		for (let index = 0; index <= source.length; index += 1) {
			const decorated = `${source.slice(0, index)}\x1b[38:5:202m${source.slice(index)}`;
			expect(parseThinkingSteps(decorated), `SGR boundary ${index}`).toEqual(expected);
		}
	});

	it("rejects a non-SGR control at every source boundary", () => {
		const source = "# One\nbody\n\n# Two";
		for (let index = 0; index <= source.length; index += 1) {
			const unsafe = `${source.slice(0, index)}\x1b[2J${source.slice(index)}`;
			expect(parseThinkingSteps(unsafe), `control boundary ${index}`).toBeUndefined();
		}
	});

	it.each([
		"\x1b[31m\x1b[0m",
		"# Safe \x1b[31mstyle\x1b[0m\x1b[2J",
		"# Safe \x1b[31mstyle\x1b[0m\x1b]8;;https://example.test\x07link\x1b]8;;\x07",
	])("fails open for SGR-only or mixed unsafe input", (source) => {
		expect(parseThinkingSteps(source)).toBeUndefined();
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
		const decoratedPrefix = "# A\n\x1b[31m";
		const decoratedSuffix = "\x1b[0m";
		const decoratedExact = `${decoratedPrefix}${"a".repeat(THINKING_STEPS_MAX_INPUT_LENGTH - decoratedPrefix.length - decoratedSuffix.length)}${decoratedSuffix}`;
		expect(decoratedExact).toHaveLength(THINKING_STEPS_MAX_INPUT_LENGTH);
		expect(parseThinkingSteps(decoratedExact)).toHaveLength(1);
		expect(parseThinkingSteps(`${decoratedExact}x`)).toBeUndefined();
		expect(
			parseThinkingSteps(
				`# \x1b[38;2;137;180;250m${"a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH)}\x1b[39m`,
			),
		).toHaveLength(1);
		expect(
			parseThinkingSteps(
				`# \x1b[38;2;137;180;250m${"a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH + 1)}\x1b[39m`,
			),
		).toBeUndefined();
		const exactSteps = Array.from(
			{ length: THINKING_STEPS_MAX_STEPS },
			(_, index) => `# Step ${index}`,
		).join("\n");
		expect(parseThinkingSteps(exactSteps)).toHaveLength(THINKING_STEPS_MAX_STEPS);
		expect(parseThinkingSteps(`${exactSteps}\n# overflow`)).toBeUndefined();
	});
});
