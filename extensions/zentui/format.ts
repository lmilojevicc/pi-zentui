import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { ColorSource, ColorSpec } from "./config";
import type { RuntimeInfo } from "./runtime";
import { renderStyleForSource } from "./style";

export type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	latestCacheHitRate?: number;
	cost: number;
};

export function formatCount(value: number): string {
	if (value < 1000) return value.toString();
	if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
	if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

export function formatProviderLabel(provider: string | undefined): string {
	if (!provider) return "Unknown";

	const known: Record<string, string> = {
		anthropic: "Anthropic",
		gemini: "Google",
		google: "Google",
		ollama: "Ollama",
		openai: "OpenAI",
		"openai-codex": "OpenAI",
	};

	return (
		known[provider] ?? provider.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
	);
}

function calculateCacheHitRate(
	input: number,
	cacheRead: number,
	cacheWrite: number,
): number | undefined {
	const promptTokens = input + cacheRead + cacheWrite;
	return promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
}

export function getUsageTotals(ctx: ExtensionContext): UsageTotals {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let latestCacheHitRate: number | undefined;
	let cost = 0;

	const entries = ctx.sessionManager.getEntries?.() ?? ctx.sessionManager.getBranch();
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = (entry.message as AssistantMessage).usage;
		const entryInput = usage?.input ?? 0;
		const entryCacheRead = usage?.cacheRead ?? 0;
		const entryCacheWrite = usage?.cacheWrite ?? 0;

		input += entryInput;
		output += usage?.output ?? 0;
		cacheRead += entryCacheRead;
		cacheWrite += entryCacheWrite;
		cost += usage?.cost?.total ?? 0;
		latestCacheHitRate = calculateCacheHitRate(entryInput, entryCacheRead, entryCacheWrite);
	}

	return { input, output, cacheRead, cacheWrite, latestCacheHitRate, cost };
}

export function buildTokenLabel(totals: UsageTotals, cacheHitIcon = "󰆼"): string {
	const parts: string[] = [];
	if (totals.input) parts.push(`↑${formatCount(totals.input)}`);
	if (totals.output) parts.push(`↓${formatCount(totals.output)}`);

	const hasCacheTokens = totals.cacheRead > 0 || totals.cacheWrite > 0;
	if (hasCacheTokens && totals.latestCacheHitRate !== undefined) {
		const cacheHitRate = `${totals.latestCacheHitRate.toFixed(1)}%`;
		parts.push(cacheHitIcon ? `${cacheHitIcon} ${cacheHitRate}` : cacheHitRate);
	}
	return parts.length > 0 ? parts.join(" ") : "↑0 ↓0";
}

export function buildCostLabel(totals: UsageTotals): string {
	return `$${totals.cost.toFixed(3)}`;
}

export function buildSessionDurationLabel(startEpoch: number): string {
	const totalSeconds = Math.max(0, Math.floor((Date.now() - startEpoch) / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function buildContextLabel(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow;

	if (!usage || !contextWindow || contextWindow <= 0) return "--";

	const percent =
		usage.percent === null ? "?" : `${Math.max(0, Math.min(999, Math.round(usage.percent)))}%`;
	return `${percent}/${formatCount(contextWindow)}`;
}

export function formatRuntimeSegment(
	theme: Pick<Theme, "fg">,
	runtime: RuntimeInfo | undefined,
	prefixStyle: ColorSpec,
	colorSource: ColorSource,
): string {
	if (!runtime) return "";
	const label = runtime.version ? `${runtime.symbol} ${runtime.version}` : runtime.symbol;
	return `${renderStyleForSource(theme, colorSource, prefixStyle, "via")} ${renderStyleForSource(theme, colorSource, runtime.style, label)}`;
}

export function formatCwdLabel(cwd: string, cwdIcon: string): string {
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	const last = parts[parts.length - 1] ?? cwd;
	return cwdIcon ? `${cwdIcon} ${last}` : last;
}
