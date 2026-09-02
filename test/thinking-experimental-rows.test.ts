import { Markdown, type MarkdownTheme, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createThinkingStepsRows } from "../extensions/zentui/thinking-experimental";
import { parseThinkingSteps } from "../extensions/zentui/thinking-steps";

const identityTheme = Object.fromEntries(
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

function plain(row: string): string {
	return row
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.trimEnd();
}

function rows(
	source: string,
	mode: "rail" | "tree",
	width = 80,
	incomplete = false,
	paddingX = 0,
	markdownTheme = identityTheme,
	options: ConstructorParameters<typeof Markdown>[5] = { renderLatex: true },
) {
	const style = { color: (text: string) => text, italic: true };
	const native = new Markdown(source, paddingX, 0, markdownTheme, style, options);
	const steps = parseThinkingSteps(source);
	if (!steps) throw new Error("fixture must parse");
	const accent = vi.fn((_: "accent", text: string) => `\x1b[35m${text}\x1b[0m`);
	const component = createThinkingStepsRows(
		native,
		{
			text: source,
			paddingX,
			paddingY: 0,
			theme: markdownTheme,
			defaultTextStyle: style,
			options,
		},
		steps,
		mode,
		incomplete,
		() => ({ fg: accent }),
	);
	return { rendered: component.render(width), component, native, accent };
}

describe("Experimental native Rail/Tree rows", () => {
	it("renders all Rail labels and the latest five Tree labels with active/settled markers", () => {
		const source = Array.from({ length: 7 }, (_, index) => `# Label ${index + 1}`).join("\n");
		expect(rows(source, "rail", 80, true).rendered.map(plain)).toEqual([
			"│ Thinking",
			"│ Label 1",
			"│ Label 2",
			"│ Label 3",
			"│ Label 4",
			"│ Label 5",
			"│ Label 6",
			"│ • Label 7",
		]);
		expect(rows(source, "tree").rendered.map(plain)).toEqual([
			"┆ Thinking",
			"├─ · Label 3",
			"├─ · Label 4",
			"├─ · Label 5",
			"├─ · Label 6",
			"└─ · Label 7",
		]);
	});

	it.each(["rail", "tree"] as const)(
		"renders SGR-decorated thinking structurally in %s without carrying source SGR forward",
		(mode) => {
			const truecolor = "\x1b[38;2;137;180;250m";
			const muted = "\x1b[38;2;186;194;222m";
			const reset = "\x1b[39m";
			const source = `${truecolor}# First${reset}\n${muted}body${reset}\n${truecolor}# Second${reset}`;
			const output = rows(source, mode).rendered;
			expect(output.map(plain)).toEqual(
				mode === "rail"
					? ["│ Thinking", "│ First", "│ Second"]
					: ["┆ Thinking", "├─ · First", "└─ · Second"],
			);
			expect(output.join("\n")).not.toContain(truecolor);
			expect(output.join("\n")).not.toContain(muted);
			expect(output.join("\n")).not.toContain(reset);
		},
	);

	it("fails open when stripping SGR reconstructs image syntax", () => {
		const source = "# ![im\x1b[31mage](asset.png)";
		const value = rows(source, "tree");
		expect(value.rendered).toEqual(value.native.render(80));
	});

	it("preserves native label Markdown callbacks and accents connectors separately", () => {
		const italic = vi.fn((text: string) => `<i>${text}</i>`);
		const code = vi.fn((text: string) => `<c>${text}</c>`);
		const link = vi.fn((text: string) => `<a>${text}</a>`);
		const current = rows("# *emphasis* `code` [link](https://example.com)", "rail", 80, false, 0, {
			...identityTheme,
			italic,
			code,
			link,
		});
		current.rendered.map(plain);
		expect(italic).toHaveBeenCalled();
		expect(code).toHaveBeenCalledWith("code");
		expect(link).toHaveBeenCalled();
		expect(current.accent).toHaveBeenCalledWith("accent", "│ ");
	});

	it("preserves host transform, HTML, and literal-LaTeX behavior on fresh label Markdown", () => {
		const capabilityTransform = vi.fn(() => "**transformed-capability**");
		const capabilityOutput = plain(
			new Markdown(
				"plain-capability",
				0,
				0,
				{
					...identityTheme,
					bold: (text) => `<b>${text}</b>`,
				},
				undefined,
				{
					transform: capabilityTransform,
				},
			).render(78)[0] ?? "",
		);
		const hostExecutesTransform = capabilityOutput === "<b>transformed-capability</b>";
		expect(capabilityOutput).toBe(
			hostExecutesTransform ? "<b>transformed-capability</b>" : "plain-capability",
		);
		expect(capabilityTransform).toHaveBeenCalledTimes(hostExecutesTransform ? 1 : 0);

		const source = "native <span>HTML</span> $x^2$";
		const transform = vi.fn((text: string) => text.replace("native", "**native**"));
		const bold = vi.fn((text: string) => `<b>${text}</b>`);
		const theme = { ...identityTheme, bold };
		const options = { transform, renderLatex: false };
		const nativeLabel = plain(
			new Markdown(source, 0, 0, theme, undefined, options).render(78)[0] ?? "",
		);
		expect(nativeLabel).toContain("$x^2$");
		expect(transform).toHaveBeenCalledTimes(hostExecutesTransform ? 1 : 0);
		transform.mockClear();
		bold.mockClear();

		const output = rows(`# ${source}`, "rail", 80, false, 0, theme, options).rendered.map(plain);
		expect(output[1]).toBe(`│ ${nativeLabel}`);
		if (hostExecutesTransform) {
			expect(transform.mock.calls).toEqual([
				["**Thinking**", 78],
				[source, 78],
			]);
			expect(bold.mock.calls).toEqual([["Thinking"], ["native"]]);
		} else {
			expect(transform).not.toHaveBeenCalled();
			expect(bold.mock.calls).toEqual([["Thinking"]]);
		}
		expect(output[1]).toContain("HTML");
		expect(output[1]).toContain("$x^2$");
	});

	it.each([
		{
			name: "ordered-list source markers",
			source: "7) ordered marker",
			option: "preserveOrderedListMarkers" as const,
			expectedWhenSupported: "7) ordered marker",
			expectedWhenDisabled: "7. ordered marker",
		},
		{
			name: "backslash escapes",
			source: String.raw`escaped \*asterisks\*`,
			option: "preserveBackslashEscapes" as const,
			expectedWhenSupported: String.raw`escaped \*asterisks\*`,
			expectedWhenDisabled: "escaped *asterisks*",
		},
	])("preserves $name behavior exactly when the host supports it", (fixture) => {
		const enabledOptions = { [fixture.option]: true, renderLatex: false };
		const disabledOptions = { [fixture.option]: false, renderLatex: false };
		const nativeEnabled = plain(
			new Markdown(fixture.source, 0, 0, identityTheme, undefined, enabledOptions).render(78)[0] ??
				"",
		);
		const nativeDisabled = plain(
			new Markdown(fixture.source, 0, 0, identityTheme, undefined, disabledOptions).render(78)[0] ??
				"",
		);
		const output = rows(
			`# ${fixture.source}`,
			"rail",
			80,
			false,
			0,
			identityTheme,
			enabledOptions,
		).rendered.map(plain);

		expect(nativeDisabled).toBe(fixture.expectedWhenDisabled);
		expect(output[1]).toBe(`│ ${nativeEnabled}`);
		if (nativeEnabled !== nativeDisabled) {
			expect(nativeEnabled).toBe(fixture.expectedWhenSupported);
		} else {
			expect(output[1]).toBe(`│ ${nativeDisabled}`);
		}
	});

	it.each(["界語 emoji 👨‍👩‍👧‍👦", "cafe\u0301 punctuation /().;:"])(
		"crops %s to one ANSI-safe bounded row",
		(label) => {
			for (const width of [10, 20, 80]) {
				const rendered = rows(`# ${label.repeat(10)}`, "tree", width, true).rendered;
				expect(rendered).toHaveLength(2);
				expect(rendered.every((row) => visibleWidth(row) <= width)).toBe(true);
				expect(plain(rendered[1] ?? "")).toContain("…");
			}
		},
	);

	it("uses one-cell ellipsis, preserves outer padding, and invalidates derived Markdown", () => {
		const value = rows("# long label", "rail", 5, false, 1);
		expect(value.rendered.every((row) => visibleWidth(row) <= 5)).toBe(true);
		expect(plain(value.rendered[1] ?? "")).toBe(" │ …");
		const invalidate = vi.spyOn(value.native, "invalidate");
		value.component.invalidate();
		expect(invalidate).toHaveBeenCalledOnce();
	});

	it("renders an Error label through native Markdown semantics", () => {
		const value = rows("# Error: **retry** with `safe-code`", "rail");
		expect(value.rendered.map(plain)).toEqual(["│ Thinking", "│ Error: retry with safe-code"]);
	});

	it("fails open to the complete native run for an image label", () => {
		const value = rows("# ![image](asset.png)", "rail");
		expect(value.rendered).toEqual(value.native.render(80));
	});

	it.each(["empty", "throw"] as const)(
		"fails open to the complete native run when a derived label render is %s",
		(failure) => {
			const original = Markdown.prototype.render;
			const render = vi
				.spyOn(Markdown.prototype, "render")
				.mockImplementation(function derivedFailure(this: Markdown, width: number) {
					const text = (this as unknown as { text?: string }).text;
					if (text === "fallback label") {
						if (failure === "throw") throw new Error("derived render failed");
						return [];
					}
					return Reflect.apply(original, this, [width]);
				});
			try {
				const value = rows("# fallback label", "rail");
				expect(value.rendered).toEqual(value.native.render(80));
			} finally {
				render.mockRestore();
			}
		},
	);

	it("fails open to native rows when current-theme connector rendering throws", () => {
		const source = "# theme fallback";
		const native = new Markdown(source, 0, 0, identityTheme);
		const steps = parseThinkingSteps(source);
		if (!steps) throw new Error("fixture must parse");
		const component = createThinkingStepsRows(
			native,
			{ text: source, paddingX: 0, paddingY: 0, theme: identityTheme },
			steps,
			"tree",
			false,
			() => {
				throw new Error("theme unavailable");
			},
		);
		expect(component.render(80)).toEqual(native.render(80));
	});
});
