import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { RuntimeInfo } from "./runtime";
import { type ThemeLike, colorize, renderTerminalStyle } from "./style";

export type UsageTotals = {
	input: number;
	output: number;
	cost: number;
};

export function formatCount(value: number): string {
	if (value < 1000) return `${value}`;
	if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
	return `${Math.round(value / 1000)}k`;
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

export function getUsageTotals(ctx: ExtensionContext): UsageTotals {
	let input = 0;
	let output = 0;
	let cost = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message as AssistantMessage;
		input += message.usage?.input ?? 0;
		output += message.usage?.output ?? 0;
		cost += message.usage?.cost?.total ?? 0;
	}

	return { input, output, cost };
}

export function buildTokenLabel(totals: UsageTotals): string {
	return `↑${formatCount(totals.input)} ↓${formatCount(totals.output)}`;
}

export function buildCostLabel(totals: UsageTotals): string {
	return `$${totals.cost.toFixed(3)}`;
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
	mutedColor: string,
): string {
	if (!runtime) return "";
	const label = runtime.version ? `${runtime.symbol} ${runtime.version}` : runtime.symbol;
	return `${colorize(theme, mutedColor, "via")} ${renderTerminalStyle(runtime.style, label)}`;
}

export function formatCwdLabel(cwd: string, cwdIcon: string): string {
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	const last = parts[parts.length - 1] ?? cwd;
	return cwdIcon ? `${cwdIcon} ${last}` : last;
}
