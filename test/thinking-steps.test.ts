import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Markdown, type MarkdownTheme, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ThinkingStepsComponentConfig } from "../extensions/zentui/config";
import {
	parseThinkingSteps,
	registerThinkingStepsTransformer,
	THINKING_STEPS_MAX_INPUT_LENGTH,
	THINKING_STEPS_MAX_LABEL_LENGTH,
	THINKING_STEPS_MAX_LABEL_WIDTH,
	THINKING_STEPS_MAX_OUTPUT_LENGTH,
	THINKING_STEPS_MAX_STEPS,
	type ThinkingTransformContext,
	transformThinkingSteps,
} from "../extensions/zentui/thinking-steps";

const enabled = (mode: ThinkingStepsComponentConfig["mode"]): ThinkingStepsComponentConfig => ({
	enabled: true,
	mode,
});
const context = (overrides: Partial<ThinkingTransformContext> = {}): ThinkingTransformContext => ({
	messageType: "assistant-thinking",
	isStreaming: false,
	availableWidth: 80,
	...overrides,
});
const identityMarkdownTheme = Object.fromEntries(
	[
		"heading",
		"link",
		"linkUrl",
		"code",
		"codeBlock",
		"codeBlockBorder",
		"quote",
		"quoteBorder",
		"hr",
		"listBullet",
		"bold",
		"italic",
		"strikethrough",
		"underline",
	].map((key) => [key, (text: string) => text]),
) as unknown as MarkdownTheme;

describe("Thinking-step parser", () => {
	it("derives source-ordered headings, top-level lists, and prose paragraphs", () => {
		const source = [
			"# Inspect the request",
			"Keep this heading body.",
			"",
			"- Check the API",
			"  - nested detail is body",
			"",
			"First meaningful prose line",
			"Second prose line stays in the body.",
			"",
			"1. Finish",
		].join("\n");
		expect(parseThinkingSteps(source)).toEqual([
			{ number: 1, label: "Inspect the request", body: "Keep this heading body." },
			{ number: 2, label: "Check the API", body: "  - nested detail is body" },
			{
				number: 3,
				label: "First meaningful prose line",
				body: "Second prose line stays in the body.",
			},
			{ number: 4, label: "Finish", body: "" },
		]);
	});

	it("keeps fenced code, Mermaid, display math, and nested content opaque", () => {
		const source = [
			"# Analyze",
			"```ts",
			"# not a heading",
			"- not a list",
			"```",
			"```mermaid",
			"1. not a step",
			"```",
			"$$",
			"# x + y",
			"$$",
			"\\[",
			"- z",
			"\\]",
			"  2. indented continuation",
			"# Done",
		].join("\n");
		const steps = parseThinkingSteps(source);
		expect(steps).toHaveLength(2);
		expect(steps?.[0]?.body).toContain("```mermaid\n1. not a step\n```");
		expect(steps?.[0]?.body).toContain("$$\n# x + y\n$$");
		expect(steps?.[0]?.body).toContain("\\[\n- z\n\\]");
		expect(steps?.[0]?.body).toContain("  2. indented continuation");
		expect(steps?.[1]).toEqual({ number: 2, label: "Done", body: "" });
	});

	it.each([
		[
			"# Analyze\r\n   ```ts\r\n# hidden heading\r\n- hidden list\r\n   ```\r\n# Done",
			"CRLF and an indented backtick fence",
		],
		["# Analyze\n  ~~~ text\n# hidden heading\n- hidden list\n ~~~~\n# Done", "tilde fence"],
		["# Analyze\n  $$  \n# hidden heading\n- hidden list\n   $$\n# Done", "dollar math"],
		["# Analyze\n \\[ \n# hidden heading\n- hidden list\n  \\] \n# Done", "bracket math"],
	] as const)("keeps internal structure opaque for %s (%s)", (source, _description) => {
		const steps = parseThinkingSteps(source);
		expect(steps).toHaveLength(2);
		expect(steps?.map((step) => step.label)).toEqual(["Analyze", "Done"]);
		expect(steps?.[0]?.body).toContain("# hidden heading\n- hidden list");
	});

	it.each([
		["", "empty"],
		["\x1b]0;owned\x07", "control-only"],
		["```\n# unterminated", "unclosed fence"],
		["$$\nvalue", "unclosed math"],
		["```ts\ncode\n```\n# Later", "orphan opaque prefix"],
		["  private preface\n# Visible", "indented orphan preface"],
		["#\n# Visible", "bare heading marker"],
		["-\n# Visible", "bare list marker"],
		["> private quote\n# Visible", "unsupported blockquote"],
		["``` bad ` info\n# hidden\n```\n# Visible", "invalid backtick info string"],
		["# Analyze\n   ```ts\n# hidden\n- hidden", "unclosed indented fence"],
		["# Analyze\n  ~~~\n# hidden\n- hidden", "unclosed tilde fence"],
		["# Analyze\n  \\[\n# hidden\n- hidden", "unclosed bracket math"],
		["---", "no meaningful label"],
	] as const)("fails open for %s (%s)", (source, _description) => {
		expect(parseThinkingSteps(source)).toBeUndefined();
		expect(transformThinkingSteps(source, enabled("summary"), context())).toBe(source);
	});

	it("fails open to exact input when terminal sanitization would change it", () => {
		const source = "# Safe\x1b]0;title\x07 label\nBody\x1b[31m red";
		expect(parseThinkingSteps(source)).toBeUndefined();
		expect(transformThinkingSteps(source, enabled("expanded"), context())).toBe(source);
	});

	it("enforces inclusive input, label, and step limits", () => {
		const exactInput = `Intro\n${"x".repeat(THINKING_STEPS_MAX_INPUT_LENGTH - 6)}`;
		expect(exactInput).toHaveLength(THINKING_STEPS_MAX_INPUT_LENGTH);
		expect(parseThinkingSteps(exactInput)).toHaveLength(1);
		expect(parseThinkingSteps(`${exactInput}x`)).toBeUndefined();

		const exactLabel = `# ${"a".repeat(THINKING_STEPS_MAX_LABEL_LENGTH)}`;
		expect(parseThinkingSteps(exactLabel)).toHaveLength(1);
		expect(parseThinkingSteps(`${exactLabel}a`)).toBeUndefined();

		const exactSteps = Array.from(
			{ length: THINKING_STEPS_MAX_STEPS },
			(_, index) => `# Step ${index + 1}`,
		).join("\n");
		expect(parseThinkingSteps(exactSteps)).toHaveLength(THINKING_STEPS_MAX_STEPS);
		expect(parseThinkingSteps(`${exactSteps}\n# Too many`)).toBeUndefined();
	});
});

describe("Thinking-step Markdown transform", () => {
	const seven = Array.from({ length: 7 }, (_, index) => `# Label ${index + 1}`).join("\n");

	it("renders collapsed and latest-five Summary with settled and streaming markers", () => {
		expect(transformThinkingSteps(seven, enabled("collapsed"), context())).toBe(
			"│ Thinking · Step 7: Label 7",
		);
		expect(
			transformThinkingSteps(seven, enabled("collapsed"), context({ isStreaming: true })),
		).toBe("│ Thinking • Step 7: Label 7");

		const settled = [
			"┆ Thinking Steps · Summary  ",
			"├─ · Step 3: Label 3  ",
			"├─ · Step 4: Label 4  ",
			"├─ · Step 5: Label 5  ",
			"├─ · Step 6: Label 6  ",
			"└─ · Step 7: Label 7",
		].join("\n");
		const streaming = settled.replace("└─ · Step 7", "└─ • Step 7");
		expect(transformThinkingSteps(seven, enabled("summary"), context())).toBe(settled);
		expect(transformThinkingSteps(seven, enabled("summary"), context({ isStreaming: true }))).toBe(
			streaming,
		);
	});

	it("renders every label and unchanged original body only for finalized/restored Expanded content", () => {
		const firstBody = "Original **Markdown**.\n```\n# opaque\n```";
		const secondBody = "$$\nx\n$$";
		const source = `# First\n${firstBody}\n# Second\n${secondBody}`;
		const expected = [
			"┆ Thinking Steps · Expanded",
			"├─ · Step 1: First",
			firstBody,
			"└─ · Step 2: Second",
			secondBody,
		].join("\n\n");
		const restored = transformThinkingSteps(source, enabled("expanded"), context());
		expect(restored).toBe(expected);
		expect(restored).toContain(firstBody);
		expect(restored).toContain(secondBody);
		expect(
			transformThinkingSteps(source, enabled("expanded"), context({ isStreaming: true })),
		).toBe(source);
		for (const mode of ["collapsed", "summary"] as const) {
			expect(
				transformThinkingSteps(source, enabled(mode), context({ isStreaming: true })),
			).not.toBe(source);
		}
	});

	it("returns exact chain input for disabled, non-thinking, invalid context, and failure paths", () => {
		const input = "# Chain output\nbody";
		expect(transformThinkingSteps(input, { enabled: false, mode: "summary" }, context())).toBe(
			input,
		);
		expect(
			transformThinkingSteps(input, enabled("summary"), context({ messageType: "assistant" })),
		).toBe(input);
		for (const availableWidth of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(transformThinkingSteps(input, enabled("summary"), context({ availableWidth }))).toBe(
				input,
			);
		}
	});

	it.each([0, 1, 2, 3, 8] as const)(
		"fails open when width %i cannot hold a safe label",
		(width) => {
			const input = "# Width label";
			expect(
				transformThinkingSteps(input, enabled("summary"), context({ availableWidth: width })),
			).toBe(input);
		},
	);

	it.each([
		["collapsed", 22, "│ Thinking · Step 1: A"],
		["summary", 26, "┆ Thinking Steps · Summary  \n└─ · Step 1: A"],
		["expanded", 27, "┆ Thinking Steps · Expanded\n\n└─ · Step 1: A"],
	] as const)(
		"renders %s at its minimum width and fails open one cell below",
		(mode, width, output) => {
			const input = "# A";
			expect(transformThinkingSteps(input, enabled(mode), context({ availableWidth: width }))).toBe(
				output,
			);
			expect(
				transformThinkingSteps(input, enabled(mode), context({ availableWidth: width - 1 })),
			).toBe(input);
		},
	);

	it("sizes labels at narrow and wide widths without splitting graphemes or Markdown", () => {
		const input = "# Family 👨‍👩‍👧‍👦 and *Markdown* label";
		const narrow = transformThinkingSteps(
			input,
			enabled("collapsed"),
			context({ availableWidth: 34 }),
		);
		expect(narrow).toBe("│ Thinking · Step 1: Family 👨‍👩‍👧‍👦 an…");
		expect(narrow).not.toContain("�");
		expect(narrow.includes("👨‍👩‍👧‍👦") || !narrow.includes("\u200d")).toBe(true);
		const wide = transformThinkingSteps(
			input,
			enabled("collapsed"),
			context({ availableWidth: 200 }),
		);
		expect(wide).toContain("👨‍👩‍👧‍👦");
		expect(wide).toContain("\\*Markdown\\*");
	});

	it("renders hard-break rows through Pi Markdown at narrow and wide widths", () => {
		const source = "# First\n# Latest";
		const listBullet = vi.fn((text: string) => text);
		const quote = vi.fn((text: string) => text);
		const quoteBorder = vi.fn((text: string) => text);
		const markdownTheme = {
			...identityMarkdownTheme,
			listBullet,
			quote,
			quoteBorder,
		} as MarkdownTheme;
		const cases = [
			{
				width: 26,
				streaming: false,
				expected: ["┆ Thinking Steps · Summary", "├─ · Step 1: First", "└─ · Step 2: Latest"],
			},
			{
				width: 80,
				streaming: true,
				expected: ["┆ Thinking Steps · Summary", "├─ · Step 1: First", "└─ • Step 2: Latest"],
			},
		] as const;

		for (const { width, streaming, expected } of cases) {
			const transformed = transformThinkingSteps(
				source,
				enabled("summary"),
				context({ availableWidth: width, isStreaming: streaming }),
			);
			const rendered = new Markdown(transformed, 0, 0, markdownTheme, undefined, {
				preserveBackslashEscapes: false,
				renderLatex: false,
			}).render(width);
			expect(rendered.map((line) => line.trimEnd())).toEqual(expected);
			for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(listBullet).not.toHaveBeenCalled();
		expect(quote).not.toHaveBeenCalled();
		expect(quoteBorder).not.toHaveBeenCalled();
	});

	it("accounts for multi-digit step prefixes within the output width", () => {
		const source = Array.from({ length: 128 }, (_, index) => `# Label ${index + 1}`).join("\n");
		const collapsed = transformThinkingSteps(
			source,
			enabled("collapsed"),
			context({ availableWidth: 24 }),
		);
		expect(collapsed).toBe("│ Thinking · Step 128: L");
		expect(visibleWidth(collapsed)).toBe(24);
		expect(
			transformThinkingSteps(source, enabled("collapsed"), context({ availableWidth: 23 })),
		).toBe(source);

		const summary = transformThinkingSteps(
			source,
			enabled("summary"),
			context({ availableWidth: 26 }),
		);
		expect(summary).toContain("├─ · Step 124: Label 124");
		expect(summary).toContain("└─ · Step 128: Label 128");
		const rendered = new Markdown(summary, 0, 0, identityMarkdownTheme, undefined, {
			preserveBackslashEscapes: false,
			renderLatex: false,
		}).render(26);
		for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(26);
	});

	it("escapes all CommonMark ASCII punctuation so labels render as literal wording", () => {
		const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
		const aggregateLabel = `Literal ${punctuation} and &amp;`;
		for (const mode of ["collapsed", "summary", "expanded"] as const) {
			const aggregateOutput = transformThinkingSteps(
				`# ${aggregateLabel}`,
				enabled(mode),
				context({ availableWidth: 500 }),
			);
			for (const character of punctuation) {
				expect(aggregateOutput).toContain(`\\${character}`);
			}
			expect(aggregateOutput).toContain("\\&amp\\;");

			const renderedLabel = 'Literal # ~ $ &amp; and "quotes"';
			const renderedOutput = transformThinkingSteps(
				`# ${renderedLabel}`,
				enabled(mode),
				context({ availableWidth: 500 }),
			);
			const rendered = new Markdown(renderedOutput, 0, 0, identityMarkdownTheme, undefined, {
				preserveBackslashEscapes: false,
				renderLatex: false,
			})
				.render(500)
				.join("\n");
			expect(rendered).toContain(renderedLabel);
		}
	});

	it("caps labels by display width independently of source length", () => {
		const output = transformThinkingSteps(
			`# ${"界".repeat(100)}`,
			enabled("collapsed"),
			context({ availableWidth: 1_000 }),
		);
		const renderedLabel = output.replace(/^│ Thinking · Step 1: /, "");
		expect(visibleWidth(renderedLabel)).toBeLessThanOrEqual(THINKING_STEPS_MAX_LABEL_WIDTH);
		expect(renderedLabel.endsWith("…")).toBe(true);
	});

	it("accepts the output limit inclusively and fails open at limit plus one", () => {
		const prefix = "┆ Thinking Steps · Expanded\n\n└─ · Step 1: A\n\n";
		const exactSource = `# A\n${"b".repeat(THINKING_STEPS_MAX_OUTPUT_LENGTH - prefix.length)}`;
		const overSource = `${exactSource}b`;
		const exactOutput = transformThinkingSteps(
			exactSource,
			enabled("expanded"),
			context({ availableWidth: 200 }),
		);
		expect(exactOutput).toHaveLength(THINKING_STEPS_MAX_OUTPUT_LENGTH);
		expect(exactOutput).not.toBe(exactSource);
		expect(
			transformThinkingSteps(overSource, enabled("expanded"), context({ availableWidth: 200 })),
		).toBe(overSource);
	});

	it("fails open when expanded generated Markdown exceeds the output bound", () => {
		const source = `# Intro\n${"b".repeat(THINKING_STEPS_MAX_INPUT_LENGTH - 8)}`;
		expect(source.length).toBeLessThanOrEqual(THINKING_STEPS_MAX_INPUT_LENGTH);
		expect(
			transformThinkingSteps(source, enabled("expanded"), context({ availableWidth: 200 })),
		).toBe(source);
	});
});

describe("Thinking-step source composability", () => {
	it("uses only the public transformer seam and no unrelated TUI ownership paths", () => {
		const source = readFileSync(
			join(import.meta.dirname, "../extensions/zentui/thinking-steps.ts"),
			"utf8",
		);
		expect(source).toContain("registerMarkdownTransformer");
		expect(source).not.toMatch(
			/pi-coding-agent\/(?:dist|src)|prototype|setFooter|setEditor|setWidget|setStatus|WorkingLine|hiddenThinking/i,
		);
		const adaptedVisualLayoutAttribution = `/*
 * The visual title/connector language below is adapted from pi-thinking-steps d0a59a4.
 *
 * MIT License
 *
 * Copyright (c) 2026 Marc Mironescu / FluxGear
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const SUMMARY_TITLE = "┆ Thinking Steps · Summary";
const EXPANDED_TITLE = "┆ Thinking Steps · Expanded";`;
		expect(source).toContain(adaptedVisualLayoutAttribution);
		const index = readFileSync(join(import.meta.dirname, "../extensions/zentui/index.ts"), "utf8");
		expect(index.indexOf("registerThinkingStepsTransformer(")).toBeLessThan(
			index.indexOf('pi.on("session_start"'),
		);
		expect(index).not.toContain('registerCommand("thinking-steps"');
		expect(index).not.toContain('registerShortcut("thinking-steps"');
	});
});

describe("Thinking-step public capability registration", () => {
	it("detects absent APIs without registering or changing native input", () => {
		const capability = registerThinkingStepsTransformer({}, () => enabled("summary"));
		expect(capability).toEqual({ available: false });
		expect(Object.isFrozen(capability)).toBe(true);
	});

	it("registers exactly one callback and reads current config on every chain call", () => {
		let callback:
			| ((markdown: string, transformContext: ThinkingTransformContext) => string)
			| undefined;
		const register = vi.fn((value) => {
			callback = value;
		});
		let config = enabled("collapsed");
		const capability = registerThinkingStepsTransformer(
			{ registerMarkdownTransformer: register },
			() => config,
		);
		expect(capability).toEqual({ available: true });
		expect(Object.isFrozen(capability)).toBe(true);
		expect(register).toHaveBeenCalledTimes(1);
		expect(callback?.("# One\n# Two", context())).toBe("│ Thinking · Step 2: Two");
		config = enabled("summary");
		expect(callback?.("# One\n# Two", context())).toBe(
			"┆ Thinking Steps · Summary  \n├─ · Step 1: One  \n└─ · Step 2: Two",
		);
	});

	it("fails open on registration and transformation failures", () => {
		expect(
			registerThinkingStepsTransformer(
				{
					registerMarkdownTransformer() {
						throw new Error("unsupported");
					},
				},
				() => enabled("summary"),
			),
		).toEqual({ available: false });

		let callback: ((markdown: string, value: ThinkingTransformContext) => string) | undefined;
		registerThinkingStepsTransformer(
			{
				registerMarkdownTransformer: (
					value: (markdown: string, transformContext: ThinkingTransformContext) => string,
				) => (callback = value),
			},
			() => {
				throw new Error("bad config");
			},
		);
		const chainInput = "# Earlier transformer output";
		expect(callback?.(chainInput, context())).toBe(chainInput);
	});
});
