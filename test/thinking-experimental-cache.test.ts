import * as PiTui from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingStepsRows } from "../extensions/zentui/thinking-experimental";
import { parseThinkingSteps } from "../extensions/zentui/thinking-steps";

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
	const original = await importOriginal<typeof PiTui>();
	return {
		...original,
		visibleWidth: vi.fn(original.visibleWidth),
		truncateToWidth: vi.fn(original.truncateToWidth),
	};
});

const identity = (text: string) => text;
const markdownTheme = Object.fromEntries(
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
	].map((key) => [key, identity]),
) as unknown as PiTui.MarkdownTheme;

function fixture(
	source = `# **界👩🏽‍💻é** ${"long label ".repeat(20)}`,
	mode: "tree" | "rail" = "tree",
) {
	const native = new PiTui.Markdown(source, 1, 0, markdownTheme);
	const steps = parseThinkingSteps(source);
	if (!steps) throw new Error("fixture must parse");
	let accent = "\x1b[35m";
	let theme = { fg: vi.fn((_: "accent", text: string) => `${accent}${text}\x1b[0m`) };
	const getTheme = vi.fn(() => theme);
	const presented = vi.fn();
	const invalidated = vi.fn();
	const component = new ThinkingStepsRows(
		native,
		{ text: source, paddingX: 1, paddingY: 0, theme: markdownTheme },
		steps,
		mode,
		true,
		getTheme,
		presented,
		invalidated,
	);
	return {
		component,
		native,
		presented,
		invalidated,
		getTheme,
		setAccent(value: string) {
			accent = value;
		},
		replaceTheme() {
			theme = { fg: vi.fn((_, text) => `\x1b[36m${text}\x1b[0m`) };
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("ThinkingStepsRows successful-output cache", () => {
	it.each(["tree", "rail"] as const)(
		"avoids Markdown, width, cropping and connector decoration for unchanged historical %s rows",
		(mode) => {
			const value = fixture(undefined, mode);
			const render = vi.spyOn(PiTui.Markdown.prototype, "render");
			const expected = value.component.render(40);
			expect(PiTui.truncateToWidth).toHaveBeenCalled();
			const theme = value.getTheme.mock.results[0].value;
			render.mockClear();
			vi.mocked(PiTui.visibleWidth).mockClear();
			vi.mocked(PiTui.truncateToWidth).mockClear();
			theme.fg.mockClear();
			for (let index = 0; index < 20; index++) {
				const output = value.component.render(40);
				expect(output).toEqual(expected);
				expect(output).not.toBe(expected);
			}
			expect(render).not.toHaveBeenCalled();
			expect(PiTui.visibleWidth).not.toHaveBeenCalled();
			expect(PiTui.truncateToWidth).not.toHaveBeenCalled();
			expect(theme.fg).not.toHaveBeenCalled();
			expect(value.getTheme).toHaveBeenCalledTimes(21);
			expect(value.presented.mock.calls).toEqual(Array.from({ length: 21 }, () => [true]));
		},
	);

	it("does not expose cached arrays to container/decorator mutation", () => {
		const value = fixture();
		const first = value.component.render(80);
		const expected = [...first];
		first[0] = "changed";
		first.push("extra");
		const second = value.component.render(80);
		expect(second).toEqual(expected);
		second.splice(0);
		expect(value.component.render(80)).toEqual(expected);
	});

	it("retains one width only across A → B → A and recovers after zero/narrow native fallback", () => {
		const value = fixture();
		const render = vi.spyOn(PiTui.Markdown.prototype, "render");
		const first = value.component.render(80);
		value.component.render(20);
		render.mockClear();
		expect(value.component.render(80)).toEqual(first);
		expect(render).toHaveBeenCalledTimes(2);
		for (const width of [0, 1, 2]) {
			expect(value.component.render(width)).toEqual(value.native.render(width));
			expect(value.presented.mock.lastCall).toEqual([false]);
			render.mockClear();
			expect(value.component.render(80)).toEqual(first);
			expect(render).toHaveBeenCalledTimes(2);
		}
	});

	it("clears output independently of parsed content and propagates every invalidation callback", () => {
		const value = fixture();
		const first = value.component.render(80);
		const invalidate = vi.spyOn(PiTui.Markdown.prototype, "invalidate");
		const render = vi.spyOn(PiTui.Markdown.prototype, "render");
		for (let index = 1; index <= 2; index++) {
			value.component.invalidate();
			expect(value.invalidated).toHaveBeenCalledTimes(index);
			expect(invalidate).toHaveBeenCalledTimes(index * 3);
			render.mockClear();
			expect(value.component.render(80)).toEqual(first);
			expect(render).toHaveBeenCalledTimes(2);
		}
	});

	it("refreshes same-object theme mutation on invalidate and replacement identity without invalidate", () => {
		const value = fixture();
		const first = value.component.render(80);
		value.setAccent("\x1b[32m");
		value.component.invalidate();
		const mutated = value.component.render(80);
		expect(mutated).not.toEqual(first);
		expect(mutated[0]).toContain("\x1b[32m");
		value.replaceTheme();
		const replaced = value.component.render(80);
		expect(replaced).not.toEqual(mutated);
		expect(replaced[0]).toContain("\x1b[36m");
		expect(value.component.render(80)).toEqual(replaced);
	});

	it("rebuilds inline Markdown colors after same-object mutation and invalidation", () => {
		const value = fixture("# **styled label**");
		const first = value.component.render(80);
		const previous = markdownTheme.bold;
		try {
			markdownTheme.bold = (text) => `\x1b[31m${text}\x1b[0m`;
			value.component.invalidate();
			const refreshed = value.component.render(80);
			expect(refreshed).not.toEqual(first);
			expect(refreshed[1]).toContain("\x1b[31m");
		} finally {
			markdownTheme.bold = previous;
		}
	});

	it("does not cache error fallback or resurrect old success after a failed theme lookup", () => {
		const value = fixture();
		const first = value.component.render(80);
		value.getTheme.mockImplementationOnce(() => {
			throw new Error("theme unavailable");
		});
		expect(value.component.render(80)).toEqual(value.native.render(80));
		expect(value.presented.mock.lastCall).toEqual([false]);
		const render = vi.spyOn(PiTui.Markdown.prototype, "render");
		expect(value.component.render(80)).toEqual(first);
		expect(render).toHaveBeenCalledTimes(2);
		expect(value.presented.mock.calls).toEqual([[true], [false], [true]]);
	});

	it.each(["empty", "throw"] as const)("retries derived Markdown after %s fallback", (failure) => {
		const value = fixture("# retry label");
		const original = PiTui.Markdown.prototype.render;
		const render = vi.spyOn(PiTui.Markdown.prototype, "render").mockImplementation(function (
			this: PiTui.Markdown,
			width,
		) {
			if ((this as unknown as { text: string }).text === "retry label") {
				if (failure === "throw") throw new Error("derived failure");
				return [];
			}
			return Reflect.apply(original, this, [width]);
		});
		expect(value.component.render(80)).toEqual(value.native.render(80));
		expect(value.presented.mock.lastCall).toEqual([false]);
		render.mockRestore();
		expect(value.component.render(80)[1]).toContain("retry label");
		expect(value.presented.mock.lastCall).toEqual([true]);
	});

	it("clears output before a throwing invalidation callback without changing its exception", () => {
		const value = fixture();
		const first = value.component.render(80);
		const error = new Error("invalidation callback failed");
		value.invalidated.mockImplementationOnce(() => {
			throw error;
		});
		expect(() => value.component.invalidate()).toThrow(error);
		const render = vi.spyOn(PiTui.Markdown.prototype, "render");
		expect(value.component.render(80)).toEqual(first);
		expect(render).toHaveBeenCalledTimes(2);
	});

	it("keeps presentation callback errors behind native fallback even on cache hits", () => {
		const value = fixture();
		const first = value.component.render(80);
		value.presented.mockImplementationOnce(() => {
			throw new Error("presentation failed");
		});
		expect(value.component.render(80)).toEqual(value.native.render(80));
		expect(value.presented.mock.calls).toEqual([[true], [true], [false]]);
		const render = vi.spyOn(PiTui.Markdown.prototype, "render");
		expect(value.component.render(80)).toEqual(first);
		expect(render).toHaveBeenCalledTimes(2);
	});

	it("preserves repeated native fallback and does not look up a theme for unsafe image labels", () => {
		const value = fixture("# ![image](asset.png)");
		for (let index = 0; index < 2; index++) {
			expect(value.component.render(80)).toEqual(value.native.render(80));
		}
		expect(value.getTheme).not.toHaveBeenCalled();
		expect(value.presented.mock.calls).toEqual([[false], [false]]);
	});
});
