import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ColorOwner, type ComponentColorKey, componentColorKeys } from "./component-colors";
import type { ZentuiConfig } from "./config";
import { prepareEditorTextForCustomUi } from "./editor-transfer";
import type { SessionLifecycle } from "./session-lifecycle";
import { isSupportedColorSpec } from "./style";

export type ComponentSettingsDeps = {
	sessionLifecycle: SessionLifecycle;
	getConfig(): ZentuiConfig;
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
				`${owner}.${key}: ${local === undefined ? "inherit" : JSON.stringify(local)}`,
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
