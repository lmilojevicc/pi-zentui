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
		const editorLabels: string[] = [];
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
		expect(editorLabels).toEqual(["name"]);
		expect(commitPatches).toEqual([{ onlyDetached: false }, { showTag: false }]);
		expect(metricsPatches).toEqual([{ onlyNonzero: false }, { ignoreSubmodules: true }]);
		expect(defaultPlacements).toEqual(["off"]);
		expect(requestRender).toHaveBeenCalledTimes(6);
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
