import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "./config";
import { formatCwdLabel, formatRuntimeSegment } from "./format";
import type { FooterState } from "./state";
import { renderStyleForSource } from "./style";

export function installFooter(
	ctx: ExtensionContext,
	state: FooterState,
	getConfig: () => PolishedTuiConfig,
	hooks: {
		setRequestRender: (fn: (() => void) | undefined) => void;
		scheduleProjectRefresh: (ctx: ExtensionContext) => void;
	},
): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		hooks.setRequestRender(() => tui.requestRender());
		const unsubscribeBranch = footerData.onBranchChange(() => {
			hooks.scheduleProjectRefresh(ctx);
			tui.requestRender();
		});

		return {
			dispose: () => {
				unsubscribeBranch();
				hooks.setRequestRender(undefined);
			},
			invalidate() {},
			render(width: number): string[] {
				if (width <= 0) return [""];
				const config = getConfig();
				const colorSource = config.colorSources.starship;
				const separator = renderStyleForSource(theme, colorSource, config.colors.separator, " | ");
				const innerWidth = Math.max(1, width - 2);
				const cwdLabel = renderStyleForSource(
					theme,
					colorSource,
					config.colors.cwd,
					formatCwdLabel(ctx.cwd, config.icons.cwd),
				);
				const branch = state.branch;
				const contextUsage = ctx.getContextUsage();
				const contextColor =
					contextUsage?.percent !== null && contextUsage?.percent !== undefined
						? contextUsage.percent >= 90
							? config.colors.contextError
							: contextUsage.percent >= 70
								? config.colors.contextWarning
								: config.colors.contextNormal
						: config.colors.contextNormal;
				const gitColor = (text: string) =>
					renderStyleForSource(theme, colorSource, config.colors.gitBranch, text);
				const gitStatusColor = (text: string) =>
					renderStyleForSource(theme, colorSource, config.colors.gitStatus, text);
				const gitIcon = config.icons.git ? gitColor(config.icons.git) : "";
				const allStatus = [
					state.conflicted > 0 ? config.icons.conflicted : "",
					state.stashed ? config.icons.stashed : "",
					state.deleted > 0 ? config.icons.deleted : "",
					state.renamed > 0 ? config.icons.renamed : "",
					state.modified > 0 ? config.icons.modified : "",
					state.typechanged > 0 ? config.icons.typechanged : "",
					state.staged > 0 ? config.icons.staged : "",
					state.untracked > 0 ? config.icons.untracked : "",
				].join("");
				const aheadBehind =
					state.ahead > 0 && state.behind > 0
						? config.icons.diverged
						: state.ahead > 0
							? config.icons.ahead
							: state.behind > 0
								? config.icons.behind
								: "";
				const statusBlock =
					allStatus || aheadBehind ? gitStatusColor(`[${allStatus}${aheadBehind}]`) : "";
				const branchLabel = branch
					? [...["on", gitIcon, gitColor(branch)].filter(Boolean), statusBlock]
							.filter(Boolean)
							.join(" ")
					: "";
				const runtimeLabel = formatRuntimeSegment(
					theme,
					state.runtime,
					config.colors.runtimePrefix,
					colorSource,
				);
				const extensionStatuses = Array.from(footerData.getExtensionStatuses().entries())
					.map(([, text]) => renderStyleForSource(theme, colorSource, config.colors.contextNormal, text))
					.filter(Boolean);

				const left = [cwdLabel, branchLabel, runtimeLabel].filter(Boolean).join(" ");
				const right = [
					...extensionStatuses,
					renderStyleForSource(theme, colorSource, contextColor, state.contextLabel),
					renderStyleForSource(theme, colorSource, config.colors.tokens, state.tokenLabel),
					renderStyleForSource(theme, colorSource, config.colors.cost, state.costLabel),
				].join(separator);

				const leftWidth = visibleWidth(left);
				const rightWidth = visibleWidth(right);
				const content =
					leftWidth >= innerWidth
						? truncateToWidth(left, innerWidth, "")
						: leftWidth + 1 + rightWidth <= innerWidth
							? `${left}${" ".repeat(innerWidth - leftWidth - rightWidth)}${right}`
							: truncateToWidth(left, innerWidth, "");
				const framed = width > 2 ? ` ${truncateToWidth(content, width - 2, "")} ` : content;
				return [truncateToWidth(framed, width, "")];
			},
		};
	});
}
