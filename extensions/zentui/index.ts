import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	type ColorSourcesConfig,
	type ContextStyle,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	ensureConfigExists,
	type FixedEditorConfig,
	FOOTER_FORMAT_ALIASES,
	type FooterSegmentsConfig,
	type GitBranchConfig,
	type GitCommitConfig,
	type GitMetricsConfig,
	type IconMode,
	loadConfig,
	type ModelLabelSource,
	type PathDisplayConfig,
	type PolishedTuiConfig,
	type SeparatorStyle,
	saveColorSourcesPatch,
	saveContextStylePatch,
	saveEditorModelLabel,
	saveExtensionStatusColorMode,
	saveExtensionStatusDefaultPlacement,
	saveExtensionStatusPlacement,
	saveFixedEditorPatch,
	saveFooterFormatPatch,
	saveFooterSegmentsPatch,
	saveGitBranchPatch,
	saveGitCommitPatch,
	saveGitMetricsPatch,
	saveIconsModePatch,
	savePathDisplayPatch,
	saveResponsiveFooterPatch,
	saveSeparatorPatch,
	saveUiFeaturesPatch,
	type UiFeaturesConfig,
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
import { installSelectorBorderStyle } from "./selector-border";
import { SessionLifecycle } from "./session-lifecycle";
import { registerZentuiSettingsCommand } from "./settings-command";
import { createInitialState, type FooterState, syncState } from "./state";
import { PolishedEditor, WrappedPolishedEditor } from "./ui";
import { installUserMessageStyle } from "./user-message";

const ZENTUI_EDITOR_FACTORY = Symbol.for("pi-zentui.editor-factory");
const ZENTUI_EDITOR_BASE_FACTORY = Symbol.for("pi-zentui.editor-base-factory");

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

export function activeFooterReferences(config: PolishedTuiConfig): Set<string> {
	const references = config.footerFormat
		? collectFooterFormatReferences(parseFooterFormat(config.footerFormat), FOOTER_FORMAT_ALIASES)
		: new Set<string>([
				...(config.footerSegments.sessionName ? ["session_name"] : []),
				...(config.footerSegments.gitCommit ? ["git_commit"] : []),
				...(config.footerSegments.gitMetrics ? ["git_metrics"] : []),
				...(config.footerSegments.packageVersion ? ["package"] : []),
				...(config.footerSegments.sessionDuration ? ["session_duration"] : []),
				...(config.footerSegments.time ? ["time"] : []),
			]);
	if (config.responsiveFooter) {
		for (const name of collectFooterFormatReferences(
			parseFooterFormat(config.compactFooterFormat),
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

	let currentConfig: PolishedTuiConfig = loadConfig();
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () => new Map();
	let stopRefreshInterval: StopProjectRefreshInterval = () => {};
	let cleanupPrototypePatches: () => void = () => {};
	let footerInstalled = false;
	let editorInstalled = false;
	let editorInstallMode: EditorInstallMode = "none";
	let installedEditorFactory: EditorFactory | undefined;
	let wrappedEditorFactory: EditorFactory | undefined;
	let prototypePatchesInstalled = false;
	let stopSessionTimer: () => void = () => {};
	let sessionTimerRequirements = "";
	let lastDurationLabel = "";
	let lastProjectCwd: string | undefined;

	const refresh = () => {
		if (sessionLifecycle.isCurrent()) requestFooterRender?.();
	};
	const liveContext = new LiveContextController(sessionLifecycle, refresh);
	const getActiveTheme = () => activeTheme;
	const getCurrentConfig = () => currentConfig;
	const getThinkingLevel = () =>
		sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : ("off" as const);
	const syncFooterState = (ctx: ExtensionContext) =>
		syncState(state, ctx, currentConfig.icons.cacheHit, currentConfig.editorModelLabel);

	type ProjectRefreshTarget = { cwd: string; generation: number };
	const refreshProjectState = async ({ cwd, generation }: ProjectRefreshTarget) => {
		if (!sessionLifecycle.isCurrent(generation)) return;
		const gitCommitConfig = currentConfig.gitCommit;
		const gitMetricsConfig = currentConfig.gitMetrics;
		const references = activeFooterReferences(currentConfig);
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

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!sessionLifecycle.isCurrent() || !ctx.hasUI) return;
		syncFooterState(ctx);
		if (project && currentConfig.features.statusLine) scheduleProjectRefresh(ctx);
		refresh();
	};

	const stopProjectRefresh = () => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		projectRefreshScheduler.stop();
	};

	const reconcileSessionTimer = () => {
		const references = activeFooterReferences(currentConfig);
		const needsTime = references.has("time");
		const needsDuration = references.has("session_duration");
		const nextRequirements = needsTime || needsDuration ? `${needsTime}:${needsDuration}` : "";
		if (
			!sessionLifecycle.isCurrent() ||
			!footerInstalled ||
			!currentConfig.features.statusLine ||
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
		if (footerInstalled) scheduleProjectRefresh(ctx, { force: true });
	};

	const installPrototypePatches = (): boolean => {
		if (prototypePatchesInstalled) return true;
		let cleanupSelectorBorderStyle: (() => void) | undefined;
		try {
			cleanupSelectorBorderStyle = installSelectorBorderStyle(getActiveTheme, getCurrentConfig);
			const cleanupUserMessageStyle = installUserMessageStyle(getActiveTheme, getCurrentConfig);
			cleanupPrototypePatches = () => {
				cleanupSelectorBorderStyle?.();
				cleanupUserMessageStyle();
			};
			prototypePatchesInstalled = true;
			return true;
		} catch {
			try {
				cleanupSelectorBorderStyle?.();
			} catch {
				// Best effort: each installer is locally transactional as well.
			}
			cleanupPrototypePatches = () => {};
			prototypePatchesInstalled = false;
			return false;
		}
	};

	const uninstallPrototypePatches = () => {
		cleanupPrototypePatches();
		cleanupPrototypePatches = () => {};
		prototypePatchesInstalled = false;
	};

	const clearEditorOwnership = () => {
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
			uninstallPrototypePatches();
			clearEditorOwnership();
		}
		return observed;
	};

	const makeEditorFactory = (ctx: ExtensionContext): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new PolishedEditor(
				tui,
				theme,
				keybindings,
				sessionTheme,
				getCurrentConfig,
				() => ({
					modelLabel: state.modelLabel,
					modelId: state.modelId,
					modelName: state.modelName,
					providerLabel: state.providerLabel,
					sessionName: ctx.sessionManager.getSessionName() ?? "",
				}),
				getThinkingLevel,
			)) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		return factory;
	};

	const makeWrappedEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory,
	): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new WrappedPolishedEditor(
				baseFactory(tui, theme, keybindings),
				sessionTheme,
				getCurrentConfig,
				() => ({
					modelLabel: state.modelLabel,
					modelId: state.modelId,
					modelName: state.modelName,
					providerLabel: state.providerLabel,
					sessionName: ctx.sessionManager.getSessionName() ?? "",
				}),
				getThinkingLevel,
			)) as ZentuiEditorFactory;
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
		if (!installPrototypePatches()) {
			const rollback = replaceEditor(ctx, currentFactory);
			reconcileObservedEditorOwnership(ctx);
			return {
				ok: false,
				reason: rollback.ok
					? "editor chrome patch installation failed; the previous factory was reapplied, but editor instance identity is not guaranteed"
					: "editor chrome patch installation failed and the previous factory could not be restored; reload Pi before editing",
			};
		}

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
			uninstallPrototypePatches();
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

		uninstallPrototypePatches();
		clearEditorOwnership();
		return { ok: true };
	};

	const installStatusLine = (ctx: ExtensionContext) => {
		if (footerInstalled) return;
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
		stopProjectRefresh();
		stopRefreshInterval = startProjectRefreshInterval(currentConfig.projectRefreshIntervalMs, () =>
			scheduleProjectRefresh(ctx),
		);
		scheduleProjectRefresh(ctx, { force: true });
		refresh();
		reconcileSessionTimer();
	};

	const uninstallStatusLine = (ctx: ExtensionContext) => {
		stopSessionTimer();
		stopProjectRefresh();
		ctx.ui.setFooter(undefined);
		footerInstalled = false;
		requestFooterRender = undefined;
		getActiveExtensionStatuses = () => new Map();
	};

	const applyConfiguredUi = (ctx: ExtensionContext): ApplyUiResult => {
		const result: ApplyUiResult = { editorBlocked: false };
		if (!isTuiContext(ctx)) return result;
		activeTheme = ctx.ui.theme;
		let editorChange: EditorChangeResult | undefined;
		if (currentConfig.features.editor) {
			const currentFactory = ctx.ui.getEditorComponent();
			const editorMissingOrReplaced = !editorInstalled || !isZentuiEditorFactory(currentFactory);
			if (editorMissingOrReplaced) editorChange = installEditor(ctx);
		} else if (editorInstalled || prototypePatchesInstalled) {
			editorChange = uninstallEditor(ctx);
		}
		if (editorChange && !editorChange.ok) {
			result.editorBlocked = true;
			result.editorReason = editorChange.reason;
		}

		if (currentConfig.features.statusLine) {
			installStatusLine(ctx);
		} else if (footerInstalled) {
			uninstallStatusLine(ctx);
		}
		return result;
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		activeTheme = ctx.ui.theme;
		uninstallPrototypePatches();
		footerInstalled = false;
		editorInstalled = false;
		installedEditorFactory = undefined;
		ensureConfigExists();
		currentConfig = loadConfig();
		syncFooterState(ctx);
		stopProjectRefresh();
		applyConfiguredUi(ctx);
		if (currentConfig.fixedEditor?.enabled) {
			installFixedEditorProbe(ctx, getCurrentConfig, sessionLifecycle);
		}
		refresh();
	};

	const scheduleEditorReconciliation = (ctx: ExtensionContext) => {
		sessionLifecycle.defer(() => {
			if (!isTuiContext(ctx) || !currentConfig.features.editor) return;
			const observed = observeEditorFactory(ctx);
			if (!observed.known || observed.factory === installedEditorFactory) return;
			if (!observed.factory || !isZentuiEditorFactory(observed.factory)) {
				uninstallPrototypePatches();
				clearEditorOwnership();
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
		try {
			disposeFixedEditor(ctx);
			if (isTuiContext(ctx)) removeFixedEditorProbe(ctx);
			stopSessionTimer();
			stopProjectRefresh();
			requestFooterRender = undefined;
			getActiveExtensionStatuses = () => new Map();
			if (isTuiContext(ctx)) {
				ctx.ui.setFooter(undefined);
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
					reconcileObservedEditorOwnership(ctx);
				}
			}
			uninstallPrototypePatches();
			footerInstalled = false;
			activeTheme = undefined;
		} finally {
			requestFooterRender = undefined;
		}
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
		lastProjectCwd = undefined;
		installUi(ctx);
		scheduleEditorReconciliation(ctx);
	});

	registerZentuiSettingsCommand(pi, {
		sessionLifecycle,
		getConfig: getCurrentConfig,
		setColorSources(patch: Partial<ColorSourcesConfig>) {
			currentConfig = saveColorSourcesPatch(patch);
		},
		setUiFeatures(patch: Partial<UiFeaturesConfig>, ctx: ExtensionContext) {
			currentConfig = saveUiFeaturesPatch(patch);
			const result = applyConfiguredUi(ctx);
			return {
				applied: !(patch.editor !== undefined && result.editorBlocked),
				reason: result.editorBlocked ? result.editorReason : undefined,
			};
		},
		setFooterSegments(patch: Partial<FooterSegmentsConfig>, ctx: ExtensionContext) {
			applyFooterDependencyConfigChange(ctx, () => saveFooterSegmentsPatch(patch));
		},
		setFooterFormat(value: string, ctx: ExtensionContext) {
			applyFooterDependencyConfigChange(ctx, () => saveFooterFormatPatch(value));
		},
		setResponsiveFooter(
			patch: Partial<Pick<PolishedTuiConfig, "responsiveFooter" | "compactFooterMaxLines">>,
			ctx: ExtensionContext,
		) {
			applyFooterDependencyConfigChange(ctx, () => saveResponsiveFooterPatch(patch));
		},
		setIconMode(mode: IconMode) {
			currentConfig = saveIconsModePatch(mode);
		},
		setContextStyle(style: ContextStyle) {
			currentConfig = saveContextStylePatch(style);
		},
		setSeparator(separator: SeparatorStyle) {
			currentConfig = saveSeparatorPatch(separator);
		},
		setPathDisplay(patch: Partial<PathDisplayConfig>) {
			currentConfig = savePathDisplayPatch(patch);
		},
		setGitBranch(patch: Partial<GitBranchConfig>) {
			currentConfig = saveGitBranchPatch(patch);
		},
		setEditorModelLabel(value: ModelLabelSource, ctx: ExtensionContext) {
			currentConfig = saveEditorModelLabel(value);
			syncFooterState(ctx);
		},
		setGitCommit(
			patch: Partial<Pick<GitCommitConfig, "onlyDetached" | "showTag">>,
			ctx: ExtensionContext,
		) {
			currentConfig = saveGitCommitPatch(patch);
			if (patch.showTag !== undefined && footerInstalled) {
				scheduleProjectRefresh(ctx, { force: true });
			}
		},
		setGitMetrics(patch: Partial<GitMetricsConfig>, ctx: ExtensionContext) {
			currentConfig = saveGitMetricsPatch(patch);
			if (patch.ignoreSubmodules !== undefined && footerInstalled) {
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
			currentConfig = saveFixedEditorPatch(patch);
			if (patch.enabled === true) {
				installFixedEditorProbe(ctx, getCurrentConfig, sessionLifecycle);
			} else if (patch.enabled === false) {
				disposeFixedEditor(ctx);
			}
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
		syncInteractiveState(event, ctx);
	});
	pi.on("agent_end", (event, ctx) => {
		liveContext.clear();
		syncInteractiveAndProjectState(event, ctx);
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
