import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	type AccentRailLayoutPatchDiagnostic,
	installHostAccentRailLayoutPatch,
	markAccentRailLayoutEditor,
	retainAccentRailLayoutPatchInstallation,
} from "./accent-rail-layout-patch";
import {
	type AccentRailEditorStyleConfig,
	type ContextStyle,
	defaultConfig,
	type EditorComponentConfig,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	ensureConfigExists,
	FOOTER_FORMAT_ALIASES,
	type FooterComponentConfig,
	type FooterSegmentsConfig,
	type GitBranchConfig,
	type GitCommitConfig,
	type GitMetricsConfig,
	hasUnsupportedComponentStyle,
	type IconMode,
	loadConfig,
	type MinimalistConfig,
	type PathDisplayConfig,
	type PolishedCopyFriendlyEditorStyleConfig,
	type PolishedEditorStyleConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type SeparatorStyle,
	saveAccentRailEditorStylePatch,
	saveEditorComponentPatch,
	saveExtensionStatusColorMode,
	saveExtensionStatusDefaultPlacement,
	saveExtensionStatusPlacement,
	saveFooterComponentPatch,
	saveIconsModePatch,
	saveMinimalistEditorStylePatch,
	savePolishedCopyFriendlyEditorStylePatch,
	savePolishedEditorStylePatch,
	saveSelectorBordersComponentPatch,
	saveStarshipFooterStylePatch,
	saveThinkingStepsComponentPatch,
	saveUserMessagesComponentPatch,
	saveWorkingLineComponentPatch,
	type ThinkingStepsComponentConfig,
	type UserMessagesComponentConfig,
	type WorkingLineComponentPatch,
	type ZentuiConfig,
} from "./config";
import {
	type EditorTransferFailureReason,
	replaceEditorComponentWithExpandedText,
} from "./editor-transfer";
import { installFooter, installHiddenFooter } from "./footer";
import { collectFooterFormatReferences, parseFooterFormat } from "./footer-format";
import {
	buildSessionDurationLabel,
	invalidateUsageTotalsCache,
	resolveContextUsage,
} from "./format";
import { emptyGitStatus, readGitStatus } from "./git";
import {
	InteractionMetricsTracker,
	renderTurnSummaryEntry,
	TURN_SUMMARY_ENTRY_TYPE,
} from "./interaction-summary";
import { LiveContextController } from "./live-context";
import { readPackageVersionResult } from "./package-version";
import {
	createProjectRefreshScheduler,
	type ProjectRefreshRun,
	type ScheduleProjectRefreshOptions,
	type StopProjectRefreshInterval,
	startProjectRefreshInterval,
} from "./project-refresh";
import { applyProjectRefreshToState } from "./project-state";
import { RepositoryRootController, type RepositoryRootRequest } from "./repository-root";
import { readRuntimeInfo } from "./runtime";
import { installSelectorBorderStyle, removeSelectorBorderStyle } from "./selector-border";
import { SessionLifecycle } from "./session-lifecycle";
import { registerZentuiSettingsCommand } from "./settings-command";
import { createInitialState, type FooterState, modelLabelFor, syncState } from "./state";
import { resolveFooterTelemetry } from "./telemetry";
import { ThinkingExperimentalController } from "./thinking-experimental";
import { PolishedEditor, WrappedPolishedEditor } from "./ui";
import { installUserMessageStyle, removeUserMessageStyle } from "./user-message";
import {
	AgentDurationClock,
	snapshotWorkingLineHighStyle,
	WorkingLineController,
} from "./working-line";

const ZENTUI_EDITOR_FACTORY = Symbol.for("pi-zentui.editor-factory");
const ZENTUI_EDITOR_BASE_FACTORY = Symbol.for("pi-zentui.editor-base-factory");
const ZENTUI_EDITOR_OWNER = Symbol.for("pi-zentui.editor-owner");
const ZENTUI_FOOTER_OWNER = Symbol.for("pi-zentui.footer-owner");

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

type ZentuiEditorFactory = EditorFactory & {
	[ZENTUI_EDITOR_FACTORY]?: true;
	[ZENTUI_EDITOR_BASE_FACTORY]?: EditorFactory;
	[ZENTUI_EDITOR_OWNER]?: symbol;
};

type ApplyUiResult = {
	editorBlocked: boolean;
	editorReason?: string;
};

type EditorChangeResult = { ok: true } | { ok: false; reason: string };

type EditorInstallMode = "none" | "standalone" | "wrapper";
type InstalledFooterKind = "starship" | "hidden";

function editorTransferFailureMessage(reason: EditorTransferFailureReason): string {
	switch (reason) {
		case "unsupported-transfer-api":
			return "this Pi version cannot safely transfer expanded editor text; reload Pi to apply this change";
		case "editor-factory-snapshot-failed":
			return "the current editor factory could not be read safely; reload Pi to apply this change";
		case "editor-text-snapshot-failed":
			return "expanded editor text could not be read safely; reload Pi to apply this change";
		case "editor-text-preparation-failed":
			return "expanded editor text could not be prepared safely; reload Pi to apply this change";
		case "editor-replacement-failed-with-rollback":
			return "the editor replacement failed; the previous factory was reapplied, but editor instance identity is not guaranteed";
		case "editor-replacement-rollback-failed":
			return "the editor replacement and previous-factory rollback both failed; reload Pi before editing";
	}
}

function isZentuiEditorFactory(factory: EditorFactory | undefined): boolean {
	return Boolean((factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_FACTORY]);
}

function getZentuiEditorBaseFactory(factory: EditorFactory | undefined): EditorFactory | undefined {
	return (factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_BASE_FACTORY];
}

export function activeFooterReferences(config: ZentuiConfig): Set<string> {
	const starship = config.components.footer.styles.starship;
	const references = starship.format
		? collectFooterFormatReferences(parseFooterFormat(starship.format), FOOTER_FORMAT_ALIASES)
		: new Set<string>([
				...(starship.segments.sessionName ? ["session_name"] : []),
				...(starship.segments.runtime ? ["runtime"] : []),
				...(starship.segments.gitCommit ? ["git_commit"] : []),
				...(starship.segments.gitMetrics ? ["git_metrics"] : []),
				...(starship.segments.packageVersion ? ["package"] : []),
				...(starship.segments.sessionDuration ? ["session_duration"] : []),
				...(starship.segments.time ? ["time"] : []),
			]);
	if (starship.responsive) {
		for (const name of collectFooterFormatReferences(
			parseFooterFormat(starship.compactFormat),
			FOOTER_FORMAT_ALIASES,
		)) {
			references.add(name);
		}
	}
	return references;
}

function isTuiContext(ctx: ExtensionContext): boolean {
	try {
		const mode = (ctx as ExtensionContext & { mode?: string }).mode;
		return ctx.hasUI && (mode === undefined || mode === "tui");
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	const state: FooterState = createInitialState(emptyGitStatus());
	const sessionLifecycle = new SessionLifecycle();
	const editorOwnerToken = Symbol("zentui-editor-owner");

	let currentConfig: PolishedTuiConfig = structuredClone(defaultConfig);
	// Keep the capability guard defensive for hosts with incomplete extension APIs.
	if (typeof pi.registerEntryRenderer === "function") {
		pi.registerEntryRenderer(TURN_SUMMARY_ENTRY_TYPE, (entry, options, theme) =>
			renderTurnSummaryEntry(
				entry,
				{
					...options,
					colorSource: currentConfig.components.workingLine.colorSource,
					workingLineHigh: currentConfig.colors.workingLineHigh,
				},
				theme,
			),
		);
	}
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let requestEditorRender: (() => void) | undefined;
	let getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () => new Map();
	let stopRefreshInterval: StopProjectRefreshInterval = () => {};
	let cleanupUserMessageStyle: () => void = () => {};
	let userMessageStyleInstalled = false;
	let cleanupSelectorBorderStyle: () => void = () => {};
	let selectorBorderStyleInstalled = false;
	let installedFooterKind: InstalledFooterKind | undefined;
	let installedFooterToken: symbol | undefined;
	let editorInstalled = false;
	let editorInstallMode: EditorInstallMode = "none";
	let installedEditorFactory: EditorFactory | undefined;
	let wrappedEditorFactory: EditorFactory | undefined;
	let stopSessionTimer: () => void = () => {};
	let stopMinimalistDurationUpdates: () => void = () => {};
	let minimalistDurationUpdatesActive = false;
	let minimalistDecorationActive = false;
	let sessionTimerRequirements = "";
	let lastDurationLabel = "";
	let lastProjectCwd: string | undefined;
	const agentDurationClock = new AgentDurationClock();
	const interactionMetrics = new InteractionMetricsTracker();
	let agentRunActive = false;
	let minimalistProjectRoot: string | undefined;
	const repositoryRoots = new RepositoryRootController();
	let projectRefreshActive = false;
	let activeTuiContext: ExtensionContext | undefined;
	let cleanupAccentRailLayoutPatch: () => void = () => {};
	let accentRailLayoutPatchInstallSerial = 0;

	const recordAccentRailLayoutPatchDiagnostic = (
		diagnostic: AccentRailLayoutPatchDiagnostic,
		version?: string,
	) => {
		if (process.env.ZENTUI_DEBUG === "1") {
			console.error(
				`[zentui] Accent Rail fullscreen layout patch: ${diagnostic}${version ? ` (Pi TUI ${version})` : ""}`,
			);
		}
	};

	const isOwnedEditorFactory = (factory: EditorFactory | undefined) =>
		(factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_OWNER] === editorOwnerToken;
	const effectiveEditorEnabled = () =>
		currentConfig.components.editor.enabled &&
		!hasUnsupportedComponentStyle(currentConfig, "editor");
	const effectiveUserMessagesEnabled = () =>
		currentConfig.components.userMessages.enabled &&
		!hasUnsupportedComponentStyle(currentConfig, "userMessages");
	const effectiveSelectorBordersEnabled = () =>
		currentConfig.components.selectorBorders.enabled &&
		!hasUnsupportedComponentStyle(currentConfig, "selectorBorders");
	const effectiveFooterStyle = () =>
		hasUnsupportedComponentStyle(currentConfig, "footer")
			? ("native" as const)
			: currentConfig.components.footer.style;

	const ownsInstalledEditorFactory = () => {
		if (
			!sessionLifecycle.isCurrent() ||
			!editorInstalled ||
			!installedEditorFactory ||
			!activeTuiContext
		) {
			return false;
		}
		try {
			return (
				isOwnedEditorFactory(installedEditorFactory) &&
				activeTuiContext.ui.getEditorComponent() === installedEditorFactory
			);
		} catch {
			return false;
		}
	};

	const refresh = () => {
		if (!sessionLifecycle.isCurrent()) return;
		requestFooterRender?.();
		requestEditorRender?.();
	};
	const thinkingExperimental = new ThinkingExperimentalController(
		() => currentConfig.components.thinkingSteps,
	);
	const thinkingStepsCapability = {
		get state() {
			return thinkingExperimental.state;
		},
	};
	const liveContext = new LiveContextController(sessionLifecycle, refresh);
	const getActiveTheme = () => activeTheme;
	const getCurrentConfig = () => currentConfig;
	const workingLine = new WorkingLineController(
		getCurrentConfig,
		() => activeTheme as Theme,
		agentDurationClock,
		Math.random,
		Date.now,
		() => interactionMetrics.currentThought(),
	);
	const getContextSnapshot = (ctx: ExtensionContext) => resolveContextUsage(ctx, liveContext.get());
	const getContextWindow = (ctx: ExtensionContext): number | undefined =>
		getContextSnapshot(ctx).contextWindow;
	const getContextPercent = (ctx: ExtensionContext): number | undefined =>
		getContextSnapshot(ctx).percent;
	const getEditorMeta = (ctx: ExtensionContext) => {
		const context = getContextSnapshot(ctx);
		return {
			modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
			modelId: state.modelId,
			modelName: state.modelName,
			providerLabel: state.providerLabel,
			sessionName: ctx.sessionManager.getSessionName() ?? "",
			contextPercent: context.percent,
			contextWindow: context.contextWindow,
			inputTokens: state.usageTotals.input,
			outputTokens: state.usageTotals.output,
			cacheHitRate: state.usageTotals.latestCacheHitRate,
		};
	};
	const getAgentDurationMs = () => agentDurationClock.elapsedMs();
	const getThinkingLevel = () =>
		sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : ("off" as const);
	const syncFooterState = (ctx: ExtensionContext) =>
		syncState(state, ctx, currentConfig.icons.cacheHit, resolveFooterTelemetry(ctx));
	const ownsInstalledFooter = () =>
		Boolean(
			activeTuiContext &&
				installedFooterToken &&
				ctxFooterOwner(activeTuiContext) === installedFooterToken,
		);
	const installedFooterReferences = () =>
		installedFooterKind === "starship" && ownsInstalledFooter()
			? activeFooterReferences(currentConfig)
			: new Set<string>();

	type ProjectRefreshTarget = {
		repository: RepositoryRootRequest;
		sessionGeneration: number;
	};
	const refreshProjectState = async (
		{ repository, sessionGeneration }: ProjectRefreshTarget,
		run: ProjectRefreshRun,
	) => {
		const { cwd } = repository;
		if (
			!run.isCurrent() ||
			!sessionLifecycle.isCurrent(sessionGeneration) ||
			!repositoryRoots.isCurrent(repository)
		) {
			return;
		}
		const starship = currentConfig.components.footer.styles.starship;
		const gitCommitConfig = starship.gitCommit;
		const gitMetricsConfig = starship.gitMetrics;
		const references = installedFooterReferences();
		const wantExactTag =
			(references.has("git_commit") && gitCommitConfig.showTag) || references.has("git_tag");
		const wantMetrics =
			references.has("git_metrics") || references.has("git_added") || references.has("git_deleted");
		const wantPackage = references.has("package") || references.has("package_version");
		const wantRuntime = references.has("runtime");
		const [git, runtime, packageVersion] = await Promise.all([
			readGitStatus(cwd, {
				readExactTag: wantExactTag,
				readMetrics: wantMetrics,
				ignoreSubmodules: gitMetricsConfig.ignoreSubmodules,
			}),
			wantRuntime
				? readRuntimeInfo(cwd)
				: Promise.resolve({ kind: "ok" as const, runtime: undefined }),
			wantPackage
				? readPackageVersionResult(cwd)
				: Promise.resolve({ kind: "ok" as const, result: null }),
		]);
		if (
			!run.isCurrent() ||
			!sessionLifecycle.isCurrent(sessionGeneration) ||
			!repositoryRoots.isCurrent(repository)
		) {
			return;
		}
		minimalistProjectRoot = repositoryRoots.update(repository, git.kind === "ok");
		lastProjectCwd = applyProjectRefreshToState(state, {
			cwd,
			previousCwd: lastProjectCwd,
			git,
			runtime,
			packageVersion,
		});
	};

	const projectRefreshScheduler = createProjectRefreshScheduler(refreshProjectState, refresh);
	const scheduleProjectRefresh = (
		ctx: ExtensionContext,
		options?: ScheduleProjectRefreshOptions,
	) => {
		const sessionGeneration = sessionLifecycle.currentGeneration();
		if (!sessionLifecycle.isCurrent(sessionGeneration)) return;
		const repository = repositoryRoots.request(ctx.cwd);
		minimalistProjectRoot = repositoryRoots.cachedRootForCwd(ctx.cwd);
		projectRefreshScheduler.schedule({ repository, sessionGeneration }, options);
	};

	const minimalistProjectRequired = () => {
		const editor = currentConfig.components.editor;
		const minimalist = editor.styles.minimalist;
		return (
			effectiveEditorEnabled() &&
			ownsInstalledEditorFactory() &&
			editor.style === "minimalist" &&
			(minimalist.showGit || minimalist.pathDisplay === "project")
		);
	};

	const needsProjectRefresh = () =>
		(installedFooterKind === "starship" && ownsInstalledFooter()) || minimalistProjectRequired();

	const stopProjectRefresh = () => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		projectRefreshScheduler.stop();
		projectRefreshActive = false;
	};

	const reconcileProjectRefresh = (ctx: ExtensionContext, force = false) => {
		if (!sessionLifecycle.isCurrent() || !needsProjectRefresh()) {
			stopProjectRefresh();
			return;
		}
		const activated = !projectRefreshActive;
		if (activated) {
			stopRefreshInterval = startProjectRefreshInterval(
				currentConfig.projectRefreshIntervalMs,
				() => {
					if (editorInstalled && !ownsInstalledEditorFactory()) {
						reconcileObservedEditorOwnership(ctx);
					}
					if (!needsProjectRefresh()) {
						stopProjectRefresh();
						return;
					}
					scheduleProjectRefresh(ctx);
				},
			);
			projectRefreshActive = true;
		}
		if (force && !activated) projectRefreshScheduler.invalidate();
		if (force || activated) scheduleProjectRefresh(ctx, { force: true });
	};

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!sessionLifecycle.isCurrent() || !ctx.hasUI) return;
		if (editorInstalled && !ownsInstalledEditorFactory()) reconcileObservedEditorOwnership(ctx);
		syncFooterState(ctx);
		if (project && needsProjectRefresh()) scheduleProjectRefresh(ctx);
		refresh();
	};

	const reconcileSessionTimer = () => {
		const references = installedFooterReferences();
		const needsTime = references.has("time");
		const needsDuration = references.has("session_duration");
		const nextRequirements = needsTime || needsDuration ? `${needsTime}:${needsDuration}` : "";
		if (
			!sessionLifecycle.isCurrent() ||
			installedFooterKind !== "starship" ||
			!ownsInstalledFooter() ||
			!nextRequirements
		) {
			stopSessionTimer();
			sessionTimerRequirements = "";
			lastDurationLabel = "";
			return;
		}
		if (sessionTimerRequirements === nextRequirements) return;

		stopSessionTimer();
		sessionTimerRequirements = nextRequirements;
		lastDurationLabel = "";
		const timer = setInterval(() => {
			if (!sessionLifecycle.isCurrent()) return;
			if (needsTime) {
				refresh();
				return;
			}
			const label = state.sessionStartEpoch
				? buildSessionDurationLabel(state.sessionStartEpoch)
				: "";
			if (label === lastDurationLabel) return;
			lastDurationLabel = label;
			refresh();
		}, 1000);
		stopSessionTimer = () => {
			clearInterval(timer);
			sessionTimerRequirements = "";
			stopSessionTimer = () => {};
		};
	};

	const reconcileAgentTimer = () => {
		const needed =
			sessionLifecycle.isCurrent() &&
			agentRunActive &&
			agentDurationClock.isActive() &&
			minimalistDecorationActive &&
			effectiveEditorEnabled() &&
			ownsInstalledEditorFactory() &&
			currentConfig.components.editor.style === "minimalist" &&
			currentConfig.components.editor.styles.minimalist.showTimer;
		if (!needed) {
			stopMinimalistDurationUpdates();
			stopMinimalistDurationUpdates = () => {};
			minimalistDurationUpdatesActive = false;
			return;
		}
		if (minimalistDurationUpdatesActive) return;
		minimalistDurationUpdatesActive = true;
		stopMinimalistDurationUpdates = agentDurationClock.subscribe(() => {
			const ctx = activeTuiContext;
			if (ctx && editorInstalled && !ownsInstalledEditorFactory()) {
				reconcileObservedEditorOwnership(ctx);
			}
			reconcileAgentTimer();
			if (minimalistDurationUpdatesActive) refresh();
		});
	};

	const setMinimalistDecorationActive = (active: boolean) => {
		const next = sessionLifecycle.isCurrent() && active && ownsInstalledEditorFactory();
		if (minimalistDecorationActive === next) return;
		minimalistDecorationActive = next;
		reconcileAgentTimer();
	};

	const startAgentTurn = (interactionStarted: boolean) => {
		agentRunActive = true;
		if (interactionStarted) agentDurationClock.start();
		reconcileAgentTimer();
		refresh();
	};

	const pauseAgentRun = () => {
		agentRunActive = false;
		reconcileAgentTimer();
		refresh();
	};

	const settleAgentTurn = (nextStartedAt?: number) => {
		agentRunActive = nextStartedAt !== undefined;
		if (nextStartedAt === undefined) agentDurationClock.finish();
		else agentDurationClock.start(nextStartedAt);
		reconcileAgentTimer();
		refresh();
	};

	const resetAgentTimer = () => {
		stopMinimalistDurationUpdates();
		stopMinimalistDurationUpdates = () => {};
		minimalistDurationUpdatesActive = false;
		agentRunActive = false;
		agentDurationClock.reset();
	};

	const sameReferences = (left: Set<string>, right: Set<string>) =>
		left.size === right.size && [...left].every((name) => right.has(name));

	const applyFooterDependencyConfigChange = (
		ctx: ExtensionContext,
		save: () => PolishedTuiConfig,
	) => {
		const before = activeFooterReferences(currentConfig);
		const nextConfig = save();
		const after = activeFooterReferences(nextConfig);
		currentConfig = nextConfig;
		if (sameReferences(before, after)) return;
		reconcileSessionTimer();
		reconcileProjectRefresh(ctx, true);
	};

	const installUserMessages = () => {
		if (userMessageStyleInstalled) return;
		let cleanup: (() => void) | undefined;
		try {
			cleanup = installUserMessageStyle(getActiveTheme, getCurrentConfig);
			cleanupUserMessageStyle = cleanup;
			userMessageStyleInstalled = true;
		} catch {
			try {
				cleanup?.();
			} catch {
				// Best effort: the installer is locally transactional.
			}
			cleanupUserMessageStyle = () => {};
			userMessageStyleInstalled = false;
		}
	};

	const uninstallUserMessages = () => {
		try {
			cleanupUserMessageStyle();
		} catch {
			// Best effort cleanup.
		} finally {
			cleanupUserMessageStyle = () => {};
			userMessageStyleInstalled = false;
		}
	};

	const reconcileUserMessages = () => {
		if (effectiveUserMessagesEnabled()) installUserMessages();
		else uninstallUserMessages();
	};

	const installSelectorBorders = () => {
		if (selectorBorderStyleInstalled) return;
		let cleanup: (() => void) | undefined;
		try {
			cleanup = installSelectorBorderStyle(getActiveTheme, getCurrentConfig);
			cleanupSelectorBorderStyle = cleanup;
			selectorBorderStyleInstalled = true;
		} catch {
			try {
				cleanup?.();
			} catch {
				// Best effort: the installer is locally transactional.
			}
			cleanupSelectorBorderStyle = () => {};
			selectorBorderStyleInstalled = false;
		}
	};

	const uninstallSelectorBorders = () => {
		try {
			cleanupSelectorBorderStyle();
		} catch {
			// Best effort cleanup.
		} finally {
			cleanupSelectorBorderStyle = () => {};
			selectorBorderStyleInstalled = false;
		}
	};

	const reconcileSelectorBorders = () => {
		const selectors = currentConfig.components.selectorBorders;
		if (effectiveSelectorBordersEnabled() && selectors.style === "zentui") {
			installSelectorBorders();
		} else uninstallSelectorBorders();
	};

	const clearEditorOwnership = () => {
		setMinimalistDecorationActive(false);
		requestEditorRender = undefined;
		wrappedEditorFactory = undefined;
		installedEditorFactory = undefined;
		editorInstallMode = "none";
		editorInstalled = false;
	};

	const trackZentuiEditorFactory = (factory: EditorFactory): boolean => {
		if (!isOwnedEditorFactory(factory)) return false;
		const baseFactory = getZentuiEditorBaseFactory(factory);
		wrappedEditorFactory = baseFactory;
		installedEditorFactory = factory;
		editorInstallMode = baseFactory ? "wrapper" : "standalone";
		editorInstalled = true;
		return true;
	};

	const observeEditorFactory = (
		ctx: ExtensionContext,
	): { known: true; factory: EditorFactory | undefined } | { known: false } => {
		try {
			return { known: true, factory: ctx.ui.getEditorComponent() };
		} catch {
			return { known: false };
		}
	};

	const reconcileObservedEditorOwnership = (ctx: ExtensionContext) => {
		const observed = observeEditorFactory(ctx);
		if (!observed.known) return observed;
		if (observed.factory && isOwnedEditorFactory(observed.factory)) {
			trackZentuiEditorFactory(observed.factory);
		} else {
			clearEditorOwnership();
			reconcileProjectRefresh(ctx);
		}
		return observed;
	};

	const accentRailLayoutActive = () =>
		sessionLifecycle.isCurrent() &&
		ownsInstalledEditorFactory() &&
		effectiveEditorEnabled() &&
		currentConfig.components.editor.style === "accent-rail";

	const markOwnedAccentRailEditor = <T extends object>(editor: T): T => {
		markAccentRailLayoutEditor(editor, editorOwnerToken, accentRailLayoutActive);
		return editor;
	};

	const makeEditorFactory = (ctx: ExtensionContext): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
			requestEditorRender = () => tui.requestRender();
			return markOwnedAccentRailEditor(
				new PolishedEditor(
					tui,
					theme,
					keybindings,
					sessionTheme,
					getCurrentConfig,
					() => getEditorMeta(ctx),
					getThinkingLevel,
					() => ({
						cwd: ctx.cwd,
						projectRoot: minimalistProjectRoot,
						branch: state.branch,
						dirty: state.dirty,
						ahead: state.ahead,
						behind: state.behind,
						costLabel: state.costLabel,
						modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
						thinkingLevel: getThinkingLevel(),
						contextPercent: getContextPercent(ctx),
						contextWindow: getContextWindow(ctx),
						sessionName: ctx.sessionManager.getSessionName() ?? "",
						agentDurationMs: getAgentDurationMs(),
						agentActive: agentRunActive,
					}),
					setMinimalistDecorationActive,
				),
			);
		}) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		factory[ZENTUI_EDITOR_OWNER] = editorOwnerToken;
		return factory;
	};

	const makeWrappedEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory,
	): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
			requestEditorRender = () => tui.requestRender();
			return markOwnedAccentRailEditor(
				new WrappedPolishedEditor(
					baseFactory(tui, theme, keybindings),
					sessionTheme,
					getCurrentConfig,
					() => getEditorMeta(ctx),
					getThinkingLevel,
					() => ({
						cwd: ctx.cwd,
						projectRoot: minimalistProjectRoot,
						branch: state.branch,
						dirty: state.dirty,
						ahead: state.ahead,
						behind: state.behind,
						costLabel: state.costLabel,
						modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
						thinkingLevel: getThinkingLevel(),
						contextPercent: getContextPercent(ctx),
						contextWindow: getContextWindow(ctx),
						sessionName: ctx.sessionManager.getSessionName() ?? "",
						agentDurationMs: getAgentDurationMs(),
						agentActive: agentRunActive,
					}),
					setMinimalistDecorationActive,
				),
			);
		}) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		factory[ZENTUI_EDITOR_OWNER] = editorOwnerToken;
		factory[ZENTUI_EDITOR_BASE_FACTORY] = baseFactory;
		return factory;
	};

	const replaceEditor = (
		ctx: ExtensionContext,
		factory: EditorFactory | undefined,
	): EditorChangeResult => {
		const result = replaceEditorComponentWithExpandedText(ctx.ui, factory);
		return result.ok ? result : { ok: false, reason: editorTransferFailureMessage(result.reason) };
	};

	const installEditor = (ctx: ExtensionContext): EditorChangeResult => {
		const currentFactory = ctx.ui.getEditorComponent();
		if (currentFactory && currentFactory === installedEditorFactory) {
			editorInstalled = true;
			return { ok: true };
		}

		const currentZentuiBaseFactory = getZentuiEditorBaseFactory(currentFactory);
		const baseFactory =
			currentZentuiBaseFactory ??
			(currentFactory && !isZentuiEditorFactory(currentFactory) ? currentFactory : undefined);
		const nextFactory = baseFactory
			? makeWrappedEditorFactory(ctx, baseFactory)
			: makeEditorFactory(ctx);
		const replacement = replaceEditor(ctx, nextFactory);
		if (!replacement.ok) return replacement;

		trackZentuiEditorFactory(nextFactory);
		return { ok: true };
	};

	const uninstallEditor = (
		ctx: ExtensionContext,
		options: { allowStaleZentui?: boolean } = {},
	): EditorChangeResult => {
		const observed = observeEditorFactory(ctx);
		if (!observed.known) {
			return {
				ok: false,
				reason:
					"the current editor factory could not be observed safely; reload Pi to apply this change",
			};
		}
		const currentFactory = observed.factory;
		if (!currentFactory || !isZentuiEditorFactory(currentFactory)) {
			clearEditorOwnership();
			return { ok: true };
		}
		if (!isOwnedEditorFactory(currentFactory) && !options.allowStaleZentui) {
			clearEditorOwnership();
			return { ok: true };
		}

		const replacement = replaceEditor(
			ctx,
			getZentuiEditorBaseFactory(currentFactory) ??
				(editorInstallMode === "wrapper" && wrappedEditorFactory
					? wrappedEditorFactory
					: undefined),
		);
		if (!replacement.ok) return replacement;

		clearEditorOwnership();
		return { ok: true };
	};

	const ctxFooterOwner = (ctx: ExtensionContext): unknown =>
		(ctx.ui as unknown as Record<PropertyKey, unknown>)[ZENTUI_FOOTER_OWNER];

	const setStatusLineOwnership = (ctx: ExtensionContext, token: symbol | undefined) => {
		const ui = ctx.ui as unknown as Record<PropertyKey, unknown>;
		try {
			if (token) ui[ZENTUI_FOOTER_OWNER] = token;
			else delete ui[ZENTUI_FOOTER_OWNER];
		} catch {
			// Failure to mark ownership intentionally prevents Native from restoring it.
		}
	};

	const ownsStatusLine = (ctx: ExtensionContext) =>
		installedFooterToken !== undefined && ctxFooterOwner(ctx) === installedFooterToken;

	const clearFooterOwnership = (ctx: ExtensionContext, token: symbol) => {
		if (installedFooterToken !== token) return;
		installedFooterKind = undefined;
		installedFooterToken = undefined;
		if (ctxFooterOwner(ctx) === token) setStatusLineOwnership(ctx, undefined);
		requestFooterRender = undefined;
		getActiveExtensionStatuses = () => new Map();
		stopSessionTimer();
		if (sessionLifecycle.isCurrent()) reconcileProjectRefresh(ctx, true);
	};

	type FooterBookkeepingSnapshot = {
		token: symbol | undefined;
		requestRender: (() => void) | undefined;
		getExtensionStatuses: () => ReadonlyMap<string, string>;
	};

	const snapshotFooterBookkeeping = (ctx: ExtensionContext): FooterBookkeepingSnapshot => ({
		token: ownsStatusLine(ctx) ? installedFooterToken : undefined,
		requestRender: requestFooterRender,
		getExtensionStatuses: getActiveExtensionStatuses,
	});

	const resetFailedFooterInstallation = (
		ctx: ExtensionContext,
		token: symbol,
		previous: FooterBookkeepingSnapshot,
	) => {
		// Pi has no transactional Footer replacement API. If a live replacement
		// fails while retaining our predecessor, preserve that Footer's callbacks
		// and timer. Otherwise clear only local bookkeeping; never issue a
		// destructive setFooter(undefined) rollback.
		if (
			previous.token !== undefined &&
			installedFooterToken === previous.token &&
			ctxFooterOwner(ctx) === previous.token
		) {
			requestFooterRender = previous.requestRender;
			getActiveExtensionStatuses = previous.getExtensionStatuses;
			return;
		}
		clearFooterOwnership(ctx, token);
		requestFooterRender = undefined;
		getActiveExtensionStatuses = () => new Map();
		stopSessionTimer();
	};

	const installStatusLine = (ctx: ExtensionContext) => {
		if (installedFooterKind === "starship" && ownsStatusLine(ctx)) return;
		const token = Symbol("zentui-starship-footer");
		const previous = snapshotFooterBookkeeping(ctx);
		try {
			installFooter(ctx, state, getCurrentConfig, {
				setRequestRender: (fn) => {
					requestFooterRender = fn;
				},
				scheduleProjectRefresh,
				setExtensionStatusesGetter(fn) {
					getActiveExtensionStatuses = fn ?? (() => new Map());
				},
				getLiveContext: () => liveContext.get(),
				getRepositoryRoot: (cwd) => repositoryRoots.rootForCwd(cwd),
				onDispose: () => clearFooterOwnership(ctx, token),
			});
			installedFooterKind = "starship";
			installedFooterToken = token;
			setStatusLineOwnership(ctx, token);
			refresh();
			reconcileSessionTimer();
		} catch {
			resetFailedFooterInstallation(ctx, token, previous);
		}
	};

	const installHiddenStatusLine = (ctx: ExtensionContext) => {
		if (installedFooterKind === "hidden" && ownsStatusLine(ctx)) return;
		const token = Symbol("zentui-hidden-footer");
		const previous = snapshotFooterBookkeeping(ctx);
		try {
			installHiddenFooter(ctx, () => clearFooterOwnership(ctx, token));
			installedFooterKind = "hidden";
			installedFooterToken = token;
			setStatusLineOwnership(ctx, token);
			requestFooterRender = undefined;
			getActiveExtensionStatuses = () => new Map();
			stopSessionTimer();
		} catch {
			resetFailedFooterInstallation(ctx, token, previous);
		}
	};

	const uninstallStatusLine = (
		ctx: ExtensionContext,
		options: { forceLocalCleanup?: boolean } = {},
	) => {
		const ownedToken = ownsStatusLine(ctx) ? installedFooterToken : undefined;
		if (!ownedToken) return;
		try {
			ctx.ui.setFooter(undefined);
		} catch {
			// A live transition must preserve an owned Footer that Pi retained.
			// Shutdown cannot keep local callbacks alive, so it clears bookkeeping.
			if (!options.forceLocalCleanup) return;
		}
		clearFooterOwnership(ctx, ownedToken);
	};

	const reconcileFooter = (ctx: ExtensionContext) => {
		switch (effectiveFooterStyle()) {
			case "starship":
				installStatusLine(ctx);
				break;
			case "hidden":
				installHiddenStatusLine(ctx);
				break;
			case "native":
				uninstallStatusLine(ctx);
				break;
		}
	};

	const reconcileEditor = (
		ctx: ExtensionContext,
		options: { allowStaleZentui?: boolean } = {},
	): EditorChangeResult | undefined => {
		try {
			if (effectiveEditorEnabled()) {
				const currentFactory = ctx.ui.getEditorComponent();
				if (
					isZentuiEditorFactory(currentFactory) &&
					!isOwnedEditorFactory(currentFactory) &&
					!options.allowStaleZentui
				) {
					clearEditorOwnership();
					return;
				}
				const editorMissingOrReplaced = !editorInstalled || !isOwnedEditorFactory(currentFactory);
				if (editorMissingOrReplaced) return installEditor(ctx);
			} else {
				const currentFactory = ctx.ui.getEditorComponent();
				if (editorInstalled || isOwnedEditorFactory(currentFactory)) return uninstallEditor(ctx);
			}
		} catch {
			return {
				ok: false,
				reason: "the editor could not be reconciled safely; reload Pi to apply this change",
			};
		}
	};

	const applyConfiguredUi = (
		ctx: ExtensionContext,
		options: { allowStaleZentui?: boolean } = {},
	): ApplyUiResult => {
		const result: ApplyUiResult = { editorBlocked: false };
		if (!isTuiContext(ctx)) return result;
		activeTheme = ctx.ui.theme;

		const editorChange = reconcileEditor(ctx, options);
		if (editorChange && !editorChange.ok) {
			result.editorBlocked = true;
			result.editorReason = editorChange.reason;
		}
		reconcileUserMessages();
		reconcileSelectorBorders();
		reconcileFooter(ctx);
		reconcileProjectRefresh(ctx);
		reconcileSessionTimer();
		reconcileAgentTimer();
		return result;
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		activeTuiContext = ctx;
		activeTheme = ctx.ui.theme;
		const staleFooterOwner = ctxFooterOwner(ctx);
		if (typeof staleFooterOwner === "symbol") installedFooterToken = staleFooterOwner;
		ensureConfigExists();
		syncFooterState(ctx);
		stopProjectRefresh();

		uninstallUserMessages();
		uninstallSelectorBorders();
		try {
			removeUserMessageStyle();
		} catch {
			// Startup alone may supersede a stale registration from an earlier reload.
		}
		try {
			removeSelectorBorderStyle();
		} catch {
			// Startup alone may supersede a stale registration from an earlier reload.
		}
		uninstallStatusLine(ctx);
		if (effectiveEditorEnabled()) clearEditorOwnership();
		else {
			try {
				uninstallEditor(ctx, { allowStaleZentui: true });
			} catch {
				// Reconciliation below retries observable stale ownership.
			}
		}

		applyConfiguredUi(ctx, { allowStaleZentui: true });
		refresh();
	};

	const scheduleEditorReconciliation = (ctx: ExtensionContext) => {
		sessionLifecycle.defer(() => {
			if (!isTuiContext(ctx) || !effectiveEditorEnabled()) return;
			const observed = observeEditorFactory(ctx);
			if (!observed.known) return;
			if (observed.factory === installedEditorFactory) {
				reconcileProjectRefresh(ctx);
				return;
			}
			if (!observed.factory || !isOwnedEditorFactory(observed.factory)) {
				clearEditorOwnership();
				reconcileProjectRefresh(ctx);
				refresh();
				return;
			}
			trackZentuiEditorFactory(observed.factory);
			reconcileProjectRefresh(ctx);
			refresh();
		});
	};

	const cleanupUi = (ctx?: ExtensionContext) => {
		if (!ctx || !sessionLifecycle.isCurrent()) return;
		sessionLifecycle.shutdown();
		stopSessionTimer();
		resetAgentTimer();
		stopProjectRefresh();

		let retainedEditorOwnership = false;
		if (isTuiContext(ctx)) {
			uninstallStatusLine(ctx, { forceLocalCleanup: true });
			try {
				const before = observeEditorFactory(ctx);
				if (before.known) {
					const currentFactory = before.factory;
					if (currentFactory && isOwnedEditorFactory(currentFactory)) {
						replaceEditor(
							ctx,
							getZentuiEditorBaseFactory(currentFactory) ??
								(editorInstallMode === "wrapper" && wrappedEditorFactory
									? wrappedEditorFactory
									: undefined),
						);
					}
				}
				const after = observeEditorFactory(ctx);
				if (after.known && after.factory && isOwnedEditorFactory(after.factory)) {
					trackZentuiEditorFactory(after.factory);
					retainedEditorOwnership = true;
				}
			} catch {
				// Continue cleaning independent surfaces.
			}
		}
		if (!retainedEditorOwnership) clearEditorOwnership();
		accentRailLayoutPatchInstallSerial += 1;
		cleanupAccentRailLayoutPatch();
		cleanupAccentRailLayoutPatch = () => {};
		uninstallUserMessages();
		uninstallSelectorBorders();
		installedFooterKind = undefined;
		installedFooterToken = undefined;
		requestFooterRender = undefined;
		requestEditorRender = undefined;
		getActiveExtensionStatuses = () => new Map();
		activeTheme = undefined;
		activeTuiContext = undefined;
	};

	const syncInteractiveState = (_event: unknown, ctx: ExtensionContext) => {
		refreshInteractiveState(ctx);
	};
	const syncInteractiveAndProjectState = (_event: unknown, ctx: ExtensionContext) => {
		refreshInteractiveState(ctx, true);
	};

	pi.on("session_start", async (_event, ctx) => {
		const lifecycleGeneration = sessionLifecycle.start();
		// Reload synchronously so private ownership uses this session's disk snapshot before
		// any await or transcript restoration.
		currentConfig = loadConfig();
		thinkingExperimental.startSession(ctx);
		const layoutInstallSerial = ++accentRailLayoutPatchInstallSerial;
		cleanupAccentRailLayoutPatch();
		cleanupAccentRailLayoutPatch = () => {};
		if (isTuiContext(ctx)) {
			const layoutPatchRetention = await retainAccentRailLayoutPatchInstallation(
				() => installHostAccentRailLayoutPatch(editorOwnerToken),
				() =>
					sessionLifecycle.isCurrent(lifecycleGeneration) &&
					layoutInstallSerial === accentRailLayoutPatchInstallSerial,
				(layoutPatch) => {
					cleanupAccentRailLayoutPatch = layoutPatch.cleanup;
					recordAccentRailLayoutPatchDiagnostic(layoutPatch.diagnostic, layoutPatch.version);
				},
			);
			if (layoutPatchRetention === "stale") return;
			if (layoutPatchRetention === "failed") {
				recordAccentRailLayoutPatchDiagnostic("host-module-unavailable");
			}
		}
		if (!sessionLifecycle.isCurrent(lifecycleGeneration)) return;
		liveContext.clear();
		interactionMetrics.shutdown();
		state.sessionStartEpoch = Date.now();
		invalidateUsageTotalsCache();
		resetAgentTimer();
		lastProjectCwd = undefined;
		minimalistProjectRoot = undefined;
		repositoryRoots.reset();
		installUi(ctx);
		workingLine.startSession(ctx);
		scheduleEditorReconciliation(ctx);
	});

	registerZentuiSettingsCommand(pi, {
		sessionLifecycle,
		getConfig: getCurrentConfig,
		setEditorComponent(patch: Partial<EditorComponentConfig>, ctx: ExtensionContext) {
			currentConfig = saveEditorComponentPatch(patch);
			let result: EditorChangeResult | undefined;
			if (patch.enabled !== undefined && isTuiContext(ctx)) {
				result = reconcileEditor(ctx);
			}
			if (patch.style !== undefined && patch.style !== "minimalist") {
				setMinimalistDecorationActive(false);
			}
			if (patch.modelLabel !== undefined) syncFooterState(ctx);
			reconcileProjectRefresh(ctx);
			reconcileAgentTimer();
			refresh();
			return {
				applied: !result || result.ok,
				reason: result && !result.ok ? result.reason : undefined,
			};
		},
		setPolished(patch: Partial<PolishedEditorStyleConfig>, _ctx: ExtensionContext) {
			currentConfig = savePolishedEditorStylePatch(patch);
			refresh();
		},
		setPolishedCopyFriendly(
			patch: Partial<PolishedCopyFriendlyEditorStyleConfig>,
			_ctx: ExtensionContext,
		) {
			currentConfig = savePolishedCopyFriendlyEditorStylePatch(patch);
			refresh();
		},
		setAccentRail(patch: Partial<AccentRailEditorStyleConfig>, _ctx: ExtensionContext) {
			currentConfig = saveAccentRailEditorStylePatch(patch);
			refresh();
		},
		setMinimalist(patch: Partial<MinimalistConfig>, ctx: ExtensionContext) {
			currentConfig = saveMinimalistEditorStylePatch(patch);
			reconcileAgentTimer();
			reconcileProjectRefresh(ctx, patch.pathDisplay !== undefined || patch.showGit !== undefined);
			refresh();
		},
		setUserMessagesComponent(patch: Partial<UserMessagesComponentConfig>, _ctx: ExtensionContext) {
			currentConfig = saveUserMessagesComponentPatch(patch);
			if (patch.enabled !== undefined || patch.style !== undefined) reconcileUserMessages();
			refresh();
		},
		thinkingStepsCapability,
		setThinkingStepsComponent(
			patch: Partial<ThinkingStepsComponentConfig>,
			_ctx: ExtensionContext,
		) {
			currentConfig = saveThinkingStepsComponentPatch(patch);
			return thinkingExperimental.reconcile();
		},
		setWorkingLineComponent(patch: WorkingLineComponentPatch, ctx: ExtensionContext) {
			currentConfig = saveWorkingLineComponentPatch(patch);
			return workingLine.reconcile(ctx);
		},
		setSelectorBordersComponent(
			patch: Partial<SelectorBordersComponentConfig>,
			_ctx: ExtensionContext,
		) {
			currentConfig = saveSelectorBordersComponentPatch(patch);
			if (patch.enabled !== undefined || patch.style !== undefined) reconcileSelectorBorders();
			refresh();
		},
		setFooterComponent(patch: Partial<FooterComponentConfig>, ctx: ExtensionContext) {
			const previousStyle = effectiveFooterStyle();
			currentConfig = saveFooterComponentPatch(patch);
			const styleChanged = effectiveFooterStyle() !== previousStyle;
			if (patch.style !== undefined) reconcileFooter(ctx);
			if (patch.modelLabel !== undefined) syncFooterState(ctx);
			reconcileProjectRefresh(ctx, styleChanged);
			reconcileSessionTimer();
			refresh();
		},
		setFooterSegments(patch: Partial<FooterSegmentsConfig>, ctx: ExtensionContext) {
			applyFooterDependencyConfigChange(ctx, () =>
				saveStarshipFooterStylePatch({ segments: patch as FooterSegmentsConfig }),
			);
		},
		setFooterFormat(value: string, ctx: ExtensionContext) {
			applyFooterDependencyConfigChange(ctx, () => saveStarshipFooterStylePatch({ format: value }));
		},
		setResponsiveFooter(
			patch: Partial<Pick<PolishedTuiConfig, "responsiveFooter" | "compactFooterMaxLines">>,
			ctx: ExtensionContext,
		) {
			applyFooterDependencyConfigChange(ctx, () =>
				saveStarshipFooterStylePatch({
					...(patch.responsiveFooter === undefined ? {} : { responsive: patch.responsiveFooter }),
					...(patch.compactFooterMaxLines === undefined
						? {}
						: { compactMaxLines: patch.compactFooterMaxLines }),
				}),
			);
		},
		setIconMode(mode: IconMode) {
			currentConfig = saveIconsModePatch(mode);
		},
		setContextStyle(style: ContextStyle) {
			currentConfig = saveStarshipFooterStylePatch({ contextStyle: style });
		},
		setSeparator(separator: SeparatorStyle) {
			currentConfig = saveStarshipFooterStylePatch({ separator });
		},
		setPathDisplay(patch: Partial<PathDisplayConfig>) {
			currentConfig = saveStarshipFooterStylePatch({ pathDisplay: patch as PathDisplayConfig });
		},
		setGitBranch(patch: Partial<GitBranchConfig>) {
			currentConfig = saveStarshipFooterStylePatch({ gitBranch: patch as GitBranchConfig });
		},
		setGitCommit(
			patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
			ctx: ExtensionContext,
		) {
			currentConfig = saveStarshipFooterStylePatch({ gitCommit: patch as GitCommitConfig });
			if (patch.showTag !== undefined) reconcileProjectRefresh(ctx, true);
		},
		setGitMetrics(patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) {
			currentConfig = saveStarshipFooterStylePatch({ gitMetrics: patch as GitMetricsConfig });
			if (patch.ignoreSubmodules !== undefined) reconcileProjectRefresh(ctx, true);
		},
		getActiveExtensionStatuses() {
			return getActiveExtensionStatuses();
		},
		setExtensionStatusDefaultPlacement(placement: ExtensionStatusPlacement) {
			currentConfig = saveExtensionStatusDefaultPlacement(placement);
		},
		setExtensionStatusPlacement(key: string, placement: ExtensionStatusPlacement) {
			currentConfig = saveExtensionStatusPlacement(key, placement);
		},
		setExtensionStatusColorMode(key: string, colorMode: ExtensionStatusColorMode) {
			currentConfig = saveExtensionStatusColorMode(key, colorMode);
		},
		requestRender() {
			refresh();
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		thinkingExperimental.shutdown();
		liveContext.clear();
		interactionMetrics.shutdown();
		workingLine.dispose(ctx);
		cleanupUi(ctx);
	});

	const syncInteractiveAndProjectStateWithUsage = (_event: unknown, ctx: ExtensionContext) => {
		invalidateUsageTotalsCache();
		refreshInteractiveState(ctx, true);
	};

	pi.on("message_start", (event) => thinkingExperimental.beginMessage(event));

	pi.on("agent_start", (event, ctx) => {
		liveContext.clear();
		const { interactionStarted } = interactionMetrics.agentStart();
		startAgentTurn(interactionStarted);
		workingLine.startAgent(ctx);
		syncInteractiveState(event, ctx);
	});
	pi.on("turn_start", (_event, ctx) => {
		interactionMetrics.turnStart();
		workingLine.startTurn(ctx);
	});
	pi.on("agent_end", (event, ctx) => {
		thinkingExperimental.endAgent();
		liveContext.clear();
		const displayTokens = interactionMetrics.currentDisplayTokens();
		interactionMetrics.agentEnd();
		pauseAgentRun();
		workingLine.finishAgent(ctx);
		workingLine.updateMetrics(displayTokens, interactionMetrics.currentThought(), ctx);
		// Reconcile once more after Pi has persisted the assistant message.
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
	pi.on("model_select", (event, ctx) => {
		liveContext.clear();
		syncInteractiveState(event, ctx);
	});
	pi.on("thinking_level_select", syncInteractiveState);
	pi.on("session_info_changed", syncInteractiveState);
	pi.on("message_update", (event, ctx) => {
		thinkingExperimental.updateMessage(event);
		liveContext.update(event.message);
		const metrics = interactionMetrics.messageUpdate(
			event.message,
			"assistantMessageEvent" in event ? event.assistantMessageEvent : undefined,
		);
		if (metrics.usageChanged || metrics.thoughtChanged) {
			workingLine.updateMetrics(metrics.displayTokens, interactionMetrics.currentThought(), ctx);
		}
	});
	pi.on("message_end", (event, ctx) => {
		thinkingExperimental.endMessage(event);
		const result = interactionMetrics.messageEnd(event.message);
		if (result.status === "accepted") {
			workingLine.updateMetrics(result.displayTokens, interactionMetrics.currentThought(), ctx);
		}
		// Pi notifies extensions before persisting a successful message, so retain its live
		// context until agent_end; accepted failed messages clear immediately instead of showing
		// stale usage. Rejected and duplicate finals are not authoritative.
		if (
			result.status === "accepted" &&
			event.message.role === "assistant" &&
			(event.message.stopReason === "error" || event.message.stopReason === "aborted")
		) {
			liveContext.clear();
		}
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
	pi.on("agent_settled", (_event, ctx) => {
		const settled = interactionMetrics.settle(ctx.isIdle());
		if (!settled) return;
		settleAgentTurn(settled.nextStartedAt);
		workingLine.settle(settled.nextTokens, settled.nextThought, ctx);
		const config = currentConfig.components.workingLine;
		if (config.enabled && config.turnSummary) {
			try {
				pi.appendEntry(TURN_SUMMARY_ENTRY_TYPE, {
					version: 3,
					...settled.summary,
					stylePrefix: snapshotWorkingLineHighStyle(ctx.ui.theme, config, currentConfig.colors),
				});
			} catch {
				// A transcript persistence failure must not break settlement cleanup.
			}
		}
	});
	pi.on("tool_execution_start", (event, ctx) => {
		liveContext.clear();
		workingLine.startTool(event.toolCallId, event.toolName, ctx);
		syncInteractiveState(event, ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		workingLine.finishTool(event.toolCallId, ctx);
		syncInteractiveAndProjectState(event, ctx);
	});
	pi.on("session_compact", (event, ctx) => {
		liveContext.clear();
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
	pi.on("session_tree", (event, ctx) => {
		liveContext.clear();
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
}
