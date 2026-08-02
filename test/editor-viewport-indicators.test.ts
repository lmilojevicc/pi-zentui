import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
	defaultConfig,
	type EditorStyle,
	type PolishedTuiConfig,
} from "../extensions/zentui/config";
import { FIXED_EDITOR_LAYOUT } from "../extensions/zentui/fixed-editor/editor-layout";
import { planFixedLayout } from "../extensions/zentui/fixed-editor/layout";
import {
	PolishedEditor,
	renderWithAutocompleteCapture,
	WrappedPolishedEditor,
} from "../extensions/zentui/ui";

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

type EditorOptions = Partial<PolishedTuiConfig["features"]> & { style?: EditorStyle };

function config(
	options: EditorOptions = {},
	editorBorderColorMode: PolishedTuiConfig["editorBorderColorMode"] = "static",
): PolishedTuiConfig {
	return {
		...defaultConfig,
		components: {
			...defaultConfig.components,
			editor: {
				...defaultConfig.components.editor,
				style: options.style ?? defaultConfig.components.editor.style,
				borderColorMode: editorBorderColorMode,
				viewportIndicators:
					options.viewportIndicators ?? defaultConfig.components.editor.viewportIndicators,
			},
		},
		features: {
			...defaultConfig.features,
			...(options.editor === undefined ? {} : { editor: options.editor }),
			...(options.statusLine === undefined ? {} : { statusLine: options.statusLine }),
			...(options.viewportIndicators === undefined
				? {}
				: { viewportIndicators: options.viewportIndicators }),
		},
	};
}

function withEditorStyle(
	base: PolishedTuiConfig,
	style: PolishedTuiConfig["components"]["editor"]["style"],
): PolishedTuiConfig {
	return {
		...base,
		components: {
			...base.components,
			editor: { ...base.components.editor, style },
		},
	};
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
	const autocompleteList = {
		filteredItems: autocomplete.map((value) => ({ value })),
		selectedIndex: 0,
		maxVisible: Math.max(1, autocomplete.length),
		render: (_width?: number) => autocomplete,
	};
	return {
		render(width: number) {
			return [
				options.malformedTop ?? nativeBorder(width, "above", options.above, options.ansi),
				"typed text",
				nativeBorder(width, "below", options.below, options.ansi),
				...(autocomplete.length > 0 ? autocompleteList.render(width) : []),
			];
		},
		invalidate() {},
		handleInput() {},
		getText: () => "typed text",
		setText() {},
		isShowingAutocomplete: () => autocomplete.length > 0,
		autocompleteList,
	};
}

function wrapped(
	base: ReturnType<typeof baseEditor> | WrappedPolishedEditor,
	features: EditorOptions = {},
	editorBorderColorMode: PolishedTuiConfig["editorBorderColorMode"] = "static",
): WrappedPolishedEditor {
	return new WrappedPolishedEditor(
		base as never,
		theme(),
		() => config(features, editorBorderColorMode),
		() => ({ modelLabel: "model", providerLabel: "provider" }),
		() => "off",
	);
}

function standalone(style: EditorStyle = "opencode"): PolishedEditor {
	const editor = new PolishedEditor(
		{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
		{ borderColor: (text: string) => text, selectList: {} } as never,
		{} as never,
		theme(),
		() => config({ style }),
		() => ({ modelLabel: "model", providerLabel: "provider" }),
		() => "off",
	);
	editor.setText("typed text");
	return editor;
}

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type SemanticBorderState = (typeof thinkingLevels)[number] | "shell";

const semanticBorderCodes: Record<SemanticBorderState, number> = {
	off: 30,
	minimal: 31,
	low: 32,
	medium: 33,
	high: 34,
	xhigh: 35,
	shell: 36,
};

function semanticTheme(): Theme {
	const base = theme();
	return {
		...base,
		getThinkingBorderColor(level) {
			const code = semanticBorderCodes[level as (typeof thinkingLevels)[number]] ?? 37;
			return (text: string) => `\x1b[${code}m${text}\x1b[0m`;
		},
		getBashModeBorderColor() {
			return (text: string) => `\x1b[${semanticBorderCodes.shell}m${text}\x1b[0m`;
		},
	} as Theme;
}

describe("adaptive editor border colors", () => {
	it("keeps static wrapped-editor rendering independent of Pi's callback", () => {
		const editor = wrapped(baseEditor({ above: 2, below: 3 }));
		editor.borderColor = (text) => `\x1b[35m${text}\x1b[0m`;

		const lines = editor.render(80);
		expect(lines[0]).not.toContain("\x1b[35m");
		expect(lines.at(-1)).not.toContain("\x1b[35m");
		expect(lines[0]).toContain("↑ 2 more");
		expect(lines.at(-1)).toContain("↓ 3 more");
	});

	it.each(["standalone", "wrapped"] as const)(
		"follows Pi thinking and shell callback transitions in the %s editor path",
		(editorKind) => {
			const piTheme = semanticTheme();
			let thinkingLevel: (typeof thinkingLevels)[number] = "off";
			const editor =
				editorKind === "standalone"
					? new PolishedEditor(
							{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
							{ borderColor: (text: string) => text, selectList: {} } as never,
							{} as never,
							piTheme,
							() => config({}, "adaptive"),
							() => ({ modelLabel: "model", providerLabel: "provider" }),
							() => thinkingLevel,
						)
					: new WrappedPolishedEditor(
							baseEditor({ above: 2, below: 3 }) as never,
							piTheme,
							() => config({}, "adaptive"),
							() => ({ modelLabel: "model", providerLabel: "provider" }),
							() => thinkingLevel,
						);
			if (editorKind === "standalone") editor.setText("draft");

			const transitions: SemanticBorderState[] = [...thinkingLevels, "shell", "xhigh", "off"];
			for (const state of transitions) {
				if (state === "shell") {
					editor.borderColor = piTheme.getBashModeBorderColor();
				} else {
					thinkingLevel = state;
					editor.borderColor = piTheme.getThinkingBorderColor(state);
				}

				const lines = editor.render(80);
				const expectedCode = semanticBorderCodes[state];
				for (const border of [lines[0] ?? "", lines.at(-1) ?? ""]) {
					expect(border).toMatch(new RegExp(`^\\x1b\\[${expectedCode}m`));
					for (const code of Object.values(semanticBorderCodes)) {
						if (code !== expectedCode) expect(border).not.toContain(`\x1b[${code}m`);
					}
				}
				expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
			}
		},
	);

	it("does not double-apply adaptive colors through nested branded frames", () => {
		const inner = wrapped(baseEditor({ above: 3, below: 8 }), {}, "adaptive");
		inner.borderColor = (text) => `\x1b[32m${text}\x1b[0m`;
		const outer = wrapped(inner, {}, "adaptive");

		const rendered = outer.render(80).join("\n");
		expect(rendered.match(/\x1b\[32m/g)).toHaveLength(2);
		expect(rendered.match(/↑ 3 more/g)).toHaveLength(1);
		expect(rendered.match(/↓ 8 more/g)).toHaveLength(1);
		expect(rendered.match(/model/g)).toHaveLength(1);
	});

	it("preserves low-rail polished viewport layout, clamping, and static fallback", () => {
		const editor = wrapped(
			baseEditor({ above: 123456, below: 654321, ansi: true }),
			{ style: "opencode-copy-friendly" },
			"adaptive",
		);
		editor.borderColor = () => {
			throw new Error("theme callback failed");
		};

		const lines = editor.render(12);
		expect(lines[0]).toContain("↑");
		expect(lines.at(-1)).toContain("↓");
		expect(lines.join("\n")).not.toContain("│");
		expect(lines.every((line) => visibleWidth(line) <= 12)).toBe(true);
	});
});

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

	it.each(["opencode", "opencode-copy-friendly"] as const)(
		"keeps ANSI and Unicode autocomplete rows raw after the terminal bottom border in %s",
		(style) => {
			const suggestions = ["\x1b[31msuggestion-one\x1b[0m", "emoji 😀 e\u0301 界"];
			const lines = wrapped(baseEditor({ below: 5, autocomplete: suggestions }), { style }).render(
				80,
			);
			const bottom = lines.findIndex((line) => line.includes("↓ 5 more"));
			expect(lines.some((line) => line.includes("├") || line.includes("┤"))).toBe(false);
			expect(bottom).toBe(lines.length - suggestions.length - 1);
			expect(lines.slice(bottom + 1)).toEqual(suggestions);
			expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
		},
	);

	it.each(["opencode", "opencode-copy-friendly"] as const)(
		"keeps exact no-autocomplete output in %s",
		(style) => {
			const ordinary = baseEditor({ below: 2 });
			const guarded = baseEditor({ below: 2 });
			guarded.autocompleteList.render = () => {
				throw new Error("must not inspect an inactive menu");
			};
			expect(wrapped(guarded, { style }).render(80)).toEqual(
				wrapped(ordinary, { style }).render(80),
			);
		},
	);

	it.each(["opencode", "opencode-copy-friendly"] as const)(
		"keeps raw trailing autocomplete width-safe at widths 5 and 4 in %s",
		(style) => {
			for (const width of [5, 4]) {
				const lines = wrapped(baseEditor({ autocomplete: ["界😀e\u0301"] }), { style }).render(
					width,
				);
				expect(lines.some((line) => line.includes("├") || line.includes("┤"))).toBe(false);
				expect(lines.at(-2)).toMatch(/^─+$/);
				expect(visibleWidth(lines.at(-1) ?? "")).toBeLessThanOrEqual(width);
				expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			}
		},
	);

	it("rerenders standalone Opencode at caller width when reduced-width autocomplete rendering throws", () => {
		const editor = standalone();
		let calls = 0;
		Object.assign(editor as unknown as Record<string, unknown>, {
			autocompleteState: {},
			autocompleteList: {
				render() {
					calls += 1;
					if (calls === 1) throw new Error("reduced-width autocomplete failed");
					return ["caller-width-suggestion"];
				},
			},
		});
		const lines = editor.render(80);
		expect(calls).toBe(2);
		expect(lines.some((line) => line.includes("├"))).toBe(false);
		expect(lines).toContain("caller-width-suggestion".padEnd(80));
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("captures standalone Opencode autocomplete from the base render without an extra render", () => {
		const editor = standalone("opencode-copy-friendly");
		let calls = 0;
		Object.assign(editor as unknown as Record<string, unknown>, {
			autocompleteState: {},
			autocompleteList: {
				render() {
					calls += 1;
					return calls === 2 ? [] : ["caller-width-suggestion"];
				},
			},
		});
		const lines = editor.render(80);
		expect(calls).toBe(1);
		expect(lines.some((line) => line.includes("├"))).toBe(false);
		expect(lines.some((line) => line.includes("caller-width-suggestion"))).toBe(true);
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
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
		for (const style of ["opencode", "opencode-copy-friendly"] as const) {
			for (const width of [3, 8, 12, 16]) {
				const lines = wrapped(baseEditor({ above: 12, below: 34, ansi: true }), {
					style,
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

describe("same-render autocomplete capture", () => {
	function source(render: (width: number) => string[]) {
		return {
			isShowingAutocomplete: () => true,
			autocompleteList: {
				filteredItems: [{ value: "one" }],
				selectedIndex: 0,
				maxVisible: 1,
				render,
			},
		};
	}

	it("restores the exact predecessor after descriptor flags mutate", () => {
		const predecessor = vi.fn(() => ["one"]);
		const autocomplete = source(predecessor);
		const original = Object.getOwnPropertyDescriptor(autocomplete.autocompleteList, "render");
		const result = renderWithAutocompleteCapture(autocomplete as never, () => {
			const rows = autocomplete.autocompleteList.render(20);
			const wrapper = autocomplete.autocompleteList.render;
			Object.defineProperty(autocomplete.autocompleteList, "render", {
				value: wrapper,
				configurable: true,
				enumerable: false,
				writable: false,
			});
			return rows;
		});
		expect(result.capture?.compatible).toBe(false);
		expect(Object.getOwnPropertyDescriptor(autocomplete.autocompleteList, "render")).toEqual(
			original,
		);
		expect(predecessor).toHaveBeenCalledTimes(1);
	});

	it("preserves a synchronous third-party replacement and suppresses metadata", () => {
		const autocomplete = source(vi.fn(() => ["one"]));
		const replacement = vi.fn(() => ["replacement"]);
		const result = renderWithAutocompleteCapture(autocomplete as never, () => {
			const rows = autocomplete.autocompleteList.render(20);
			autocomplete.autocompleteList.render = replacement;
			return rows;
		});
		expect(result.capture?.compatible).toBe(false);
		expect(autocomplete.autocompleteList.render).toBe(replacement);
	});

	it("restores through a cleanup descriptor trap when the wrapper is still owned", () => {
		const predecessor = vi.fn(() => ["one"]);
		const target = source(predecessor).autocompleteList;
		let descriptorReads = 0;
		const proxy = new Proxy(target, {
			getOwnPropertyDescriptor(current, property) {
				descriptorReads++;
				if (descriptorReads === 2) throw new Error("descriptor trap");
				return Reflect.getOwnPropertyDescriptor(current, property);
			},
		});
		const result = renderWithAutocompleteCapture(
			{ isShowingAutocomplete: () => true, autocompleteList: proxy } as never,
			() => proxy.render(20),
		);
		expect(result.capture?.compatible).toBe(false);
		expect(target.render).toBe(predecessor);
		expect(predecessor).toHaveBeenCalledTimes(1);
	});

	it("restores after throwing and supports nested capture without extra renders", () => {
		const predecessor = vi.fn(() => ["one"]);
		const autocomplete = source(predecessor);
		const original = autocomplete.autocompleteList.render;
		expect(() =>
			renderWithAutocompleteCapture(autocomplete as never, () => {
				autocomplete.autocompleteList.render(20);
				throw new Error("render failed");
			}),
		).toThrow("render failed");
		expect(autocomplete.autocompleteList.render).toBe(original);

		predecessor.mockClear();
		const outer = renderWithAutocompleteCapture(autocomplete as never, () =>
			renderWithAutocompleteCapture(autocomplete as never, () =>
				autocomplete.autocompleteList.render(20),
			),
		);
		expect(predecessor).toHaveBeenCalledTimes(1);
		expect(outer.capture).toMatchObject({ compatible: true, called: 1 });
		expect(outer.value.capture).toMatchObject({ compatible: true, called: 1 });
		expect(autocomplete.autocompleteList.render).toBe(original);
	});
});

describe("fixed-editor semantic publication", () => {
	it.each([
		[
			"opencode",
			{
				rowCount: 9,
				cursorRow: 2,
				borderBottom: 5,
				minimumEditorRows: [0, 2, 5],
				plannerRawRows: 5,
				selectedIndex: 0,
				itemRows: [6, 7, 8],
				selectedRow: 6,
			},
		],
		[
			"opencode-copy-friendly",
			{
				rowCount: 9,
				cursorRow: 2,
				borderBottom: 5,
				minimumEditorRows: [0, 2, 5],
				plannerRawRows: 5,
				selectedIndex: 1,
				itemRows: [6, 7, 8],
				selectedRow: 7,
			},
		],
		[
			"minimalist",
			{
				rowCount: 7,
				cursorRow: 1,
				borderBottom: 6,
				minimumEditorRows: [0, 1, 6],
				plannerRawRows: 6,
				selectedIndex: 2,
				itemRows: [3, 4, 5],
				selectedRow: 5,
			},
		],
	] as const)("publishes exact cursor and autocomplete rows for %s", (style, expected) => {
		const autocomplete = {
			filteredItems: [{ value: "one" }, { value: "two" }, { value: "three" }],
			selectedIndex: expected.selectedIndex,
			maxVisible: 3,
			render: () => ["one", "two", "three"],
		};
		const base = {
			render(width: number) {
				return [
					nativeBorder(width, "above"),
					`typed${CURSOR_MARKER}`,
					nativeBorder(width, "below"),
					...autocomplete.render(),
				];
			},
			invalidate() {},
			handleInput() {},
			getText: () => "typed",
			setText() {},
			isShowingAutocomplete: () => true,
			autocompleteList: autocomplete,
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => withEditorStyle(config(), style),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
		);
		const lines = editor.render(60);
		const metadata = editor[FIXED_EDITOR_LAYOUT](lines, 60);
		expect(metadata?.renderedRowCount).toBe(expected.rowCount);
		expect(metadata?.editor.cursorRow).toBe(expected.cursorRow);
		expect(metadata?.editor.borderPairs).toEqual([{ top: 0, bottom: expected.borderBottom }]);
		expect(metadata?.autocomplete?.selection).toEqual({
			known: true,
			selectedIndex: expected.selectedIndex,
			visibleWindow: { start: 0, end: 3 },
			itemToOutputRows: [
				{ itemIndex: 0, outputRow: expected.itemRows[0] },
				{ itemIndex: 1, outputRow: expected.itemRows[1] },
				{ itemIndex: 2, outputRow: expected.itemRows[2] },
			],
			selectedRow: expected.selectedRow,
		});
		if (!metadata) throw new Error("expected fixed-editor metadata");
		expect(
			planFixedLayout({ rawRows: expected.plannerRawRows, editorRows: lines, metadata }),
		).toMatchObject({
			mode: "fixed",
			selectedEditorRows: expected.minimumEditorRows,
			selectedAutocompleteRows: expect.arrayContaining([expected.selectedRow]),
		});
	});
});

describe("minimalist editor integration", () => {
	it("switches renderer modes without replacing the wrapped editor", () => {
		let current = config();
		const base = baseEditor({});
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => current,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp/project", modelLabel: "model", costLabel: "$0.100" }),
		);

		expect(editor.render(80)[0]).toMatch(/^─+$/);
		current = withEditorStyle(current, "minimalist");
		const minimalist = editor.render(80);
		expect(minimalist[0]).toMatch(/^╭.*╮$/);
		expect(minimalist.at(-1)).toMatch(/^╰.*╯$/);
		expect(minimalist.join("\n")).toContain("$0.100 – model");
	});

	it("cycles one wrapped adapter through every style without nesting owned chrome", () => {
		let current = config({ style: "opencode" });
		const rawWidths: number[] = [];
		const raw = baseEditor({});
		const rawRender = raw.render.bind(raw);
		raw.render = (width: number) => {
			rawWidths.push(width);
			return rawRender(width);
		};
		const inner = new WrappedPolishedEditor(
			raw as never,
			theme(),
			() => config({ style: "opencode" }),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
		);
		const decoration = vi.fn();
		const editor = new WrappedPolishedEditor(
			inner as never,
			theme(),
			() => current,
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp/project", modelLabel: "model", costLabel: "$0.100" }),
			decoration,
		);

		const polished = editor.render(40);
		current = withEditorStyle(current, "opencode-copy-friendly");
		const lowRail = editor.render(40);
		current = withEditorStyle(current, "minimalist");
		const minimalist = editor.render(40);
		current = withEditorStyle(current, "opencode");
		const polishedAgain = editor.render(40);

		expect(rawWidths).toEqual([36, 38, 34, 36]);
		expect(polished.join("\n").match(/provider/g)).toHaveLength(1);
		expect(lowRail.join("\n").match(/provider/g)).toHaveLength(1);
		expect(minimalist[0]).toMatch(/^╭.*╮$/);
		expect(minimalist.at(-1)).toMatch(/^╰.*╯$/);
		expect(polishedAgain.join("\n").match(/provider/g)).toHaveLength(1);
		expect(polishedAgain.join("\n")).not.toContain("╭");
		expect(decoration.mock.calls.map(([active]) => active)).toEqual([false, false, true, false]);
	});

	it("places native viewport counts at the far left before minimalist metadata", () => {
		const editor = new WrappedPolishedEditor(
			baseEditor({ above: 7, below: 11 }) as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({
				cwd: "/tmp/project",
				branch: "main",
				ahead: 2,
				behind: 1,
				agentDurationMs: 5000,
			}),
		);

		const lines = editor.render(80);
		expect(lines[0]).toMatch(/^╭─ ↑ 7 more · 5s/);
		expect(lines.at(-1)).toMatch(/^╰─ ↓ 11 more · main ↑2 ↓1/);
	});

	it("honors the shared viewport indicator toggle in minimalist mode", () => {
		const editor = new WrappedPolishedEditor(
			baseEditor({ above: 7, below: 11 }) as never,
			theme(),
			() => withEditorStyle(config({ viewportIndicators: false }), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp/project" }),
		);

		expect(editor.render(80).join("\n")).not.toContain("more");
	});

	it("keeps known autocomplete rows inside the minimalist frame", () => {
		const base = baseEditor({ below: 5, autocomplete: ["one", "two"] });
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
		);
		const lines = editor.render(40);
		expect(lines.some((line) => /^├─+┤$/.test(line))).toBe(true);
		expect(lines.findIndex((line) => line.includes("one"))).toBeGreaterThan(
			lines.findIndex((line) => line.startsWith("├")),
		);
		expect(lines.findIndex((line) => line.includes("one"))).toBeLessThan(lines.length - 1);
		expect(lines.at(-1)).toContain("↓ 5 more");
		expect(lines.at(-1)).toMatch(/^╰.*╯$/);
	});

	it("fails open at caller width for unknown third-party output", () => {
		const widths: number[] = [];
		const decoration = vi.fn();
		const base = {
			render(width: number) {
				widths.push(width);
				return [`header-${width}`, "body", `help-${width}`];
			},
			invalidate() {},
			handleInput() {},
			getText: () => "body",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
			decoration,
		);
		expect(editor.render(40)).toEqual(["header-40", "body", "help-40"]);
		expect(widths).toEqual([36, 40]);
		expect(decoration).toHaveBeenLastCalledWith(false);
	});

	it("unwraps module-owned polished chrome, viewport counts, and autocomplete", () => {
		const inner = wrapped(baseEditor({ above: 3, below: 8, autocomplete: ["one", "two"] }));
		const outer = new WrappedPolishedEditor(
			inner as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "outer", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp", modelLabel: "minimal-model" }),
		);

		const lines = outer.render(80);
		const rendered = lines.join("\n");
		expect(lines[0]).toMatch(/^╭.*╮$/);
		expect(lines.at(-1)).toMatch(/^╰.*╯$/);
		expect(rendered).toContain("minimal-model");
		expect(rendered).not.toContain("provider");
		expect(rendered.match(/minimal-model/g)).toHaveLength(1);
		expect(rendered.match(/↑ 3 more/g)).toHaveLength(1);
		expect(rendered.match(/↓ 8 more/g)).toHaveLength(1);
		expect(lines.some((line) => /^├─+┤$/.test(line))).toBe(true);
		expect(lines.filter((line) => line.includes("one") || line.includes("two"))).toHaveLength(2);
	});

	it("rejects mutated module-owned polished provenance in minimalist mode", () => {
		const owned = wrapped(baseEditor({ above: 2, below: 3 })).render(36);
		owned[1] = "mutated-row";
		const base = {
			render: () => owned,
			invalidate() {},
			handleInput() {},
			getText: () => "typed text",
			setText() {},
		};
		const decoration = vi.fn();
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
			decoration,
		);

		expect(editor.render(40)).toEqual(owned);
		expect(decoration).toHaveBeenLastCalledWith(false);
	});

	it("falls back at four columns and decorates after resizing to five", () => {
		const widths: number[] = [];
		const decoration = vi.fn();
		const base = baseEditor({});
		const renderBase = base.render.bind(base);
		base.render = (width: number) => {
			widths.push(width);
			return renderBase(width);
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
			decoration,
		);

		const narrow = editor.render(4);
		expect(narrow[0]).not.toContain("╭");
		expect(narrow.every((line) => visibleWidth(line) <= 4)).toBe(true);
		const decorated = editor.render(5);
		expect(decorated[0]).toMatch(/^╭.*╮$/);
		expect(decorated.every((line) => visibleWidth(line) <= 5)).toBe(true);
		expect(widths).toEqual([4, 1]);
		expect(decoration.mock.calls.map(([active]) => active)).toEqual([false, true]);
	});

	it("preserves empty, multiline, blank, and inverse-video editor rows", () => {
		const inverseCursor = "\x1b[7m \x1b[0m";
		const base = {
			render: (width: number) => [
				nativeBorder(width, "above"),
				"",
				inverseCursor,
				"second line",
				nativeBorder(width, "below"),
			],
			invalidate() {},
			handleInput() {},
			getText: () => "\nsecond line",
			setText() {},
		};
		const editor = new WrappedPolishedEditor(
			base as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
		);
		const lines = editor.render(40);
		expect(lines[1]).toMatch(/^│\s+│$/);
		expect(lines.join("\n")).toContain(inverseCursor);
		expect(lines.join("\n")).toContain("second line");

		const empty = new WrappedPolishedEditor(
			{
				render: (width: number) => [nativeBorder(width, "above"), nativeBorder(width, "below")],
				invalidate() {},
				handleInput() {},
				getText: () => "",
				setText() {},
			} as never,
			theme(),
			() => withEditorStyle(config(), "minimalist"),
			() => ({ modelLabel: "model", providerLabel: "provider" }),
			() => "off",
			() => ({ cwd: "/tmp" }),
		).render(40);
		expect(empty).toHaveLength(2);
		expect(empty[0]).toMatch(/^╭.*╮$/);
		expect(empty[1]).toMatch(/^╰.*╯$/);
	});
});
