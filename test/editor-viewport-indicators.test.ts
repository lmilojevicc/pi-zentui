import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import { WrappedPolishedEditor } from "../extensions/zentui/ui";

function theme(): Theme {
	return {
		fg(_color: string, text: string) {
			return text;
		},
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		inverse: (text: string) => text,
	} as Theme;
}

function config(features: Partial<PolishedTuiConfig["features"]> = {}): PolishedTuiConfig {
	return { ...defaultConfig, features: { ...defaultConfig.features, ...features } };
}

function nativeBorder(
	width: number,
	direction: "above" | "below",
	count?: number,
	ansi = false,
): string {
	const plain = count
		? `─── ${direction === "above" ? "↑" : "↓"} ${count} more ${"─".repeat(
				Math.max(0, width - `─── ↑ ${count} more `.length),
			)}`
		: "─".repeat(width);
	return ansi ? `\x1b[90m${plain}\x1b[0m` : plain;
}

function baseEditor(options: {
	above?: number;
	below?: number;
	ansi?: boolean;
	malformedTop?: string;
	autocomplete?: string[];
}) {
	const autocomplete = options.autocomplete ?? [];
	return {
		render(width: number) {
			return [
				options.malformedTop ?? nativeBorder(width, "above", options.above, options.ansi),
				"typed text",
				nativeBorder(width, "below", options.below, options.ansi),
				...autocomplete,
			];
		},
		invalidate() {},
		handleInput() {},
		getText: () => "typed text",
		setText() {},
		isShowingAutocomplete: () => autocomplete.length > 0,
		autocompleteList: { render: () => autocomplete },
	};
}

function wrapped(
	base: ReturnType<typeof baseEditor> | WrappedPolishedEditor,
	features: Partial<PolishedTuiConfig["features"]> = {},
): WrappedPolishedEditor {
	return new WrappedPolishedEditor(
		base as never,
		theme(),
		() => config(features),
		() => ({ modelLabel: "model", providerLabel: "provider" }),
		() => "off",
	);
}

describe("editor viewport indicators", () => {
	it.each([
		[7, undefined, "↑ 7 more", undefined],
		[undefined, 11, undefined, "↓ 11 more"],
		[7, 11, "↑ 7 more", "↓ 11 more"],
	] as const)(
		"preserves top and bottom native counts (above=%s, below=%s)",
		(above, below, topText, bottomText) => {
			const lines = wrapped(baseEditor({ above, below, ansi: true })).render(80);
			if (topText) expect(lines[0]).toContain(topText);
			else expect(lines[0]).not.toContain("more");
			if (bottomText) expect(lines.at(-1)).toContain(bottomText);
			else expect(lines.at(-1)).not.toContain("more");
		},
	);

	it("preserves large counts at ample width and clamps them at narrow ANSI-aware widths", () => {
		const count = 123456789;
		const editor = wrapped(baseEditor({ above: count, below: count, ansi: true }));

		const ampleLines = editor.render(80);
		expect(ampleLines[0]).toContain(`↑ ${count} more`);
		expect(ampleLines.at(-1)).toContain(`↓ ${count} more`);

		const narrowLines = editor.render(12);
		expect(visibleWidth(narrowLines[0] ?? "")).toBe(12);
		expect(visibleWidth(narrowLines.at(-1) ?? "")).toBe(12);
		expect(narrowLines[0]).toContain("↑");
		expect(narrowLines.at(-1)).toContain("↓");
		expect(narrowLines[0]).not.toContain(`${count} more`);
		expect(narrowLines.at(-1)).not.toContain(`${count} more`);
	});

	it("uses plain polished borders when viewport indicators are disabled", () => {
		const lines = wrapped(baseEditor({ above: 4, below: 9 }), {
			viewportIndicators: false,
		}).render(80);
		expect(lines[0]).not.toContain("more");
		expect(lines.at(-1)).not.toContain("more");
		expect(lines[0]).toMatch(/^─+$/);
		expect(lines.at(-1)).toMatch(/^─+$/);
	});

	it("carries counts through nested polished wrappers without double-framing", () => {
		const inner = wrapped(baseEditor({ above: 3, below: 8 }));
		const lines = wrapped(inner).render(80);
		const rendered = lines.join("\n");
		expect(rendered.match(/↑ 3 more/g)).toHaveLength(1);
		expect(rendered.match(/↓ 8 more/g)).toHaveLength(1);
		expect(lines.filter((line) => line.startsWith("───") || /^─+$/.test(line))).toHaveLength(2);
		expect(rendered.match(/model/g)).toHaveLength(1);

		const narrowLines = wrapped(inner).render(8);
		expect(narrowLines).toHaveLength(6);
		expect(narrowLines[0]).toContain("↑");
		expect(narrowLines.at(-1)).toContain("↓");
	});

	it("keeps autocomplete rows after the counted bottom border", () => {
		const suggestions = ["suggestion-one", "suggestion-two"];
		const lines = wrapped(baseEditor({ below: 5, autocomplete: suggestions })).render(80);
		const bottom = lines.findIndex((line) => line.includes("↓ 5 more"));
		expect(bottom).toBeGreaterThanOrEqual(0);
		for (const suggestion of suggestions) {
			expect(lines.findIndex((line) => line.includes(suggestion))).toBeGreaterThan(bottom);
		}
	});

	it.each([
		"── ↑ 7 more ─────────",
		"─── ↓ 7 more ─────────",
		"─── ↑ 07 more ─────────",
		"prefix ─── ↑ 7 more ─────────",
		"[muted]─── ↑ 7 more ─────────[/muted]",
	])("fails open for an unknown top border form: %s", (malformedTop) => {
		const lines = wrapped(baseEditor({ below: 2, malformedTop })).render(80);
		expect(lines[0]).toBe(malformedTop);
		expect(lines).toContain("typed text");
		expect(lines.at(-1)).toContain("↓ 2 more");
	});

	it("preserves every row from a minimal public-contract third-party editor", () => {
		let text = "draft";
		const inputs: string[] = [];
		const base = {
			render: () => ["third-party header", text, "third-party help"],
			invalidate() {},
			handleInput(data: string) {
				inputs.push(data);
				text += data;
			},
			getText: () => text,
			setText(next: string) {
				text = next;
			},
		};
		const editor = wrapped(base as never);

		expect(editor.render(80)).toEqual(["third-party header", "draft", "third-party help"]);
		editor.handleInput("!");
		expect(editor.getText()).toBe("draft!");
		expect(inputs).toEqual(["!"]);
	});

	it("preserves autocomplete rows when Pi-private inspection fields are absent", () => {
		const base = {
			render: (width: number) => [
				nativeBorder(width, "above"),
				"typed text",
				nativeBorder(width, "below"),
				"suggestion-one",
				"suggestion-two",
			],
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};

		const lines = wrapped(base as never).render(80);
		expect(lines).toContain("typed text");
		expect(lines).toContain("suggestion-one");
		expect(lines).toContain("suggestion-two");
		expect(lines).toHaveLength(5);
	});

	it.each(["visibility method", "autocomplete getter", "autocomplete render"])(
		"returns base rows when %s throws",
		(failure) => {
			const rendered = ["header", "typed text", "suggestion"];
			const base: Record<string, unknown> = {
				render: () => rendered,
				invalidate() {},
				handleInput() {},
				getText: () => "typed text",
				setText() {},
			};
			if (failure === "visibility method") {
				base.isShowingAutocomplete = () => {
					throw new Error("visibility failed");
				};
			} else {
				base.isShowingAutocomplete = () => true;
				if (failure === "autocomplete getter") {
					Object.defineProperty(base, "autocompleteList", {
						get() {
							throw new Error("getter failed");
						},
					});
				} else {
					base.autocompleteList = {
						render() {
							throw new Error("render failed");
						},
					};
				}
			}

			expect(wrapped(base as never).render(80)).toEqual(rendered);
		},
	);

	it("does not trust or invoke a generic editor's spoofed polished-frame splitter", () => {
		const widths: number[] = [];
		const spoofedSplit = vi.fn(() => ({
			editorLines: ["spoofed"],
			trailingLines: [],
			viewport: {},
		}));
		const base = {
			render(width: number) {
				widths.push(width);
				return [nativeBorder(width, "above"), "typed text", nativeBorder(width, "below")];
			},
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
			[Symbol.for("pi-zentui.polished-frame")]: spoofedSplit,
		};
		expect(wrapped(base as never).render(80)).toEqual([
			nativeBorder(80, "above"),
			"typed text",
			nativeBorder(80, "below"),
		]);
		expect(widths).toEqual([78, 80]);
		expect(spoofedSplit).not.toHaveBeenCalled();
	});

	it("fails open for polished-looking rows without exact module-owned array provenance", () => {
		const trusted = wrapped(baseEditor({ above: 2, below: 3 })).render(80);
		const staleClone = trusted.slice();
		const base = {
			render: () => staleClone,
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};

		const lines = wrapped(base as never).render(80);
		expect(lines).toEqual(staleClone);
		expect(lines.join("\n").match(/model/g)).toHaveLength(1);
	});

	it("rejects in-place mutation of an otherwise provenance-owned rendered array", () => {
		const rendered = wrapped(baseEditor({ above: 2, below: 3 })).render(80);
		rendered[1] = "changed-row";
		rendered.splice(2, 0, "added-row");
		const base = {
			render: () => rendered,
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};

		const lines = wrapped(base as never).render(80);
		expect(lines).toEqual(rendered);
		expect(lines).toContain("changed-row");
		expect(lines).toContain("added-row");
	});

	it("falls back to caller-width rendering when the inner-width probe throws", () => {
		const widths: number[] = [];
		const base = {
			render(width: number) {
				widths.push(width);
				if (width < 80) throw new Error("inner-width render failed");
				return ["caller-width-header", "x".repeat(width + 4), "caller-width-help"];
			},
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};

		const lines = wrapped(base as never).render(80);
		expect(widths).toEqual([78, 80]);
		expect(lines[0]).toBe("caller-width-header");
		expect(lines.at(-1)).toBe("caller-width-help");
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("re-renders unknown third-party output at the caller width before failing open", () => {
		const widths: number[] = [];
		const base = {
			render(width: number) {
				widths.push(width);
				return [`header-${width}`, "x".repeat(width + 5), `help-${width}`];
			},
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};

		const lines = wrapped(base as never).render(80);
		expect(widths).toEqual([78, 80]);
		expect(lines[0]).toBe("header-80");
		expect(lines.at(-1)).toBe("help-80");
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("only exposes optional editor methods implemented by the base", () => {
		const withoutCapabilities = wrapped({
			render: () => ["plain"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
		} as never);
		for (const method of [
			"addToHistory",
			"insertTextAtCursor",
			"setAutocompleteProvider",
			"setPaddingX",
			"setAutocompleteMaxVisible",
		]) {
			expect(method in withoutCapabilities).toBe(false);
		}

		const calls: string[] = [];
		const withCapabilities = wrapped({
			render: () => ["plain"],
			invalidate() {},
			handleInput() {},
			getText: () => "",
			setText() {},
			addToHistory: () => calls.push("history"),
			insertTextAtCursor: () => calls.push("insert"),
			setAutocompleteProvider: () => calls.push("autocomplete"),
			setPaddingX: () => calls.push("padding"),
			setAutocompleteMaxVisible: () => calls.push("max-visible"),
		} as never);
		withCapabilities.addToHistory?.("history");
		withCapabilities.insertTextAtCursor?.("insert");
		withCapabilities.setAutocompleteProvider?.({} as never);
		withCapabilities.setPaddingX?.(1);
		withCapabilities.setAutocompleteMaxVisible?.(5);
		expect(calls).toEqual(["history", "insert", "autocomplete", "padding", "max-visible"]);
	});

	it("keeps every rendered line within narrow ANSI-aware widths in both chrome modes", () => {
		for (const copyFriendly of [false, true]) {
			for (const width of [3, 8, 12, 16]) {
				const lines = wrapped(baseEditor({ above: 12, below: 34, ansi: true }), {
					copyFriendly,
				}).render(width);
				expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			}
		}
	});

	it("matches Pi's complete native form rather than reconstructing a truncated count", () => {
		const truncatedNativeTop = truncateToWidth("─── ↑ 12 more ", 10, "");
		const lines = wrapped(baseEditor({ below: 1, malformedTop: truncatedNativeTop })).render(40);
		expect(lines[0]).toBe(truncatedNativeTop);
	});
});
