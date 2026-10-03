import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { MinimalistEditorStyleConfig } from "./config";
import { MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS, MAX_CUSTOM_VARIABLES } from "./custom-variables";
import { sanitizeEditorMetadataText } from "./editor-metadata-format";
import {
	compiledFooterFormat,
	type ReadonlyFormatToken,
	renderFormatTokens,
} from "./footer-format";
import { HOST_TEMPLATE_VARIABLES } from "./host-template-values";

export const MINIMALIST_FORMAT_SLOTS = [
	"topLeft",
	"topMiddle",
	"topRight",
	"bottomLeft",
	"bottomMiddle",
	"bottomRight",
] as const;
export type MinimalistFormatSlot = (typeof MINIMALIST_FORMAT_SLOTS)[number];
export type MinimalistFormats = Partial<Record<MinimalistFormatSlot, string>>;

export const MINIMALIST_BUILTIN_VARIABLES = [
	"model",
	"model_id",
	"model_name",
	"provider",
	"thinking",
	"fast_mode",
	"session_name",
	"turn_duration",
	"cost",
	"context",
	"cache_hit",
	"codex_quota",
	"cwd",
	"git_branch",
	"git_status",
	"tokens",
	"input_tokens",
	"output_tokens",
	"extensions",
	"sep",
	"separator",
	"fill",
	"wrap",
	"wrap_sep",
	...HOST_TEMPLATE_VARIABLES,
] as const;
const reserved = new Set<string>(MINIMALIST_BUILTIN_VARIABLES);

export function isMinimalistVariableAlias(name: string): boolean {
	return (
		/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) &&
		!reserved.has(name) &&
		name !== "__proto__" &&
		name !== "constructor" &&
		name !== "prototype"
	);
}

export function normalizeMinimalistVariables(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([name, key]) =>
					isMinimalistVariableAlias(name) &&
					typeof key === "string" &&
					key.length > 0 &&
					key.length <= MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS &&
					!/[\s\x00-\x20\x7f-\x9f]/.test(key),
			)
			.slice(0, MAX_CUSTOM_VARIABLES),
	);
}

export function normalizeMinimalistFormats(value: unknown): MinimalistFormats {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		MINIMALIST_FORMAT_SLOTS.flatMap((slot) =>
			typeof record[slot] === "string" ? [[slot, record[slot]]] : [],
		),
	);
}

/** Generated defaults describe demand; their established renderer remains authoritative. */
export function effectiveMinimalistFormats(
	style: MinimalistEditorStyleConfig,
): Record<MinimalistFormatSlot, string> {
	return {
		topLeft: [style.showTimer ? "$turn_duration" : "", style.showSessionName ? "$session_name" : ""]
			.filter(Boolean)
			.join(" · "),
		topMiddle: "",
		topRight: [
			style.showCost ? "$cost" : "",
			"$extensions",
			"$model",
			"$thinking",
			"$fast_mode",
			"$context",
			style.showCacheHit ? "$cache_hit" : "",
			"$codex_quota",
		]
			.filter(Boolean)
			.join("$sep"),
		bottomLeft: style.showGit ? "$git_branch $git_status" : "",
		bottomMiddle: "",
		bottomRight: "$cwd",
		...style.formats,
	};
}

export function minimalistTemplateReferences(
	style: MinimalistEditorStyleConfig,
): ReadonlySet<string> {
	const names = new Set<string>();
	const visit = (tokens: readonly ReadonlyFormatToken[]) => {
		for (const token of tokens) {
			if (token.kind === "group") visit(token.tokens);
			else if (token.kind === "var") names.add(token.name);
		}
	};
	for (const format of Object.values(effectiveMinimalistFormats(style)))
		visit(compiledFooterFormat(sanitizeEditorMetadataText(format)).tokens);
	return names;
}

/** Demand only, not ownership or current-width visibility. Parent supplies those gates. */
export function minimalistDemandsCustomVariable(
	style: MinimalistEditorStyleConfig,
	key?: string,
): boolean {
	const references = minimalistTemplateReferences(style);
	if (references.has("extensions")) return true;
	const aliases = normalizeMinimalistVariables(style.variables);
	return Object.entries(aliases).some(
		([name, target]) => references.has(name) && (key === undefined || key === target),
	);
}

export function minimalistExplicitCustomKeys(
	style: MinimalistEditorStyleConfig,
): ReadonlySet<string> {
	const references = minimalistTemplateReferences(style);
	return new Set(
		Object.entries(normalizeMinimalistVariables(style.variables))
			.filter(([name]) => references.has(name))
			.map(([, key]) => key),
	);
}

/** Custom values yield whole before builtin text; quota also never enters the clipping path. */
export function renderMinimalistTemplate(
	format: string,
	resolve: (name: string) => string,
	customNames: ReadonlySet<string>,
	width = Number.POSITIVE_INFINITY,
): string {
	const tokens = compiledFooterFormat(sanitizeEditorMetadataText(format)).tokens;
	let omitted = new Set<string>();
	const render = () =>
		renderFormatTokens(tokens, (name) => (omitted.has(name) ? "" : resolve(name))).trim();
	let rendered = render();
	if (visibleWidth(rendered) > width) {
		omitted = new Set(customNames);
		rendered = render();
	}
	if (visibleWidth(rendered) > width) {
		omitted.add("codex_quota");
		rendered = render();
	}
	return Number.isFinite(width) ? truncateToWidth(rendered, Math.max(0, width), "…") : rendered;
}
