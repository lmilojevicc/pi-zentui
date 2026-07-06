import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSupportedColorSpec } from "./style";

export type ColorSpec = string;
export type ColorSource = "theme" | "terminal";

export type ColorSourcesConfig = {
	starship: ColorSource;
	editor: ColorSource;
	userMessages: ColorSource;
};

export type UiFeaturesConfig = {
	editor: boolean;
	statusLine: boolean;
	copyFriendly: boolean;
};

export type FooterSegmentsConfig = {
	cwd: boolean;
	gitBranch: boolean;
	gitStatus: boolean;
	runtime: boolean;
	context: boolean;
	tokens: boolean;
	cost: boolean;
};

export type ExtensionStatusPlacement = "off" | "left" | "middle" | "right";
export type ExtensionStatusColorMode = "zentui" | "original";

const DEFAULT_EXTENSION_STATUS_COLOR_MODE: ExtensionStatusColorMode = "zentui";

export type ExtensionStatusesConfig = {
	defaultPlacement: ExtensionStatusPlacement;
	placements: Record<string, ExtensionStatusPlacement>;
	colorModes: Record<string, ExtensionStatusColorMode>;
};

const DEFAULT_PROJECT_REFRESH_INTERVAL_MS = 30_000;
const MIN_PROJECT_REFRESH_INTERVAL_MS = 5_000;

export type PolishedTuiConfig = {
	projectRefreshIntervalMs: number;
	icons: {
		cwd: string;
		git: string;
		ahead: string;
		behind: string;
		diverged: string;
		conflicted: string;
		untracked: string;
		stashed: string;
		modified: string;
		staged: string;
		renamed: string;
		deleted: string;
		typechanged: string;
		cacheHit: string;
		editorPrompt: string;
		rail: string;
	};
	colors: {
		cwd: ColorSpec;
		gitBranch: ColorSpec;
		gitStatus: ColorSpec;
		contextNormal: ColorSpec;
		contextWarning: ColorSpec;
		contextError: ColorSpec;
		tokens: ColorSpec;
		cost: ColorSpec;
		separator: ColorSpec;
		runtimePrefix: ColorSpec;
		extensionStatus: ColorSpec;
		editorAccent?: ColorSpec;
		editorPrompt?: ColorSpec;
		editorBorder?: ColorSpec;
		editorModel?: ColorSpec;
		editorProvider?: ColorSpec;
		editorThinking?: ColorSpec;
		editorThinkingMinimal?: ColorSpec;
		editorThinkingLow?: ColorSpec;
		editorThinkingMedium?: ColorSpec;
		editorThinkingHigh?: ColorSpec;
		editorThinkingXhigh?: ColorSpec;
	};
	colorSources: ColorSourcesConfig;
	features: UiFeaturesConfig;
	footerSegments: FooterSegmentsConfig;
	extensionStatuses: ExtensionStatusesConfig;
};

export const configPath = join(getAgentDir(), "zentui.json");

export const defaultConfig: PolishedTuiConfig = {
	projectRefreshIntervalMs: DEFAULT_PROJECT_REFRESH_INTERVAL_MS,
	icons: {
		cwd: "󰝰",
		git: "",
		ahead: "↑",
		behind: "↓",
		diverged: "⇕",
		conflicted: "=",
		untracked: "?",
		stashed: "$",
		modified: "!",
		staged: "+",
		renamed: "»",
		deleted: "✘",
		typechanged: "T",
		cacheHit: "󰆼",
		editorPrompt: "",
		rail: "│",
	},
	colors: {
		cwd: "bold cyan",
		gitBranch: "bold purple",
		gitStatus: "bold red",
		contextNormal: "bright-black",
		contextWarning: "bold yellow",
		contextError: "bold red",
		tokens: "bright-black",
		cost: "bold green",
		separator: "bright-black",
		runtimePrefix: "",
		extensionStatus: "bright-black",
	},
	colorSources: {
		starship: "theme",
		editor: "theme",
		userMessages: "theme",
	},
	features: {
		editor: true,
		statusLine: true,
		copyFriendly: false,
	},
	footerSegments: {
		cwd: true,
		gitBranch: true,
		gitStatus: true,
		runtime: true,
		context: true,
		tokens: true,
		cost: true,
	},
	extensionStatuses: {
		defaultPlacement: "right",
		placements: {},
		colorModes: {},
	},
};

const iconKeys = [
	"cwd",
	"git",
	"ahead",
	"behind",
	"diverged",
	"conflicted",
	"untracked",
	"stashed",
	"modified",
	"staged",
	"renamed",
	"deleted",
	"typechanged",
	"cacheHit",
	"editorPrompt",
] as const satisfies readonly (keyof PolishedTuiConfig["icons"])[];

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProjectRefreshIntervalMs(value: unknown): number {
	if (value === 0) return 0;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return defaultConfig.projectRefreshIntervalMs;
	}

	const interval = Math.round(value);
	return interval >= MIN_PROJECT_REFRESH_INTERVAL_MS
		? interval
		: defaultConfig.projectRefreshIntervalMs;
}

function railValue(value: unknown): string {
	return typeof value === "string" && value.trim().length > 0 ? value : defaultConfig.icons.rail;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function colorValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = stringValue(record, key);
	return value !== undefined && isSupportedColorSpec(value) ? value : undefined;
}

function colorSourceValue(
	record: Record<string, unknown>,
	key: keyof ColorSourcesConfig,
): ColorSource {
	const value = record[key];
	return value === "terminal" || value === "theme" ? value : defaultConfig.colorSources[key];
}

function booleanValue(record: Record<string, unknown>, key: keyof UiFeaturesConfig): boolean {
	const value = record[key];
	return typeof value === "boolean" ? value : defaultConfig.features[key];
}

function footerSegmentValue(
	record: Record<string, unknown>,
	key: keyof FooterSegmentsConfig,
): boolean {
	const value = record[key];
	return typeof value === "boolean" ? value : defaultConfig.footerSegments[key];
}

function definedColors(
	colors: Partial<Record<keyof PolishedTuiConfig["colors"], string | undefined>>,
): Partial<PolishedTuiConfig["colors"]> {
	return Object.fromEntries(
		Object.entries(colors).filter(
			(entry): entry is [keyof PolishedTuiConfig["colors"], string] => typeof entry[1] === "string",
		),
	) as Partial<PolishedTuiConfig["colors"]>;
}

function normalizeIcons(record: Record<string, unknown>): Partial<PolishedTuiConfig["icons"]> {
	return Object.fromEntries(
		iconKeys.flatMap((key) => {
			const value = stringValue(record, key);
			return value === undefined ? [] : [[key, value]];
		}),
	) as Partial<PolishedTuiConfig["icons"]>;
}

function normalizeColors(record: Record<string, unknown>): Partial<PolishedTuiConfig["colors"]> {
	return definedColors({
		cwd: colorValue(record, "cwd") ?? colorValue(record, "cwdText"),
		gitBranch: colorValue(record, "gitBranch") ?? colorValue(record, "git"),
		gitStatus: colorValue(record, "gitStatus"),
		contextNormal: colorValue(record, "contextNormal"),
		contextWarning: colorValue(record, "contextWarning"),
		contextError: colorValue(record, "contextError"),
		tokens: colorValue(record, "tokens"),
		cost: colorValue(record, "cost"),
		separator: colorValue(record, "separator"),
		runtimePrefix: colorValue(record, "runtimePrefix"),
		extensionStatus: colorValue(record, "extensionStatus"),
		editorAccent: colorValue(record, "editorAccent"),
		editorPrompt: colorValue(record, "editorPrompt"),
		editorBorder: colorValue(record, "editorBorder"),
		editorModel: colorValue(record, "editorModel"),
		editorProvider: colorValue(record, "editorProvider"),
		editorThinking: colorValue(record, "editorThinking"),
		editorThinkingMinimal: colorValue(record, "editorThinkingMinimal"),
		editorThinkingLow: colorValue(record, "editorThinkingLow"),
		editorThinkingMedium: colorValue(record, "editorThinkingMedium"),
		editorThinkingHigh: colorValue(record, "editorThinkingHigh"),
		editorThinkingXhigh: colorValue(record, "editorThinkingXhigh"),
	});
}

function normalizeColorSources(record: Record<string, unknown>): ColorSourcesConfig {
	return {
		starship: colorSourceValue(record, "starship"),
		editor: colorSourceValue(record, "editor"),
		userMessages: colorSourceValue(record, "userMessages"),
	};
}

function normalizeUiFeatures(record: Record<string, unknown>): UiFeaturesConfig {
	return {
		editor: booleanValue(record, "editor"),
		statusLine: booleanValue(record, "statusLine"),
		copyFriendly: booleanValue(record, "copyFriendly"),
	};
}

function normalizeFooterSegments(record: Record<string, unknown>): FooterSegmentsConfig {
	return {
		cwd: footerSegmentValue(record, "cwd"),
		gitBranch: footerSegmentValue(record, "gitBranch"),
		gitStatus: footerSegmentValue(record, "gitStatus"),
		runtime: footerSegmentValue(record, "runtime"),
		context: footerSegmentValue(record, "context"),
		tokens: footerSegmentValue(record, "tokens"),
		cost: footerSegmentValue(record, "cost"),
	};
}

export function isExtensionStatusPlacement(value: unknown): value is ExtensionStatusPlacement {
	return value === "off" || value === "left" || value === "middle" || value === "right";
}

export function isExtensionStatusColorMode(value: unknown): value is ExtensionStatusColorMode {
	return value === "zentui" || value === "original";
}

function normalizeExtensionStatuses(record: Record<string, unknown>): ExtensionStatusesConfig {
	const defaultPlacement = isExtensionStatusPlacement(record.defaultPlacement)
		? record.defaultPlacement
		: defaultConfig.extensionStatuses.defaultPlacement;
	const placements = isRecord(record.placements)
		? Object.fromEntries(
				Object.entries(record.placements).filter(
					(entry): entry is [string, ExtensionStatusPlacement] =>
						isExtensionStatusPlacement(entry[1]),
				),
			)
		: {};
	const colorModes = isRecord(record.colorModes)
		? Object.fromEntries(
				Object.entries(record.colorModes).filter(
					(entry): entry is [string, ExtensionStatusColorMode] =>
						isExtensionStatusColorMode(entry[1]),
				),
			)
		: {};

	return {
		defaultPlacement,
		placements,
		colorModes,
	};
}

function isColorSourceKey(value: string): value is keyof ColorSourcesConfig {
	return value === "starship" || value === "editor" || value === "userMessages";
}

function isUiFeatureKey(value: string): value is keyof UiFeaturesConfig {
	return value === "editor" || value === "statusLine" || value === "copyFriendly";
}

function isFooterSegmentKey(value: string): value is keyof FooterSegmentsConfig {
	return (
		value === "cwd" ||
		value === "gitBranch" ||
		value === "gitStatus" ||
		value === "runtime" ||
		value === "context" ||
		value === "tokens" ||
		value === "cost"
	);
}

function validColorSourceEntries(record: Record<string, unknown>): Partial<ColorSourcesConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof ColorSourcesConfig, ColorSource] => {
			const [key, value] = entry;
			return isColorSourceKey(key) && (value === "theme" || value === "terminal");
		}),
	) as Partial<ColorSourcesConfig>;
}

function validUiFeatureEntries(record: Record<string, unknown>): Partial<UiFeaturesConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof UiFeaturesConfig, boolean] => {
			const [key, value] = entry;
			return isUiFeatureKey(key) && typeof value === "boolean";
		}),
	) as Partial<UiFeaturesConfig>;
}

function validFooterSegmentEntries(record: Record<string, unknown>): Partial<FooterSegmentsConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof FooterSegmentsConfig, boolean] => {
			const [key, value] = entry;
			return isFooterSegmentKey(key) && typeof value === "boolean";
		}),
	) as Partial<FooterSegmentsConfig>;
}

function readConfigRecord(path = configPath): ConfigRecord {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function ensureConfigExists(): void {
	// Intentionally left as a no-op. Zentui config is user-owned and
	// compatibility-sensitive: runtime defaults come from `mergeConfig({})`, and
	// the extension should not persist opinionated defaults unless the user
	// explicitly changes a setting.
}

export function mergeConfig(parsed: unknown): PolishedTuiConfig {
	const config = isRecord(parsed) ? parsed : {};
	const iconsRecord = isRecord(config.icons) ? (config.icons as Record<string, unknown>) : {};
	const icons = normalizeIcons(iconsRecord);
	const colors = isRecord(config.colors)
		? normalizeColors(config.colors as Record<string, unknown>)
		: {};
	const colorSources = isRecord(config.colorSources)
		? normalizeColorSources(config.colorSources as Record<string, unknown>)
		: defaultConfig.colorSources;
	const features = isRecord(config.features)
		? normalizeUiFeatures(config.features as Record<string, unknown>)
		: defaultConfig.features;
	const footerSegments = isRecord(config.footerSegments)
		? normalizeFooterSegments(config.footerSegments as Record<string, unknown>)
		: defaultConfig.footerSegments;
	const extensionStatuses = isRecord(config.extensionStatuses)
		? normalizeExtensionStatuses(config.extensionStatuses as Record<string, unknown>)
		: defaultConfig.extensionStatuses;
	return {
		projectRefreshIntervalMs: parseProjectRefreshIntervalMs(config.projectRefreshIntervalMs),
		icons: {
			...defaultConfig.icons,
			...icons,
			rail: railValue(iconsRecord.rail),
		},
		colors: {
			...defaultConfig.colors,
			...colors,
		},
		colorSources: { ...colorSources },
		features: { ...features },
		footerSegments: { ...footerSegments },
		extensionStatuses: {
			defaultPlacement: extensionStatuses.defaultPlacement,
			placements: { ...extensionStatuses.placements },
			colorModes: { ...extensionStatuses.colorModes },
		},
	};
}

export function getExtensionStatusPlacement(
	config: PolishedTuiConfig,
	key: string,
): ExtensionStatusPlacement {
	return config.extensionStatuses.placements[key] ?? config.extensionStatuses.defaultPlacement;
}

export function getExtensionStatusColorMode(
	config: PolishedTuiConfig,
	key: string,
): ExtensionStatusColorMode {
	return config.extensionStatuses.colorModes[key] ?? DEFAULT_EXTENSION_STATUS_COLOR_MODE;
}

export function loadConfig(): PolishedTuiConfig {
	try {
		if (!existsSync(configPath)) return mergeConfig({});
		return mergeConfig(JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		return mergeConfig({});
	}
}

export function saveColorSourcesPatch(
	patch: Partial<ColorSourcesConfig>,
	path = configPath,
): PolishedTuiConfig {
	const record = readConfigRecord(path);
	const existing = isRecord(record.colorSources)
		? { ...(record.colorSources as Record<string, unknown>) }
		: {};
	record.colorSources = {
		...existing,
		...validColorSourceEntries(patch),
	};
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	return mergeConfig(record);
}

export function saveUiFeaturesPatch(
	patch: Partial<UiFeaturesConfig>,
	path = configPath,
): PolishedTuiConfig {
	const record = readConfigRecord(path);
	const existing = isRecord(record.features)
		? { ...(record.features as Record<string, unknown>) }
		: {};
	record.features = {
		...existing,
		...validUiFeatureEntries(patch),
	};
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	return mergeConfig(record);
}

export function saveFooterSegmentsPatch(
	patch: Partial<FooterSegmentsConfig>,
	path = configPath,
): PolishedTuiConfig {
	const record = readConfigRecord(path);
	const existing = isRecord(record.footerSegments)
		? { ...(record.footerSegments as Record<string, unknown>) }
		: {};
	record.footerSegments = {
		...existing,
		...validFooterSegmentEntries(patch),
	};
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	return mergeConfig(record);
}

export function saveExtensionStatusPlacement(
	key: string,
	placement: ExtensionStatusPlacement,
	path = configPath,
): PolishedTuiConfig {
	const record = readConfigRecord(path);
	const existingExtensionStatuses = isRecord(record.extensionStatuses)
		? { ...(record.extensionStatuses as Record<string, unknown>) }
		: {};
	const existingPlacements = isRecord(existingExtensionStatuses.placements)
		? { ...(existingExtensionStatuses.placements as Record<string, unknown>) }
		: {};

	Object.defineProperty(existingPlacements, key, {
		value: placement,
		enumerable: true,
		configurable: true,
		writable: true,
	});

	record.extensionStatuses = {
		...existingExtensionStatuses,
		placements: existingPlacements,
	};
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	return mergeConfig(record);
}

export function saveExtensionStatusColorMode(
	key: string,
	colorMode: ExtensionStatusColorMode,
	path = configPath,
): PolishedTuiConfig {
	const record = readConfigRecord(path);
	const existingExtensionStatuses = isRecord(record.extensionStatuses)
		? { ...(record.extensionStatuses as Record<string, unknown>) }
		: {};
	const existingColorModes = isRecord(existingExtensionStatuses.colorModes)
		? { ...(existingExtensionStatuses.colorModes as Record<string, unknown>) }
		: {};

	Object.defineProperty(existingColorModes, key, {
		value: colorMode,
		enumerable: true,
		configurable: true,
		writable: true,
	});

	record.extensionStatuses = {
		...existingExtensionStatuses,
		colorModes: existingColorModes,
	};
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	return mergeConfig(record);
}
