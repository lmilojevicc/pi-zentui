import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { CodexQuotaCollector, editorWantsCodexQuota } from "./codex-quota";
import { componentColor } from "./component-colors";
import {
	type AccentRailEditorStyleConfig,
	type ContextStyle,
	defaultConfig,
	type EditorComponentConfig,
	type ExtensionStatusChoice,
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
	type MinimalistEditorStylePatch,
	migrateComponentSelections,
	type PathDisplayConfig,
	type PolishedCopyFriendlyEditorStyleConfig,
	type PolishedEditorStyleConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type SeparatorStyle,
	saveAccentRailEditorStylePatch,
	saveComponentColor,
	saveComponentPreset,
	saveEditorComponentPatch,
	saveExtensionStatusChoice,
	saveExtensionStatusColorMode,
	saveExtensionStatusDefaultChoice,
	saveFooterComponentPatch,
	saveHiddenExtensionStatusColorMode,
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
	editorDemandsCustomVariable,
	editorMetadataReferences,
	footerDemandsCustomVariable,
} from "./custom-variable-demand";
import { CustomVariables } from "./custom-variables";
import {
	type EditorTransferFailureReason,
	replaceEditorComponentWithExpandedText,
} from "./editor-transfer";
import { createExtensionStatusController } from "./extension-status-controller";
import { installFooter, installHiddenFooter } from "./footer";
import { compiledFooterFormat } from "./footer-format";
import {
	buildSessionDurationLabel,
	EventUsageTotalsController,
	resolveContextUsage,
} from "./format";
import { emptyGitStatus, readGitStatus } from "./git";
import { type HostTemplateValues, isHostTemplateVariable } from "./host-template-values";
import {
	InteractionMetricsTracker,
	renderTurnSummaryEntry,
	TURN_SUMMARY_ENTRY_TYPE,
} from "./interaction-summary";
import { LayeredEditorConsumer } from "./layered-editor";
import { LiveContextController } from "./live-context";
import { readPackageVersionResult } from "./package-version";
import { getComponentPreset } from "./presets";
import { projectDemand } from "./project-demand";
import { ProjectDiscovery } from "./project-discovery.js";
import {
	createProjectRefreshScheduler,
	type ProjectRefreshRun,
	type ScheduleProjectRefreshOptions,
	type StopProjectRefreshInterval,
	startProjectRefreshInterval,
} from "./project-refresh";
import { applyProjectRefreshToState, projectStateSnapshot } from "./project-state";
import { RepositoryRootController, type RepositoryRootRequest } from "./repository-root";
import { readRuntimeInfo } from "./runtime";
import { installSelectorBorderStyle, removeSelectorBorderStyle } from "./selector-border";
import { SessionLifecycle } from "./session-lifecycle";
import { registerZentuiSettingsCommand } from "./settings-command";
import {
	createInitialState,
	type FooterState,
	modelLabelFor,
	syncModelState,
	syncState,
	syncUsageState,
} from "./state";
import { FooterTelemetryController } from "./telemetry";
import { ThinkingExperimentalController } from "./thinking-experimental";
import { editorWantsContext, PolishedEditor, WrappedPolishedEditor } from "./ui";
import { installUserMessageStyle, removeUserMessageStyle } from "./user-message";
import {
	AgentDurationClock,
	snapshotWorkingLineHighStyle,
	WorkingLineController,
} from "./working-line";
import { WorkingLineExtensionSegments } from "./working-line-extension-segments";

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
		? new Set(compiledFooterFormat(starship.format, FOOTER_FORMAT_ALIASES).references)
		: new Set<string>([
				...(starship.segments.cwd ? ["cwd"] : []),
				...(starship.segments.gitBranch ? ["git_branch"] : []),
				...(starship.segments.gitStatus ? ["git_status"] : []),
				...(starship.segments.gitBranch || starship.segments.gitStatus ? ["git_state"] : []),
				...(config.components.footer.codexQuota ? ["codex_quota"] : []),
				...(starship.segments.sessionName ? ["session_name"] : []),
				...(starship.segments.runtime ? ["runtime"] : []),
				...(starship.segments.gitCommit ? ["git_commit"] : []),
				...(starship.segments.gitMetrics ? ["git_metrics"] : []),
				...(starship.segments.packageVersion ? ["package"] : []),
				...(starship.segments.sessionDuration ? ["session_duration"] : []),
				...(starship.segments.time ? ["time"] : []),
				...(starship.segments.cost ? ["cost", "subscription"] : []),
				...(starship.segments.tokens ? ["tokens"] : []),
				...(starship.segments.context ? ["auto_compaction"] : []),
			]);
	if (starship.responsive) {
		for (const name of compiledFooterFormat(starship.compactFormat, FOOTER_FORMAT_ALIASES)
			.references) {
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

export type ZentuiHost = {
	wrapEditor?: boolean;
	skinOnly?: boolean;
	liveModel?: boolean;
	getFastMode?: (ctx: ExtensionContext) => string | undefined;
	getHostTemplateValues?: (
		ctx: ExtensionContext,
		names: ReadonlySet<string>,
	) => HostTemplateValues | undefined;
};

export default function (pi: ExtensionAPI, host: ZentuiHost = {}) {
	const state: FooterState = createInitialState(emptyGitStatus());
	const sessionLifecycle = new SessionLifecycle();
	const editorOwnerToken = Symbol("zentui-editor-owner");

	// Unsupported OMP surfaces stay native; this runtime view is never written back.
	const scopeConfig = (config: PolishedTuiConfig): PolishedTuiConfig =>
		host.skinOnly
			? {
					...config,
					components: {
						...config.components,
						thinkingSteps: { ...config.components.thinkingSteps, enabled: false },
						workingLine: { ...config.components.workingLine, enabled: false },
						selectorBorders: { ...config.components.selectorBorders, enabled: false },
					},
				}
			: config;
	let currentConfig: PolishedTuiConfig = scopeConfig(structuredClone(defaultConfig));
	// Keep the capability guard defensive for hosts with incomplete extension APIs.
	if (!host.skinOnly && typeof pi.registerEntryRenderer === "function") {
		pi.registerEntryRenderer(TURN_SUMMARY_ENTRY_TYPE, (entry, options, theme) =>
			renderTurnSummaryEntry(
				entry,
				{
					...options,
					colorSource: currentConfig.components.workingLine.colorSource,
					workingLineHigh: componentColor(currentConfig, "workingLine", "high"),
				},
				theme,
			),
		);
	}
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let requestEditorRender: (() => void) | undefined;
	const extensionStatuses = createExtensionStatusController(
		() => currentConfig.components.extensionStatuses,
	);
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
	let activeEditor:
		| {
				editor: PolishedEditor | WrappedPolishedEditor;
				factory: EditorFactory;
				generation: number;
		  }
		| undefined;
	let wrappedEditorFactory: EditorFactory | undefined;
	let stopSessionTimer: () => void = () => {};
	let stopMinimalistDurationUpdates: () => void = () => {};
	let minimalistDurationUpdatesActive = false;
	let minimalistDecorationEditor: PolishedEditor | WrappedPolishedEditor | undefined;
	let customVariableSessionReady = false;
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

	const layeredEditor = new LayeredEditorConsumer<
		EditorFactory,
		PolishedEditor | WrappedPolishedEditor
	>((generation) => sessionLifecycle.isCurrent(generation));
	const currentEditorFactory = (): EditorFactory | undefined => {
		try {
			return activeTuiContext?.ui.getEditorComponent();
		} catch {
			return undefined;
		}
	};
	// Layered visibility does not grant installation ownership: editor install/restore stays exclusive.
	// Data, demand, and timer consumers use these helpers; Working-line placement additionally
	// requires focused, rendered border capability before its controller hides its own host row.
	// Ownership counts before Pi constructs its editor; layered visibility requires the recorded
	// instance to remain reachable through the current factory.
	const layeredVisibleEditor = () => layeredEditor.editorVisibleThrough(currentEditorFactory());
	const editorConsumerActive = () =>
		ownsInstalledEditorFactory() || layeredVisibleEditor() !== undefined;
	const visibleEditor = () =>
		ownsInstalledEditorFactory() ? activeEditor?.editor : layeredVisibleEditor();
	const requestEditorRepaint = () => {
		requestEditorRender?.();
		// The layered record intentionally outlives ownership clearing, so disabling the editor is
		// gated here; a live wrapper keeps repainting while the editor remains enabled.
		if (effectiveEditorEnabled()) layeredEditor.requestRender(currentEditorFactory());
	};

	const customVariables = new CustomVariables(
		pi.events,
		(key) => {
			if (!customVariableSessionReady || !sessionLifecycle.isCurrent()) return false;
			return (
				(effectiveEditorEnabled() &&
					visibleEditor()?.isMetadataDecorated() === true &&
					editorDemandsCustomVariable(currentConfig, key)) ||
				(installedFooterKind === "starship" &&
					ownsInstalledFooter() &&
					footerDemandsCustomVariable(currentConfig, key))
			);
		},
		() => {
			if (!customVariableSessionReady || !sessionLifecycle.isCurrent()) return;
			requestEditorRepaint();
			requestFooterRender?.();
		},
	);
	const refresh = () => {
		if (!sessionLifecycle.isCurrent()) return;
		customVariables.reconcile();
		codexQuota.reconcile();
		requestFooterRender?.();
		requestEditorRepaint();
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
	let invalidateWorkingLinePublisherState = () => {};
	const workingLine = new WorkingLineController(
		getCurrentConfig,
		() => activeTheme as Theme,
		agentDurationClock,
		Math.random,
		Date.now,
		() => interactionMetrics.currentThought(),
		() => invalidateWorkingLinePublisherState(),
		undefined,
		(ctx) => {
			if (!activeTuiContext || ctx.ui !== activeTuiContext.ui) return false;
			// Factory visibility alone is insufficient: the current focused editor must have
			// rendered safe border geometry before the separately owned Working row can hide.
			return Boolean(
				sessionLifecycle.isCurrent() &&
					effectiveEditorEnabled() &&
					currentConfig.components.editor.style !== "accent-rail" &&
					visibleEditor()?.canEmbedWorkingLineBorder(),
			);
		},
	);
	if (!host.skinOnly)
		workingLine.setRequestRender(() => {
			if (sessionLifecycle.isCurrent()) {
				requestEditorRepaint();
			}
		});
	let workingLineSessionReady = false;
	const workingLineExtensions = new WorkingLineExtensionSegments(
		host.skinOnly ? undefined : pi.events,
		() =>
			workingLineSessionReady &&
			sessionLifecycle.isCurrent() &&
			currentConfig.components.workingLine.enabled &&
			activeTuiContext !== undefined &&
			workingLine.isAvailable(),
		(segments) => {
			if (activeTuiContext && sessionLifecycle.isCurrent()) {
				const applied = workingLine.updateExtensionSegments(segments, activeTuiContext);
				if (!applied && !workingLine.isAvailable()) {
					if (!host.skinOnly) workingLine.invalidateExtensionSegments();
				}
				return applied;
			}
			return false;
		},
	);
	invalidateWorkingLinePublisherState = () => workingLineExtensions.invalidate();
	const getEditorContextMetadata = (ctx: ExtensionContext) => {
		const context = editorWantsContext(currentConfig)
			? resolveContextUsage(ctx, liveContext.get())
			: undefined;
		return { contextPercent: context?.percent, contextWindow: context?.contextWindow };
	};
	const getEditorHostTemplateValues = (ctx: ExtensionContext) => {
		if (!host.getHostTemplateValues) return undefined;
		const names = editorMetadataReferences(currentConfig);
		for (const name of names)
			if (isHostTemplateVariable(name)) return host.getHostTemplateValues(ctx, names);
		return undefined;
	};
	const getEditorMeta = (ctx: ExtensionContext) => {
		if (host.liveModel) syncModelState(state, ctx.model);
		return {
			codexQuota: getEditorQuota(),
			modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
			modelId: state.modelId,
			modelName: state.modelName,
			providerLabel: state.providerLabel,
			fastMode: host.getFastMode?.(ctx),
			hostTemplateValues: getEditorHostTemplateValues(ctx),
			sessionName: ctx.sessionManager.getSessionName() ?? "",
			...getEditorContextMetadata(ctx),
			inputTokens: state.usageTotals.input,
			outputTokens: state.usageTotals.output,
			cacheHitRate: state.usageTotals.latestCacheHitRate,
			customVariables: customVariables.snapshot(),
		};
	};
	const getAgentDurationMs = () => agentDurationClock.elapsedMs();
	const getThinkingLevel = () =>
		sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : ("off" as const);
	const footerTelemetry = new FooterTelemetryController();
	const getFooterTelemetry = (ctx: ExtensionContext) => {
		const references = installedFooterReferences();
		return footerTelemetry.resolve(ctx, {
			subscription: references.has("subscription"),
			autoCompaction: references.has("auto_compaction"),
		});
	};
	const syncFooterTelemetry = (ctx: ExtensionContext) => {
		const telemetry = getFooterTelemetry(ctx);
		state.subscription = telemetry.subscription === true;
		state.autoCompaction = telemetry.autoCompaction === true;
	};
	const usageTotals = new EventUsageTotalsController();
	const getFooterUsage = (ctx: ExtensionContext) => {
		const references = installedFooterReferences();
		return usageTotals.resolve(
			ctx,
			(effectiveEditorEnabled() &&
				editorConsumerActive() &&
				["tokens", "input_tokens", "output_tokens", "cost", "cache_hit"].some((name) =>
					editorMetadataReferences(currentConfig).has(name),
				)) ||
				["tokens", "cache_read", "cache_write", "cost"].some((name) => references.has(name)),
		);
	};
	const syncFooterUsage = (ctx: ExtensionContext) =>
		syncUsageState(state, getFooterUsage(ctx), currentConfig.icons.cacheHit);
	const syncFooterState = (ctx: ExtensionContext) =>
		syncState(state, ctx, currentConfig.icons.cacheHit, getFooterTelemetry(ctx), {
			includeContextLabel: false,
			usageTotals: getFooterUsage(ctx),
		});
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

	const codexQuota = new CodexQuotaCollector(
		() => {
			const ctx = activeTuiContext;
			if (
				!ctx ||
				!sessionLifecycle.isCurrent() ||
				!isTuiContext(ctx) ||
				ctx.model?.provider !== "openai-codex"
			)
				return undefined;
			const editorDemand =
				effectiveEditorEnabled() && editorConsumerActive() && editorWantsCodexQuota(currentConfig);
			const footerDemand =
				effectiveFooterStyle() === "starship" &&
				currentConfig.components.footer.codexQuota &&
				installedFooterReferences().has("codex_quota");
			return editorDemand || footerDemand ? ctx : undefined;
		},
		() => {
			if (!sessionLifecycle.isCurrent()) return;
			requestFooterRender?.();
			requestEditorRepaint();
		},
	);
	const getEditorQuota = () =>
		currentConfig.components.editor.codexQuota &&
		activeTuiContext?.model?.provider === "openai-codex"
			? codexQuota.get()
			: undefined;

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
			return false;
		}
		const demand = getProjectDemand();
		if (!demand.active) return false;
		const discovery =
			demand.runtime || demand.packageVersion ? new ProjectDiscovery(cwd) : undefined;
		const [git, runtime, packageVersion] = await Promise.all([
			demand.git
				? readGitStatus(cwd, demand.gitOptions)
				: Promise.resolve({ kind: "not_a_repo" as const }),
			demand.runtime
				? readRuntimeInfo(cwd, discovery)
				: Promise.resolve({ kind: "ok" as const, runtime: undefined }),
			demand.packageVersion
				? readPackageVersionResult(cwd, discovery)
				: Promise.resolve({ kind: "ok" as const, result: null }),
		]);
		if (
			!run.isCurrent() ||
			!sessionLifecycle.isCurrent(sessionGeneration) ||
			!repositoryRoots.isCurrent(repository)
		) {
			return false;
		}
		if (JSON.stringify(demand) !== JSON.stringify(getProjectDemand())) return false;
		const previous = projectStateSnapshot(state, lastProjectCwd, minimalistProjectRoot);
		// Root-only consumers validate markers without paying for a git status probe.
		minimalistProjectRoot = repositoryRoots.update(repository, demand.root);
		lastProjectCwd = applyProjectRefreshToState(state, {
			cwd,
			previousCwd: lastProjectCwd,
			git,
			runtime,
			packageVersion,
		});
		return previous !== projectStateSnapshot(state, lastProjectCwd, minimalistProjectRoot);
	};

	const projectRefreshScheduler = createProjectRefreshScheduler(refreshProjectState, refresh);
	const scheduleProjectRefresh = (
		ctx: ExtensionContext,
		options?: ScheduleProjectRefreshOptions,
	) => {
		const sessionGeneration = sessionLifecycle.currentGeneration();
		if (!sessionLifecycle.isCurrent(sessionGeneration)) return;
		if (!needsProjectRefresh()) {
			stopProjectRefresh();
			return;
		}
		const repository = repositoryRoots.request(ctx.cwd);
		minimalistProjectRoot = repositoryRoots.cachedRootForCwd(ctx.cwd);
		projectRefreshScheduler.schedule({ repository, sessionGeneration }, options);
	};

	const getProjectDemand = () =>
		projectDemand(
			currentConfig,
			installedFooterReferences(),
			effectiveEditorEnabled() &&
				editorConsumerActive() &&
				currentConfig.components.editor.style === "minimalist",
		);

	const needsProjectRefresh = () => getProjectDemand().active;

	const stopProjectRefresh = () => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		projectRefreshScheduler.stop();
		projectRefreshActive = false;
		Object.assign(state, emptyGitStatus());
		state.runtime = undefined;
		state.packageVersion = undefined;
		lastProjectCwd = undefined;
		minimalistProjectRoot = undefined;
		repositoryRoots.reset();
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
		if (activeTuiContext?.ui === ctx.ui) activeTuiContext = ctx;
		if (editorInstalled && !ownsInstalledEditorFactory()) reconcileObservedEditorOwnership(ctx);
		// A layered editor can stop being visible without any ownership transition to observe.
		if (projectRefreshActive && !needsProjectRefresh()) stopProjectRefresh();
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
			minimalistDecorationActive() &&
			effectiveEditorEnabled() &&
			currentConfig.components.editor.style === "minimalist" &&
			editorMetadataReferences(currentConfig).has("turn_duration");
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

	// Decoration is bound to the editor instance that reported it, so it stays valid while that
	// editor is visible (owned or layered) and cannot leak to a replacement editor.
	const minimalistDecorationActive = () =>
		sessionLifecycle.isCurrent() &&
		minimalistDecorationEditor !== undefined &&
		visibleEditor() === minimalistDecorationEditor;
	const reconcileMinimalistDecoration = () => {
		customVariables.reconcile();
		reconcileAgentTimer();
	};
	const setMinimalistDecorationActive = (
		active: boolean,
		editor?: PolishedEditor | WrappedPolishedEditor,
	) => {
		const next = active ? editor : undefined;
		if (minimalistDecorationEditor === next) return;
		minimalistDecorationEditor = next;
		reconcileMinimalistDecoration();
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
		currentConfig = scopeConfig(nextConfig);
		syncFooterUsage(ctx);
		syncFooterTelemetry(ctx);
		codexQuota.reconcile();
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
		activeEditor = undefined;
		if (activeTuiContext && workingLineSessionReady) {
			if (!host.skinOnly) workingLine.reconcile(activeTuiContext);
		}
		requestEditorRender = undefined;
		wrappedEditorFactory = undefined;
		installedEditorFactory = undefined;
		editorInstallMode = "none";
		editorInstalled = false;
		reconcileMinimalistDecoration();
		codexQuota.reconcile();
	};

	const trackZentuiEditorFactory = (factory: EditorFactory): boolean => {
		if (!isOwnedEditorFactory(factory)) return false;
		if (activeEditor?.factory !== factory) activeEditor = undefined;
		const baseFactory = getZentuiEditorBaseFactory(factory);
		wrappedEditorFactory = baseFactory;
		installedEditorFactory = factory;
		editorInstallMode = baseFactory && host.wrapEditor !== false ? "wrapper" : "standalone";
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
		if (!observed.known) {
			activeEditor = undefined;
			if (workingLineSessionReady) {
				if (!host.skinOnly) workingLine.reconcile(ctx);
			}
			return observed;
		}
		if (observed.factory && isOwnedEditorFactory(observed.factory)) {
			trackZentuiEditorFactory(observed.factory);
		} else {
			clearEditorOwnership();
			reconcileProjectRefresh(ctx);
		}
		return observed;
	};

	// Also true for an editor still visible beneath a foreign wrapper; installation stays exclusive.
	const isVisibleEditor = (editor: PolishedEditor | WrappedPolishedEditor, generation: number) =>
		sessionLifecycle.isCurrent(generation) && visibleEditor() === editor;

	const editorBorderCapabilityChanged = (
		editor: PolishedEditor | WrappedPolishedEditor,
		generation: number,
	) => {
		if (!isVisibleEditor(editor, generation) || !activeTuiContext || !workingLineSessionReady)
			return;
		if (!host.skinOnly) workingLine.reconcile(activeTuiContext);
		if (workingLine.isAvailable()) requestEditorRepaint();
	};

	const editorMetadataDecorationChanged = (
		editor: PolishedEditor | WrappedPolishedEditor,
		generation: number,
	) => {
		if (isVisibleEditor(editor, generation)) customVariables.reconcile();
	};

	const editorWorkingLineFrame = (
		editor: PolishedEditor | WrappedPolishedEditor,
		generation: number,
	) => {
		if (host.skinOnly || !sessionLifecycle.isCurrent(generation)) return undefined;
		// Even a stale instance render must release a row whose current border disappeared.
		const frame = workingLine.currentWorkingLineFrame();
		return isVisibleEditor(editor, generation) ? frame : undefined;
	};

	/** Records a freshly constructed editor as owned (exclusive) or visible beneath a foreign wrapper. */
	const registerConstructedEditor = (
		ctx: ExtensionContext,
		factory: ZentuiEditorFactory,
		generation: number,
		editor: PolishedEditor | WrappedPolishedEditor,
		tui: TUI,
	) => {
		const observed = observeEditorFactory(ctx);
		if (
			!sessionLifecycle.isCurrent(generation) ||
			activeTuiContext?.ui !== ctx.ui ||
			!observed.known
		) {
			return;
		}
		if (observed.factory === factory) {
			activeEditor = { editor, factory, generation };
			requestEditorRender = () => tui.requestRender();
		} else if (observed.factory && !isZentuiEditorFactory(observed.factory)) {
			// A foreign wrapper built this editor beneath its own outer factory.
			layeredEditor.attach(observed.factory, generation, editor, () => tui.requestRender());
		}
	};

	const makeEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory | undefined,
	): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const generation = sessionLifecycle.currentGeneration();
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
			const editor: PolishedEditor = new PolishedEditor(
				tui,
				theme,
				keybindings,
				sessionTheme,
				getCurrentConfig,
				() => getEditorMeta(activeTuiContext ?? ctx),
				getThinkingLevel,
				() => {
					if (host.liveModel) syncModelState(state, (activeTuiContext ?? ctx).model);
					const workingLineFrame = editorWorkingLineFrame(editor, generation);
					if (currentConfig.components.editor.style !== "minimalist") {
						return { cwd: "", workingLineFrame };
					}
					return {
						codexQuota: getEditorQuota(),
						cwd: (activeTuiContext ?? ctx).cwd,
						projectRoot: minimalistProjectRoot,
						branch: state.branch,
						dirty: state.dirty,
						ahead: state.ahead,
						behind: state.behind,
						costLabel: state.costLabel,
						customVariables: customVariables.snapshot(),
						modelId: state.modelId,
						modelName: state.modelName,
						provider: state.providerLabel,
						inputTokens: state.usageTotals.input,
						outputTokens: state.usageTotals.output,
						modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
						thinkingLevel: getThinkingLevel(),
						fastMode: host.getFastMode?.(activeTuiContext ?? ctx),
						hostTemplateValues: getEditorHostTemplateValues(activeTuiContext ?? ctx),
						...getEditorContextMetadata(activeTuiContext ?? ctx),
						cacheHitRate: state.usageTotals.latestCacheHitRate,
						sessionName: (activeTuiContext ?? ctx).sessionManager.getSessionName() ?? "",
						agentDurationMs: getAgentDurationMs(),
						agentActive: agentRunActive,
						workingLineFrame,
					};
				},
				(active) => {
					if (isVisibleEditor(editor, generation)) setMinimalistDecorationActive(active, editor);
				},
				() => editorBorderCapabilityChanged(editor, generation),
				() => editorMetadataDecorationChanged(editor, generation),
			);
			registerConstructedEditor(ctx, factory, generation, editor, tui);
			return editor;
		}) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		factory[ZENTUI_EDITOR_OWNER] = editorOwnerToken;
		// Retain an observed predecessor for restoration without delegating input to it.
		factory[ZENTUI_EDITOR_BASE_FACTORY] = baseFactory;
		return factory;
	};

	const makeWrappedEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory,
	): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const generation = sessionLifecycle.currentGeneration();
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
			const editor: WrappedPolishedEditor = new WrappedPolishedEditor(
				baseFactory(tui, theme, keybindings),
				sessionTheme,
				getCurrentConfig,
				() => getEditorMeta(activeTuiContext ?? ctx),
				getThinkingLevel,
				() => {
					if (host.liveModel) syncModelState(state, (activeTuiContext ?? ctx).model);
					const workingLineFrame = editorWorkingLineFrame(editor, generation);
					if (currentConfig.components.editor.style !== "minimalist") {
						return { cwd: "", workingLineFrame };
					}
					return {
						codexQuota: getEditorQuota(),
						cwd: (activeTuiContext ?? ctx).cwd,
						projectRoot: minimalistProjectRoot,
						branch: state.branch,
						dirty: state.dirty,
						ahead: state.ahead,
						behind: state.behind,
						costLabel: state.costLabel,
						customVariables: customVariables.snapshot(),
						modelId: state.modelId,
						modelName: state.modelName,
						provider: state.providerLabel,
						inputTokens: state.usageTotals.input,
						outputTokens: state.usageTotals.output,
						modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
						thinkingLevel: getThinkingLevel(),
						fastMode: host.getFastMode?.(activeTuiContext ?? ctx),
						hostTemplateValues: getEditorHostTemplateValues(activeTuiContext ?? ctx),
						...getEditorContextMetadata(activeTuiContext ?? ctx),
						cacheHitRate: state.usageTotals.latestCacheHitRate,
						sessionName: (activeTuiContext ?? ctx).sessionManager.getSessionName() ?? "",
						agentDurationMs: getAgentDurationMs(),
						agentActive: agentRunActive,
						workingLineFrame,
					};
				},
				(active) => {
					if (isVisibleEditor(editor, generation)) setMinimalistDecorationActive(active, editor);
				},
				() => editorBorderCapabilityChanged(editor, generation),
				() => editorMetadataDecorationChanged(editor, generation),
			);
			registerConstructedEditor(ctx, factory, generation, editor, tui);
			return editor;
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
		const nextFactory =
			baseFactory && host.wrapEditor !== false
				? makeWrappedEditorFactory(ctx, baseFactory)
				: makeEditorFactory(ctx, baseFactory);
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
		customVariables.reconcile();
		codexQuota.reconcile();
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
				getThinkingLevel,
				beforeRender: host.liveModel ? () => syncModelState(state, ctx.model) : undefined,
				getFastMode: () => host.getFastMode?.(ctx),
				getHostTemplateValues: (names) => host.getHostTemplateValues?.(ctx, names),
				getLiveContext: () => liveContext.get(),
				getCodexQuota: () => codexQuota.get(),
				getCustomVariables: () => customVariables.snapshot(),
				getRepositoryRoot: (cwd) => repositoryRoots.cachedRootForCwd(cwd),
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
			installHiddenFooter(ctx, () => currentConfig.components.extensionStatuses, {
				setRequestRender: (fn) => {
					requestFooterRender = fn;
				},
				setExtensionStatusesGetter: (fn) => {
					getActiveExtensionStatuses = fn ?? (() => new Map());
				},
				onDispose: () => clearFooterOwnership(ctx, token),
			});
			installedFooterKind = "hidden";
			installedFooterToken = token;
			setStatusLineOwnership(ctx, token);
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
		syncFooterTelemetry(ctx);
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
					return {
						ok: false,
						reason:
							"another Zentui instance is currently managing the editor; reload Pi to apply this change",
					};
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
		} finally {
			if (workingLineSessionReady) {
				if (!host.skinOnly) workingLine.reconcile(ctx);
			}
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
		syncFooterUsage(ctx);
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
		if (!host.skinOnly) {
			try {
				removeSelectorBorderStyle();
			} catch {
				// Startup alone may supersede a stale registration from an earlier reload.
			}
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
				const previousTotals = state.usageTotals;
				syncFooterUsage(ctx);
				if (state.usageTotals !== previousTotals) refresh();
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
			syncFooterUsage(ctx);
			refresh();
		});
	};

	const cleanupUi = (ctx?: ExtensionContext) => {
		if (!ctx || !sessionLifecycle.isCurrent()) return;
		sessionLifecycle.shutdown();
		activeEditor = undefined;
		minimalistDecorationEditor = undefined;
		layeredEditor.detach();
		extensionStatuses.dispose();
		codexQuota.stop();
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
		codexQuota.stop();
		usageTotals.invalidate();
		footerTelemetry.reset();
		customVariableSessionReady = false;
		customVariables.clear();
		const lifecycleGeneration = sessionLifecycle.start();
		activeEditor = undefined;
		minimalistDecorationEditor = undefined;
		// A new generation must not expose or route extension segments through the previous
		// session while TUI startup is in progress.
		workingLineSessionReady = false;
		if (!host.skinOnly) workingLineExtensions.invalidate();
		if (activeTuiContext) {
			if (!host.skinOnly) workingLine.dispose(activeTuiContext);
		} else {
			if (!host.skinOnly) workingLine.invalidateExtensionSegments();
		}
		// Reload synchronously so private ownership uses this session's disk snapshot before
		// any await or transcript restoration.
		currentConfig = scopeConfig(loadConfig());
		extensionStatuses.dispose();
		if (!host.skinOnly && isTuiContext(ctx)) extensionStatuses.install(ctx.ui);
		if (!host.skinOnly) thinkingExperimental.startSession(ctx);
		if (!sessionLifecycle.isCurrent(lifecycleGeneration)) return;
		liveContext.clear();
		interactionMetrics.shutdown();
		if (!host.skinOnly) workingLineExtensions.invalidate();
		state.sessionStartEpoch = Date.now();
		resetAgentTimer();
		lastProjectCwd = undefined;
		minimalistProjectRoot = undefined;
		repositoryRoots.reset();
		installUi(ctx);
		customVariableSessionReady = isTuiContext(ctx);
		if (!host.skinOnly) workingLine.startSession(ctx);
		workingLineSessionReady = !host.skinOnly;
		scheduleEditorReconciliation(ctx);
	});

	registerZentuiSettingsCommand(pi, {
		sessionLifecycle,
		skinOnly: host.skinOnly,
		getConfig: getCurrentConfig,
		applyPreset(id, ctx, options) {
			const preset = getComponentPreset(id);
			if (!preset) throw new Error(`Unknown Zentui preset: ${id}`);
			const previousFooterStyle = effectiveFooterStyle();
			currentConfig = scopeConfig(saveComponentPreset(preset));
			if (!isTuiContext(ctx)) return { applied: true };
			activeTheme = ctx.ui.theme;
			const result = options?.deferEditor ? undefined : reconcileEditor(ctx);
			if (currentConfig.components.editor.style !== "minimalist") {
				setMinimalistDecorationActive(false);
			}
			if (!host.skinOnly) workingLine.reconcile(ctx);
			reconcileUserMessages();
			reconcileFooter(ctx);
			reconcileProjectRefresh(ctx, effectiveFooterStyle() !== previousFooterStyle);
			reconcileSessionTimer();
			reconcileAgentTimer();
			syncFooterUsage(ctx);
			refresh();
			return {
				applied: !result || result.ok,
				reason: result && !result.ok ? result.reason : undefined,
			};
		},
		migrateSelections(ctx) {
			currentConfig = scopeConfig(migrateComponentSelections());
			if (!isTuiContext(ctx)) return;
			activeTheme = ctx.ui.theme;
			reconcileEditor(ctx);
			reconcileUserMessages();
			reconcileSelectorBorders();
			reconcileFooter(ctx);
			if (!host.skinOnly) workingLine.reconcile(ctx);
			if (!host.skinOnly) thinkingExperimental.reconcile();
			syncFooterState(ctx);
			reconcileProjectRefresh(ctx);
			reconcileSessionTimer();
			reconcileAgentTimer();
			refresh();
		},
		setComponentColor(owner, key, value, ctx) {
			currentConfig = scopeConfig(saveComponentColor(owner, key, value));
			if (owner === "workingLine") {
				if (!host.skinOnly) workingLine.reconcile(ctx);
			}
			refresh();
		},
		reconcilePresetEditor(ctx) {
			if (!isTuiContext(ctx) || !sessionLifecycle.isCurrent()) return { applied: true };
			const result = reconcileEditor(ctx);
			syncFooterUsage(ctx);
			reconcileProjectRefresh(ctx);
			reconcileAgentTimer();
			refresh();
			return {
				applied: !result || result.ok,
				reason: result && !result.ok ? result.reason : undefined,
			};
		},
		setEditorComponent(patch: Partial<EditorComponentConfig>, ctx: ExtensionContext, options) {
			currentConfig = scopeConfig(saveEditorComponentPatch(patch));
			let result: EditorChangeResult | undefined;
			if (patch.enabled !== undefined && isTuiContext(ctx) && !options?.deferEditor) {
				result = reconcileEditor(ctx);
			}
			if (patch.style !== undefined && patch.style !== "minimalist") {
				setMinimalistDecorationActive(false);
			}
			if (!host.skinOnly) workingLine.reconcile(ctx);
			syncFooterUsage(ctx);
			if (patch.modelLabel !== undefined) syncFooterState(ctx);
			reconcileProjectRefresh(ctx);
			reconcileAgentTimer();
			refresh();
			return {
				applied: !result || result.ok,
				reason: result && !result.ok ? result.reason : undefined,
			};
		},
		setPolished(patch: Partial<PolishedEditorStyleConfig>, ctx: ExtensionContext) {
			currentConfig = scopeConfig(savePolishedEditorStylePatch(patch));
			syncFooterUsage(ctx);
			refresh();
		},
		setPolishedCopyFriendly(
			patch: Partial<PolishedCopyFriendlyEditorStyleConfig>,
			ctx: ExtensionContext,
		) {
			currentConfig = scopeConfig(savePolishedCopyFriendlyEditorStylePatch(patch));
			syncFooterUsage(ctx);
			refresh();
		},
		setAccentRail(patch: Partial<AccentRailEditorStyleConfig>, _ctx: ExtensionContext) {
			currentConfig = scopeConfig(saveAccentRailEditorStylePatch(patch));
			refresh();
		},
		setMinimalist(patch: MinimalistEditorStylePatch, ctx: ExtensionContext) {
			currentConfig = scopeConfig(saveMinimalistEditorStylePatch(patch));
			customVariables.reconcile();
			syncFooterUsage(ctx);
			reconcileAgentTimer();
			reconcileProjectRefresh(
				ctx,
				patch.formats !== undefined ||
					patch.pathDisplay !== undefined ||
					patch.showGit !== undefined,
			);
			refresh();
		},
		setUserMessagesComponent(patch: Partial<UserMessagesComponentConfig>, _ctx: ExtensionContext) {
			currentConfig = scopeConfig(saveUserMessagesComponentPatch(patch));
			if (patch.enabled !== undefined || patch.style !== undefined) reconcileUserMessages();
			refresh();
		},
		thinkingStepsCapability,
		setThinkingStepsComponent(
			patch: Partial<ThinkingStepsComponentConfig>,
			_ctx: ExtensionContext,
		) {
			currentConfig = scopeConfig(saveThinkingStepsComponentPatch(patch));
			return thinkingExperimental.reconcile();
		},
		setWorkingLineComponent(patch: WorkingLineComponentPatch, ctx: ExtensionContext) {
			currentConfig = scopeConfig(saveWorkingLineComponentPatch(patch));
			if (patch.enabled === false) {
				if (!host.skinOnly) workingLineExtensions.clear();
			}
			return workingLine.reconcile(ctx);
		},
		setSelectorBordersComponent(
			patch: Partial<SelectorBordersComponentConfig>,
			_ctx: ExtensionContext,
		) {
			currentConfig = scopeConfig(saveSelectorBordersComponentPatch(patch));
			if (patch.enabled !== undefined || patch.style !== undefined) reconcileSelectorBorders();
			refresh();
		},
		setFooterComponent(patch: Partial<FooterComponentConfig>, ctx: ExtensionContext) {
			const previousStyle = effectiveFooterStyle();
			currentConfig = scopeConfig(saveFooterComponentPatch(patch));
			const styleChanged = effectiveFooterStyle() !== previousStyle;
			if (patch.style !== undefined) reconcileFooter(ctx);
			if (patch.modelLabel !== undefined) syncFooterState(ctx);
			reconcileProjectRefresh(ctx, styleChanged);
			reconcileSessionTimer();
			syncFooterUsage(ctx);
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
			currentConfig = scopeConfig(saveIconsModePatch(mode));
		},
		setContextStyle(style: ContextStyle) {
			currentConfig = scopeConfig(saveStarshipFooterStylePatch({ contextStyle: style }));
		},
		setSeparator(separator: SeparatorStyle) {
			currentConfig = scopeConfig(saveStarshipFooterStylePatch({ separator }));
		},
		setPathDisplay(patch: Partial<PathDisplayConfig>) {
			currentConfig = scopeConfig(
				saveStarshipFooterStylePatch({ pathDisplay: patch as PathDisplayConfig }),
			);
			if (activeTuiContext) reconcileProjectRefresh(activeTuiContext, true);
		},
		setGitBranch(patch: Partial<GitBranchConfig>) {
			currentConfig = scopeConfig(
				saveStarshipFooterStylePatch({ gitBranch: patch as GitBranchConfig }),
			);
		},
		setGitCommit(
			patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
			ctx: ExtensionContext,
		) {
			currentConfig = scopeConfig(
				saveStarshipFooterStylePatch({ gitCommit: patch as GitCommitConfig }),
			);
			if (patch.showTag !== undefined) reconcileProjectRefresh(ctx, true);
		},
		setGitMetrics(patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) {
			currentConfig = scopeConfig(
				saveStarshipFooterStylePatch({ gitMetrics: patch as GitMetricsConfig }),
			);
			if (patch.ignoreSubmodules !== undefined) reconcileProjectRefresh(ctx, true);
		},
		getActiveExtensionStatuses() {
			return new Map([...getActiveExtensionStatuses(), ...extensionStatuses.snapshot()]);
		},
		setExtensionStatusDefaultChoice(placement: ExtensionStatusPlacement) {
			currentConfig = scopeConfig(
				saveExtensionStatusDefaultChoice(placement, currentConfig.components.footer.style),
			);
			extensionStatuses.reconcile();
		},
		setExtensionStatusChoice(key: string, choice: ExtensionStatusChoice) {
			currentConfig = scopeConfig(
				saveExtensionStatusChoice(key, choice, currentConfig.components.footer.style),
			);
			extensionStatuses.reconcile();
		},
		setHiddenExtensionStatusColorMode(key, colorMode) {
			currentConfig = scopeConfig(saveHiddenExtensionStatusColorMode(key, colorMode));
		},
		setExtensionStatusColorMode(key: string, colorMode: ExtensionStatusColorMode) {
			currentConfig = scopeConfig(saveExtensionStatusColorMode(key, colorMode));
		},
		requestRender() {
			refresh();
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		customVariableSessionReady = false;
		customVariables.clear();
		usageTotals.invalidate();
		footerTelemetry.reset();
		workingLineSessionReady = false;
		if (!host.skinOnly) thinkingExperimental.shutdown();
		liveContext.clear();
		interactionMetrics.shutdown();
		if (!host.skinOnly) workingLine.dispose(ctx);
		if (!host.skinOnly) workingLineExtensions.invalidate();
		cleanupUi(ctx);
	});

	const syncInteractiveAndProjectStateWithUsage = (_event: unknown, ctx: ExtensionContext) => {
		usageTotals.invalidate();
		refreshInteractiveState(ctx, true);
	};

	if (!host.skinOnly) pi.on("message_start", (event) => thinkingExperimental.beginMessage(event));

	pi.on("agent_start", (event, ctx) => {
		liveContext.clear();
		const { interactionStarted } = interactionMetrics.agentStart();
		startAgentTurn(interactionStarted);
		if (!host.skinOnly) workingLine.startAgent(ctx);
		syncInteractiveState(event, ctx);
	});
	pi.on("turn_start", (_event, ctx) => {
		interactionMetrics.turnStart();
		if (!host.skinOnly) workingLine.startTurn(ctx);
	});
	pi.on("agent_end", (event, ctx) => {
		if (!host.skinOnly) thinkingExperimental.endAgent();
		liveContext.clear();
		const displayTokens = interactionMetrics.currentDisplayTokens();
		interactionMetrics.agentEnd();
		pauseAgentRun();
		if (host.skinOnly) {
			const settled = interactionMetrics.settle(ctx.isIdle());
			if (settled) settleAgentTurn(settled.nextStartedAt);
		}
		if (!host.skinOnly) workingLine.finishAgent(ctx);
		if (!host.skinOnly)
			workingLine.flushMetrics(displayTokens, interactionMetrics.currentThought(), ctx);
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
		if (!host.skinOnly) thinkingExperimental.updateMessage(event);
		liveContext.update(event.message);
		const metrics = interactionMetrics.messageUpdate(
			event.message,
			"assistantMessageEvent" in event ? event.assistantMessageEvent : undefined,
		);
		if (metrics.usageChanged || metrics.thoughtChanged) {
			if (!host.skinOnly)
				workingLine.updateMetrics(metrics.displayTokens, interactionMetrics.currentThought(), ctx);
		}
	});
	pi.on("message_end", (event, ctx) => {
		if (!host.skinOnly) thinkingExperimental.endMessage(event);
		const result = interactionMetrics.messageEnd(event.message);
		if (result.status === "accepted") {
			if (!host.skinOnly)
				workingLine.flushMetrics(result.displayTokens, interactionMetrics.currentThought(), ctx);
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
	if (!host.skinOnly)
		pi.on("agent_settled", (_event, ctx) => {
			// Includes usage persisted by later agent_end handlers and pre-settlement drafts.
			usageTotals.invalidate();
			refreshInteractiveState(ctx);
			const settled = interactionMetrics.settle(ctx.isIdle());
			if (!settled) return;
			settleAgentTurn(settled.nextStartedAt);
			if (!host.skinOnly) workingLine.settle(settled.nextTokens, settled.nextThought, ctx);
			const config = currentConfig.components.workingLine;
			if (config.enabled && config.turnSummary) {
				try {
					const summary = {
						version: 3 as const,
						...settled.summary,
						stylePrefix: snapshotWorkingLineHighStyle(ctx.ui.theme, config, currentConfig.colors),
					};
					pi.appendEntry(TURN_SUMMARY_ENTRY_TYPE, summary);
				} catch {
					// A transcript persistence failure must not break settlement cleanup.
				}
			}
		});
	pi.on("tool_execution_start", (event, ctx) => {
		liveContext.clear();
		if (!host.skinOnly) workingLine.startTool(event.toolCallId, event.toolName, ctx);
		syncInteractiveState(event, ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (!host.skinOnly) workingLine.finishTool(event.toolCallId, ctx);
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
