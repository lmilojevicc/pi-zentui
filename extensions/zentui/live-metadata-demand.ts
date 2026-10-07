import {
	FOOTER_FORMAT_ALIASES,
	FOOTER_FORMAT_VARIABLES,
	hasUnsupportedComponentStyle,
	OPENCODE_FORMAT_VARIABLES,
	type ZentuiConfig,
} from "./config";
import { editorMetadataReferences } from "./custom-variable-demand";
import { normalizeTemplateVariables } from "./custom-variable-format";
import { compiledFooterFormat } from "./footer-format";
import { isHostTemplateVariable } from "./host-template-values";
import { normalizeMinimalistVariables } from "./minimalist-template";

export function editorHostReferences(config: ZentuiConfig): ReadonlySet<string> {
	const editor = config.components.editor;
	if (
		!editor.enabled ||
		hasUnsupportedComponentStyle(config, "editor") ||
		editor.style === "accent-rail"
	)
		return new Set();
	const aliases =
		editor.style === "minimalist"
			? normalizeMinimalistVariables(editor.styles.minimalist.variables)
			: normalizeTemplateVariables(
					editor.styles[editor.style].variables,
					OPENCODE_FORMAT_VARIABLES,
				);
	return new Set(
		[...editorMetadataReferences(config)].filter(
			(name) => isHostTemplateVariable(name) && !Object.hasOwn(aliases, name),
		),
	);
}
export function footerHostReferences(config: ZentuiConfig): ReadonlySet<string> {
	const footer = config.components.footer;
	if (footer.style !== "starship" || hasUnsupportedComponentStyle(config, "footer"))
		return new Set();
	const style = footer.styles.starship;
	const aliases = normalizeTemplateVariables(style.variables, [
		...FOOTER_FORMAT_VARIABLES,
		...Object.keys(FOOTER_FORMAT_ALIASES),
	]);
	const references = [
		...compiledFooterFormat(style.format).references,
		...(style.responsive ? compiledFooterFormat(style.compactFormat).references : []),
	];
	return new Set(
		references.filter((name) => isHostTemplateVariable(name) && !Object.hasOwn(aliases, name)),
	);
}
export type LiveMetadataDemand = Readonly<{ github: boolean; tokenRate: boolean }>;
/** Ownership is proved by orchestration, never inferred from a configured style alone. */
export function liveMetadataDemand(
	config: ZentuiConfig,
	owned: { editor: boolean; footer: boolean; workingLine: boolean },
	piRate = true,
): LiveMetadataDemand {
	const references = new Set([
		...(owned.editor ? editorHostReferences(config) : []),
		...(owned.footer ? footerHostReferences(config) : []),
	]);
	return {
		github: ["pr_number", "pr_url", "ci"].some((name) => references.has(name)),
		tokenRate:
			piRate &&
			(references.has("token_rate") ||
				(owned.workingLine &&
					config.components.workingLine.enabled &&
					config.components.workingLine.segments.tokenRate === true)),
	};
}
