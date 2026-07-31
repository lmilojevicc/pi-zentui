import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
	defaultConfig,
	type ExtensionStatusPlacement,
	type PolishedTuiConfig,
} from "../extensions/zentui/config";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";

type Component = {
	render(width: number): string[];
	handleInput(data: string): void;
};

const sectionNames = ["Appearance", "Editor", "Footer", "Segments", "Git", "Extensions"] as const;
type SectionName = (typeof sectionNames)[number];

function theme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => `[${text}]`,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
}

function cloneConfig(): PolishedTuiConfig {
	return structuredClone(defaultConfig);
}

function goToSection(component: Component, section: SectionName): void {
	for (let index = 0; index < sectionNames.indexOf(section); index += 1)
		component.handleInput("\t");
}

function selectLabel(component: Component, label: string): void {
	for (let attempts = 0; attempts < 30; attempts += 1) {
		if (component.render(120).some((line) => line.includes(`> ${label}`))) return;
		component.handleInput("\x1b[B");
	}
	throw new Error(`Could not select settings row: ${label}`);
}

function renderedValue(component: Component, label: string): string {
	selectLabel(component, label);
	return component.render(120).find((line) => line.includes(`> ${label}`)) ?? "";
}

describe("bounded /zentui settings", () => {
	it("orders the six sections and applies all six new controls from effective config", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const editorModes: string[] = [];
		const editorLabels: string[] = [];
		const minimalistPatches: Array<Record<string, unknown>> = [];
		const commitPatches: Array<Record<string, boolean>> = [];
		const metricsPatches: Array<Record<string, boolean>> = [];
		const defaultPlacements: ExtensionStatusPlacement[] = [];
		const requestRender = vi.fn();
		let firstRender = "";

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				setEditorMode(value) {
					editorModes.push(value);
					config.editorMode = value;
				},
				setMinimalist(patch) {
					minimalistPatches.push(patch);
					Object.assign(config.minimalist, patch);
				},
				setEditorModelLabel(value) {
					editorLabels.push(value);
					config.editorModelLabel = value;
				},
				setGitCommit(patch) {
					commitPatches.push(patch as Record<string, boolean>);
					Object.assign(config.gitCommit, patch);
				},
				setGitMetrics(patch) {
					metricsPatches.push(patch as Record<string, boolean>);
					Object.assign(config.gitMetrics, patch);
				},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusDefaultPlacement(placement) {
					defaultPlacements.push(placement);
					config.extensionStatuses.defaultPlacement = placement;
				},
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender,
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "tui",
			cwd: process.cwd(),
			ui: {
				theme: theme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					firstRender = component.render(160).join("\n");

					goToSection(component, "Editor");
					selectLabel(component, "Editor mode");
					component.handleInput(" ");
					for (const label of [
						"Minimalist path",
						"Minimalist context text",
						"Minimalist context gauge",
						"Minimalist timer",
						"Minimalist cost",
						"Minimalist Git",
					]) {
						selectLabel(component, label);
						component.handleInput(" ");
					}
					selectLabel(component, "Editor model label");
					component.handleInput(" ");

					for (let index = 0; index < 3; index += 1) component.handleInput("\t");
					selectLabel(component, "Commit only on detached HEAD");
					component.handleInput(" ");
					selectLabel(component, "Show exact-match tag");
					component.handleInput(" ");
					selectLabel(component, "Hide zero metrics");
					component.handleInput(" ");
					selectLabel(component, "Ignore submodules");
					component.handleInput(" ");

					component.handleInput("\t");
					selectLabel(component, "Default placement");
					component.handleInput(" ");
				},
			},
		});

		let lastIndex = -1;
		for (const section of sectionNames) {
			const index = firstRender.indexOf(section);
			expect(index).toBeGreaterThan(lastIndex);
			lastIndex = index;
		}
		expect(editorModes).toEqual(["minimalist"]);
		expect(editorLabels).toEqual(["name"]);
		expect(minimalistPatches).toEqual([
			{ pathDisplay: "project" },
			{ contextFormat: "percent-total" },
			{ contextGauge: true },
			{ showTimer: false },
			{ showCost: false },
			{ showGit: false },
		]);
		expect(commitPatches).toEqual([{ onlyDetached: false }, { showTag: false }]);
		expect(metricsPatches).toEqual([{ onlyNonzero: false }, { ignoreSubmodules: true }]);
		expect(defaultPlacements).toEqual(["off"]);
		expect(requestRender).toHaveBeenCalledTimes(13);
	});

	it("cycles editor border color mode live and reopens with the persisted value", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const values: string[] = [];
		const rows: string[] = [];
		const notifications: string[] = [];
		const requestRender = vi.fn();
		const tuiRequestRender = vi.fn();
		let liveTuiRenderCalls = 0;
		let closeCalls = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				setEditorBorderColorMode(value) {
					values.push(value);
					config.editorBorderColorMode = value;
				},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender,
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		let invocation = 0;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify(message: string) {
					notifications.push(message);
				},
				async custom(factory: (...args: unknown[]) => unknown) {
					invocation += 1;
					const component = factory({ requestRender: tuiRequestRender }, theme(), {}, () => {
						closeCalls += 1;
					}) as Component;
					goToSection(component, "Editor");
					rows.push(renderedValue(component, "Editor border color"));
					if (invocation === 1) {
						tuiRequestRender.mockClear();
						component.handleInput(" ");
						liveTuiRenderCalls = tuiRequestRender.mock.calls.length;
						rows.push(renderedValue(component, "Editor border color"));
					}
				},
			},
		};

		await command?.handler("", ctx);
		await command?.handler("", ctx);

		expect(values).toEqual(["adaptive"]);
		expect(config.editorBorderColorMode).toBe("adaptive");
		expect(rows[0]).toContain("static");
		expect(rows[1]).toContain("adaptive");
		expect(rows[2]).toContain("adaptive");
		expect(requestRender).toHaveBeenCalledTimes(1);
		expect(liveTuiRenderCalls).toBe(1);
		expect(notifications).toEqual(["Editor border color: adaptive"]);
		expect(closeCalls).toBe(0);
	});

	it("keeps editor border color unchanged when persistence fails", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const rows: string[] = [];
		const notifications: Array<{ message: string; level: string }> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				setEditorBorderColorMode() {
					throw new Error("config is read-only");
				},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					goToSection(component, "Editor");
					rows.push(renderedValue(component, "Editor border color"));
					component.handleInput(" ");
					rows.push(renderedValue(component, "Editor border color"));
				},
			},
		});

		expect(config.editorBorderColorMode).toBe("static");
		expect(rows.every((row) => row.includes("static") && !row.includes("adaptive"))).toBe(true);
		expect(notifications).toEqual([
			{ message: "Could not update Zentui settings: config is read-only", level: "error" },
		]);
	});

	it("keeps every active section visible and every line width-safe at 40 columns", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					for (const [index, section] of sectionNames.entries()) {
						const lines = component.render(40);
						expect(lines[1]).toContain(section);
						expect(lines[1]).toContain(`(${index + 1}/6)`);
						expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
						component.handleInput("\t");
					}
				},
			},
		});
	});

	it("uses the documented non-Git segment navigation order", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const expectedLabels = [
			"Current directory",
			"Session name",
			"Runtime",
			"Model info",
			"Context usage",
			"Token counts",
			"Session cost",
			"Session duration",
			"Username@host",
			"Current time",
			"OS icon",
			"Package version",
		];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					goToSection(component, "Segments");
					for (const label of expectedLabels) {
						expect(component.render(120).some((line) => line.includes(`> ${label}`))).toBe(true);
						component.handleInput("\x1b[B");
					}
				},
			},
		});
	});

	it("reopens changed controls with their effective current values", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const rows: string[] = [];
		let invocation = 0;
		let closeCalls = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				setEditorModelLabel(value) {
					config.editorModelLabel = value;
				},
				setGitMetrics(patch) {
					Object.assign(config.gitMetrics, patch);
				},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					invocation += 1;
					const component = factory({ requestRender() {} }, theme(), {}, () => {
						closeCalls += 1;
					}) as Component;
					goToSection(component, "Editor");
					if (invocation === 1) {
						selectLabel(component, "Editor model label");
						component.handleInput(" ");
						for (let index = 0; index < 3; index += 1) component.handleInput("\t");
						selectLabel(component, "Ignore submodules");
						component.handleInput(" ");
						component.handleInput("\x1b");
						return;
					}

					rows.push(renderedValue(component, "Editor model label"));
					for (let index = 0; index < 3; index += 1) component.handleInput("\t");
					rows.push(renderedValue(component, "Ignore submodules"));
					component.handleInput("\x1b");
				},
			},
		};

		await command?.handler("", ctx);
		await command?.handler("", ctx);

		expect(invocation).toBe(2);
		expect(closeCalls).toBe(2);
		expect(rows[0]).toContain("name");
		expect(rows[1]).toContain("enabled");
	});

	it("toggles model info, persists each change, and reopens with the effective value", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const patches: Array<Record<string, boolean>> = [];
		const rows: string[] = [];
		let invocation = 0;

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments(patch) {
					patches.push(patch as Record<string, boolean>);
					Object.assign(config.footerSegments, patch);
				},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify() {},
				async custom(factory: (...args: unknown[]) => unknown) {
					invocation += 1;
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					goToSection(component, "Segments");
					selectLabel(component, "Model info");
					if (invocation === 1) {
						rows.push(renderedValue(component, "Model info"));
						component.handleInput(" ");
						rows.push(renderedValue(component, "Model info"));
						component.handleInput(" ");
						rows.push(renderedValue(component, "Model info"));
						component.handleInput(" ");
					}
					rows.push(renderedValue(component, "Model info"));
					component.handleInput("\x1b");
				},
			},
		};

		await command?.handler("", ctx);
		await command?.handler("", ctx);

		expect(patches).toEqual([{ modelInfo: true }, { modelInfo: false }, { modelInfo: true }]);
		expect(config.footerSegments.modelInfo).toBe(true);
		expect(rows).toEqual([
			expect.stringContaining("disabled"),
			expect.stringContaining("enabled"),
			expect.stringContaining("disabled"),
			expect.stringContaining("enabled"),
			expect.stringContaining("enabled"),
		]);
	});

	it("rolls back the model-info control when persistence fails", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const patches: Array<Record<string, boolean>> = [];
		const rows: string[] = [];
		const notifications: Array<{ message: string; level: string }> = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments(patch) {
					patches.push(patch as Record<string, boolean>);
					throw new Error("config is read-only");
				},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					goToSection(component, "Segments");
					selectLabel(component, "Model info");
					rows.push(renderedValue(component, "Model info"));
					component.handleInput(" ");
					rows.push(renderedValue(component, "Model info"));
				},
			},
		});

		expect(patches).toEqual([{ modelInfo: true }]);
		expect(config.footerSegments.modelInfo).toBe(false);
		expect(rows).toEqual([
			expect.stringContaining("disabled"),
			expect.stringContaining("disabled"),
		]);
		expect(notifications).toEqual([
			{ message: "Could not update Zentui settings: config is read-only", level: "error" },
		]);
	});

	it("keeps a new control unchanged when persistence fails", async () => {
		let command: { handler(args: string, ctx: unknown): Promise<void> } | undefined;
		const config = cloneConfig();
		const attemptedValues: string[] = [];
		const notifications: Array<{ message: string; level: string }> = [];
		const rows: string[] = [];

		registerZentuiSettingsCommand(
			{
				registerCommand(_name: string, options: unknown) {
					command = options as typeof command;
				},
			} as never,
			{
				sessionLifecycle: new SessionLifecycle(),
				getConfig: () => config,
				setColorSources() {},
				setUiFeatures: () => ({ applied: true }),
				setFooterSegments() {},
				setFooterFormat() {},
				setIconMode() {},
				setContextStyle() {},
				setSeparator() {},
				setPathDisplay() {},
				setGitBranch() {},
				setEditorModelLabel(value) {
					attemptedValues.push(value);
					throw new Error("config is read-only");
				},
				getActiveExtensionStatuses: () => new Map(),
				setExtensionStatusPlacement() {},
				setExtensionStatusColorMode() {},
				setFixedEditor() {},
				requestRender() {},
				settingsListTheme: {
					label: (text) => text,
					value: (text) => text,
					description: (text) => text,
					cursor: "> ",
					hint: (text) => text,
				},
			},
		);

		await command?.handler("", {
			hasUI: true,
			mode: "tui",
			ui: {
				theme: theme(),
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
				async custom(factory: (...args: unknown[]) => unknown) {
					const component = factory({ requestRender() {} }, theme(), {}, () => {}) as Component;
					goToSection(component, "Editor");
					rows.push(renderedValue(component, "Editor model label"));
					component.handleInput(" ");
					rows.push(renderedValue(component, "Editor model label"));
				},
			},
		});

		expect(attemptedValues).toEqual(["name"]);
		expect(config.editorModelLabel).toBe("id");
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row).toContain("id");
			expect(row).not.toContain("name");
		}
		expect(notifications).toEqual([
			{
				message: "Could not update Zentui settings: config is read-only",
				level: "error",
			},
		]);
	});
});
