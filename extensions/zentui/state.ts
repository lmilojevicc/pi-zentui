import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelLabelSource } from "./config";
import {
	buildCacheReadLabel,
	buildCacheWriteLabel,
	buildContextLabel,
	buildCostLabel,
	buildTokenLabel,
	formatProviderLabel,
	getUsageTotals,
} from "./format";
import type { GitStatusSummary } from "./git";
import type { PackageVersionResult } from "./package-version";
import type { RuntimeInfo } from "./runtime";
import type { FooterTelemetry } from "./telemetry";

export type FooterState = GitStatusSummary & {
	modelLabel: string;
	modelId: string;
	modelName: string;
	providerLabel: string;
	contextLabel: string;
	tokenLabel: string;
	cacheReadLabel: string;
	cacheWriteLabel: string;
	costLabel: string;
	subscription: boolean;
	autoCompaction: boolean;
	runtime?: RuntimeInfo;
	packageVersion?: PackageVersionResult;
	sessionStartEpoch?: number;
};

export function createInitialState(gitDefaults: GitStatusSummary): FooterState {
	return {
		modelLabel: "no-model",
		modelId: "",
		modelName: "",
		providerLabel: "Unknown",
		contextLabel: "--",
		tokenLabel: "↑0 ↓0",
		cacheReadLabel: "",
		cacheWriteLabel: "",
		costLabel: "$0.000",
		subscription: false,
		autoCompaction: false,
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
	telemetry: FooterTelemetry = {},
): void {
	const totals = getUsageTotals(ctx);
	const m = ctx.model;
	state.modelId = m?.id ?? "";
	state.modelName = m?.name ?? "";
	state.modelLabel = (modelLabelSource === "name" ? m?.name || m?.id : m?.id) ?? "no-model";
	state.providerLabel = formatProviderLabel(ctx.model?.provider);
	state.contextLabel = buildContextLabel(ctx);
	state.tokenLabel = buildTokenLabel(totals, cacheHitIcon);
	state.cacheReadLabel = buildCacheReadLabel(totals.cacheRead);
	state.cacheWriteLabel = buildCacheWriteLabel(totals.cacheWrite);
	state.costLabel = buildCostLabel(totals);
	state.subscription = telemetry.subscription === true;
	state.autoCompaction = telemetry.autoCompaction === true;
}
