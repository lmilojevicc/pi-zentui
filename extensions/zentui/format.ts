import { homedir, hostname, userInfo } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
	ColorSource,
	ColorSpec,
	ContextStyle,
	ContextThresholds,
	GitBranchMaxLength,
	PathDisplayMode,
} from "./config";
import type { GitCommitInfo, GitMetricsInfo } from "./git";
import type { IconMode } from "./icons";
import { resolveOsIcon, resolvePackageIcon, resolveRuntimeSymbol } from "./icons";
import type { PackageVersionResult } from "./package-version";
import type { RuntimeInfo } from "./runtime";
import { renderStyleForSource } from "./style";

/**
 * Starship `git_commit` style — render a short hash, optionally with an
 * exact-match tag. See https://starship.rs/config/#git-commit
 *
 * Visibility is decided by the caller; this helper only formats the data.
 * `hashLength` is clamped to [4, 40] upstream.
 */
export function formatGitCommitSegment(
	theme: Pick<Theme, "fg">,
	commit: GitCommitInfo | undefined,
	config: { hashLength: number; onlyDetached: boolean; showTag: boolean },
	colorSource: ColorSource,
	style: ColorSpec,
): string {
	if (!commit?.oid) return "";
	// Starship's only_detached hides the whole module when attached.
	if (config.onlyDetached && !commit.detached) return "";
	const hash = commit.oid.slice(0, config.hashLength);
	const tag = config.showTag && commit.tag ? commit.tag : "";
	if (!hash && !tag) return "";
	const label = [hash, tag].filter(Boolean).join(" ");
	return renderStyleForSource(theme, colorSource, style, label);
}

/**
 * Starship `git_metrics` style — render `+added −deleted` line counts.
 * See https://starship.rs/config/#git-metrics
 *
 * When `onlyNonzero` is true, each zero component is omitted independently
 * and the whole segment hides at 0/0.
 */
export function formatGitMetricsSegment(
	theme: Pick<Theme, "fg">,
	metrics: GitMetricsInfo | null | undefined,
	config: { onlyNonzero: boolean },
	colorSource: ColorSource,
	addedStyle: ColorSpec,
	deletedStyle: ColorSpec,
): string {
	if (!metrics) return "";
	const showAdded = !config.onlyNonzero || metrics.added > 0;
	const showDeleted = !config.onlyNonzero || metrics.deleted > 0;
	if (!showAdded && !showDeleted) return "";
	const parts: string[] = [];
	if (showAdded) {
		parts.push(renderStyleForSource(theme, colorSource, addedStyle, `+${metrics.added}`));
	}
	if (showDeleted) {
		parts.push(renderStyleForSource(theme, colorSource, deletedStyle, `−${metrics.deleted}`));
	}
	return parts.join(" ");
}

export type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	latestCacheHitRate?: number;
	cost: number;
};

export type ContextColorTier = "normal" | "warning" | "error";

type SessionEntry = {
	type?: string;
	id?: string | number;
	timestamp?: string | number;
	message?: {
		role?: string;
		usage?: AssistantMessage["usage"];
	};
};

type UsageCacheEntry = {
	key: string;
	totals: UsageTotals;
};

let usageTotalsCache: UsageCacheEntry | undefined;
let usageTotalsComputeCount = 0;

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

function entryIdentity(entry: SessionEntry | undefined): string {
	if (!entry) return "";
	const usage = entry.message?.usage;
	const usageKey = usage
		? `${usage.input ?? 0}:${usage.output ?? 0}:${usage.cacheRead ?? 0}:${usage.cacheWrite ?? 0}:${usage.cost?.total ?? 0}`
		: "";
	return `${entry.id ?? ""}|${entry.timestamp ?? ""}|${entry.type ?? ""}|${entry.message?.role ?? ""}|${usageKey}`;
}

function buildUsageFingerprint(entries: readonly SessionEntry[]): string {
	const first = entries[0];
	const last = entries[entries.length - 1];
	return `${entries.length}\0${entryIdentity(first)}\0${entryIdentity(last)}`;
}

function computeUsageTotals(entries: readonly SessionEntry[]): UsageTotals {
	usageTotalsComputeCount += 1;
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let latestCacheHitRate: number | undefined;
	let cost = 0;

	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		const usage = entry.message.usage;
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

	return Object.freeze({ input, output, cacheRead, cacheWrite, latestCacheHitRate, cost });
}

export function invalidateUsageTotalsCache(): void {
	usageTotalsCache = undefined;
}

/** Test helper: number of full usage scans performed since process start / last reset. */
export function __usageTotalsComputeCount(): number {
	return usageTotalsComputeCount;
}

/** Test helper: reset memoization counters/cache. */
export function __resetUsageTotalsCacheForTests(): void {
	usageTotalsCache = undefined;
	usageTotalsComputeCount = 0;
}

export function getUsageTotals(ctx: ExtensionContext): UsageTotals {
	const sessionManager = ctx.sessionManager as {
		getEntries?: () => SessionEntry[];
		getBranch: () => SessionEntry[];
	};
	const entries = sessionManager.getEntries?.() ?? sessionManager.getBranch();
	const key = buildUsageFingerprint(entries);
	if (usageTotalsCache?.key === key) return usageTotalsCache.totals;

	const totals = computeUsageTotals(entries);
	usageTotalsCache = { key, totals };
	return totals;
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

export function contextColorTier(
	percent: number | null | undefined,
	thresholds: ContextThresholds = { warning: 70, error: 90 },
): ContextColorTier {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return "normal";
	if (percent >= thresholds.error) return "error";
	if (percent >= thresholds.warning) return "warning";
	return "normal";
}

export function buildContextGauge(percent: number, width = 10, ascii = false): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * width);
	const on = ascii ? "#" : "█";
	const off = ascii ? "-" : "░";
	return `${on.repeat(filled)}${off.repeat(Math.max(0, width - filled))}`;
}

export function formatContextPercentLabel(
	percent: number | null | undefined,
	contextWindow: number | undefined,
): string {
	if (!contextWindow || contextWindow <= 0) return "--";
	const percentLabel =
		percent === null || percent === undefined
			? "?"
			: `${Math.max(0, Math.min(999, Math.round(percent)))}%`;
	return `${percentLabel}/${formatCount(contextWindow)}`;
}

export function buildContextDisplayLabel(options: {
	percent: number | null | undefined;
	contextWindow: number | undefined;
	style?: ContextStyle;
	asciiGauge?: boolean;
}): string {
	const { percent, contextWindow, style = "text", asciiGauge = false } = options;
	if (!contextWindow || contextWindow <= 0) return "--";

	const text = formatContextPercentLabel(percent, contextWindow);
	const numericPercent =
		percent === null || percent === undefined || !Number.isFinite(percent)
			? 0
			: Math.max(0, Math.min(100, percent));
	const gauge = buildContextGauge(numericPercent, 10, asciiGauge);

	if (style === "gauge") return `[${gauge}]`;
	if (style === "text+gauge") return `[${gauge}] ${text}`;
	return text;
}

export function buildContextLabel(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow;
	return formatContextPercentLabel(usage?.percent, contextWindow);
}

export function formatRuntimeSegment(
	theme: Pick<Theme, "fg">,
	runtime: RuntimeInfo | undefined,
	prefixStyle: ColorSpec,
	colorSource: ColorSource,
	mode: IconMode = "auto",
): string {
	if (!runtime) return "";
	const symbol = resolveRuntimeSymbol(runtime.name, runtime.symbol, mode);
	const label = runtime.version ? `${symbol} ${runtime.version}` : symbol;
	return `${renderStyleForSource(theme, colorSource, prefixStyle, "via")} ${renderStyleForSource(theme, colorSource, runtime.style, label)}`;
}

/**
 * Render the package-version segment in Starship `is <glyph> <version>` shape.
 *
 * Distinct from the runtime segment: this surfaces the project's own
 * manifest version (e.g. `package.json#version`), not the installed
 * toolchain version. Glyph comes from the Starship Nerd Font preset
 * (https://starship.rs/presets/nerd-font); default color `208` matches
 * the Starship `package` module default
 * (https://starship.rs/config/#package-version).
 */
export function formatPackageVersionSegment(
	theme: Pick<Theme, "fg">,
	pkg: PackageVersionResult | undefined,
	colorSource: ColorSource,
	mode: IconMode = "auto",
	configuredIcon: string = "",
	versionStyle: ColorSpec = "208",
): string {
	if (!pkg) return "";
	const icon = resolvePackageIcon(configuredIcon, mode);
	const label = `${icon} ${pkg.version}`;
	return `${renderStyleForSource(theme, colorSource, "", "is")} ${renderStyleForSource(theme, colorSource, versionStyle, label)}`;
}

export type FormatCwdOptions = {
	mode?: PathDisplayMode;
	/** Trailing directory components to keep in full mode. 0 = unlimited. */
	depth?: number;
	home?: string;
};

function normalizeDisplayPath(cwd: string): string {
	const withSlashes = cwd.replace(/\\/g, "/");
	if (withSlashes === "/" || /^\/+$/.test(withSlashes)) return "/";
	const stripped = withSlashes.replace(/\/+$/, "");
	return stripped === "" ? withSlashes : stripped;
}

function toHomePath(path: string, home: string): string {
	if (!home) return path;
	const homeNorm = home.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!homeNorm) return path;
	if (path === homeNorm) return "~";
	if (path.startsWith(`${homeNorm}/`)) return `~${path.slice(homeNorm.length)}`;
	return path;
}

/** Starship-style: keep last `depth` components; prefix with `…/` when parents were dropped. */
function applyPathDepth(path: string, depth: number): string {
	if (!Number.isFinite(depth) || depth <= 0) return path;
	const limit = Math.floor(depth);
	if (path === "~" || path === "/") return path;

	let components: string[];
	if (path.startsWith("~/")) {
		components = path.slice(2).split("/").filter(Boolean);
	} else if (/^[A-Za-z]:\//.test(path)) {
		components = path.slice(3).split("/").filter(Boolean);
	} else if (path.startsWith("/")) {
		components = path.slice(1).split("/").filter(Boolean);
	} else {
		components = path.split("/").filter(Boolean);
	}

	if (components.length <= limit) return path;
	return `…/${components.slice(-limit).join("/")}`;
}

export function formatCwdLabel(cwd: string, cwdIcon: string, options?: FormatCwdOptions): string {
	const mode = options?.mode ?? "basename";
	const normalized = normalizeDisplayPath(cwd);
	let pathText: string;
	if (mode === "full") {
		const home =
			options?.home ??
			(() => {
				try {
					return homedir();
				} catch {
					return "";
				}
			})();
		pathText = applyPathDepth(toHomePath(normalized, home), options?.depth ?? 0);
	} else if (normalized === "/") {
		pathText = "/";
	} else {
		const parts = normalized.split("/").filter(Boolean);
		pathText = parts[parts.length - 1] ?? cwd;
	}
	return cwdIcon ? `${cwdIcon} ${pathText}` : pathText;
}

function stripAnsi(text: string): string {
	return text.replace(/\u001B\[[0-9;]*m/g, "");
}

export function formatGitBranchText(
	branch: string,
	maxLength: GitBranchMaxLength = "full",
): string {
	if (maxLength === "full" || visibleWidth(branch) <= maxLength) return branch;
	return stripAnsi(truncateToWidth(branch, maxLength, "…"));
}

export function formatUsernameHostLabel(icon: string): string {
	try {
		const user = userInfo().username;
		const host = hostname();
		if (!user || !host) return "";
		const label = `${user}@${host}`;
		return icon ? `${icon} ${label}` : label;
	} catch {
		return "";
	}
}

export function formatTimeLabel(icon: string): string {
	const now = new Date();
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const label = `${hours}:${minutes}`;
	return icon ? `${icon} ${label}` : label;
}

export function formatOsLabel(
	configuredIcon: string,
	mode: IconMode = "auto",
	platform: string = process.platform,
): string {
	return resolveOsIcon(configuredIcon, mode, platform);
}
