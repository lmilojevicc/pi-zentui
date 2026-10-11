import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	initTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller.js";
import type { ToolRenderers } from "../extensions/zentui/tool-display/host-contract.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import * as renderUtils from "../extensions/zentui/tool-display/render-utils.js";
import * as bounds from "../extensions/zentui/tool-display/source-bounds.js";
import { validateReferenceSources } from "./tool-display-reference-provenance.mjs";

const ui = { requestRender() {} } as unknown as TUI;
const plain = (rows: string[]) =>
	rows.map((row) => row.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).join("\n");
describe("tool-display independent review regressions", () => {
	it("retains row/slot parsing and highlighting across unchanged paints and width changes", () => {
		initTheme("dark", false);
		const native = createEditToolDefinition("/sandbox") as unknown as ToolRenderers;
		let config = normalizeToolDisplayConfig({ enabled: true, diffViewMode: "unified" });
		const highlighter = vi.fn((text: string) => text);
		const parser = vi.spyOn(bounds, "boundedPresentationSource");
		const controller = createToolDisplayController(
			{
				getAllTools: () => [
					{ name: "edit", sourceInfo: { source: "builtin", path: "builtin:edit" } },
				],
			},
			() => ({ ...config }),
			{ nativeRenderers: { edit: native }, highlighter },
		);
		const diff = Array.from(
			{ length: 4000 },
			(_, index) => ` ${index + 1}|const value${index} = ${index};`,
		).join("\n");
		const result = {
			content: [{ type: "text", text: "edited" }],
			details: { diff },
			isError: false,
		};
		const row = new ToolExecutionComponent(
			"edit",
			"cache",
			{ path: "cache.ts", oldText: "old", newText: "new" },
			{ showImages: false },
			controller.resolver("edit", () => native),
			ui,
			"/sandbox",
		);
		try {
			row.updateResult(result);
			const first = row.render(80);
			const highlighted = highlighter.mock.calls.length;
			const parsed = parser.mock.calls.filter(([source]) => source === diff).length;
			expect(highlighted).toBe(4000);
			expect(parsed).toBe(1);
			expect(row.render(80)).toEqual(first);
			expect(highlighter).toHaveBeenCalledTimes(highlighted);
			expect(parser.mock.calls.filter(([source]) => source === diff)).toHaveLength(parsed);
			row.render(110);
			expect(highlighter).toHaveBeenCalledTimes(highlighted);
			expect(parser.mock.calls.filter(([source]) => source === diff)).toHaveLength(parsed);
			row.setExpanded(true);
			row.render(110);
			expect(highlighter.mock.calls.length).toBeGreaterThan(highlighted);
			expect(parser.mock.calls.filter(([source]) => source === diff)).toHaveLength(parsed + 1);
			const prior = highlighter.mock.calls.length;
			config = normalizeToolDisplayConfig({ ...config, diffIndicatorMode: "classic" });
			row.render(110);
			expect(highlighter.mock.calls.length).toBeGreaterThan(prior);
			row.updateResult({ ...result, details: { diff: "-1|old\n+1|changed" } });
			expect(plain(row.render(110))).toContain("changed");
		} finally {
			parser.mockRestore();
			controller.dispose();
		}
	});
	it("keeps started Bash frames and elapsed advancing after expansion/config/theme rebuilds", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000000);
		initTheme("dark", false);
		const native = createBashToolDefinition("/sandbox") as unknown as ToolRenderers;
		let config = normalizeToolDisplayConfig({
			enabled: true,
			builtinRendererOverrides: { bash: true },
		});
		const controller = createToolDisplayController(
			{
				getAllTools: () => [
					{ name: "bash", sourceInfo: { source: "builtin", path: "builtin:bash" } },
				],
			},
			() => ({ ...config }),
			{ nativeRenderers: { bash: native } },
		);
		const row = new ToolExecutionComponent(
			"bash",
			"animation",
			{ command: "printf harmless" },
			{ showImages: false },
			controller.resolver("bash", () => native),
			ui,
			"/sandbox",
		);
		try {
			row.markExecutionStarted();
			row.updateResult(
				{ content: [{ type: "text", text: "line" }], details: {}, isError: false },
				true,
			);
			vi.advanceTimersByTime(200);
			expect(plain(row.render(110))).toContain("⠙");
			row.setExpanded(true);
			vi.advanceTimersByTime(200);
			expect(plain(row.render(110))).toContain("⠹");
			config = normalizeToolDisplayConfig({ ...config, bashOutputMode: "preview" });
			row.render(110);
			vi.advanceTimersByTime(800);
			expect(plain(row.render(110))).toContain("· 1s");
			expect(plain(row.render(110))).toContain("⠦");
			initTheme("light", false);
			row.invalidate();
			row.render(110);
			vi.advanceTimersByTime(1000);
			expect(plain(row.render(110))).toContain("· 2s");
			expect(plain(row.render(110))).toContain("⠙");
			row.updateResult(
				{ content: [{ type: "text", text: "done" }], details: {}, isError: false },
				false,
			);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			controller.dispose();
			vi.useRealTimers();
			initTheme("dark", false);
		}
	});
	it("rebuilds same-array same-length partial text mutations without unchanged-paint churn", () => {
		initTheme("dark", false);
		const native = createBashToolDefinition("/sandbox") as unknown as ToolRenderers;
		const config = () =>
			normalizeToolDisplayConfig({
				enabled: true,
				builtinRendererOverrides: { bash: true },
				bashOutputMode: "preview",
				showTruncationHints: true,
			});
		const controller = createToolDisplayController(
			{
				getAllTools: () => [
					{ name: "bash", sourceInfo: { source: "builtin", path: "builtin:bash" } },
				],
			},
			config,
			{ nativeRenderers: { bash: native } },
		);
		const value = {
			content: [{ type: "text", text: "old-text" }],
			details: { fullOutputPath: "first.log", truncation: { truncated: false } },
			isError: false,
		};
		const row = new ToolExecutionComponent(
			"bash",
			"mutable",
			{ command: "printf harmless" },
			{ showImages: false },
			controller.resolver("bash", () => native),
			ui,
			"/sandbox",
		);
		try {
			row.updateResult(value, true);
			expect(plain(row.render(110))).toContain("old-text");
			const content = value.content;
			value.content[0].text = "new-text";
			expect(value.content).toBe(content);
			expect(plain(row.render(110))).toContain("new-text");
			expect(plain(row.render(110))).not.toContain("old-text");
			row.invalidate();
			expect(plain(row.render(110))).toContain("new-text");
			const unchanged = row.render(110);
			expect(row.render(110)).toEqual(unchanged);
			value.details.truncation.truncated = true;
			value.details.fullOutputPath = "final.log";
			expect(plain(row.render(110))).toContain("output truncated");
			expect(plain(row.render(110))).toContain("final.log");
		} finally {
			controller.dispose();
		}
	});
	it("uses public namespace boundaries for double-underscore MCP servers", () => {
		initTheme("dark", false);
		const name = "mcp__demo__prod__echo";
		const cfg = () =>
			normalizeToolDisplayConfig({
				enabled: true,
				customToolOverrides: {
					[name]: {
						enabled: true,
						kind: "mcp",
						outputMode: "preview",
						overrideExistingRenderers: true,
					},
				},
			});
		const api = { getAllTools: () => [{ name, namespace: { name: "mcp__demo__prod" } }] };
		const controller = createToolDisplayController(api, cfg, { nativeRenderers: {} });
		const row = new ToolExecutionComponent(
			name,
			"namespace",
			{ message: "hello" },
			{ showImages: false },
			controller.resolver(name, () => ({})),
			ui,
			"/sandbox",
		);
		expect(plain(row.render(110))).toContain("MCP demo__prod/echo (1 arg)");
		controller.dispose();
	});
	it("does not UTF8-scan the unbounded original merely to detect extraction truncation", () => {
		const input = "x".repeat(3 * 1024 * 1024);
		const original = Buffer.byteLength;
		const full: string[] = [];
		const spy = vi.spyOn(Buffer, "byteLength").mockImplementation((value, ...rest) => {
			if (value === input) full.push("original");
			return Reflect.apply(original, Buffer, [value, ...rest]);
		});
		try {
			renderUtils.extractTextOutput({ content: [{ type: "text", text: input }] });
			expect(full).toEqual([]);
		} finally {
			spy.mockRestore();
		}
	});
	it("counts capped generic output data separately from the cap indication", () => {
		initTheme("dark", false);
		const name = "bounded_generic";
		const cfg = () =>
			normalizeToolDisplayConfig({
				enabled: true,
				customToolOverrides: {
					[name]: {
						enabled: true,
						kind: "generic",
						outputMode: "summary",
						overrideExistingRenderers: true,
					},
				},
			});
		const controller = createToolDisplayController({}, cfg, { nativeRenderers: {} });
		const row = new ToolExecutionComponent(
			name,
			"counts",
			{},
			{ showImages: false },
			controller.resolver(name, () => ({})),
			ui,
			"/sandbox",
		);
		row.updateResult({
			content: [{ type: "text", text: "x\n".repeat(20002) }],
			details: {},
			isError: false,
		});
		const output = plain(row.render(110));
		expect(output).toContain("20000 lines returned");
		expect(output).toContain("input capped");
		expect(output).not.toContain("20001 lines");
		controller.dispose();
	});
	it("rejects mutated source rather than relabelling it as the pinned reference", () => {
		const folder = mkdtempSync(join(tmpdir(), "zentui-reference-pin-"));
		const manifest = {
			commit: "fixture",
			version: "fixture",
			files: { "sample.ts": "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881" },
		};
		try {
			const source = join(folder, "src");
			mkdirSync(source);
			writeFileSync(join(source, "sample.ts"), "x");
			expect(validateReferenceSources(folder, manifest)).toEqual(manifest.files);
			writeFileSync(join(source, "sample.ts"), "modified");
			expect(() => validateReferenceSources(folder, manifest)).toThrow("source hash mismatch");
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});
});
