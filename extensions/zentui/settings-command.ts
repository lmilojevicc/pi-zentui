import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	type AccentRailEditorStyleConfig,
	type ColorSource,
	type CompactFooterMaxLines,
	type CompletionMenuStyle,
	type ContextStyle,
	type EditorBorderColorMode,
	type EditorComponentConfig,
	type EditorStyle,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	type FooterComponentConfig,
	type FooterSegmentsConfig,
	type FooterStyle,
	type GitBranchConfig,
	type GitBranchMaxLength,
	type GitCommitConfig,
	type GitMetricsConfig,
	getExtensionStatusColorMode,
	getExtensionStatusPlacement,
	type IconMode,
	isExtensionStatusColorMode,
	isExtensionStatusPlacement,
	isSeparatorStyle,
	isValidWorkingLineIntervalMs,
	MAX_WORKING_LINE_INTERVAL_MS,
	MIN_WORKING_LINE_INTERVAL_MS,
	type MinimalistConfig,
	type ModelLabelSource,
	type PathDisplayConfig,
	type PolishedCopyFriendlyEditorStyleConfig,
	type PolishedEditorStyleConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type SeparatorStyle,
	type ThinkingStepsComponentConfig,
	type ThinkingStepsMode,
	type UserMessageStyle,
	type UserMessagesComponentConfig,
	type WorkingLineComponentPatch,
	type WorkingLineSpinner,
	type WorkingLineTextAnimation,
} from "./config";
import { sanitizeExtensionStatusText } from "./extension-status";
import { isIconMode } from "./icons";
import type { SessionLifecycle } from "./session-lifecycle";
import {
	renderEditorSettingsPreview,
	renderThinkingStepsSettingsPreview,
	renderUserMessageSettingsPreview,
	SETTINGS_PREVIEW_MAX_WIDTH,
} from "./settings-previews";
import { EDITOR_BORDER_STYLE, renderChromeBorder, safeThemeFg } from "./style";
import {
	buildWorkingLinePreviewFrames,
	normalizeWorkingLineMessages,
	remapWorkingLineTextTick,
	type WorkingLineFrames,
} from "./working-line";

const colorSourceValues: ColorSource[] = ["theme", "terminal"];
const extensionStatusPlacementValues: ExtensionStatusPlacement[] = [
	"off",
	"left",
	"middle",
	"right",
];
const extensionStatusColorModeValues: ExtensionStatusColorMode[] = ["zentui", "original"];
const contextStyleValues: ContextStyle[] = ["text", "gauge", "text+gauge"];
const separatorStyleValues: SeparatorStyle[] = ["pipe", "dot", "chevron", "none"];
const pathDisplayModeValues: PathDisplayConfig["mode"][] = ["basename", "repository", "full"];
const pathDepthValues = ["0", "1", "2", "3", "4", "5"];
const branchLengthPresetValues = ["full", "10", "20", "30", "40", "50"];
const iconModeValues: IconMode[] = ["auto", "nerd", "ascii"];
const modelLabelValues: ModelLabelSource[] = ["id", "name"];
const editorStyleLabels: Record<EditorStyle, string> = {
	opencode: "Opencode",
	"opencode-copy-friendly": "Opencode (copy-friendly)",
	"accent-rail": "Accent Rail",
	minimalist: "Minimalist",
};
const editorStyleValues = Object.values(editorStyleLabels);
const userMessageStyleLabels: Record<UserMessageStyle, string> = {
	framed: "Framed",
	"framed-copy-friendly": "Framed (copy-friendly)",
	compact: "Compact",
	labeled: "Labeled",
};
const userMessageStyleValues = Object.values(userMessageStyleLabels);
const footerStyleLabels: Record<FooterStyle, string> = {
	native: "Native",
	starship: "Starship",
	hidden: "Hidden",
};
const footerStyleValues = Object.values(footerStyleLabels);
const completionMenuValues: CompletionMenuStyle[] = ["palette", "native"];
const accentRailSurfaceValues = ["filled", "transparent"];
const minimalistPathDisplayValues = ["compact", "project", "full"];
const minimalistContextFormatValues = ["percent", "percent-total"];
const editorBorderColorModeValues: EditorBorderColorMode[] = ["static", "adaptive"];
const compactFooterMaxLineValues = ["1", "2", "3", "unlimited"];
const featureStateValues: FeatureState[] = ["enabled", "disabled"];
const workingLineSpinnerLabels: Record<WorkingLineSpinner, string> = {
	braille: "Braille Orbit",
	"star-bloom": "Star Bloom",
	pinwheel: "ASCII Pinwheel",
	"claude-inspired": "Claude-inspired",
	pulse: "Pulse",
};
const workingLineSpinnerValues = Object.values(workingLineSpinnerLabels);
const workingLineSpinnerSpeedPresets = [
	{ label: "Fast 60 ms", intervalMs: 60 },
	{ label: "Normal 100 ms", intervalMs: 100 },
	{ label: "Slow 160 ms", intervalMs: 160 },
] as const;
const workingLineTextSpeedPresets = [
	{ label: "Fast 40 ms", intervalMs: 40 },
	{ label: "Normal 60 ms", intervalMs: 60 },
	{ label: "Slow 100 ms", intervalMs: 100 },
] as const;
const speedValues = (presets: readonly { label: string }[]) => [
	...presets.map(({ label }) => label),
	"Custom…",
];
const workingLineTextAnimationValues: WorkingLineTextAnimation[] = ["classic", "kitt", "disabled"];
const thinkingStepsModeLabels: Record<ThinkingStepsMode, string> = {
	rail: "Rail",
	tree: "Tree",
	streaming: "Streaming",
};
const thinkingStepsModeValues = Object.values(thinkingStepsModeLabels);

const settingsSections = [
	"appearance",
	"editor",
	"userMessages",
	"thinkingSteps",
	"workingLine",
	"footer",
	"segments",
	"git",
	"extensions",
] as const;

type FeatureState = "enabled" | "disabled";
type SettingsSection = (typeof settingsSections)[number];
type FooterSegmentSettingId = keyof FooterSegmentsConfig;
type EditorPatch = Partial<
	Pick<
		EditorComponentConfig,
		"enabled" | "style" | "colorSource" | "borderColorMode" | "modelLabel" | "viewportIndicators"
	>
>;
type UserMessagesPatch = Partial<
	Pick<UserMessagesComponentConfig, "enabled" | "style" | "colorSource">
>;
type FooterPatch = Partial<Pick<FooterComponentConfig, "style" | "colorSource" | "modelLabel">>;
type ApplyResult = { applied: boolean; reason?: string };
type SettingsOutcome =
	| "close"
	| "edit-working-line-messages"
	| "edit-working-line-spinner-speed"
	| "edit-working-line-text-speed";

type ThinkingControllerState = Readonly<{
	available: boolean;
	active: boolean;
	activeMode?: ThinkingStepsMode;
	startup: Readonly<ThinkingStepsComponentConfig>;
	displaced: boolean;
	restartRequired: boolean;
	reason?: string;
}>;

type ThinkingStepsSettingsCapability =
	| Readonly<{ available: boolean }>
	| Readonly<{ readonly state: ThinkingControllerState }>;

function experimentalThinkingCapability(
	capability: ThinkingStepsSettingsCapability,
): ThinkingControllerState {
	return "state" in capability
		? capability.state
		: {
				available: capability.available,
				active: false,
				startup: { enabled: false, mode: "tree" },
				displaced: false,
				restartRequired: false,
			};
}

type SettingsCommandDeps = {
	sessionLifecycle: SessionLifecycle;
	getConfig: () => PolishedTuiConfig;
	setEditorComponent: (patch: EditorPatch, ctx: ExtensionContext) => ApplyResult;
	setPolished: (patch: Partial<PolishedEditorStyleConfig>, ctx: ExtensionContext) => void;
	setPolishedCopyFriendly: (
		patch: Partial<PolishedCopyFriendlyEditorStyleConfig>,
		ctx: ExtensionContext,
	) => void;
	setAccentRail: (patch: Partial<AccentRailEditorStyleConfig>, ctx: ExtensionContext) => void;
	setMinimalist: (patch: Partial<MinimalistConfig>, ctx: ExtensionContext) => void;
	setUserMessagesComponent: (patch: UserMessagesPatch, ctx: ExtensionContext) => void;
	thinkingStepsCapability: ThinkingStepsSettingsCapability;
	setThinkingStepsComponent: (
		patch: Partial<ThinkingStepsComponentConfig>,
		ctx: ExtensionContext,
	) => ApplyResult;
	setWorkingLineComponent: (patch: WorkingLineComponentPatch, ctx: ExtensionContext) => ApplyResult;
	setSelectorBordersComponent: (
		patch: Partial<SelectorBordersComponentConfig>,
		ctx: ExtensionContext,
	) => void;
	setFooterComponent: (patch: FooterPatch, ctx: ExtensionContext) => void;
	setFooterSegments: (patch: Partial<FooterSegmentsConfig>, ctx: ExtensionContext) => void;
	setFooterFormat: (value: string, ctx: ExtensionContext) => void;
	setResponsiveFooter: (
		patch: Partial<Pick<PolishedTuiConfig, "responsiveFooter" | "compactFooterMaxLines">>,
		ctx: ExtensionContext,
	) => void;
	setIconMode: (mode: IconMode) => void;
	setContextStyle: (style: ContextStyle) => void;
	setSeparator: (separator: SeparatorStyle) => void;
	setPathDisplay: (patch: Partial<PathDisplayConfig>) => void;
	setGitBranch: (patch: Partial<GitBranchConfig>) => void;
	setGitCommit: (
		patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
		ctx: ExtensionContext,
	) => void;
	setGitMetrics: (patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) => void;
	getActiveExtensionStatuses: () => ReadonlyMap<string, string>;
	setExtensionStatusDefaultPlacement: (placement: ExtensionStatusPlacement) => void;
	setExtensionStatusPlacement: (key: string, placement: ExtensionStatusPlacement) => void;
	setExtensionStatusColorMode: (key: string, colorMode: ExtensionStatusColorMode) => void;
	requestRender: () => void;
	settingsListTheme?: SettingsListTheme;
};

const sectionLabels: Record<SettingsSection, string> = {
	appearance: "Appearance",
	editor: "Editor",
	userMessages: "User messages",
	thinkingSteps: "Thinking (Experimental)",
	workingLine: "Working line",
	footer: "Footer",
	segments: "Segments",
	git: "Git",
	extensions: "Extensions",
};

const footerSegmentSettingLabels: Record<FooterSegmentSettingId, string> = {
	cwd: "Current directory",
	sessionName: "Session name",
	gitBranch: "Git branch",
	gitStatus: "Git status",
	gitCounts: "Git counts",
	sessionDuration: "Session duration",
	username: "Username@host",
	time: "Current time",
	os: "OS icon",
	runtime: "Runtime",
	modelInfo: "Model info",
	context: "Context usage",
	tokens: "Token counts",
	cost: "Session cost",
	packageVersion: "Package version",
	gitCommit: "Git commit",
	gitMetrics: "Git line metrics",
};

const footerSegmentSettingDescriptions: Record<FooterSegmentSettingId, string> = {
	cwd: "Show or hide the current working directory segment on the left.",
	sessionName: "Show or hide the current Pi session name on the left.",
	gitBranch: "Show or hide the git branch name on the left.",
	gitStatus: "Show or hide git status icons and ahead/behind markers.",
	gitCounts: "Show numeric ahead/behind and stash counts.",
	sessionDuration: "Show session running time on the left.",
	username: "Show user@hostname on the left.",
	time: "Show the current time (HH:MM) on the right.",
	os: "Show an operating-system icon on the left.",
	runtime: "Show or hide the detected runtime/language segment.",
	modelInfo: "Show the selected model and non-duplicate provider.",
	context: "Show or hide context usage on the right.",
	tokens: "Show or hide input/output token counts on the right.",
	cost: "Show or hide session cost on the right.",
	packageVersion: "Show the project manifest version.",
	gitCommit: "Show the current commit hash and optional exact-match tag.",
	gitMetrics: "Show aggregate added/deleted line counts.",
};

const directCommandSuggestions = [
	"editor enable",
	"editor disable",
	"editor toggle",
	"messages enable",
	"messages disable",
	"messages toggle",
	"statusline enable",
	"statusline disable",
	"statusline toggle",
	"viewport-indicators enable",
	"viewport-indicators disable",
	"viewport-indicators toggle",
	"messages",
	"user-messages",
	"working-line",
	"format clear",
	"format $cwd on $git_branch $fill $context",
];

const thirdPartyStatusSettingPrefix = "thirdPartyStatus:";
const footerSegmentSettingPrefix = "footerSegment:";
type ThirdPartyStatusSettingKind = "placement" | "colorMode";

function featureValue(enabled: boolean): FeatureState {
	return enabled ? "enabled" : "disabled";
}
function editorStyleLabel(style: EditorStyle): string {
	return editorStyleLabels[style];
}
function editorStyleId(label: string): EditorStyle | undefined {
	return (Object.entries(editorStyleLabels) as Array<[EditorStyle, string]>).find(
		([, value]) => value === label,
	)?.[0];
}
function footerStyleLabel(style: FooterStyle): string {
	return footerStyleLabels[style];
}
function footerStyleId(label: string): FooterStyle | undefined {
	return (Object.entries(footerStyleLabels) as Array<[FooterStyle, string]>).find(
		([, value]) => value === label,
	)?.[0];
}
function userMessageStyleLabel(style: UserMessageStyle): string {
	return userMessageStyleLabels[style];
}
function userMessageStyleId(label: string): UserMessageStyle | undefined {
	return (Object.entries(userMessageStyleLabels) as Array<[UserMessageStyle, string]>).find(
		([, value]) => value === label,
	)?.[0];
}
function thinkingStepsModeId(label: string): ThinkingStepsMode | undefined {
	return (Object.entries(thinkingStepsModeLabels) as Array<[ThinkingStepsMode, string]>).find(
		([, value]) => value === label,
	)?.[0];
}
function workingLineSpinnerId(label: string): WorkingLineSpinner | undefined {
	return (Object.entries(workingLineSpinnerLabels) as Array<[WorkingLineSpinner, string]>).find(
		([, value]) => value === label,
	)?.[0];
}
function workingLineSpeedLabel(
	intervalMs: number,
	presets: readonly { label: string; intervalMs: number }[],
): string {
	return (
		presets.find((preset) => preset.intervalMs === intervalMs)?.label ?? `Custom ${intervalMs} ms`
	);
}
function isFeatureState(value: string): value is FeatureState {
	return value === "enabled" || value === "disabled";
}
function isColorSource(value: string): value is ColorSource {
	return value === "theme" || value === "terminal";
}
function parseAction(words: string[]): "enable" | "disable" | "toggle" | undefined {
	if (words.includes("toggle")) return "toggle";
	if (words.some((word) => ["enable", "enabled", "on"].includes(word))) return "enable";
	if (words.some((word) => ["disable", "disabled", "off"].includes(word))) return "disable";
	return undefined;
}
function actionValue(action: "enable" | "disable" | "toggle", current: boolean): boolean {
	return action === "toggle" ? !current : action === "enable";
}
function normalizedWords(args: string): string[] {
	return args.trim().toLowerCase().replaceAll(/[_-]+/g, " ").split(/\s+/g).filter(Boolean);
}

type DirectOperation = {
	kind: "editor" | "messages" | "footer" | "viewport";
	enabled: boolean;
};

function parseDirectOperation(
	args: string,
	config: PolishedTuiConfig,
): DirectOperation | undefined {
	const words = normalizedWords(args);
	const action = parseAction(words);
	if (!action) return undefined;
	const actionWords = new Set(["enable", "enabled", "on", "disable", "disabled", "off", "toggle"]);
	const target = words.filter((word) => !actionWords.has(word)).join(" ");
	if (target === "viewportindicators" || target === "viewport indicators") {
		return {
			kind: "viewport",
			enabled: actionValue(action, config.components.editor.viewportIndicators),
		};
	}
	if (target === "messages" || target === "user messages") {
		return {
			kind: "messages",
			enabled: actionValue(action, config.components.userMessages.enabled),
		};
	}
	if (target === "editor") {
		return {
			kind: "editor",
			enabled: actionValue(action, config.components.editor.enabled),
		};
	}
	if (["footer", "statusline", "status", "status line"].includes(target)) {
		return {
			kind: "footer",
			enabled: actionValue(action, config.components.footer.style === "starship"),
		};
	}
	return undefined;
}

function parseFormatCommand(args: string): { value: string | undefined } | undefined {
	const trimmed = args.trim();
	if (!trimmed.toLowerCase().startsWith("format")) return undefined;
	const rest = trimmed.slice("format".length).trim();
	if (!rest || rest.toLowerCase() === "clear") return { value: undefined };
	return {
		value:
			rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2 ? rest.slice(1, -1) : rest,
	};
}

function directSection(args: string): SettingsSection | undefined {
	const normalized = args.trim().toLowerCase().replaceAll("_", "-");
	if (
		normalized === "messages" ||
		normalized === "user-messages" ||
		normalized === "user messages"
	) {
		return "userMessages";
	}
	if (normalized === "working-line" || normalized === "working line") return "workingLine";
	return undefined;
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const normalized = prefix.trimStart().toLowerCase();
	const matches = directCommandSuggestions
		.map((value) => ({ value, label: value }))
		.filter((item) => item.value.startsWith(normalized));
	return matches.length ? matches : null;
}

function usageText(): string {
	return "Usage: /zentui [editor|messages|statusline|viewport-indicators] [enable|disable|toggle], /zentui [messages|user-messages|working-line], or /zentui format <template>";
}

function buildAppearanceItems(config: PolishedTuiConfig): SettingItem[] {
	const component = config.components.selectorBorders;
	return [
		{
			id: "selectorBordersEnabled",
			label: "Selector borders",
			description: "Enable or disable Zentui borders around Pi selectors.",
			currentValue: featureValue(component.enabled),
			values: featureStateValues,
		},
		{
			id: "selectorBordersStyle",
			label: "Selector border style",
			description: "Choose the selector-border style.",
			currentValue: component.style,
			values: ["zentui"],
		},
		{
			id: "selectorBordersColorSource",
			label: "Selector border colors",
			description: "Use Pi theme colors or terminal palette styles.",
			currentValue: component.colorSource,
			values: colorSourceValues,
		},
		{
			id: "iconMode",
			label: "Icon mode",
			description: "auto/nerd use Nerd Font glyphs; ascii uses plain fallbacks.",
			currentValue: config.icons.mode,
			values: iconModeValues,
		},
	];
}

function buildEditorItems(config: PolishedTuiConfig): SettingItem[] {
	const editor = config.components.editor;
	return [
		{
			id: "editorEnabled",
			label: "Editor",
			description: "Enable or disable Zentui's custom editor.",
			currentValue: featureValue(editor.enabled),
			values: featureStateValues,
		},
		{
			id: "editorStyle",
			label: "Editor style",
			description: "Use Opencode, Accent Rail, or a compact Minimalist frame.",
			currentValue: editorStyleLabel(editor.style),
			values: editorStyleValues,
		},
		{
			id: "editorColorSource",
			label: "Editor colors",
			description: "Use Pi theme colors or terminal palette styles.",
			currentValue: editor.colorSource,
			values: colorSourceValues,
		},
		{
			id: "editorModelLabel",
			label: "Editor model label",
			description: "Show the model id or display name in the editor frame.",
			currentValue: editor.modelLabel,
			values: modelLabelValues,
		},
		{
			id: "editorBorderColorMode",
			label: "Editor border color",
			description: "Keep configured color or follow Pi's shell/thinking color.",
			currentValue: editor.borderColorMode,
			values: editorBorderColorModeValues,
		},
		{
			id: "editorViewportIndicators",
			label: "Editor viewport indicators",
			description: "Show Pi's native wrapped-row counts in editor borders.",
			currentValue: featureValue(editor.viewportIndicators),
			values: featureStateValues,
		},
	];
}

function buildPolishedEditorStyleItems(config: PolishedTuiConfig): SettingItem[] {
	const editor = config.components.editor;
	const style =
		editor.style === "opencode-copy-friendly"
			? editor.styles["opencode-copy-friendly"]
			: editor.styles.opencode;
	return [
		{
			id: "opencodeCompletionMenu",
			label: "Completion menu",
			description: "Use Pi's native list or the full-width Opencode palette shell.",
			currentValue: style.completionMenu,
			values: completionMenuValues,
		},
	];
}

function buildAccentRailEditorStyleItems(config: PolishedTuiConfig): SettingItem[] {
	const accentRail = config.components.editor.styles["accent-rail"];
	return [
		{
			id: "accentRailSurface",
			label: "Accent Rail surface",
			description: "Fill input and autocomplete surfaces or keep them transparent.",
			currentValue: accentRail.transparent ? "transparent" : "filled",
			values: accentRailSurfaceValues,
		},
	];
}

function buildMinimalistEditorStyleItems(config: PolishedTuiConfig): SettingItem[] {
	const minimalist = config.components.editor.styles.minimalist;
	return [
		{
			id: "minimalistPathDisplay",
			label: "Path",
			description: "Show compact, project-relative, or full path.",
			currentValue: minimalist.pathDisplay,
			values: minimalistPathDisplayValues,
		},
		{
			id: "minimalistContextFormat",
			label: "Context text",
			description: "Show percent alone or with total context.",
			currentValue: minimalist.contextFormat,
			values: minimalistContextFormatValues,
		},
		{
			id: "minimalistContextGauge",
			label: "Context gauge",
			description: "Add a compact context gauge.",
			currentValue: featureValue(minimalist.contextGauge),
			values: featureStateValues,
		},
		{
			id: "minimalistShowSessionName",
			label: "Session name",
			description: "Show the explicit Pi session name.",
			currentValue: featureValue(minimalist.showSessionName),
			values: featureStateValues,
		},
		{
			id: "minimalistShowTimer",
			label: "Timer",
			description: "Show current or completed turn duration.",
			currentValue: featureValue(minimalist.showTimer),
			values: featureStateValues,
		},
		{
			id: "minimalistShowCost",
			label: "Cost",
			description: "Show session cost in the top border.",
			currentValue: featureValue(minimalist.showCost),
			values: featureStateValues,
		},
		{
			id: "minimalistShowGit",
			label: "Git",
			description: "Show branch and working-tree state.",
			currentValue: featureValue(minimalist.showGit),
			values: featureStateValues,
		},
	];
}

function buildUserMessagesItems(config: PolishedTuiConfig): SettingItem[] {
	const messages = config.components.userMessages;
	return [
		{
			id: "userMessagesEnabled",
			label: "User messages",
			description: "Enable or disable previous user-message styling.",
			currentValue: featureValue(messages.enabled),
			values: featureStateValues,
		},
		{
			id: "userMessagesStyle",
			label: "Message style",
			description: "Choose the previous-message style.",
			currentValue: userMessageStyleLabel(messages.style),
			values: userMessageStyleValues,
		},
		{
			id: "userMessagesColorSource",
			label: "Message colors",
			description: "Use Pi theme colors or terminal palette styles.",
			currentValue: messages.colorSource,
			values: colorSourceValues,
		},
	];
}
function buildThinkingStepsItems(
	config: PolishedTuiConfig,
	capability: ThinkingStepsSettingsCapability,
): SettingItem[] {
	const thinkingSteps = config.components.thinkingSteps;
	const controller = experimentalThinkingCapability(capability);
	const startupLabel = controller.startup.enabled
		? `Active startup: ${thinkingStepsModeLabels[controller.startup.mode]}`
		: "Active startup: native thinking";
	const savedLabel = thinkingSteps.enabled
		? `Saved: ${thinkingStepsModeLabels[thinkingSteps.mode]}`
		: "Saved: disabled";
	const status = !controller.available
		? `${controller.reason ?? "Private renderer unavailable"}; using native thinking.`
		: controller.restartRequired
			? `${savedLabel}; ${startupLabel}. Restart Pi to apply.`
			: controller.active
				? `${startupLabel}.`
				: `${savedLabel}; using native thinking.`;
	const enabledDescription = `${status} Private renderer; every enable, disable, or mode change requires restart and may break after Pi updates.`;
	return [
		{
			id: "thinkingStepsEnabled",
			label: "Enabled",
			description: enabledDescription,
			currentValue: featureValue(thinkingSteps.enabled),
			values: featureStateValues,
		},
		{
			id: "thinkingStepsMode",
			label: "Mode",
			description: `${status} Rail shows every parsed label; Tree shows the latest five per contiguous run; Streaming folds to the latest five host-rendered rows and owns the configured thinking toggle only when active. Incompatibility uses native thinking.`,
			currentValue: thinkingStepsModeLabels[thinkingSteps.mode],
			values: thinkingStepsModeValues,
		},
	];
}

function buildWorkingLineItems(config: PolishedTuiConfig): SettingItem[] {
	const workingLine = config.components.workingLine;
	const staticText = workingLine.textAnimation === "disabled";
	const staticNote = staticText ? " Inactive in Static mode; saved for animated modes." : "";
	return [
		{
			id: "workingLineEnabled",
			label: "Enabled",
			description: "Own and stylize Pi's complete working row.",
			currentValue: featureValue(workingLine.enabled),
			values: featureStateValues,
		},
		{
			id: "workingLineTurnSummary",
			label: "Turn summary",
			description: workingLine.enabled
				? "Append `Turn took …` after each fully settled interaction."
				: "Append `Turn took …` after each fully settled interaction; inactive while Working line disabled.",
			currentValue: featureValue(workingLine.turnSummary),
			values: featureStateValues,
		},
		{
			id: "workingLineSpinner",
			label: "Spinner",
			description: "Choose the fixed-width spinner preset; glyph motion is always active.",
			currentValue: workingLineSpinnerLabels[workingLine.spinner],
			values: workingLineSpinnerValues,
		},
		{
			id: "workingLineSpinnerSpeed",
			label: "Spinner speed",
			description: `Set glyph cadence (${MIN_WORKING_LINE_INTERVAL_MS}–${MAX_WORKING_LINE_INTERVAL_MS} ms).`,
			currentValue: workingLineSpeedLabel(
				workingLine.spinnerIntervalMs,
				workingLineSpinnerSpeedPresets,
			),
			values: speedValues(workingLineSpinnerSpeedPresets),
		},
		{
			id: "workingLineAnimateSpinnerColor",
			label: "Animate spinner color",
			description: `Include spinner cells and separator in Classic/KITT color motion; glyph motion remains active.${staticNote}`,
			currentValue: featureValue(workingLine.animateSpinnerColor),
			values: featureStateValues,
		},
		{
			id: "workingLineTextAnimation",
			label: "Text animation",
			description: "Animate the owned row or keep it uniformly static.",
			currentValue: workingLine.textAnimation,
			values: workingLineTextAnimationValues,
		},
		{
			id: "workingLineTextSpeed",
			label: "Text motion speed",
			description: `Set Classic/KITT color cadence (${MIN_WORKING_LINE_INTERVAL_MS}–${MAX_WORKING_LINE_INTERVAL_MS} ms).${staticNote}`,
			currentValue: workingLineSpeedLabel(workingLine.textIntervalMs, workingLineTextSpeedPresets),
			values: speedValues(workingLineTextSpeedPresets),
		},
		{
			id: "workingLineColorSource",
			label: "Color source",
			description: "Use Pi theme colors or independent terminal palette styles.",
			currentValue: workingLine.colorSource,
			values: colorSourceValues,
		},
		{
			id: "workingLineCustomMessages",
			label: "Custom messages",
			description:
				"Select from the editable list once per turn; off uses styled Working… without RNG.",
			currentValue: featureValue(workingLine.messages.custom),
			values: featureStateValues,
		},
		{
			id: "workingLineTool",
			label: "Tool",
			description: "Show the latest active tool.",
			currentValue: featureValue(workingLine.segments.tool),
			values: featureStateValues,
		},
		{
			id: "workingLineElapsed",
			label: "Elapsed",
			description: "Show whole-interaction elapsed time.",
			currentValue: featureValue(workingLine.segments.elapsed),
			values: featureStateValues,
		},
		{
			id: "workingLineThought",
			label: "Thinking time",
			description: "Show cumulative wall-clock thinking time and active updates.",
			currentValue: featureValue(workingLine.segments.thought),
			values: featureStateValues,
		},
		{
			id: "workingLineTokens",
			label: "Tokens",
			description:
				"Show whole-interaction tokens as ↑input ↓output; live output may be estimated until final usage reconciles.",
			currentValue: featureValue(workingLine.segments.tokens),
			values: featureStateValues,
		},
		{
			id: "workingLineMessageList",
			label: "Message list",
			description:
				"Edit one message per line; line order is preserved even while custom messages are off.",
			currentValue: "Edit…",
			values: ["Edit…"],
		},
	];
}

function buildFooterItems(config: PolishedTuiConfig): SettingItem[] {
	const footer = config.components.footer;
	const items: SettingItem[] = [
		{
			id: "footerStyle",
			label: "Footer style",
			description: "Use Pi's native footer, Zentui's Starship footer, or no footer rows.",
			currentValue: footerStyleLabel(footer.style),
			values: footerStyleValues,
		},
	];
	if (footer.style === "starship") {
		items.push(
			{
				id: "footerColorSource",
				label: "Footer colors",
				description: "Use Pi theme colors or terminal palette styles.",
				currentValue: footer.colorSource,
				values: colorSourceValues,
			},
			{
				id: "footerModelLabel",
				label: "Footer model label",
				description: "Show the model id or display name in the footer.",
				currentValue: footer.modelLabel,
				values: modelLabelValues,
			},
		);
	}
	return items;
}
function buildStarshipFooterStyleItems(config: PolishedTuiConfig): SettingItem[] {
	const footer = config.components.footer.styles.starship;
	return [
		{
			id: "responsiveFooter",
			label: "Responsive footer",
			description: "Use the compact template when space is tight.",
			currentValue: featureValue(footer.responsive),
			values: featureStateValues,
		},
		{
			id: "compactFooterMaxLines",
			label: "Compact footer rows",
			description: "Maximum compact rows before cropping.",
			currentValue: String(footer.compactMaxLines),
			values: compactFooterMaxLineValues,
		},
		{
			id: "contextStyle",
			label: "Context style",
			description: "Render context as text, gauge, or both.",
			currentValue: footer.contextStyle,
			values: contextStyleValues,
		},
		{
			id: "separator",
			label: "Separator",
			description: "Choose the separator between default footer segments.",
			currentValue: footer.separator,
			values: separatorStyleValues,
		},
		{
			id: "pathDisplay",
			label: "Path display",
			description: "Show cwd as basename, repository-relative, or full path.",
			currentValue: footer.pathDisplay.mode,
			values: pathDisplayModeValues,
		},
		{
			id: "pathDepth",
			label: "Path depth",
			description: "Final component count for Full and Repository (0 = unlimited).",
			currentValue: String(footer.pathDisplay.depth),
			values: pathDepthValues,
		},
	];
}

const nonGitSegmentKeys: FooterSegmentSettingId[] = [
	"cwd",
	"sessionName",
	"runtime",
	"modelInfo",
	"context",
	"tokens",
	"cost",
	"sessionDuration",
	"username",
	"time",
	"os",
	"packageVersion",
];
function footerSegmentSettingId(key: FooterSegmentSettingId): string {
	return `${footerSegmentSettingPrefix}${key}`;
}
function isFooterSegmentSettingId(value: string): value is FooterSegmentSettingId {
	return value in footerSegmentSettingLabels;
}
function footerSegmentSettingFromId(id: string): FooterSegmentSettingId | undefined {
	if (!id.startsWith(footerSegmentSettingPrefix)) return undefined;
	const key = id.slice(footerSegmentSettingPrefix.length);
	return isFooterSegmentSettingId(key) ? key : undefined;
}
function buildSegmentsItems(config: PolishedTuiConfig): SettingItem[] {
	const segments = config.components.footer.styles.starship.segments;
	return nonGitSegmentKeys.map((key) => ({
		id: footerSegmentSettingId(key),
		label: footerSegmentSettingLabels[key],
		description: footerSegmentSettingDescriptions[key],
		currentValue: featureValue(segments[key]),
		values: featureStateValues,
	}));
}
function branchLengthValues(maxLength: GitBranchMaxLength): string[] {
	const current = String(maxLength);
	return branchLengthPresetValues.includes(current as never)
		? [...branchLengthPresetValues]
		: [current, ...branchLengthPresetValues];
}
function buildGitItems(config: PolishedTuiConfig): SettingItem[] {
	const starship = config.components.footer.styles.starship;
	const segment = (key: FooterSegmentSettingId): SettingItem => ({
		id: footerSegmentSettingId(key),
		label: footerSegmentSettingLabels[key],
		description: footerSegmentSettingDescriptions[key],
		currentValue: featureValue(starship.segments[key]),
		values: featureStateValues,
	});
	return [
		segment("gitBranch"),
		{
			id: "branchLength",
			label: "Branch length",
			description: "Full branch name or a visible-width limit.",
			currentValue: String(starship.gitBranch.maxLength),
			values: branchLengthValues(starship.gitBranch.maxLength),
		},
		segment("gitStatus"),
		segment("gitCounts"),
		segment("gitCommit"),
		{
			id: "gitCommitOnlyDetached",
			label: "Commit only on detached HEAD",
			description: "Only show commit when HEAD is detached.",
			currentValue: featureValue(starship.gitCommit.onlyDetached),
			values: featureStateValues,
		},
		{
			id: "gitCommitShowTag",
			label: "Show exact-match tag",
			description: "Append an exact-match tag.",
			currentValue: featureValue(starship.gitCommit.showTag),
			values: featureStateValues,
		},
		segment("gitMetrics"),
		{
			id: "gitMetricsOnlyNonzero",
			label: "Hide zero metrics",
			description: "Hide zero added/deleted values.",
			currentValue: featureValue(starship.gitMetrics.onlyNonzero),
			values: featureStateValues,
		},
		{
			id: "gitMetricsIgnoreSubmodules",
			label: "Ignore submodules",
			description: "Exclude submodule changes.",
			currentValue: featureValue(starship.gitMetrics.ignoreSubmodules),
			values: featureStateValues,
		},
	];
}
function thirdPartyStatusSettingId(key: string, kind: ThirdPartyStatusSettingKind): string {
	return `${thirdPartyStatusSettingPrefix}${kind}:${key}`;
}
function thirdPartyStatusSettingFromId(
	id: string,
): { kind: ThirdPartyStatusSettingKind; key: string } | undefined {
	if (!id.startsWith(thirdPartyStatusSettingPrefix)) return undefined;
	const [kind, ...key] = id.slice(thirdPartyStatusSettingPrefix.length).split(":");
	return kind === "placement" || kind === "colorMode" ? { kind, key: key.join(":") } : undefined;
}
function buildExtensionsItems(
	config: PolishedTuiConfig,
	active: ReadonlyMap<string, string>,
): SettingItem[] {
	const defaultItem: SettingItem = {
		id: "extensionStatusDefaultPlacement",
		label: "Default placement",
		description: "Placement for active statuses without an override.",
		currentValue: config.components.footer.styles.starship.extensionStatuses.defaultPlacement,
		values: extensionStatusPlacementValues,
	};
	const statuses = [...active.entries()].sort(([a], [b]) => a.localeCompare(b));
	if (!statuses.length)
		return [
			defaultItem,
			{
				id: "noThirdPartyStatuses",
				label: "No active statuses",
				description: "Only statuses currently published through ctx.ui.setStatus().",
				currentValue: "—",
			},
		];
	return [
		defaultItem,
		...statuses.flatMap(([key, value]) => {
			const sanitized = sanitizeExtensionStatusText(value);
			const description = sanitized ? `Current status: ${sanitized}` : undefined;
			return [
				{
					id: thirdPartyStatusSettingId(key, "placement"),
					label: `${key} placement`,
					description,
					currentValue: getExtensionStatusPlacement(config, key),
					values: extensionStatusPlacementValues,
				},
				{
					id: thirdPartyStatusSettingId(key, "colorMode"),
					label: `${key} color`,
					description,
					currentValue: getExtensionStatusColorMode(config, key),
					values: extensionStatusColorModeValues,
				},
			];
		}),
	];
}

function buildSectionItems(
	section: SettingsSection,
	config: PolishedTuiConfig,
	active: ReadonlyMap<string, string>,
	thinkingStepsCapability: ThinkingStepsSettingsCapability,
): SettingItem[] {
	switch (section) {
		case "appearance":
			return buildAppearanceItems(config);
		case "editor":
			return [
				...buildEditorItems(config),
				...(config.components.editor.style === "opencode" ||
				config.components.editor.style === "opencode-copy-friendly"
					? buildPolishedEditorStyleItems(config)
					: []),
				...(config.components.editor.style === "accent-rail"
					? buildAccentRailEditorStyleItems(config)
					: []),
				...(config.components.editor.style === "minimalist"
					? buildMinimalistEditorStyleItems(config)
					: []),
			];
		case "userMessages":
			return buildUserMessagesItems(config);
		case "thinkingSteps":
			return buildThinkingStepsItems(config, thinkingStepsCapability);
		case "workingLine":
			return buildWorkingLineItems(config);
		case "footer":
			return [
				...buildFooterItems(config),
				...(config.components.footer.style === "starship"
					? buildStarshipFooterStyleItems(config)
					: []),
			];
		case "segments":
			return buildSegmentsItems(config);
		case "git":
			return buildGitItems(config);
		case "extensions":
			return buildExtensionsItems(config, active);
	}
}

function nextSection(section: SettingsSection): SettingsSection {
	return (
		settingsSections[(settingsSections.indexOf(section) + 1) % settingsSections.length] ??
		"appearance"
	);
}
function previousSection(section: SettingsSection): SettingsSection {
	return (
		settingsSections[
			(settingsSections.indexOf(section) - 1 + settingsSections.length) % settingsSections.length
		] ?? "appearance"
	);
}
function formatSectionTabs(
	active: SettingsSection,
	theme: ExtensionContext["ui"]["theme"],
	width: number,
): string {
	const rendered = settingsSections.map((section) =>
		section === active
			? theme.bold(sectionLabels[section])
			: safeThemeFg(theme, "muted", sectionLabels[section]),
	);
	const full = `  ${rendered.join(safeThemeFg(theme, "muted", " / "))}`;
	if (visibleWidth(full) <= width) return full;
	return `  ${theme.bold(sectionLabels[active])} (${settingsSections.indexOf(active) + 1}/${settingsSections.length})`;
}
function withSectionFooter(lines: string[], theme: ExtensionContext["ui"]["theme"]): string[] {
	const copy = [...lines];
	for (let index = copy.length - 1; index >= 0; index -= 1) {
		if (copy[index]?.includes("Enter/Space")) {
			copy[index] = safeThemeFg(
				theme,
				"muted",
				"  Enter/Space to change · Tab/Shift+Tab to switch sections · Esc to close",
			);
			break;
		}
	}
	return copy;
}

export function registerZentuiSettingsCommand(pi: ExtensionAPI, deps: SettingsCommandDeps): void {
	const setEditor = (patch: EditorPatch, ctx: ExtensionContext): ApplyResult =>
		deps.setEditorComponent(patch, ctx);
	const setMessages = (patch: UserMessagesPatch, ctx: ExtensionContext) => {
		deps.setUserMessagesComponent(patch, ctx);
	};
	const setFooter = (patch: FooterPatch, ctx: ExtensionContext) => {
		deps.setFooterComponent(patch, ctx);
	};

	pi.registerCommand("zentui", {
		description: "Configure Zentui",
		getArgumentCompletions: argumentCompletions,
		handler: async (_args, ctx) => {
			const args = typeof _args === "string" ? _args : "";
			const format = parseFormatCommand(args);
			if (format) {
				try {
					deps.setFooterFormat(format.value ?? "", ctx);
					deps.requestRender();
					if (ctx.hasUI)
						ctx.ui.notify(
							format.value === undefined
								? "Footer format cleared (using default layout)"
								: `Footer format: ${format.value}`,
							"info",
						);
				} catch (error) {
					if (ctx.hasUI)
						ctx.ui.notify(
							`Could not update footer format: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
				}
				return;
			}

			const direct = parseDirectOperation(args, deps.getConfig());
			if (direct) {
				try {
					let result: ApplyResult = { applied: true };
					let label = "";
					switch (direct.kind) {
						case "editor":
							result = setEditor({ enabled: direct.enabled }, ctx);
							label = "Editor";
							break;
						case "messages":
							setMessages({ enabled: direct.enabled }, ctx);
							label = "User messages";
							break;
						case "footer":
							setFooter({ style: direct.enabled ? "starship" : "native" }, ctx);
							label = "Footer";
							break;
						case "viewport":
							result = setEditor({ viewportIndicators: direct.enabled }, ctx);
							label = "Editor viewport indicators";
							break;
					}
					deps.requestRender();
					if (ctx.hasUI)
						ctx.ui.notify(
							`${label}: ${featureValue(direct.enabled)}${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
							"info",
						);
				} catch (error) {
					if (ctx.hasUI)
						ctx.ui.notify(
							`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
				}
				return;
			}

			const initialSection = directSection(args);
			if (args.trim() && !initialSection) {
				if (ctx.hasUI) ctx.ui.notify(usageText(), "warning");
				return;
			}
			const mode = (ctx as typeof ctx & { mode?: string }).mode;
			if (!ctx.hasUI || (mode !== undefined && mode !== "tui")) return;

			let requestedSection = initialSection ?? "appearance";
			let requestedFocusId: string | undefined;
			while (true) {
				const initialFocusId = requestedFocusId;
				requestedFocusId = undefined;
				const outcome = await ctx.ui.custom<SettingsOutcome>((tui, theme, _keybindings, done) => {
					const listTheme = deps.settingsListTheme ?? getSettingsListTheme();
					let activeSection = requestedSection;
					let settingsList: SettingsList;
					let preview: WorkingLineFrames | undefined;
					let previewFrameIndex = 0;
					let cancelPreview = () => {};
					const stopPreview = (reset = true) => {
						cancelPreview();
						cancelPreview = () => {};
						if (reset) {
							preview = undefined;
							previewFrameIndex = 0;
						}
					};
					const startPreview = () => {
						const previous = preview;
						const previousState = previous?.frameStates[previewFrameIndex];
						stopPreview(false);
						if (activeSection !== "workingLine") return;
						try {
							const config = deps.getConfig();
							const spinnerTick = previousState?.spinnerTick ?? 0;
							let textTick = previousState?.textTick ?? 0;
							let generated = buildWorkingLinePreviewFrames(
								config.components.workingLine,
								config.colors,
								theme,
								spinnerTick,
								textTick,
							);
							if (previous && previousState) {
								textTick = remapWorkingLineTextTick(
									previous.textAnimation,
									previous.textWidth,
									previousState.textTick,
									generated.textAnimation,
									generated.textWidth,
									previous.textOrigin,
									generated.textOrigin,
								);
								generated = buildWorkingLinePreviewFrames(
									config.components.workingLine,
									config.colors,
									theme,
									spinnerTick,
									textTick,
								);
							}
							preview = generated;
							previewFrameIndex = 0;
							const advance = () => {
								if (activeSection !== "workingLine" || !preview || preview.frames.length === 0)
									return;
								previewFrameIndex = (previewFrameIndex + 1) % preview.frames.length;
								tui.requestRender();
								cancelPreview = deps.sessionLifecycle.defer(advance, preview.intervalMs);
							};
							cancelPreview = deps.sessionLifecycle.defer(advance, generated.intervalMs);
						} catch {
							stopPreview();
						}
					};
					const finishSettings = (result: SettingsOutcome) => {
						stopPreview();
						done(result);
					};
					const notifyChange = (label: string, value: string, result?: ApplyResult) => {
						deps.requestRender();
						ctx.ui.notify(
							`${label}: ${value}${result && !result.applied ? ` (${result.reason ?? "reload Pi to apply this change"})` : ""}`,
							"info",
						);
						startPreview();
						tui.requestRender();
					};
					const notifyWorkingLineChange = (
						label: string,
						value: string,
						result: ApplyResult,
						previewChanged = true,
					) => {
						ctx.ui.notify(
							`${label}: ${value}${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
							"info",
						);
						if (previewChanged) startPreview();
						tui.requestRender();
					};
					const makeSettingsList = (focusId?: string): SettingsList => {
						const items = buildSectionItems(
							activeSection,
							deps.getConfig(),
							deps.getActiveExtensionStatuses(),
							deps.thinkingStepsCapability,
						);
						const list = new SettingsList(
							items,
							8,
							listTheme,
							(id, newValue) => {
								try {
									const enabled = isFeatureState(newValue) ? newValue === "enabled" : undefined;
									if (id === "editorEnabled" && enabled !== undefined) {
										finishSettings("close");
										deps.sessionLifecycle.defer(() => {
											try {
												const result = setEditor({ enabled }, ctx);
												deps.requestRender();
												ctx.ui.notify(
													`Editor: ${newValue}${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
													"info",
												);
											} catch (error) {
												ctx.ui.notify(
													`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
													"error",
												);
											}
										});
										return;
									}
									const selectedEditorStyle =
										id === "editorStyle" ? editorStyleId(newValue) : undefined;
									if (selectedEditorStyle) {
										setEditor({ style: selectedEditorStyle }, ctx);
										settingsList = makeSettingsList("editorStyle");
										notifyChange("Editor style", newValue);
										return;
									}
									if (id === "editorColorSource" && isColorSource(newValue)) {
										setEditor({ colorSource: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Editor colors", newValue);
										return;
									}
									if (id === "editorModelLabel" && (newValue === "id" || newValue === "name")) {
										setEditor({ modelLabel: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Editor model label", newValue);
										return;
									}
									if (
										id === "editorBorderColorMode" &&
										(newValue === "static" || newValue === "adaptive")
									) {
										setEditor({ borderColorMode: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Editor border color", newValue);
										return;
									}
									if (id === "editorViewportIndicators" && enabled !== undefined) {
										setEditor({ viewportIndicators: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Editor viewport indicators", newValue);
										return;
									}
									if (
										id === "opencodeCompletionMenu" &&
										(newValue === "native" || newValue === "palette")
									) {
										const style = deps.getConfig().components.editor.style;
										if (style === "opencode") deps.setPolished({ completionMenu: newValue }, ctx);
										else if (style === "opencode-copy-friendly")
											deps.setPolishedCopyFriendly({ completionMenu: newValue }, ctx);
										else return;
										settingsList.updateValue(id, newValue);
										notifyChange("Completion menu", newValue);
										return;
									}
									if (
										id === "accentRailSurface" &&
										(newValue === "filled" || newValue === "transparent")
									) {
										deps.setAccentRail({ transparent: newValue === "transparent" }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Accent Rail surface", newValue);
										return;
									}
									if (id.startsWith("minimalist")) {
										if (
											id === "minimalistPathDisplay" &&
											["compact", "project", "full"].includes(newValue)
										)
											deps.setMinimalist(
												{ pathDisplay: newValue as MinimalistConfig["pathDisplay"] },
												ctx,
											);
										else if (
											id === "minimalistContextFormat" &&
											["percent", "percent-total"].includes(newValue)
										)
											deps.setMinimalist(
												{ contextFormat: newValue as MinimalistConfig["contextFormat"] },
												ctx,
											);
										else if (enabled !== undefined) {
											const key =
												id === "minimalistContextGauge"
													? "contextGauge"
													: id === "minimalistShowSessionName"
														? "showSessionName"
														: id === "minimalistShowTimer"
															? "showTimer"
															: id === "minimalistShowCost"
																? "showCost"
																: id === "minimalistShowGit"
																	? "showGit"
																	: undefined;
											if (!key) return;
											deps.setMinimalist({ [key]: enabled }, ctx);
										} else return;
										settingsList.updateValue(id, newValue);
										notifyChange(id, newValue);
										return;
									}

									if (id === "userMessagesEnabled" && enabled !== undefined) {
										setMessages({ enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("User messages", newValue);
										return;
									}
									const selectedMessageStyle =
										id === "userMessagesStyle" ? userMessageStyleId(newValue) : undefined;
									if (selectedMessageStyle) {
										setMessages({ style: selectedMessageStyle }, ctx);
										settingsList = makeSettingsList("userMessagesStyle");
										notifyChange("Message style", newValue);
										return;
									}
									if (id === "userMessagesColorSource" && isColorSource(newValue)) {
										setMessages({ colorSource: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Message colors", newValue);
										return;
									}
									if (id === "thinkingStepsEnabled" && enabled !== undefined) {
										const result = deps.setThinkingStepsComponent({ enabled }, ctx);
										settingsList = makeSettingsList("thinkingStepsEnabled");
										notifyChange("Thinking (Experimental)", newValue, result);
										return;
									}
									const selectedThinkingStepsMode =
										id === "thinkingStepsMode" ? thinkingStepsModeId(newValue) : undefined;
									if (selectedThinkingStepsMode) {
										const result = deps.setThinkingStepsComponent(
											{ mode: selectedThinkingStepsMode },
											ctx,
										);
										settingsList = makeSettingsList("thinkingStepsMode");
										notifyChange("Thinking (Experimental)", newValue, result);
										return;
									}
									if (id === "workingLineEnabled" && enabled !== undefined) {
										const result = deps.setWorkingLineComponent({ enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Working line", newValue, result);
										return;
									}
									if (id === "workingLineTurnSummary" && enabled !== undefined) {
										const result = deps.setWorkingLineComponent({ turnSummary: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Turn summary", newValue, result, false);
										return;
									}
									const selectedWorkingLineSpinner =
										id === "workingLineSpinner" ? workingLineSpinnerId(newValue) : undefined;
									if (selectedWorkingLineSpinner) {
										const result = deps.setWorkingLineComponent(
											{ spinner: selectedWorkingLineSpinner },
											ctx,
										);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Spinner", newValue, result);
										return;
									}
									if (id === "workingLineSpinnerSpeed" || id === "workingLineTextSpeed") {
										const spinnerSpeed = id === "workingLineSpinnerSpeed";
										if (newValue === "Custom…") {
											finishSettings(
												spinnerSpeed
													? "edit-working-line-spinner-speed"
													: "edit-working-line-text-speed",
											);
											return;
										}
										const presets = spinnerSpeed
											? workingLineSpinnerSpeedPresets
											: workingLineTextSpeedPresets;
										const intervalMs = presets.find(
											(preset) => preset.label === newValue,
										)?.intervalMs;
										if (intervalMs !== undefined) {
											const result = deps.setWorkingLineComponent(
												spinnerSpeed
													? { spinnerIntervalMs: intervalMs }
													: { textIntervalMs: intervalMs },
												ctx,
											);
											settingsList.updateValue(id, newValue);
											notifyWorkingLineChange(
												spinnerSpeed ? "Spinner speed" : "Text motion speed",
												`${intervalMs} ms`,
												result,
											);
										}
										return;
									}
									if (
										id === "workingLineTextAnimation" &&
										workingLineTextAnimationValues.includes(newValue as WorkingLineTextAnimation)
									) {
										const result = deps.setWorkingLineComponent(
											{ textAnimation: newValue as WorkingLineTextAnimation },
											ctx,
										);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Text animation", newValue, result);
										return;
									}
									if (id === "workingLineColorSource" && isColorSource(newValue)) {
										const result = deps.setWorkingLineComponent({ colorSource: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Color source", newValue, result);
										return;
									}
									if (id === "workingLineAnimateSpinnerColor" && enabled !== undefined) {
										const result = deps.setWorkingLineComponent(
											{ animateSpinnerColor: enabled },
											ctx,
										);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Animate spinner color", newValue, result);
										return;
									}
									if (id === "workingLineCustomMessages" && enabled !== undefined) {
										const result = deps.setWorkingLineComponent(
											{ messages: { custom: enabled } },
											ctx,
										);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange("Custom messages", newValue, result);
										return;
									}
									if (
										(id === "workingLineTool" ||
											id === "workingLineElapsed" ||
											id === "workingLineThought" ||
											id === "workingLineTokens") &&
										enabled !== undefined
									) {
										const key =
											id === "workingLineTool"
												? "tool"
												: id === "workingLineElapsed"
													? "elapsed"
													: id === "workingLineThought"
														? "thought"
														: "tokens";
										const result = deps.setWorkingLineComponent(
											{ segments: { [key]: enabled } },
											ctx,
										);
										settingsList.updateValue(id, newValue);
										notifyWorkingLineChange(id.slice("workingLine".length), newValue, result);
										return;
									}
									if (id === "workingLineMessageList") {
										finishSettings("edit-working-line-messages");
										return;
									}
									if (id === "selectorBordersEnabled" && enabled !== undefined) {
										deps.setSelectorBordersComponent({ enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Selector borders", newValue);
										return;
									}
									if (id === "selectorBordersStyle" && newValue === "zentui") {
										deps.setSelectorBordersComponent({ style: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Selector border style", newValue);
										return;
									}
									if (id === "selectorBordersColorSource" && isColorSource(newValue)) {
										deps.setSelectorBordersComponent({ colorSource: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Selector border colors", newValue);
										return;
									}
									if (id === "iconMode" && isIconMode(newValue)) {
										deps.setIconMode(newValue);
										settingsList.updateValue(id, newValue);
										notifyChange("Icon mode", newValue);
										return;
									}

									const selectedFooterStyle =
										id === "footerStyle" ? footerStyleId(newValue) : undefined;
									if (selectedFooterStyle) {
										setFooter({ style: selectedFooterStyle }, ctx);
										settingsList = makeSettingsList("footerStyle");
										notifyChange("Footer style", newValue);
										return;
									}
									if (id === "footerColorSource" && isColorSource(newValue)) {
										setFooter({ colorSource: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Footer colors", newValue);
										return;
									}
									if (id === "footerModelLabel" && (newValue === "id" || newValue === "name")) {
										setFooter({ modelLabel: newValue }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Footer model label", newValue);
										return;
									}

									if (id === "responsiveFooter" && enabled !== undefined) {
										deps.setResponsiveFooter({ responsiveFooter: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Responsive footer", newValue);
										return;
									}
									if (
										id === "compactFooterMaxLines" &&
										compactFooterMaxLineValues.includes(newValue as never)
									) {
										const value: CompactFooterMaxLines =
											newValue === "unlimited" ? "unlimited" : (Number(newValue) as 1 | 2 | 3);
										deps.setResponsiveFooter({ compactFooterMaxLines: value }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Compact footer rows", newValue);
										return;
									}
									if (
										id === "contextStyle" &&
										contextStyleValues.includes(newValue as ContextStyle)
									) {
										deps.setContextStyle(newValue as ContextStyle);
										settingsList.updateValue(id, newValue);
										notifyChange("Context style", newValue);
										return;
									}
									if (id === "separator" && isSeparatorStyle(newValue)) {
										deps.setSeparator(newValue);
										settingsList.updateValue(id, newValue);
										notifyChange("Separator", newValue);
										return;
									}
									if (
										id === "pathDisplay" &&
										pathDisplayModeValues.includes(newValue as PathDisplayConfig["mode"])
									) {
										deps.setPathDisplay({ mode: newValue as PathDisplayConfig["mode"] });
										settingsList.updateValue(id, newValue);
										notifyChange("Path display", newValue);
										return;
									}
									if (id === "pathDepth" && pathDepthValues.includes(newValue as never)) {
										deps.setPathDisplay({ depth: Number(newValue) });
										settingsList.updateValue(id, newValue);
										notifyChange("Path depth", newValue);
										return;
									}

									const segment = footerSegmentSettingFromId(id);
									if (segment && enabled !== undefined) {
										deps.setFooterSegments({ [segment]: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange(footerSegmentSettingLabels[segment], newValue);
										return;
									}
									if (id === "branchLength") {
										const value = newValue === "full" ? "full" : Number(newValue);
										if (value !== "full" && (!Number.isInteger(value) || value <= 0)) return;
										deps.setGitBranch({ maxLength: value });
										settingsList.updateValue(id, newValue);
										notifyChange("Branch length", newValue);
										return;
									}
									if (id === "gitCommitOnlyDetached" && enabled !== undefined) {
										deps.setGitCommit({ onlyDetached: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Commit only on detached HEAD", newValue);
										return;
									}
									if (id === "gitCommitShowTag" && enabled !== undefined) {
										deps.setGitCommit({ showTag: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Show exact-match tag", newValue);
										return;
									}
									if (id === "gitMetricsOnlyNonzero" && enabled !== undefined) {
										deps.setGitMetrics({ onlyNonzero: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Hide zero metrics", newValue);
										return;
									}
									if (id === "gitMetricsIgnoreSubmodules" && enabled !== undefined) {
										deps.setGitMetrics({ ignoreSubmodules: enabled }, ctx);
										settingsList.updateValue(id, newValue);
										notifyChange("Ignore submodules", newValue);
										return;
									}

									if (
										id === "extensionStatusDefaultPlacement" &&
										isExtensionStatusPlacement(newValue)
									) {
										deps.setExtensionStatusDefaultPlacement(newValue);
										settingsList = makeSettingsList("extensionStatusDefaultPlacement");
										notifyChange("Default extension status placement", newValue);
										return;
									}
									const thirdParty = thirdPartyStatusSettingFromId(id);
									if (thirdParty?.kind === "placement" && isExtensionStatusPlacement(newValue)) {
										deps.setExtensionStatusPlacement(thirdParty.key, newValue);
										settingsList.updateValue(id, newValue);
										notifyChange(`Third-party status ${thirdParty.key} placement`, newValue);
										return;
									}
									if (thirdParty?.kind === "colorMode" && isExtensionStatusColorMode(newValue)) {
										deps.setExtensionStatusColorMode(thirdParty.key, newValue);
										settingsList.updateValue(id, newValue);
										notifyChange(`Third-party status ${thirdParty.key} color`, newValue);
									}
								} catch (error) {
									stopPreview();
									settingsList = makeSettingsList(id);
									tui.requestRender();
									ctx.ui.notify(
										`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
										"error",
									);
								}
							},
							() => finishSettings("close"),
						);
						if (focusId) {
							const target = items.findIndex((item) => item.id === focusId);
							for (let index = 0; index < target; index += 1) list.handleInput("\x1b[B");
						}
						return list;
					};
					settingsList = makeSettingsList(initialFocusId);
					startPreview();
					const renderPreviewRows = (previewWidth: number): string[] => {
						if (previewWidth <= 0) return [];
						if (activeSection === "editor")
							return renderEditorSettingsPreview(deps.getConfig(), theme, previewWidth);
						if (activeSection === "userMessages")
							return renderUserMessageSettingsPreview(deps.getConfig(), theme, previewWidth);
						if (activeSection === "thinkingSteps")
							return renderThinkingStepsSettingsPreview(
								deps.getConfig(),
								theme,
								previewWidth,
								deps.thinkingStepsCapability,
							);
						if (activeSection === "workingLine" && preview && preview.frames.length > 0)
							return [
								truncateToWidth(
									preview.frames[previewFrameIndex] ?? preview.frames[0],
									Math.min(SETTINGS_PREVIEW_MAX_WIDTH, previewWidth),
									"",
								),
							];
						return [];
					};
					return {
						render(width: number) {
							const border = renderChromeBorder(
								theme,
								deps.getConfig().components.selectorBorders.colorSource,
								EDITOR_BORDER_STYLE,
								"─".repeat(Math.max(0, width)),
							);
							const settingsRows = withSectionFooter(settingsList.render(width), theme).map(
								(line) => truncateToWidth(line, width, ""),
							);
							const previewRows = renderPreviewRows(Math.max(0, width - 4));
							while (previewRows.length > 0 && visibleWidth(previewRows.at(-1) ?? "") === 0)
								previewRows.pop();
							const indentedPreviewRows = previewRows.map((line) =>
								truncateToWidth(`  ${line}`, width, ""),
							);
							const bodyRows = indentedPreviewRows.some((line) => visibleWidth(line) > 0)
								? ["", ...indentedPreviewRows, "", ...settingsRows]
								: settingsRows;
							return [
								truncateToWidth(border, width, ""),
								truncateToWidth(formatSectionTabs(activeSection, theme, width), width, ""),
								truncateToWidth(border, width, ""),
								...bodyRows,
								truncateToWidth(border, width, ""),
							];
						},
						invalidate() {
							settingsList.invalidate();
						},
						handleInput(data: string) {
							if (matchesKey(data, Key.tab)) {
								stopPreview();
								activeSection = nextSection(activeSection);
								settingsList = makeSettingsList();
								startPreview();
								tui.requestRender();
								return;
							}
							if (matchesKey(data, Key.shift("tab"))) {
								stopPreview();
								activeSection = previousSection(activeSection);
								settingsList = makeSettingsList();
								startPreview();
								tui.requestRender();
								return;
							}
							settingsList.handleInput(data);
						},
						dispose() {
							stopPreview();
						},
					};
				});
				if (outcome === "close" || outcome === undefined) return;
				if (
					outcome === "edit-working-line-spinner-speed" ||
					outcome === "edit-working-line-text-speed"
				) {
					const spinnerSpeed = outcome === "edit-working-line-spinner-speed";
					const workingLine = deps.getConfig().components.workingLine;
					const before = spinnerSpeed ? workingLine.spinnerIntervalMs : workingLine.textIntervalMs;
					const label = spinnerSpeed ? "Spinner speed" : "Text motion speed";
					try {
						const edited = await ctx.ui.input(
							`${label} (${MIN_WORKING_LINE_INTERVAL_MS}–${MAX_WORKING_LINE_INTERVAL_MS} ms)`,
							String(before),
						);
						if (edited === undefined) {
							ctx.ui.notify(`${label} unchanged (input canceled)`, "info");
						} else {
							const trimmed = edited.trim();
							const intervalMs = /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
							if (!isValidWorkingLineIntervalMs(intervalMs)) {
								ctx.ui.notify(
									`${label} must be a whole number from ${MIN_WORKING_LINE_INTERVAL_MS} to ${MAX_WORKING_LINE_INTERVAL_MS} ms; unchanged.`,
									"warning",
								);
							} else {
								const result = deps.setWorkingLineComponent(
									spinnerSpeed ? { spinnerIntervalMs: intervalMs } : { textIntervalMs: intervalMs },
									ctx,
								);
								ctx.ui.notify(
									`${label}: ${intervalMs} ms${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
									"info",
								);
							}
						}
					} catch (error) {
						ctx.ui.notify(
							`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					}
					requestedSection = "workingLine";
					requestedFocusId = spinnerSpeed ? "workingLineSpinnerSpeed" : "workingLineTextSpeed";
					continue;
				}
				try {
					const before = deps.getConfig().components.workingLine.messages.values.join("\n");
					const edited = await ctx.ui.editor("Working line message list", before);
					if (edited !== undefined) {
						const values = normalizeWorkingLineMessages(edited.split(/\r?\n/));
						const result = deps.setWorkingLineComponent({ messages: { values } }, ctx);
						ctx.ui.notify(
							`Message list: ${values.length}${values.length === 0 ? " (using styled Working…)" : ""}${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
							"info",
						);
					}
				} catch (error) {
					ctx.ui.notify(
						`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
				requestedSection = "workingLine";
				requestedFocusId = "workingLineMessageList";
			}
		},
	});
}
