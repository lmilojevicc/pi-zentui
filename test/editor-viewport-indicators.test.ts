import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
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
	])("fails closed for an unknown top border form: %s", (malformedTop) => {
		const lines = wrapped(baseEditor({ below: 2, malformedTop })).render(80);
		expect(lines[0]).toMatch(/^─+$/);
		expect(lines[0]).not.toContain("more");
		expect(lines.at(-1)).toContain("↓ 2 more");
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
		expect(lines[0]).toMatch(/^─+$/);
		expect(lines[0]).not.toContain("↑");
	});
});
