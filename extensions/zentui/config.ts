import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export type ColorSpec = string;
export type ToolOutputStyle = "compact" | "truncated" | "full";

export type PolishedTuiConfig = {
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
	tools: {
		style: ToolOutputStyle;
	};
};

export const configPath = join(getAgentDir(), "zentui.json");

const themeColorTokens = new Set([
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
]);

export const defaultConfig: PolishedTuiConfig = {
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
	tools: {
		style: "compact",
	},
};

function isHexColor(value: string): boolean {
	return /^#(?:[0-9a-fA-F]{6})$/.test(value);
}

function hexToAnsi(hex: string, isBackground = false): string {
	const normalized = hex.slice(1);
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `\x1b[${isBackground ? 48 : 38};2;${r};${g};${b}m`;
}

type ThemeLike = {
	fg(color: string, text: string): string;
};

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseToolOutputStyle(value: unknown): ToolOutputStyle {
	return value === "truncated" || value === "full" || value === "compact"
		? value
		: defaultConfig.tools.style;
}

export function colorize(theme: ThemeLike, color: ColorSpec, text: string): string {
	if (themeColorTokens.has(color)) {
		return theme.fg(color, text);
	}
	if (isHexColor(color)) {
		return `${hexToAnsi(color)}${text}\x1b[39m`;
	}
	return theme.fg("text", text);
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
	const tools = isRecord(config.tools) ? (config.tools as Partial<PolishedTuiConfig["tools"]>) : {};

	return {
		icons: {
			...defaultConfig.icons,
			...icons,
		},
		colors: {
			...defaultConfig.colors,
			...colors,
		},
		tools: {
			...defaultConfig.tools,
			style: parseToolOutputStyle(tools.style),
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
