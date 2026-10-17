import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseThinkingSteps,
	parseThinkingStepsResult,
	THINKING_STEPS_MAX_CHUNK_LENGTH,
	THINKING_STEPS_MAX_LABEL_LENGTH,
	THINKING_STEPS_MAX_RETAINED_STEPS,
	THINKING_STEPS_RETAINED_HEAD_STEPS,
	ThinkingStepsParser,
} from "../extensions/zentui/thinking-steps";
import * as UserMessageOsc from "../extensions/zentui/user-message-osc";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Thinking-step structural parser", () => {
	it.each(["```ts", "~~~", "$$", "\\["])(
		"distinguishes unfinished %s bodies without accepting them as finalized steps",
		(opening) => {
			const source = `# Plan\r\nbody\r\n${opening}\r\n# opaque`;
			expect(parseThinkingStepsResult(source)).toEqual({
				unfinished: true,
				steps: [{ number: 1, label: "Plan" }],
				omittedSteps: 0,
				clampedLabels: 0,
			});
			expect(parseThinkingSteps(source)).toBeUndefined();
		},
	);

	it.each([
		"```ts\nbody",
		"# Plan\n```bad`info\nbody",
		"# Plan\n```\nunsafe\x1b[2J",
		`Intro\n${"x".repeat(THINKING_STEPS_MAX_CHUNK_LENGTH)}`,
	])("never classifies unsafe, orphan, or over-budget input as recoverable", (source) => {
		expect(parseThinkingStepsResult(source)).toBeUndefined();
	});
	it("derives headings, top-level lists, and prose labels", () => {
		expect(
			parseThinkingSteps(
				"# Inspect\nbody\n\n- Check API\n  - nested body\n\nProse label\nprose body",
			),
		).toEqual([
			{ number: 1, label: "Inspect" },
			{ number: 2, label: "Check API" },
			{ number: 3, label: "Prose label" },
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
			expect(step.label).not.toMatch(/[\x1b\x80-\x9f]/);
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

	it("normalizes CRLF and enforces the per-update source bound inclusively", () => {
		expect(parseThinkingSteps("# One\r\nbody\r\n# Two")?.map((step) => step.label)).toEqual([
			"One",
			"Two",
		]);
		const exact = `Intro\n${"x".repeat(THINKING_STEPS_MAX_CHUNK_LENGTH - 6)}`;
		expect(exact).toHaveLength(THINKING_STEPS_MAX_CHUNK_LENGTH);
		expect(parseThinkingSteps(exact)).toHaveLength(1);
		expect(parseThinkingSteps(`${exact}x`)).toBeUndefined();
		const decoratedPrefix = "# A\n\x1b[31m";
		const decoratedSuffix = "\x1b[0m";
		const decoratedExact = `${decoratedPrefix}${"a".repeat(1_000)}${decoratedSuffix}`;
		expect(parseThinkingSteps(decoratedExact)?.map((step) => step.label)).toEqual(["A"]);
	});

	it("clamps over-long labels instead of rejecting the run", () => {
		const exact = "a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH);
		const decorated = `\x1b[38;2;137;180;250m${exact}\x1b[39m`;
		expect(parseThinkingStepsResult(`# ${decorated}`)).toMatchObject({
			steps: [{ label: exact }],
			clampedLabels: 0,
		});
		const heading = parseThinkingStepsResult(
			`# ${decorated}a\n- ${exact}${exact}\n1. ${"界".repeat(900)}`,
		);
		expect(heading?.clampedLabels).toBe(3);
		for (const step of heading?.steps ?? []) {
			expect(step.label.length).toBeLessThanOrEqual(THINKING_STEPS_MAX_LABEL_LENGTH);
			expect(step.label.endsWith("…")).toBe(true);
		}
		const emoji = parseThinkingSteps(`# ${"a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH - 2)}😀😀`);
		expect(emoji?.[0]?.label).toMatch(/a…$/u);
		expect(emoji?.[0]?.label).not.toMatch(/[\ud800-\udbff]…$/);
	});

	it("shortens an over-long prose paragraph to its first sentence, then to the limit", () => {
		const sentence = "I should check the parser before changing anything.";
		const paragraph = `${sentence} ${"More reasoning follows here. ".repeat(60)}`;
		const unpunctuated = `Hmm ${"let me think ".repeat(80)}`;
		expect(
			parseThinkingSteps(`${paragraph}\n\n${unpunctuated}\n\nShort one. Still the whole line.`),
		).toEqual([
			{ number: 1, label: sentence },
			{
				number: 2,
				label: `${unpunctuated.slice(0, THINKING_STEPS_MAX_LABEL_LENGTH - 1).trimEnd()}…`,
			},
			{ number: 3, label: "Short one. Still the whole line." },
		]);
	});

	it("treats label-less separators as body once a step exists", () => {
		expect(
			parseThinkingSteps("# One\n\n---\n\n- - -\n\n***\n# Two")?.map((step) => step.label),
		).toEqual(["One", "Two"]);
		expect(parseThinkingSteps("---\n# Late")).toBeUndefined();
	});

	it("caps retained steps to the first few plus the most recent without rejecting", () => {
		const total = THINKING_STEPS_MAX_RETAINED_STEPS * 4 + 17;
		const source = Array.from({ length: total }, (_, index) => `# Step ${index + 1}`).join("\n");
		const result = parseThinkingStepsResult(source);
		const numbers = result?.steps.map((step) => step.number) ?? [];
		expect(numbers).toHaveLength(THINKING_STEPS_MAX_RETAINED_STEPS);
		expect(numbers.slice(0, THINKING_STEPS_RETAINED_HEAD_STEPS)).toEqual([1, 2, 3, 4]);
		expect(numbers.at(-1)).toBe(total);
		expect(numbers.slice(THINKING_STEPS_RETAINED_HEAD_STEPS)).toEqual(
			Array.from(
				{ length: THINKING_STEPS_MAX_RETAINED_STEPS - THINKING_STEPS_RETAINED_HEAD_STEPS },
				(_, index) =>
					total -
					(THINKING_STEPS_MAX_RETAINED_STEPS - THINKING_STEPS_RETAINED_HEAD_STEPS) +
					1 +
					index,
			),
		);
		expect(result?.omittedSteps).toBe(total - THINKING_STEPS_MAX_RETAINED_STEPS);
		expect(result?.steps.find((step) => step.number === 5)).toBeUndefined();
	});

	it("parses incrementally: every chunk split matches the one-shot result", () => {
		const source = [
			"Intro paragraph. More.",
			"",
			"# Plan",
			"```ts",
			"# not a step",
			"```",
			"- Check\r",
			"$$",
			"x",
			"$$",
			"",
			"Closing thought",
		].join("\n");
		const expected = parseThinkingStepsResult(source);
		for (let split = 1; split < source.length; split += 1) {
			const parser = new ThinkingStepsParser();
			parser.advance(source.slice(0, split));
			const advance = parser.advance(source);
			expect("result" in advance ? advance.result : undefined, `split ${split}`).toEqual(expected);
		}
		const byCharacter = new ThinkingStepsParser();
		let last: ReturnType<ThinkingStepsParser["advance"]> | undefined;
		for (let end = 1; end <= source.length; end += 1)
			last = byCharacter.advance(source.slice(0, end));
		expect(last).toEqual({ result: expected });
	});

	it("ignores an SGR sequence split at the end of the open line", () => {
		const parser = new ThinkingStepsParser();
		for (const tail of ["\x1b", "\x1b[", "\x1b[39"])
			expect(parser.advance(`# Plan\nbody\n\nSEND.${tail}`)).toHaveProperty("result");
		expect(parser.advance("# Plan\nbody\n\nSEND.\x1b[39m done")).toHaveProperty("result");
		expect(new ThinkingStepsParser().advance("# Plan\nbody\n\nSEND.\x1b[2J")).toHaveProperty(
			"rejection",
		);
	});

	it("keeps transient open-line problems recoverable but poisons committed ones", () => {
		const parser = new ThinkingStepsParser();
		expect(parser.advance("# One\n# Two \x1b[2J")).toEqual({ rejection: "unsafe-control" });
		expect(parser.advance("# One\n# Two \x1b[31mred\x1b[0m")).toMatchObject({
			result: { steps: [{ label: "One" }, { label: "Two red" }] },
		});
		expect(parser.advance("# One\n# Two \x1b[2J\n# Three")).toEqual({
			rejection: "unsafe-control",
		});
		expect(parser.advance("# One\n# Two \x1b[2J\n# Three\n# Four")).toEqual({
			rejection: "unsafe-control",
		});
	});

	it("bounds work per update by the new text plus the open line", () => {
		const sanitize = vi.spyOn(UserMessageOsc, "sanitizeSgrOnlySourceText");
		const lines = Array.from(
			{ length: 6_000 },
			(_, index) => `${index % 40 === 0 ? "# Step" : "body"} ${index} ${"lorem ipsum ".repeat(5)}`,
		);
		const source = lines.join("\n");
		expect(source.length).toBeGreaterThan(400_000);
		const chunk = 1_024;
		const parser = new ThinkingStepsParser();
		const work: number[] = [];
		for (let end = chunk; end < source.length + chunk; end += chunk) {
			sanitize.mockClear();
			const advance = parser.advance(source.slice(0, end));
			expect("result" in advance).toBe(true);
			work.push(sanitize.mock.calls.reduce((total, [text]) => total + text.length, 0));
		}
		expect(Math.max(...work)).toBeGreaterThan(chunk / 2);
		expect(Math.max(...work)).toBeLessThanOrEqual(chunk + 2 * 2_048);
		expect(work.slice(-10).every((value) => value <= chunk + 2 * 2_048)).toBe(true);
		// Total work is linear in the source, not quadratic in the number of updates.
		expect(work.reduce((total, value) => total + value, 0)).toBeLessThan(source.length * 1.5);
	});

	it("bounds work per update for one endless unterminated line", () => {
		const sanitize = vi.spyOn(UserMessageOsc, "sanitizeSgrOnlySourceText");
		const source = `Reasoning ${"without a newline ".repeat(20_000)}`;
		const parser = new ThinkingStepsParser();
		for (let end = 4_096; end < source.length; end += 4_096) {
			sanitize.mockClear();
			const advance = parser.advance(source.slice(0, end));
			expect("result" in advance).toBe(true);
			expect(sanitize).toHaveBeenCalledTimes(1);
			expect(
				sanitize.mock.calls.reduce((total, [text]) => total + text.length, 0),
			).toBeLessThanOrEqual(2_048);
		}
	});
});
