import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "./config";
import { formatCwdLabel, formatRuntimeSegment } from "./format";
import type { FooterState } from "./state";
import { colorize } from "./style";

export function installFooter(
	ctx: ExtensionContext,
	state: FooterState,
	config: PolishedTuiConfig,
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
		const separator = colorize(theme, config.colors.separator, " | ");

		return {
			dispose: () => {
				unsubscribeBranch();
				hooks.setRequestRender(undefined);
			},
			invalidate() {},
			render(width: number): string[] {
				if (width <= 0) return [""];
				const innerWidth = Math.max(1, width - 2);
				const cwdLabel = colorize(
					theme,
					config.colors.cwdText,
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
				const gitColor = (text: string) => colorize(theme, config.colors.git, text);
				const gitStatusColor = (text: string) => colorize(theme, config.colors.gitStatus, text);
				const gitIcon = gitColor(config.icons.git);
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
					? `${colorize(theme, "text", "on")} ${gitIcon} ${gitColor(branch)}${statusBlock ? ` ${statusBlock}` : ""}`
					: "";
				const runtimeLabel = formatRuntimeSegment(theme, state.runtime, "text");

				const left = [cwdLabel, branchLabel, runtimeLabel].filter(Boolean).join(" ");
				const right = [
					colorize(theme, contextColor, state.contextLabel),
					colorize(theme, config.colors.tokens, state.tokenLabel),
					colorize(theme, config.colors.cost, state.costLabel),
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
