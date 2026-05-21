import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ColorSpec = string;

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
		cwdText: ColorSpec;
		git: ColorSpec;
		gitStatus: ColorSpec;
		contextNormal: ColorSpec;
		contextWarning: ColorSpec;
		contextError: ColorSpec;
		tokens: ColorSpec;
		cost: ColorSpec;
		separator: ColorSpec;
	};
};

export const configPath = join(getAgentDir(), "zentui.json");

export const defaultConfig: PolishedTuiConfig = {
	projectRefreshIntervalMs: DEFAULT_PROJECT_REFRESH_INTERVAL_MS,
	icons: {
		cwd: "󰝰",
		git: "",
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
		cwdText: "syntaxOperator",
		git: "syntaxKeyword",
		gitStatus: "error",
		contextNormal: "muted",
		contextWarning: "warning",
		contextError: "error",
		tokens: "muted",
		cost: "success",
		separator: "borderMuted",
	},
};

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

export function ensureConfigExists(): void {
	try {
		if (!existsSync(configPath)) {
			writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
		}
	} catch {
		// Ignore config bootstrap failures; extension will fall back to defaults.
	}
}

export function mergeConfig(parsed: unknown): PolishedTuiConfig {
	const config = isRecord(parsed) ? parsed : {};
	const icons = isRecord(config.icons) ? (config.icons as Partial<PolishedTuiConfig["icons"]>) : {};
	const colors = isRecord(config.colors)
		? (config.colors as Partial<PolishedTuiConfig["colors"]>)
		: {};
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
	};
}

export function loadConfig(): PolishedTuiConfig {
	try {
		if (!existsSync(configPath)) return defaultConfig;
		return mergeConfig(JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		return defaultConfig;
	}
}
