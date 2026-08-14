import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultConfig,
	type EditorComponentConfig,
	type ExtensionStatusPlacement,
	type FooterComponentConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type UserMessagesComponentConfig,
	type WorkingLineComponentPatch,
} from "../extensions/zentui/config";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";

type Component = { render(width: number): string[]; handleInput(data: string): void };
type Command = {
	handler(args: string, ctx: unknown): Promise<void>;
	getArgumentCompletions(prefix: string): Array<{ value: string }> | null;
};
const sectionNames = [
	"Appearance",
	"Editor",
	"User messages",
	"Working line",
	"Footer",
	"Segments",
	"Git",
	"Extensions",
] as const;
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
	for (let index = 0; index < 40; index += 1) {
		if (component.render(160).some((line) => line.includes(`> ${label}`))) return;
		component.handleInput("\x1b[B");
	}
	throw new Error(`Could not select ${label}`);
}
function row(component: Component, label: string): string {
	selectLabel(component, label);
	return component.render(160).find((line) => line.includes(`> ${label}`)) ?? "";
}
function focusedRow(component: Component): string {
	return component.render(200).find((line) => line.includes("> ")) ?? "";
}
function previewRow(rows: string[], text: string): number {
	const index = rows.findIndex((line) => line.includes(text));
	if (index < 0) throw new Error(`Could not find preview row containing ${text}`);
	return index;
}
function expectStackedPreview(rows: string[], previewText: string): void {
	const previewIndex = previewRow(rows, previewText);
	const settingsIndex = rows.findIndex(
		(line, index) => index > previewIndex && line.includes("> "),
	);
	if (settingsIndex < 0) throw new Error("Could not find settings below preview");
	expect(rows[3]).toBe("");
	expect(rows[4]).not.toBe("");
	expect(rows[settingsIndex - 1]).toBe("");
	expect(rows[settingsIndex - 2]).not.toBe("");
}
function leadingEmptyRowCount(rows: string[]): number {
	let count = 0;
	for (const row of rows.slice(3)) {
		if (row !== "") break;
		count += 1;
	}
	return count;
}
function expectFocusOrder(component: Component, labels: readonly string[]): void {
	const first = focusedRow(component);
	for (const [index, label] of labels.entries()) {
		expect(focusedRow(component)).toContain(`> ${label}`);
		if (index < labels.length - 1) component.handleInput("\x1b[B");
	}
	component.handleInput("\x1b[B");
	expect(focusedRow(component)).toBe(first);
}

function createHarness(
	config = cloneConfig(),
	overrides: Record<string, unknown> = {},
	uiOverrides: Record<string, unknown> = {},
) {
	let command: Command | undefined;
	let component: Component | undefined;
	const notifications: string[] = [];
	let doneCalls = 0;
	const sessionLifecycle = new SessionLifecycle();
	const calls = {
		editor: [] as Partial<EditorComponentConfig>[],
		messages: [] as Partial<UserMessagesComponentConfig>[],
		workingLine: [] as WorkingLineComponentPatch[],
		renders: { shared: 0, local: 0 },
		selectors: [] as Partial<SelectorBordersComponentConfig>[],
		footer: [] as Partial<FooterComponentConfig>[],
		minimalist: [] as Array<Record<string, unknown>>,
		segments: [] as Array<Record<string, boolean>>,
		gitCommit: [] as Array<Record<string, boolean>>,
		gitMetrics: [] as Array<Record<string, boolean>>,
		extensionDefaultPlacement: [] as ExtensionStatusPlacement[],
		recipe: [] as boolean[],
	};
	const deps = {
		sessionLifecycle,
		getConfig: () => config,
		setEditorComponent(patch: Partial<EditorComponentConfig>) {
			calls.editor.push(patch);
			Object.assign(config.components.editor, patch);
			return { applied: true };
		},
		setMinimalist(patch: Record<string, unknown>) {
			calls.minimalist.push(patch);
			Object.assign(config.components.editor.styles.minimalist, patch);
		},
		setUserMessagesComponent(patch: Partial<UserMessagesComponentConfig>) {
			calls.messages.push(patch);
			Object.assign(config.components.userMessages, patch);
		},
		setWorkingLineComponent(patch: WorkingLineComponentPatch) {
			calls.workingLine.push(patch);
			const { messages, segments, ...componentPatch } = patch;
			Object.assign(config.components.workingLine, componentPatch);
			if (messages) Object.assign(config.components.workingLine.messages, messages);
			if (segments) Object.assign(config.components.workingLine.segments, segments);
			return { applied: true };
		},
		setSelectorBordersComponent(patch: Partial<SelectorBordersComponentConfig>) {
			calls.selectors.push(patch);
			Object.assign(config.components.selectorBorders, patch);
		},
		setFooterComponent(patch: Partial<FooterComponentConfig>) {
			calls.footer.push(patch);
			Object.assign(config.components.footer, patch);
		},
		setFooterSegments(patch: Record<string, boolean>) {
			calls.segments.push(patch);
			Object.assign(config.components.footer.styles.starship.segments, patch);
		},
		setFooterFormat() {},
		setResponsiveFooter() {},
		setIconMode() {},
		setContextStyle() {},
		setSeparator() {},
		setPathDisplay() {},
		setGitBranch() {},
		setGitCommit(patch: Record<string, boolean>) {
			calls.gitCommit.push(patch);
			Object.assign(config.components.footer.styles.starship.gitCommit, patch);
		},
		setGitMetrics(patch: Record<string, boolean>) {
			calls.gitMetrics.push(patch);
			Object.assign(config.components.footer.styles.starship.gitMetrics, patch);
		},
		getActiveExtensionStatuses: () => new Map(),
		setExtensionStatusDefaultPlacement(placement: ExtensionStatusPlacement) {
			calls.extensionDefaultPlacement.push(placement);
			config.components.footer.styles.starship.extensionStatuses.defaultPlacement = placement;
		},
		setExtensionStatusPlacement() {},
		setExtensionStatusColorMode() {},
		requestRender() {
			calls.renders.shared += 1;
		},
		settingsListTheme: {
			label: (text: string) => text,
			value: (text: string) => text,
			description: (text: string) => text,
			cursor: "> ",
			hint: (text: string) => text,
		},
		...overrides,
	};
	registerZentuiSettingsCommand(
		{
			registerCommand(_name: string, value: unknown) {
				command = value as Command;
			},
		} as never,
		deps as never,
	);
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd: process.cwd(),
		ui: {
			theme: theme(),
			notify(message: string) {
				notifications.push(message);
			},
			async custom(factory: (...args: unknown[]) => unknown) {
				component = factory(
					{
						requestRender() {
							calls.renders.local += 1;
						},
					},
					theme(),
					{},
					() => {
						doneCalls += 1;
					},
				) as Component;
			},
			async editor() {
				return undefined;
			},
			...uiOverrides,
		},
	};
	return {
		config,
		command: () => {
			if (!command) throw new Error("Command was not registered");
			return command;
		},
		component: () => {
			if (!component) throw new Error("Settings component was not opened");
			return component;
		},
		ctx,
		calls,
		notifications,
		sessionLifecycle,
		doneCalls: () => doneCalls,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("component-oriented /zentui settings", () => {
	it("uses the exact eight-section order in wide and narrow navigation", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		const wide = component.render(200).join("\n");
		let previous = -1;
		for (const name of sectionNames) {
			const index = wide.indexOf(name);
			expect(index).toBeGreaterThan(previous);
			previous = index;
		}
		for (const [index, name] of sectionNames.entries()) {
			const lines = component.render(40);
			expect(lines[1]).toContain(name);
			expect(lines[1]).toContain(`(${index + 1}/8)`);
			expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
			component.handleInput("\t");
		}
	});

	it("describes elapsed and tokens unequivocally as whole-interaction totals", async () => {
		const harness = createHarness();
		await harness.command().handler("working-line", harness.ctx);
		const component = harness.component();
		selectLabel(component, "Elapsed");
		expect(component.render(100).join("\n")).toContain("Show whole-interaction elapsed time.");
		selectLabel(component, "Tokens");
		const tokenRows = component.render(100).join("\n");
		expect(tokenRows).toContain("Show whole-interaction tokens as ↑input");
		expect(tokenRows).toContain("until final usage");
		expect(tokenRows).toContain("reconciles.");
	});

	it("uses exact component-owned row sets and ordering", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		expectFocusOrder(component, [
			"Selector borders",
			"Selector border style",
			"Selector border colors",
			"Icon mode",
		]);

		goToSection(component, "Editor");
		expectFocusOrder(component, [
			"Editor",
			"Editor style",
			"Editor colors",
			"Editor model label",
			"Editor border color",
			"Editor viewport indicators",
		]);

		component.handleInput("\t");
		expectFocusOrder(component, ["User messages", "Message style", "Message colors"]);
		component.handleInput("\t");
		expectFocusOrder(component, [
			"Enabled",
			"Turn summary",
			"Spinner",
			"Spinner speed",
			"Animate spinner color",
			"Text animation",
			"Text motion speed",
			"Color source",
			"Custom messages",
			"Tool",
			"Elapsed",
			"Thinking",
			"Tokens",
			"Message list",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, [
			"Footer style",
			"Footer colors",
			"Footer model label",
			"Responsive footer",
			"Compact footer rows",
			"Context style",
			"Separator",
			"Path display",
			"Path depth",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, [
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
		]);
		component.handleInput("\t");
		expectFocusOrder(component, [
			"Git branch",
			"Branch length",
			"Git status",
			"Git counts",
			"Git commit",
			"Commit only on detached HEAD",
			"Show exact-match tag",
			"Git line metrics",
			"Hide zero metrics",
			"Ignore submodules",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, ["Default placement", "No active statuses"]);
	});

	it.each(["native", "hidden"] as const)(
		"shows only Footer style for %s while retaining Starship preconfiguration sections",
		async (style) => {
			const config = cloneConfig();
			config.components.footer.style = style;
			const harness = createHarness(config);
			await harness.command().handler("", harness.ctx);
			const component = harness.component();
			goToSection(component, "Footer");
			expectFocusOrder(component, ["Footer style"]);
			component.handleInput("\t");
			expectFocusOrder(component, [
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
			]);
			component.handleInput("\t");
			expect(row(component, "Git branch")).toContain("enabled");
			component.handleInput("\t");
			expect(row(component, "Default placement")).toContain("right");
		},
	);

	it("keeps Footer-style focus through Native, Starship, and Hidden rebuilds", async () => {
		const config = cloneConfig();
		config.components.footer.style = "native";
		const harness = createHarness(config);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Footer");
		for (const expected of ["Starship", "Hidden", "Native"]) {
			component.handleInput(" ");
			expect(focusedRow(component)).toContain("> Footer style");
			expect(focusedRow(component)).toContain(expected);
		}
		expect(harness.calls.footer).toEqual([
			{ style: "starship" },
			{ style: "hidden" },
			{ style: "native" },
		]);
	});

	it("restores Footer-style focus and effective rows after persistence failure", async () => {
		const config = cloneConfig();
		config.components.footer.style = "native";
		const harness = createHarness(config, {
			setFooterComponent() {
				throw new Error("read-only footer");
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Footer");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Footer style");
		expect(focusedRow(component)).toContain("Native");
		expectFocusOrder(component, ["Footer style"]);
		expect(harness.notifications).toEqual(["Could not update Zentui settings: read-only footer"]);
	});

	it("shows exact minimalist rows while components are disabled", async () => {
		const config = cloneConfig();
		config.components.editor.enabled = false;
		config.components.editor.style = "minimalist";
		config.components.userMessages.enabled = false;
		const harness = createHarness(config);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		expectFocusOrder(component, [
			"Editor",
			"Editor style",
			"Editor colors",
			"Editor model label",
			"Editor border color",
			"Editor viewport indicators",
			"Path",
			"Context text",
			"Context gauge",
			"Session name",
			"Timer",
			"Cost",
			"Git",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, ["User messages", "Message style", "Message colors"]);
	});

	it("routes every minimalist, Git option, and default-placement action", async () => {
		const config = cloneConfig();
		config.components.editor.style = "minimalist";
		const harness = createHarness(config);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");

		for (const [label, value] of [
			["Path", "project"],
			["Context text", "percent-total"],
			["Context gauge", "enabled"],
			["Session name", "disabled"],
			["Timer", "disabled"],
			["Cost", "disabled"],
			["Git", "disabled"],
		] as const) {
			selectLabel(component, label);
			component.handleInput(" ");
			expect(focusedRow(component)).toContain(`> ${label}`);
			expect(focusedRow(component)).toContain(value);
		}
		expect(harness.calls.minimalist).toEqual([
			{ pathDisplay: "project" },
			{ contextFormat: "percent-total" },
			{ contextGauge: true },
			{ showSessionName: false },
			{ showTimer: false },
			{ showCost: false },
			{ showGit: false },
		]);

		for (let index = 0; index < 5; index += 1) component.handleInput("\t");
		for (const [label, value] of [
			["Commit only on detached HEAD", "disabled"],
			["Show exact-match tag", "disabled"],
			["Hide zero metrics", "disabled"],
			["Ignore submodules", "enabled"],
		] as const) {
			selectLabel(component, label);
			component.handleInput(" ");
			expect(focusedRow(component)).toContain(`> ${label}`);
			expect(focusedRow(component)).toContain(value);
		}
		expect(harness.calls.gitCommit).toEqual([{ onlyDetached: false }, { showTag: false }]);
		expect(harness.calls.gitMetrics).toEqual([{ onlyNonzero: false }, { ignoreSubmodules: true }]);

		component.handleInput("\t");
		selectLabel(component, "Default placement");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Default placement");
		expect(focusedRow(component)).toContain("off");
		expect(harness.calls.extensionDefaultPlacement).toEqual(["off"]);
		expect(config.components.footer.styles.starship.extensionStatuses.defaultPlacement).toBe("off");
	});

	it("restores editor-style focus by ID after dynamic rebuild", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Editor style");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Editor style");
		expect(focusedRow(component)).toContain("Opencode (copy-friendly)");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Editor style");
		expect(focusedRow(component)).toContain("Minimalist");
		expect(harness.calls.editor).toEqual([
			{ style: "opencode-copy-friendly" },
			{ style: "minimalist" },
		]);
	});

	it("shows friendly message style labels and restores focus after rebuild", async () => {
		const harness = createHarness();
		await harness.command().handler("messages", harness.ctx);
		const component = harness.component();
		selectLabel(component, "Message style");
		expect(focusedRow(component)).toContain("Framed");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Message style");
		expect(focusedRow(component)).toContain("Framed (copy-friendly)");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Message style");
		expect(focusedRow(component)).toContain("Compact");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Message style");
		expect(focusedRow(component)).toContain("Labeled");
		expect(harness.calls.messages).toEqual([
			{ style: "framed-copy-friendly" },
			{ style: "compact" },
			{ style: "labeled" },
		]);
	});

	it("routes color and model rows to separate component dependencies", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		expect(component.render(160)[0]).not.toContain("\x1b[90m");
		selectLabel(component, "Selector border colors");
		component.handleInput(" ");
		expect(component.render(160)[0]).toContain("\x1b[90m");
		expect(harness.config.components.editor.colorSource).toBe("theme");
		goToSection(component, "Editor");
		selectLabel(component, "Editor colors");
		component.handleInput(" ");
		selectLabel(component, "Editor model label");
		component.handleInput(" ");
		component.handleInput("\t");
		selectLabel(component, "Message colors");
		component.handleInput(" ");
		component.handleInput("\t");
		component.handleInput("\t");
		selectLabel(component, "Footer colors");
		component.handleInput(" ");
		selectLabel(component, "Footer model label");
		component.handleInput(" ");
		expect(harness.calls.selectors).toEqual([{ colorSource: "terminal" }]);
		expect(harness.calls.editor).toEqual([{ colorSource: "terminal" }, { modelLabel: "name" }]);
		expect(harness.calls.messages).toEqual([{ colorSource: "terminal" }]);
		expect(harness.calls.footer).toEqual([{ colorSource: "terminal" }, { modelLabel: "name" }]);
	});

	it("rebuilds failed persistence with effective values and attempted-row focus", async () => {
		const config = cloneConfig();
		const harness = createHarness(config, {
			setEditorComponent() {
				throw new Error("read-only");
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Editor model label");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Editor model label");
		expect(focusedRow(component)).toContain("id");
		expect(focusedRow(component)).not.toContain("name");
		expect(harness.notifications).toEqual(["Could not update Zentui settings: read-only"]);
	});

	it("parses component direct operations and rejects removed copy commands", async () => {
		const harness = createHarness();
		for (const command of ["editor disable", "messages disable"]) {
			await harness.command().handler(command, harness.ctx);
		}
		for (const command of [
			"editor-copy-friendly enable",
			"message-copy-friendly disable",
			"copy-friendly enable",
		]) {
			await harness.command().handler(command, harness.ctx);
		}
		expect(harness.calls.editor).toEqual([{ enabled: false }]);
		expect(harness.calls.messages).toEqual([{ enabled: false }]);
		expect(harness.notifications.filter((message) => message.startsWith("Usage:"))).toHaveLength(3);
		const values =
			harness
				.command()
				.getArgumentCompletions("")
				?.map((item) => item.value) ?? [];
		expect(values).toContain("messages toggle");
		expect(values.some((value) => value.includes("copy-friendly"))).toBe(false);
		expect(values.join("\n")).not.toMatch(/fixed[-_ ]editor/i);
	});

	it.each([
		"fixed-editor enable",
		"fixed_editor disable",
		"fixed editor toggle",
		"layout",
	] as const)("treats removed route %s as ordinary usage without mutation", async (args) => {
		const harness = createHarness();
		const before = structuredClone(harness.config);
		await harness.command().handler(args, harness.ctx);
		expect(harness.config).toEqual(before);
		expect(harness.calls.editor).toEqual([]);
		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]).toMatch(/^Usage:/);
		expect(harness.notifications[0]).not.toMatch(/fixed[-_ ]editor/i);
	});

	it("persists and reopens editor-border and model/segment controls", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		let component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Editor border color");
		component.handleInput(" ");
		selectLabel(component, "Editor model label");
		component.handleInput(" ");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		selectLabel(component, "Ignore submodules");
		component.handleInput(" ");
		component.handleInput("\x1b[Z");
		selectLabel(component, "Model info");
		component.handleInput(" ");
		component.handleInput("\x1b");
		expect(harness.doneCalls()).toBe(1);

		await harness.command().handler("", harness.ctx);
		component = harness.component();
		goToSection(component, "Editor");
		expect(row(component, "Editor border color")).toContain("adaptive");
		expect(row(component, "Editor model label")).toContain("name");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		expect(row(component, "Ignore submodules")).toContain("enabled");
		component.handleInput("\x1b[Z");
		expect(row(component, "Model info")).toContain("enabled");
		expect(harness.calls.editor).toEqual([{ borderColorMode: "adaptive" }, { modelLabel: "name" }]);
		expect(harness.calls.gitMetrics).toEqual([{ ignoreSubmodules: true }]);
		expect(harness.calls.segments).toEqual([{ modelInfo: true }]);
		component.handleInput("\x1b");
		expect(harness.doneCalls()).toBe(2);
	});

	it("rolls back editor-border and model-info rows when persistence fails", async () => {
		const config = cloneConfig();
		const harness = createHarness(config, {
			setEditorComponent() {
				throw new Error("read-only editor");
			},
			setFooterSegments() {
				throw new Error("read-only segments");
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Editor border color");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Editor border color");
		expect(focusedRow(component)).toContain("static");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("\t");
		selectLabel(component, "Model info");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Model info");
		expect(focusedRow(component)).toContain("disabled");
		expect(config.components.editor.borderColorMode).toBe("static");
		expect(config.components.footer.styles.starship.segments.modelInfo).toBe(false);
		expect(harness.notifications).toEqual([
			"Could not update Zentui settings: read-only editor",
			"Could not update Zentui settings: read-only segments",
		]);
	});

	it("routes all Working-line rows independently", async () => {
		const harness = createHarness();
		await harness.command().handler("working-line", harness.ctx);
		const component = harness.component();
		expectFocusOrder(component, [
			"Enabled",
			"Turn summary",
			"Spinner",
			"Spinner speed",
			"Animate spinner color",
			"Text animation",
			"Text motion speed",
			"Color source",
			"Custom messages",
			"Tool",
			"Elapsed",
			"Thinking",
			"Tokens",
			"Message list",
		]);
		for (const [label, expected] of [
			["Enabled", "enabled"],
			["Turn summary", "disabled"],
			["Spinner", "ASCII Pinwheel"],
			["Spinner speed", "Slow 160 ms"],
			["Animate spinner color", "enabled"],
			["Text animation", "kitt"],
			["Text motion speed", "Slow 100 ms"],
			["Color source", "terminal"],
			["Custom messages", "disabled"],
			["Tool", "disabled"],
			["Elapsed", "disabled"],
			["Thinking", "disabled"],
			["Tokens", "disabled"],
		] as const) {
			selectLabel(component, label);
			component.handleInput(" ");
			expect(focusedRow(component)).toContain(expected);
		}
		expect(harness.calls.workingLine).toEqual([
			{ enabled: true },
			{ turnSummary: false },
			{ spinner: "pinwheel" },
			{ spinnerIntervalMs: 160 },
			{ animateSpinnerColor: true },
			{ textAnimation: "kitt" },
			{ textIntervalMs: 100 },
			{ colorSource: "terminal" },
			{ messages: { custom: false } },
			{ segments: { tool: false } },
			{ segments: { elapsed: false } },
			{ segments: { thought: false } },
			{ segments: { tokens: false } },
		]);
		expect(harness.calls.renders).toEqual({ shared: 0, local: 13 });
	});

	it("displays, previews, and stores all named spinner presets with canonical IDs", async () => {
		const current = cloneConfig();
		current.components.workingLine.spinnerIntervalMs = 180;
		const harness = createHarness(current);
		await harness.command().handler("working-line", harness.ctx);
		selectLabel(harness.component(), "Spinner");
		for (const label of [
			"Star Bloom",
			"ASCII Pinwheel",
			"Claude-inspired",
			"Pulse",
			"Braille Orbit",
		]) {
			expect(focusedRow(harness.component())).toContain(label);
			if (label === "Pulse") {
				const rows = harness.component().render(100);
				expect(rows[previewRow(rows, "⠀⠶⠀")]).toContain("⠀⠶⠀");
				expect(current.components.workingLine.spinnerIntervalMs).toBe(180);
			}
			harness.component().handleInput(" ");
		}
		expect(harness.calls.workingLine).toEqual([
			{ spinner: "pinwheel" },
			{ spinner: "claude-inspired" },
			{ spinner: "pulse" },
			{ spinner: "braille" },
			{ spinner: "star-bloom" },
		]);
		expect(current.components.workingLine.spinnerIntervalMs).toBe(180);
	});

	it("closes for Custom speed input, saves a valid integer, and reopens with Speed focused", async () => {
		vi.useFakeTimers();
		const current = cloneConfig();
		current.components.workingLine.spinnerIntervalMs = 160;
		const focusedAfterOpen: string[] = [];
		let customCount = 0;
		const harness = createHarness(
			current,
			{},
			{
				async custom(factory: (...args: unknown[]) => unknown) {
					let outcome: unknown;
					const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
						outcome = value;
					}) as Component;
					if (customCount++ === 0) {
						selectLabel(component, "Spinner speed");
						component.handleInput(" ");
					} else {
						focusedAfterOpen.push(focusedRow(component));
						component.handleInput("\x1b");
					}
					return outcome;
				},
				async input(title: string, placeholder: string) {
					expect(title).toBe("Spinner speed (30–1000 ms)");
					expect(placeholder).toBe("160");
					return " 77 ";
				},
			},
		);
		harness.sessionLifecycle.start();
		await harness.command().handler("working-line", harness.ctx);
		expect(harness.calls.workingLine).toEqual([{ spinnerIntervalMs: 77 }]);
		expect(focusedAfterOpen).toEqual([expect.stringContaining("> Spinner speed")]);
		expect(focusedAfterOpen[0]).toContain("Custom 77 ms");
		expect(harness.notifications).toContain("Spinner speed: 77 ms");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("uses a separate Custom text-speed dialog and reopens on its originating row", async () => {
		const current = cloneConfig();
		current.components.workingLine.textIntervalMs = 100;
		let customCount = 0;
		const focusedAfterOpen: string[] = [];
		const harness = createHarness(
			current,
			{},
			{
				async custom(factory: (...args: unknown[]) => unknown) {
					let outcome: unknown;
					const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
						outcome = value;
					}) as Component;
					if (customCount++ === 0) {
						selectLabel(component, "Text motion speed");
						component.handleInput(" ");
					} else {
						focusedAfterOpen.push(focusedRow(component));
						component.handleInput("\x1b");
					}
					return outcome;
				},
				async input(title: string, placeholder: string) {
					expect(title).toBe("Text motion speed (30–1000 ms)");
					expect(placeholder).toBe("100");
					return "73";
				},
			},
		);
		await harness.command().handler("working-line", harness.ctx);
		expect(harness.calls.workingLine).toEqual([{ textIntervalMs: 73 }]);
		expect(focusedAfterOpen[0]).toContain("> Text motion speed");
		expect(focusedAfterOpen[0]).toContain("Custom 73 ms");
	});

	it.each([
		[undefined, "Spinner speed unchanged (input canceled)"],
		["29", "Spinner speed must be a whole number from 30 to 1000 ms; unchanged."],
		["60.5", "Spinner speed must be a whole number from 30 to 1000 ms; unchanged."],
	] as const)(
		"preserves Custom speed on canceled or invalid input %s",
		async (response, notice) => {
			const current = cloneConfig();
			current.components.workingLine.spinnerIntervalMs = 160;
			let customCount = 0;
			const harness = createHarness(
				current,
				{},
				{
					async custom(factory: (...args: unknown[]) => unknown) {
						let outcome: unknown;
						const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
							outcome = value;
						}) as Component;
						if (customCount++ === 0) {
							selectLabel(component, "Spinner speed");
							component.handleInput(" ");
						} else {
							expect(focusedRow(component)).toContain("> Spinner speed");
							component.handleInput("\x1b");
						}
						return outcome;
					},
					async input() {
						return response;
					},
				},
			);
			await harness.command().handler("working-line", harness.ctx);
			expect(current.components.workingLine.spinnerIntervalMs).toBe(160);
			expect(harness.calls.workingLine).toEqual([]);
			expect(harness.notifications).toContain(notice);
		},
	);

	it("preserves shared rendering for settings outside Working line", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		selectLabel(harness.component(), "Selector borders");
		harness.component().handleInput(" ");
		expect(harness.calls.renders).toEqual({ shared: 1, local: 1 });
	});

	it.each([
		["Editor", "Explain"],
		["User messages", "Please review"],
		["Working line", "Sautéing…"],
	] as const)(
		"stacks the %s preview above settings at every width",
		async (section, previewText) => {
			vi.useFakeTimers();
			const harness = createHarness();
			harness.sessionLifecycle.start();
			await harness.command().handler("", harness.ctx);
			const component = harness.component();
			goToSection(component, section);
			const zeroWidthRows = component.render(0);
			const oneCellRows = component.render(1);
			expect(zeroWidthRows).toHaveLength(oneCellRows.length);
			for (const width of [0, 1, 4]) {
				const rows = component.render(width);
				expect(rows.every((line) => visibleWidth(line) <= width)).toBe(true);
				expect(rows.join("")).not.toContain(previewText);
			}
			for (const width of [24, 80, 99, 100, 118, 140, 160, 200]) {
				const rows = component.render(width);
				expect(rows.every((line) => visibleWidth(line) <= width)).toBe(true);
				expectStackedPreview(rows, previewText);
				expect(rows.some((line) => line.includes("> "))).toBe(true);
			}
			component.handleInput("\x1b");
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it.each(["Appearance", "Footer", "Segments", "Git", "Extensions"] as const)(
		"does not add preview spacer rows in %s",
		async (section) => {
			const harness = createHarness();
			await harness.command().handler("", harness.ctx);
			const component = harness.component();
			goToSection(component, section);
			for (const width of [24, 80, 99, 100, 118, 140, 160, 200]) {
				const rows = component.render(width);
				expect(rows.every((line) => visibleWidth(line) <= width)).toBe(true);
				expect(leadingEmptyRowCount(rows)).toBe(0);
			}
		},
	);

	it("shows static previews only in their owning sections without timers or extra setters", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.sessionLifecycle.start();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		const appearanceRows = component.render(100);
		expect(appearanceRows.join("\n")).not.toContain("Explain this change safely.");
		expect(leadingEmptyRowCount(appearanceRows)).toBe(0);
		component.handleInput("\t");
		const editorRows = component.render(100);
		expectStackedPreview(editorRows, "Explain this change safely.");
		const editor = editorRows.join("\n");
		expect(editor).toContain("Explain this change safely.");
		expect(editor).not.toContain("Editor preview");
		expect(vi.getTimerCount()).toBe(0);
		selectLabel(component, "Editor style");
		component.handleInput(" ");
		const copyFriendly = component.render(100).join("\n");
		expect(copyFriendly).not.toBe(editor);
		expect(harness.calls.editor).toEqual([{ style: "opencode-copy-friendly" }]);
		selectLabel(component, "Editor colors");
		component.handleInput(" ");
		expect(component.render(100).join("\n")).not.toBe(copyFriendly);
		selectLabel(component, "Editor viewport indicators");
		component.handleInput(" ");
		expect(component.render(100).join("\n")).not.toContain("↑ 2 more");
		selectLabel(component, "Editor style");
		component.handleInput(" ");
		const minimalist = component.render(100).join("\n");
		selectLabel(component, "Timer");
		component.handleInput(" ");
		expect(component.render(100).join("\n")).not.toBe(minimalist);
		expect(harness.calls.minimalist).toEqual([{ showTimer: false }]);
		expect(vi.getTimerCount()).toBe(0);
		component.handleInput("\t");
		const messageRows = component.render(100);
		expectStackedPreview(messageRows, "Please review");
		const messages = messageRows.join("\n");
		expect(messages).toContain("Please review [this change] safely.");
		expect(messages).not.toContain("User message preview");
		expect(harness.calls.messages).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
		selectLabel(component, "Message style");
		component.handleInput(" ");
		const copyFriendlyMessage = component.render(100).join("\n");
		expect(copyFriendlyMessage).not.toBe(messages);
		selectLabel(component, "Message colors");
		component.handleInput(" ");
		expect(component.render(100).join("\n")).not.toBe(copyFriendlyMessage);
		expect(harness.calls.messages).toEqual([
			{ style: "framed-copy-friendly" },
			{ colorSource: "terminal" },
		]);
		expect(vi.getTimerCount()).toBe(0);
		component.handleInput("\t");
		const workingRows = component.render(100);
		expectStackedPreview(workingRows, "Sautéing…");
		component.handleInput("\t");
		for (const section of ["Footer", "Segments", "Git", "Extensions"] as const) {
			expect(leadingEmptyRowCount(component.render(100)), section).toBe(0);
			if (section !== "Extensions") component.handleInput("\t");
		}
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps disabled Editor and User-message previews visual, bounded, and focus-neutral", async () => {
		const current = cloneConfig();
		current.components.editor.enabled = false;
		current.components.userMessages.enabled = false;
		const harness = createHarness(current);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		expect(component.render(80).join("\n")).toContain("Explain this change safely.");
		expect(component.render(80).join("\n")).not.toContain("Editor preview");
		expect(component.render(4).every((line) => visibleWidth(line) <= 4)).toBe(true);
		expect(focusedRow(component)).toContain("> Editor");
		component.handleInput("\t");
		expect(component.render(24).join("\n")).toContain("Please review");
		expect(component.render(80).join("\n")).not.toContain("User message preview");
		expect(focusedRow(component)).toContain("> User messages");
		expect(harness.calls.editor).toEqual([]);
		expect(harness.calls.messages).toEqual([]);
	});

	it("animates the preview and cleans its single timer on changes, exits, errors, and shutdown", async () => {
		vi.useFakeTimers();
		const harness = createHarness();
		harness.sessionLifecycle.start();
		await harness.command().handler("working-line", harness.ctx);
		const component = harness.component();
		const animationWidth = 160;
		const initialRows = component.render(animationWidth);
		expectStackedPreview(initialRows, "Sautéing…");
		expect(leadingEmptyRowCount(component.render(1))).toBe(0);
		expect(component.render(1).every((line) => visibleWidth(line) <= 1)).toBe(true);
		const firstPreviewIndex = previewRow(initialRows, "Sautéing…");
		const firstPreview = initialRows[firstPreviewIndex];
		expect(firstPreview).toContain("Sautéing…");
		expect(firstPreview).toContain("read");
		expect(harness.calls.workingLine).toEqual([]);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(300);
		expect(component.render(animationWidth)[firstPreviewIndex]).not.toBe(firstPreview);
		selectLabel(component, "Custom messages");
		component.handleInput(" ");
		const fallbackPreview = component
			.render(animationWidth)
			[firstPreviewIndex]?.replaceAll("[", "")
			.replaceAll("]", "");
		expect(fallbackPreview).toContain("Working…");
		expect(fallbackPreview).toContain("read");
		vi.advanceTimersByTime(1200);
		const stablePreview =
			component
				.render(animationWidth)
				[firstPreviewIndex]?.replaceAll("[", "")
				.replaceAll("]", "") ?? "";
		expect(stablePreview).toContain("Working…");
		expect(stablePreview).toContain("read · 1m02s · thinking 10s · ↑1.2k ↓56");
		selectLabel(component, "Tool");
		component.handleInput(" ");
		const withoutTool =
			component
				.render(animationWidth)
				[firstPreviewIndex]?.replaceAll("[", "")
				.replaceAll("]", "") ?? "";
		expect(withoutTool).not.toContain("read");
		expect(withoutTool).toContain("1m02s · thinking 10s · ↑1.2k ↓56");
		selectLabel(component, "Spinner");
		component.handleInput(" ");
		expect(vi.getTimerCount()).toBe(1);
		selectLabel(component, "Spinner speed");
		component.handleInput(" ");
		expect(vi.getTimerCount()).toBe(1);
		component.handleInput("\t");
		expect(vi.getTimerCount()).toBe(0);
		component.handleInput("\x1b[Z");
		expect(vi.getTimerCount()).toBe(1);
		component.handleInput("\x1b");
		expect(vi.getTimerCount()).toBe(0);

		const failed = createHarness(cloneConfig(), {
			setWorkingLineComponent() {
				throw new Error("read-only working line");
			},
		});
		failed.sessionLifecycle.start();
		await failed.command().handler("working-line", failed.ctx);
		failed.component().handleInput(" ");
		expect(vi.getTimerCount()).toBe(0);
		expect(leadingEmptyRowCount(failed.component().render(100))).toBe(0);
		expect(failed.notifications).toContain(
			"Could not update Zentui settings: read-only working line",
		);

		const shutdown = createHarness();
		shutdown.sessionLifecycle.start();
		await shutdown.command().handler("working-line", shutdown.ctx);
		expect(vi.getTimerCount()).toBe(1);
		shutdown.sessionLifecycle.shutdown();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("saves an empty Message list canonically and reopens its styled fallback preview with focus restored", async () => {
		vi.useFakeTimers();
		let openCount = 0;
		let reopenedPreview = "";
		const harness = createHarness(
			cloneConfig(),
			{},
			{
				async custom(factory: (...args: unknown[]) => unknown) {
					let outcome: unknown;
					const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
						outcome = value;
					}) as Component;
					if (openCount++ === 0) {
						selectLabel(component, "Message list");
						component.handleInput(" ");
					} else {
						expect(focusedRow(component)).toContain("> Message list");
						const rows = component.render(100);
						reopenedPreview = rows[previewRow(rows, "Working…")] ?? "";
						component.handleInput("\x1b");
					}
					return outcome;
				},
				async editor(title: string) {
					expect(title).toBe("Working line message list");
					return " \n\t\r\n";
				},
			},
		);
		harness.sessionLifecycle.start();

		await harness.command().handler("working-line", harness.ctx);

		expect(openCount).toBe(2);
		expect(harness.calls.workingLine).toEqual([{ messages: { values: [] } }]);
		expect(harness.config.components.workingLine.messages.values).toEqual([]);
		expect(harness.notifications).toContain("Message list: 0 (using styled Working…)");
		expect(reopenedPreview.replaceAll("[", "").replaceAll("]", "")).toContain("Working…");
		expect(reopenedPreview).toMatch(/\[[^\]]+\]/);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("closes for multiline message editing, normalizes save, preserves cancel, and reopens Working line", async () => {
		vi.useFakeTimers();
		const openedSections: string[] = [];
		let customCount = 0;
		const harness = createHarness(
			cloneConfig(),
			{},
			{
				async custom(factory: (...args: unknown[]) => unknown) {
					let outcome: unknown;
					const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
						outcome = value;
					}) as Component;
					openedSections.push(component.render(40)[1] ?? "");
					if (customCount++ === 0) {
						selectLabel(component, "Message list");
						component.handleInput(" ");
					} else component.handleInput("\x1b");
					return outcome;
				},
				async editor(title: string, prefill: string) {
					expect(title).toBe("Working line message list");
					expect(prefill).toBe(defaultConfig.components.workingLine.messages.values.join("\n"));
					return " One \nOne\n\x1b[31mTwo\x1b[0m\n";
				},
			},
		);
		harness.sessionLifecycle.start();
		await harness.command().handler("working-line", harness.ctx);
		expect(vi.getTimerCount()).toBe(0);
		expect(openedSections).toHaveLength(2);
		expect(openedSections.every((line) => line.includes("Working line"))).toBe(true);
		expect(harness.calls.workingLine).toEqual([{ messages: { values: ["One", "Two"] } }]);
		expect(harness.calls.renders.shared).toBe(0);

		let cancelCustomCount = 0;
		const canceled = createHarness(
			cloneConfig(),
			{},
			{
				async custom(factory: (...args: unknown[]) => unknown) {
					let outcome: unknown;
					const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
						outcome = value;
					}) as Component;
					if (cancelCustomCount++ === 0) {
						selectLabel(component, "Message list");
						component.handleInput(" ");
					} else component.handleInput("\x1b");
					return outcome;
				},
				async editor() {
					return undefined;
				},
			},
		);
		canceled.sessionLifecycle.start();
		await canceled.command().handler("working-line", canceled.ctx);
		expect(vi.getTimerCount()).toBe(0);
		expect(cancelCustomCount).toBe(2);
		expect(canceled.calls.workingLine).toEqual([]);
	});

	it.each([
		["messages", "User messages"],
		["user-messages", "User messages"],
		["working-line", "Working line"],
	])("opens %s directly in %s", async (argument, section) => {
		const harness = createHarness();
		await harness.command().handler(argument, harness.ctx);
		expect(harness.component().render(40)[1]).toContain(section);
	});
});
