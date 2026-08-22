import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { defaultConfig, mergeConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import {
	formatElapsedDuration,
	type MinimalistEditorMetadata,
	renderMinimalistFrame,
} from "../extensions/zentui/minimalist-editor";
import { createInitialState } from "../extensions/zentui/state";

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

function recordingTheme(calls: Array<{ color: string; text: string }>): Theme {
	return {
		...theme(),
		fg(color: string, text: string) {
			calls.push({ color, text });
			return text;
		},
	} as Theme;
}

function config(overrides: Partial<PolishedTuiConfig> = {}): PolishedTuiConfig {
	const editor = defaultConfig.components.editor;
	return {
		...defaultConfig,
		...overrides,
		components: {
			...defaultConfig.components,
			editor: {
				...editor,
				style: "minimalist",
				borderColorMode: overrides.editorBorderColorMode ?? editor.borderColorMode,
				colorSource: overrides.colorSources?.editor ?? editor.colorSource,
				styles: {
					...editor.styles,
					minimalist: {
						...editor.styles.minimalist,
						...overrides.editorStyles?.minimalist,
					},
				},
			},
		},
	};
}

function render(width = 80, inputText = "draft", viewport?: { above?: string; below?: string }) {
	return renderMinimalistFrame({
		width,
		editorLines: ["draft"],
		autocompleteLines: ["suggestion"],
		viewport,
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
			sessionName: "release prep",
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
		expect(lines[0]).toContain("12s · release prep");
		expect(lines[0]).toContain("$0.123 – model-x – high – 42%");
		expect(lines[0]).toMatch(/^╭.*╮$/);
		expect(lines[1]).toMatch(/^│ draft\s+│$/);
		expect(lines[2]).toMatch(/^├─+┤$/);
		expect(lines[3]).toContain("suggestion");
		expect(lines.at(-1)).toContain("feature/minimalist * ↑2 ↓1");
		expect(lines.at(-1)).toContain("project");
		expect(lines.at(-1)).toMatch(/^╰.*╯$/);
	});

	it("uses distinct theme roles for default minimalist metadata", () => {
		const calls: Array<{ color: string; text: string }> = [];
		const lines = renderMinimalistFrame({
			width: 120,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "/tmp/project",
				branch: "main",
				costLabel: "$0.123",
				modelLabel: "model-x",
				thinkingLevel: "high",
				contextPercent: 42,
			},
			uiTheme: recordingTheme(calls),
			config: config(),
		});

		expect(lines.join("\n")).toContain("main");
		expect(calls).toEqual(
			expect.arrayContaining([
				{ color: "success", text: "$0.123" },
				{ color: "syntaxKeyword", text: "model-x" },
				{ color: "warning", text: "high" },
				{ color: "muted", text: "42%" },
				{ color: "syntaxKeyword", text: "main" },
				{ color: "syntaxFunction", text: "project" },
			]),
		);
		const branchColor = calls.find(({ text }) => text === "main")?.color;
		const cwdColor = calls.find(({ text }) => text === "project")?.color;
		expect(branchColor).toBe("syntaxKeyword");
		expect(branchColor).not.toBe(cwdColor);
		const chromeCalls = calls.filter(({ text }) => /^[╭╮╰╯─│ –]+$/.test(text));
		expect(chromeCalls.length).toBeGreaterThan(0);
		expect(new Set(chromeCalls.map(({ color }) => color))).toEqual(new Set(["borderMuted"]));
	});

	it.each([
		["bold purple", "syntaxKeyword"],
		["success", "success"],
	] as const)("preserves an explicit legacy gitBranch color %s", (gitBranch, expectedColor) => {
		const calls: Array<{ color: string; text: string }> = [];
		renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", branch: "main" },
			uiTheme: recordingTheme(calls),
			config: config({ colors: mergeConfig({ colors: { gitBranch } }).colors }),
		});
		expect(calls).toContainEqual({ color: expectedColor, text: "main" });
	});

	it.each([
		[70, "warning"],
		[90, "error"],
	] as const)("keeps %i%% context on the %s semantic tier", (contextPercent, color) => {
		const calls: Array<{ color: string; text: string }> = [];
		renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", contextPercent },
			uiTheme: recordingTheme(calls),
			config: config(),
		});
		expect(calls).toContainEqual({ color, text: `${contextPercent}%` });
	});

	it("preserves custom theme roles", () => {
		const calls: Array<{ color: string; text: string }> = [];
		const colors = {
			...defaultConfig.colors,
			cwd: "accent",
			gitBranch: "bold purple",
			editorGitBranch: "success",
			cost: "warning",
			contextNormal: "dim",
			editorModel: "text",
			editorThinkingHigh: "thinkingHigh",
		};
		renderMinimalistFrame({
			width: 120,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "/tmp/project",
				branch: "main",
				costLabel: "$0.123",
				modelLabel: "model-x",
				thinkingLevel: "high",
				contextPercent: 42,
			},
			uiTheme: recordingTheme(calls),
			config: config({ colors }),
		});
		expect(calls).toEqual(
			expect.arrayContaining([
				{ color: "warning", text: "$0.123" },
				{ color: "text", text: "model-x" },
				{ color: "thinkingHigh", text: "high" },
				{ color: "muted", text: "42%" },
				{ color: "success", text: "main" },
				{ color: "accent", text: "project" },
			]),
		);
	});

	it("uses the complete default terminal palette", () => {
		const terminalConfig = config({
			colorSources: { ...defaultConfig.colorSources, editor: "terminal" },
		});
		const output = renderMinimalistFrame({
			width: 120,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "/tmp/project",
				branch: "main",
				costLabel: "$0.123",
				modelLabel: "model-x",
				thinkingLevel: "high",
				contextPercent: 42,
			},
			uiTheme: theme(),
			config: terminalConfig,
		}).join("\n");

		expect(output).toContain("\x1b[1;32m$0.123\x1b[0m");
		expect(output).toContain("\x1b[1;35mmodel-x\x1b[0m");
		expect(output).toContain("\x1b[1;33mhigh\x1b[0m");
		expect(output).toContain("\x1b[90m42%\x1b[0m");
		expect(output).toContain("\x1b[1;34mmain\x1b[0m");
		expect(output).toContain("\x1b[1;36mproject\x1b[0m");
		expect(output).toContain("\x1b[90m╭\x1b[0m");

		for (const [contextPercent, expected] of [
			[70, "\x1b[1;33m70%\x1b[0m"],
			[90, "\x1b[1;31m90%\x1b[0m"],
		] as const) {
			const contextOutput = renderMinimalistFrame({
				width: 80,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: { cwd: "", contextPercent },
				uiTheme: theme(),
				config: terminalConfig,
			}).join("\n");
			expect(contextOutput).toContain(expected);
		}
	});

	it("preserves custom terminal colors and legacy branch provenance", () => {
		const legacyColors = mergeConfig({
			colors: {
				gitBranch: "cyan",
				editorModel: "bright-purple",
				editorThinkingHigh: "yellow",
			},
		}).colors;
		const legacyOutput = renderMinimalistFrame({
			width: 120,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "",
				branch: "main",
				modelLabel: "model-x",
				thinkingLevel: "high",
			},
			uiTheme: theme(),
			config: config({
				colorSources: { ...defaultConfig.colorSources, editor: "terminal" },
				colors: legacyColors,
			}),
		}).join("\n");
		expect(legacyOutput).toContain("\x1b[95mmodel-x\x1b[0m");
		expect(legacyOutput).toContain("\x1b[33mhigh\x1b[0m");
		expect(legacyOutput).toContain("\x1b[36mmain\x1b[0m");

		const canonicalOutput = renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", branch: "main" },
			uiTheme: theme(),
			config: config({
				colorSources: { ...defaultConfig.colorSources, editor: "terminal" },
				colors: mergeConfig({
					colors: { gitBranch: "cyan", editorGitBranch: "bright-green" },
				}).colors,
			}),
		}).join("\n");
		expect(canonicalOutput).toContain("\x1b[92mmain\x1b[0m");
	});

	it("puts complete viewport counts first on their matching borders", () => {
		const lines = render(80, "draft", { above: "7", below: "11" });
		expect(lines[0]).toMatch(/^╭─ ↑ 7 more · 12s · release prep/);
		expect(lines.at(-1)).toMatch(/^╰─ ↓ 11 more · feature\/minimalist \* ↑2 ↓1/);
	});

	it.each([
		[{ above: "7" }, "↑ 7 more", "↓"],
		[{ below: "11" }, "↓ 11 more", "↑"],
	] as const)("supports one-sided viewport counts", (viewport, present, absent) => {
		const borders = [render(80, "draft", viewport)[0], render(80, "draft", viewport).at(-1)].join(
			"\n",
		);
		expect(borders).toContain(present);
		expect(borders).not.toContain(`${absent} `);
	});

	it("omits viewport counts atomically when they do not fit", () => {
		const lines = renderMinimalistFrame({
			width: 18,
			editorLines: ["draft"],
			viewport: { above: "123456789", below: "987654321" },
			inputText: "draft",
			metadata: { cwd: "" },
			uiTheme: theme(),
			config: config(),
		});
		expect(lines[0]).not.toContain("more");
		expect(lines.at(-1)).not.toContain("more");
		expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
	});

	it("shows visual shell markers without changing editor text", () => {
		expect(render(80, "  !pwd")[0]).toContain("$ · 12s");
		expect(render(80, "  !!pwd")[0]).toContain("$ · 12s");
		expect(render(80, "draft")[0]).not.toContain("$ · 12s");
		expect(render(80, "  !pwd")[1]).toContain("draft");
	});

	it("shows the explicit session name after the timer and omits it when disabled", () => {
		const enabled = renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "/tmp", agentDurationMs: 12_000, sessionName: "release\nprep" },
			uiTheme: theme(),
			config: config(),
		})[0];
		expect(enabled).toContain("12s · release prep");

		const disabled = renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "/tmp", agentDurationMs: 12_000, sessionName: "release prep" },
			uiTheme: theme(),
			config: config({
				editorStyles: {
					minimalist: {
						...defaultConfig.editorStyles.minimalist,
						showSessionName: false,
					},
				},
			}),
		})[0];
		expect(disabled).not.toContain("release prep");
	});

	it("drops a long session name before viewport and operational indicators", () => {
		const top = renderMinimalistFrame({
			width: 34,
			editorLines: ["draft"],
			viewport: { above: "7" },
			inputText: "!pwd",
			metadata: {
				cwd: "/tmp",
				agentDurationMs: 12_000,
				sessionName: "a very long session name that cannot fit",
			},
			uiTheme: theme(),
			config: config(),
		})[0];
		expect(top).toContain("↑ 7 more · $ · 12s");
		expect(top).not.toContain("session");
		expect(visibleWidth(top)).toBeLessThanOrEqual(34);
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
					editorStyles: {
						minimalist: { ...defaultConfig.editorStyles.minimalist, pathDisplay },
					},
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
				editorStyles: {
					minimalist: {
						...defaultConfig.editorStyles.minimalist,
						showTimer: false,
						showCost: false,
						showGit: false,
					},
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
					editorStyles: {
						minimalist: {
							...defaultConfig.editorStyles.minimalist,
							contextFormat,
							contextGauge,
						},
					},
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

	it("uses minimalist-owned context thresholds independently of footer thresholds", () => {
		const base = config();
		const divergent = {
			...base,
			colors: {
				...base.colors,
				contextNormal: "bright-black",
				contextWarning: "yellow",
				contextError: "red",
			},
			components: {
				...base.components,
				editor: {
					...base.components.editor,
					colorSource: "terminal" as const,
					styles: {
						...base.components.editor.styles,
						minimalist: {
							...base.components.editor.styles.minimalist,
							contextThresholds: { warning: 40, error: 60 },
						},
					},
				},
				footer: {
					...base.components.footer,
					colorSource: "terminal" as const,
					styles: {
						starship: {
							...base.components.footer.styles.starship,
							format: "$context",
							responsive: false,
							contextThresholds: { warning: 70, error: 90 },
						},
					},
				},
			},
		};
		const taggedTheme = {
			...theme(),
			fg(color: string, text: string) {
				return `[${color}]${text}`;
			},
		} as Theme;
		const rendered = renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "/tmp", contextPercent: 50 },
			uiTheme: taggedTheme,
			config: divergent,
		}).join("\n");
		expect(rendered).toContain("\x1b[33m50%\x1b[0m");
		expect(rendered).not.toContain("\x1b[90m50%\x1b[0m");

		let footerFactory:
			| ((
					tui: { requestRender(): void },
					theme: Theme,
					data: {
						onBranchChange(callback: () => void): () => void;
						getExtensionStatuses(): Map<string, string>;
					},
			  ) => { render(width: number): string[] })
			| undefined;
		const footerContext = {
			cwd: "/tmp",
			model: { contextWindow: 100_000 },
			getContextUsage: () => ({ percent: 50, tokens: 50_000, contextWindow: 100_000 }),
			sessionManager: { getSessionName: () => undefined },
			ui: {
				setFooter(factory: typeof footerFactory) {
					footerFactory = factory;
				},
			},
		};
		installFooter(footerContext as never, createInitialState(emptyGitStatus()), () => divergent, {
			setRequestRender() {},
			scheduleProjectRefresh() {},
		});
		const footer = footerFactory?.({ requestRender() {} }, taggedTheme, {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map(),
		});
		const footerRendered = footer?.render(80).join("\n") ?? "";
		expect(footerRendered).toContain("\x1b[90m50.0%/100k\x1b[0m");
		expect(footerRendered).not.toContain("\x1b[33m50.0%/100k\x1b[0m");
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

	it("keeps adaptive theme borders and thinking labels on the same renderer", () => {
		const colors = {
			...defaultConfig.colors,
			editorBorder: "error",
			editorThinkingHigh: "success",
		};
		const adaptiveConfig = config({ colors, editorBorderColorMode: "adaptive" });
		const renderWith = (uiTheme: Theme, borderColor?: (text: string) => string) =>
			renderMinimalistFrame({
				width: 80,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: { cwd: "", thinkingLevel: "high" },
				uiTheme,
				config: adaptiveConfig,
				borderColor,
			}).join("\n");

		const adaptive = renderWith(theme(), (text) => `\x1b[36m${text}\x1b[0m`);
		expect(adaptive).toContain("\x1b[36m╭\x1b[0m");
		expect(adaptive).toContain("\x1b[36mhigh\x1b[0m");

		for (const failedBorderColor of [
			undefined,
			() => {
				throw new Error("adaptive color failed");
			},
			(() => 42) as unknown as (text: string) => string,
		]) {
			const calls: Array<{ color: string; text: string }> = [];
			renderWith(recordingTheme(calls), failedBorderColor);
			expect(calls).toContainEqual({ color: "error", text: "╭" });
			expect(calls).toContainEqual({ color: "error", text: "high" });
			expect(calls).not.toContainEqual({ color: "success", text: "high" });
		}

		const staticCalls: Array<{ color: string; text: string }> = [];
		renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", thinkingLevel: "high" },
			uiTheme: recordingTheme(staticCalls),
			config: config({ colors, editorBorderColorMode: "static" }),
			borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
		});
		expect(staticCalls).toContainEqual({ color: "error", text: "╭" });
		expect(staticCalls).toContainEqual({ color: "success", text: "high" });
	});

	it.each([
		["minimal", "\x1b[90m"],
		["low", "\x1b[34m"],
		["medium", "\x1b[36m"],
		["high", "\x1b[33m"],
		["xhigh", "\x1b[31m"],
		["max", "\x1b[91m"],
	] as const)("uses the terminal adaptive color for %s borders and labels", (level, ansi) => {
		const output = renderMinimalistFrame({
			width: 80,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: { cwd: "", thinkingLevel: level },
			uiTheme: theme(),
			config: config({
				editorBorderColorMode: "adaptive",
				colorSources: { ...defaultConfig.colorSources, editor: "terminal" },
			}),
			borderColor: (text) => `[theme]${text}`,
		}).join("\n");
		expect(output).toContain(`${ansi}╭\x1b[0m`);
		expect(output).toContain(`${ansi}${level}\x1b[0m`);
		expect(output).not.toContain("[theme]");
	});

	it.each([
		[{ editorThinkingMax: "bright-purple" }, "max", "\x1b[95m"],
		[{ editorThinkingXhigh: "bright-cyan" }, "max", "\x1b[96m"],
		[{ editorThinking: "bright-green" }, "low", "\x1b[92m"],
	] as const)(
		"uses configured terminal adaptive thinking colors for both border and %s label",
		(colors, level, ansi) => {
			const output = renderMinimalistFrame({
				width: 80,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: { cwd: "", thinkingLevel: level },
				uiTheme: theme(),
				config: config({
					colors: { ...defaultConfig.colors, ...colors },
					editorBorderColorMode: "adaptive",
					colorSources: { ...defaultConfig.colorSources, editor: "terminal" },
				}),
			}).join("\n");
			expect(output).toContain(`${ansi}╭\x1b[0m`);
			expect(output).toContain(`${ansi}${level}\x1b[0m`);
		},
	);

	it.each([undefined, "", "off"])(
		"keeps terminal adaptive borders static and omits an inactive thinking level %s",
		(thinkingLevel) => {
			const output = renderMinimalistFrame({
				width: 80,
				editorLines: ["draft"],
				inputText: "draft",
				metadata: { cwd: "", thinkingLevel },
				uiTheme: theme(),
				config: config({
					editorBorderColorMode: "adaptive",
					colorSources: { ...defaultConfig.colorSources, editor: "terminal" },
				}),
				borderColor: (text) => `[theme]${text}`,
			}).join("\n");
			expect(output).toContain("\x1b[90m╭\x1b[0m");
			expect(output).not.toContain("[theme]");
			expect(output).not.toContain("off");
		},
	);

	it("colors every separator in the full top-right sequence with the resolved border color", () => {
		const top = renderMinimalistFrame({
			width: 100,
			editorLines: ["draft"],
			inputText: "draft",
			metadata: {
				cwd: "",
				costLabel: "$0.000",
				modelLabel: "gpt-5.6-terra",
				thinkingLevel: "minimal",
				contextPercent: 0,
			},
			uiTheme: theme(),
			config: config({ editorBorderColorMode: "adaptive" }),
			borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
		})[0];

		expect(top).toContain(
			"$0.000\x1b[36m – \x1b[0mgpt-5.6-terra\x1b[36m – \x1b[0m\x1b[36mminimal\x1b[0m\x1b[36m – \x1b[0m0%",
		);
		expect(top.match(/\x1b\[36m – \x1b\[0m/g)).toHaveLength(3);
		expect(top).not.toContain("\x1b[36m$0.000");
		expect(top).not.toContain("\x1b[36mgpt-5.6-terra");
	});

	it.each([
		[
			"without cost",
			{ cwd: "", modelLabel: "model", thinkingLevel: "low", contextPercent: 12 },
			"model\x1b[36m – \x1b[0m\x1b[36mlow\x1b[0m\x1b[36m – \x1b[0m12%",
		],
		[
			"without model",
			{ cwd: "", costLabel: "$1", thinkingLevel: "high", contextPercent: 25 },
			"$1\x1b[36m – \x1b[0m\x1b[36mhigh\x1b[0m\x1b[36m – \x1b[0m25%",
		],
		[
			"without thinking",
			{ cwd: "", costLabel: "$2", modelLabel: "model", contextPercent: 50 },
			"$2\x1b[36m – \x1b[0mmodel\x1b[36m – \x1b[0m50%",
		],
		[
			"without context",
			{ cwd: "", costLabel: "$3", modelLabel: "model", thinkingLevel: "xhigh" },
			"$3\x1b[36m – \x1b[0mmodel\x1b[36m – \x1b[0m\x1b[36mxhigh\x1b[0m",
		],
	] satisfies Array<[string, MinimalistEditorMetadata, string]>)(
		"uses the resolved border separator %s",
		(_name, metadata, expected) => {
			const top = renderMinimalistFrame({
				width: 100,
				editorLines: ["draft"],
				inputText: "draft",
				metadata,
				uiTheme: theme(),
				config: config({ editorBorderColorMode: "adaptive" }),
				borderColor: (text) => `\x1b[36m${text}\x1b[0m`,
			})[0];

			expect(top).toContain(expected);
			expect(top).not.toContain("[muted] – ");
		},
	);
});
