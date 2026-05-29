import { visibleWidth } from "@earendil-works/pi-tui";
import type { ColorSource, PolishedTuiConfig } from "./config";
import type { GitStatusSummary } from "./git";
import { type ThemeLike, renderStyleForSource } from "./style";

type SegmenterSegment = { segment: string };

type GraphemeSegmenter = {
	segment(text: string): Iterable<SegmenterSegment>;
};

const Segmenter = (
	Intl as unknown as {
		Segmenter?: new (
			locale: string | undefined,
			options: { granularity: "grapheme" },
		) => GraphemeSegmenter;
	}
).Segmenter;

function splitGraphemes(text: string): string[] {
	if (!Segmenter) return Array.from(text);
	return Array.from(
		new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
		(segment) => segment.segment,
	);
}

function truncatePlainTextToWidth(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";

	let result = "";
	let width = 0;
	for (const segment of splitGraphemes(text)) {
		const segmentWidth = visibleWidth(segment);
		if (width + segmentWidth > maxWidth) break;
		result += segment;
		width += segmentWidth;
	}
	return result;
}

export function truncateGitBranch(branch: string, config: PolishedTuiConfig["gitBranch"]): string {
	const maxBranchWidth = config.truncation_length;
	if (visibleWidth(branch) <= maxBranchWidth) return branch;

	const kept = truncatePlainTextToWidth(branch, maxBranchWidth);
	return `${kept}${config.truncation_symbol}`;
}

export function renderGitBranchModule(
	theme: ThemeLike,
	colorSource: ColorSource,
	config: PolishedTuiConfig,
	branch: string | undefined,
): string {
	if (!config.gitBranch.enable || !branch) return "";

	const branchText = truncateGitBranch(branch, config.gitBranch);
	if (!branchText) return "";

	const gitColor = (text: string) =>
		renderStyleForSource(theme, colorSource, config.colors.gitBranch, text);
	const gitIcon = config.icons.git ? gitColor(config.icons.git) : "";
	return ["on", gitIcon, gitColor(branchText)].filter(Boolean).join(" ");
}

export function formatGitStatusText(
	state: GitStatusSummary,
	icons: PolishedTuiConfig["icons"],
): string {
	const allStatus = [
		state.conflicted > 0 ? icons.conflicted : "",
		state.stashed ? icons.stashed : "",
		state.deleted > 0 ? icons.deleted : "",
		state.renamed > 0 ? icons.renamed : "",
		state.modified > 0 ? icons.modified : "",
		state.typechanged > 0 ? icons.typechanged : "",
		state.staged > 0 ? icons.staged : "",
		state.untracked > 0 ? icons.untracked : "",
	].join("");
	const aheadBehind =
		state.ahead > 0 && state.behind > 0
			? icons.diverged
			: state.ahead > 0
				? icons.ahead
				: state.behind > 0
					? icons.behind
					: "";

	return `${allStatus}${aheadBehind}`;
}

export function renderGitStatusModule(
	theme: ThemeLike,
	colorSource: ColorSource,
	config: PolishedTuiConfig,
	state: GitStatusSummary,
): string {
	if (!config.gitStatus.enable) return "";

	const statusText = formatGitStatusText(state, config.icons);
	return statusText
		? renderStyleForSource(theme, colorSource, config.colors.gitStatus, `[${statusText}]`)
		: "";
}

export function renderGitModules(
	theme: ThemeLike,
	colorSource: ColorSource,
	config: PolishedTuiConfig,
	state: GitStatusSummary,
): string {
	return [
		renderGitBranchModule(theme, colorSource, config, state.branch),
		renderGitStatusModule(theme, colorSource, config, state),
	]
		.filter(Boolean)
		.join(" ");
}
