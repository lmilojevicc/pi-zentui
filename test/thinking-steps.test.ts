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

	it("fails open when a tab could expand after width budgeting", () => {
		const source = "# tab\texpands after budgeting";
		expect(parseThinkingSteps(source)).toBeUndefined();
		expect(transformThinkingSteps(source, enabled("tree"), context())).toBe(source);
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
			"`│` **Thinking**  \n`│` Label 1  \n`│` Label 2  \n`│` Label 3  \n`│` Label 4  \n`│` Label 5  \n`│` Label 6  \n`│ •` Label 7",
		],
		[
			"tree",
			"`┆` **Thinking**  \n`├─ ·` Label 3  \n`├─ ·` Label 4  \n`├─ ·` Label 5  \n`├─ ·` Label 6  \n`└─ •` Label 7",
		],
	] as const)(
		"renders the selected labels without ordinals in streaming %s mode",
		(mode, expected) => {
			const output = transformThinkingSteps(seven, enabled(mode), context({ isStreaming: true }));
			expect(output).toBe(expected);
			expect(output).not.toMatch(/Step \d/);
			const labels = output.match(/Label \d/g);
			expect(labels).toEqual(
				mode === "rail"
					? ["Label 1", "Label 2", "Label 3", "Label 4", "Label 5", "Label 6", "Label 7"]
					: ["Label 3", "Label 4", "Label 5", "Label 6", "Label 7"],
			);
		},
	);

	it.each([
		["rail", "`│` **Thinking**  \n`│` First  \n`│` Latest"],
		["tree", "`┆` **Thinking**  \n`├─ ·` First  \n`└─ ·` Latest"],
	] as const)("settles every selected %s label and omits bodies", (mode, expected) => {
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

	it.each([0, 1, 2, 3, 8, 9] as const)(
		"fails open when width %i cannot hold the visible compact title",
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
		["rail", "`│` **Thinking**  \n`│` A"],
		["tree", "`┆` **Thinking**  \n`└─ ·` A"],
	] as const)("renders %s at its 10-cell visible minimum and fails open below", (mode, output) => {
		const input = "# A";
		expect(transformThinkingSteps(input, enabled(mode), context({ availableWidth: 10 }))).toBe(
			output,
		);
		expect(transformThinkingSteps(input, enabled(mode), context({ availableWidth: 9 }))).toBe(
			input,
		);
	});

	it.each(["rail", "tree"] as const)(
		"sizes %s labels at narrow and wide widths without splitting graphemes or Markdown",
		(mode) => {
			const input = "# Family 👨‍👩‍👧‍👦 and *Markdown* label";
			const narrow = transformThinkingSteps(input, enabled(mode), context({ availableWidth: 18 }));
			expect(narrow).toContain("Family 👨‍👩‍👧‍👦");
			expect(narrow).toContain("…");
			expect(narrow).not.toContain("�");
			expect(narrow.includes("👨‍👩‍👧‍👦") || !narrow.includes("\u200d")).toBe(true);
			const wide = transformThinkingSteps(input, enabled(mode), context({ availableWidth: 200 }));
			expect(wide).toContain("👨‍👩‍👧‍👦");
			expect(wide).toContain("*Markdown*");
			expect(wide).not.toContain("\\*Markdown\\*");
		},
	);

	it.each(["rail", "tree"] as const)(
		"keeps safe and risky grapheme corpora intact in %s labels",
		(mode) => {
			const safe = "Family 👨‍👩‍👧‍👦 cafe\u0301 界語 wide";
			const risky = `${safe} *literal*`;
			for (const label of [safe, risky]) {
				for (const width of [14, 18, 24, 80]) {
					const output = transformThinkingSteps(
						`# ${label}`,
						enabled(mode),
						context({ availableWidth: width }),
					);
					const rendered = new Markdown(output, 0, 0, identityMarkdownTheme, undefined, {
						preserveBackslashEscapes: false,
						renderLatex: true,
					}).render(width);
					expect(rendered).toHaveLength(2);
					expect(rendered.every((row) => visibleWidth(row) <= width)).toBe(true);
					expect(output).not.toContain("�");
					expect(output.includes("\u200d") ? output.includes("👨‍👩‍👧‍👦") : true).toBe(true);
					expect(output.includes("\u0301") ? output.includes("e\u0301") : true).toBe(true);
				}
			}

			const code = vi.fn((text: string) => text);
			new Markdown(
				transformThinkingSteps(
					`# ${safe}\n# ${risky}`,
					enabled(mode),
					context({ availableWidth: 80 }),
				),
				0,
				0,
				{ ...identityMarkdownTheme, code },
			).render(80);
			expect(code.mock.calls.map(([value]) => value)).not.toContain(safe);
			expect(code.mock.calls.map(([value]) => value)).toContain(risky);
		},
	);

	it.each(["rail", "tree"] as const)(
		"uses an ordinary compact title, trusted strong emphasis, and structural-safe hard breaks for %s",
		(mode) => {
			const source = "# First\n# Latest";
			const heading = vi.fn((text: string) => text);
			const bold = vi.fn((text: string) => text);
			const code = vi.fn((text: string) => text);
			const thinkingText = vi.fn((text: string) => text);
			const italic = vi.fn((text: string) => text);
			const listBullet = vi.fn((text: string) => text);
			const quote = vi.fn((text: string) => text);
			const quoteBorder = vi.fn((text: string) => text);
			const codeBlock = vi.fn((text: string) => text);
			const codeBlockBorder = vi.fn((text: string) => text);
			const link = vi.fn((text: string) => text);
			const linkUrl = vi.fn((text: string) => text);
			const markdownTheme = {
				...identityMarkdownTheme,
				heading,
				bold,
				italic,
				listBullet,
				quote,
				quoteBorder,
				code,
				codeBlock,
				codeBlockBorder,
				link,
				linkUrl,
			} as MarkdownTheme;
			const transformed = transformThinkingSteps(
				source,
				enabled(mode),
				context({ availableWidth: 80, isStreaming: true }),
			);
			expect(transformed).toMatch(/^`[│┆]` \*\*Thinking\*\*[ ]{2}\n/);
			expect(transformed.split("\n")[1]).toMatch(/ {2}$/);
			const rendered = new Markdown(
				transformed,
				0,
				0,
				markdownTheme,
				{ color: thinkingText, italic: true },
				{ preserveBackslashEscapes: false, renderLatex: false },
			).render(80);
			const visible = rendered.map((line) => line.trimEnd());
			expect(visible).toEqual(
				mode === "rail"
					? ["│ Thinking", "│ First", "│ • Latest"]
					: ["┆ Thinking", "├─ · First", "└─ • Latest"],
			);
			expect(visible).not.toContain("");
			expect(heading).not.toHaveBeenCalled();
			expect(bold).toHaveBeenCalledWith("Thinking");
			expect(bold).not.toHaveBeenCalledWith("Latest");
			expect(code.mock.calls.map(([value]) => value)).toEqual(
				mode === "rail" ? ["│", "│", "│ •"] : ["┆", "├─ ·", "└─ •"],
			);
			expect(thinkingText).toHaveBeenCalledWith(" First");
			expect(thinkingText).toHaveBeenCalledWith(" Latest");
			for (const callback of [
				listBullet,
				quote,
				quoteBorder,
				codeBlock,
				codeBlockBorder,
				link,
				linkUrl,
			]) {
				expect(callback).not.toHaveBeenCalled();
			}
			for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(80);

			bold.mockClear();
			new Markdown(transformThinkingSteps(source, enabled(mode), context()), 0, 0, markdownTheme, {
				color: thinkingText,
				italic: true,
			}).render(80);
			expect(bold).toHaveBeenCalledWith("Thinking");
			expect(bold).not.toHaveBeenCalledWith("Latest");
		},
	);

	it.each(["rail", "tree"] as const)(
		"keeps safe punctuation native and literalizes Markdown-active %s labels",
		(mode) => {
			const safe = 'Review src/file.ts (phase 2.1); process.stdout.emit("resize")';
			const risky = String.raw`Literal \\ path [link](https://example.com) *emphasis* under_score \(x+y\) &amp;`;
			const output = transformThinkingSteps(
				`# ${safe}\n# ${risky}`,
				enabled(mode),
				context({ availableWidth: 500 }),
			);
			expect(output).toContain(safe);
			expect(output).toContain(risky);
			expect(output).not.toContain(String.raw`\\[link\\]`);
			expect(output).not.toContain(String.raw`\\*emphasis\\*`);

			const code = vi.fn((text: string) => text);
			const link = vi.fn((text: string) => text);
			const italic = vi.fn((text: string) => text);
			const thinkingText = vi.fn((text: string) => text);
			const rendered = new Markdown(
				output,
				0,
				0,
				{ ...identityMarkdownTheme, code, link, italic },
				{ color: thinkingText, italic: true },
				{ preserveBackslashEscapes: false, renderLatex: true },
			).render(500);
			expect(rendered).toHaveLength(3);
			expect(rendered[1]?.trimEnd()).toContain(safe);
			expect(rendered[2]?.trimEnd()).toContain(risky);
			expect(code.mock.calls.map(([value]) => value).filter((value) => value === safe)).toEqual([]);
			expect(code.mock.calls.map(([value]) => value).filter((value) => value === risky)).toEqual([
				risky,
			]);
			expect(thinkingText.mock.calls.some(([value]) => value.includes(safe))).toBe(true);
			expect(link).not.toHaveBeenCalled();
			expect(italic).not.toHaveBeenCalledWith("emphasis");
		},
	);

	it.each(["rail", "tree"] as const)(
		"literalizes every risky construct as one exact code callback in %s",
		(mode) => {
			const labels = [
				String.raw`matrix $\begin{matrix}a&b\\c&d\end{matrix}$`,
				"single $ unclosed",
				String.raw`open \( inline math`,
				String.raw`open \[ inline math`,
				"ticks ` one `` two ``` three",
				"HTML <!-- comment --> remains",
				'HTML <tag data-x="y">text</tag> remains',
				"entity &amp; &#38; remains",
				"link [label](https://example.com) remains",
				"autolink <https://example.com> remains",
				"styles *bold* _italic_ ~~strike~~ remain",
				String.raw`literal \\ backslashes \* remain`,
			] as const;
			const connector = mode === "rail" ? "│" : "└─ ·";
			for (const label of labels) {
				const callbacks = Object.fromEntries(
					[
						"heading",
						"link",
						"linkUrl",
						"codeBlock",
						"codeBlockBorder",
						"quote",
						"quoteBorder",
						"listBullet",
						"italic",
						"strikethrough",
					].map((name) => [name, vi.fn((text: string) => text)]),
				) as Record<string, ReturnType<typeof vi.fn>>;
				const code = vi.fn((text: string) => text);
				const output = transformThinkingSteps(
					`# ${label}`,
					enabled(mode),
					context({ availableWidth: 200 }),
				);
				const rendered = new Markdown(
					output,
					0,
					0,
					{ ...identityMarkdownTheme, ...callbacks, code } as MarkdownTheme,
					undefined,
					{ preserveBackslashEscapes: false, renderLatex: true },
				).render(200);
				expect(rendered, label).toHaveLength(2);
				expect(rendered[1]?.trimEnd(), label).toBe(`${connector} ${label}`);
				expect(
					rendered.every((row) => visibleWidth(row) <= 200),
					label,
				).toBe(true);
				expect(
					code.mock.calls.map(([value]) => value).filter((value) => value === label),
					label,
				).toEqual([label]);
				for (const callback of Object.values(callbacks))
					expect(callback, label).not.toHaveBeenCalled();
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"literalizes bounded GFM URLs and every retained @ with isolated callbacks in %s",
		(mode) => {
			const cases = [
				{ label: "https://example.com/path", width: 80 },
				{ label: "ftp://example.com/file", width: 80 },
				{ label: "www.example.com", width: 80 },
				{ label: "user@example.com", width: 80 },
				{ label: "foo@:bar.com", width: 80 },
				{ label: "foo@-bar.com", width: 80 },
				{ label: "foo@_bar.com", width: 80 },
				{ label: "foo+tag@host-name.com", width: 80 },
				{ label: "name@host", width: 80 },
				{ label: "trailing@", width: 80 },
				{ label: "Review (https://example.com/path), then continue.", width: 80 },
				{ label: "Contact user@example.com; visit www.example.com.", width: 80 },
				{ label: "https://example.com/path", width: 20 },
				{ label: "www.example.com/path", width: 14 },
				{ label: "user@example.com", width: 20 },
				{ label: "@domain.example", width: 10 },
			] as const;
			for (const isStreaming of [true, false]) {
				for (const { label, width } of cases) {
					const code = vi.fn((text: string) => text);
					const link = vi.fn((text: string) => text);
					const linkUrl = vi.fn((text: string) => text);
					const output = transformThinkingSteps(
						`# ${label}`,
						enabled(mode),
						context({ availableWidth: width, isStreaming }),
					);
					const rendered = new Markdown(
						output,
						0,
						0,
						{ ...identityMarkdownTheme, code, link, linkUrl },
						undefined,
						{ preserveBackslashEscapes: false, renderLatex: true },
					).render(width);
					const marker =
						mode === "rail" ? (isStreaming ? "│ •" : "│") : isStreaming ? "└─ •" : "└─ ·";
					const labelBudget = width - visibleWidth(`${marker} `);
					const visible =
						visibleWidth(label) <= labelBudget ? label : `${label.slice(0, labelBudget - 1)}…`;
					const titleConnector = mode === "rail" ? "│" : "┆";
					const connectorCalls = code.mock.calls.slice(0, 2).map(([value]) => value);
					const labelCalls = code.mock.calls.slice(2).map(([value]) => value);
					expect(output, `${mode} ${isStreaming} ${width} ${label}`).toBe(
						`\`${titleConnector}\` **Thinking**  \n\`${marker}\` \` ${visible} \``,
					);
					expect(output).not.toContain("\\");
					expect(output).not.toContain("\x1b");
					expect(connectorCalls, `${mode} ${isStreaming} ${width} ${label}`).toEqual([
						titleConnector,
						marker,
					]);
					expect(labelCalls, `${mode} ${isStreaming} ${width} ${label}`).toEqual([visible]);
					expect(rendered, `${mode} ${isStreaming} ${width} ${label}`).toHaveLength(2);
					expect(rendered[1]?.trimEnd()).toBe(`${marker} ${visible}`);
					expect(rendered.every((row) => visibleWidth(row) <= width)).toBe(true);
					expect(rendered.join("\n")).not.toContain("\x1b]8;");
					expect(link).not.toHaveBeenCalled();
					expect(linkUrl).not.toHaveBeenCalled();
				}
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"uses a longer backtick delimiter and literalizes truncated dollar math in %s",
		(mode) => {
			const ticks = "content ` and `` and ``` preserved";
			const tickOutput = transformThinkingSteps(
				`# ${ticks}`,
				enabled(mode),
				context({ availableWidth: 200 }),
			);
			expect(tickOutput.split("\n")[1]).toContain(`\`\`\`\` ${ticks} \`\`\`\``);

			const matrix = String.raw`matrix $\begin{matrix}a&b\\c&d\end{matrix}$ trailing`;
			const width = 20;
			const budget = mode === "rail" ? 18 : 15;
			const truncated = `${matrix.slice(0, budget - 1)}…`;
			const code = vi.fn((text: string) => text);
			const output = transformThinkingSteps(
				`# ${matrix}`,
				enabled(mode),
				context({ availableWidth: width }),
			);
			const rendered = new Markdown(output, 0, 0, { ...identityMarkdownTheme, code }, undefined, {
				preserveBackslashEscapes: false,
				renderLatex: true,
			}).render(width);
			expect(rendered).toHaveLength(2);
			expect(rendered[1]?.trimEnd()).toBe(`${mode === "rail" ? "│" : "└─ ·"} ${truncated}`);
			expect(code.mock.calls.map(([value]) => value)).toContain(truncated);
		},
	);

	it.each(["rail", "tree"] as const)(
		"isolates link and emphasis openers across %s labels",
		(mode) => {
			const labels = ["[open", "close](https://example.com)", "*open", "close*"];
			const link = vi.fn((text: string) => text);
			const italic = vi.fn((text: string) => text);
			const code = vi.fn((text: string) => text);
			const output = transformThinkingSteps(
				labels.map((label) => `# ${label}`).join("\n"),
				enabled(mode),
				context({ availableWidth: 80 }),
			);
			const rendered = new Markdown(
				output,
				0,
				0,
				{ ...identityMarkdownTheme, code, link, italic },
				undefined,
				{ preserveBackslashEscapes: false, renderLatex: true },
			).render(80);
			expect(rendered).toHaveLength(5);
			expect(link).not.toHaveBeenCalled();
			expect(italic).not.toHaveBeenCalled();
			const codeCalls = code.mock.calls.map(([value]) => value);
			expect(codeCalls).toEqual(
				mode === "rail"
					? ["│", "│", labels[0], "│", labels[1], "│", labels[2], "│", labels[3]]
					: ["┆", "├─ ·", labels[0], "├─ ·", labels[1], "├─ ·", labels[2], "└─ ·", labels[3]],
			);
			for (const label of labels) {
				expect(codeCalls.filter((value) => value === label)).toEqual([label]);
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"keeps the exact safe live regression native, one-row, and exactly truncated in %s",
		(mode) => {
			const label =
				'Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize") hack; docs say "compact rail and tree" latest commit changed semantics)';
			const expectedRows =
				mode === "rail"
					? {
							20: "│ Gaps/risks I noti…",
							80: '│ Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize") ha…',
							200: `│ ${label}`,
						}
					: {
							20: "└─ · Gaps/risks I n…",
							80: '└─ · Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize")…',
							200: `└─ · ${label}`,
						};
			for (const width of [20, 80, 200] as const) {
				const code = vi.fn((text: string) => text);
				const thinkingText = vi.fn((text: string) => text);
				const output = transformThinkingSteps(
					`# ${label}`,
					enabled(mode),
					context({ availableWidth: width }),
				);
				const rendered = new Markdown(
					output,
					0,
					0,
					{ ...identityMarkdownTheme, code },
					{ color: thinkingText, italic: true },
					{ preserveBackslashEscapes: false, renderLatex: true },
				).render(width);
				expect(output).not.toBe(`# ${label}`);
				expect(rendered).toHaveLength(2);
				expect(rendered.every((row) => visibleWidth(row) <= width)).toBe(true);
				expect(output).not.toContain("\\");
				expect(rendered[1]?.trimEnd()).toBe(expectedRows[width]);
				expect(code.mock.calls.map(([value]) => value)).toEqual(
					mode === "rail" ? ["│", "│"] : ["┆", "└─ ·"],
				);
				expect(thinkingText.mock.calls.some(([value]) => value.includes("Gaps/risks"))).toBe(true);
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"keeps adversarial provider Markdown to one bounded row without generated syntax in %s",
		(mode) => {
			const labels = [
				String.raw`literal \\ backslash and \*native escape\*`,
				"[brackets](https://example.com/path) and [literal brackets]",
				"*emphasis* _underscores_ and under_score",
				"``code ` tick`` and ```triple``` backtick runs",
				"ampersands & entities &amp; &#38;",
				"<https://example.com/path> and <tag>",
				String.raw`math \(x^2 + y^2\) and \[x+y\]`,
				"family 👨‍👩‍👧‍👦 cafe\u0301 界語 wide",
			] as const;
			for (const label of labels) {
				for (const width of [20, 80, 200]) {
					const output = transformThinkingSteps(
						`# ${label}`,
						enabled(mode),
						context({ availableWidth: width }),
					);
					expect(output).not.toBe(`# ${label}`);
					const sourceLabel = output.split("\n")[1]?.replace(/^`[^`]+` /, "") ?? "";
					expect((sourceLabel.match(/\\/g) ?? []).length).toBeLessThanOrEqual(
						(label.match(/\\/g) ?? []).length,
					);
					expect(sourceLabel.includes("👨‍👩‍👧‍👦") || !sourceLabel.includes("\u200d")).toBe(true);
					expect(sourceLabel.endsWith("\u0301")).toBe(false);
					const rendered = new Markdown(output, 0, 0, identityMarkdownTheme, undefined, {
						preserveBackslashEscapes: false,
						renderLatex: true,
					}).render(width);
					expect(rendered, `${mode} ${width} ${label}`).toHaveLength(2);
					expect(rendered.every((row) => visibleWidth(row) <= width)).toBe(true);
				}
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"isolates unclosed inline delimiters from the next %s connector",
		(mode) => {
			for (const label of ["lone ` tick", String.raw`unclosed \(math`, "$unclosed"]) {
				const source = `# ${label}\n# Next`;
				const code = vi.fn((text: string) => text);
				const rendered = new Markdown(
					transformThinkingSteps(source, enabled(mode), context()),
					0,
					0,
					{ ...identityMarkdownTheme, code },
					undefined,
					{ preserveBackslashEscapes: false, renderLatex: true },
				).render(80);
				expect(rendered).toHaveLength(3);
				expect(rendered[1]?.trimEnd()).toContain(label);
				expect(rendered[2]?.trimEnd()).toContain("Next");
				expect(code.mock.calls.map(([value]) => value).filter((value) => value === label)).toEqual([
					label,
				]);
			}
		},
	);

	it.each(["rail", "tree"] as const)(
		"keeps provider block-like label text inside the prefixed paragraph in %s",
		(mode) => {
			const heading = vi.fn((text: string) => text);
			const listBullet = vi.fn((text: string) => text);
			const quote = vi.fn((text: string) => text);
			const output = transformThinkingSteps(
				"# # nested heading\n# - nested list\n# > nested quote",
				enabled(mode),
				context({ availableWidth: 80 }),
			);
			const rendered = new Markdown(output, 0, 0, {
				...identityMarkdownTheme,
				heading,
				listBullet,
				quote,
			}).render(80);
			expect(rendered).toHaveLength(4);
			expect(heading).not.toHaveBeenCalled();
			expect(listBullet).not.toHaveBeenCalled();
			expect(quote).not.toHaveBeenCalled();
		},
	);

	it("caps labels by display width independently of source length", () => {
		const output = transformThinkingSteps(
			`# ${"界".repeat(100)}`,
			enabled("rail"),
			context({ availableWidth: 1_000 }),
		);
		const renderedLabel = output.split("\n")[1]?.replace(/^`│` /, "") ?? "";
		expect(visibleWidth(renderedLabel)).toBeLessThanOrEqual(THINKING_STEPS_MAX_LABEL_WIDTH);
		expect(renderedLabel.endsWith("…")).toBe(true);
	});

	it("keeps the maximum all-label Rail rendering within the generated-output boundary", () => {
		const source = Array.from(
			{ length: THINKING_STEPS_MAX_STEPS },
			() => `# A${"*".repeat(507)}`,
		).join("\n");
		const output = transformThinkingSteps(
			source,
			enabled("rail"),
			context({ availableWidth: 1_000 }),
		);
		expect(output).not.toBe(source);
		expect(output.split("\n")).toHaveLength(THINKING_STEPS_MAX_STEPS + 1);
		expect(output.length).toBeLessThanOrEqual(THINKING_STEPS_MAX_OUTPUT_LENGTH);
	});

	it("bounds Tree rendering to its latest five labels even at the parser limit", () => {
		const source = Array.from(
			{ length: THINKING_STEPS_MAX_STEPS },
			(_, index) => `# Label ${index + 1}`,
		).join("\n");
		const output = transformThinkingSteps(source, enabled("tree"), context());
		expect(output.split("\n")).toHaveLength(6);
		expect(output).toContain("Label 124");
		expect(output).toContain("Label 128");
		expect(output).not.toContain("Label 123");
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
		expect(source).toContain("riskyLabelPattern");
		expect(source).toContain("longestBacktickRun + 1");
		expect(source).not.toContain("hasUnclosedInlineDelimiter");
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
const RAIL_TITLE = "\`│\` **Thinking**";
const TREE_TITLE = "\`┆\` **Thinking**";
const TITLE_VISIBLE_WIDTH = visibleWidth("│ Thinking");`;
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

describe("Thinking-step public documentation", () => {
	it("documents connector, safe-label, and risky-label color semantics honestly", () => {
		for (const path of ["README.md", "docs/configuration.md"]) {
			const documentation = readFileSync(join(import.meta.dirname, "..", path), "utf8");
			expect(documentation).toMatch(/theme-native `mdCode` color/);
			expect(documentation).toMatch(/Plain safe labels/);
			expect(documentation).toMatch(/Markdown-risky/);
			expect(documentation).toMatch(/bare (?:protocol|`http`)/);
			expect(documentation).toMatch(/email address/);
			expect(documentation).toMatch(/any other retained `@` character/);
			expect(documentation).toMatch(/mdCode/);
			expect(documentation).toMatch(/no exact|No exact/);
			expect(documentation).toMatch(
				/Rail (?:omits|settled rows are).*no dot|Rail omits settled dots/s,
			);
		}
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
		expect(callback?.("# One\n# Two", context())).toBe("`│` **Thinking**  \n`│` One  \n`│` Two");
		config = enabled("tree");
		expect(callback?.("# One\n# Two", context())).toBe(
			"`┆` **Thinking**  \n`├─ ·` One  \n`└─ ·` Two",
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
