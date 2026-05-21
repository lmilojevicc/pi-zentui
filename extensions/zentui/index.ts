import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { type PolishedTuiConfig, ensureConfigExists, loadConfig } from "./config";
import { installFooter } from "./footer";
import { emptyGitStatus, readGitStatus } from "./git";
import { type StopProjectRefreshInterval, startProjectRefreshInterval } from "./project-refresh";
import { readRuntimeInfo } from "./runtime";
import { type FooterState, createInitialState, syncState } from "./state";
import { PolishedEditor } from "./ui";
import { installUserMessageStyle } from "./user-message";

export default function (pi: ExtensionAPI) {
	const state: FooterState = createInitialState(emptyGitStatus());

	let currentConfig: PolishedTuiConfig = loadConfig();
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let stopRefreshInterval: StopProjectRefreshInterval = () => {};
	let projectRefreshInFlight = false;
	let projectRefreshPending = false;

	const refresh = () => requestFooterRender?.();
	const getActiveTheme = () => activeTheme;

	const refreshProjectState = async (ctx: ExtensionContext) => {
		const [gitStatus, runtime] = await Promise.all([
			readGitStatus(ctx.cwd),
			readRuntimeInfo(ctx.cwd),
		]);
		Object.assign(state, gitStatus);
		state.runtime = runtime;
	};

	const scheduleProjectRefresh = (ctx: ExtensionContext) => {
		if (projectRefreshInFlight) {
			projectRefreshPending = true;
			return;
		}

		projectRefreshInFlight = true;
		void refreshProjectState(ctx).finally(() => {
			projectRefreshInFlight = false;
			refresh();
			if (projectRefreshPending) {
				projectRefreshPending = false;
				scheduleProjectRefresh(ctx);
			}
		});
	};

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!ctx.hasUI) return;
		syncState(state, ctx);
		if (project) scheduleProjectRefresh(ctx);
		refresh();
	};

	const installEditor = (ctx: ExtensionContext) => {
		ctx.ui.setEditorComponent(
			(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
				new PolishedEditor(
					tui,
					theme,
					keybindings,
					ctx.ui.theme,
					() =>
						[
							ctx.ui.theme.fg("accent", state.modelLabel),
							ctx.ui.theme.fg("text", state.providerLabel),
						].join(ctx.ui.theme.fg("borderMuted", "  ")),
					() => pi.getThinkingLevel(),
				),
		);
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		activeTheme = ctx.ui.theme;
		installUserMessageStyle(getActiveTheme);
		ensureConfigExists();
		currentConfig = loadConfig();
		syncState(state, ctx);
		installFooter(ctx, state, currentConfig, {
			setRequestRender: (fn) => {
				requestFooterRender = fn;
			},
			scheduleProjectRefresh,
		});
		installEditor(ctx);
		stopRefreshInterval();
		stopRefreshInterval = startProjectRefreshInterval(currentConfig.projectRefreshIntervalMs, () =>
			scheduleProjectRefresh(ctx),
		);
		scheduleProjectRefresh(ctx);
		refresh();
	};

	const cleanupUi = (ctx?: ExtensionContext) => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		projectRefreshInFlight = false;
		projectRefreshPending = false;
		requestFooterRender = undefined;
		if (ctx?.hasUI) {
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
		}
		activeTheme = undefined;
	};

	pi.on("session_start", async (_event, ctx) => {
		installUi(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		cleanupUi(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		refreshInteractiveState(ctx, true);
	});

	pi.on("model_select", async (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("message_end", async (_event, ctx) => {
		refreshInteractiveState(ctx, true);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		refreshInteractiveState(ctx, true);
	});

	pi.on("session_compact", async (_event, ctx) => {
		refreshInteractiveState(ctx, true);
	});
}
