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
import { type ColorOwner, componentColor } from "./component-colors";
import {
	type ComponentSettingsDeps,
	confirmComponentMigration,
	editComponentColors,
} from "./component-settings";
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
import { prepareEditorTextForCustomUi } from "./editor-transfer";
import { sanitizeExtensionStatusText } from "./extension-status";
import { isIconMode } from "./icons";
import {
	componentPresets,
	getComponentPreset,
	matchingComponentPreset,
	type PresetId,
} from "./presets";
import type { SessionLifecycle } from "./session-lifecycle";
import { settingsKeys } from "./settings-keys";
import { selectOwnedSetting } from "./settings-list-selection";
import {
	renderEditorSettingsPreview,
	renderThinkingStepsSettingsPreview,
	renderUserMessageSettingsPreview,
	SETTINGS_PREVIEW_MAX_WIDTH,
} from "./settings-previews";
import { EDITOR_BORDER_FALLBACK, renderStyleForSourceOrFallback, safeThemeFg } from "./style";
import { formatThinkingStatus, thinkingStatusLabels } from "./thinking-status";
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
const thinkingStepsModeValues = (startupMode: ThinkingStepsMode): string[] => {
	if (startupMode === "streaming") return ["Streaming", "Tree", "Rail"];
	if (startupMode === "rail") return ["Rail", "Tree", "Streaming"];
	return ["Tree", "Rail", "Streaming"];
};

const settingsSections = [
	"appearance",
	"editor",
	"userMessages",
	"thinkingSteps",
	"workingLine",
	"footer",
] as const;
const footerPages = ["segments", "git", "extensions"] as const;
type FooterPage = (typeof footerPages)[number];
type TopLevelSection = (typeof settingsSections)[number];
type FeatureState = "enabled" | "disabled";
type SettingsSection = TopLevelSection | FooterPage;

function isFooterPage(section: string): section is FooterPage {
	return footerPages.some((page) => page === section);
}
function topLevelSection(section: SettingsSection): TopLevelSection {
	return isFooterPage(section) ? "footer" : section;
}
function footerPageSettingId(page: FooterPage): string {
	return `footerPage:${page}`;
}
type FooterSegmentSettingId = keyof FooterSegmentsConfig;
type EditorPatch = Partial<
	Pick<
		EditorComponentConfig,
		| "enabled"
		| "style"
		| "colorSource"
		| "borderColorMode"
		| "modelLabel"
		| "viewportIndicators"
		| "codexQuota"
	>
>;
type UserMessagesPatch = Partial<
	Pick<UserMessagesComponentConfig, "enabled" | "style" | "colorSource">
>;
type FooterPatch = Partial<
	Pick<FooterComponentConfig, "style" | "colorSource" | "modelLabel" | "codexQuota">
>;
type ApplyResult = { applied: boolean; reason?: string };
type SettingsOutcome =
	| "close"
	| "migrate"
	| `edit-colors:${ColorOwner}`
	| "edit-working-line-messages"
	| "edit-working-line-spinner-speed"
	| "edit-working-line-text-speed";

type ThinkingControllerState = Readonly<{
	available: boolean;
	rendererAvailable?: boolean;
	streamingAvailable?: boolean;
	streamingPoisoned?: boolean;
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

type SettingsCommandDeps = Omit<ComponentSettingsDeps, "getConfig"> & {
	sessionLifecycle: SessionLifecycle;
	getConfig: () => PolishedTuiConfig;
	applyPreset: (
		id: PresetId,
		ctx: ExtensionContext,
		options?: { deferEditor?: boolean },
	) => ApplyResult;
	reconcilePresetEditor: (ctx: ExtensionContext) => ApplyResult;
	setEditorComponent: (
		patch: EditorPatch,
		ctx: ExtensionContext,
		options?: { deferEditor?: boolean },
	) => ApplyResult;
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
		patch: Partial<Omit<SelectorBordersComponentConfig, "colors">>,
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
	extensions: "Extension statuses",
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

function footerSegmentDescription(key: FooterSegmentSettingId): string {
	if (key === "gitCounts")
		return "Show numeric ahead/behind and stash counts in built-in segments and template git-status variables.";
	return `Built-in layout: ${footerSegmentSettingDescriptions[key]} Explicit wide format and compactFormat templates choose their own segments, independent of these toggles.`;
}

const sectionRoutes: Record<string, SettingsSection> = {
	appearance: "appearance",
	editor: "editor",
	messages: "userMessages",
	"user-messages": "userMessages",
	thinking: "thinkingSteps",
	"thinking-steps": "thinkingSteps",
	"working-line": "workingLine",
	footer: "footer",
	statusline: "footer",
	status: "footer",
	"status-line": "footer",
	segments: "segments",
	git: "git",
	extensions: "extensions",
};

const directCommandSuggestions = [
	...Object.keys(sectionRoutes),
	"migrate",
	...componentPresets.map(({ id }) => `preset ${id}`),
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
	return sectionRoutes[args.trim().toLowerCase().replaceAll(/[_ ]+/g, "-")];
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const normalized = prefix.trimStart().toLowerCase();
	const matches = directCommandSuggestions
		.map((value) => ({
			value,
			label: isFooterPage(value) ? `${value} — Footer > ${sectionLabels[value]}` : value,
		}))
		.filter((item) => item.value.startsWith(normalized));
	return matches.length ? matches : null;
}

function usageText(): string {
	return "Usage: /zentui [editor|messages|statusline|viewport-indicators] [enable|disable|toggle], /zentui [appearance|editor|user-messages|thinking|working-line|footer|segments|git|extensions], /zentui preset <opencode|opencode-copy-friendly|rail|minimalist>, or /zentui format <template>";
}

function buildAppearanceItems(config: PolishedTuiConfig): SettingItem[] {
	const component = config.components.selectorBorders;
	return [
		{
			id: "preset",
			label: "Preset",
			description:
				"Apply Editor, Footer, and User messages together once. Preserves colors and other settings; editor installation waits until this panel closes. Custom means no matching combination.",
			currentValue: matchingComponentPreset(config)?.label ?? "Custom",
			values: componentPresets.map(({ label }) => label),
		},
		{
			id: "selectorBordersEnabled",
			label: "Selector borders",
			description: "Disable to leave selector borders native or predecessor-controlled.",
			currentValue: featureValue(component.enabled),
			values: featureStateValues,
		},
		{
			id: "selectorBordersStyle",
			label: "Selector border style",
			description: "Zentui is the only selector-border treatment. Informational, not a choice.",
			currentValue: component.style,
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
			description:
				"Auto assumes a Nerd Font (no font detection), as does Nerd. ASCII replaces icons only, not every UI border or glyph.",
			currentValue: config.icons.mode,
			values: iconModeValues,
		},
	];
}

const codexQuotaDescription =
	"Remaining ChatGPT account quota for active openai-codex. Authenticated background refresh roughly every minute while active. Custom templates require $codex_quota; the toggle always gates access.";

function buildEditorItems(config: PolishedTuiConfig): SettingItem[] {
	const editor = config.components.editor;
	return [
		{
			id: "editorEnabled",
			label: "Editor",
			description:
				"Disable to leave the editor native or predecessor-controlled; saved preferences are retained.",
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
			id: "editorCodexQuota",
			label: "Codex quota",
			description: codexQuotaDescription,
			currentValue: featureValue(editor.codexQuota),
			values: featureStateValues,
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
			description: "Show Pi's native wrapped-row counts when editor content is clipped.",
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
			description:
				"Disable to leave previous messages native or predecessor-controlled; saved preferences are retained.",
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
	const status = formatThinkingStatus(thinkingStatusLabels(thinkingSteps, controller));
	const enabledDescription = `${status} Live switching supports Streaming → Rail/Tree and Rail ↔ Tree. Entering Streaming, first enable, and re-enable after live disable require restart. Private renderer may break after Pi updates.`;
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
			description: `${status} Rail shows every parsed label; Tree shows the latest five per contiguous run; both follow Pi thinking visibility, and unsafe or unstructured content remains native. Streaming folds to the latest five host-rendered rows and owns the configured thinking toggle only when active. Incompatibility uses native thinking.`,
			currentValue: thinkingStepsModeLabels[thinkingSteps.mode],
			values: thinkingStepsModeValues(controller.startup.mode),
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
			description:
				"Native leaves Pi or a predecessor unowned; Starship installs Zentui; Hidden intentionally owns zero rows.",
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
				id: "footerCodexQuota",
				label: "Codex quota",
				description: codexQuotaDescription,
				currentValue: featureValue(footer.codexQuota),
				values: featureStateValues,
			},
			{
				id: "footerModelLabel",
				label: "Footer model label",
				description:
					"Choose the label when built-in Model info or a template's $model is shown; this does not enable that segment.",
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
			description:
				"Reflow the wide layout, then use compactFormat when it cannot fit. An explicit wide format and the compact template choose segments independently of segment toggles.",
			currentValue: featureValue(footer.responsive),
			values: featureStateValues,
		},
		{
			id: "compactFooterMaxLines",
			label: "Compact footer rows",
			description:
				"Maximum compactFormat template rows before cropping; does not change template segments.",
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
			description:
				"Choose built-in/layout separators, including extension-status joins. Their width can affect when the layout switches to compact. Does not change $sep (fixed pipe) or literal template separators.",
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
		description: footerSegmentDescription(key),
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
		description: footerSegmentDescription(key),
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
					? [
							...buildStarshipFooterStyleItems(config),
							...footerPages.map((page) => ({
								id: footerPageSettingId(page),
								label: sectionLabels[page],
								description:
									page === "extensions"
										? "Place and color published keyed Footer statuses; not extension management or Working line integrations."
										: `Configure Starship Footer ${sectionLabels[page]}; other components are unchanged.`,
								currentValue: "->",
								values: ["->"],
							})),
						]
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
		settingsSections[
			(settingsSections.indexOf(topLevelSection(section)) + 1) % settingsSections.length
		] ?? "appearance"
	);
}
function previousSection(section: SettingsSection): SettingsSection {
	return (
		settingsSections[
			(settingsSections.indexOf(topLevelSection(section)) - 1 + settingsSections.length) %
				settingsSections.length
		] ?? "appearance"
	);
}
function formatSectionTabs(
	active: SettingsSection,
	theme: ExtensionContext["ui"]["theme"],
	width: number,
): string {
	if (isFooterPage(active)) return `  ${theme.bold(`Footer > ${sectionLabels[active]}`)}`;
	const rendered = settingsSections.map((section) =>
		section === active
			? theme.bold(sectionLabels[section])
			: safeThemeFg(theme, "muted", sectionLabels[section]),
	);
	const full = `  ${rendered.join(safeThemeFg(theme, "muted", " / "))}`;
	if (visibleWidth(full) <= width) return full;
	return `  ${theme.bold(sectionLabels[active])} (${settingsSections.indexOf(active) + 1}/${settingsSections.length})`;
}
function markDormantItems(
	items: SettingItem[],
	section: SettingsSection,
	config: PolishedTuiConfig,
): void {
	const editor = config.components.editor;
	const footer = config.components.footer;
	for (const item of items) {
		let reason = "";
		if (section === "editor" && item.id !== "editorEnabled" && !editor.enabled)
			reason = "Editor disabled";
		else if (
			section === "editor" &&
			editor.style === "accent-rail" &&
			["editorModelLabel", "editorBorderColorMode"].includes(item.id)
		)
			reason = "other editor styles; Accent Rail has no model label or enclosing border";
		else if (
			section === "userMessages" &&
			item.id !== "userMessagesEnabled" &&
			!config.components.userMessages.enabled
		)
			reason = "User messages disabled";
		else if (
			section === "workingLine" &&
			item.id !== "workingLineEnabled" &&
			!config.components.workingLine.enabled
		)
			reason = "Working line disabled";
		else if (
			section === "workingLine" &&
			config.components.workingLine.textAnimation === "disabled" &&
			["workingLineTextSpeed", "workingLineAnimateSpinnerColor"].includes(item.id)
		)
			reason = "animated modes; Static ignores color motion";
		else if (
			["footer", "segments", "git", "extensions"].includes(section) &&
			item.id !== "footerStyle" &&
			footer.style !== "starship"
		)
			reason = `Starship; current Footer is ${footerStyleLabel(footer.style)}`;
		else if (item.id === "compactFooterMaxLines" && !footer.styles.starship.responsive)
			reason = "responsive mode";
		else if (item.id === "pathDepth" && footer.styles.starship.pathDisplay.mode === "basename")
			reason = "Full or Repository paths; Basename ignores depth";
		else if (
			["selectorBordersColorSource", "edit-colors:selectorBorders"].includes(item.id) &&
			!config.components.selectorBorders.enabled
		)
			reason = "selector borders disabled";
		if (reason) item.description = `Saved for ${reason}. Inactive now. ${item.description ?? ""}`;
	}
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

	const applyPreset = (id: PresetId, ctx: ExtensionContext) => {
		try {
			const result = deps.applyPreset(id, ctx);
			deps.requestRender();
			if (ctx.hasUI) {
				const detail = result.reason?.trim();
				ctx.ui.notify(
					`Preset saved: ${getComponentPreset(id)?.label}${detail ? ` (${detail})` : !result.applied ? " (reload Pi to apply this change)" : ""}`,
					!result.applied || detail ? "warning" : "info",
				);
			}
		} catch (error) {
			if (ctx.hasUI)
				ctx.ui.notify(
					`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
		}
	};

	pi.registerCommand("zentui", {
		description: "Configure Zentui",
		getArgumentCompletions: argumentCompletions,
		handler: async (_args, ctx) => {
			const args = typeof _args === "string" ? _args : "";
			const words = args.trim().split(/\s+/);
			if (args.trim().toLowerCase() === "migrate") {
				await confirmComponentMigration(ctx, deps);
				return;
			}
			if (words[0]?.toLowerCase() === "preset") {
				const preset = words.length === 2 ? getComponentPreset(words[1] ?? "") : undefined;
				if (preset) applyPreset(preset.id, ctx);
				else if (ctx.hasUI) ctx.ui.notify(usageText(), "warning");
				return;
			}
			const format = parseFormatCommand(args);
			if (format) {
				try {
					deps.setFooterFormat(format.value ?? "", ctx);
					deps.requestRender();
					if (ctx.hasUI)
						ctx.ui.notify(
							format.value === undefined
								? "Footer wide format cleared (using built-in segments; compactFormat unchanged)"
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
				if (!deps.sessionLifecycle.isCurrent()) return;
				try {
					prepareEditorTextForCustomUi(ctx.ui);
				} catch (error) {
					ctx.ui.notify(
						`Could not open Zentui settings safely: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return;
				}
				const initialFocusId = requestedFocusId;
				requestedFocusId = undefined;
				const generation = deps.sessionLifecycle.currentGeneration();
				let pendingPresetEditor = false;
				let outcome: SettingsOutcome | undefined;
				try {
					outcome = await ctx.ui.custom<SettingsOutcome>((tui, theme, keybindings, done) => {
						const keys = settingsKeys(keybindings);
						let selectedIndex = 0;
						let currentItems: SettingItem[] = [];
						let listVisible = 8;
						const listTheme = deps.settingsListTheme ?? getSettingsListTheme();
						let activeSection = requestedSection;
						let settingsList: SettingsList;
						let activateSelectedSetting = () => {};
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
							if (
								["User messages", "Selector borders", "Responsive footer", "Path display"].includes(
									label,
								)
							)
								settingsList = makeSettingsList(currentItems[selectedIndex]?.id);
							deps.requestRender();
							const detail = result?.reason?.trim();
							ctx.ui.notify(
								`${label}: ${value}${detail ? ` (${detail})` : result && !result.applied ? " (reload Pi to apply this change)" : ""}`,
								result && (!result.applied || detail) ? "warning" : "info",
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
							if (label === "Working line" || label === "Text animation")
								settingsList = makeSettingsList(currentItems[selectedIndex]?.id);
							ctx.ui.notify(
								`${label}: ${value}${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
								"info",
							);
							if (previewChanged) startPreview();
							tui.requestRender();
						};
						const backOrClose = () => {
							if (isFooterPage(activeSection) && deps.sessionLifecycle.isCurrent(generation)) {
								const focusId = footerPageSettingId(activeSection);
								activeSection = "footer";
								settingsList = makeSettingsList(focusId);
								tui.requestRender();
							} else finishSettings("close");
						};
						const makeSettingsList = (focusId?: string): SettingsList => {
							if (
								isFooterPage(activeSection) &&
								deps.getConfig().components.footer.style !== "starship"
							) {
								ctx.ui.notify(
									`Footer > ${sectionLabels[activeSection]} requires Starship. Current Footer is ${footerStyleLabel(deps.getConfig().components.footer.style)}; saved settings are unchanged.`,
									"info",
								);
								activeSection = "footer";
								focusId = "footerStyle";
							}
							const items = buildSectionItems(
								activeSection,
								deps.getConfig(),
								deps.getActiveExtensionStatuses(),
								deps.thinkingStepsCapability,
							);
							const colorOwner =
								activeSection === "appearance"
									? "selectorBorders"
									: activeSection === "editor" ||
											activeSection === "userMessages" ||
											activeSection === "workingLine" ||
											activeSection === "footer"
										? activeSection
										: undefined;
							if (colorOwner)
								items.push({
									id: `edit-colors:${colorOwner}`,
									label: "Color overrides",
									description:
										"Edit only this component's raw styles. Roles unused by the selected style stay saved for other styles; Static Working line uses mid; Turn summaries use high. Reset resumes inheritance; empty means unstyled.",
									currentValue: "Edit…",
									values: ["Edit…"],
								});
							if (activeSection === "appearance")
								items.push({
									id: "migrate",
									label: "Migrate component selections",
									description:
										"Explicit, confirmed snapshot of all current selections. Shared color fallbacks remain active.",
									currentValue: "Confirm…",
									values: ["Confirm…"],
								});
							markDormantItems(items, activeSection, deps.getConfig());
							currentItems = items;
							selectedIndex = Math.max(
								0,
								items.findIndex((item) => item.id === focusId),
							);
							const actions = {
								change(id: string, newValue: string) {
									try {
										if (!deps.sessionLifecycle.isCurrent(generation)) return;
										const footerPage = footerPages.find((page) => footerPageSettingId(page) === id);
										if (footerPage) {
											activeSection = footerPage;
											settingsList = makeSettingsList();
											tui.requestRender();
											return;
										}
										if (
											isFooterPage(activeSection) &&
											deps.getConfig().components.footer.style !== "starship"
										) {
											settingsList = makeSettingsList();
											tui.requestRender();
											return;
										}
										if (id === "migrate" || id.startsWith("edit-colors:")) {
											requestedSection = activeSection;
											requestedFocusId = id;
											finishSettings(id as SettingsOutcome);
											return;
										}
										if (id === "preset") {
											const preset = componentPresets.find(({ label }) => label === newValue);
											if (!preset) return;
											if (!deps.sessionLifecycle.isCurrent(generation)) return;
											const result = deps.applyPreset(preset.id, ctx, { deferEditor: true });
											pendingPresetEditor = true;
											settingsList = makeSettingsList("preset");
											notifyChange("Preset saved", preset.label, result);
											return;
										}
										const enabled = isFeatureState(newValue) ? newValue === "enabled" : undefined;
										if (
											(id === "editorCodexQuota" || id === "footerCodexQuota") &&
											enabled !== undefined
										) {
											if (id === "editorCodexQuota") setEditor({ codexQuota: enabled }, ctx);
											else setFooter({ codexQuota: enabled }, ctx);
											settingsList.updateValue(id, newValue);
											notifyChange("Codex quota", newValue);
											return;
										}
										if (id === "editorEnabled" && enabled !== undefined) {
											if (pendingPresetEditor) {
												const result = deps.setEditorComponent({ enabled }, ctx, {
													deferEditor: true,
												});
												notifyChange("Editor", newValue, result);
												finishSettings("close");
												return;
											}
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
								activate() {
									// Panel rows use value cycles (including one-value dialog actions).
									// Share the native onChange route, not a synthetic key that native
									// navigation bindings could consume before activation.
									const item = items[selectedIndex];
									if (!item?.values?.length) return;
									const next = (item.values.indexOf(item.currentValue) + 1) % item.values.length;
									actions.change(item.id, item.values[next]);
								},
							};
							const list = new SettingsList(
								items,
								listVisible,
								// Native hint text is not binding-aware. Own the hint surface via its supported theme callback.
								{ ...listTheme, hint: () => "" },
								actions.change,
								backOrClose,
							);
							activateSelectedSetting = actions.activate;
							if (focusId && !selectOwnedSetting(list, items, focusId)) selectedIndex = 0;
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
								if (width <= 0) return [];
								const border = renderStyleForSourceOrFallback(
									theme,
									deps.getConfig().components.selectorBorders.colorSource,
									componentColor(deps.getConfig(), "selectorBorders", "border"),
									EDITOR_BORDER_FALLBACK,
									"─".repeat(Math.max(0, width)),
								);
								const height = tui.terminal?.rows ?? 80;
								const help = keys
									.help(width, isFooterPage(activeSection) ? "Back" : "Close")
									.map((line) => safeThemeFg(theme, "muted", line));
								const nextVisible = Math.max(1, Math.min(8, height - help.length - 8));
								if (nextVisible !== listVisible) {
									listVisible = nextVisible;
									settingsList = makeSettingsList(currentItems[selectedIndex]?.id);
								}
								const settingsRows = settingsList
									.render(Math.max(5, width))
									.map((line) => truncateToWidth(line, width, ""));
								while (settingsRows.length && visibleWidth(settingsRows.at(-1) ?? "") === 0)
									settingsRows.pop();
								const bodyBudget = Math.max(1, height - 4 - help.length);
								const previewRows = renderPreviewRows(Math.max(0, width - 4));
								while (previewRows.length > 0 && visibleWidth(previewRows.at(-1) ?? "") === 0)
									previewRows.pop();
								const indentedPreviewRows = previewRows.map((line) =>
									truncateToWidth(`  ${line}`, width, ""),
								);
								const showPreview =
									indentedPreviewRows.length + 2 + settingsRows.length <= bodyBudget;
								const bodyRows =
									showPreview && indentedPreviewRows.some((line) => visibleWidth(line) > 0)
										? ["", ...indentedPreviewRows, "", ...settingsRows]
										: settingsRows.slice(0, bodyBudget);
								bodyRows.push(...help);
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
								// Closing is safe even after shutdown: let Pi restore its saved editor draft.
								if (keys.matches(data, "cancel")) {
									backOrClose();
									return;
								}
								if (!deps.sessionLifecycle.isCurrent(generation)) return;
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
								if (keys.matches(data, "up") || keys.matches(data, "down")) {
									const delta = keys.matches(data, "up") ? -1 : 1;
									const next = (selectedIndex + delta + currentItems.length) % currentItems.length;
									const id = currentItems[next]?.id;
									if (id && selectOwnedSetting(settingsList, currentItems, id))
										selectedIndex = next;
								} else if (keys.matches(data, "confirm") || data === " ") activateSelectedSetting();
								tui.requestRender();
							},
							dispose() {
								stopPreview();
							},
						};
					});
				} catch (error) {
					if (deps.sessionLifecycle.isCurrent(generation))
						ctx.ui.notify(
							`Could not open Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					return;
				}
				// Pi restores its saved editor text before custom() resolves. Reconcile only
				// now, using the latest config and observed factory, never a captured factory.
				if (!deps.sessionLifecycle.isCurrent(generation)) return;
				if (pendingPresetEditor) {
					try {
						const result = deps.reconcilePresetEditor(ctx);
						if (!result.applied || result.reason) {
							ctx.ui.notify(
								`Preset saved: editor (${result.reason ?? "reload Pi to apply this change"})`,
								"warning",
							);
						}
					} catch (error) {
						if (!deps.sessionLifecycle.isCurrent(generation)) return;
						ctx.ui.notify(
							`Could not apply preset editor; reload Pi: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					}
				}
				if (outcome === "close" || outcome === undefined) return;
				if (outcome === "migrate" || outcome.startsWith("edit-colors:")) {
					if (outcome === "migrate") await confirmComponentMigration(ctx, deps);
					else
						await editComponentColors(
							ctx,
							deps,
							outcome.slice("edit-colors:".length) as ColorOwner,
						);
					if (!deps.sessionLifecycle.isCurrent(generation)) return;
					continue;
				}
				if (
					outcome === "edit-working-line-spinner-speed" ||
					outcome === "edit-working-line-text-speed"
				) {
					const spinnerSpeed = outcome === "edit-working-line-spinner-speed";
					const workingLine = deps.getConfig().components.workingLine;
					const before = spinnerSpeed ? workingLine.spinnerIntervalMs : workingLine.textIntervalMs;
					const label = spinnerSpeed ? "Spinner speed" : "Text motion speed";
					try {
						prepareEditorTextForCustomUi(ctx.ui);
						const edited = await ctx.ui.input(
							`${label} (${MIN_WORKING_LINE_INTERVAL_MS}–${MAX_WORKING_LINE_INTERVAL_MS} ms)`,
							String(before),
						);
						if (!deps.sessionLifecycle.isCurrent(generation)) return;
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
						if (!deps.sessionLifecycle.isCurrent(generation)) return;
						ctx.ui.notify(
							`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					}
					if (!deps.sessionLifecycle.isCurrent(generation)) return;
					requestedSection = "workingLine";
					requestedFocusId = spinnerSpeed ? "workingLineSpinnerSpeed" : "workingLineTextSpeed";
					continue;
				}
				try {
					const before = deps.getConfig().components.workingLine.messages.values.join("\n");
					prepareEditorTextForCustomUi(ctx.ui);
					const edited = await ctx.ui.editor("Working line message list", before);
					if (!deps.sessionLifecycle.isCurrent(generation)) return;
					if (edited !== undefined) {
						const values = normalizeWorkingLineMessages(edited.split(/\r?\n/));
						const result = deps.setWorkingLineComponent({ messages: { values } }, ctx);
						ctx.ui.notify(
							`Message list: ${values.length}${values.length === 0 ? " (using styled Working…)" : ""}${result.applied ? "" : ` (${result.reason ?? "reload Pi to apply this change"})`}`,
							"info",
						);
					}
				} catch (error) {
					if (!deps.sessionLifecycle.isCurrent(generation)) return;
					ctx.ui.notify(
						`Could not update Zentui settings: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
				if (!deps.sessionLifecycle.isCurrent(generation)) return;
				requestedSection = "workingLine";
				requestedFocusId = "workingLineMessageList";
			}
		},
	});
}
