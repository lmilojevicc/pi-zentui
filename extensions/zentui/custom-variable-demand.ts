import type { ZentuiConfig } from "./config";
import { compiledFooterFormat } from "./footer-format";
import {
	minimalistDemandsCustomVariable,
	minimalistTemplateReferences,
} from "./minimalist-template";

/** Configuration demand only; callers must separately prove current surface ownership. */
export function editorMetadataReferences(config: ZentuiConfig): ReadonlySet<string> {
	const editor = config.components.editor;
	if (!editor.enabled) return new Set();
	if (editor.style === "minimalist") return minimalistTemplateReferences(editor.styles.minimalist);
	if (editor.style === "accent-rail") return new Set(editor.codexQuota ? ["codex_quota"] : []);
	return new Set(compiledFooterFormat(editor.styles[editor.style].metadataFormat).references);
}

export function editorDemandsCustomVariable(config: ZentuiConfig, key?: string): boolean {
	return (
		config.components.editor.enabled &&
		config.components.editor.style === "minimalist" &&
		minimalistDemandsCustomVariable(config.components.editor.styles.minimalist, key)
	);
}
