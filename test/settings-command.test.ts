import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	type EditorComponentConfig,
	type ExtensionStatusPlacement,
	type FooterComponentConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type UserMessagesComponentConfig,
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
	"Layout",
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
function expectFocusOrder(component: Component, labels: readonly string[]): void {
	const first = focusedRow(component);
	for (const [index, label] of labels.entries()) {
		expect(focusedRow(component)).toContain(`> ${label}`);
		if (index < labels.length - 1) component.handleInput("\x1b[B");
	}
	component.handleInput("\x1b[B");
	expect(focusedRow(component)).toBe(first);
}

function createHarness(config = cloneConfig(), overrides: Record<string, unknown> = {}) {
	let command: Command | undefined;
	let component: Component | undefined;
	const notifications: string[] = [];
	let doneCalls = 0;
	const calls = {
		editor: [] as Partial<EditorComponentConfig>[],
		messages: [] as Partial<UserMessagesComponentConfig>[],
		selectors: [] as Partial<SelectorBordersComponentConfig>[],
		footer: [] as Partial<FooterComponentConfig>[],
		minimalist: [] as Array<Record<string, unknown>>,
		fixed: [] as Array<Record<string, unknown>>,
		segments: [] as Array<Record<string, boolean>>,
		gitCommit: [] as Array<Record<string, boolean>>,
		gitMetrics: [] as Array<Record<string, boolean>>,
		extensionDefaultPlacement: [] as ExtensionStatusPlacement[],
		recipe: [] as boolean[],
	};
	const deps = {
		sessionLifecycle: new SessionLifecycle(),
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
		setFixedEditor(patch: Record<string, unknown>) {
			calls.fixed.push(patch);
			Object.assign(config.layout.fixedEditor, patch);
		},
		requestRender() {},
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
				component = factory({ requestRender() {} }, theme(), {}, () => {
					doneCalls += 1;
				}) as Component;
			},
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
		doneCalls: () => doneCalls,
	};
}

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
		expectFocusOrder(component, ["Fixed editor (experimental)"]);
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

	it("shows exact minimalist and enabled-layout rows while components are disabled", async () => {
		const config = cloneConfig();
		config.components.editor.enabled = false;
		config.components.editor.style = "minimalist";
		config.components.userMessages.enabled = false;
		config.layout.fixedEditor.enabled = true;
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
		component.handleInput("\t");
		expectFocusOrder(component, ["Fixed editor (experimental)", "Mouse scroll", "Copy notice"]);
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
		expect(focusedRow(component)).toContain("Compact");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Message style");
		expect(focusedRow(component)).toContain("Labeled");
		expect(harness.calls.messages).toEqual([{ style: "compact" }, { style: "labeled" }]);
	});

	it("restores fixed-editor focus after conditional rows rebuild", async () => {
		const harness = createHarness();
		await harness.command().handler("layout", harness.ctx);
		const component = harness.component();
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Fixed editor (experimental)");
		expect(focusedRow(component)).toContain("enabled");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Fixed editor (experimental)");
		expect(focusedRow(component)).toContain("disabled");
		expect(harness.calls.fixed).toEqual([{ enabled: true }, { enabled: false }]);
	});

	it("routes color and model rows to separate component dependencies", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		selectLabel(component, "Selector border colors");
		component.handleInput(" ");
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
	});

	it.each([
		["fixed-editor", "enable", true],
		["fixed-editor", "disable", false],
		["fixed-editor", "toggle", true],
		["fixed_editor", "enable", true],
		["fixed_editor", "disable", false],
		["fixed_editor", "toggle", true],
		["fixed editor", "enable", true],
		["fixed editor", "disable", false],
		["fixed editor", "toggle", true],
	] as const)("routes %s %s only to layout", async (alias, action, enabled) => {
		const harness = createHarness();
		await harness.command().handler(`${alias} ${action}`, harness.ctx);
		expect(harness.calls.fixed).toEqual([{ enabled }]);
		expect(harness.calls.editor).toEqual([]);
		expect(harness.config.components.editor.enabled).toBe(true);
		expect(harness.config.layout.fixedEditor.enabled).toBe(enabled);
		expect(harness.notifications).toEqual([`Fixed editor: ${enabled ? "enabled" : "disabled"}`]);
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

	it.each([
		["messages", "User messages"],
		["user-messages", "User messages"],
		["layout", "Layout"],
	])("opens %s directly in %s", async (argument, section) => {
		const harness = createHarness();
		await harness.command().handler(argument, harness.ctx);
		expect(harness.component().render(40)[1]).toContain(section);
	});
});
