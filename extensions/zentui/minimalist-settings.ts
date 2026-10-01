import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { MinimalistEditorStylePatch, ZentuiConfig } from "./config";
import { prepareEditorTextForCustomUi } from "./editor-transfer";
import {
	effectiveMinimalistFormats,
	MINIMALIST_FORMAT_SLOTS,
	normalizeMinimalistVariables,
} from "./minimalist-template";
import type { SessionLifecycle } from "./session-lifecycle";

type MinimalistSettingsDeps = {
	sessionLifecycle: SessionLifecycle;
	getConfig(): ZentuiConfig;
	setMinimalist(patch: MinimalistEditorStylePatch, ctx: ExtensionContext): void;
	requestRender(): void;
};

/** Editing and reset remain sparse, owner-local transactions; cancellation never saves. */
export async function editMinimalistTemplates(
	ctx: ExtensionContext,
	deps: MinimalistSettingsDeps,
): Promise<void> {
	const generation = deps.sessionLifecycle.currentGeneration();
	const current = () => ctx.hasUI && deps.sessionLifecycle.isCurrent(generation);
	if (!current()) return;
	try {
		while (current()) {
			prepareEditorTextForCustomUi(ctx.ui);
			const selected = await ctx.ui.select("Minimalist metadata templates", [
				...MINIMALIST_FORMAT_SLOTS,
			]);
			if (!current() || selected === undefined) return;
			const slot = MINIMALIST_FORMAT_SLOTS.find((value) => value === selected);
			if (!slot) return;
			const style = deps.getConfig().components.editor.styles.minimalist;
			const local = style.formats?.[slot];
			prepareEditorTextForCustomUi(ctx.ui);
			const action = await ctx.ui.select(
				`${slot}: ${local === undefined ? "inherit" : local === "" ? "hidden" : local}`,
				["Edit template", "Reset / inherit"],
			);
			if (!current() || action === undefined) return;
			if (action === "Reset / inherit") {
				deps.setMinimalist({ formats: { [slot]: null } }, ctx);
			} else if (action === "Edit template") {
				prepareEditorTextForCustomUi(ctx.ui);
				const value = await ctx.ui.editor(
					`${slot} — template; empty = hidden, Esc = cancel`,
					local ?? effectiveMinimalistFormats(style)[slot],
				);
				if (!current()) return;
				if (value === undefined) continue;
				deps.setMinimalist({ formats: { [slot]: value } }, ctx);
			} else return;
			deps.requestRender();
			ctx.ui.notify(`Minimalist ${slot} saved`, "info");
		}
	} catch (error) {
		if (current())
			ctx.ui.notify(`Could not update Minimalist templates: ${String(error)}`, "error");
	}
}

export async function editMinimalistVariables(
	ctx: ExtensionContext,
	deps: MinimalistSettingsDeps,
): Promise<void> {
	const generation = deps.sessionLifecycle.currentGeneration();
	const current = () => ctx.hasUI && deps.sessionLifecycle.isCurrent(generation);
	if (!current()) return;
	try {
		prepareEditorTextForCustomUi(ctx.ui);
		const action = await ctx.ui.select("Minimalist custom variable aliases", [
			"Edit aliases",
			"Reset aliases",
		]);
		if (!current() || action === undefined) return;
		const before = deps.getConfig().components.editor.styles.minimalist.variables ?? {};
		let aliases: Record<string, string> = {};
		if (action === "Edit aliases") {
			prepareEditorTextForCustomUi(ctx.ui);
			const edited = await ctx.ui.editor(
				"Aliases JSON: variable name → publisher key",
				JSON.stringify(before, null, 2),
			);
			if (!current() || edited === undefined) return;
			let value: unknown;
			try {
				value = JSON.parse(edited);
			} catch {
				ctx.ui.notify("Invalid JSON; custom aliases unchanged.", "warning");
				return;
			}
			aliases = normalizeMinimalistVariables(value);
			if (
				!value ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				Object.keys(value).length !== Object.keys(aliases).length
			) {
				ctx.ui.notify(
					"Use at most 16 non-reserved variable names and publisher keys up to 64 characters without whitespace; aliases unchanged.",
					"warning",
				);
				return;
			}
		} else if (action !== "Reset aliases") return;
		const patch: Record<string, string | null> = Object.fromEntries(
			Object.keys(before).map((name) => [name, null]),
		);
		Object.assign(patch, aliases);
		deps.setMinimalist({ variables: patch }, ctx);
		deps.requestRender();
		ctx.ui.notify("Minimalist custom aliases saved", "info");
	} catch (error) {
		if (current()) ctx.ui.notify(`Could not update Minimalist aliases: ${String(error)}`, "error");
	}
}
