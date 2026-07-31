import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { defaultConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import {
	formatElapsedDuration,
	renderMinimalistFrame,
} from "../extensions/zentui/minimalist-editor";

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

function config(overrides: Partial<PolishedTuiConfig> = {}): PolishedTuiConfig {
	return { ...defaultConfig, editorMode: "minimalist", ...overrides };
}

function render(width = 80, inputText = "draft") {
	return renderMinimalistFrame({
		width,
		editorLines: ["draft"],
		autocompleteLines: ["suggestion"],
		inputText,
		metadata: {
			cwd: `${homedir()}/project`,
			branch: "feature/minimalist",
			dirty: true,
			ahead: 2,
			behind: 1,
			costLabel: "$0.123",
			modelLabel: "model-x",
			thinkingLevel: "high",
			contextPercent: 42.4,
			agentDurationMs: 12_500,
			agentActive: true,
		},
		uiTheme: theme(),
		config: config(),
	});
}

describe("minimalist editor frame", () => {
	it("renders metadata and framed autocomplete", () => {
		const lines = render();
		expect(lines[0]).toContain("12s");
		expect(lines[0]).toContain("$0.123 – model-x – high – 42%");
		expect(lines[0]).toMatch(/^╭.*╮$/);
		expect(lines[1]).toMatch(/^│ draft\s+│$/);
		expect(lines[2]).toMatch(/^├─+┤$/);
		expect(lines[3]).toContain("suggestion");
		expect(lines.at(-1)).toContain("feature/minimalist * ↑2 ↓1");
		expect(lines.at(-1)).toContain("project");
		expect(lines.at(-1)).toMatch(/^╰.*╯$/);
	});

	it("shows visual shell markers without changing editor text", () => {
		expect(render(80, "  !pwd")[0]).toContain("$ · 12s");
		expect(render(80, "  !!pwd")[0]).toContain("$ · 12s");
		expect(render(80, "draft")[0]).not.toContain("$ · 12s");
		expect(render(80, "  !pwd")[1]).toContain("draft");
	});

	it("formats active and completed elapsed durations", () => {
		expect(formatElapsedDuration(-1)).toBe("0s");
		expect(formatElapsedDuration(65_999)).toBe("1m 5s");
		expect(formatElapsedDuration(3_661_000)).toBe("1h 1m");
	});

	it.each([5, 6, 8, 12, 20, 40, 80])("keeps every decorated row within %i columns", (width) => {
		const lines = render(width);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		expect(lines[0]).toMatch(/^╭.*╮$/);
		expect(lines.at(-1)).toMatch(/^╰.*╯$/);
	});

	it("fits long Git and cwd labels with the shared balanced border rule", () => {
		const lines = renderMinimalistFrame({
			width: 32,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "/a/very/long/project/path/that/does/not/fit",
				branch: "feature/a-very-long-branch-name-that-does-not-fit",
				dirty: true,
			},
			uiTheme: theme(),
			config: config(),
		});
		expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
		expect(lines.at(-1)).toMatch(/^╰.*╯$/);
		expect(lines.at(-1)).toContain("…");
	});

	it("renders Unicode and ANSI content without overflowing", () => {
		const lines = renderMinimalistFrame({
			width: 18,
			editorLines: ["界 e\u0301 👩‍💻 \x1b[31mred\x1b[0m"],
			inputText: "界",
			metadata: {
				cwd: "/tmp/界-project",
				branch: "feature/👩‍💻-e\u0301-long",
				modelLabel: "模型-👩‍💻",
				contextPercent: 99,
			},
			uiTheme: theme(),
			config: config(),
		});
		expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
		expect(lines.join("\n")).toContain("界");
	});

	it("renders compact, project-relative, and full minimalist paths", () => {
		const pathLine = (pathDisplay: "compact" | "project" | "full", projectRoot?: string) =>
			renderMinimalistFrame({
				width: 80,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: { cwd: `${homedir()}/workspace/repo/src/lib`, projectRoot },
				uiTheme: theme(),
				config: config({
					minimalist: { ...defaultConfig.minimalist, pathDisplay },
				}),
			}).at(-1) ?? "";

		expect(pathLine("compact")).toContain("lib");
		expect(pathLine("project", `${homedir()}/workspace/repo`)).toContain("repo/src/lib");
		expect(pathLine("project")).toContain("~/workspace/repo/src/lib");
		expect(pathLine("full")).toContain("~/workspace/repo/src/lib");
	});

	it("supports focused visibility controls", () => {
		const lines = renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "/tmp/project",
				branch: "main",
				costLabel: "$1.000",
				agentDurationMs: 5000,
				contextPercent: 11,
			},
			uiTheme: theme(),
			config: config({
				minimalist: {
					...defaultConfig.minimalist,
					showTimer: false,
					showCost: false,
					showGit: false,
				},
			}),
		});
		const rendered = lines.join("\n");
		expect(rendered).not.toContain("5s");
		expect(rendered).not.toContain("$1.000");
		expect(rendered).not.toContain("main");
		expect(rendered).toContain("11%");
	});

	it("renders percent, percent-total, and gauge context forms", () => {
		const contextLine = (
			contextFormat: "percent" | "percent-total",
			contextGauge: boolean,
			contextWindow?: number,
			width = 80,
		) =>
			renderMinimalistFrame({
				width,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: { cwd: "/tmp", contextPercent: 11, contextWindow },
				uiTheme: theme(),
				config: config({
					minimalist: { ...defaultConfig.minimalist, contextFormat, contextGauge },
				}),
			})[0] ?? "";

		expect(contextLine("percent", false, 372_000)).toContain("11%");
		expect(contextLine("percent", false, 372_000)).not.toContain("372k");
		expect(contextLine("percent-total", false, 372_000)).toContain("11%/372k");
		expect(contextLine("percent-total", false)).toContain("11%");
		expect(contextLine("percent-total", false)).not.toContain("/");
		expect(contextLine("percent-total", true, 372_000)).toContain("[█░░░░] 11%/372k");
		const narrow = contextLine("percent-total", true, 372_000, 16);
		expect(narrow).toContain("11%/372k");
		expect(narrow).not.toContain("[");
		expect(visibleWidth(narrow)).toBeLessThanOrEqual(16);
	});

	it("uses the adaptive border callback when configured", () => {
		const lines = renderMinimalistFrame({
			width: 20,
			editorLines: ["draft"],
			inputText: "!pwd",
			metadata: { cwd: "/tmp" },
			uiTheme: theme(),
			config: config({ editorBorderColorMode: "adaptive" }),
			borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
		});
		expect(lines.join("\n")).toContain("\x1b[36m");
		expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
	});
});
