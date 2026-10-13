import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as currentPi from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller.js";
import type { ToolRenderers } from "../extensions/zentui/tool-display/host-contract.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	createToolDisplayRenderers,
	type ToolDisplayRenderContext,
} from "../extensions/zentui/tool-display/renderers.js";
import { toolRenderContextDefaults } from "./tool-display-context-fixture.js";
import { editFixture, writeFixture } from "./tool-display-fixture.js";

const theme = {
	fg: (_slot: string, text: string) => `\x1b[32m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as currentPi.Theme;
const context = (): ToolDisplayRenderContext => ({
	...toolRenderContextDefaults,
	args: { value: "hello" },
	cwd: "/sandbox",
	toolCallId: "one",
	state: {},
	argsComplete: true,
	executionStarted: true,
	expanded: false,
	isPartial: false,
	isError: false,
	showImages: false,
	lastComponent: undefined,
	invalidate() {},
});
const textResult = {
	content: [{ type: "text" as const, text: "first\nsecond" }],
	details: undefined,
};
const renderOptions = { expanded: false, isPartial: false };
const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

describe("tool-display correction regressions", () => {
	it("F1 invokes predecessor partial/final at callback time with actual per-slot components and invalidation", () => {
		vi.useFakeTimers();
		try {
			class Resource implements Component {
				timer?: ReturnType<typeof setInterval>;
				invalidations = 0;
				invalidate() {
					this.invalidations++;
				}
				render() {
					return ["predecessor resource"];
				}
			}
			const calls: (Component | undefined)[] = [];
			const results: (Component | undefined)[] = [];
			const previous: ToolRenderers = {
				renderCall(_args, _theme, ctx) {
					calls.push(ctx.lastComponent);
					return ctx.lastComponent instanceof Resource ? ctx.lastComponent : new Resource();
				},
				renderResult(_result, options, _theme, ctx) {
					results.push(ctx.lastComponent);
					const component =
						ctx.lastComponent instanceof Resource ? ctx.lastComponent : new Resource();
					if (options.isPartial && !component.timer)
						component.timer = setInterval(() => ctx.invalidate(), 1000);
					if (!options.isPartial && component.timer) {
						clearInterval(component.timer);
						component.timer = undefined;
					}
					return component;
				},
			};
			let config = normalizeToolDisplayConfig({
				enabled: true,
				customToolOverrides: { demo: { enabled: true, overrideExistingRenderers: true } },
			});
			const controller = createToolDisplayController({}, () => config, { nativeRenderers: {} });
			let downstream = previous;
			const owned = controller.resolver("demo", () => downstream);
			const row = context();
			const ownedCall = owned?.renderCall?.(row.args, theme, row);
			const ownedResult = owned?.renderResult?.(textResult, renderOptions, theme, row);
			config = normalizeToolDisplayConfig({ enabled: false });
			const call = owned?.renderCall?.(row.args, theme, { ...row, lastComponent: ownedCall });
			const partial = owned?.renderResult?.(
				textResult,
				{ ...renderOptions, isPartial: true },
				theme,
				{ ...row, lastComponent: ownedResult },
			);
			expect(calls).toEqual([undefined]);
			expect(results).toEqual([undefined]);
			expect(vi.getTimerCount()).toBe(1);
			downstream = {
				renderCall: vi.fn(() => {
					throw new Error("late owner must not steal an already-delegated row");
				}),
				renderResult: vi.fn(() => {
					throw new Error("late owner must not steal an already-delegated row");
				}),
			};
			partial?.invalidate();
			expect((partial as Resource).invalidations).toBe(1);
			config = normalizeToolDisplayConfig({
				enabled: true,
				customToolOverrides: { demo: { enabled: true, overrideExistingRenderers: true } },
			});
			expect(owned?.renderCall?.(row.args, theme, { ...row, lastComponent: call })).toBe(call);
			const final = owned?.renderResult?.(textResult, renderOptions, theme, {
				...row,
				lastComponent: partial,
			});
			expect(final).toBe(partial);
			expect(results).toEqual([undefined, partial]);
			expect(calls).toEqual([undefined, call]);
			expect(vi.getTimerCount()).toBe(0);
			expect(
				plain(
					owned
						?.renderResult?.(textResult, renderOptions, theme, {
							...context(),
							toolCallId: row.toolCallId,
						})
						.render(80)
						.map((line) => line.trimEnd()) ?? [],
				),
			).toContain("2 lines returned");
		} finally {
			vi.useRealTimers();
		}
	});
	it("F4 production rendering keeps independent old/new labels after inserts and deletes", () => {
		const output = plain(
			editFixture(
				" 1|one\n+2|inserted\n 2|two\n-3|three\n-4|four\n 10|ten",
				() => normalizeToolDisplayConfig({ diffViewMode: "split" }),
				theme,
				true,
			).render(160),
		);
		expect(output).toMatch(/2.*two.*3.*two/);
		expect(output).toMatch(/10.*ten.*9.*ten/);
	});
	it("F5 syntax highlights create/add/remove/context while preserving word emphasis and Unicode widths", () => {
		const highlighter = vi.fn((text: string) => `\x1b[35m${text}\x1b[39m`);
		const config = () => normalizeToolDisplayConfig({ diffViewMode: "unified" });
		const created = writeFixture("", "const 界 = '🧪';", config, theme, true, {
			highlighter,
			path: "new.ts",
		});
		expect(
			created
				.render(80)
				.map((line) => line.trimEnd())
				.join("\n"),
		).toContain("\x1b[35m");
		expect(highlighter).toHaveBeenCalledWith("const 界 = '🧪';", "new.ts");
		const modified = editFixture(
			"-1|const old = '🧪';\n+1|const next = '🧫';\n 2|same",
			config,
			theme,
			true,
			{ highlighter, path: "change.ts" },
		);
		const wide = modified.render(120).join("\n");
		expect(wide).toContain("\x1b[35m");
		expect(wide).toContain("\x1b[1m");
		for (const text of ["const old = '🧪';", "const next = '🧫';", "same"])
			expect(highlighter).toHaveBeenCalledWith(text, "change.ts");
		for (const width of [8, 18, 60, 120])
			for (const line of modified.render(width))
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		expect(plain(modified.render(120))).toContain("🧫");
	});
	it("F6 bounds long-line diff work before highlighting/wrapping/materialization", () => {
		const highlighter = vi.fn((text: string) => text);
		for (const length of [256 * 1024, 1024 * 1024 - 20]) {
			const line = "x".repeat(length);
			const component = editFixture(
				`+1|${line}`,
				() => normalizeToolDisplayConfig({ diffViewMode: "unified", diffCollapsedLines: 4 }),
				theme,
				false,
				{ highlighter },
			);
			const rendered = component.render(8);
			expect(rendered.length).toBeLessThanOrEqual(7);
			expect(rendered.map(visibleWidth).every((width) => width <= 8)).toBe(true);
			expect(rendered.join("\n")).toContain("…");
		}
		expect(highlighter.mock.calls.every(([text]) => text.length <= 16_384)).toBe(true);
	});
	it("F6 normal long-line previews cap visual rows and report truncation", () => {
		const renderer = createToolDisplayRenderers("read", () =>
			normalizeToolDisplayConfig({ enabled: true, readOutputMode: "preview", previewLines: 8 }),
		);
		const result = {
			content: [{ type: "text" as const, text: "界".repeat(340_000) }],
			details: undefined,
		};
		const lines = renderer.renderResult?.(result, renderOptions, theme, context()).render(8) ?? [];
		expect(lines.length).toBeLessThanOrEqual(10);
		expect(lines.every((line) => visibleWidth(line) <= 8)).toBe(true);
		expect(lines.join("\n")).toContain("…");
	});
});

interface NativeTestHost {
	initTheme(name: string, watcher: boolean): void;
	ToolExecutionComponent: new (
		name: string,
		id: string,
		args: unknown,
		options: { showImages: boolean },
		renderers: ToolRenderers | undefined,
		ui: { requestRender(): void },
		cwd: string,
	) => {
		updateArgs(args: unknown): void;
		updateResult(result: {
			content: { type: string; text?: string; data?: string; mimeType?: string }[];
			details?: unknown;
			isError: boolean;
		}): void;
		setExpanded(expanded: boolean): void;
		render(width: number): string[];
	};
}
function modernVersion(entry: string): string | undefined {
	try {
		const version: unknown = JSON.parse(
			readFileSync(resolve(dirname(entry), "../package.json"), "utf8"),
		).version;
		if (typeof version !== "string") return undefined;
		const [major, minor, patch] = version.split(".").map(Number);
		return major > 1 || (major === 1 && (minor > 0 || patch >= 3)) ? version : undefined;
	} catch {
		return undefined;
	}
}
function nativeTestHost(
	namespace: unknown,
	version: string | undefined,
): NativeTestHost | undefined {
	const host = namespace as Record<string, unknown>;
	return version &&
		typeof host.createReadToolDefinition === "function" &&
		typeof host.initTheme === "function" &&
		typeof host.ToolExecutionComponent === "function"
		? (host as unknown as NativeTestHost)
		: undefined;
}
const currentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const currentVersion = modernVersion(currentEntry);
const currentHost = nativeTestHost(currentPi, currentVersion);
const extraEntry = process.env.ZENTUI_TOOL_DISPLAY_HOST_ENTRY;
const extraVersion = extraEntry ? modernVersion(extraEntry) : undefined;
for (const extra of [false, true]) {
	const available = extra ? !!extraEntry && !!extraVersion : !!currentHost;
	const label = extra
		? `opt-in host (${extraVersion ?? "unconfigured"})`
		: `current host (${currentVersion ?? "native resolver unavailable"})`;
	(available ? describe : describe.skip)(`F2 actual public ToolExecutionComponent ${label}`, () => {
		it.each(["renderless", "missing-call", "missing-result", "mixed", "image", "empty", "error"])(
			"uses native fallback for %s at callback time without logs",
			async (kind) => {
				const pi = extra
					? nativeTestHost(await import(extraEntry as string), extraVersion)
					: currentHost;
				if (!pi) throw new Error("Opt-in modern host public component contract unavailable");
				pi.initTheme("dark", false);
				const ui = { requestRender() {} };
				const previous: ToolRenderers =
					kind === "missing-call"
						? { renderResult: () => ({ invalidate() {}, render: () => ["existing result"] }) }
						: kind === "missing-result"
							? { renderCall: () => ({ invalidate() {}, render: () => ["existing call"] }) }
							: {};
				let config = normalizeToolDisplayConfig({
					enabled: true,
					customToolOverrides: { demo: { enabled: true, overrideExistingRenderers: true } },
				});
				const controller = createToolDisplayController({}, () => config, { nativeRenderers: {} });
				const owned = controller.resolver("demo", () => previous);
				const args = { value: "hello", nested: { count: 1 } };
				const host = new pi.ToolExecutionComponent(
					"demo",
					"demo-id",
					args,
					{ showImages: false },
					owned,
					ui,
					"/sandbox",
				);
				config = normalizeToolDisplayConfig({ enabled: false });
				const native = new pi.ToolExecutionComponent(
					"demo",
					"native-id",
					args,
					{ showImages: false },
					previous,
					ui,
					"/sandbox",
				);
				const output = Array.from(
					{ length: 15 },
					(_, i) => `line-${String(i).padStart(2, "0")}`,
				).join("\n");
				const text = { type: "text", text: output };
				const image = { type: "image", data: "unused", mimeType: "image/png" };
				const content =
					kind === "mixed"
						? [text, image]
						: kind === "image"
							? [image]
							: kind === "empty"
								? []
								: [text];
				const result = { content, details: undefined, isError: kind === "error" };
				const error = vi.spyOn(console, "error").mockImplementation(() => {});
				const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
				try {
					host.updateResult(result);
					native.updateResult(result);
					// Result release follows the call slot in this host update. A public next
					// callback/rebuild restores that already-created call slot; never paint.
					if (["mixed", "image", "empty"].includes(kind)) host.updateArgs(args);
					expect(host.render(100)).toEqual(native.render(100));
					if (["renderless", "error"].includes(kind)) {
						const shown = plain(host.render(100));
						expect(shown).toContain('demo value="hello"');
						expect(shown).toContain("line-09");
						expect(shown).not.toContain("line-10");
						expect(shown).toContain("5 more lines");
						expect(shown).toContain("to expand");
					}
					host.setExpanded(true);
					native.setExpanded(true);
					expect(host.render(100)).toEqual(native.render(100));
					if (["renderless", "error"].includes(kind))
						expect(plain(host.render(100))).toContain("line-14");
					expect(error).not.toHaveBeenCalled();
					expect(warn).not.toHaveBeenCalled();
				} finally {
					error.mockRestore();
					warn.mockRestore();
				}
			},
		);
	});
}
