import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fchmodSync,
	fsyncSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	ICON_GLYPH_KEYS,
	type IconGlyphs,
	type IconMode,
	NERD_DEFAULT_ICONS,
	normalizeIconMode,
	type ResolvedIcons,
	resolveConfiguredIcons,
} from "./icons";
import { isSupportedColorSpec } from "./style";
import { normalizeWorkingLineMessages } from "./working-line";
import { PI_WORKING_LINE_MESSAGES } from "./working-line-messages";

export type ColorSpec = string;
export type ColorSource = "theme" | "terminal";
export type { IconMode } from "./icons";

export type ContextStyle = "text" | "gauge" | "text+gauge";
export type SeparatorStyle = "pipe" | "dot" | "chevron" | "none";
export type ModelLabelSource = "id" | "name";
export type EditorStyle = "opencode" | "opencode-copy-friendly" | "accent-rail" | "minimalist";
export type UserMessageStyle = "framed" | "framed-copy-friendly" | "compact" | "labeled";
export type SelectorBorderStyle = "zentui";
export type FooterStyle = "native" | "starship" | "hidden";
export type WorkingLineSpinner =
	| "braille"
	| "star-bloom"
	| "pinwheel"
	| "claude-inspired"
	| "pulse";
export type WorkingLineTextAnimation = "classic" | "kitt" | "disabled";
export type ThinkingStepsMode = "rail" | "tree" | "streaming";
export type ComponentStyleOwner = "editor" | "userMessages" | "selectorBorders" | "footer";
export type MinimalistPathDisplayMode = "compact" | "project" | "full";
export type MinimalistContextFormat = "percent" | "percent-total";
export type EditorBorderColorMode = "static" | "adaptive";
export type CompletionMenuStyle = "native" | "palette";
export type CompactFooterMaxLines = 1 | 2 | 3 | "unlimited";

export const DEFAULT_COMPACT_FOOTER_FORMAT =
	"$cwd$wrap(in $session_name)$wrap(on $git_branch) $git_status$wrap$context$wrap_sep$tokens";

export type ContextThresholds = {
	warning: number;
	error: number;
};

export type PathDisplayMode = "basename" | "full" | "repository";

export type PathDisplayConfig = {
	mode: PathDisplayMode;
	/** Final components to show in full/repository mode. 0 = unlimited; clamped to 0..5. */
	depth: number;
};

export type GitBranchMaxLength = "full" | number;

export type GitBranchConfig = {
	maxLength: GitBranchMaxLength;
};

export type ColorSourcesConfig = {
	starship: ColorSource;
	editor: ColorSource;
	userMessages: ColorSource;
};

export type UiFeaturesConfig = {
	editor: boolean;
	statusLine: boolean;
	viewportIndicators: boolean;
};

export type FooterSegmentsConfig = {
	cwd: boolean;
	sessionName: boolean;
	gitBranch: boolean;
	gitStatus: boolean;
	gitCounts: boolean;
	gitCommit: boolean;
	gitMetrics: boolean;
	runtime: boolean;
	modelInfo: boolean;
	context: boolean;
	tokens: boolean;
	cost: boolean;
	sessionDuration: boolean;
	username: boolean;
	time: boolean;
	os: boolean;
	packageVersion: boolean;
};

export type PolishedEditorStyleConfig = {
	metadataFormat: string;
	completionMenu: CompletionMenuStyle;
};

export type PolishedCopyFriendlyEditorStyleConfig = {
	metadataFormat: string;
	completionMenu: CompletionMenuStyle;
};

export type AccentRailEditorStyleConfig = {
	rail: string;
	asciiRail: string;
	transparent: boolean;
};

export type MinimalistEditorStyleConfig = {
	pathDisplay: MinimalistPathDisplayMode;
	contextFormat: MinimalistContextFormat;
	contextGauge: boolean;
	showSessionName: boolean;
	showTimer: boolean;
	showCost: boolean;
	showGit: boolean;
	contextThresholds: ContextThresholds;
};

/** Temporary name retained for existing settings consumers. */
export type MinimalistConfig = MinimalistEditorStyleConfig;

export type EditorStylesConfig = {
	minimalist: MinimalistEditorStyleConfig;
};

export type EditorComponentConfig = {
	enabled: boolean;
	style: EditorStyle;
	colorSource: ColorSource;
	borderColorMode: EditorBorderColorMode;
	modelLabel: ModelLabelSource;
	viewportIndicators: boolean;
	styles: {
		opencode: PolishedEditorStyleConfig;
		"opencode-copy-friendly": PolishedCopyFriendlyEditorStyleConfig;
		"accent-rail": AccentRailEditorStyleConfig;
		minimalist: MinimalistEditorStyleConfig;
	};
};

export type FramedUserMessageStyleConfig = Record<string, never>;
export type FramedCopyFriendlyUserMessageStyleConfig = Record<string, never>;
export type CompactUserMessageStyleConfig = Record<string, never>;
export type LabeledUserMessageStyleConfig = Record<string, never>;

export type UserMessagesComponentConfig = {
	enabled: boolean;
	style: UserMessageStyle;
	colorSource: ColorSource;
	styles: {
		framed: FramedUserMessageStyleConfig;
		"framed-copy-friendly": FramedCopyFriendlyUserMessageStyleConfig;
		compact: CompactUserMessageStyleConfig;
		labeled: LabeledUserMessageStyleConfig;
	};
};

export type SelectorBordersComponentConfig = {
	enabled: boolean;
	style: SelectorBorderStyle;
	colorSource: ColorSource;
};

export type StarshipFooterStyleConfig = {
	format: string;
	responsive: boolean;
	compactFormat: string;
	compactMaxLines: CompactFooterMaxLines;
	separator: SeparatorStyle;
	contextStyle: ContextStyle;
	contextThresholds: ContextThresholds;
	pathDisplay: PathDisplayConfig;
	segments: FooterSegmentsConfig;
	gitBranch: GitBranchConfig;
	gitCommit: GitCommitConfig;
	gitMetrics: GitMetricsConfig;
	extensionStatuses: ExtensionStatusesConfig;
};

export type FooterComponentConfig = {
	style: FooterStyle;
	colorSource: ColorSource;
	modelLabel: ModelLabelSource;
	styles: {
		starship: StarshipFooterStyleConfig;
	};
};

export type WorkingLineMessagesConfig = {
	custom: boolean;
	values: string[];
};

export type WorkingLineSegmentsConfig = {
	tool: boolean;
	elapsed: boolean;
	thought: boolean;
	tokens: boolean;
};

export const DEFAULT_WORKING_LINE_SPINNER_INTERVAL_MS = 100;
export const DEFAULT_WORKING_LINE_TEXT_INTERVAL_MS = 60;
export const MIN_WORKING_LINE_INTERVAL_MS = 30;
export const MAX_WORKING_LINE_INTERVAL_MS = 1000;

export function isValidWorkingLineIntervalMs(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= MIN_WORKING_LINE_INTERVAL_MS &&
		value <= MAX_WORKING_LINE_INTERVAL_MS
	);
}

export type WorkingLineComponentConfig = {
	enabled: boolean;
	turnSummary: boolean;
	spinner: WorkingLineSpinner;
	spinnerIntervalMs: number;
	animateSpinnerColor: boolean;
	textIntervalMs: number;
	textAnimation: WorkingLineTextAnimation;
	colorSource: ColorSource;
	messages: WorkingLineMessagesConfig;
	segments: WorkingLineSegmentsConfig;
};

export type WorkingLineComponentPatch = Partial<
	Omit<WorkingLineComponentConfig, "messages" | "segments">
> & {
	messages?: Partial<WorkingLineMessagesConfig>;
	segments?: Partial<WorkingLineSegmentsConfig>;
};

export type ThinkingStepsComponentConfig = {
	enabled: boolean;
	mode: ThinkingStepsMode;
};

export type ComponentsConfig = {
	editor: EditorComponentConfig;
	userMessages: UserMessagesComponentConfig;
	thinkingSteps: ThinkingStepsComponentConfig;
	workingLine: WorkingLineComponentConfig;
	selectorBorders: SelectorBordersComponentConfig;
	footer: FooterComponentConfig;
};

export type ExtensionStatusPlacement = "off" | "left" | "middle" | "right";
export type ExtensionStatusColorMode = "zentui" | "original";

/**
 * Starship `git_commit`-style options.
 * See https://starship.rs/config/#git-commit
 */
export type GitCommitConfig = {
	hashLength: number;
	onlyDetached: boolean;
	showTag: boolean;
};

/**
 * Starship `git_metrics`-style options.
 * See https://starship.rs/config/#git-metrics
 */
export type GitMetricsConfig = {
	onlyNonzero: boolean;
	ignoreSubmodules: boolean;
};

const DEFAULT_EXTENSION_STATUS_PLACEMENT: ExtensionStatusPlacement = "right";
const DEFAULT_EXTENSION_STATUS_COLOR_MODE: ExtensionStatusColorMode = "zentui";

export type ExtensionStatusesConfig = {
	defaultPlacement: ExtensionStatusPlacement;
	placements: Record<string, ExtensionStatusPlacement>;
	colorModes: Record<string, ExtensionStatusColorMode>;
};

const DEFAULT_PROJECT_REFRESH_INTERVAL_MS = 30_000;
const MIN_PROJECT_REFRESH_INTERVAL_MS = 5_000;
export const DEFAULT_EDITOR_METADATA_FORMAT = "$model  $provider(  $thinking)";

export type ZentuiConfig = {
	projectRefreshIntervalMs: number;
	icons: ResolvedIcons;
	colors: PolishedTuiColors;
	components: ComponentsConfig;
};

export type PolishedTuiColors = {
	cwd: ColorSpec;
	sessionName: ColorSpec;
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
	sessionDuration: ColorSpec;
	packageVersion: ColorSpec;
	gitCommit: ColorSpec;
	gitMetricsAdded: ColorSpec;
	gitMetricsDeleted: ColorSpec;
	username: ColorSpec;
	time: ColorSpec;
	os: ColorSpec;
	editorAccent?: ColorSpec;
	editorRail?: ColorSpec;
	editorPrompt?: ColorSpec;
	editorBorder?: ColorSpec;
	editorGitBranch?: ColorSpec;
	editorModel?: ColorSpec;
	editorProvider?: ColorSpec;
	editorThinking?: ColorSpec;
	editorThinkingMinimal?: ColorSpec;
	editorThinkingLow?: ColorSpec;
	editorThinkingMedium?: ColorSpec;
	editorThinkingHigh?: ColorSpec;
	editorThinkingXhigh?: ColorSpec;
	editorThinkingMax?: ColorSpec;
	workingLineLow?: ColorSpec;
	workingLineMid?: ColorSpec;
	workingLineHigh?: ColorSpec;
};

/**
 * Canonical configuration plus a temporary flat compatibility projection used
 * by production consumers while they migrate to `components`.
 */
export type PolishedTuiConfig = ZentuiConfig & {
	footerFormat: string;
	responsiveFooter: boolean;
	compactFooterFormat: string;
	compactFooterMaxLines: CompactFooterMaxLines;
	editorMetadataFormat: string;
	separator: SeparatorStyle;
	contextStyle: ContextStyle;
	editorModelLabel: ModelLabelSource;
	editorStyle: EditorStyle;
	editorStyles: EditorStylesConfig;
	editorBorderColorMode: EditorBorderColorMode;
	contextThresholds: ContextThresholds;
	pathDisplay: PathDisplayConfig;
	gitBranch: GitBranchConfig;
	colorSources: ColorSourcesConfig;
	features: UiFeaturesConfig;
	footerSegments: FooterSegmentsConfig;
	gitCommit: GitCommitConfig;
	gitMetrics: GitMetricsConfig;
	extensionStatuses: ExtensionStatusesConfig;
};

/**
 * Canonical footer format variable names. In a `footerFormat` string these
 * are written as `$name` or `${name}`.
 */
export const FOOTER_FORMAT_VARIABLES = [
	"cwd",
	"session_name",
	"git_branch",
	"git_status",
	"git_state",
	"runtime",
	"model",
	"provider",
	"session_duration",
	"username",
	"os",
	"time",
	"context",
	"tokens",
	"cache_read",
	"cache_write",
	"cost",
	"subscription",
	"auto_compaction",
	"package",
	"package_version",
	"git_commit",
	"git_tag",
	"git_metrics",
	"git_added",
	"git_deleted",
	"sep",
] as const;

/**
 * Alias → canonical variable name mapping for `footerFormat`.
 * `$fill` is special (not a variable) and handled by the parser.
 */
export const FOOTER_FORMAT_ALIASES: Record<string, string> = {
	directory: "cwd",
	branch: "git_branch",
	status: "git_status",
	state: "git_state",
	commit: "git_commit",
	tag: "git_tag",
	duration: "session_duration",
	separator: "sep",
};

export const configPath = join(getAgentDir(), "zentui.json");

const defaultFooterSegments: FooterSegmentsConfig = {
	cwd: true,
	sessionName: true,
	gitBranch: true,
	gitStatus: true,
	gitCounts: false,
	gitCommit: false,
	gitMetrics: false,
	runtime: true,
	modelInfo: false,
	context: true,
	tokens: true,
	cost: true,
	sessionDuration: false,
	username: false,
	time: false,
	os: false,
	packageVersion: false,
};

const DEFAULT_COMPLETION_MENU: CompletionMenuStyle = "palette";

const defaultAccentRailStyle: AccentRailEditorStyleConfig = {
	rail: "▎",
	asciiRail: "|",
	transparent: false,
};

const defaultMinimalistStyle: MinimalistEditorStyleConfig = {
	pathDisplay: "compact",
	contextFormat: "percent",
	contextGauge: false,
	showSessionName: true,
	showTimer: true,
	showCost: true,
	showGit: true,
	contextThresholds: { warning: 70, error: 90 },
};

const defaultStarshipStyle: StarshipFooterStyleConfig = {
	format: "",
	responsive: true,
	compactFormat: DEFAULT_COMPACT_FOOTER_FORMAT,
	compactMaxLines: 2,
	separator: "pipe",
	contextStyle: "text",
	contextThresholds: { warning: 70, error: 90 },
	pathDisplay: { mode: "basename", depth: 0 },
	segments: defaultFooterSegments,
	gitBranch: { maxLength: "full" },
	gitCommit: { hashLength: 7, onlyDetached: true, showTag: true },
	gitMetrics: { onlyNonzero: true, ignoreSubmodules: false },
	extensionStatuses: { defaultPlacement: "right", placements: {}, colorModes: {} },
};

const defaultComponents: ComponentsConfig = {
	editor: {
		enabled: true,
		style: "opencode",
		colorSource: "theme",
		borderColorMode: "static",
		modelLabel: "id",
		viewportIndicators: true,
		styles: {
			opencode: {
				metadataFormat: DEFAULT_EDITOR_METADATA_FORMAT,
				completionMenu: DEFAULT_COMPLETION_MENU,
			},
			"opencode-copy-friendly": {
				metadataFormat: DEFAULT_EDITOR_METADATA_FORMAT,
				completionMenu: DEFAULT_COMPLETION_MENU,
			},
			"accent-rail": defaultAccentRailStyle,
			minimalist: defaultMinimalistStyle,
		},
	},
	userMessages: {
		enabled: true,
		style: "framed",
		colorSource: "theme",
		styles: { framed: {}, "framed-copy-friendly": {}, compact: {}, labeled: {} },
	},
	thinkingSteps: { enabled: false, mode: "tree" },
	workingLine: {
		enabled: false,
		turnSummary: true,
		spinner: "star-bloom",
		spinnerIntervalMs: DEFAULT_WORKING_LINE_SPINNER_INTERVAL_MS,
		animateSpinnerColor: false,
		textIntervalMs: DEFAULT_WORKING_LINE_TEXT_INTERVAL_MS,
		textAnimation: "classic",
		colorSource: "theme",
		messages: { custom: true, values: [...PI_WORKING_LINE_MESSAGES] },
		segments: { tool: true, elapsed: true, thought: true, tokens: true },
	},
	selectorBorders: { enabled: true, style: "zentui", colorSource: "theme" },
	footer: {
		style: "starship",
		colorSource: "theme",
		modelLabel: "id",
		styles: { starship: defaultStarshipStyle },
	},
};

export const defaultConfig: PolishedTuiConfig = {
	projectRefreshIntervalMs: DEFAULT_PROJECT_REFRESH_INTERVAL_MS,
	icons: { mode: "auto", ...NERD_DEFAULT_ICONS },
	colors: {
		cwd: "bold cyan",
		sessionName: "bold green",
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
		sessionDuration: "yellow",
		packageVersion: "208",
		gitCommit: "bold green",
		gitMetricsAdded: "bold green",
		gitMetricsDeleted: "bold red",
		username: "bold yellow",
		time: "bold yellow",
		os: "bold white",
	},
	components: defaultComponents,
	footerFormat: defaultStarshipStyle.format,
	responsiveFooter: defaultStarshipStyle.responsive,
	compactFooterFormat: defaultStarshipStyle.compactFormat,
	compactFooterMaxLines: defaultStarshipStyle.compactMaxLines,
	editorMetadataFormat: DEFAULT_EDITOR_METADATA_FORMAT,
	separator: defaultStarshipStyle.separator,
	contextStyle: defaultStarshipStyle.contextStyle,
	editorModelLabel: defaultComponents.editor.modelLabel,
	editorStyle: defaultComponents.editor.style,
	editorStyles: { minimalist: defaultMinimalistStyle },
	editorBorderColorMode: defaultComponents.editor.borderColorMode,
	contextThresholds: defaultStarshipStyle.contextThresholds,
	pathDisplay: defaultStarshipStyle.pathDisplay,
	gitBranch: defaultStarshipStyle.gitBranch,
	colorSources: { starship: "theme", editor: "theme", userMessages: "theme" },
	features: {
		editor: true,
		statusLine: true,
		viewportIndicators: true,
	},
	footerSegments: defaultFooterSegments,
	gitCommit: defaultStarshipStyle.gitCommit,
	gitMetrics: defaultStarshipStyle.gitMetrics,
	extensionStatuses: defaultStarshipStyle.extensionStatuses,
};

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProjectRefreshIntervalMs(value: unknown): number {
	if (value === 0) return 0;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_PROJECT_REFRESH_INTERVAL_MS;
	}

	const interval = Math.round(value);
	if (interval <= 0) return 0;
	return Math.max(MIN_PROJECT_REFRESH_INTERVAL_MS, interval);
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function parseContextStyle(value: unknown): ContextStyle {
	if (value === "text" || value === "gauge" || value === "text+gauge") return value;
	return defaultConfig.contextStyle;
}

function parseEditorModelLabel(
	value: unknown,
	fallback: ModelLabelSource = defaultComponents.editor.modelLabel,
): ModelLabelSource {
	if (value === "id" || value === "name") return value;
	return fallback;
}

function parseEditorStyle(value: unknown): EditorStyle {
	if (
		value === "opencode" ||
		value === "opencode-copy-friendly" ||
		value === "accent-rail" ||
		value === "minimalist"
	) {
		return value;
	}
	if (value === "polished") return "opencode";
	if (value === "polished-copy-friendly") return "opencode-copy-friendly";
	return defaultConfig.editorStyle;
}

function parseEditorBorderColorMode(value: unknown): EditorBorderColorMode {
	if (value === "static" || value === "adaptive") return value;
	return defaultConfig.editorBorderColorMode;
}

function parseCompletionMenuStyle(value: unknown): CompletionMenuStyle {
	return value === "native" || value === "palette" ? value : DEFAULT_COMPLETION_MENU;
}

export function isSeparatorStyle(value: unknown): value is SeparatorStyle {
	return value === "pipe" || value === "dot" || value === "chevron" || value === "none";
}

function parseSeparatorStyle(value: unknown): SeparatorStyle {
	return isSeparatorStyle(value) ? value : defaultConfig.separator;
}

function parseContextThresholds(
	value: unknown,
	defaults: ContextThresholds = defaultStarshipStyle.contextThresholds,
): ContextThresholds {
	if (!isRecord(value)) return { ...defaults };

	const warningRaw = value.warning;
	const errorRaw = value.error;
	let warning =
		typeof warningRaw === "number" && Number.isFinite(warningRaw)
			? clampPercent(Math.round(warningRaw))
			: defaults.warning;
	let error =
		typeof errorRaw === "number" && Number.isFinite(errorRaw)
			? clampPercent(Math.round(errorRaw))
			: defaults.error;
	if (error < warning) {
		const swapped = warning;
		warning = error;
		error = swapped;
	}
	return { warning, error };
}

function parsePathDisplay(value: unknown): PathDisplayConfig {
	const defaults = defaultConfig.pathDisplay;
	if (!isRecord(value)) return { ...defaults };
	const mode =
		value.mode === "full" || value.mode === "basename" || value.mode === "repository"
			? value.mode
			: defaults.mode;
	const rawDepth = value.depth;
	const depth =
		typeof rawDepth === "number" && Number.isFinite(rawDepth) && rawDepth >= 0
			? Math.min(5, Math.floor(rawDepth))
			: defaults.depth;
	return { mode, depth };
}

function normalizeGitBranchMaxLength(value: unknown): GitBranchMaxLength {
	if (value === "full") return value;
	if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	return defaultConfig.gitBranch.maxLength;
}

function parseGitBranchConfig(value: unknown): GitBranchConfig {
	const defaults = defaultConfig.gitBranch;
	if (!isRecord(value)) return { ...defaults };
	return {
		maxLength: normalizeGitBranchMaxLength(value.maxLength),
	};
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function parseCompactFooterMaxLines(value: unknown): CompactFooterMaxLines {
	return value === 1 || value === 2 || value === 3 || value === "unlimited" ? value : 2;
}

function colorValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = stringValue(record, key);
	return value !== undefined && isSupportedColorSpec(value) ? value : undefined;
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

function normalizeIconOverrides(record: Record<string, unknown>): Partial<IconGlyphs> {
	return Object.fromEntries(
		ICON_GLYPH_KEYS.flatMap((key) => {
			const value = stringValue(record, key);
			return value === undefined ? [] : [[key, value]];
		}),
	) as Partial<IconGlyphs>;
}

function normalizeColors(record: Record<string, unknown>): Partial<PolishedTuiConfig["colors"]> {
	return definedColors({
		cwd: colorValue(record, "cwd") ?? colorValue(record, "cwdText"),
		sessionName: colorValue(record, "sessionName"),
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
		sessionDuration: colorValue(record, "sessionDuration"),
		packageVersion: colorValue(record, "packageVersion"),
		gitCommit: colorValue(record, "gitCommit"),
		gitMetricsAdded: colorValue(record, "gitMetricsAdded"),
		gitMetricsDeleted: colorValue(record, "gitMetricsDeleted"),
		username: colorValue(record, "username"),
		time: colorValue(record, "time"),
		os: colorValue(record, "os"),
		editorAccent: colorValue(record, "editorAccent"),
		editorRail: colorValue(record, "editorRail"),
		editorPrompt: colorValue(record, "editorPrompt"),
		editorBorder: colorValue(record, "editorBorder"),
		editorGitBranch: colorValue(record, "editorGitBranch"),
		editorModel: colorValue(record, "editorModel"),
		editorProvider: colorValue(record, "editorProvider"),
		editorThinking: colorValue(record, "editorThinking"),
		editorThinkingMinimal: colorValue(record, "editorThinkingMinimal"),
		editorThinkingLow: colorValue(record, "editorThinkingLow"),
		editorThinkingMedium: colorValue(record, "editorThinkingMedium"),
		editorThinkingHigh: colorValue(record, "editorThinkingHigh"),
		editorThinkingXhigh: colorValue(record, "editorThinkingXhigh"),
		editorThinkingMax: colorValue(record, "editorThinkingMax"),
		workingLineLow: colorValue(record, "workingLineLow"),
		workingLineMid: colorValue(record, "workingLineMid"),
		workingLineHigh: colorValue(record, "workingLineHigh"),
	});
}

/** Clamp hashLength to Git's valid abbreviation range [4, 40]. */
function normalizeGitHashLength(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return defaultConfig.gitCommit.hashLength;
	const rounded = Math.round(parsed);
	return Math.min(40, Math.max(4, rounded));
}

function normalizeGitCommitConfig(record: Record<string, unknown>): GitCommitConfig {
	return {
		hashLength: normalizeGitHashLength(record.hashLength),
		onlyDetached:
			typeof record.onlyDetached === "boolean"
				? record.onlyDetached
				: defaultConfig.gitCommit.onlyDetached,
		showTag: typeof record.showTag === "boolean" ? record.showTag : defaultConfig.gitCommit.showTag,
	};
}

function normalizeGitMetricsConfig(record: Record<string, unknown>): GitMetricsConfig {
	return {
		onlyNonzero:
			typeof record.onlyNonzero === "boolean"
				? record.onlyNonzero
				: defaultConfig.gitMetrics.onlyNonzero,
		ignoreSubmodules:
			typeof record.ignoreSubmodules === "boolean"
				? record.ignoreSubmodules
				: defaultConfig.gitMetrics.ignoreSubmodules,
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
	return value === "editor" || value === "statusLine" || value === "viewportIndicators";
}

function isFooterSegmentKey(value: string): value is keyof FooterSegmentsConfig {
	return (
		value === "cwd" ||
		value === "sessionName" ||
		value === "gitBranch" ||
		value === "gitStatus" ||
		value === "gitCounts" ||
		value === "runtime" ||
		value === "modelInfo" ||
		value === "context" ||
		value === "tokens" ||
		value === "cost" ||
		value === "sessionDuration" ||
		value === "username" ||
		value === "time" ||
		value === "os" ||
		value === "packageVersion" ||
		value === "gitCommit" ||
		value === "gitMetrics"
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

type ConfigFileState =
	| { kind: "missing"; record: ConfigRecord; writePath: string }
	| { kind: "valid"; record: ConfigRecord; writePath: string; mode: number }
	| { kind: "corrupt"; error: unknown };

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String(error.code)
		: undefined;
}

function readConfigFileState(path: string): ConfigFileState {
	let writePath = path;
	try {
		const pathStat = lstatSync(path);
		if (pathStat.isSymbolicLink()) writePath = realpathSync(path);
		const targetStat = statSync(writePath);
		const parsed = JSON.parse(readFileSync(writePath, "utf8"));
		return isRecord(parsed)
			? { kind: "valid", record: parsed, writePath, mode: targetStat.mode & 0o7777 }
			: { kind: "corrupt", error: new Error("top-level value must be a JSON object") };
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			try {
				lstatSync(path);
			} catch (pathError) {
				if (errorCode(pathError) === "ENOENT")
					return { kind: "missing", record: {}, writePath: path };
			}
		}
		return { kind: "corrupt", error };
	}
}

function writeConfigAtomically(path: string, record: ConfigRecord, mode?: number): void {
	const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	let file: number | undefined;
	try {
		file = openSync(tempPath, "wx", mode ?? 0o666);
		if (mode !== undefined) fchmodSync(file, mode);
		writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
		fsyncSync(file);
		closeSync(file);
		file = undefined;
		renameSync(tempPath, path);
	} catch (error) {
		if (file !== undefined) {
			try {
				closeSync(file);
			} catch {}
		}
		try {
			unlinkSync(tempPath);
		} catch (cleanupError) {
			if (errorCode(cleanupError) !== "ENOENT") {
				// Preserve the persistence failure; the best-effort cleanup error is secondary.
			}
		}
		throw error;
	}
}

function mutateConfig(path: string, mutate: (record: ConfigRecord) => void): PolishedTuiConfig {
	const state = readConfigFileState(path);
	if (state.kind === "corrupt") {
		const detail = state.error instanceof Error ? ` (${state.error.message})` : "";
		throw new Error(
			`Refusing to save Zentui config because ${path} is corrupt or unreadable; fix or remove it first.${detail}`,
		);
	}
	mutate(state.record);
	writeConfigAtomically(
		state.writePath,
		state.record,
		state.kind === "valid" ? state.mode : undefined,
	);
	return mergeConfig(state.record);
}

export function ensureConfigExists(_path = configPath): void {
	// Intentionally left as a no-op. Zentui config is user-owned and
	// compatibility-sensitive: runtime defaults come from `mergeConfig({})`, and
	// the extension should not persist opinionated defaults unless the user
	// explicitly changes a setting.
}

function hasOwn(record: ConfigRecord, key: string): boolean {
	return Object.hasOwn(record, key);
}

function recordValue(value: unknown): ConfigRecord {
	return isRecord(value) ? value : {};
}

function resolvedValue(
	canonical: ConfigRecord,
	canonicalKey: string,
	legacy?: ConfigRecord,
	legacyKey = canonicalKey,
): unknown {
	if (hasOwn(canonical, canonicalKey)) return canonical[canonicalKey];
	if (legacy && hasOwn(legacy, legacyKey)) return legacy[legacyKey];
	return undefined;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function parseColorSource(value: unknown, fallback: ColorSource): ColorSource {
	return value === "theme" || value === "terminal" ? value : fallback;
}

function parseSelectorBorderStyle(value: unknown): SelectorBorderStyle {
	return value === "zentui" ? value : "zentui";
}

function parseFooterStyle(value: unknown): FooterStyle | undefined {
	return value === "native" || value === "starship" || value === "hidden" ? value : undefined;
}

function parseNonEmptyString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

function resolveContextThresholds(
	canonical: unknown,
	legacy: unknown,
	defaults: ContextThresholds,
): ContextThresholds {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return parseContextThresholds(
		{
			warning: resolvedValue(canonicalRecord, "warning", legacyRecord),
			error: resolvedValue(canonicalRecord, "error", legacyRecord),
		},
		defaults,
	);
}

function resolvePathDisplay(canonical: unknown, legacy: unknown): PathDisplayConfig {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return parsePathDisplay({
		mode: resolvedValue(canonicalRecord, "mode", legacyRecord),
		depth: resolvedValue(canonicalRecord, "depth", legacyRecord),
	});
}

function resolveGitBranch(canonical: unknown, legacy: unknown): GitBranchConfig {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return parseGitBranchConfig({
		maxLength: resolvedValue(canonicalRecord, "maxLength", legacyRecord),
	});
}

function resolveGitCommit(canonical: unknown, legacy: unknown): GitCommitConfig {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return normalizeGitCommitConfig({
		hashLength: resolvedValue(canonicalRecord, "hashLength", legacyRecord),
		onlyDetached: resolvedValue(canonicalRecord, "onlyDetached", legacyRecord),
		showTag: resolvedValue(canonicalRecord, "showTag", legacyRecord),
	});
}

function resolveGitMetrics(canonical: unknown, legacy: unknown): GitMetricsConfig {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return normalizeGitMetricsConfig({
		onlyNonzero: resolvedValue(canonicalRecord, "onlyNonzero", legacyRecord),
		ignoreSubmodules: resolvedValue(canonicalRecord, "ignoreSubmodules", legacyRecord),
	});
}

function resolveExtensionStatuses(canonical: unknown, legacy: unknown): ExtensionStatusesConfig {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return normalizeExtensionStatuses({
		defaultPlacement: resolvedValue(canonicalRecord, "defaultPlacement", legacyRecord),
		placements: resolvedValue(canonicalRecord, "placements", legacyRecord),
		colorModes: resolvedValue(canonicalRecord, "colorModes", legacyRecord),
	});
}

const FOOTER_SEGMENT_KEYS = Object.keys(defaultFooterSegments) as Array<keyof FooterSegmentsConfig>;

function resolveFooterSegments(canonical: unknown, legacy: unknown): FooterSegmentsConfig {
	const canonicalRecord = recordValue(canonical);
	const legacyRecord = recordValue(legacy);
	return Object.fromEntries(
		FOOTER_SEGMENT_KEYS.map((key) => [
			key,
			parseBoolean(resolvedValue(canonicalRecord, key, legacyRecord), defaultFooterSegments[key]),
		]),
	) as FooterSegmentsConfig;
}

function legacyCopyFriendly(record: ConfigRecord): boolean {
	return record.copyFriendly === true;
}

function resolveEditorStyle(
	editor: ConfigRecord,
	polished: ConfigRecord,
	features: ConfigRecord,
): EditorStyle {
	const rawStyle = editor.style;
	if (
		rawStyle === "opencode" ||
		rawStyle === "opencode-copy-friendly" ||
		rawStyle === "accent-rail" ||
		rawStyle === "minimalist"
	) {
		return rawStyle;
	}
	if (rawStyle === "polished-copy-friendly") return "opencode-copy-friendly";
	if (rawStyle === "polished") {
		return hasOwn(polished, "copyFriendly") && legacyCopyFriendly(polished)
			? "opencode-copy-friendly"
			: "opencode";
	}
	if (hasOwn(polished, "copyFriendly")) {
		return legacyCopyFriendly(polished) ? "opencode-copy-friendly" : "opencode";
	}
	return legacyCopyFriendly(features) ? "opencode-copy-friendly" : "opencode";
}

function resolveFooterStyle(footer: ConfigRecord, features: ConfigRecord): FooterStyle {
	const explicit = parseFooterStyle(footer.style);
	if (explicit) return explicit;
	if (typeof footer.enabled === "boolean") return footer.enabled ? "starship" : "native";
	if (typeof features.statusLine === "boolean") {
		return features.statusLine ? "starship" : "native";
	}
	return defaultComponents.footer.style;
}

function resolveUserMessagesSelection(
	userMessages: ConfigRecord,
	framed: ConfigRecord,
	features: ConfigRecord,
): Pick<UserMessagesComponentConfig, "enabled" | "style"> {
	const normalEnabled = parseBoolean(
		resolvedValue(userMessages, "enabled", features, "editor"),
		defaultComponents.userMessages.enabled,
	);
	const rawStyle = userMessages.style;
	if (rawStyle === "compact" || rawStyle === "labeled" || rawStyle === "framed-copy-friendly") {
		return { style: rawStyle, enabled: normalEnabled };
	}
	if (rawStyle === "framed" || hasOwn(framed, "copyFriendly")) {
		return {
			style: legacyCopyFriendly(framed) ? "framed-copy-friendly" : "framed",
			enabled: normalEnabled,
		};
	}
	return {
		style: legacyCopyFriendly(features) ? "framed-copy-friendly" : "framed",
		enabled: normalEnabled,
	};
}

function resolveWorkingLineMessages(messages: ConfigRecord): WorkingLineMessagesConfig {
	const preset = () => [...PI_WORKING_LINE_MESSAGES];
	const hasCanonicalCustom = hasOwn(messages, "custom");
	const custom = hasCanonicalCustom
		? parseBoolean(messages.custom, true)
		: messages.mode !== "native";
	if (hasCanonicalCustom) {
		return {
			custom,
			values: hasOwn(messages, "values") ? normalizeWorkingLineMessages(messages.values) : preset(),
		};
	}
	const legacyValues = normalizeWorkingLineMessages(messages.values);
	if (messages.mode === "append") {
		return { custom, values: normalizeWorkingLineMessages([...preset(), ...legacyValues]) };
	}
	if (messages.mode === "replace" || messages.mode === "native") {
		return { custom, values: legacyValues.length > 0 ? legacyValues : preset() };
	}
	return { custom, values: hasOwn(messages, "values") ? legacyValues : preset() };
}

function resolveComponents(config: ConfigRecord): ComponentsConfig {
	const components = recordValue(config.components);
	const editor = recordValue(components.editor);
	const editorStyles = recordValue(editor.styles);
	const opencode = recordValue(editorStyles.opencode);
	const polished = recordValue(editorStyles.polished);
	const opencodeCopyFriendly = recordValue(editorStyles["opencode-copy-friendly"]);
	const polishedCopyFriendly = recordValue(editorStyles["polished-copy-friendly"]);
	const accentRail = recordValue(editorStyles["accent-rail"]);
	const minimalist = recordValue(editorStyles.minimalist);
	const userMessages = recordValue(components.userMessages);
	const userMessageStyles = recordValue(userMessages.styles);
	const framed = recordValue(userMessageStyles.framed);
	const thinkingSteps = recordValue(components.thinkingSteps);
	const workingLine = recordValue(components.workingLine);
	const workingLineMessages = recordValue(workingLine.messages);
	const workingLineSegments = recordValue(workingLine.segments);
	const selectorBorders = recordValue(components.selectorBorders);
	const footer = recordValue(components.footer);
	const footerStyles = recordValue(footer.styles);
	const starship = recordValue(footerStyles.starship);
	const features = recordValue(config.features);
	const colorSources = recordValue(config.colorSources);

	const minimalistThresholds = resolveContextThresholds(
		minimalist.contextThresholds,
		config.contextThresholds,
		defaultMinimalistStyle.contextThresholds,
	);
	const footerThresholds = resolveContextThresholds(
		starship.contextThresholds,
		config.contextThresholds,
		defaultStarshipStyle.contextThresholds,
	);
	const compactFormat = resolvedValue(starship, "compactFormat", config, "compactFooterFormat");
	const metadataFormat = hasOwn(opencode, "metadataFormat")
		? opencode.metadataFormat
		: resolvedValue(polished, "metadataFormat", config, "editorMetadataFormat");
	const lowRailMetadataFormat = hasOwn(opencodeCopyFriendly, "metadataFormat")
		? opencodeCopyFriendly.metadataFormat
		: hasOwn(polishedCopyFriendly, "metadataFormat")
			? polishedCopyFriendly.metadataFormat
			: metadataFormat;
	const userMessagesSelection = resolveUserMessagesSelection(userMessages, framed, features);

	return {
		editor: {
			enabled: parseBoolean(
				resolvedValue(editor, "enabled", features, "editor"),
				defaultComponents.editor.enabled,
			),
			style: resolveEditorStyle(editor, polished, features),
			colorSource: parseColorSource(
				resolvedValue(editor, "colorSource", colorSources, "editor"),
				defaultComponents.editor.colorSource,
			),
			borderColorMode: parseEditorBorderColorMode(
				resolvedValue(editor, "borderColorMode", config, "editorBorderColorMode"),
			),
			modelLabel: parseEditorModelLabel(
				resolvedValue(editor, "modelLabel", config, "editorModelLabel"),
				defaultComponents.editor.modelLabel,
			),
			viewportIndicators: parseBoolean(
				resolvedValue(editor, "viewportIndicators", features, "viewportIndicators"),
				defaultComponents.editor.viewportIndicators,
			),
			styles: {
				opencode: {
					metadataFormat: parseNonEmptyString(metadataFormat, DEFAULT_EDITOR_METADATA_FORMAT),
					completionMenu: parseCompletionMenuStyle(opencode.completionMenu),
				},
				"opencode-copy-friendly": {
					metadataFormat: parseNonEmptyString(
						lowRailMetadataFormat,
						DEFAULT_EDITOR_METADATA_FORMAT,
					),
					completionMenu: parseCompletionMenuStyle(opencodeCopyFriendly.completionMenu),
				},
				"accent-rail": {
					rail: parseNonEmptyString(accentRail.rail, defaultAccentRailStyle.rail),
					asciiRail: parseNonEmptyString(accentRail.asciiRail, defaultAccentRailStyle.asciiRail),
					transparent: parseBoolean(accentRail.transparent, defaultAccentRailStyle.transparent),
				},
				minimalist: {
					pathDisplay:
						minimalist.pathDisplay === "compact" ||
						minimalist.pathDisplay === "project" ||
						minimalist.pathDisplay === "full"
							? minimalist.pathDisplay
							: defaultMinimalistStyle.pathDisplay,
					contextFormat:
						minimalist.contextFormat === "percent" || minimalist.contextFormat === "percent-total"
							? minimalist.contextFormat
							: defaultMinimalistStyle.contextFormat,
					contextGauge: parseBoolean(minimalist.contextGauge, defaultMinimalistStyle.contextGauge),
					showSessionName: parseBoolean(
						minimalist.showSessionName,
						defaultMinimalistStyle.showSessionName,
					),
					showTimer: parseBoolean(minimalist.showTimer, defaultMinimalistStyle.showTimer),
					showCost: parseBoolean(minimalist.showCost, defaultMinimalistStyle.showCost),
					showGit: parseBoolean(minimalist.showGit, defaultMinimalistStyle.showGit),
					contextThresholds: minimalistThresholds,
				},
			},
		},
		userMessages: {
			enabled: userMessagesSelection.enabled,
			style: userMessagesSelection.style,
			colorSource: parseColorSource(
				resolvedValue(userMessages, "colorSource", colorSources, "userMessages"),
				defaultComponents.userMessages.colorSource,
			),
			styles: {
				framed: {},
				"framed-copy-friendly": {},
				compact: {},
				labeled: {},
			},
		},
		thinkingSteps: {
			enabled: parseBoolean(thinkingSteps.enabled, defaultComponents.thinkingSteps.enabled),
			mode:
				thinkingSteps.mode === "rail" || thinkingSteps.mode === "tree"
					? thinkingSteps.mode
					: thinkingSteps.mode === "streaming" || thinkingSteps.mode === "streaming-experimental"
						? "streaming"
						: defaultComponents.thinkingSteps.mode,
		},
		workingLine: {
			enabled: parseBoolean(workingLine.enabled, defaultComponents.workingLine.enabled),
			turnSummary: parseBoolean(workingLine.turnSummary, defaultComponents.workingLine.turnSummary),
			spinner:
				workingLine.spinner === "braille" ||
				workingLine.spinner === "star-bloom" ||
				workingLine.spinner === "pinwheel" ||
				workingLine.spinner === "claude-inspired" ||
				workingLine.spinner === "pulse"
					? workingLine.spinner
					: defaultComponents.workingLine.spinner,
			spinnerIntervalMs: isValidWorkingLineIntervalMs(
				resolvedValue(workingLine, "spinnerIntervalMs", workingLine, "intervalMs"),
			)
				? (resolvedValue(workingLine, "spinnerIntervalMs", workingLine, "intervalMs") as number)
				: defaultComponents.workingLine.spinnerIntervalMs,
			animateSpinnerColor: parseBoolean(
				workingLine.animateSpinnerColor,
				defaultComponents.workingLine.animateSpinnerColor,
			),
			textIntervalMs: isValidWorkingLineIntervalMs(workingLine.textIntervalMs)
				? workingLine.textIntervalMs
				: defaultComponents.workingLine.textIntervalMs,
			textAnimation:
				workingLine.textAnimation === "classic" ||
				workingLine.textAnimation === "kitt" ||
				workingLine.textAnimation === "disabled"
					? workingLine.textAnimation
					: defaultComponents.workingLine.textAnimation,
			colorSource: parseColorSource(
				workingLine.colorSource,
				defaultComponents.workingLine.colorSource,
			),
			messages: resolveWorkingLineMessages(workingLineMessages),
			segments: {
				tool: parseBoolean(workingLineSegments.tool, defaultComponents.workingLine.segments.tool),
				elapsed: parseBoolean(
					workingLineSegments.elapsed,
					defaultComponents.workingLine.segments.elapsed,
				),
				thought: parseBoolean(
					workingLineSegments.thought,
					defaultComponents.workingLine.segments.thought,
				),
				tokens: parseBoolean(
					workingLineSegments.tokens,
					defaultComponents.workingLine.segments.tokens,
				),
			},
		},
		selectorBorders: {
			enabled: parseBoolean(
				resolvedValue(selectorBorders, "enabled", features, "editor"),
				defaultComponents.selectorBorders.enabled,
			),
			style: parseSelectorBorderStyle(resolvedValue(selectorBorders, "style")),
			colorSource: parseColorSource(
				resolvedValue(selectorBorders, "colorSource", colorSources, "editor"),
				defaultComponents.selectorBorders.colorSource,
			),
		},
		footer: {
			style: resolveFooterStyle(footer, features),
			colorSource: parseColorSource(
				resolvedValue(footer, "colorSource", colorSources, "starship"),
				defaultComponents.footer.colorSource,
			),
			modelLabel: parseEditorModelLabel(
				resolvedValue(footer, "modelLabel", config, "editorModelLabel"),
				defaultComponents.footer.modelLabel,
			),
			styles: {
				starship: {
					format:
						typeof resolvedValue(starship, "format", config, "footerFormat") === "string"
							? (resolvedValue(starship, "format", config, "footerFormat") as string)
							: defaultStarshipStyle.format,
					responsive: parseBoolean(
						resolvedValue(starship, "responsive", config, "responsiveFooter"),
						defaultStarshipStyle.responsive,
					),
					compactFormat: parseNonEmptyString(compactFormat, defaultStarshipStyle.compactFormat),
					compactMaxLines: parseCompactFooterMaxLines(
						resolvedValue(starship, "compactMaxLines", config, "compactFooterMaxLines"),
					),
					separator: parseSeparatorStyle(resolvedValue(starship, "separator", config, "separator")),
					contextStyle: parseContextStyle(
						resolvedValue(starship, "contextStyle", config, "contextStyle"),
					),
					contextThresholds: footerThresholds,
					pathDisplay: resolvePathDisplay(starship.pathDisplay, config.pathDisplay),
					segments: resolveFooterSegments(starship.segments, config.footerSegments),
					gitBranch: resolveGitBranch(starship.gitBranch, config.gitBranch),
					gitCommit: resolveGitCommit(starship.gitCommit, config.gitCommit),
					gitMetrics: resolveGitMetrics(starship.gitMetrics, config.gitMetrics),
					extensionStatuses: resolveExtensionStatuses(
						starship.extensionStatuses,
						config.extensionStatuses,
					),
				},
			},
		},
	};
}

function compatibilityView(config: ZentuiConfig): PolishedTuiConfig {
	const starship = config.components.footer.styles.starship;
	const minimalist = config.components.editor.styles.minimalist;
	return {
		...config,
		footerFormat: starship.format,
		responsiveFooter: starship.responsive,
		compactFooterFormat: starship.compactFormat,
		compactFooterMaxLines: starship.compactMaxLines,
		separator: starship.separator,
		contextStyle: starship.contextStyle,
		contextThresholds: starship.contextThresholds,
		pathDisplay: starship.pathDisplay,
		gitBranch: starship.gitBranch,
		footerSegments: starship.segments,
		gitCommit: starship.gitCommit,
		gitMetrics: starship.gitMetrics,
		extensionStatuses: starship.extensionStatuses,
		editorStyle: config.components.editor.style,
		editorStyles: { minimalist },
		editorMetadataFormat: config.components.editor.styles.opencode.metadataFormat,
		editorBorderColorMode: config.components.editor.borderColorMode,
		editorModelLabel: config.components.editor.modelLabel,
		colorSources: {
			starship: config.components.footer.colorSource,
			editor: config.components.editor.colorSource,
			userMessages: config.components.userMessages.colorSource,
		},
		features: {
			editor: config.components.editor.enabled,
			statusLine: config.components.footer.style === "starship",
			viewportIndicators: config.components.editor.viewportIndicators,
		},
	};
}

const unsupportedComponentStyles = new WeakMap<ZentuiConfig, ReadonlySet<ComponentStyleOwner>>();

const knownComponentStyleIds: Record<ComponentStyleOwner, ReadonlySet<string>> = {
	editor: new Set([
		"opencode",
		"opencode-copy-friendly",
		"accent-rail",
		"minimalist",
		"polished",
		"polished-copy-friendly",
	]),
	userMessages: new Set(["framed", "framed-copy-friendly", "compact", "labeled"]),
	selectorBorders: new Set(["zentui"]),
	footer: new Set(["native", "starship", "hidden"]),
};

function unsupportedSelectedStyleId(
	record: ConfigRecord,
	owner: ComponentStyleOwner,
): string | undefined {
	const component = recordValue(recordValue(record.components)[owner]);
	if (!hasOwn(component, "style")) return undefined;
	const style = component.style;
	return typeof style === "string" && style.trim() && !knownComponentStyleIds[owner].has(style)
		? style
		: undefined;
}

export function hasUnsupportedComponentStyle(
	config: ZentuiConfig,
	owner: ComponentStyleOwner,
): boolean {
	return unsupportedComponentStyles.get(config)?.has(owner) ?? false;
}

export function mergeConfig(parsed: unknown): PolishedTuiConfig {
	const config = isRecord(parsed) ? parsed : {};
	const iconsRecord = recordValue(config.icons);
	const colorsRecord = recordValue(config.colors);
	const colors = normalizeColors(colorsRecord);
	const canonical: ZentuiConfig = {
		projectRefreshIntervalMs: parseProjectRefreshIntervalMs(config.projectRefreshIntervalMs),
		icons: resolveConfiguredIcons(
			normalizeIconMode(iconsRecord.mode),
			normalizeIconOverrides(iconsRecord),
		),
		colors: {
			...defaultConfig.colors,
			...colors,
			...(colors.editorGitBranch === undefined && colors.gitBranch !== undefined
				? { editorGitBranch: colors.gitBranch }
				: {}),
		},
		components: resolveComponents(config),
	};
	const view = compatibilityView(canonical);
	const unsupported = new Set<ComponentStyleOwner>();
	for (const owner of ["editor", "userMessages", "selectorBorders", "footer"] as const) {
		if (unsupportedSelectedStyleId(config, owner) !== undefined) unsupported.add(owner);
	}
	if (unsupported.size > 0) unsupportedComponentStyles.set(view, unsupported);
	return view;
}

export function getExtensionStatusPlacement(
	config: ZentuiConfig,
	key: string,
): ExtensionStatusPlacement {
	const statuses = config.components.footer.styles.starship.extensionStatuses;
	if (Object.hasOwn(statuses.placements, key)) {
		const placement = statuses.placements[key];
		if (isExtensionStatusPlacement(placement)) return placement;
	}
	return isExtensionStatusPlacement(statuses.defaultPlacement)
		? statuses.defaultPlacement
		: DEFAULT_EXTENSION_STATUS_PLACEMENT;
}

export function getExtensionStatusColorMode(
	config: ZentuiConfig,
	key: string,
): ExtensionStatusColorMode {
	const colorModes = config.components.footer.styles.starship.extensionStatuses.colorModes;
	if (Object.hasOwn(colorModes, key)) {
		const colorMode = colorModes[key];
		if (isExtensionStatusColorMode(colorMode)) return colorMode;
	}
	return DEFAULT_EXTENSION_STATUS_COLOR_MODE;
}

export function loadConfig(): PolishedTuiConfig {
	try {
		if (!existsSync(configPath)) return mergeConfig({});
		return mergeConfig(JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		return mergeConfig({});
	}
}

function overlayKnown(raw: unknown, known: unknown): unknown {
	if (!isRecord(known)) return known;
	const output: ConfigRecord = isRecord(raw) ? { ...raw } : {};
	for (const [key, value] of Object.entries(known)) {
		Object.defineProperty(output, key, {
			value: overlayKnown(output[key], value),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return output;
}

type PreservedStyleIds = Partial<Record<ComponentStyleOwner, string>>;

function unknownSelectedStyleIds(record: ConfigRecord): PreservedStyleIds {
	return {
		editor: unsupportedSelectedStyleId(record, "editor"),
		userMessages: unsupportedSelectedStyleId(record, "userMessages"),
		selectorBorders: unsupportedSelectedStyleId(record, "selectorBorders"),
		footer: unsupportedSelectedStyleId(record, "footer"),
	};
}

function restoreUnknownSelectedStyleIds(
	record: ConfigRecord,
	preserved: PreservedStyleIds,
	replacedStyle?: ComponentStyleOwner,
): void {
	const components = recordValue(record.components);
	for (const [owner, style] of Object.entries(preserved) as [ComponentStyleOwner, string][]) {
		if (style === undefined || owner === replacedStyle) continue;
		const component = recordValue(components[owner]);
		component.style = style;
		components[owner] = component;
	}
	record.components = components;
}

function saveComponentsMutation(
	update: (components: ComponentsConfig) => void,
	path: string,
	cleanupRaw?: (record: ConfigRecord) => void,
	replacedStyle?: ComponentStyleOwner,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const preservedStyles = unknownSelectedStyleIds(record);
		const components = mergeConfig(record).components;
		update(components);
		const normalized = resolveComponents({ components });
		record.components = overlayKnown(record.components, normalized);
		restoreUnknownSelectedStyleIds(record, preservedStyles, replacedStyle);
		cleanupRaw?.(record);
	});
}

function deleteLegacyEditorCopyFriendly(record: ConfigRecord): void {
	const components = record.components;
	if (!isRecord(components)) return;
	const editor = components.editor;
	if (!isRecord(editor)) return;
	const styles = editor.styles;
	if (!isRecord(styles)) return;
	const polished = styles.polished;
	if (isRecord(polished)) delete polished.copyFriendly;
}

function deleteLegacyFooterEnabled(record: ConfigRecord): void {
	const components = record.components;
	if (!isRecord(components)) return;
	const footer = components.footer;
	if (isRecord(footer)) delete footer.enabled;
}

function deleteLegacyMessageCopyFriendly(record: ConfigRecord): void {
	const components = record.components;
	if (!isRecord(components)) return;
	const userMessages = components.userMessages;
	if (!isRecord(userMessages)) return;
	const styles = userMessages.styles;
	if (!isRecord(styles)) return;
	const framed = styles.framed;
	if (isRecord(framed)) delete framed.copyFriendly;
}

function applyEditorComponentPatch(
	component: EditorComponentConfig,
	patch: Partial<
		Pick<
			EditorComponentConfig,
			"enabled" | "style" | "colorSource" | "borderColorMode" | "modelLabel" | "viewportIndicators"
		>
	>,
): void {
	if (patch.enabled !== undefined) component.enabled = patch.enabled;
	if (patch.style !== undefined) component.style = patch.style;
	if (patch.colorSource !== undefined) component.colorSource = patch.colorSource;
	if (patch.borderColorMode !== undefined) component.borderColorMode = patch.borderColorMode;
	if (patch.modelLabel !== undefined) component.modelLabel = patch.modelLabel;
	if (patch.viewportIndicators !== undefined) {
		component.viewportIndicators = patch.viewportIndicators;
	}
}

export function saveEditorComponentPatch(
	patch: Partial<
		Pick<
			EditorComponentConfig,
			"enabled" | "style" | "colorSource" | "borderColorMode" | "modelLabel" | "viewportIndicators"
		>
	>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => applyEditorComponentPatch(components.editor, patch),
		path,
		patch.style !== undefined ? deleteLegacyEditorCopyFriendly : undefined,
		patch.style !== undefined ? "editor" : undefined,
	);
}

export function savePolishedEditorStylePatch(
	patch: Partial<PolishedEditorStyleConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		const style = components.editor.styles.opencode;
		if (patch.metadataFormat !== undefined) style.metadataFormat = patch.metadataFormat;
		if (patch.completionMenu !== undefined) style.completionMenu = patch.completionMenu;
	}, path);
}

export function savePolishedCopyFriendlyEditorStylePatch(
	patch: Partial<PolishedCopyFriendlyEditorStyleConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		const style = components.editor.styles["opencode-copy-friendly"];
		if (patch.metadataFormat !== undefined) style.metadataFormat = patch.metadataFormat;
		if (patch.completionMenu !== undefined) style.completionMenu = patch.completionMenu;
	}, path);
}

export function saveAccentRailEditorStylePatch(
	patch: Partial<AccentRailEditorStyleConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		const style = components.editor.styles["accent-rail"];
		if (patch.rail !== undefined) style.rail = patch.rail;
		if (patch.asciiRail !== undefined) style.asciiRail = patch.asciiRail;
		if (patch.transparent !== undefined) style.transparent = patch.transparent;
	}, path);
}

function applyMinimalistStylePatch(
	style: MinimalistEditorStyleConfig,
	patch: Partial<MinimalistEditorStyleConfig>,
): void {
	if (patch.pathDisplay !== undefined) style.pathDisplay = patch.pathDisplay;
	if (patch.contextFormat !== undefined) style.contextFormat = patch.contextFormat;
	if (patch.contextGauge !== undefined) style.contextGauge = patch.contextGauge;
	if (patch.showSessionName !== undefined) style.showSessionName = patch.showSessionName;
	if (patch.showTimer !== undefined) style.showTimer = patch.showTimer;
	if (patch.showCost !== undefined) style.showCost = patch.showCost;
	if (patch.showGit !== undefined) style.showGit = patch.showGit;
	if (patch.contextThresholds !== undefined) {
		style.contextThresholds = { ...style.contextThresholds, ...patch.contextThresholds };
	}
}

export function saveMinimalistEditorStylePatch(
	patch: Partial<MinimalistEditorStyleConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => applyMinimalistStylePatch(components.editor.styles.minimalist, patch),
		path,
	);
}

export function saveUserMessagesComponentPatch(
	patch: Partial<Pick<UserMessagesComponentConfig, "enabled" | "style" | "colorSource">>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => {
			const component = components.userMessages;
			if (patch.enabled !== undefined) component.enabled = patch.enabled;
			if (patch.style !== undefined) component.style = patch.style;
			if (patch.colorSource !== undefined) component.colorSource = patch.colorSource;
		},
		path,
		patch.style !== undefined ? deleteLegacyMessageCopyFriendly : undefined,
		patch.style !== undefined ? "userMessages" : undefined,
	);
}

export function saveThinkingStepsComponentPatch(
	patch: Partial<ThinkingStepsComponentConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		const component = components.thinkingSteps;
		if (patch.enabled !== undefined) component.enabled = patch.enabled;
		if (patch.mode !== undefined) component.mode = patch.mode;
	}, path);
}

export function saveWorkingLineComponentPatch(
	patch: WorkingLineComponentPatch,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => {
			const component = components.workingLine;
			if (patch.enabled !== undefined) component.enabled = patch.enabled;
			if (patch.turnSummary !== undefined) component.turnSummary = patch.turnSummary;
			if (patch.spinner !== undefined) component.spinner = patch.spinner;
			if (patch.spinnerIntervalMs !== undefined)
				component.spinnerIntervalMs = patch.spinnerIntervalMs;
			if (patch.animateSpinnerColor !== undefined)
				component.animateSpinnerColor = patch.animateSpinnerColor;
			if (patch.textIntervalMs !== undefined) component.textIntervalMs = patch.textIntervalMs;
			if (patch.textAnimation !== undefined) component.textAnimation = patch.textAnimation;
			if (patch.colorSource !== undefined) component.colorSource = patch.colorSource;
			if (patch.messages?.custom !== undefined) component.messages.custom = patch.messages.custom;
			if (patch.messages?.values !== undefined) {
				component.messages.values = normalizeWorkingLineMessages([...patch.messages.values]);
			}
			if (patch.segments?.tool !== undefined) component.segments.tool = patch.segments.tool;
			if (patch.segments?.elapsed !== undefined)
				component.segments.elapsed = patch.segments.elapsed;
			if (patch.segments?.thought !== undefined)
				component.segments.thought = patch.segments.thought;
			if (patch.segments?.tokens !== undefined) component.segments.tokens = patch.segments.tokens;
		},
		path,
		(record) => {
			const workingLine = recordValue(recordValue(record.components).workingLine);
			delete workingLine.intervalMs;
			const messages = recordValue(workingLine.messages);
			delete messages.mode;
		},
	);
}

export function saveSelectorBordersComponentPatch(
	patch: Partial<SelectorBordersComponentConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => {
			const component = components.selectorBorders;
			if (patch.enabled !== undefined) component.enabled = patch.enabled;
			if (patch.style !== undefined) component.style = patch.style;
			if (patch.colorSource !== undefined) component.colorSource = patch.colorSource;
		},
		path,
		undefined,
		patch.style !== undefined ? "selectorBorders" : undefined,
	);
}

export function saveFooterComponentPatch(
	patch: Partial<Pick<FooterComponentConfig, "style" | "colorSource" | "modelLabel">>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => {
			const component = components.footer;
			if (patch.style !== undefined) component.style = patch.style;
			if (patch.colorSource !== undefined) component.colorSource = patch.colorSource;
			if (patch.modelLabel !== undefined) component.modelLabel = patch.modelLabel;
		},
		path,
		patch.style !== undefined ? deleteLegacyFooterEnabled : undefined,
		patch.style !== undefined ? "footer" : undefined,
	);
}

function applyStarshipStylePatch(
	style: StarshipFooterStyleConfig,
	patch: Partial<StarshipFooterStyleConfig>,
): void {
	if (patch.format !== undefined) style.format = patch.format;
	if (patch.responsive !== undefined) style.responsive = patch.responsive;
	if (patch.compactFormat !== undefined) style.compactFormat = patch.compactFormat;
	if (patch.compactMaxLines !== undefined) style.compactMaxLines = patch.compactMaxLines;
	if (patch.separator !== undefined) style.separator = patch.separator;
	if (patch.contextStyle !== undefined) style.contextStyle = patch.contextStyle;
	if (patch.contextThresholds !== undefined) {
		style.contextThresholds = { ...style.contextThresholds, ...patch.contextThresholds };
	}
	if (patch.pathDisplay !== undefined) {
		style.pathDisplay = { ...style.pathDisplay, ...patch.pathDisplay };
	}
	if (patch.segments !== undefined) style.segments = { ...style.segments, ...patch.segments };
	if (patch.gitBranch !== undefined) style.gitBranch = { ...style.gitBranch, ...patch.gitBranch };
	if (patch.gitCommit !== undefined) style.gitCommit = { ...style.gitCommit, ...patch.gitCommit };
	if (patch.gitMetrics !== undefined)
		style.gitMetrics = { ...style.gitMetrics, ...patch.gitMetrics };
	if (patch.extensionStatuses !== undefined) {
		style.extensionStatuses = {
			...style.extensionStatuses,
			...patch.extensionStatuses,
			placements: {
				...style.extensionStatuses.placements,
				...patch.extensionStatuses.placements,
			},
			colorModes: {
				...style.extensionStatuses.colorModes,
				...patch.extensionStatuses.colorModes,
			},
		};
	}
}

export function saveStarshipFooterStylePatch(
	patch: Partial<StarshipFooterStyleConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation(
		(components) => applyStarshipStylePatch(components.footer.styles.starship, patch),
		path,
	);
}

export function saveColorSourcesPatch(
	patch: Partial<ColorSourcesConfig>,
	path = configPath,
): PolishedTuiConfig {
	const valid = validColorSourceEntries(patch);
	return saveComponentsMutation((components) => {
		if (valid.starship !== undefined) components.footer.colorSource = valid.starship;
		if (valid.editor !== undefined) {
			components.editor.colorSource = valid.editor;
			components.selectorBorders.colorSource = valid.editor;
		}
		if (valid.userMessages !== undefined) {
			components.userMessages.colorSource = valid.userMessages;
		}
	}, path);
}

export function saveUiFeaturesPatch(
	patch: Partial<UiFeaturesConfig>,
	path = configPath,
): PolishedTuiConfig {
	const valid = validUiFeatureEntries(patch);
	return saveComponentsMutation(
		(components) => {
			if (valid.editor !== undefined) {
				components.editor.enabled = valid.editor;
				components.userMessages.enabled = valid.editor;
				components.selectorBorders.enabled = valid.editor;
			}
			if (valid.statusLine !== undefined) {
				components.footer.style = valid.statusLine ? "starship" : "native";
			}
			if (valid.viewportIndicators !== undefined) {
				components.editor.viewportIndicators = valid.viewportIndicators;
			}
		},
		path,
		valid.statusLine !== undefined ? deleteLegacyFooterEnabled : undefined,
		valid.statusLine !== undefined ? "footer" : undefined,
	);
}

export function saveFooterSegmentsPatch(
	patch: Partial<FooterSegmentsConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveStarshipFooterStylePatch(
		{ segments: validFooterSegmentEntries(patch) as FooterSegmentsConfig },
		path,
	);
}

export function saveFooterFormatPatch(value: string, path = configPath): PolishedTuiConfig {
	return saveStarshipFooterStylePatch({ format: typeof value === "string" ? value : "" }, path);
}

export function saveResponsiveFooterPatch(
	patch: Partial<
		Pick<PolishedTuiConfig, "responsiveFooter" | "compactFooterFormat" | "compactFooterMaxLines">
	>,
	path = configPath,
): PolishedTuiConfig {
	const canonical: Partial<StarshipFooterStyleConfig> = {};
	if (typeof patch.responsiveFooter === "boolean") canonical.responsive = patch.responsiveFooter;
	if (typeof patch.compactFooterFormat === "string")
		canonical.compactFormat = patch.compactFooterFormat;
	if (patch.compactFooterMaxLines !== undefined) {
		canonical.compactMaxLines = parseCompactFooterMaxLines(patch.compactFooterMaxLines);
	}
	return saveStarshipFooterStylePatch(canonical, path);
}

export function saveIconsModePatch(mode: IconMode, path = configPath): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.icons) ? { ...record.icons } : {};
		record.icons = { ...existing, mode: normalizeIconMode(mode) };
	});
}

export function saveContextStylePatch(style: ContextStyle, path = configPath): PolishedTuiConfig {
	return saveStarshipFooterStylePatch({ contextStyle: parseContextStyle(style) }, path);
}

export function saveSeparatorPatch(
	separator: SeparatorStyle,
	path = configPath,
): PolishedTuiConfig {
	return saveStarshipFooterStylePatch({ separator: parseSeparatorStyle(separator) }, path);
}

export function saveContextThresholdsPatch(
	thresholds: Partial<ContextThresholds>,
	path = configPath,
): PolishedTuiConfig {
	if (typeof thresholds.warning === "bigint" || typeof thresholds.error === "bigint") {
		throw new TypeError("Context thresholds must be JSON-serializable numbers");
	}
	return saveComponentsMutation((components) => {
		components.editor.styles.minimalist.contextThresholds = {
			...components.editor.styles.minimalist.contextThresholds,
			...thresholds,
		};
		components.footer.styles.starship.contextThresholds = {
			...components.footer.styles.starship.contextThresholds,
			...thresholds,
		};
	}, path);
}

export function savePathDisplayPatch(
	patch: Partial<PathDisplayConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		components.footer.styles.starship.pathDisplay = {
			...components.footer.styles.starship.pathDisplay,
			...patch,
		};
	}, path);
}

export function saveGitBranchPatch(
	patch: Partial<GitBranchConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		components.footer.styles.starship.gitBranch = {
			...components.footer.styles.starship.gitBranch,
			...patch,
		};
	}, path);
}

export function saveEditorModelLabel(
	value: ModelLabelSource,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		const normalized = parseEditorModelLabel(value);
		components.editor.modelLabel = normalized;
		components.footer.modelLabel = normalized;
	}, path);
}

export function saveEditorStyle(value: EditorStyle, path = configPath): PolishedTuiConfig {
	return saveEditorComponentPatch({ style: parseEditorStyle(value) }, path);
}

export function saveMinimalistPatch(
	patch: Partial<MinimalistConfig>,
	path = configPath,
): PolishedTuiConfig {
	return saveMinimalistEditorStylePatch(patch, path);
}

export function saveEditorBorderColorMode(
	value: EditorBorderColorMode,
	path = configPath,
): PolishedTuiConfig {
	return saveEditorComponentPatch({ borderColorMode: parseEditorBorderColorMode(value) }, path);
}

export function saveGitCommitPatch(
	patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
	path = configPath,
): PolishedTuiConfig {
	const valid: Partial<GitCommitConfig> = {};
	if (typeof patch.onlyDetached === "boolean") valid.onlyDetached = patch.onlyDetached;
	if (typeof patch.showTag === "boolean") valid.showTag = patch.showTag;
	return saveComponentsMutation((components) => {
		components.footer.styles.starship.gitCommit = {
			...components.footer.styles.starship.gitCommit,
			...valid,
		};
	}, path);
}

export function saveGitMetricsPatch(
	patch: Partial<GitMetricsConfig>,
	path = configPath,
): PolishedTuiConfig {
	const valid: Partial<GitMetricsConfig> = {};
	if (typeof patch.onlyNonzero === "boolean") valid.onlyNonzero = patch.onlyNonzero;
	if (typeof patch.ignoreSubmodules === "boolean") valid.ignoreSubmodules = patch.ignoreSubmodules;
	return saveComponentsMutation((components) => {
		components.footer.styles.starship.gitMetrics = {
			...components.footer.styles.starship.gitMetrics,
			...valid,
		};
	}, path);
}

export function saveExtensionStatusDefaultPlacement(
	placement: ExtensionStatusPlacement,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		components.footer.styles.starship.extensionStatuses.defaultPlacement =
			isExtensionStatusPlacement(placement)
				? placement
				: defaultConfig.extensionStatuses.defaultPlacement;
	}, path);
}

export function saveExtensionStatusPlacement(
	key: string,
	placement: ExtensionStatusPlacement,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		Object.defineProperty(components.footer.styles.starship.extensionStatuses.placements, key, {
			value: placement,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}, path);
}

export function saveExtensionStatusColorMode(
	key: string,
	colorMode: ExtensionStatusColorMode,
	path = configPath,
): PolishedTuiConfig {
	return saveComponentsMutation((components) => {
		Object.defineProperty(components.footer.styles.starship.extensionStatuses.colorModes, key, {
			value: colorMode,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}, path);
}
