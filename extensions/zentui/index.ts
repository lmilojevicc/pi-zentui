import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	type ContextStyle,
	type EditorComponentConfig,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	ensureConfigExists,
	type FixedEditorConfig,
	FOOTER_FORMAT_ALIASES,
	type FooterComponentConfig,
	type FooterSegmentsConfig,
	type GitBranchConfig,
	type GitCommitConfig,
	type GitMetricsConfig,
	type IconMode,
	loadConfig,
	type MinimalistConfig,
	type PathDisplayConfig,
	type PolishedTuiConfig,
	type SelectorBordersComponentConfig,
	type SeparatorStyle,
	saveEditorComponentPatch,
	saveExtensionStatusColorMode,
	saveExtensionStatusDefaultPlacement,
	saveExtensionStatusPlacement,
	saveFooterComponentPatch,
	saveIconsModePatch,
	saveLayoutFixedEditorPatch,
	saveMinimalistEditorStylePatch,
	saveSelectorBordersComponentPatch,
	saveStarshipFooterStylePatch,
	saveUserMessagesComponentPatch,
	type UserMessagesComponentConfig,
	type ZentuiConfig,
} from "./config";
import {
	type EditorTransferFailureReason,
	replaceEditorComponentWithExpandedText,
} from "./editor-transfer";
import {
	disposeFixedEditor,
	installFixedEditorProbe,
	removeFixedEditorProbe,
} from "./fixed-editor";
import { installFooter } from "./footer";
import { collectFooterFormatReferences, parseFooterFormat } from "./footer-format";
import { buildSessionDurationLabel, invalidateUsageTotalsCache } from "./format";
import { emptyGitStatus, readGitStatus } from "./git";
import { LiveContextController } from "./live-context";
import { readPackageVersionResult } from "./package-version";
import {
	createProjectRefreshScheduler,
	type ScheduleProjectRefreshOptions,
	type StopProjectRefreshInterval,
	startProjectRefreshInterval,
} from "./project-refresh";
import { applyProjectRefreshToState } from "./project-state";
import { readRuntimeInfo } from "./runtime";
import { installSelectorBorderStyle, removeSelectorBorderStyle } from "./selector-border";
import { SessionLifecycle } from "./session-lifecycle";
import { registerZentuiSettingsCommand } from "./settings-command";
import { createInitialState, type FooterState, modelLabelFor, syncState } from "./state";
import { resolveFooterTelemetry } from "./telemetry";
import { PolishedEditor, WrappedPolishedEditor } from "./ui";
import { installUserMessageStyle, removeUserMessageStyle } from "./user-message";

const ZENTUI_EDITOR_FACTORY = Symbol.for("pi-zentui.editor-factory");
const ZENTUI_EDITOR_BASE_FACTORY = Symbol.for("pi-zentui.editor-base-factory");
const ZENTUI_FOOTER_OWNER = Symbol.for("pi-zentui.footer-owner");

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

type ZentuiEditorFactory = EditorFactory & {
	[ZENTUI_EDITOR_FACTORY]?: true;
	[ZENTUI_EDITOR_BASE_FACTORY]?: EditorFactory;
};

type ApplyUiResult = {
	editorBlocked: boolean;
	editorReason?: string;
};

type EditorChangeResult = { ok: true } | { ok: false; reason: string };

type EditorInstallMode = "none" | "standalone" | "wrapper";

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

function findRepositoryRoot(cwd: string): string | undefined {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
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

	let currentConfig: PolishedTuiConfig = loadConfig();
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let requestEditorRender: (() => void) | undefined;
	let getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () => new Map();
	let stopRefreshInterval: StopProjectRefreshInterval = () => {};
	let cleanupUserMessageStyle: () => void = () => {};
	let userMessageStyleInstalled = false;
	let cleanupSelectorBorderStyle: () => void = () => {};
	let selectorBorderStyleInstalled = false;
	let footerInstalled = false;
	let footerReconciled = false;
	let editorInstalled = false;
	let editorInstallMode: EditorInstallMode = "none";
	let installedEditorFactory: EditorFactory | undefined;
	let wrappedEditorFactory: EditorFactory | undefined;
	let stopSessionTimer: () => void = () => {};
	let stopAgentTimer: () => void = () => {};
	let agentTimerRunning = false;
	let minimalistDecorationActive = false;
	let sessionTimerRequirements = "";
	let lastDurationLabel = "";
	let lastProjectCwd: string | undefined;
	let agentStartedAt: number | undefined;
	let agentDurationMs: number | undefined;
	let minimalistProjectRoot: string | undefined;
	let projectRefreshActive = false;
	let fixedLayoutEnabled = false;
	let activeTuiContext: ExtensionContext | undefined;

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
			return activeTuiContext.ui.getEditorComponent() === installedEditorFactory;
		} catch {
			return false;
		}
	};

	const refresh = () => {
		if (!sessionLifecycle.isCurrent()) return;
		requestFooterRender?.();
		requestEditorRender?.();
	};
	const liveContext = new LiveContextController(sessionLifecycle, refresh);
	const getActiveTheme = () => activeTheme;
	const getCurrentConfig = () => currentConfig;
	const getContextWindow = (ctx: ExtensionContext): number | undefined =>
		ctx.model?.contextWindow ?? ctx.getContextUsage()?.contextWindow;
	const getContextPercent = (ctx: ExtensionContext): number | undefined => {
		const usage = ctx.getContextUsage();
		const contextWindow = getContextWindow(ctx);
		const live = liveContext.get();
		return live && contextWindow && contextWindow > 0
			? (live.tokens / contextWindow) * 100
			: (usage?.percent ?? undefined);
	};
	const getAgentDurationMs = () =>
		agentStartedAt === undefined ? agentDurationMs : Math.max(0, Date.now() - agentStartedAt);
	const getThinkingLevel = () =>
		sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : ("off" as const);
	const syncFooterState = (ctx: ExtensionContext) =>
		syncState(state, ctx, currentConfig.icons.cacheHit, resolveFooterTelemetry(ctx));
	const installedFooterReferences = () =>
		footerInstalled && currentConfig.components.footer.enabled
			? activeFooterReferences(currentConfig)
			: new Set<string>();

	type ProjectRefreshTarget = { cwd: string; generation: number };
	const refreshProjectState = async ({ cwd, generation }: ProjectRefreshTarget) => {
		if (!sessionLifecycle.isCurrent(generation)) return;
		const starship = currentConfig.components.footer.styles.starship;
		const gitCommitConfig = starship.gitCommit;
		const gitMetricsConfig = starship.gitMetrics;
		const references = installedFooterReferences();
		const wantExactTag =
			(references.has("git_commit") && gitCommitConfig.showTag) || references.has("git_tag");
		const wantMetrics =
			references.has("git_metrics") || references.has("git_added") || references.has("git_deleted");
		const wantPackage = references.has("package") || references.has("package_version");
		const [git, runtime, packageVersion] = await Promise.all([
			readGitStatus(cwd, {
				readExactTag: wantExactTag,
				readMetrics: wantMetrics,
				ignoreSubmodules: gitMetricsConfig.ignoreSubmodules,
			}),
			readRuntimeInfo(cwd),
			wantPackage ? readPackageVersionResult(cwd) : Promise.resolve(undefined),
		]);
		if (!sessionLifecycle.isCurrent(generation)) return;
		minimalistProjectRoot = git.kind === "ok" ? findRepositoryRoot(cwd) : undefined;
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
		const generation = sessionLifecycle.currentGeneration();
		if (!sessionLifecycle.isCurrent(generation)) return;
		const cwd = ctx.cwd;
		projectRefreshScheduler.schedule({ cwd, generation }, options);
	};

	const minimalistProjectRequired = () => {
		const editor = currentConfig.components.editor;
		const minimalist = editor.styles.minimalist;
		return (
			ownsInstalledEditorFactory() &&
			editor.style === "minimalist" &&
			(minimalist.showGit || minimalist.pathDisplay === "project")
		);
	};

	const needsProjectRefresh = () => footerInstalled || minimalistProjectRequired();

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
			!footerInstalled ||
			!currentConfig.components.footer.enabled ||
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
			agentStartedAt !== undefined &&
			minimalistDecorationActive &&
			ownsInstalledEditorFactory() &&
			currentConfig.components.editor.style === "minimalist" &&
			currentConfig.components.editor.styles.minimalist.showTimer;
		if (!needed) {
			stopAgentTimer();
			return;
		}
		if (agentTimerRunning) return;
		const timer = setInterval(() => {
			const ctx = activeTuiContext;
			if (ctx && editorInstalled && !ownsInstalledEditorFactory()) {
				reconcileObservedEditorOwnership(ctx);
			}
			reconcileAgentTimer();
			if (agentTimerRunning) refresh();
		}, 1000);
		agentTimerRunning = true;
		stopAgentTimer = () => {
			clearInterval(timer);
			agentTimerRunning = false;
			stopAgentTimer = () => {};
		};
	};

	const setMinimalistDecorationActive = (active: boolean) => {
		const next = sessionLifecycle.isCurrent() && active && ownsInstalledEditorFactory();
		if (minimalistDecorationActive === next) return;
		minimalistDecorationActive = next;
		reconcileAgentTimer();
	};

	const startAgentTurn = () => {
		stopAgentTimer();
		agentStartedAt = Date.now();
		agentDurationMs = 0;
		reconcileAgentTimer();
		refresh();
	};

	const finishAgentTurn = () => {
		if (agentStartedAt !== undefined) {
			agentDurationMs = Math.max(0, Date.now() - agentStartedAt);
		}
		agentStartedAt = undefined;
		reconcileAgentTimer();
		refresh();
	};

	const resetAgentTimer = () => {
		stopAgentTimer();
		agentTimerRunning = false;
		agentStartedAt = undefined;
		agentDurationMs = undefined;
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
		if (needsProjectRefresh()) scheduleProjectRefresh(ctx, { force: true });
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
			try {
				removeUserMessageStyle();
			} catch {
				// Best effort cleanup of a stale registration from an earlier reload.
			}
			cleanupUserMessageStyle = () => {};
			userMessageStyleInstalled = false;
		}
	};

	const reconcileUserMessages = () => {
		const messages = currentConfig.components.userMessages;
		if (messages.enabled) installUserMessages();
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
			try {
				removeSelectorBorderStyle();
			} catch {
				// Best effort cleanup of stale registrations from an earlier reload.
			}
			cleanupSelectorBorderStyle = () => {};
			selectorBorderStyleInstalled = false;
		}
	};

	const reconcileSelectorBorders = () => {
		const selectors = currentConfig.components.selectorBorders;
		if (selectors.enabled && selectors.style === "zentui") installSelectorBorders();
		else uninstallSelectorBorders();
	};

	const clearEditorOwnership = () => {
		setMinimalistDecorationActive(false);
		requestEditorRender = undefined;
		wrappedEditorFactory = undefined;
		installedEditorFactory = undefined;
		editorInstallMode = "none";
		editorInstalled = false;
	};

	const trackZentuiEditorFactory = (factory: EditorFactory) => {
		const baseFactory = getZentuiEditorBaseFactory(factory);
		wrappedEditorFactory = baseFactory;
		installedEditorFactory = factory;
		editorInstallMode = baseFactory ? "wrapper" : "standalone";
		editorInstalled = true;
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
		if (observed.factory && isZentuiEditorFactory(observed.factory)) {
			trackZentuiEditorFactory(observed.factory);
		} else {
			clearEditorOwnership();
			reconcileProjectRefresh(ctx);
		}
		return observed;
	};

	const makeEditorFactory = (ctx: ExtensionContext): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
			requestEditorRender = () => tui.requestRender();
			return new PolishedEditor(
				tui,
				theme,
				keybindings,
				sessionTheme,
				getCurrentConfig,
				() => ({
					modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
					modelId: state.modelId,
					modelName: state.modelName,
					providerLabel: state.providerLabel,
					sessionName: ctx.sessionManager.getSessionName() ?? "",
				}),
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
					agentActive: agentStartedAt !== undefined,
				}),
				setMinimalistDecorationActive,
			);
		}) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		return factory;
	};

	const makeWrappedEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory,
	): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
			requestEditorRender = () => tui.requestRender();
			return new WrappedPolishedEditor(
				baseFactory(tui, theme, keybindings),
				sessionTheme,
				getCurrentConfig,
				() => ({
					modelLabel: modelLabelFor(state, currentConfig.components.editor.modelLabel),
					modelId: state.modelId,
					modelName: state.modelName,
					providerLabel: state.providerLabel,
					sessionName: ctx.sessionManager.getSessionName() ?? "",
				}),
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
					agentActive: agentStartedAt !== undefined,
				}),
				setMinimalistDecorationActive,
			);
		}) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
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

	const uninstallEditor = (ctx: ExtensionContext): EditorChangeResult => {
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

	const ownsStatusLine = (ctx: ExtensionContext) =>
		Boolean((ctx.ui as unknown as Record<PropertyKey, unknown>)[ZENTUI_FOOTER_OWNER]);

	const setStatusLineOwnership = (ctx: ExtensionContext, owned: boolean) => {
		const ui = ctx.ui as unknown as Record<PropertyKey, unknown>;
		try {
			if (owned) ui[ZENTUI_FOOTER_OWNER] = true;
			else delete ui[ZENTUI_FOOTER_OWNER];
		} catch {
			// Local bookkeeping still preserves ordinary-session cleanup.
		}
	};

	const installStatusLine = (ctx: ExtensionContext) => {
		if (footerInstalled) return;
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
			});
			footerInstalled = true;
			setStatusLineOwnership(ctx, true);
			refresh();
			reconcileSessionTimer();
		} catch {
			try {
				ctx.ui.setFooter(undefined);
			} catch {
				// Best effort: Pi remains responsible for its native footer fallback.
			}
			footerInstalled = false;
			setStatusLineOwnership(ctx, false);
			requestFooterRender = undefined;
			getActiveExtensionStatuses = () => new Map();
			stopSessionTimer();
		}
	};

	const uninstallStatusLine = (ctx: ExtensionContext) => {
		stopSessionTimer();
		if (footerInstalled || ownsStatusLine(ctx)) {
			try {
				ctx.ui.setFooter(undefined);
			} catch {
				// Best effort cleanup must not prevent other surfaces from reconciling.
			}
		}
		footerInstalled = false;
		setStatusLineOwnership(ctx, false);
		requestFooterRender = undefined;
		getActiveExtensionStatuses = () => new Map();
	};

	const reconcileFooter = (ctx: ExtensionContext) => {
		const footer = currentConfig.components.footer;
		if (footer.enabled && footer.style === "starship") installStatusLine(ctx);
		else if (footerInstalled || !footerReconciled) uninstallStatusLine(ctx);
		footerReconciled = true;
	};

	const cleanupFixedLayout = (ctx: ExtensionContext) => {
		try {
			disposeFixedEditor(ctx);
		} catch {
			// Best effort ordinary-layout fallback.
		}
		try {
			removeFixedEditorProbe(ctx);
		} catch {
			// Probe cleanup is independent from compositor disposal.
		}
		fixedLayoutEnabled = false;
	};

	const reconcileFixedLayout = (ctx: ExtensionContext) => {
		const enabled = currentConfig.layout.fixedEditor.enabled;
		if (enabled === fixedLayoutEnabled) return;
		if (!enabled) {
			cleanupFixedLayout(ctx);
			return;
		}
		try {
			installFixedEditorProbe(ctx, getCurrentConfig, sessionLifecycle);
			fixedLayoutEnabled = true;
		} catch {
			cleanupFixedLayout(ctx);
		}
	};

	const reconcileEditor = (ctx: ExtensionContext): EditorChangeResult | undefined => {
		try {
			if (currentConfig.components.editor.enabled) {
				const currentFactory = ctx.ui.getEditorComponent();
				const editorMissingOrReplaced = !editorInstalled || !isZentuiEditorFactory(currentFactory);
				if (editorMissingOrReplaced) return installEditor(ctx);
			} else {
				const currentFactory = ctx.ui.getEditorComponent();
				if (editorInstalled || isZentuiEditorFactory(currentFactory)) return uninstallEditor(ctx);
			}
		} catch {
			return {
				ok: false,
				reason: "the editor could not be reconciled safely; reload Pi to apply this change",
			};
		}
	};

	const applyConfiguredUi = (ctx: ExtensionContext): ApplyUiResult => {
		const result: ApplyUiResult = { editorBlocked: false };
		if (!isTuiContext(ctx)) return result;
		activeTheme = ctx.ui.theme;

		const editorChange = reconcileEditor(ctx);
		if (editorChange && !editorChange.ok) {
			result.editorBlocked = true;
			result.editorReason = editorChange.reason;
		}
		reconcileUserMessages();
		reconcileSelectorBorders();
		reconcileFooter(ctx);
		reconcileFixedLayout(ctx);
		reconcileProjectRefresh(ctx);
		reconcileSessionTimer();
		reconcileAgentTimer();
		return result;
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		activeTuiContext = ctx;
		activeTheme = ctx.ui.theme;
		ensureConfigExists();
		currentConfig = loadConfig();
		syncFooterState(ctx);
		stopProjectRefresh();

		cleanupFixedLayout(ctx);
		uninstallUserMessages();
		uninstallSelectorBorders();
		uninstallStatusLine(ctx);
		if (currentConfig.components.editor.enabled) clearEditorOwnership();
		else {
			try {
				uninstallEditor(ctx);
			} catch {
				// Reconciliation below retries observable stale ownership.
			}
		}

		footerReconciled = false;
		applyConfiguredUi(ctx);
		refresh();
	};

	const scheduleEditorReconciliation = (ctx: ExtensionContext) => {
		sessionLifecycle.defer(() => {
			if (!isTuiContext(ctx) || !currentConfig.components.editor.enabled) return;
			const observed = observeEditorFactory(ctx);
			if (!observed.known || observed.factory === installedEditorFactory) return;
			if (!observed.factory || !isZentuiEditorFactory(observed.factory)) {
				clearEditorOwnership();
				reconcileProjectRefresh(ctx);
				refresh();
				return;
			}
			trackZentuiEditorFactory(observed.factory);
			refresh();
		});
	};

	const cleanupUi = (ctx?: ExtensionContext) => {
		if (!ctx || !sessionLifecycle.isCurrent()) return;
		sessionLifecycle.shutdown();
		stopSessionTimer();
		resetAgentTimer();
		stopProjectRefresh();

		if (isTuiContext(ctx)) cleanupFixedLayout(ctx);
		else {
			try {
				disposeFixedEditor(ctx);
			} catch {
				// Continue cleaning independent surfaces.
			} finally {
				fixedLayoutEnabled = false;
			}
		}

		let retainedEditorOwnership = false;
		if (isTuiContext(ctx)) {
			uninstallStatusLine(ctx);
			try {
				const before = observeEditorFactory(ctx);
				if (before.known) {
					const currentFactory = before.factory;
					if (currentFactory && isZentuiEditorFactory(currentFactory)) {
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
				if (after.known && after.factory && isZentuiEditorFactory(after.factory)) {
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
		footerInstalled = false;
		footerReconciled = false;
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
		sessionLifecycle.start();
		liveContext.clear();
		state.sessionStartEpoch = Date.now();
		invalidateUsageTotalsCache();
		resetAgentTimer();
		lastProjectCwd = undefined;
		minimalistProjectRoot = undefined;
		installUi(ctx);
		scheduleEditorReconciliation(ctx);
	});

	registerZentuiSettingsCommand(pi, {
		sessionLifecycle,
		getConfig: getCurrentConfig,
		setEditorComponent(patch: Partial<EditorComponentConfig>, ctx: ExtensionContext) {
			currentConfig = saveEditorComponentPatch(patch);
			let result: EditorChangeResult | undefined;
			if (patch.enabled !== undefined && isTuiContext(ctx)) result = reconcileEditor(ctx);
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
		setMinimalist(patch: Partial<MinimalistConfig>, ctx: ExtensionContext) {
			currentConfig = saveMinimalistEditorStylePatch(patch);
			reconcileAgentTimer();
			reconcileProjectRefresh(ctx);
			if (needsProjectRefresh() && (patch.pathDisplay === "project" || patch.showGit === true)) {
				scheduleProjectRefresh(ctx, { force: true });
			}
			refresh();
		},
		setUserMessagesComponent(patch: Partial<UserMessagesComponentConfig>, _ctx: ExtensionContext) {
			currentConfig = saveUserMessagesComponentPatch(patch);
			if (patch.enabled !== undefined) reconcileUserMessages();
			refresh();
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
			currentConfig = saveFooterComponentPatch(patch);
			if (patch.enabled !== undefined || patch.style !== undefined) reconcileFooter(ctx);
			if (patch.modelLabel !== undefined) syncFooterState(ctx);
			reconcileProjectRefresh(ctx);
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
			if (patch.showTag !== undefined && needsProjectRefresh()) {
				scheduleProjectRefresh(ctx, { force: true });
			}
		},
		setGitMetrics(patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) {
			currentConfig = saveStarshipFooterStylePatch({ gitMetrics: patch as GitMetricsConfig });
			if (patch.ignoreSubmodules !== undefined && needsProjectRefresh()) {
				scheduleProjectRefresh(ctx, { force: true });
			}
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
		setFixedEditor(patch: Partial<FixedEditorConfig>, ctx: ExtensionContext) {
			currentConfig = saveLayoutFixedEditorPatch(patch);
			reconcileFixedLayout(ctx);
			refresh();
		},
		requestRender() {
			refresh();
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		liveContext.clear();
		cleanupUi(ctx);
	});

	const syncInteractiveAndProjectStateWithUsage = (_event: unknown, ctx: ExtensionContext) => {
		invalidateUsageTotalsCache();
		refreshInteractiveState(ctx, true);
	};

	pi.on("agent_start", (event, ctx) => {
		liveContext.clear();
		startAgentTurn();
		syncInteractiveState(event, ctx);
	});
	pi.on("agent_end", (event, ctx) => {
		liveContext.clear();
		finishAgentTurn();
		// Reconcile once more after Pi has persisted the assistant message.
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
	pi.on("model_select", (event, ctx) => {
		liveContext.clear();
		syncInteractiveState(event, ctx);
	});
	pi.on("thinking_level_select", syncInteractiveState);
	pi.on("session_info_changed", syncInteractiveState);
	pi.on("message_update", (event) => {
		liveContext.update(event.message);
	});
	pi.on("message_end", (event, ctx) => {
		// Pi notifies extensions before persisting a successful message, so retain its live
		// context until agent_end; failed messages clear immediately instead of showing stale usage.
		if (
			event.message.role === "assistant" &&
			(event.message.stopReason === "error" || event.message.stopReason === "aborted")
		) {
			liveContext.clear();
		}
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
	pi.on("tool_execution_start", (event, ctx) => {
		liveContext.clear();
		syncInteractiveState(event, ctx);
	});
	pi.on("tool_execution_end", syncInteractiveAndProjectState);
	pi.on("session_compact", (event, ctx) => {
		liveContext.clear();
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
	pi.on("session_tree", (event, ctx) => {
		liveContext.clear();
		syncInteractiveAndProjectStateWithUsage(event, ctx);
	});
}
