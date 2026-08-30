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
		expect(transformThinkingSteps(source, enabled("tree"), context())).toBe(source);
	});

	it("fails open to exact input when terminal sanitization would change it", () => {
		const source = "# Safe\x1b]0;title\x07 label\nBody\x1b[31m red";
		expect(parseThinkingSteps(source)).toBeUndefined();
		expect(transformThinkingSteps(source, enabled("rail"), context())).toBe(source);
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

	it.each([
		[
			"rail",
			"## │ Thinking · Rail\n│ · Label 1  \n│ · Label 2  \n│ · Label 3  \n│ · Label 4  \n│ · Label 5  \n│ · Label 6  \n│ • **Label 7**",
		],
		[
			"tree",
			"## ┆ Thinking · Tree\n├─ · Label 1  \n├─ · Label 2  \n├─ · Label 3  \n├─ · Label 4  \n├─ · Label 5  \n├─ · Label 6  \n└─ • **Label 7**",
		],
	] as const)("renders all labels without ordinals in streaming %s mode", (mode, expected) => {
		const output = transformThinkingSteps(seven, enabled(mode), context({ isStreaming: true }));
		expect(output).toBe(expected);
		expect(output).not.toMatch(/Step \d|Label 3.*Label 7$/);
	});

	it.each([
		["rail", "## │ Thinking · Rail\n│ · First  \n│ · Latest"],
		["tree", "## ┆ Thinking · Tree\n├─ · First  \n└─ · Latest"],
	] as const)("settles every %s label and omits bodies", (mode, expected) => {
		const source = "# First\nOriginal **Markdown** body.\n# Latest\n$$\nx\n$$";
		const output = transformThinkingSteps(source, enabled(mode), context());
		expect(output).toBe(expected);
		expect(output).not.toContain("Original");
		expect(output).not.toContain("**Latest**");
		expect(output).not.toContain("•");
	});

	it("returns exact chain input for disabled, experimental, non-thinking, invalid context, and parser failures", () => {
		const input = "# Chain output\nbody";
		expect(transformThinkingSteps(input, { enabled: false, mode: "tree" }, context())).toBe(input);
		expect(
			transformThinkingSteps(input, { enabled: true, mode: "streaming-experimental" }, context()),
		).toBe(input);
		expect(
			transformThinkingSteps(input, enabled("tree"), context({ messageType: "assistant" })),
		).toBe(input);
		for (const availableWidth of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(transformThinkingSteps(input, enabled("tree"), context({ availableWidth }))).toBe(
				input,
			);
		}
	});

	it.each([0, 1, 2, 3, 8, 16] as const)(
		"fails open when width %i cannot hold the title",
		(width) => {
			const input = "# Width label";
			for (const mode of ["rail", "tree"] as const) {
				expect(
					transformThinkingSteps(input, enabled(mode), context({ availableWidth: width })),
				).toBe(input);
			}
		},
	);

	it.each([
		["rail", "## │ Thinking · Rail\n│ · A"],
		["tree", "## ┆ Thinking · Tree\n└─ · A"],
	] as const)("renders %s at its 17-cell minimum and fails open below", (mode, output) => {
		const input = "# A";
		expect(transformThinkingSteps(input, enabled(mode), context({ availableWidth: 17 }))).toBe(
			output,
		);
		expect(transformThinkingSteps(input, enabled(mode), context({ availableWidth: 16 }))).toBe(
			input,
		);
	});

	it.each(["rail", "tree"] as const)(
		"sizes %s labels at narrow and wide widths without splitting graphemes or Markdown",
		(mode) => {
			const input = "# Family 👨‍👩‍👧‍👦 and *Markdown* label";
			const narrow = transformThinkingSteps(input, enabled(mode), context({ availableWidth: 18 }));
			expect(narrow).toMatch(/Family 👨‍👩‍👧‍👦 and?…/);
			expect(narrow).not.toContain("�");
			expect(narrow.includes("👨‍👩‍👧‍👦") || !narrow.includes("\u200d")).toBe(true);
			const wide = transformThinkingSteps(input, enabled(mode), context({ availableWidth: 200 }));
			expect(wide).toContain("👨‍👩‍👧‍👦");
			expect(wide).toContain("\\*Markdown\\*");
		},
	);

	it.each(["rail", "tree"] as const)(
		"uses honest H2 title styling, latest-only streaming bold, and structural-safe hard breaks for %s",
		(mode) => {
			const source = "# First\n# Latest";
			const heading = vi.fn((text: string) => `H(${text})`);
			const bold = vi.fn((text: string) => `B(${text})`);
			const listBullet = vi.fn((text: string) => text);
			const quote = vi.fn((text: string) => text);
			const quoteBorder = vi.fn((text: string) => text);
			const code = vi.fn((text: string) => text);
			const codeBlock = vi.fn((text: string) => text);
			const markdownTheme = {
				...identityMarkdownTheme,
				heading,
				bold,
				listBullet,
				quote,
				quoteBorder,
				code,
				codeBlock,
			} as MarkdownTheme;
			const transformed = transformThinkingSteps(
				source,
				enabled(mode),
				context({ availableWidth: 80, isStreaming: true }),
			);
			expect(transformed.split("\n")[1]).toMatch(/ {2}$/);
			const rendered = new Markdown(transformed, 0, 0, markdownTheme, undefined, {
				preserveBackslashEscapes: false,
				renderLatex: false,
			}).render(80);
			const visible = rendered.map((line) => line.trimEnd()).filter(Boolean);
			expect(visible).toEqual(
				mode === "rail"
					? ["H(B(│ Thinking · Rail))", "│ · First", "│ • B(Latest)"]
					: ["H(B(┆ Thinking · Tree))", "├─ · First", "└─ • B(Latest)"],
			);
			expect(heading).toHaveBeenCalled();
			expect(
				heading.mock.calls.some(([value]) =>
					String(value).includes(mode === "rail" ? "│ Thinking · Rail" : "┆ Thinking · Tree"),
				),
			).toBe(true);
			expect(bold).toHaveBeenCalledWith("Latest");
			for (const callback of [listBullet, quote, quoteBorder, code, codeBlock]) {
				expect(callback).not.toHaveBeenCalled();
			}
			for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(80);

			bold.mockClear();
			new Markdown(
				transformThinkingSteps(source, enabled(mode), context()),
				0,
				0,
				markdownTheme,
			).render(80);
			expect(bold).not.toHaveBeenCalledWith("Latest");
		},
	);

	it.each(["rail", "tree"] as const)(
		"escapes CommonMark punctuation so %s labels render as literal wording",
		(mode) => {
			const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
			const aggregateLabel = `Literal ${punctuation} and &amp;`;
			const aggregateOutput = transformThinkingSteps(
				`# ${aggregateLabel}`,
				enabled(mode),
				context({ availableWidth: 500 }),
			);
			for (const character of punctuation) expect(aggregateOutput).toContain(`\\${character}`);
			expect(aggregateOutput).toContain("\\&amp\\;");

			const renderedLabel = 'Literal # ~ $ &amp; and "quotes"';
			const rendered = new Markdown(
				transformThinkingSteps(
					`# ${renderedLabel}`,
					enabled(mode),
					context({ availableWidth: 500 }),
				),
				0,
				0,
				identityMarkdownTheme,
				undefined,
				{ preserveBackslashEscapes: false, renderLatex: false },
			)
				.render(500)
				.join("\n");
			expect(rendered).toContain(renderedLabel);
		},
	);

	it("caps labels by display width independently of source length", () => {
		const output = transformThinkingSteps(
			`# ${"界".repeat(100)}`,
			enabled("rail"),
			context({ availableWidth: 1_000 }),
		);
		const renderedLabel = output.split("\n")[1]?.replace(/^│ · /, "") ?? "";
		expect(visibleWidth(renderedLabel)).toBeLessThanOrEqual(THINKING_STEPS_MAX_LABEL_WIDTH);
		expect(renderedLabel.endsWith("…")).toBe(true);
	});

	it("keeps the maximum all-label rendering within the generated-output boundary", () => {
		const source = Array.from(
			{ length: THINKING_STEPS_MAX_STEPS },
			() => `# A${"*".repeat(507)}`,
		).join("\n");
		const output = transformThinkingSteps(
			source,
			enabled("tree"),
			context({ availableWidth: 1_000 }),
		);
		expect(output).not.toBe(source);
		expect(output.split("\n")).toHaveLength(THINKING_STEPS_MAX_STEPS + 1);
		expect(output.length).toBeLessThanOrEqual(THINKING_STEPS_MAX_OUTPUT_LENGTH);
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
const RAIL_TITLE = "│ Thinking · Rail";
const TREE_TITLE = "┆ Thinking · Tree";`;
		expect(source).toContain(adaptedVisualLayoutAttribution);
		const experimentalSource = readFileSync(
			join(import.meta.dirname, "../extensions/zentui/thinking-stream-experimental.ts"),
			"utf8",
		);
		const thinkingFoldNotice = `/*
 * The rendered-row folding and lifecycle below are adapted from
 * @99percentpeople/pi-thinking-fold 0.1.9 at commit 555160c.
 *
 * MIT License
 *
 * Copyright (c) 2026 Zach Yuen
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
 */`;
		expect(experimentalSource).toContain(thinkingFoldNotice);
		expect(experimentalSource).not.toMatch(
			/setWorkingMessage|setWorkingVisible|setFooter|setStatus/,
		);

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
		const capability = registerThinkingStepsTransformer({}, () => enabled("tree"));
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
		let config = enabled("rail");
		const capability = registerThinkingStepsTransformer(
			{ registerMarkdownTransformer: register },
			() => config,
		);
		expect(capability).toEqual({ available: true });
		expect(Object.isFrozen(capability)).toBe(true);
		expect(register).toHaveBeenCalledTimes(1);
		expect(callback?.("# One\n# Two", context())).toBe("## │ Thinking · Rail\n│ · One  \n│ · Two");
		config = enabled("tree");
		expect(callback?.("# One\n# Two", context())).toBe(
			"## ┆ Thinking · Tree\n├─ · One  \n└─ · Two",
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
				() => enabled("tree"),
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
