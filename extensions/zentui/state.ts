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
	type UsageTotals,
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
	usageTotals: UsageTotals;
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
		usageTotals: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			latestCacheHitRate: undefined,
			cost: 0,
		},
		subscription: false,
		autoCompaction: false,
		runtime: undefined,
		packageVersion: undefined,
		sessionStartEpoch: Date.now(),
		...gitDefaults,
	};
}

export function modelLabelFor(
	state: Pick<FooterState, "modelId" | "modelName">,
	source: ModelLabelSource,
): string {
	return source === "name"
		? state.modelName || state.modelId || "no-model"
		: state.modelId || "no-model";
}

export function syncUsageState(
	state: FooterState,
	totals: UsageTotals,
	cacheHitIcon: string,
): void {
	state.tokenLabel = buildTokenLabel(totals, cacheHitIcon);
	state.cacheReadLabel = buildCacheReadLabel(totals.cacheRead);
	state.cacheWriteLabel = buildCacheWriteLabel(totals.cacheWrite);
	state.costLabel = buildCostLabel(totals);
	state.usageTotals = totals;
}

/** Refresh model identity without rescanning usage or project state. */
export function syncModelState(state: FooterState, model: ExtensionContext["model"]): void {
	state.modelId = model?.id ?? "";
	state.modelName = model?.name ?? "";
	state.modelLabel = modelLabelFor(state, "id");
	state.providerLabel = formatProviderLabel(model?.provider);
}

export function syncState(
	state: FooterState,
	ctx: ExtensionContext,
	cacheHitIcon: string,
	telemetry: FooterTelemetry = {},
	options: { includeContextLabel?: boolean; usageTotals?: UsageTotals } = {},
): void {
	const totals = options.usageTotals ?? getUsageTotals(ctx);
	syncModelState(state, ctx.model);
	// Production surfaces resolve fresh context on demand, not from this compatibility label.
	state.contextLabel = options.includeContextLabel === false ? "--" : buildContextLabel(ctx);
	syncUsageState(state, totals, cacheHitIcon);
	state.subscription = telemetry.subscription === true;
	state.autoCompaction = telemetry.autoCompaction === true;
}
