import { homedir, hostname, userInfo } from "node:os";
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

type SessionUsage = {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
	cost?: unknown;
};

type SessionEntry = {
	type?: string;
	id?: string | number;
	timestamp?: string | number;
	usage?: SessionUsage;
	message?: {
		role?: string;
		usage?: SessionUsage;
	};
};

type SelectedUsage = {
	usage: SessionUsage | undefined;
	location: "message" | "entry";
	isAssistant: boolean;
};

type UsageCacheEntry = {
	key: string;
	totals: UsageTotals;
};

const MAX_USAGE_TOTAL = Number.MAX_VALUE;

let usageTotalsCache: UsageCacheEntry | undefined;
let usageTotalsAggregationPassCount = 0;

export function formatCount(value: number): string {
	if (value < 1000) return value.toString();
	if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
	if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

/** Human-readable whole-second duration used by settled and minimalist turn UI. */
export function formatElapsedDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
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
	if (promptTokens === 0) return undefined;
	if (Number.isFinite(promptTokens)) return (cacheRead / promptTokens) * 100;

	const scale = Math.max(input, cacheRead, cacheWrite);
	const scaledPromptTokens = input / scale + cacheRead / scale + cacheWrite / scale;
	return (cacheRead / scale / scaledPromptTokens) * 100;
}

function normalizeUsageNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageCostTotal(usage: SessionUsage | undefined): number {
	if (typeof usage?.cost !== "object" || usage.cost === null) return 0;
	return normalizeUsageNumber((usage.cost as { total?: unknown }).total);
}

function addUsageTotal(total: number, value: number): number {
	const sum = total + value;
	return Number.isFinite(sum) ? sum : MAX_USAGE_TOTAL;
}

function usageForEntry(entry: SessionEntry): SelectedUsage | undefined {
	if (entry.type === "message") {
		const role = entry.message?.role;
		if (role !== "assistant" && role !== "toolResult") return undefined;
		return {
			usage: entry.message?.usage,
			location: "message",
			isAssistant: role === "assistant",
		};
	}
	if (entry.type === "compaction" || entry.type === "branch_summary") {
		return { usage: entry.usage, location: "entry", isAssistant: false };
	}
	return undefined;
}

function normalizedUsage(usage: SessionUsage | undefined) {
	return {
		input: normalizeUsageNumber(usage?.input),
		output: normalizeUsageNumber(usage?.output),
		cacheRead: normalizeUsageNumber(usage?.cacheRead),
		cacheWrite: normalizeUsageNumber(usage?.cacheWrite),
		cost: usageCostTotal(usage),
	};
}

function entryIdentity(entry: SessionEntry): string {
	const selected = usageForEntry(entry);
	if (!selected) return "unsupported";
	const usage = normalizedUsage(selected.usage);
	return JSON.stringify([
		entry.id ?? null,
		entry.timestamp ?? null,
		entry.type ?? null,
		entry.message?.role ?? null,
		selected.location,
		usage.input,
		usage.output,
		usage.cacheRead,
		usage.cacheWrite,
		usage.cost,
	]);
}

function buildUsageFingerprint(entries: readonly SessionEntry[]): string {
	return entries.map(entryIdentity).join("\0");
}

function computeUsageTotals(entries: readonly SessionEntry[]): UsageTotals {
	usageTotalsAggregationPassCount += 1;
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let latestCacheHitRate: number | undefined;
	let cost = 0;

	for (const entry of entries) {
		const selected = usageForEntry(entry);
		if (!selected) continue;
		const usage = normalizedUsage(selected.usage);

		input = addUsageTotal(input, usage.input);
		output = addUsageTotal(output, usage.output);
		cacheRead = addUsageTotal(cacheRead, usage.cacheRead);
		cacheWrite = addUsageTotal(cacheWrite, usage.cacheWrite);
		cost = addUsageTotal(cost, usage.cost);
		if (selected.isAssistant) {
			latestCacheHitRate = calculateCacheHitRate(usage.input, usage.cacheRead, usage.cacheWrite);
		}
	}

	return Object.freeze({ input, output, cacheRead, cacheWrite, latestCacheHitRate, cost });
}

export function invalidateUsageTotalsCache(): void {
	usageTotalsCache = undefined;
}

/** Test helper: counts aggregation passes only; every cache lookup still fingerprints all entries. */
export function __usageTotalsAggregationPassCount(): number {
	return usageTotalsAggregationPassCount;
}

/** Test helper: reset the aggregation-pass counter and cached totals. */
export function __resetUsageTotalsCacheForTests(): void {
	usageTotalsCache = undefined;
	usageTotalsAggregationPassCount = 0;
}

export function getUsageTotals(ctx: ExtensionContext): UsageTotals {
	const sessionManager = ctx.sessionManager as {
		getEntries?: () => readonly SessionEntry[];
		getBranch: () => readonly SessionEntry[];
	};
	const entries =
		typeof sessionManager.getEntries === "function"
			? sessionManager.getEntries()
			: sessionManager.getBranch();
	const key = buildUsageFingerprint(entries);
	if (usageTotalsCache?.key === key) return usageTotalsCache.totals;

	const totals = computeUsageTotals(entries);
	usageTotalsCache = { key, totals };
	return totals;
}

export function buildCacheReadLabel(cacheRead: number): string {
	return cacheRead > 0 ? `R${formatCount(cacheRead)}` : "";
}

export function buildCacheWriteLabel(cacheWrite: number): string {
	return cacheWrite > 0 ? `W${formatCount(cacheWrite)}` : "";
}

export function buildSessionTokenLabel(totals: Pick<UsageTotals, "input" | "output">): string {
	const parts: string[] = [];
	if (totals.input) parts.push(`↑${formatCount(totals.input)}`);
	if (totals.output) parts.push(`↓${formatCount(totals.output)}`);
	return parts.length > 0 ? parts.join(" ") : "↑0 ↓0";
}

export function formatCacheHitRate(rate: number | undefined): string {
	return `${rate !== undefined && Number.isFinite(rate) ? rate.toFixed(1) : "0.0"}%`;
}

export function buildTokenLabel(totals: UsageTotals, cacheHitIcon = "󰆼"): string {
	const tokenLabel = buildSessionTokenLabel(totals);
	const hasCacheTokens = totals.cacheRead > 0 || totals.cacheWrite > 0;
	if (!hasCacheTokens || totals.latestCacheHitRate === undefined) return tokenLabel;

	const cacheHitRate = formatCacheHitRate(totals.latestCacheHitRate);
	return `${tokenLabel} ${cacheHitIcon ? `${cacheHitIcon} ` : ""}${cacheHitRate}`;
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
		percent === null || percent === undefined || !Number.isFinite(percent)
			? "?"
			: `${Math.max(0, Math.min(999, percent)).toFixed(1)}%`;
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

export type ContextUsageSnapshot = {
	percent: number | undefined;
	contextWindow: number | undefined;
};

export function resolveContextUsage(
	ctx: Pick<ExtensionContext, "model" | "getContextUsage">,
	live?: { tokens: number },
): ContextUsageSnapshot {
	const usage = ctx.getContextUsage();
	const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow;
	return {
		percent:
			live && contextWindow && contextWindow > 0
				? (live.tokens / contextWindow) * 100
				: (usage?.percent ?? undefined),
		contextWindow,
	};
}

export function buildContextLabel(ctx: ExtensionContext): string {
	const { percent, contextWindow } = resolveContextUsage(ctx);
	return formatContextPercentLabel(percent, contextWindow);
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
	/** Final path components to keep in full/repository mode. 0 = unlimited. */
	depth?: number;
	home?: string;
	repositoryRoot?: string;
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
	const fullPath = (depth = options?.depth ?? 0) => {
		const home =
			options?.home ??
			(() => {
				try {
					return homedir();
				} catch {
					return "";
				}
			})();
		return applyPathDepth(toHomePath(normalized, home), depth);
	};
	let pathText: string;
	if (mode === "full") {
		pathText = fullPath();
	} else if (mode === "repository") {
		const root = options?.repositoryRoot ? normalizeDisplayPath(options.repositoryRoot) : undefined;
		if (!root) {
			pathText = fullPath(0);
		} else {
			const rootPrefix = root === "/" ? "/" : `${root}/`;
			if (normalized !== root && !normalized.startsWith(rootPrefix)) {
				// Unsafe roots fail open to the existing unlimited full path.
				pathText = fullPath(0);
			} else {
				const relative = normalized === root ? "." : normalized.slice(rootPrefix.length);
				pathText = relative === "." ? relative : applyPathDepth(relative, options?.depth ?? 0);
			}
		}
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
