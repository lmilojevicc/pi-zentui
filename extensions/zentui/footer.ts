import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SeparatorStyle, ZentuiConfig } from "./config";
import { FOOTER_FORMAT_ALIASES } from "./config";
import { sanitizeEditorMetadataText } from "./editor-metadata-format";
import {
	collectExtensionStatusSegments,
	type ExtensionStatusSegment,
	sanitizeExtensionStatusText,
} from "./extension-status";
import {
	collectFooterFormatReferences,
	compileCompactFormat,
	parseFooterFormat,
	renderFormatSplit,
	renderFormatTokens,
	stripOrphanSeparators,
} from "./footer-format";
import {
	compactChunkBudget,
	fullFooterFitsAligned,
	packCompactChunks,
	reflowFullFooter,
} from "./footer-layout";
import {
	buildContextDisplayLabel,
	buildSessionDurationLabel,
	contextColorTier,
	formatCwdLabel,
	formatGitBranchText,
	formatGitCommitSegment,
	formatGitMetricsSegment,
	formatOsLabel,
	formatPackageVersionSegment,
	formatRuntimeSegment,
	formatTimeLabel,
	formatUsernameHostLabel,
	resolveContextUsage,
} from "./format";
import { resolveRuntimeSymbol } from "./icons";
import type { LiveContextOverride } from "./live-context";
import { type FooterState, modelLabelFor } from "./state";
import { renderStyleForSource } from "./style";

const separatorText: Record<SeparatorStyle, string> = {
	pipe: " | ",
	dot: " · ",
	chevron: " › ",
	none: " ",
};

function joinStatusTexts(statusTexts: string[], separator: string): string {
	return statusTexts.filter(Boolean).join(separator);
}

function normalizeModelInfoPart(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function composeModelInfoLabel(model: string, provider: string): string {
	const normalizedModel = normalizeModelInfoPart(model);
	const normalizedProvider = normalizeModelInfoPart(provider);
	const providerIsDuplicated =
		normalizedProvider.length > 0 && normalizedModel.includes(normalizedProvider);
	return [model, providerIsDuplicated ? "" : provider].filter(Boolean).join(" ");
}

function fitStatusTexts(statusTexts: string[], maxWidth: number, separator: string): string {
	if (maxWidth <= 0) return "";

	const fitted: string[] = [];
	for (const text of statusTexts) {
		const candidate = joinStatusTexts([...fitted, text], separator);
		if (visibleWidth(candidate) <= maxWidth) {
			fitted.push(text);
			continue;
		}

		if (fitted.length === 0) {
			return maxWidth > 1 ? truncateToWidth(text, maxWidth, "…") : "";
		}
		break;
	}

	return joinStatusTexts(fitted, separator);
}

function appendStatusArea(base: string, statusText: string, separator: string): string {
	if (!base) return statusText;
	if (!statusText) return base;
	return `${base}${separator}${statusText}`;
}

function prependStatusArea(base: string, statusText: string, separator: string): string {
	if (!base) return statusText;
	if (!statusText) return base;
	return `${statusText}${separator}${base}`;
}

function composeBuiltInFooterContent(left: string, right: string, innerWidth: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	return leftWidth >= innerWidth
		? truncateToWidth(left, innerWidth, "")
		: leftWidth + 1 + rightWidth <= innerWidth
			? `${left}${" ".repeat(innerWidth - leftWidth - rightWidth)}${right}`
			: truncateToWidth(left, innerWidth, "");
}

function composeFooterContent(
	builtInLeft: string,
	builtInRight: string,
	extensionLeft: string[],
	extensionMiddle: string[],
	extensionRight: string[],
	separator: string,
	innerWidth: number,
): string {
	const builtInLeftWidth = visibleWidth(builtInLeft);
	const builtInRightWidth = visibleWidth(builtInRight);
	const minimumGap = builtInLeft && builtInRight ? 1 : 0;

	if (builtInLeftWidth + minimumGap + builtInRightWidth > innerWidth) {
		return composeBuiltInFooterContent(builtInLeft, builtInRight, innerWidth);
	}

	const available = Math.max(0, innerWidth - builtInLeftWidth - builtInRightWidth - minimumGap);
	let remaining = available;
	const leftConnectorWidth = builtInLeft && extensionLeft.length > 0 ? visibleWidth(separator) : 0;
	const rightConnectorWidth =
		builtInRight && extensionRight.length > 0 ? visibleWidth(separator) : 0;
	let leftStatus = "";
	let rightStatus = "";

	if (extensionLeft.length > 0 && extensionRight.length > 0) {
		const leftBudget = Math.max(0, Math.floor(available / 2) - leftConnectorWidth);
		leftStatus = fitStatusTexts(extensionLeft, leftBudget, separator);
		remaining -= leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;

		const rightBudget = Math.max(0, remaining - rightConnectorWidth);
		rightStatus = fitStatusTexts(extensionRight, rightBudget, separator);
		remaining -= rightStatus ? rightConnectorWidth + visibleWidth(rightStatus) : 0;

		const expandedLeftBudget = Math.max(0, remaining + visibleWidth(leftStatus));
		const expandedLeftStatus = fitStatusTexts(extensionLeft, expandedLeftBudget, separator);
		if (visibleWidth(expandedLeftStatus) > visibleWidth(leftStatus)) {
			remaining += leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;
			leftStatus = expandedLeftStatus;
			remaining -= leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;
		}
	} else if (extensionLeft.length > 0) {
		leftStatus = fitStatusTexts(
			extensionLeft,
			Math.max(0, available - leftConnectorWidth),
			separator,
		);
		remaining -= leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;
	} else if (extensionRight.length > 0) {
		rightStatus = fitStatusTexts(
			extensionRight,
			Math.max(0, available - rightConnectorWidth),
			separator,
		);
		remaining -= rightStatus ? rightConnectorWidth + visibleWidth(rightStatus) : 0;
	}

	const left = appendStatusArea(builtInLeft, leftStatus, separator);
	const right = prependStatusArea(builtInRight, rightStatus, separator);
	const gapWidth = Math.max(0, innerWidth - visibleWidth(left) - visibleWidth(right));
	const middle = fitStatusTexts(extensionMiddle, gapWidth, separator);
	const middleWidth = visibleWidth(middle);

	if (!middle || middleWidth <= 0) {
		return `${left}${" ".repeat(gapWidth)}${right}`;
	}

	const leftPadding = Math.floor((gapWidth - middleWidth) / 2);
	const rightPadding = gapWidth - middleWidth - leftPadding;
	return `${left}${" ".repeat(leftPadding)}${middle}${" ".repeat(rightPadding)}${right}`;
}

export function installFooter(
	ctx: ExtensionContext,
	state: FooterState,
	getConfig: () => ZentuiConfig,
	hooks: {
		setRequestRender: (fn: (() => void) | undefined) => void;
		scheduleProjectRefresh: (ctx: ExtensionContext) => void;
		setExtensionStatusesGetter?: (fn: (() => ReadonlyMap<string, string>) | undefined) => void;
		getLiveContext?: () => LiveContextOverride | undefined;
		getRepositoryRoot?: (cwd: string) => string | undefined;
		onDispose?: () => void;
	},
): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		hooks.setRequestRender(() => tui.requestRender());
		hooks.setExtensionStatusesGetter?.(() => footerData.getExtensionStatuses());
		const unsubscribeBranch = footerData.onBranchChange(() => {
			hooks.scheduleProjectRefresh(ctx);
			tui.requestRender();
		});

		return {
			dispose: () => {
				unsubscribeBranch();
				hooks.setRequestRender(undefined);
				hooks.setExtensionStatusesGetter?.(undefined);
				hooks.onDispose?.();
			},
			invalidate() {},
			render(width: number): string[] {
				if (width <= 0) return [""];
				const config = getConfig();
				const footer = config.components.footer;
				const footerModelLabel = modelLabelFor(state, footer.modelLabel);
				const wideFormatTokens = config.components.footer.styles.starship.format
					? parseFooterFormat(config.components.footer.styles.starship.format)
					: [];
				const compactFormatTokens = config.components.footer.styles.starship.responsive
					? parseFooterFormat(config.components.footer.styles.starship.compactFormat)
					: [];
				const wideReferences = collectFooterFormatReferences(
					wideFormatTokens,
					FOOTER_FORMAT_ALIASES,
				);
				const compactReferences = collectFooterFormatReferences(
					compactFormatTokens,
					FOOTER_FORMAT_ALIASES,
				);
				const colorSource = config.components.footer.colorSource;
				const iconMode = config.icons.mode;
				const pathDisplay = config.components.footer.styles.starship.pathDisplay;
				const formattedCwd = sanitizeEditorMetadataText(
					formatCwdLabel(ctx.cwd, config.icons.cwd, {
						mode: pathDisplay.mode,
						depth: pathDisplay.depth,
						repositoryRoot:
							pathDisplay.mode === "repository" ? hooks.getRepositoryRoot?.(ctx.cwd) : undefined,
					}),
				);
				const branch = sanitizeEditorMetadataText(state.branch ?? "") || undefined;
				const gitStateLabel = sanitizeEditorMetadataText(state.gitStateLabel ?? "");
				const commit = state.commit
					? {
							...state.commit,
							oid: state.commit.oid ? sanitizeEditorMetadataText(state.commit.oid) || null : null,
							tag: state.commit.tag ? sanitizeEditorMetadataText(state.commit.tag) || null : null,
						}
					: undefined;
				const runtime = state.runtime
					? {
							...state.runtime,
							name: sanitizeEditorMetadataText(state.runtime.name),
							symbol: sanitizeEditorMetadataText(state.runtime.symbol),
							version: sanitizeEditorMetadataText(state.runtime.version ?? ""),
						}
					: undefined;
				const packageVersion = state.packageVersion
					? {
							...state.packageVersion,
							version: sanitizeEditorMetadataText(state.packageVersion.version),
						}
					: undefined;
				const separator = renderStyleForSource(
					theme,
					colorSource,
					config.colors.separator,
					separatorText[config.components.footer.styles.starship.separator],
				);
				const innerWidth = Math.max(1, width - 2);
				const cwdLabel = renderStyleForSource(theme, colorSource, config.colors.cwd, formattedCwd);
				const needsSessionName =
					(config.components.footer.styles.starship.format
						? wideReferences.has("session_name")
						: config.components.footer.styles.starship.segments.sessionName) ||
					compactReferences.has("session_name");
				const sessionName = needsSessionName
					? sanitizeExtensionStatusText(ctx.sessionManager.getSessionName() ?? "")
					: "";
				const sessionNameLabel = sessionName
					? renderStyleForSource(theme, colorSource, config.colors.sessionName, sessionName)
					: "";
				const builtInSessionNameLabel = sessionNameLabel ? `in ${sessionNameLabel}` : "";
				const branchText = branch
					? formatGitBranchText(
							branch,
							config.components.footer.styles.starship.gitBranch.maxLength,
						)
					: undefined;
				const { percent: contextPercent, contextWindow } = resolveContextUsage(
					ctx,
					hooks.getLiveContext?.(),
				);
				const contextLabel = buildContextDisplayLabel({
					percent: contextPercent,
					contextWindow,
					style: config.components.footer.styles.starship.contextStyle,
					asciiGauge: iconMode === "ascii",
				});
				const tier = contextColorTier(
					contextPercent,
					config.components.footer.styles.starship.contextThresholds,
				);
				const contextColor =
					tier === "error"
						? config.colors.contextError
						: tier === "warning"
							? config.colors.contextWarning
							: config.colors.contextNormal;
				const cacheReadLabel = state.cacheReadLabel
					? renderStyleForSource(theme, colorSource, config.colors.tokens, state.cacheReadLabel)
					: "";
				const cacheWriteLabel = state.cacheWriteLabel
					? renderStyleForSource(theme, colorSource, config.colors.tokens, state.cacheWriteLabel)
					: "";
				const subscriptionLabel = state.subscription
					? renderStyleForSource(theme, colorSource, config.colors.cost, "(sub)")
					: "";
				const autoCompactionLabel = state.autoCompaction
					? renderStyleForSource(theme, colorSource, contextColor, "(auto)")
					: "";
				const gitColor = (text: string) =>
					renderStyleForSource(theme, colorSource, config.colors.gitBranch, text);
				const gitStatusColor = (text: string) =>
					renderStyleForSource(theme, colorSource, config.colors.gitStatus, text);
				const gitIcon = config.icons.git ? gitColor(config.icons.git) : "";
				const gitCounts = config.components.footer.styles.starship.segments.gitCounts;
				const stashLabel =
					state.stashed > 0
						? gitCounts
							? `${config.icons.stashed}${state.stashed}`
							: config.icons.stashed
						: "";
				const allStatus = [
					state.conflicted > 0 ? config.icons.conflicted : "",
					stashLabel,
					state.deleted > 0 ? config.icons.deleted : "",
					state.renamed > 0 ? config.icons.renamed : "",
					state.modified > 0 ? config.icons.modified : "",
					state.typechanged > 0 ? config.icons.typechanged : "",
					state.staged > 0 ? config.icons.staged : "",
					state.untracked > 0 ? config.icons.untracked : "",
				].join("");
				const aheadBehind = (() => {
					if (state.ahead > 0 && state.behind > 0) {
						return gitCounts
							? `${config.icons.ahead}${state.ahead}${config.icons.behind}${state.behind}`
							: config.icons.diverged;
					}
					if (state.ahead > 0)
						return gitCounts ? `${config.icons.ahead}${state.ahead}` : config.icons.ahead;
					if (state.behind > 0)
						return gitCounts ? `${config.icons.behind}${state.behind}` : config.icons.behind;
					return "";
				})();
				const statusBlock =
					allStatus || aheadBehind ? gitStatusColor(`[${allStatus}${aheadBehind}]`) : "";
				const gitStateBlock = gitStateLabel ? gitStatusColor(gitStateLabel) : "";
				const renderVariable = (name: string): string => {
					const canonical = FOOTER_FORMAT_ALIASES[name] ?? name;
					switch (canonical) {
						case "cwd":
							return cwdLabel;
						case "session_name":
							return sessionNameLabel;
						case "git_branch":
							return branchText
								? gitIcon
									? `${gitIcon} ${gitColor(branchText)}`
									: gitColor(branchText)
								: "";
						case "git_status":
							return statusBlock;
						case "git_state":
							return gitStateBlock;
						case "runtime": {
							if (!runtime) return "";
							const symbol = resolveRuntimeSymbol(runtime.name, runtime.symbol, iconMode);
							const label = runtime.version ? `${symbol} ${runtime.version}` : symbol;
							return renderStyleForSource(theme, colorSource, runtime.style, label);
						}
						case "model":
							return sanitizeExtensionStatusText(footerModelLabel);
						case "provider":
							return sanitizeExtensionStatusText(state.providerLabel);
						case "session_duration":
							return state.sessionStartEpoch
								? renderStyleForSource(
										theme,
										colorSource,
										config.colors.sessionDuration,
										buildSessionDurationLabel(state.sessionStartEpoch),
									)
								: "";
						case "username":
							return renderStyleForSource(
								theme,
								colorSource,
								config.colors.username,
								formatUsernameHostLabel(config.icons.username),
							);
						case "os":
							return renderStyleForSource(
								theme,
								colorSource,
								config.colors.os,
								formatOsLabel(config.icons.os, iconMode),
							);
						case "time":
							return renderStyleForSource(
								theme,
								colorSource,
								config.colors.time,
								formatTimeLabel(config.icons.time),
							);
						case "context":
							return renderStyleForSource(theme, colorSource, contextColor, contextLabel);
						case "tokens":
							return renderStyleForSource(
								theme,
								colorSource,
								config.colors.tokens,
								state.tokenLabel,
							);
						case "cache_read":
							return cacheReadLabel;
						case "cache_write":
							return cacheWriteLabel;
						case "cost":
							return renderStyleForSource(theme, colorSource, config.colors.cost, state.costLabel);
						case "subscription":
							return subscriptionLabel;
						case "auto_compaction":
							return autoCompactionLabel;
						case "package":
							return formatPackageVersionSegment(
								theme,
								packageVersion,
								colorSource,
								iconMode,
								config.icons.package,
								config.colors.packageVersion,
							);
						case "package_version":
							return packageVersion?.version
								? renderStyleForSource(
										theme,
										colorSource,
										config.colors.packageVersion,
										packageVersion.version,
									)
								: "";
						case "sep":
							return renderStyleForSource(theme, colorSource, config.colors.separator, " | ");
						case "git_commit":
							return formatGitCommitSegment(
								theme,
								commit,
								config.components.footer.styles.starship.gitCommit,
								colorSource,
								config.colors.gitCommit,
							);
						case "git_tag":
							return config.components.footer.styles.starship.gitCommit.showTag && commit?.tag
								? renderStyleForSource(theme, colorSource, config.colors.gitCommit, commit.tag)
								: "";
						case "git_metrics":
							return formatGitMetricsSegment(
								theme,
								state.metrics,
								config.components.footer.styles.starship.gitMetrics,
								colorSource,
								config.colors.gitMetricsAdded,
								config.colors.gitMetricsDeleted,
							);
						case "git_added":
							return state.metrics
								? renderStyleForSource(
										theme,
										colorSource,
										config.colors.gitMetricsAdded,
										`+${state.metrics.added}`,
									)
								: "";
						case "git_deleted":
							return state.metrics
								? renderStyleForSource(
										theme,
										colorSource,
										config.colors.gitMetricsDeleted,
										`−${state.metrics.deleted}`,
									)
								: "";
						default:
							return "";
					}
				};
				const branchParts: string[] = [];
				if (config.components.footer.styles.starship.segments.gitBranch) {
					if (branchText) {
						branchParts.push("on", gitIcon, gitColor(branchText));
					} else if (commit?.detached) {
						// `HEAD` uses git-branch style; `(hash)` uses git-commit style
						// (bold green) per Starship `git_commit` format.
						branchParts.push("on", gitIcon, gitColor("HEAD"));
						if (config.components.footer.styles.starship.segments.gitCommit && commit.oid) {
							const shortHash = commit.oid.slice(
								0,
								config.components.footer.styles.starship.gitCommit.hashLength,
							);
							const tag =
								config.components.footer.styles.starship.gitCommit.showTag && commit.tag
									? commit.tag
									: "";
							const inner = [shortHash, tag].filter(Boolean).join(" ");
							branchParts.push(
								renderStyleForSource(theme, colorSource, config.colors.gitCommit, `(${inner})`),
							);
						}
					}
				}
				const gitStatusParts =
					config.components.footer.styles.starship.segments.gitStatus && statusBlock
						? [statusBlock]
						: [];
				const showGitState =
					config.components.footer.styles.starship.segments.gitBranch ||
					config.components.footer.styles.starship.segments.gitStatus;
				const gitStateParts = showGitState && gitStateBlock ? [gitStateBlock] : [];
				const branchLabel = [...branchParts, ...gitStatusParts, ...gitStateParts]
					.filter(Boolean)
					.join(" ");
				const runtimeLabel = config.components.footer.styles.starship.segments.runtime
					? formatRuntimeSegment(theme, runtime, config.colors.runtimePrefix, colorSource, iconMode)
					: "";
				const packageVersionLabel = config.components.footer.styles.starship.segments.packageVersion
					? formatPackageVersionSegment(
							theme,
							packageVersion,
							colorSource,
							iconMode,
							config.icons.package,
							config.colors.packageVersion,
						)
					: "";
				// Skip standalone gitCommit when hash is already folded into the
				// branch display on detached HEAD.
				const hashFoldedIntoBranch =
					commit?.detached && config.components.footer.styles.starship.segments.gitBranch;
				const gitCommitLabel =
					config.components.footer.styles.starship.segments.gitCommit && !hashFoldedIntoBranch
						? formatGitCommitSegment(
								theme,
								commit,
								config.components.footer.styles.starship.gitCommit,
								colorSource,
								config.colors.gitCommit,
							)
						: "";
				const gitMetricsLabel = config.components.footer.styles.starship.segments.gitMetrics
					? formatGitMetricsSegment(
							theme,
							state.metrics,
							config.components.footer.styles.starship.gitMetrics,
							colorSource,
							config.colors.gitMetricsAdded,
							config.colors.gitMetricsDeleted,
						)
					: "";

				const sessionDurationSegment = (() => {
					if (
						!config.components.footer.styles.starship.segments.sessionDuration ||
						!state.sessionStartEpoch
					)
						return "";
					const timeLabel = buildSessionDurationLabel(state.sessionStartEpoch);
					const prefix = renderStyleForSource(theme, colorSource, "", "up for");
					const time = renderStyleForSource(
						theme,
						colorSource,
						config.colors.sessionDuration,
						timeLabel,
					);
					return `${prefix} ${time}`;
				})();
				const usernameSegment = config.components.footer.styles.starship.segments.username
					? renderStyleForSource(
							theme,
							colorSource,
							config.colors.username,
							formatUsernameHostLabel(config.icons.username),
						)
					: "";
				const osSegment = config.components.footer.styles.starship.segments.os
					? renderStyleForSource(
							theme,
							colorSource,
							config.colors.os,
							formatOsLabel(config.icons.os, iconMode),
						)
					: "";
				const left = [
					osSegment,
					usernameSegment,
					config.components.footer.styles.starship.segments.cwd ? cwdLabel : "",
					config.components.footer.styles.starship.segments.sessionName
						? builtInSessionNameLabel
						: "",
					branchLabel,
					gitCommitLabel,
					gitMetricsLabel,
					packageVersionLabel,
					runtimeLabel,
					sessionDurationSegment,
				]
					.filter(Boolean)
					.join(" ");

				const modelInfoSegment = config.components.footer.styles.starship.segments.modelInfo
					? composeModelInfoLabel(
							sanitizeExtensionStatusText(footerModelLabel),
							sanitizeExtensionStatusText(state.providerLabel),
						)
					: "";
				const timeSegment = config.components.footer.styles.starship.segments.time
					? renderStyleForSource(
							theme,
							colorSource,
							config.colors.time,
							formatTimeLabel(config.icons.time),
						)
					: "";
				const builtInContextLabel = [
					renderStyleForSource(theme, colorSource, contextColor, contextLabel),
					autoCompactionLabel,
				]
					.filter(Boolean)
					.join(" ");
				const builtInTokenLabel = [
					renderStyleForSource(theme, colorSource, config.colors.tokens, state.tokenLabel),
					cacheReadLabel,
					cacheWriteLabel,
				]
					.filter(Boolean)
					.join(" ");
				const builtInCostLabel = [
					renderStyleForSource(theme, colorSource, config.colors.cost, state.costLabel),
					subscriptionLabel,
				]
					.filter(Boolean)
					.join(" ");
				const right = [
					modelInfoSegment,
					config.components.footer.styles.starship.segments.context ? builtInContextLabel : "",
					config.components.footer.styles.starship.segments.tokens ? builtInTokenLabel : "",
					config.components.footer.styles.starship.segments.cost ? builtInCostLabel : "",
					timeSegment,
				]
					.filter(Boolean)
					.join(separator);

				let contentLeft = left;
				let contentMiddle = "";
				let contentRight = right;
				if (config.components.footer.styles.starship.format) {
					const {
						left: fmtLeft,
						middle: fmtMiddle,
						right: fmtRight,
					} = renderFormatSplit(wideFormatTokens, renderVariable);
					contentLeft = stripOrphanSeparators(fmtLeft);
					contentMiddle = stripOrphanSeparators(fmtMiddle);
					contentRight = stripOrphanSeparators(fmtRight);
				}

				const extensionStatuses = collectExtensionStatusSegments(
					footerData.getExtensionStatuses(),
					config,
				);
				const renderExtensionStatus = (segment: ExtensionStatusSegment) =>
					segment.colorMode === "original"
						? segment.text
						: renderStyleForSource(theme, colorSource, config.colors.extensionStatus, segment.text);
				const extensionLeftSegments = extensionStatuses.left.map(renderExtensionStatus);
				const extensionMiddleSegments = extensionStatuses.middle.map(renderExtensionStatus);
				const extensionRightSegments = extensionStatuses.right.map(renderExtensionStatus);
				const middleSegments = contentMiddle
					? [contentMiddle, ...extensionMiddleSegments]
					: extensionMiddleSegments;
				const renderLegacyContent = () =>
					composeFooterContent(
						contentLeft,
						contentRight,
						extensionLeftSegments,
						middleSegments,
						extensionRightSegments,
						separator,
						innerWidth,
					);
				const frameRows = (rows: string[]) =>
					rows.map((row) => {
						const framed = width > 2 ? ` ${truncateToWidth(row, width - 2, "")} ` : row;
						return truncateToWidth(framed, width, "");
					});

				if (!config.components.footer.styles.starship.responsive)
					return frameRows([renderLegacyContent()]);

				const fullZones = {
					left: appendStatusArea(
						contentLeft,
						joinStatusTexts(extensionLeftSegments, separator),
						separator,
					),
					middle: appendStatusArea(
						contentMiddle,
						joinStatusTexts(extensionMiddleSegments, separator),
						separator,
					),
					right: prependStatusArea(
						contentRight,
						joinStatusTexts(extensionRightSegments, separator),
						separator,
					),
				};
				if (fullFooterFitsAligned(fullZones, innerWidth)) {
					return frameRows([renderLegacyContent()]);
				}

				const reflowed = reflowFullFooter(fullZones, innerWidth);
				if (reflowed) return frameRows(reflowed);

				const chunkBudget = compactChunkBudget(innerWidth);
				const compactCwdLabel = truncateToWidth(cwdLabel, chunkBudget, "…");
				const compactSessionNameLabel = truncateToWidth(
					sessionNameLabel,
					Math.max(1, chunkBudget - visibleWidth("in ")),
					"…",
				);
				const compactBranchBudget = Math.max(
					1,
					chunkBudget - visibleWidth("on ") - (statusBlock ? visibleWidth(statusBlock) + 1 : 0),
				);
				const compactBranchLabel = truncateToWidth(
					renderVariable("git_branch"),
					compactBranchBudget,
					"…",
				);
				const renderCompactVariable = (name: string): string => {
					const canonical = FOOTER_FORMAT_ALIASES[name] ?? name;
					switch (canonical) {
						case "cwd":
							return compactCwdLabel;
						case "session_name":
							return compactSessionNameLabel;
						case "git_branch":
							return compactBranchLabel;
						default:
							return renderVariable(name);
					}
				};
				const compactChunks: Array<{
					text: string;
					boundary: "space" | "separator";
				}> = [];
				for (const chunk of compileCompactFormat(compactFormatTokens)) {
					if (chunk.kind === "extensions") {
						const statuses = [
							...extensionLeftSegments,
							...extensionMiddleSegments,
							...extensionRightSegments,
						];
						for (const [index, text] of statuses.entries()) {
							compactChunks.push({
								text,
								boundary: index === 0 ? chunk.boundary : "space",
							});
						}
						continue;
					}
					let rendered = stripOrphanSeparators(
						renderFormatTokens(chunk.tokens, renderCompactVariable),
					);
					const references = collectFooterFormatReferences(chunk.tokens, FOOTER_FORMAT_ALIASES);
					if (["cwd", "session_name", "git_branch"].some((name) => references.has(name))) {
						rendered = truncateToWidth(rendered, chunkBudget, "…");
					}
					if (rendered) compactChunks.push({ text: rendered, boundary: chunk.boundary });
				}
				return frameRows(
					packCompactChunks(
						compactChunks,
						innerWidth,
						config.components.footer.styles.starship.compactMaxLines,
						renderVariable("sep"),
					),
				);
			},
		};
	});
}

export function installHiddenFooter(ctx: ExtensionContext, onDispose?: () => void): void {
	ctx.ui.setFooter(() => ({
		dispose: onDispose,
		invalidate() {},
		render(): string[] {
			return [];
		},
	}));
}
