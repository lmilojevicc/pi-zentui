import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultConfig,
	type EditorComponentConfig,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	type FooterComponentConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type ThinkingStepsComponentConfig,
	type ThinkingStepsMode,
	type UserMessagesComponentConfig,
	type WorkingLineComponentPatch,
} from "../extensions/zentui/config";
import { componentPresets, getComponentPreset, type PresetId } from "../extensions/zentui/presets";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";

type Component = { render(width: number): string[]; handleInput(data: string): void };
type Command = {
	handler(args: string, ctx: unknown): Promise<void>;
	getArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null;
};
const sectionNames = [
	"Appearance",
	"Editor",
	"User messages",
	"Thinking",
	"Working line",
	"Footer",
] as const;
const footerPageNames = ["Segments", "Git", "Extension statuses"] as const;
type SectionName = (typeof sectionNames)[number] | (typeof footerPageNames)[number];

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
	if (footerPageNames.some((name) => name === section)) {
		goToSection(component, "Footer");
		openFooterPage(component, section as (typeof footerPageNames)[number]);
		return;
	}
	for (
		let index = 0;
		index < sectionNames.indexOf(section as (typeof sectionNames)[number]);
		index += 1
	)
		component.handleInput("\t");
}
function openFooterPage(component: Component, page: (typeof footerPageNames)[number]): void {
	selectLabel(component, page);
	component.handleInput("\r");
}
function selectLabel(component: Component, label: string): void {
	for (let index = 0; index < 40; index += 1) {
		if (component.render(160).some((line) => line.startsWith(`> ${label}`))) return;
		component.handleInput("\x1b[B");
	}
	throw new Error(`Could not select ${label}`);
}
function row(component: Component, label: string): string {
	selectLabel(component, label);
	return component.render(160).find((line) => line.startsWith(`> ${label}`)) ?? "";
}
function focusedRow(component: Component): string {
	return component.render(200).find((line) => line.startsWith("> ")) ?? "";
}
function previewRow(rows: string[], text: string): number {
	const index = rows.findIndex((line) => line.includes(text));
	if (index < 0) throw new Error(`Could not find preview row containing ${text}`);
	return index;
}
function expectStackedPreview(rows: string[], previewText: string): void {
	const previewIndex = previewRow(rows, previewText);
	const settingsIndex = rows.findIndex(
		(line, index) => index > previewIndex && line.startsWith("> "),
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
	const notificationEvents: Array<{ message: string; severity: string }> = [];
	let doneCalls = 0;
	const sessionLifecycle = new SessionLifecycle();
	sessionLifecycle.start();
	const calls = {
		presets: [] as PresetId[],
		editor: [] as Partial<EditorComponentConfig>[],
		polished: [] as Array<Record<string, unknown>>,
		polishedCopyFriendly: [] as Array<Record<string, unknown>>,
		accentRail: [] as Array<Record<string, unknown>>,
		messages: [] as Partial<UserMessagesComponentConfig>[],
		thinkingSteps: [] as Partial<ThinkingStepsComponentConfig>[],
		workingLine: [] as WorkingLineComponentPatch[],
		renders: { shared: 0, local: 0 },
		selectors: [] as Partial<SelectorBordersComponentConfig>[],
		footer: [] as Partial<FooterComponentConfig>[],
		minimalist: [] as Array<Record<string, unknown>>,
		pathDisplay: [] as Array<Record<string, unknown>>,
		segments: [] as Array<Record<string, boolean>>,
		gitCommit: [] as Array<Record<string, boolean>>,
		gitMetrics: [] as Array<Record<string, boolean>>,
		extensionDefaultPlacement: [] as ExtensionStatusPlacement[],
		recipe: [] as boolean[],
	};
	const deps = {
		migrateSelections: () => {},
		setComponentColor: () => {},
		sessionLifecycle,
		getConfig: () => config,
		applyPreset(id: PresetId) {
			calls.presets.push(id);
			const preset = getComponentPreset(id);
			for (const owner of ["editor", "footer", "userMessages"] as const) {
				Object.assign(config.components[owner], preset?.components[owner]);
			}
			return { applied: true };
		},
		reconcilePresetEditor: () => ({ applied: true }),
		setEditorComponent(patch: Partial<EditorComponentConfig>) {
			calls.editor.push(patch);
			Object.assign(config.components.editor, patch);
			return { applied: true };
		},
		setPolished(patch: Record<string, unknown>) {
			calls.polished.push(patch);
			Object.assign(config.components.editor.styles.opencode, patch);
		},
		setPolishedCopyFriendly(patch: Record<string, unknown>) {
			calls.polishedCopyFriendly.push(patch);
			Object.assign(config.components.editor.styles["opencode-copy-friendly"], patch);
		},
		setAccentRail(patch: Record<string, unknown>) {
			calls.accentRail.push(patch);
			Object.assign(config.components.editor.styles["accent-rail"], patch);
		},
		setMinimalist(patch: Record<string, unknown>) {
			calls.minimalist.push(patch);
			Object.assign(config.components.editor.styles.minimalist, patch);
		},
		setUserMessagesComponent(patch: Partial<UserMessagesComponentConfig>) {
			calls.messages.push(patch);
			Object.assign(config.components.userMessages, patch);
		},
		thinkingStepsCapability: { available: true },
		setThinkingStepsComponent(patch: Partial<ThinkingStepsComponentConfig>) {
			calls.thinkingSteps.push(patch);
			Object.assign(config.components.thinkingSteps, patch);
			return { applied: true };
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
		setPathDisplay(patch: Record<string, unknown>) {
			calls.pathDisplay.push(patch);
			Object.assign(config.components.footer.styles.starship.pathDisplay, patch);
		},
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
		setExtensionStatusPlacement(key: string, placement: ExtensionStatusPlacement) {
			config.components.footer.styles.starship.extensionStatuses.placements[key] = placement;
		},
		setExtensionStatusColorMode(key: string, colorMode: ExtensionStatusColorMode) {
			config.components.footer.styles.starship.extensionStatuses.colorModes[key] = colorMode;
		},
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
			notify(message: string, severity = "info") {
				notifications.push(message);
				notificationEvents.push({ message, severity });
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
		deps,
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
		notificationEvents,
		sessionLifecycle,
		doneCalls: () => doneCalls,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("component-oriented /zentui settings", () => {
	it("uses the exact six-section order in wide and narrow navigation", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		const wide = component.render(200).join("\n");
		for (const child of footerPageNames) expect(component.render(200)[1]).not.toContain(child);
		let previous = -1;
		for (const name of sectionNames) {
			const index = wide.indexOf(name);
			expect(index).toBeGreaterThan(previous);
			previous = index;
		}
		for (const [index, name] of sectionNames.entries()) {
			const lines = component.render(40);
			expect(lines[1]).toContain(name);
			expect(lines[1]).toContain(`(${index + 1}/6)`);
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

	it("saves quota toggles independently, including dormant editor preferences", async () => {
		const config = cloneConfig();
		config.components.editor.enabled = false;
		const harness = createHarness(config);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Codex quota");
		component.handleInput(" ");
		expect(harness.calls.editor).toEqual([{ codexQuota: true }]);
		expect(config.components.editor.enabled).toBe(false);
		expect(config.components.footer.codexQuota).toBe(false);
		for (let index = 0; index < 4; index++) component.handleInput("\t");
		selectLabel(component, "Codex quota");
		component.handleInput(" ");
		expect(harness.calls.footer).toEqual([{ codexQuota: true }]);
		expect(config.components.editor.codexQuota).toBe(true);
	});

	it("restores quota settings after a failed save", async () => {
		const harness = createHarness(cloneConfig(), {
			setEditorComponent() {
				throw new Error("read-only quota");
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Codex quota");
		component.handleInput(" ");
		expect(row(component, "Codex quota")).toContain("disabled");
		expect(harness.notifications).toContain("Could not update Zentui settings: read-only quota");
	});

	it("uses exact component-owned row sets and ordering", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		expectFocusOrder(component, [
			"Preset",
			"Selector borders",
			"Selector border style",
			"Selector border colors",
			"Icon mode",

			"Color overrides",
			"Migrate component selections",
		]);

		goToSection(component, "Editor");
		expectFocusOrder(component, [
			"Editor",
			"Editor style",
			"Editor colors",
			"Codex quota",
			"Editor model label",
			"Editor border color",
			"Editor viewport indicators",
			"Completion menu",

			"Color overrides",
		]);

		component.handleInput("\t");
		expectFocusOrder(component, [
			"User messages",
			"Message style",
			"Message colors",
			"Color overrides",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, ["Enabled", "Mode"]);
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
			"Thinking time",
			"Tokens",
			"Message list",

			"Color overrides",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, [
			"Footer style",
			"Footer colors",
			"Codex quota",
			"Footer model label",
			"Responsive footer",
			"Compact footer rows",
			"Context style",
			"Separator",
			"Path display",
			"Path depth",
			"Segments",
			"Git",
			"Extension statuses",
			"Color overrides",
		]);
		openFooterPage(component, "Segments");
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
		component.handleInput("\x1b");
		openFooterPage(component, "Git");
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
		component.handleInput("\x1b");
		openFooterPage(component, "Extension statuses");
		expectFocusOrder(component, ["Default placement", "No active statuses"]);
	});

	it.each(["native", "hidden"] as const)(
		"shows Footer style and color preconfiguration for %s",
		async (style) => {
			const config = cloneConfig();
			config.components.footer.style = style;
			const harness = createHarness(config);
			await harness.command().handler("", harness.ctx);
			const component = harness.component();
			goToSection(component, "Footer");
			expectFocusOrder(component, ["Footer style", "Color overrides"]);

			const before = structuredClone(config);
			for (const page of footerPageNames)
				expect(component.render(200).join("\n")).not.toContain(page);
			component.handleInput("\t");
			expect(component.render(40)[1]).toContain("Appearance");
			expect(config).toEqual(before);
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
		expectFocusOrder(component, ["Footer style", "Color overrides"]);
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
			"Codex quota",
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

			"Color overrides",
		]);
		component.handleInput("\t");
		expectFocusOrder(component, [
			"User messages",
			"Message style",
			"Message colors",
			"Color overrides",
		]);
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

		for (let index = 0; index < 4; index += 1) component.handleInput("\t");
		openFooterPage(component, "Git");
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

		component.handleInput("\x1b");
		openFooterPage(component, "Extension statuses");
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
		expect(focusedRow(component)).toContain("Accent Rail");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("> Editor style");
		expect(focusedRow(component)).toContain("Minimalist");
		expect(harness.calls.editor).toEqual([
			{ style: "opencode-copy-friendly" },
			{ style: "accent-rail" },
			{ style: "minimalist" },
		]);
	});

	it("configures Opencode completion menus independently", async () => {
		const current = cloneConfig();
		const harness = createHarness(current);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Completion menu");
		expect(focusedRow(component)).toContain("palette");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("native");
		expect(harness.calls.polished).toEqual([{ completionMenu: "native" }]);
		expect(harness.calls.polishedCopyFriendly).toEqual([]);

		selectLabel(component, "Editor style");
		component.handleInput(" ");
		selectLabel(component, "Completion menu");
		expect(focusedRow(component)).toContain("palette");
		component.handleInput(" ");
		expect(harness.calls.polishedCopyFriendly).toEqual([{ completionMenu: "native" }]);
		expect(current.components.editor.styles.opencode.completionMenu).toBe("native");
		expect(current.components.editor.styles["opencode-copy-friendly"].completionMenu).toBe(
			"native",
		);

		selectLabel(component, "Editor style");
		component.handleInput(" ");
		expect(component.render(100).join("\n")).not.toContain("Completion menu");
	});

	it("shows and persists the Accent Rail surface control only for that style", async () => {
		const current = cloneConfig();
		current.components.editor.style = "accent-rail";
		const harness = createHarness(current);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Editor");
		selectLabel(component, "Accent Rail surface");
		expect(focusedRow(component)).toContain("filled");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("transparent");
		expect(harness.calls.accentRail).toEqual([{ transparent: true }]);
		expect(harness.calls.editor).toEqual([]);
		expect(current.components.editor.styles.minimalist).toEqual(
			defaultConfig.components.editor.styles.minimalist,
		);

		selectLabel(component, "Editor style");
		component.handleInput(" ");
		expect(component.render(80).join("\n")).not.toContain("Accent Rail surface");
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

	it("offers and routes repository Footer paths with clarified depth semantics", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Footer");
		selectLabel(component, "Path display");
		expect(focusedRow(component)).toContain("basename");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("repository");
		expect(component.render(160).join("\n")).toContain("repository-relative");
		selectLabel(component, "Path depth");
		const depthRows = component.render(160).join("\n");
		expect(depthRows).toContain("Final component count for Full and Repository");
		expect(depthRows).toContain("0 = unlimited");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("1");
		expect(harness.calls.pathDisplay).toEqual([{ mode: "repository" }, { depth: 1 }]);
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
		expect(values.filter((value) => value.includes("copy-friendly"))).toEqual([
			"preset opencode-copy-friendly",
		]);
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
		openFooterPage(component, "Git");
		selectLabel(component, "Ignore submodules");
		component.handleInput(" ");
		component.handleInput("\x1b");
		openFooterPage(component, "Segments");
		selectLabel(component, "Model info");
		component.handleInput(" ");
		component.handleInput("\x1b");
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
		openFooterPage(component, "Git");
		expect(row(component, "Ignore submodules")).toContain("enabled");
		component.handleInput("\x1b");
		openFooterPage(component, "Segments");
		expect(row(component, "Model info")).toContain("enabled");
		expect(harness.calls.editor).toEqual([{ borderColorMode: "adaptive" }, { modelLabel: "name" }]);
		expect(harness.calls.gitMetrics).toEqual([{ ignoreSubmodules: true }]);
		expect(harness.calls.segments).toEqual([{ modelInfo: true }]);
		component.handleInput("\x1b");
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
		openFooterPage(component, "Segments");
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

	it("shows Thinking (Experimental) with only Enabled and Mode focus rows", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		expect(component.render(120).join("\n")).toContain("Thinking (Experimental)");
		expectFocusOrder(component, ["Enabled", "Mode"]);
		expect(component.render(120).join("\n")).toContain(
			"Live switching supports Streaming → Rail/Tree and Rail ↔ Tree. Entering Streaming,",
		);
	});

	it("shows saved and active mode mismatch honestly", async () => {
		const config = cloneConfig();
		config.components.thinkingSteps.enabled = true;
		config.components.thinkingSteps.mode = "streaming";
		const harness = createHarness(config, {
			thinkingStepsCapability: {
				state: {
					available: true,
					rendererAvailable: true,
					streamingAvailable: false,
					active: true,
					activeMode: "tree",
					startup: { enabled: true, mode: "tree" },
					displaced: false,
					restartRequired: true,
					reason: "Streaming listener unavailable; restart required",
				},
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		const output = component.render(160).join("\n");
		expect(output).toContain(
			"Saved: Streaming · Active: Tree · Streaming unavailable · restart required · Streaming listener unavailable",
		);
		expect(output.match(/restart required/gi)).toHaveLength(2);
		// One status appears in the preview and one in the focused setting description;
		// neither duplicates reason text that already contained the phrase.
	});

	it("keeps private-renderer unavailability non-focusable and fails open to native", async () => {
		const harness = createHarness(cloneConfig(), {
			thinkingStepsCapability: { available: false },
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		const output = component.render(120).join("\n");
		expect(output).toContain("Saved: Disabled · Active: Native · Renderer unavailable");
		expectFocusOrder(component, ["Enabled", "Mode"]);
	});

	it("routes Thinking-step enablement and mode independently", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		expectFocusOrder(component, ["Enabled", "Mode"]);
		selectLabel(component, "Enabled");
		component.handleInput(" ");
		selectLabel(component, "Mode");
		component.handleInput(" ");
		expect(harness.calls.thinkingSteps).toEqual([{ enabled: true }, { mode: "rail" }]);
		expect(harness.config.components.thinkingSteps).toEqual({
			enabled: true,
			mode: "rail",
		});
		expect(harness.notifications).toContain("Thinking (Experimental): Rail");
	});

	it("cycles the real mode setting through Streaming to Tree", async () => {
		const config = cloneConfig();
		config.components.thinkingSteps = { enabled: true, mode: "streaming" };
		const harness = createHarness(config);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		selectLabel(component, "Mode");
		component.handleInput(" ");
		expect(harness.calls.thinkingSteps).toEqual([{ mode: "tree" }]);
		expect(harness.config.components.thinkingSteps.mode).toBe("tree");
	});

	it("rebuilds Thinking settings in focus with honest live-success status and preview", async () => {
		const config = cloneConfig();
		config.components.thinkingSteps = { enabled: true, mode: "streaming" };
		const state = {
			available: true,
			active: true,
			activeMode: "streaming" as ThinkingStepsMode,
			startup: { enabled: true, mode: "streaming" as ThinkingStepsMode },
			displaced: false,
			restartRequired: false,
		};
		const harness = createHarness(config, {
			thinkingStepsCapability: { state },
			setThinkingStepsComponent(patch: Partial<ThinkingStepsComponentConfig>) {
				Object.assign(config.components.thinkingSteps, patch);
				if (patch.mode) state.activeMode = patch.mode;
				return { applied: true };
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		selectLabel(component, "Mode");
		component.handleInput(" ");
		const output = component.render(160).join("\n");
		expect(focusedRow(component)).toContain("> Mode");
		expect(output).toContain("Saved: Tree · Active: Tree");
		expect(harness.notificationEvents.at(-1)).toEqual({
			message: "Thinking (Experimental): Tree",
			severity: "info",
		});
	});

	it("rebuilds Thinking settings in focus with saved/active failure status and preview", async () => {
		const config = cloneConfig();
		config.components.thinkingSteps = { enabled: true, mode: "rail" };
		const state = {
			available: true,
			rendererAvailable: true,
			streamingAvailable: true,
			active: true,
			activeMode: "rail" as ThinkingStepsMode,
			startup: { enabled: true, mode: "tree" as ThinkingStepsMode },
			displaced: false,
			restartRequired: false,
			reason: undefined as string | undefined,
		};
		const harness = createHarness(config, {
			thinkingStepsCapability: { state },
			setThinkingStepsComponent(patch: Partial<ThinkingStepsComponentConfig>) {
				Object.assign(config.components.thinkingSteps, patch);
				state.restartRequired = true;
				return {
					applied: false,
					reason: "Saved: Streaming · Active: Rail · restart required",
				};
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		selectLabel(component, "Mode");
		component.handleInput(" ");
		const output = component.render(180).join("\n");
		expect(focusedRow(component)).toContain("> Mode");
		const expectedStatus = "Saved: Streaming · Active: Rail · restart required";
		expect(output).toContain(expectedStatus);
		expect(output).toContain("Thinking 7.1s");
		expect(harness.notificationEvents.at(-1)).toEqual({
			message: `Thinking (Experimental): Streaming (${expectedStatus})`,
			severity: "warning",
		});
	});

	it("includes a cleanup warning in a successful Thinking notification", async () => {
		const config = cloneConfig();
		config.components.thinkingSteps = { enabled: true, mode: "streaming" };
		const state = {
			available: true,
			rendererAvailable: true,
			streamingAvailable: true,
			active: true,
			activeMode: "streaming" as ThinkingStepsMode,
			startup: { enabled: true, mode: "streaming" as ThinkingStepsMode },
			displaced: false,
			restartRequired: false,
			reason: undefined as string | undefined,
		};
		const warning =
			"Saved: Tree · Active: Tree · Streaming unavailable · Pi's terminal input listener cleanup is unavailable";
		const harness = createHarness(config, {
			thinkingStepsCapability: { state },
			setThinkingStepsComponent(patch: Partial<ThinkingStepsComponentConfig>) {
				Object.assign(config.components.thinkingSteps, patch);
				state.activeMode = "tree";
				state.streamingAvailable = false;
				state.reason = "Pi's terminal input listener cleanup is unavailable";
				return { applied: true, reason: warning };
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		selectLabel(component, "Mode");
		component.handleInput(" ");
		expect(component.render(180).join("\n")).toContain(warning);
		expect(harness.notificationEvents.at(-1)).toEqual({
			message: `Thinking (Experimental): Tree (${warning})`,
			severity: "warning",
		});
	});

	it("shows a warning when disabling Streaming restores native output with degraded cleanup", async () => {
		const config = cloneConfig();
		config.components.thinkingSteps = { enabled: true, mode: "streaming" };
		const state = {
			available: true,
			rendererAvailable: true,
			streamingAvailable: true,
			active: true,
			activeMode: "streaming" as ThinkingStepsMode | undefined,
			startup: { enabled: true, mode: "streaming" as ThinkingStepsMode },
			displaced: false,
			restartRequired: false,
			reason: undefined as string | undefined,
		};
		const warning =
			"Saved: Disabled · Active: Native · Streaming unavailable · Pi's terminal input listener cleanup is unavailable";
		const harness = createHarness(config, {
			thinkingStepsCapability: { state },
			setThinkingStepsComponent(patch: Partial<ThinkingStepsComponentConfig>) {
				Object.assign(config.components.thinkingSteps, patch);
				state.active = false;
				state.activeMode = undefined;
				state.streamingAvailable = false;
				state.reason = "Pi's terminal input listener cleanup is unavailable";
				return { applied: true, reason: warning };
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		selectLabel(component, "Enabled");
		component.handleInput(" ");
		expect(component.render(180).join("\n")).toContain(warning);
		expect(harness.notificationEvents.at(-1)).toEqual({
			message: `Thinking (Experimental): disabled (${warning})`,
			severity: "warning",
		});
	});

	it("restores Thinking-step rows after persistence failure and accepts its section route", async () => {
		const harness = createHarness(cloneConfig(), {
			setThinkingStepsComponent() {
				throw new Error("read-only thinking");
			},
		});
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Thinking");
		selectLabel(component, "Enabled");
		component.handleInput(" ");
		expect(focusedRow(component)).toContain("disabled");
		expect(harness.notifications).toContain("Could not update Zentui settings: read-only thinking");
		await harness.command().handler("thinking-steps", harness.ctx);
		expect(harness.component().render(40)[1]).toContain("Thinking");
		expect(
			harness
				.command()
				.getArgumentCompletions("")
				?.map((item) => item.value)
				.join("\n"),
		).toMatch(/thinking.steps/i);
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
			"Thinking time",
			"Tokens",
			"Message list",

			"Color overrides",
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
			["Thinking time", "disabled"],
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
		expect(harness.calls.renders.shared).toBe(0);
		expect(harness.calls.renders.local).toBeGreaterThanOrEqual(13);
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
		expect(harness.calls.renders.shared).toBe(1);
		expect(harness.calls.renders.local).toBeGreaterThanOrEqual(1);
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
			expect(component.render(0)).toEqual([]);
			for (const width of [0, 1, 4]) {
				const rows = component.render(width);
				expect(rows.every((line) => visibleWidth(line) <= width)).toBe(true);
				expect(rows.join("")).not.toContain(previewText);
			}
			for (const width of [24, 80, 99, 100, 118, 140, 160, 200]) {
				const rows = component.render(width);
				expect(rows.every((line) => visibleWidth(line) <= width)).toBe(true);
				expectStackedPreview(rows, previewText);
				expect(rows.some((line) => line.startsWith("> "))).toBe(true);
			}
			component.handleInput("\x1b");
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it.each(["Appearance", "Footer", "Segments", "Git", "Extension statuses"] as const)(
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
		const accentRail = component.render(100).join("\n");
		expect(accentRail).not.toBe(copyFriendly);
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
		expectStackedPreview(component.render(100), "Verify compatibility");
		component.handleInput("\t");
		const workingRows = component.render(100);
		expectStackedPreview(workingRows, "Sautéing…");
		component.handleInput("\t");
		expect(harness.config.components.footer.style).toBe("starship");
		for (const width of [40, 60, 80, 120, 160]) {
			const rows = component.render(width);
			expect(rows[3]).toContain("> Footer style");
			expect(rows.join("\n")).not.toMatch(/samples?|synthetic|sonnet-long-context-preview/i);
		}
		expect(row(component, "Footer colors")).toContain("theme");
		component.handleInput(" ");
		expect(harness.calls.footer).toEqual([{ colorSource: "terminal" }]);
		for (const label of ["Footer model label", "Responsive footer", "Color overrides"])
			expect(row(component, label)).toContain(`> ${label}`);
		for (const section of footerPageNames) {
			openFooterPage(component, section);
			expect(leadingEmptyRowCount(component.render(100)), section).toBe(0);
			component.handleInput("\x1b");
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

describe("preset commands and Appearance selection", () => {
	it.each(["snapshot", "non-string", "preparation"])(
		"does not open a destructive panel after %s fails",
		async (failure) => {
			const custom = vi.fn();
			const setEditorText = vi.fn(() => {
				if (failure === "preparation") throw new Error("preparation failed");
			});
			const harness = createHarness(
				cloneConfig(),
				{},
				{
					custom,
					getEditorText() {
						if (failure === "snapshot") throw new Error("snapshot failed");
						return failure === "non-string" ? undefined : "draft";
					},
					setEditorText,
				},
			);
			await harness.command().handler("", harness.ctx);
			expect(custom).not.toHaveBeenCalled();
			expect(harness.notificationEvents).toEqual([
				{
					severity: "error",
					message: expect.stringContaining("Could not open Zentui settings safely"),
				},
			]);
			if (failure !== "preparation") expect(setEditorText).not.toHaveBeenCalled();
		},
	);

	it.each(componentPresets)("applies $id as a single command dependency", async ({ id }) => {
		const harness = createHarness();
		await harness.command().handler(`preset ${id}`, harness.ctx);
		expect(harness.calls.presets).toEqual([id]);
		expect(harness.calls.editor).toEqual([]);
		expect(harness.calls.messages).toEqual([]);
		expect(harness.calls.footer).toEqual([]);
		expect(harness.calls.selectors).toEqual([]);
		expect(harness.notifications.at(-1)).toContain("Preset saved:");
	});

	it.each([
		"preset",
		"preset custom",
		"preset invalid",
		"preset Opencode",
		"preset opencode_copy_friendly",
		"preset opencode extra",
		"preset opencode enable",
		"preset rail minimalist",
	])("rejects malformed input %s without a save", async (args) => {
		const harness = createHarness();
		await harness.command().handler(args, harness.ctx);
		expect(harness.calls.presets).toEqual([]);
		expect(harness.calls.editor).toEqual([]);
		expect(harness.notifications.at(-1)).toContain("/zentui preset <");
	});

	it("completes exact hyphenated IDs", () => {
		const harness = createHarness();
		expect(
			harness
				.command()
				.getArgumentCompletions("preset ")
				?.map(({ value }) => value),
		).toEqual(componentPresets.map(({ id }) => `preset ${id}`));
		expect(harness.command().getArgumentCompletions("preset opencode-")).toEqual([
			{ value: "preset opencode-copy-friendly", label: "preset opencode-copy-friendly" },
		]);
		expect(harness.command().getArgumentCompletions("preset nope")).toBeNull();
	});

	it("derives Custom on reopen and restores a name when selections match again", async () => {
		const harness = createHarness();
		await harness.command().handler("", harness.ctx);
		expect(focusedRow(harness.component())).toMatch(/Preset.*Opencode/);
		harness.config.components.userMessages.style = "labeled";
		await harness.command().handler("", harness.ctx);
		expect(focusedRow(harness.component())).toMatch(/Preset.*Custom/);
		harness.config.components.userMessages.style = "framed";
		await harness.command().handler("", harness.ctx);
		expect(focusedRow(harness.component())).toMatch(/Preset.*Opencode/);
	});

	it("keeps focus while cycling presets from Custom and recomputes Custom after individual changes", async () => {
		const config = cloneConfig();
		config.components.editor.enabled = false;
		const harness = createHarness(config);
		harness.sessionLifecycle.start();
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		expect(focusedRow(component)).toContain("Custom");
		for (const preset of componentPresets) {
			component.handleInput("\r");
			expect(focusedRow(component)).toContain(preset.label);
			expect(component.render(200)[1]).toContain("Appearance");
			expect(harness.doneCalls()).toBe(0);
		}
		expect(harness.calls.presets).toEqual(componentPresets.map(({ id }) => id));
		component.handleInput("\t");
		component.handleInput("\x1b[B");
		component.handleInput("\r");
		expect(focusedRow(component)).toContain("Editor style");
		component.handleInput("\x1b[Z");
		expect(focusedRow(component)).toContain("Custom");
		component.handleInput("\x1b");
		expect(harness.doneCalls()).toBe(1);
		harness.sessionLifecycle.shutdown();
	});

	it("ignores preset input after shutdown without saving", async () => {
		const harness = createHarness();
		harness.sessionLifecycle.start();
		await harness.command().handler("", harness.ctx);
		harness.sessionLifecycle.shutdown();
		harness.component().handleInput("\r");
		expect(harness.calls.presets).toEqual([]);
	});

	it.each(["direct", "settings"])(
		"reports saved-but-blocked editor outcomes through %s",
		async (source) => {
			vi.useFakeTimers();
			const harness = createHarness(cloneConfig(), {
				applyPreset: () => ({ applied: false, reason: "editor blocked; reload Pi" }),
			});
			harness.sessionLifecycle.start();
			if (source === "direct") await harness.command().handler("preset rail", harness.ctx);
			else {
				await harness.command().handler("", harness.ctx);
				harness.component().handleInput("\r");
				vi.runAllTimers();
			}
			expect(harness.notificationEvents.at(-1)).toMatchObject({
				severity: "warning",
				message: expect.stringContaining("editor blocked; reload Pi"),
			});
			harness.sessionLifecycle.shutdown();
		},
	);

	it.each(["direct", "settings"])(
		"reports save errors without claiming success through %s",
		async (source) => {
			vi.useFakeTimers();
			const config = cloneConfig();
			const before = structuredClone(config);
			const harness = createHarness(config, {
				applyPreset: () => {
					throw new Error("disk full");
				},
			});
			harness.sessionLifecycle.start();
			if (source === "direct") await harness.command().handler("preset rail", harness.ctx);
			else {
				await harness.command().handler("", harness.ctx);
				harness.component().handleInput("\r");
				vi.runAllTimers();
			}
			expect(config).toEqual(before);
			if (source === "settings") {
				expect(harness.doneCalls()).toBe(0);
				expect(focusedRow(harness.component())).toMatch(/Preset.*Opencode/);
				harness.component().handleInput("\r");
				expect(focusedRow(harness.component())).toMatch(/Preset.*Opencode/);
				harness.notificationEvents.pop();
			}
			expect(harness.notificationEvents).toEqual([
				{ severity: "error", message: "Could not update Zentui settings: disk full" },
			]);
			harness.sessionLifecycle.shutdown();
		},
	);

	it.each(["rpc", "print", "json"])(
		"supports direct persistence without custom UI in %s",
		async (mode) => {
			const custom = vi.fn();
			const harness = createHarness(cloneConfig(), {}, { custom });
			harness.ctx.mode = mode;
			harness.ctx.hasUI = mode === "rpc";
			await harness.command().handler("preset minimalist", harness.ctx);
			expect(harness.calls.presets).toEqual(["minimalist"]);
			expect(custom).not.toHaveBeenCalled();
		},
	);
});

describe("Footer layout authority disclosure", () => {
	it("explains built-in segment toggles versus independent wide and compact templates", async () => {
		const cfg = cloneConfig();
		const starship = cfg.components.footer.styles.starship;
		starship.segments.cwd = false;
		starship.segments.cost = true;
		starship.format = "$cwd";
		const templates = [starship.format, starship.compactFormat];
		const harness = createHarness(cfg);
		await harness.command().handler("", harness.ctx);
		const component = harness.component();
		goToSection(component, "Footer");
		selectLabel(component, "Responsive footer");
		expect(component.render(200).join("\n")).toContain("Reflow the wide layout");
		expect(component.render(200).join("\n")).toContain("independently of segment toggles");
		openFooterPage(component, "Segments");
		for (const label of ["Current directory", "Session cost"]) {
			selectLabel(component, label);
			const help = component.render(200).join("\n");
			expect(help).toContain("Built-in layout:");
			expect(help).toContain(
				"Explicit wide format and compactFormat templates choose their own segments",
			);
			component.handleInput(" ");
		}
		expect([starship.format, starship.compactFormat]).toEqual(templates);
		expect(harness.calls.segments).toEqual([{ cwd: true }, { cost: false }]);
		component.handleInput("\x1b");
		openFooterPage(component, "Git");
		selectLabel(component, "Git counts");
		expect(component.render(200).join("\n")).toContain(
			"built-in segments and template git-status variables",
		);
	});

	it("clarifies that clearing format leaves compactFormat unchanged", async () => {
		const harness = createHarness();
		await harness.command().handler("format clear", harness.ctx);
		expect(harness.notifications).toContain(
			"Footer wide format cleared (using built-in segments; compactFormat unchanged)",
		);
	});
});

describe("component independence settings actions", () => {
	it.each([
		["Appearance", "selectorBorders", "border"],
		["Editor", "editor", "accent"],
		["User messages", "userMessages", "border"],
		["Working line", "workingLine", "high"],
		["Footer", "footer", "cwd"],
	] as const)(
		"edits %s colors outside the disposed panel and restores focus",
		async (section, owner, role) => {
			let opens = 0;
			let disposed = false;
			const save = vi.fn();
			const select = vi
				.fn()
				.mockResolvedValueOnce(role)
				.mockResolvedValueOnce("Edit override")
				.mockResolvedValue(undefined);
			const harness = createHarness(
				cloneConfig(),
				{ setComponentColor: save },
				{
					select,
					async editor() {
						expect(disposed).toBe(true);
						return "";
					},
					async custom(factory: (...args: unknown[]) => unknown) {
						let outcome: unknown;
						const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
							outcome = value;
						}) as Component & { dispose(): void };
						if (opens++ === 0) {
							goToSection(component, section);
							selectLabel(component, "Color overrides");
							component.handleInput(" ");
						} else {
							expect(focusedRow(component)).toContain("Color overrides");
							component.handleInput("\x1b");
						}
						component.dispose();
						disposed = true;
						return outcome;
					},
				},
			);
			await harness.command().handler("", harness.ctx);
			expect(opens).toBe(2);
			expect(save).toHaveBeenCalledExactlyOnceWith(owner, role, "", harness.ctx);
		},
	);
	it.each([true, false])(
		"confirms migration=%s from Appearance and reopens its action",
		async (confirmed) => {
			let opens = 0;
			const migrate = vi.fn();
			const confirm = vi.fn(async () => confirmed);
			const harness = createHarness(
				cloneConfig(),
				{ migrateSelections: migrate },
				{
					confirm,
					async custom(factory: (...args: unknown[]) => unknown) {
						let outcome: unknown;
						const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
							outcome = value;
						}) as Component;
						if (opens++ === 0) {
							selectLabel(component, "Migrate component selections");
							component.handleInput(" ");
						} else {
							expect(focusedRow(component)).toContain("Migrate component selections");
							component.handleInput("\x1b");
						}
						return outcome;
					},
				},
			);
			await harness.command().handler("", harness.ctx);
			expect(confirm).toHaveBeenCalledOnce();
			expect(migrate).toHaveBeenCalledTimes(confirmed ? 1 : 0);
			expect(opens).toBe(2);
		},
	);
	it("routes /zentui migrate through confirmation and never reopens on stale confirmation", async () => {
		const migrate = vi.fn();
		const confirm = vi.fn(async () => true);
		const h = createHarness(cloneConfig(), { migrateSelections: migrate }, { confirm });
		await h.command().handler("migrate", h.ctx);
		expect(migrate).toHaveBeenCalledOnce();
		expect(h.command().getArgumentCompletions("mig")).toEqual([
			{ value: "migrate", label: "migrate" },
		]);
		confirm.mockImplementationOnce(async () => {
			h.sessionLifecycle.shutdown();
			h.sessionLifecycle.start();
			return true;
		});
		await h.command().handler("migrate", h.ctx);
		expect(migrate).toHaveBeenCalledOnce();
	});
});

describe("settings clarity and navigation", () => {
	it("describes Working-line tiers and excludes template separators from the Separator choice", async () => {
		vi.useFakeTimers();
		const h = createHarness();
		await h.command().handler("working-line", h.ctx);
		selectLabel(h.component(), "Color overrides");
		const colors = h.component().render(200).join(" ").replace(/\s+/g, " ");
		expect(colors).toContain("Static Working line uses mid; Turn summaries use high.");
		expect(colors).not.toContain("uses high only");
		await h.command().handler("footer", h.ctx);
		selectLabel(h.component(), "Separator");
		const help = h.component().render(200).join(" ").replace(/\s+/g, " ");
		expect(help).toContain("built-in/layout separators");
		expect(help).toContain("extension-status joins");
		expect(help).toContain("width can affect when the layout switches to compact");
		expect(help).toContain("Does not change $sep (fixed pipe) or literal template separators");
		h.sessionLifecycle.shutdown();
	});

	it("activates Confirm semantically when the actual global manager binds Space to navigation", async () => {
		const previous = getKeybindings();
		const manager = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.down": "space" });
		setKeybindings(manager);
		try {
			let panel: Component | undefined;
			const h = createHarness(
				cloneConfig(),
				{},
				{
					custom: async (factory: (...args: unknown[]) => Component) => {
						panel = factory({ requestRender() {} }, theme(), manager, () => {});
					},
				},
			);
			await h.command().handler("appearance", h.ctx);
			if (!panel) throw new Error("No panel");
			const help = panel.render(200).join("\n");
			expect(help).toContain("up/space Navigate");
			expect(help).toContain("enter Change");
			expect(help).not.toContain("/Space Change");
			panel.handleInput(" ");
			expect(focusedRow(panel)).toContain("Selector borders");
			panel.handleInput("\r");
			expect(h.calls.selectors).toEqual([{ enabled: false }]);
			expect(focusedRow(panel)).toContain("Selector borders");
			panel.handleInput("\r");
			expect(h.calls.selectors).toEqual([{ enabled: false }, { enabled: true }]);
			panel.handleInput(" ");
			expect(focusedRow(panel)).toContain("Selector border style");
			panel.handleInput("\r"); // Informational, not actionable.
			expect(h.calls.selectors).toHaveLength(2);
			expect(getKeybindings()).toBe(manager);
			expect(manager.getUserBindings()).toEqual({ "tui.select.down": "space" });
		} finally {
			setKeybindings(previous);
		}
	});

	it.each(["Edit override", "Reset / inherit"])(
		"opens color dialogs with Confirm under global Space navigation and preserves %s",
		async (action) => {
			const previous = getKeybindings();
			const manager = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.down": "space" });
			setKeybindings(manager);
			try {
				let opens = 0;
				const save = vi.fn();
				const h = createHarness(
					cloneConfig(),
					{ setComponentColor: save },
					{
						select: vi.fn().mockResolvedValueOnce("border").mockResolvedValueOnce(action),
						editor: vi.fn().mockResolvedValue(""),
						custom: async (factory: (...args: unknown[]) => Component) => {
							let outcome: unknown;
							const panel = factory({ requestRender() {} }, theme(), manager, (value: unknown) => {
								outcome = value;
							});
							if (opens++ === 0) {
								for (let i = 0; i < 5; i++) panel.handleInput(" ");
								expect(focusedRow(panel)).toContain("Color overrides");
								panel.handleInput("\r");
							} else {
								expect(focusedRow(panel)).toContain("Color overrides");
								panel.handleInput("\x1b");
							}
							return outcome;
						},
					},
				);
				await h.command().handler("appearance", h.ctx);
				expect(opens).toBe(2);
				expect(save).toHaveBeenCalledExactlyOnceWith(
					"selectorBorders",
					"border",
					action === "Edit override" ? "" : undefined,
					h.ctx,
				);
			} finally {
				setKeybindings(previous);
			}
		},
	);

	it.each([
		["appearance", "Appearance"],
		["editor", "Editor"],
		["messages", "User messages"],
		["user-messages", "User messages"],
		["thinking", "Thinking"],
		["thinking-steps", "Thinking"],
		["working-line", "Working line"],
		["footer", "Footer"],
		["statusline", "Footer"],
		["status", "Footer"],
		["status-line", "Footer"],
		["segments", "Segments"],
		["git", "Git"],
		["extensions", "Extension statuses"],
	])("routes and completes %s without changing selections", async (route, label) => {
		vi.useFakeTimers();
		const h = createHarness();
		const before = structuredClone(h.config);
		await h.command().handler(route, h.ctx);
		expect(h.component().render(40)[1]).toContain(label);
		expect(
			h
				.command()
				.getArgumentCompletions(route)
				?.map((item) => item.value),
		).toContain(route);
		expect(h.config).toEqual(before);
		h.sessionLifecycle.shutdown();
	});
	it("marks dormant choices, explains icons, and makes selector style informational", async () => {
		const config = cloneConfig();
		config.components.editor.style = "accent-rail";
		config.components.footer.style = "hidden";
		const h = createHarness(config);
		await h.command().handler("appearance", h.ctx);
		selectLabel(h.component(), "Selector border style");
		h.component().handleInput(" ");
		expect(h.calls.selectors).toEqual([]);
		expect(h.component().render(160).join("\n")).toContain("Informational");
		selectLabel(h.component(), "Icon mode");
		const icons = h.component().render(160).join("\n");
		expect(icons).toContain("Auto assumes a Nerd Font");
		expect(icons).toContain("ASCII replaces icons only");
		await h.command().handler("editor", h.ctx);
		selectLabel(h.component(), "Editor model label");
		expect(h.component().render(160).join("\n")).toContain("Saved for other editor styles");
		await h.command().handler("git", h.ctx);
		expect(h.component().render(40)[1]).toContain("Footer");
		expect(h.notifications).toContain(
			"Footer > Git requires Starship. Current Footer is Hidden; saved settings are unchanged.",
		);
		await h.command().handler("footer", h.ctx);
		expect(h.component().render(160).join("\n")).toContain("intentionally owns zero");
		config.components.footer.style = "native";
		await h.command().handler("footer", h.ctx);
		expect(h.component().render(160).join("\n")).toContain("predecessor");
	});
	it.each([8, 12, 18, 24])(
		"keeps selection, core help and close reachable at height %i",
		async (height) => {
			let component: Component | undefined;
			const h = createHarness(
				cloneConfig(),
				{},
				{
					custom: async (factory: (...args: unknown[]) => Component) => {
						component = factory(
							{ terminal: { rows: height }, requestRender() {} },
							theme(),
							{},
							() => {},
						);
					},
				},
			);
			await h.command().handler("footer", h.ctx);
			if (!component) throw new Error("No panel");
			for (let i = 0; i < 12; i++) {
				const rows = component.render(40);
				expect(rows.join("\n")).not.toMatch(/samples?|synthetic/i);
				expect(rows.length).toBeLessThanOrEqual(height);
				expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true);
				const text = rows.join("\n");
				expect(text).toContain("Change");
				expect(text).toContain("Sections");
				expect(text).toContain("Close");
				expect(text).toContain("> ");
				component.handleInput("\x1b[B");
			}
		},
	);
	it("uses the injected remapped selection keys without changing global keybindings", async () => {
		let component: Component | undefined;
		let closed = 0;
		const bindings: Record<string, string[]> = {
			"tui.select.up": ["k"],
			"tui.select.down": ["j"],
			"tui.select.confirm": ["x"],
			"tui.select.cancel": ["q"],
		};
		const h = createHarness(
			cloneConfig(),
			{},
			{
				custom: async (factory: (...args: unknown[]) => Component) => {
					component = factory(
						{ requestRender() {} },
						theme(),
						{ getKeys: (id: string) => bindings[id] ?? [] },
						() => {
							closed++;
						},
					);
				},
			},
		);
		await h.command().handler("appearance", h.ctx);
		if (!component) throw new Error("No panel");
		component.handleInput("j");
		expect(focusedRow(component)).toContain("Selector borders");
		component.handleInput("x");
		expect(h.calls.selectors).toEqual([{ enabled: false }]);
		const narrow = component.render(32).join("\n");
		expect(narrow).toContain("x Change");
		expect(narrow).toContain("Tab Sections");
		expect(narrow).toContain("q Close");
		expect(narrow).not.toContain("Enter/Space");
		component.handleInput("k");
		expect(focusedRow(component)).toContain("Preset");
		component.handleInput("\t");
		expect(component.render(40)[1]).toContain("Editor");
		component.handleInput("\x1b[Z");
		expect(component.render(40)[1]).toContain("Appearance");
		component.handleInput("q");
		expect(closed).toBe(1);
	});
});

describe("settings input lifecycle continuations", () => {
	const cases = ["Spinner speed", "Text motion speed", "Message list"].flatMap((label) =>
		["save", "cancel", "error", "stale", "restarted", "stale-error"].map((result) => ({
			label,
			result,
		})),
	);
	it.each(cases)(
		"guards $label after $result and preserves the editor draft",
		async ({ label, result }) => {
			vi.useFakeTimers();
			const originalDraft = "expanded paste\n".repeat(30);
			let draft = originalDraft;
			let opened = 0;
			let inputs = 0;
			const enterInput = async () => {
				inputs++;
				// Model Pi's snapshot/restoration around a blocking input, not host scheduling.
				const saved = draft;
				draft = "temporary dialog";
				await Promise.resolve();
				draft = saved;
				if (result === "stale" || result === "restarted" || result === "stale-error")
					h.sessionLifecycle.shutdown();
				if (result === "restarted") h.sessionLifecycle.start();
				if (result === "error" || result === "stale-error") throw new Error("dialog failed");
				return result === "cancel" ? undefined : label === "Message list" ? "One\nTwo" : "123";
			};
			const h = createHarness(
				cloneConfig(),
				{},
				{
					getEditorText: () => draft,
					setEditorText: (value: string) => {
						draft = value;
					},
					input: enterInput,
					editor: enterInput,
					custom: async (factory: (...args: unknown[]) => Component) => {
						const snapshot = draft;
						let outcome: unknown;
						const component = factory({ requestRender() {} }, theme(), {}, (value: unknown) => {
							outcome = value;
						});
						if (opened++ === 0) {
							selectLabel(component, label);
							if (label === "Message list") component.handleInput(" ");
							else component.handleInput(" ");
						} else component.handleInput("\x1b");
						draft = snapshot;
						return outcome;
					},
				},
			);
			// Custom is reached from the slow preset without changing any speed first.
			if (label === "Spinner speed") h.config.components.workingLine.spinnerIntervalMs = 160;
			if (label === "Text motion speed") h.config.components.workingLine.textIntervalMs = 100;
			await h.command().handler("working-line", h.ctx);
			expect(inputs).toBe(1);
			expect(draft).toBe(originalDraft);
			const stale = ["stale", "restarted", "stale-error"].includes(result);
			expect(opened).toBe(stale ? 1 : 2);
			if (result === "save") expect(h.calls.workingLine).toHaveLength(1);
			else expect(h.calls.workingLine).toEqual([]);
			if (stale) expect(h.notifications).toEqual([]);
			if (result === "error")
				expect(h.notificationEvents).toEqual([
					{ message: expect.stringContaining("dialog failed"), severity: "error" },
				]);
			h.sessionLifecycle.shutdown();
			expect(vi.getTimerCount()).toBe(0);
		},
	);
	it.each([false, true])("contains panel rejection (stale=%s)", async (stale) => {
		const h = createHarness(
			cloneConfig(),
			{},
			{
				custom: async () => {
					if (stale) h.sessionLifecycle.shutdown();
					throw new Error("panel unavailable");
				},
			},
		);
		await h.command().handler("footer", h.ctx);
		if (stale) expect(h.notifications).toEqual([]);
		else
			expect(h.notificationEvents).toEqual([
				{ message: expect.stringContaining("panel unavailable"), severity: "error" },
			]);
	});
});

describe("nested Starship Footer settings navigation", () => {
	const pages = [
		["segments", "Segments", "Current directory"],
		["git", "Git", "Git branch"],
		["extensions", "Extension statuses", "Default placement"],
	] as const;

	it.each(pages)(
		"opens %s and restores its Footer entry without saving or replacing the editor",
		async (route, label, firstRow) => {
			const draft = "expanded pasted draft\n".repeat(30);
			let text = draft;
			const replaceEditor = vi.fn();
			const h = createHarness(
				cloneConfig(),
				{},
				{
					getEditorText: () => text,
					setEditorText: (value: string) => {
						text = value;
					},
					setEditorComponent: replaceEditor,
				},
			);
			const effects = Object.keys(h.deps)
				.filter(
					(key) =>
						/^(set|apply|reconcile|migrate|requestRender)/.test(key) &&
						typeof h.deps[key as keyof typeof h.deps] === "function",
				)
				.map((key) => vi.spyOn(h.deps, key as "requestRender"));
			const before = structuredClone(h.config);
			await h.command().handler("footer", h.ctx);
			const panel = h.component();
			expect(row(panel, label)).toContain("->");
			panel.handleInput("\r");
			expect(panel.render(40)[1]).toContain(`Footer > ${label}`);
			expect(focusedRow(panel)).toContain(`> ${firstRow}`);
			expect(panel.render(40).join("\n")).toContain("escape Back");
			panel.handleInput("\x1b");
			expect(focusedRow(panel)).toContain(`> ${label}`);
			expect(h.doneCalls()).toBe(0);
			panel.handleInput("\r");
			panel.handleInput("\t");
			expect(panel.render(40)[1]).toContain("Appearance");
			panel.handleInput("\x1b[Z");
			expect(panel.render(40)[1]).toContain("Footer");
			panel.handleInput("\x1b");
			expect(h.doneCalls()).toBe(1);
			await h.command().handler(route, h.ctx);
			expect(h.component().render(40)[1]).toContain(`Footer > ${label}`);
			h.component().handleInput("\x1b[Z");
			expect(h.component().render(40)[1]).toContain("Working line");
			h.sessionLifecycle.shutdown();
			expect(h.config).toEqual(before);
			for (const effect of effects) expect(effect).not.toHaveBeenCalled();
			expect(replaceEditor).not.toHaveBeenCalled();
			expect(text).toBe(draft);
			expect(h.command().getArgumentCompletions(route)).toContainEqual({
				value: route,
				label: `${route} — Footer > ${label}`,
			});
		},
	);

	it.each(["native", "hidden"] as const)(
		"redirects every legacy child shortcut under %s without exposing controls or changing preferences",
		async (style) => {
			const config = cloneConfig();
			config.components.footer.style = style;
			config.components.footer.styles.starship.gitBranch.maxLength = 37;
			config.components.footer.styles.starship.segments.cwd = false;
			const before = structuredClone(config);
			const h = createHarness(config);
			for (const [route, label, firstRow] of pages) {
				await h.command().handler(route, h.ctx);
				const panel = h.component();
				expect(panel.render(40)[1]).toContain("[Footer] (6/6)");
				expectFocusOrder(panel, ["Footer style", "Color overrides"]);
				expect(panel.render(200).join("\n")).not.toContain(firstRow);
				expect(h.notifications.at(-1)).toBe(
					`Footer > ${label} requires Starship. Current Footer is ${style === "native" ? "Native" : "Hidden"}; saved settings are unchanged.`,
				);
				panel.handleInput("\x1b");
			}
			expect(h.config).toEqual(before);
			expect(h.calls.footer).toEqual([]);
			expect(h.calls.renders.shared).toBe(0);
		},
	);

	it.each([8, 12, 18, 24])(
		"keeps children, Back and Sections usable at 40 columns and height %i with remapped keys and global Space navigation",
		async (height) => {
			const previous = getKeybindings();
			const global = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.down": "space" });
			setKeybindings(global);
			try {
				const down = height === 8 ? " " : "j";
				const bindings: Record<string, string[]> = {
					"tui.select.up": ["k"],
					"tui.select.down": [height === 8 ? "space" : "j"],
					"tui.select.confirm": ["x"],
					"tui.select.cancel": ["q"],
				};
				let panel: Component | undefined;
				let closed = 0;
				const h = createHarness(
					cloneConfig(),
					{},
					{
						custom: async (factory: (...args: unknown[]) => Component) => {
							panel = factory(
								{ terminal: { rows: height }, requestRender() {} },
								theme(),
								{ getKeys: (id: string) => bindings[id] ?? [] },
								() => {
									closed++;
								},
							);
						},
					},
				);
				const before = structuredClone(h.config);
				await h.command().handler("footer", h.ctx);
				if (!panel) throw new Error("No panel");
				for (const [, label, firstRow] of pages) {
					for (
						let i = 0;
						i < 20 && !panel.render(40).some((line) => line.startsWith(`> ${label}`));
						i++
					)
						panel.handleInput(down);
					expect(panel.render(40).join("\n")).toContain(`> ${label}`);
					panel.handleInput("x");
					expect(focusedRow(panel)).toContain(`> ${firstRow}`);
					for (let i = 0; i < 15; i++) {
						const rows = panel.render(40);
						expect(rows.length).toBeLessThanOrEqual(height);
						expect(rows.every((line) => visibleWidth(line) <= 40)).toBe(true);
						expect(rows[1]).toContain(`Footer > ${label}`);
						expect(rows.join("\n")).toContain("x Change");
						expect(rows.join("\n")).toContain("Tab Sections");
						expect(rows.join("\n")).toContain("q Back");
						expect(rows.some((line) => line.startsWith("> "))).toBe(true);
						expect(rows.join("\n")).not.toMatch(/samples?|synthetic|sonnet-long-context-preview/i);
						panel.handleInput(down);
					}
					panel.handleInput("k");
					panel.handleInput("q");
					expect(focusedRow(panel)).toContain(`> ${label}`);
					expect(closed).toBe(0);
				}
				panel.handleInput("x");
				panel.handleInput("\t");
				expect(panel.render(40)[1]).toContain("Appearance");
				panel.handleInput("q");
				expect(closed).toBe(1);
				expect(h.config).toEqual(before);
				expect(getKeybindings()).toBe(global);
			} finally {
				setKeybindings(previous);
			}
		},
	);

	it("changes only Footer Starship child settings and preserves keyed status order and colors on return", async () => {
		const statuses = new Map([
			["zeta", "Z"],
			["alpha", "A"],
		]);
		const h = createHarness(cloneConfig(), { getActiveExtensionStatuses: () => statuses });
		const before = structuredClone(h.config);
		const placement = vi.spyOn(h.deps, "setExtensionStatusPlacement");
		const color = vi.spyOn(h.deps, "setExtensionStatusColorMode");
		await h.command().handler("segments", h.ctx);
		const panel = h.component();
		panel.handleInput("\r");
		panel.handleInput("\x1b");
		openFooterPage(panel, "Git");
		panel.handleInput("\r");
		panel.handleInput("\x1b");
		openFooterPage(panel, "Extension statuses");
		expectFocusOrder(panel, [
			"Default placement",
			"alpha placement",
			"alpha color",
			"zeta placement",
			"zeta color",
		]);
		panel.handleInput("\r");
		selectLabel(panel, "alpha placement");
		panel.handleInput("\r");
		selectLabel(panel, "zeta color");
		panel.handleInput("\r");
		expect(placement).toHaveBeenCalledExactlyOnceWith("alpha", "left");
		expect(color).toHaveBeenCalledExactlyOnceWith("zeta", "original");
		const expected = structuredClone(before);
		expected.components.footer.styles.starship.segments.cwd = false;
		expected.components.footer.styles.starship.segments.gitBranch = false;
		expected.components.footer.styles.starship.extensionStatuses.defaultPlacement = "off";
		expected.components.footer.styles.starship.extensionStatuses.placements.alpha = "left";
		expected.components.footer.styles.starship.extensionStatuses.colorModes.zeta = "original";
		expect(h.config).toEqual(expected);
		statuses.delete("alpha");
		statuses.set("beta", "B");
		panel.handleInput("\x1b");
		openFooterPage(panel, "Extension statuses");
		expectFocusOrder(panel, [
			"Default placement",
			"beta placement",
			"beta color",
			"zeta placement",
			"zeta color",
		]);
		expect(row(panel, "zeta color")).toContain("original");
	});

	it("closes a stale child without navigating, saving or reinstalling", async () => {
		const h = createHarness();
		const before = structuredClone(h.config);
		await h.command().handler("git", h.ctx);
		h.sessionLifecycle.shutdown();
		h.component().handleInput("\r");
		h.component().handleInput("\x1b");
		expect(h.doneCalls()).toBe(1);
		expect(h.config).toEqual(before);
		expect(h.calls.renders.shared).toBe(0);
	});
});
