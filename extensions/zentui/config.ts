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
		editorAccent?: ColorSpec;
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
	},
	colorSources: {
		starship: "theme",
		editor: "theme",
		userMessages: "theme",
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
		editorAccent: colorValue(record, "editorAccent"),
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

function isColorSourceKey(value: string): value is keyof ColorSourcesConfig {
	return value === "starship" || value === "editor" || value === "userMessages";
}

function validColorSourceEntries(record: Record<string, unknown>): Partial<ColorSourcesConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof ColorSourcesConfig, ColorSource] => {
			const [key, value] = entry;
			return isColorSourceKey(key) && (value === "theme" || value === "terminal");
		}),
	) as Partial<ColorSourcesConfig>;
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
	const icons = isRecord(config.icons)
		? normalizeIcons(config.icons as Record<string, unknown>)
		: {};
	const colors = isRecord(config.colors)
		? normalizeColors(config.colors as Record<string, unknown>)
		: {};
	const colorSources = isRecord(config.colorSources)
		? normalizeColorSources(config.colorSources as Record<string, unknown>)
		: defaultConfig.colorSources;
	return {
		projectRefreshIntervalMs: parseProjectRefreshIntervalMs(config.projectRefreshIntervalMs),
		icons: {
			...defaultConfig.icons,
			...icons,
		},
		colors: {
			...defaultConfig.colors,
			...colors,
		},
		colorSources: { ...colorSources },
	};
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
