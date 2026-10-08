import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ColorOwner, type ComponentColorKey, componentColorKeys } from "./component-colors";
import {
	FOOTER_FORMAT_ALIASES,
	FOOTER_FORMAT_VARIABLES,
	OPENCODE_FORMAT_VARIABLES,
	type WorkingLineComponentPatch,
	type ZentuiConfig,
} from "./config";
import { customValueColor } from "./custom-value-colors";
import { normalizeTemplateVariables } from "./custom-variable-format";
import { prepareEditorTextForCustomUi } from "./editor-transfer";
import { normalizeMinimalistVariables } from "./minimalist-template";
import type { SessionLifecycle } from "./session-lifecycle";
import { isSupportedColorSpec } from "./style";

export type ComponentSettingsDeps = {
	sessionLifecycle: SessionLifecycle;
	getConfig(): ZentuiConfig;
	getCustomVariables?(): ReadonlyMap<string, string>;
	setCustomValueColor?(
		owner: "editor" | "footer",
		key: string,
		value: string | undefined,
		ctx: ExtensionContext,
	): void;
	migrateSelections(ctx: ExtensionContext): void;
	setComponentColor<O extends ColorOwner>(
		owner: O,
		key: ComponentColorKey<O>,
		value: string | undefined,
		ctx: ExtensionContext,
	): void;
};

export async function confirmComponentMigration(
	ctx: ExtensionContext,
	deps: ComponentSettingsDeps,
): Promise<void> {
	const generation = deps.sessionLifecycle.currentGeneration();
	const current = () => deps.sessionLifecycle.isCurrent(generation);
	if (!ctx.hasUI || !current()) return;
	try {
		prepareEditorTextForCustomUi(ctx.ui);
		const confirmed = await ctx.ui.confirm(
			"Migrate component selections?",
			"Snapshot all current component selections, color sources, and style options from the latest config. Future legacy selection edits will no longer couple components. Shared colors remain inherited fallbacks; no color defaults are copied. Cancel leaves the file unchanged.",
		);
		if (!current() || !confirmed) return;
		deps.migrateSelections(ctx);
		if (current())
			ctx.ui.notify(
				"Component selections migrated; shared color inheritance is unchanged.",
				"info",
			);
	} catch (error) {
		if (current())
			ctx.ui.notify(
				`Could not migrate Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
	}
}

/** Small owner-local editor; Reset deletes, while an empty submitted string means unstyled. */
export async function editComponentColors(
	ctx: ExtensionContext,
	deps: ComponentSettingsDeps,
	owner: ColorOwner,
): Promise<void> {
	const generation = deps.sessionLifecycle.currentGeneration();
	const current = () => deps.sessionLifecycle.isCurrent(generation);
	if (!ctx.hasUI || !current()) return;
	try {
		while (current()) {
			prepareEditorTextForCustomUi(ctx.ui);
			const key = await ctx.ui.select(`${owner} color overrides`, [...componentColorKeys[owner]]);
			if (!current() || key === undefined) return;
			if (!(componentColorKeys[owner] as readonly string[]).includes(key)) return;
			const role = key as ComponentColorKey<typeof owner>;
			const local = (
				deps.getConfig().components[owner].colors as Record<string, string> | undefined
			)?.[key];
			prepareEditorTextForCustomUi(ctx.ui);
			const action = await ctx.ui.select(
				`${owner}.${key}: ${local === undefined ? "inherit" : JSON.stringify(local)}${owner === "workingLine" && key === "turnSummary" ? " — new summaries only" : ""}`,
				["Edit override", "Reset / inherit"],
			);
			if (!current() || action === undefined) return;
			if (action === "Reset / inherit") {
				deps.setComponentColor(owner, role, undefined, ctx);
			} else if (action === "Edit override") {
				prepareEditorTextForCustomUi(ctx.ui);
				const value = await ctx.ui.editor(
					`${owner}.${key} — style string; empty = unstyled, Esc = cancel`,
					local ?? "",
				);
				if (!current()) return;
				if (value === undefined) continue;
				if (!isSupportedColorSpec(value)) {
					ctx.ui.notify("Unsupported color style; override unchanged.", "warning");
					continue;
				}
				deps.setComponentColor(owner, role, value, ctx);
			} else return;
			if (current()) ctx.ui.notify(`${owner}.${key} saved`, "info");
		}
	} catch (error) {
		if (current())
			ctx.ui.notify(
				`Could not update component colors: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
	}
}

/** Publisher IDs, not aliases: include inactive saved keys so an override is always resettable. */
export function customValueColorKeys(
	config: ZentuiConfig,
	owner: "editor" | "footer",
	published: ReadonlyMap<string, string> = new Map(),
): string[] {
	const component = config.components[owner];
	const maps =
		owner === "editor"
			? [
					normalizeMinimalistVariables(config.components.editor.styles.minimalist.variables),
					normalizeTemplateVariables(
						config.components.editor.styles.opencode.variables,
						OPENCODE_FORMAT_VARIABLES,
					),
					normalizeTemplateVariables(
						config.components.editor.styles["opencode-copy-friendly"].variables,
						OPENCODE_FORMAT_VARIABLES,
					),
				]
			: [
					normalizeTemplateVariables(config.components.footer.styles.starship.variables, [
						...FOOTER_FORMAT_VARIABLES,
						...Object.keys(FOOTER_FORMAT_ALIASES),
					]),
				];
	return [
		...new Set([
			...published.keys(),
			...maps.flatMap((map) => Object.values(map)),
			...Object.keys(component.customValueColors ?? {}),
		]),
	]
		.filter((key) => customValueColor({ [key]: "" }, key) !== undefined)
		.sort();
}

export async function editCustomValueColors(
	ctx: ExtensionContext,
	deps: ComponentSettingsDeps,
	owner: "editor" | "footer",
): Promise<void> {
	const generation = deps.sessionLifecycle.currentGeneration();
	const current = () => deps.sessionLifecycle.isCurrent(generation);
	if (!ctx.hasUI || !current() || !deps.setCustomValueColor) return;
	try {
		while (current()) {
			const keys = customValueColorKeys(deps.getConfig(), owner, deps.getCustomVariables?.());
			if (!keys.length) {
				ctx.ui.notify(
					"No current, aliased, or saved publisher keys. Configure an alias or publish a custom value first.",
					"info",
				);
				return;
			}
			prepareEditorTextForCustomUi(ctx.ui);
			const key = await ctx.ui.select(`${owner} publisher color overrides`, keys);
			if (!current() || key === undefined || !keys.includes(key)) return;
			const local = customValueColor(deps.getConfig().components[owner].customValueColors, key);
			prepareEditorTextForCustomUi(ctx.ui);
			const action = await ctx.ui.select(
				`${owner}.${key}: ${local === undefined ? "inherit" : JSON.stringify(local)}`,
				["Edit override", "Reset / inherit"],
			);
			if (!current() || action === undefined) return;
			if (action === "Reset / inherit") deps.setCustomValueColor(owner, key, undefined, ctx);
			else if (action === "Edit override") {
				prepareEditorTextForCustomUi(ctx.ui);
				const value = await ctx.ui.editor(
					`${owner}.${key} — style string; empty = unstyled, Esc = cancel`,
					local ?? "",
				);
				if (!current()) return;
				if (value === undefined) continue;
				if (customValueColor({ [key]: value }, key) === undefined) {
					ctx.ui.notify("Unsupported color style; override unchanged.", "warning");
					continue;
				}
				deps.setCustomValueColor(owner, key, value, ctx);
			} else return;
			if (current()) ctx.ui.notify(`${owner}.${key} saved`, "info");
		}
	} catch (error) {
		if (current())
			ctx.ui.notify(
				`Could not update publisher colors: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
	}
}

/** Edits apply only to newly appended entries; Reset removes the format override. */
export async function editTurnSummaryFormat(
	ctx: ExtensionContext,
	deps: ComponentSettingsDeps & {
		setWorkingLineComponent(patch: WorkingLineComponentPatch, ctx: ExtensionContext): unknown;
	},
): Promise<void> {
	const generation = deps.sessionLifecycle.currentGeneration();
	const current = () => deps.sessionLifecycle.isCurrent(generation);
	if (!ctx.hasUI || !current()) return;
	try {
		prepareEditorTextForCustomUi(ctx.ui);
		const action = await ctx.ui.select("Turn summary format — new summaries only", [
			"Edit",
			"Reset",
		]);
		if (!current() || action === undefined) return;
		if (action === "Reset") deps.setWorkingLineComponent({ turnSummaryFormat: "" }, ctx);
		else if (action === "Edit") {
			prepareEditorTextForCustomUi(ctx.ui);
			const value = await ctx.ui.editor(
				"Turn summary format — empty = default, Esc = cancel",
				deps.getConfig().components.workingLine.turnSummaryFormat,
			);
			if (!current() || value === undefined) return;
			deps.setWorkingLineComponent({ turnSummaryFormat: value }, ctx);
		} else return;
		if (current()) ctx.ui.notify("Turn summary format saved for new summaries", "info");
	} catch (error) {
		if (current())
			ctx.ui.notify(
				`Could not update turn summary format: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
	}
}
