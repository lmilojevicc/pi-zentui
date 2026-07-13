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
} from "@earendil-works/pi-tui";
import {
	type ColorSource,
	type ColorSourcesConfig,
	type ContextStyle,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	type FooterSegmentsConfig,
	getExtensionStatusColorMode,
	getExtensionStatusPlacement,
	type IconMode,
	isExtensionStatusColorMode,
	isExtensionStatusPlacement,
	type PathDisplayConfig,
	type PathDisplayMode,
	type PolishedTuiConfig,
	type UiFeaturesConfig,
} from "./config";
import { sanitizeExtensionStatusText } from "./extension-status";
import { isIconMode } from "./icons";
import { EDITOR_BORDER_STYLE, renderChromeBorder, safeThemeFg } from "./style";

const colorSourceValues: ColorSource[] = ["theme", "terminal"];
const extensionStatusPlacementValues: ExtensionStatusPlacement[] = [
	"off",
	"left",
	"middle",
	"right",
];
const extensionStatusColorModeValues: ExtensionStatusColorMode[] = ["zentui", "original"];
const contextStyleValues: ContextStyle[] = ["text", "gauge", "text+gauge"];
const pathDisplayModeValues: PathDisplayMode[] = ["basename", "full"];
const pathDepthValues = ["0", "1", "2", "3", "4", "5"] as const;
const iconModeValues: IconMode[] = ["auto", "nerd", "ascii"];
type FeatureState = "enabled" | "disabled";

const featureStateValues: FeatureState[] = ["enabled", "disabled"];
const settingsSections = [
	"coloring",
	"features",
	"layout",
	"builtinSegments",
	"extensionSegments",
] as const;

type ColorSettingId = "starship" | "editorMessages";
type FeatureSettingId = keyof UiFeaturesConfig;
type FooterSegmentSettingId = keyof FooterSegmentsConfig;
type SettingsSection = (typeof settingsSections)[number];
type LayoutSettingId = "contextStyle" | "pathDisplay" | "pathDepth" | "iconMode";

type SettingsCommandDeps = {
	getConfig: () => PolishedTuiConfig;
	setColorSources: (patch: Partial<ColorSourcesConfig>) => void;
	setUiFeatures: (
		patch: Partial<UiFeaturesConfig>,
		ctx: ExtensionContext,
	) => { applied: boolean; reason?: string };
	setFooterSegments: (patch: Partial<FooterSegmentsConfig>) => void;
	setFooterFormat: (value: string) => void;
	setIconMode: (mode: IconMode) => void;
	setContextStyle: (style: ContextStyle) => void;
	setPathDisplay: (patch: Partial<PathDisplayConfig>) => void;
	getActiveExtensionStatuses: () => ReadonlyMap<string, string>;
	setExtensionStatusPlacement: (key: string, placement: ExtensionStatusPlacement) => void;
	setExtensionStatusColorMode: (key: string, colorMode: ExtensionStatusColorMode) => void;
	requestRender: () => void;
	settingsListTheme?: SettingsListTheme;
};

const colorSettingLabels: Record<ColorSettingId, string> = {
	starship: "Starship/footer colors",
	editorMessages: "Editor + previous messages",
};

const colorSettingDescriptions: Record<ColorSettingId, string> = {
	starship:
		"Choose whether footer runtime/git/context colors use Pi theme tokens or terminal palette styles.",
	editorMessages:
		"Choose whether editor and previous user-message borders/rails use Pi theme colors or terminal palette styles.",
};

const featureSettingLabels: Record<FeatureSettingId, string> = {
	editor: "Editor",
	statusLine: "Status line",
	copyFriendly: "Copy-friendly mode",
};

const featureSettingDescriptions: Record<FeatureSettingId, string> = {
	editor:
		"Enable or disable Zentui's custom editor, selector borders, and previous-message chrome.",
	statusLine: "Enable or disable Zentui's custom footer/status line.",
	copyFriendly:
		"Hide editor and previous-message rail glyphs for cleaner native terminal selection.",
};

const footerSegmentSettingLabels: Record<FooterSegmentSettingId, string> = {
	cwd: "Current directory",
	gitBranch: "Git branch",
	gitStatus: "Git status",
	gitCounts: "Git counts",
	sessionDuration: "Session duration",
	username: "Username@host",
	time: "Current time",
	os: "OS icon",
	runtime: "Runtime",
	context: "Context usage",
	tokens: "Token counts",
	cost: "Session cost",
	packageVersion: "Package version",
	gitCommit: "Git commit",
	gitMetrics: "Git line metrics",
};

const footerSegmentSettingDescriptions: Record<FooterSegmentSettingId, string> = {
	cwd: "Show or hide the current working directory segment on the left.",
	gitBranch: "Show or hide the git branch name on the left.",
	gitStatus: "Show or hide git status icons and ahead/behind markers.",
	gitCounts:
		"Show numeric ahead/behind and stash counts (requires the Git status segment to be enabled).",
	sessionDuration: "Show session running time on the left, after the runtime.",
	username: "Show user@hostname on the left.",
	time: "Show the current time (HH:MM) on the right.",
	os: "Show an operating-system icon on the left.",
	runtime: "Show or hide the detected runtime/language segment on the left.",
	context: "Show or hide context usage on the right.",
	tokens: "Show or hide input/output token counts on the right.",
	cost: "Show or hide session cost on the right.",
	packageVersion:
		"Show the project’s own manifest version (package.json, Cargo.toml, pyproject.toml, …). Distinct from the runtime segment, which shows the installed toolchain version.",
	gitCommit:
		"Show the current commit hash (and optional exact-match tag). On detached HEAD this provides context the branch segment can’t. Starship `git_commit`-style; default off.",
	gitMetrics:
		"Show aggregate added/deleted line counts (e.g. `+12 −3`) via `git diff HEAD --numstat`. Complements the git status counts. Starship `git_metrics`-style; default off.",
};

const directCommandSuggestions = [
	"editor enable",
	"editor disable",
	"editor toggle",
	"statusline enable",
	"statusline disable",
	"statusline toggle",
	"copy-friendly enable",
	"copy-friendly disable",
	"copy-friendly toggle",
	"format clear",
	"format $cwd on $git_branch $fill $context",
	"format $cwd( on $git_branch)($git_status)$fill($context)( | $cost)",
];

const sectionLabels: Record<SettingsSection, string> = {
	coloring: "Coloring",
	features: "Features",
	layout: "Layout",
	builtinSegments: "Built-in segments",
	extensionSegments: "Extension segments",
};

const thirdPartyStatusSettingPrefix = "thirdPartyStatus:";
const footerSegmentSettingPrefix = "footerSegment:";
type ThirdPartyStatusSettingKind = "placement" | "colorMode";

function isColorSource(value: string): value is ColorSource {
	return value === "theme" || value === "terminal";
}

function isColorSettingId(value: string): value is ColorSettingId {
	return value === "starship" || value === "editorMessages";
}

function isFeatureSettingId(value: string): value is FeatureSettingId {
	return value === "editor" || value === "statusLine" || value === "copyFriendly";
}

function isFooterSegmentSettingId(value: string): value is FooterSegmentSettingId {
	return (
		value === "cwd" ||
		value === "gitBranch" ||
		value === "gitStatus" ||
		value === "gitCounts" ||
		value === "sessionDuration" ||
		value === "runtime" ||
		value === "context" ||
		value === "tokens" ||
		value === "cost" ||
		value === "username" ||
		value === "time" ||
		value === "os" ||
		value === "packageVersion"
	);
}

function isFeatureState(value: string): value is FeatureState {
	return value === "enabled" || value === "disabled";
}

function isContextStyle(value: string): value is ContextStyle {
	return value === "text" || value === "gauge" || value === "text+gauge";
}

function isPathDisplayMode(value: string): value is PathDisplayMode {
	return value === "basename" || value === "full";
}

function isPathDepthValue(value: string): boolean {
	return (pathDepthValues as readonly string[]).includes(value);
}

function isLayoutSettingId(value: string): value is LayoutSettingId {
	return (
		value === "contextStyle" ||
		value === "pathDisplay" ||
		value === "pathDepth" ||
		value === "iconMode"
	);
}

function editorMessageValue(config: PolishedTuiConfig): ColorSource | "mixed" {
	return config.colorSources.editor === config.colorSources.userMessages
		? config.colorSources.editor
		: "mixed";
}

function patchForSetting(id: ColorSettingId, value: ColorSource): Partial<ColorSourcesConfig> {
	return id === "starship" ? { starship: value } : { editor: value, userMessages: value };
}

function featureValue(enabled: boolean): FeatureState {
	return enabled ? "enabled" : "disabled";
}

function featurePatch(id: FeatureSettingId, value: FeatureState): Partial<UiFeaturesConfig> {
	return { [id]: value === "enabled" } as Partial<UiFeaturesConfig>;
}

function footerSegmentSettingId(key: FooterSegmentSettingId): string {
	return `${footerSegmentSettingPrefix}${key}`;
}

function footerSegmentSettingFromId(id: string): FooterSegmentSettingId | undefined {
	if (!id.startsWith(footerSegmentSettingPrefix)) return undefined;
	const key = id.slice(footerSegmentSettingPrefix.length);
	return isFooterSegmentSettingId(key) ? key : undefined;
}

function footerSegmentPatch(
	id: FooterSegmentSettingId,
	value: FeatureState,
): Partial<FooterSegmentsConfig> {
	return { [id]: value === "enabled" } as Partial<FooterSegmentsConfig>;
}

function usageText(): string {
	return 'Usage: /zentui [editor|statusline|copy-friendly] [enable|disable|toggle] or /zentui format "<template>"';
}

function featureNotification(
	feature: FeatureSettingId,
	value: FeatureState,
	result: { applied: boolean; reason?: string },
): string {
	const base = `${featureSettingLabels[feature]}: ${value}`;
	return result.applied ? base : `${base} (${result.reason ?? "reload Pi to apply this change"})`;
}

function parseDirectFeatureCommand(
	args: string,
	config: PolishedTuiConfig,
): { feature: FeatureSettingId; enabled: boolean } | undefined {
	const normalized = args.trim().toLowerCase().replaceAll(/[_-]+/g, " ");
	if (!normalized) return undefined;

	const words = normalized.split(/\s+/g).filter(Boolean);
	const hasWord = (value: string) => words.includes(value);
	const feature = hasWord("editor")
		? "editor"
		: hasWord("footer") || hasWord("statusline") || hasWord("status")
			? "statusLine"
			: hasWord("copyfriendly") || hasWord("copy")
				? "copyFriendly"
				: undefined;
	const action = hasWord("toggle")
		? "toggle"
		: hasWord("enable") || hasWord("enabled") || hasWord("on")
			? "enable"
			: hasWord("disable") || hasWord("disabled") || hasWord("off")
				? "disable"
				: undefined;

	if (!feature || !action) return undefined;

	return {
		feature,
		enabled: action === "toggle" ? !config.features[feature] : action === "enable",
	};
}

function parseFormatCommand(args: string): { value: string | undefined } | undefined {
	const trimmed = args.trim();
	if (!trimmed.toLowerCase().startsWith("format")) return undefined;

	const rest = trimmed.slice("format".length).trim();
	if (!rest || rest.toLowerCase() === "clear") return { value: undefined };

	const unquoted =
		rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2 ? rest.slice(1, -1) : rest;
	return { value: unquoted };
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const trimmedPrefix = prefix.trimStart().toLowerCase();
	const items = directCommandSuggestions.map((value) => ({ value, label: value }));
	const matches = items.filter((item) => item.value.startsWith(trimmedPrefix));
	return matches.length > 0 ? matches : null;
}

function thirdPartyStatusSettingId(key: string, kind: ThirdPartyStatusSettingKind): string {
	return `${thirdPartyStatusSettingPrefix}${kind}:${key}`;
}

function thirdPartyStatusSettingFromId(
	id: string,
): { kind: ThirdPartyStatusSettingKind; key: string } | undefined {
	if (!id.startsWith(thirdPartyStatusSettingPrefix)) return undefined;
	const rest = id.slice(thirdPartyStatusSettingPrefix.length);
	const separatorIndex = rest.indexOf(":");
	if (separatorIndex < 0) return undefined;

	const kind = rest.slice(0, separatorIndex);
	if (kind !== "placement" && kind !== "colorMode") return undefined;

	return { kind, key: rest.slice(separatorIndex + 1) };
}

function buildItems(
	section: SettingsSection,
	config: PolishedTuiConfig,
	activeStatuses: ReadonlyMap<string, string>,
): SettingItem[] {
	if (section === "coloring") {
		return (Object.keys(colorSettingLabels) as ColorSettingId[]).map((key) => ({
			id: key,
			label: colorSettingLabels[key],
			description: colorSettingDescriptions[key],
			currentValue: key === "starship" ? config.colorSources.starship : editorMessageValue(config),
			values: colorSourceValues,
		}));
	}

	if (section === "features") {
		return (Object.keys(featureSettingLabels) as FeatureSettingId[]).map((key) => ({
			id: key,
			label: featureSettingLabels[key],
			description: featureSettingDescriptions[key],
			currentValue: featureValue(config.features[key]),
			values: featureStateValues,
		}));
	}

	if (section === "layout") {
		return [
			{
				id: "contextStyle",
				label: "Context style",
				description: "Render context as text, a gauge bar, or both.",
				currentValue: config.contextStyle,
				values: contextStyleValues,
			},
			{
				id: "pathDisplay",
				label: "Path display",
				description: "Show cwd as basename or full path (home contracted to ~).",
				currentValue: config.pathDisplay.mode,
				values: pathDisplayModeValues,
			},
			{
				id: "pathDepth",
				label: "Path depth",
				description:
					"In full mode, trailing directories to show (0 = all, max 5). Ignored for basename.",
				currentValue: String(config.pathDisplay.depth),
				values: [...pathDepthValues],
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

	if (section === "builtinSegments") {
		return (Object.keys(footerSegmentSettingLabels) as FooterSegmentSettingId[]).map((key) => ({
			id: footerSegmentSettingId(key),
			label: footerSegmentSettingLabels[key],
			description: footerSegmentSettingDescriptions[key],
			currentValue: featureValue(config.footerSegments[key]),
			values: featureStateValues,
		}));
	}

	const statuses = Array.from(activeStatuses.entries()).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);
	if (statuses.length === 0) {
		return [
			{
				id: "noThirdPartyStatuses",
				label: "No active statuses",
				description: "This tab only lists statuses currently published through ctx.ui.setStatus().",
				currentValue: "—",
			},
		];
	}

	return statuses.flatMap(([key, value]) => {
		const sanitizedText = sanitizeExtensionStatusText(value);
		const description = sanitizedText ? `Current status: ${sanitizedText}` : undefined;
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
	});
}

function nextSection(section: SettingsSection): SettingsSection {
	const currentIndex = settingsSections.indexOf(section);
	return settingsSections[(currentIndex + 1) % settingsSections.length] ?? "coloring";
}

function previousSection(section: SettingsSection): SettingsSection {
	const currentIndex = settingsSections.indexOf(section);
	return (
		settingsSections[(currentIndex - 1 + settingsSections.length) % settingsSections.length] ??
		"coloring"
	);
}

function formatSectionTabs(
	activeSection: SettingsSection,
	theme: ExtensionContext["ui"]["theme"],
): string {
	const rendered = settingsSections.map((section) => {
		const label = sectionLabels[section];
		return section === activeSection ? theme.bold(label) : safeThemeFg(theme, "muted", label);
	});
	return `  ${rendered.join(safeThemeFg(theme, "muted", " / "))}`;
}

function withSectionFooter(lines: string[], theme: ExtensionContext["ui"]["theme"]): string[] {
	const next = [...lines];
	for (let index = next.length - 1; index >= 0; index -= 1) {
		if (next[index]?.includes("Enter/Space")) {
			next[index] = safeThemeFg(
				theme,
				"muted",
				"  Enter/Space to change · Tab/Shift+Tab to switch sections · Esc to close",
			);
			break;
		}
	}
	return next;
}

export function registerZentuiSettingsCommand(pi: ExtensionAPI, deps: SettingsCommandDeps): void {
	pi.registerCommand("zentui", {
		description: "Configure Zentui",
		getArgumentCompletions: argumentCompletions,
		handler: async (_args, ctx) => {
			const args = typeof _args === "string" ? _args : "";

			const formatCommand = parseFormatCommand(args);
			if (formatCommand) {
				try {
					deps.setFooterFormat(formatCommand.value ?? "");
					deps.requestRender();
					if (ctx.hasUI) {
						if (formatCommand.value === undefined) {
							ctx.ui.notify("Footer format cleared (using default layout)", "info");
						} else {
							ctx.ui.notify(`Footer format: ${formatCommand.value}`, "info");
						}
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (ctx.hasUI) ctx.ui.notify(`Could not update footer format: ${message}`, "error");
				}
				return;
			}

			const directCommand = parseDirectFeatureCommand(args, deps.getConfig());
			if (directCommand) {
				try {
					const result = deps.setUiFeatures(
						{ [directCommand.feature]: directCommand.enabled },
						ctx,
					);
					deps.requestRender();
					if (ctx.hasUI) {
						ctx.ui.notify(
							featureNotification(
								directCommand.feature,
								featureValue(directCommand.enabled),
								result,
							),
							"info",
						);
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (ctx.hasUI) ctx.ui.notify(`Could not update Zentui settings: ${message}`, "error");
				}
				return;
			}

			if (args.trim()) {
				if (ctx.hasUI) ctx.ui.notify(usageText(), "warning");
				return;
			}

			const mode = (ctx as typeof ctx & { mode?: string }).mode;
			if (!ctx.hasUI || (mode !== undefined && mode !== "tui")) return;

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const settingsListTheme = deps.settingsListTheme ?? getSettingsListTheme();
				let activeSection: SettingsSection = "coloring";
				const applyFeatureChange = (id: FeatureSettingId, newValue: FeatureState) => {
					const result = deps.setUiFeatures(featurePatch(id, newValue), ctx);
					deps.requestRender();
					ctx.ui.notify(featureNotification(id, newValue, result), "info");
					tui.requestRender();
				};
				let settingsList: SettingsList;
				const makeSettingsList = () =>
					new SettingsList(
						buildItems(activeSection, deps.getConfig(), deps.getActiveExtensionStatuses()),
						8,
						settingsListTheme,
						(id, newValue) => {
							try {
								if (isColorSettingId(id) && isColorSource(newValue)) {
									deps.setColorSources(patchForSetting(id, newValue));
									settingsList.updateValue(id, newValue);
									deps.requestRender();
									ctx.ui.notify(`${colorSettingLabels[id]}: ${newValue}`, "info");
									tui.requestRender();
									return;
								}

								if (isFeatureSettingId(id) && isFeatureState(newValue)) {
									settingsList.updateValue(id, newValue);
									if (id === "editor") {
										done(undefined);
										// Changing the editor component while ctx.ui.custom() is active clears the
										// custom component without resolving it, leaving Pi's input loop stuck.
										// Close the settings UI first, then apply the editor swap on the next tick.
										setTimeout(() => {
											try {
												applyFeatureChange(id, newValue);
											} catch (error) {
												const message = error instanceof Error ? error.message : String(error);
												ctx.ui.notify(`Could not update Zentui settings: ${message}`, "error");
											}
										}, 0);
										return;
									}

									applyFeatureChange(id, newValue);
									return;
								}

								if (isLayoutSettingId(id)) {
									if (id === "contextStyle" && isContextStyle(newValue)) {
										deps.setContextStyle(newValue);
										settingsList.updateValue(id, newValue);
										deps.requestRender();
										ctx.ui.notify(`Context style: ${newValue}`, "info");
										tui.requestRender();
										return;
									}

									if (id === "pathDisplay" && isPathDisplayMode(newValue)) {
										deps.setPathDisplay({ mode: newValue });
										settingsList.updateValue(id, newValue);
										deps.requestRender();
										ctx.ui.notify(`Path display: ${newValue}`, "info");
										tui.requestRender();
										return;
									}

									if (id === "pathDepth" && isPathDepthValue(newValue)) {
										deps.setPathDisplay({ depth: Number(newValue) });
										settingsList.updateValue(id, newValue);
										deps.requestRender();
										ctx.ui.notify(`Path depth: ${newValue}`, "info");
										tui.requestRender();
										return;
									}

									if (id === "iconMode" && isIconMode(newValue)) {
										deps.setIconMode(newValue);
										settingsList.updateValue(id, newValue);
										deps.requestRender();
										ctx.ui.notify(`Icon mode: ${newValue}`, "info");
										tui.requestRender();
									}
									return;
								}

								const footerSegmentSetting = footerSegmentSettingFromId(id);
								if (footerSegmentSetting && isFeatureState(newValue)) {
									deps.setFooterSegments(footerSegmentPatch(footerSegmentSetting, newValue));
									settingsList.updateValue(id, newValue);
									deps.requestRender();
									ctx.ui.notify(
										`${footerSegmentSettingLabels[footerSegmentSetting]}: ${newValue}`,
										"info",
									);
									tui.requestRender();
									return;
								}

								const thirdPartyStatusSetting = thirdPartyStatusSettingFromId(id);
								if (
									thirdPartyStatusSetting?.kind === "placement" &&
									isExtensionStatusPlacement(newValue)
								) {
									deps.setExtensionStatusPlacement(thirdPartyStatusSetting.key, newValue);
									settingsList.updateValue(id, newValue);
									deps.requestRender();
									ctx.ui.notify(
										`Third-party status ${thirdPartyStatusSetting.key} placement: ${newValue}`,
										"info",
									);
									tui.requestRender();
									return;
								}

								if (
									thirdPartyStatusSetting?.kind === "colorMode" &&
									isExtensionStatusColorMode(newValue)
								) {
									deps.setExtensionStatusColorMode(thirdPartyStatusSetting.key, newValue);
									settingsList.updateValue(id, newValue);
									deps.requestRender();
									ctx.ui.notify(
										`Third-party status ${thirdPartyStatusSetting.key} color: ${newValue}`,
										"info",
									);
									tui.requestRender();
								}
							} catch (error) {
								const message = error instanceof Error ? error.message : String(error);
								ctx.ui.notify(`Could not update Zentui settings: ${message}`, "error");
							}
						},
						() => done(undefined),
					);
				settingsList = makeSettingsList();
				const switchSection = (direction: "forward" | "backward") => {
					activeSection =
						direction === "forward" ? nextSection(activeSection) : previousSection(activeSection);
					settingsList = makeSettingsList();
					tui.requestRender();
				};

				return {
					render(width: number) {
						const colorSource = deps.getConfig().colorSources.editor;
						const border = renderChromeBorder(
							theme,
							colorSource,
							EDITOR_BORDER_STYLE,
							"─".repeat(Math.max(0, width)),
						);
						return [
							truncateToWidth(border, width, ""),
							truncateToWidth(formatSectionTabs(activeSection, theme), width, ""),
							truncateToWidth(border, width, ""),
							...withSectionFooter(settingsList.render(width), theme).map((line) =>
								truncateToWidth(line, width, ""),
							),
							truncateToWidth(border, width, ""),
						];
					},
					invalidate() {
						settingsList.invalidate();
					},
					handleInput(data: string) {
						if (matchesKey(data, Key.tab)) {
							switchSection("forward");
							return;
						}
						if (matchesKey(data, Key.shift("tab"))) {
							switchSection("backward");
							return;
						}
						settingsList.handleInput(data);
					},
				};
			});
		},
	});
}
