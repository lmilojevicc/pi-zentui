import { stripVTControlCharacters } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { isSupportedColorSpec } from "../extensions/zentui/style";
import {
	buildWorkingLineFrames,
	buildWorkingLineSpinnerFrames,
	WorkingLineController,
} from "../extensions/zentui/working-line";

vi.mock("../extensions/zentui/style", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/style")>();
	return { ...actual, isSupportedColorSpec: vi.fn(actual.isSupportedColorSpec) };
});

function config() {
	const current = structuredClone(defaultConfig);
	current.components.workingLine.colorSource = "theme";
	Object.assign(current.components.workingLine, {
		enabled: true,
		colors: { low: "dim", mid: "muted", high: "accent" },
		messages: { custom: true, values: ["Stable"] },
		segments: { tool: true, elapsed: false, thought: true, tokens: true },
	});
	return current;
}

function theme() {
	return {
		fg: vi.fn((_color: string, text: string) => `\x1b[36m${text}\x1b[0m`),
		bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	};
}

function validationCalls(): number {
	return vi.mocked(isSupportedColorSpec).mock.calls.length;
}

const validate = () => vi.mocked(isSupportedColorSpec).mockClear();

describe("working-line generation-local palette cache", () => {
	it.each([false, true])(
		"validates each animated tier once per build (spinner sweep: %s)",
		(animateSpinnerColor) => {
			const current = config();
			const component = current.components.workingLine;
			component.animateSpinnerColor = animateSpinnerColor;
			const activeTheme = theme();
			validate();
			const generated = buildWorkingLineFrames(
				component,
				current.colors,
				activeTheme,
				"界 👩🏽‍💻 é ",
				{ tool: "read", tokens: { input: 12, output: 3 } },
				7,
				11,
				13,
			);
			// One raw owner-local validation and one normalized-token validation per tier.
			expect(validationCalls()).toBe(6);
			expect(activeTheme.fg.mock.calls.length).toBeGreaterThan(30);
			expect(generated.frames.length).toBeGreaterThan(100);
			validate();
			const repeated = buildWorkingLineFrames(
				component,
				current.colors,
				activeTheme,
				"界 👩🏽‍💻 é ",
				{ tool: "read", tokens: { input: 12, output: 3 } },
				7,
				11,
				13,
			);
			expect(validationCalls()).toBe(6);
			expect(repeated).toEqual(generated);
		},
	);

	it("bounds long repeated-spec validation and reuses tiers across memory-cap retries", () => {
		const current = config();
		const component = current.components.workingLine;
		component.colors = {
			low: "dim ".repeat(128),
			mid: "cyan ".repeat(128),
			high: "bold ".repeat(128),
		};
		component.colorSource = "terminal";
		component.spinnerIntervalMs = 997;
		component.textIntervalMs = 900;
		validate();
		const generated = buildWorkingLineFrames(component, current.colors, theme(), "x".repeat(43));
		expect(validationCalls()).toBe(3 * 129);
		expect(generated.scheduler.exact).toBe(false);
		// Large trusted theme output forces shorter schedules; validation remains build-local.
		component.colorSource = "theme";
		component.colors = { low: "dim", mid: "muted", high: "accent" };
		const largeTheme = {
			fg: (_color: string, text: string) => `${"\x1b[36m".repeat(60)}${text}\x1b[0m`,
		};
		validate();
		const shortened = buildWorkingLineFrames(component, current.colors, largeTheme, "Ready");
		expect(shortened.frames.length).toBeLessThan(generated.frames.length);
		expect(validationCalls()).toBe(6);
	});

	it("caches undefined normalization results without caching rendered fallbacks", () => {
		const current = config();
		current.components.workingLine.colors = { low: "bogus", mid: "bogus", high: "bogus" };
		Object.assign(current.colors, {
			workingLineLow: "bogus",
			workingLineMid: "bogus",
			workingLineHigh: "bogus",
		});
		const activeTheme = theme();
		validate();
		const generated = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			activeTheme,
			"Ready",
		);
		expect(validationCalls()).toBe(6);
		expect(generated.frames.every((frame) => frame.includes("\x1b[36m"))).toBe(true);
		expect(new Set(activeTheme.fg.mock.calls.map(([color]) => color))).toEqual(
			new Set(["muted", "accent"]),
		);
		validate();
		activeTheme.fg.mockImplementation((_color, text) => `\x1b[35m${text}\x1b[0m`);
		const refreshed = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			activeTheme,
			"Ready",
		);
		expect(validationCalls()).toBe(6);
		expect(refreshed.frames.every((frame) => frame.includes("\x1b[35m"))).toBe(true);
	});

	it("does not resolve unused static/spinner tiers", () => {
		const current = config();
		current.components.workingLine.textAnimation = "disabled";
		validate();
		buildWorkingLineFrames(current.components.workingLine, current.colors, theme(), "Ready");
		expect(vi.mocked(isSupportedColorSpec).mock.calls.map(([value]) => value)).toEqual([
			"muted",
			"muted",
		]);
		validate();
		buildWorkingLineSpinnerFrames(current.components.workingLine, current.colors, theme());
		expect(vi.mocked(isSupportedColorSpec).mock.calls.map(([value]) => value)).toEqual([
			"accent",
			"accent",
		]);
	});

	it("keeps theme callbacks live after a transient fallback within the same build", () => {
		const current = config();
		current.components.workingLine.animateSpinnerColor = true;
		const activeTheme = theme();
		activeTheme.fg.mockImplementationOnce(() => {
			throw new Error("transient theme failure");
		});
		const generated = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			activeTheme,
			"Ready",
		);
		expect(activeTheme.fg.mock.calls.length).toBeGreaterThan(generated.frames.length);
		expect(generated.frames[0]?.startsWith("\x1b[36m")).toBe(false);
		expect(generated.frames.slice(1).every((frame) => frame.includes("\x1b[36m"))).toBe(true);
		const recovered = buildWorkingLineFrames(
			current.components.workingLine,
			current.colors,
			activeTheme,
			"Ready",
		);
		expect(recovered.frames[0]?.startsWith("\x1b[36m")).toBe(true);
	});

	it("refreshes message, styles, theme and metrics on rebuilds and releases on disable/disposal", () => {
		const current = config();
		const activeTheme = theme();
		let currentTheme = activeTheme;
		const ctx = { mode: "tui", ui: { setWorkingMessage: vi.fn(), setWorkingIndicator: vi.fn() } };
		const controller = new WorkingLineController(
			() => current,
			() => currentTheme,
			undefined,
			() => 0,
			() => 0,
		);
		const latest = () => ctx.ui.setWorkingIndicator.mock.calls.at(-1)?.[0]?.frames as string[];
		try {
			controller.startSession(ctx);
			const first = latest();
			validate();
			controller.finishTool("missing", ctx);
			// The existing frame key still validates its three raw palette values.
			expect(validationCalls()).toBe(3);
			expect(latest()).toBe(first);
			current.components.workingLine.messages.values = ["Changed"];
			controller.reconcile(ctx);
			expect(stripVTControlCharacters(latest()[0])).toContain("Changed");
			current.components.workingLine.colors = { low: "#123456", mid: "#123456", high: "#123456" };
			controller.reconcile(ctx);
			expect(latest()[0]).toContain("\x1b[38;2;18;52;86m");
			current.components.workingLine.colors = { low: "dim", mid: "muted", high: "accent" };
			activeTheme.fg.mockImplementation((_color, text) => `\x1b[35m${text}\x1b[0m`);
			controller.flushMetrics({ input: 9, output: 7 }, { durationMs: 1000, active: true }, ctx);
			expect(latest()[0]).toContain("\x1b[35m");
			expect(stripVTControlCharacters(latest()[0])).toContain("thinking 1s · ↑9 ↓7");
			currentTheme = theme();
			currentTheme.fg.mockImplementation((_color, text) => `\x1b[32m${text}\x1b[0m`);
			controller.flushMetrics({ input: 10, output: 8 }, undefined, ctx);
			expect(latest()[0]).toContain("\x1b[32m");
			current.components.workingLine.enabled = false;
			controller.reconcile(ctx);
			expect(controller.isAvailable()).toBe(false);
			expect(ctx.ui.setWorkingIndicator).toHaveBeenLastCalledWith();
			validate();
			controller.flushMetrics({ input: 10, output: 8 }, undefined, ctx);
			expect(validationCalls()).toBe(0);
			current.components.workingLine.enabled = true;
			controller.reconcile(ctx);
			expect(validationCalls()).toBeGreaterThan(0);
			expect(stripVTControlCharacters(latest()[0])).toContain("↑10 ↓8");
			controller.dispose(ctx);
			expect(ctx.ui.setWorkingIndicator).toHaveBeenLastCalledWith();
			validate();
			controller.startSession(ctx);
			expect(validationCalls()).toBeGreaterThan(0);
			expect(stripVTControlCharacters(latest()[0])).not.toContain("↑10 ↓8");
		} finally {
			controller.dispose(ctx);
		}
	});
});
