import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelLabelSource } from "./config";
import {
	buildContextLabel,
	buildCostLabel,
	buildTokenLabel,
	formatProviderLabel,
	getUsageTotals,
} from "./format";
import type { GitStatusSummary } from "./git";
import type { PackageVersionResult } from "./package-version";
import type { RuntimeInfo } from "./runtime";

export type FooterState = GitStatusSummary & {
	modelLabel: string;
	providerLabel: string;
	contextLabel: string;
	tokenLabel: string;
	costLabel: string;
	runtime?: RuntimeInfo;
	packageVersion?: PackageVersionResult;
	sessionStartEpoch?: number;
};

export function createInitialState(gitDefaults: GitStatusSummary): FooterState {
	return {
		modelLabel: "no-model",
		providerLabel: "Unknown",
		contextLabel: "--",
		tokenLabel: "↑0 ↓0",
		costLabel: "$0.000",
		runtime: undefined,
		packageVersion: undefined,
		sessionStartEpoch: Date.now(),
		...gitDefaults,
	};
}

export function syncState(
	state: FooterState,
	ctx: ExtensionContext,
	cacheHitIcon: string,
	modelLabelSource: ModelLabelSource,
): void {
	const totals = getUsageTotals(ctx);
	const m = ctx.model;
	state.modelLabel = (modelLabelSource === "name" ? m?.name || m?.id : m?.id) ?? "no-model";
	state.providerLabel = formatProviderLabel(ctx.model?.provider);
	state.contextLabel = buildContextLabel(ctx);
	state.tokenLabel = buildTokenLabel(totals, cacheHitIcon);
	state.costLabel = buildCostLabel(totals);
}
