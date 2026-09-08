import type { ColorSpec, PolishedTuiColors, ZentuiConfig } from "./config";
import { isSupportedColorSpec } from "./style";

export const componentColorKeys = {
	footer: [
		"cwd",
		"sessionName",
		"gitBranch",
		"gitStatus",
		"contextNormal",
		"contextWarning",
		"contextError",
		"cost",
		"sessionDuration",
		"tokens",
		"separator",
		"runtimePrefix",
		"extensionStatus",
		"packageVersion",
		"gitCommit",
		"gitMetricsAdded",
		"gitMetricsDeleted",
		"username",
		"time",
		"os",
	],
	editor: [
		"cwd",
		"sessionName",
		"gitBranch",
		"gitStatus",
		"contextNormal",
		"contextWarning",
		"contextError",
		"cost",
		"sessionDuration",
		"accent",
		"border",
		"prompt",
		"rail",
		"model",
		"provider",
		"thinking",
		"thinkingMinimal",
		"thinkingLow",
		"thinkingMedium",
		"thinkingHigh",
		"thinkingXhigh",
		"thinkingMax",
	],
	userMessages: ["accent", "border"],
	selectorBorders: ["border"],
	workingLine: ["low", "mid", "high"],
} as const;
export type ColorOwner = keyof typeof componentColorKeys;
export type ComponentColorKey<O extends ColorOwner> = (typeof componentColorKeys)[O][number];
export type ComponentColors<O extends ColorOwner> = Partial<
	Record<ComponentColorKey<O>, ColorSpec>
>;

export function normalizeComponentColors<O extends ColorOwner>(
	owner: O,
	raw: unknown,
): ComponentColors<O> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return Object.fromEntries(
		componentColorKeys[owner].flatMap((key) => {
			const value = (raw as Record<string, unknown>)[key];
			return typeof value === "string" && isSupportedColorSpec(value) ? [[key, value]] : [];
		}),
	) as ComponentColors<O>;
}

const editorLegacyKeys = {
	accent: "editorAccent",
	border: "editorBorder",
	prompt: "editorPrompt",
	rail: "editorRail",
	gitBranch: "editorGitBranch",
	model: "editorModel",
	provider: "editorProvider",
	thinking: "editorThinking",
	thinkingMinimal: "editorThinkingMinimal",
	thinkingLow: "editorThinkingLow",
	thinkingMedium: "editorThinkingMedium",
	thinkingHigh: "editorThinkingHigh",
	thinkingXhigh: "editorThinkingXhigh",
	thinkingMax: "editorThinkingMax",
} as const;

/** Resolve only raw styles. Role-specific chains and selected-source defaults stay with the renderer. */
export function componentColor(
	config: ZentuiConfig,
	owner: "footer",
	key: ComponentColorKey<"footer">,
): string;
export function componentColor(
	config: ZentuiConfig,
	owner: "editor",
	key: Exclude<ComponentColorKey<"editor">, keyof typeof editorLegacyKeys>,
): string;
export function componentColor<O extends ColorOwner>(
	config: ZentuiConfig,
	owner: O,
	key: ComponentColorKey<O>,
): string | undefined;
export function componentColor<O extends ColorOwner>(
	config: ZentuiConfig,
	owner: O,
	key: ComponentColorKey<O>,
): string | undefined {
	const local = (config.components[owner].colors as Partial<Record<string, string>> | undefined)?.[
		key
	];
	if (typeof local === "string" && isSupportedColorSpec(local)) return local;
	if (owner === "selectorBorders") return undefined;
	const legacy =
		owner === "editor"
			? (editorLegacyKeys[key as keyof typeof editorLegacyKeys] ?? key)
			: owner === "userMessages"
				? key === "accent"
					? "editorAccent"
					: "editorBorder"
				: owner === "workingLine"
					? `workingLine${key[0]?.toUpperCase()}${key.slice(1)}`
					: key;
	return config.colors[legacy as keyof PolishedTuiColors];
}

export function workingLineColor(
	config: ZentuiConfig["components"]["workingLine"],
	colors: PolishedTuiColors,
	tier: ComponentColorKey<"workingLine">,
): string | undefined {
	const local = config.colors?.[tier];
	if (typeof local === "string" && isSupportedColorSpec(local)) return local;
	return colors[
		tier === "low" ? "workingLineLow" : tier === "mid" ? "workingLineMid" : "workingLineHigh"
	];
}
