import {
	FOOTER_FORMAT_ALIASES,
	FOOTER_FORMAT_VARIABLES,
	OPENCODE_FORMAT_VARIABLES,
	type TemplateVariableConfig,
	type ZentuiConfig,
} from "./config";
import { normalizeTemplateVariables } from "./custom-variable-format";
import { compiledFooterFormat } from "./footer-format";
import {
	minimalistDemandsCustomVariable,
	minimalistTemplateReferences,
} from "./minimalist-template";

/** Configuration demand only; callers separately prove current surface ownership. */
export function editorMetadataReferences(config: ZentuiConfig): ReadonlySet<string> {
	const editor = config.components.editor;
	if (!editor.enabled) return new Set();
	if (editor.style === "minimalist") return minimalistTemplateReferences(editor.styles.minimalist);
	if (editor.style === "accent-rail") return new Set(editor.codexQuota ? ["codex_quota"] : []);
	return new Set(compiledFooterFormat(editor.styles[editor.style].metadataFormat).references);
}

function demands(
	style: TemplateVariableConfig,
	references: ReadonlySet<string>,
	reserved: readonly string[],
	key?: string,
): boolean {
	return Object.entries(normalizeTemplateVariables(style.variables, reserved)).some(
		([name, target]) => references.has(name) && (key === undefined || key === target),
	);
}

export function editorDemandsCustomVariable(config: ZentuiConfig, key?: string): boolean {
	const editor = config.components.editor;
	if (!editor.enabled || editor.style === "accent-rail") return false;
	if (editor.style === "minimalist")
		return minimalistDemandsCustomVariable(editor.styles.minimalist, key);
	return demands(
		editor.styles[editor.style],
		editorMetadataReferences(config),
		OPENCODE_FORMAT_VARIABLES,
		key,
	);
}

export function footerDemandsCustomVariable(config: ZentuiConfig, key?: string): boolean {
	const footer = config.components.footer;
	if (footer.style !== "starship") return false;
	const style = footer.styles.starship;
	const references = new Set(compiledFooterFormat(style.format).references);
	if (style.responsive)
		for (const name of compiledFooterFormat(style.compactFormat).references) references.add(name);
	return demands(
		style,
		references,
		[...FOOTER_FORMAT_VARIABLES, ...Object.keys(FOOTER_FORMAT_ALIASES)],
		key,
	);
}
