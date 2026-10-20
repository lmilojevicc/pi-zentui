import type { Theme } from "@earendil-works/pi-coding-agent";
import type { CodexQuota } from "./codex-quota.ts";
import { componentColor } from "./component-colors.ts";
import type { ZentuiConfig } from "./config.ts";
import { renderStyleForSourceOrFallback } from "./style.ts";

export function codexQuotaText(quota: CodexQuota | undefined): string {
	if (!quota) return "";
	const percent = (value: number | undefined) => (value === undefined ? "--" : `${value}%`);
	return `5h ${percent(quota.fiveHour)} | week ${percent(quota.week)}${quota.stale ? " stale" : ""}`;
}

export function renderCodexQuota(
	quota: CodexQuota | undefined,
	theme: Theme,
	config: ZentuiConfig,
	owner: "editor" | "footer",
): string {
	if (!config.components[owner].codexQuota || !quota) return "";
	const remaining = Math.min(quota.fiveHour ?? 100, quota.week ?? 100);
	const tier =
		remaining <= 20
			? "contextError"
			: quota.stale || remaining <= 50
				? "contextWarning"
				: "contextNormal";
	return renderStyleForSourceOrFallback(
		theme,
		config.components[owner].colorSource,
		componentColor(config, owner, tier),
		tier === "contextError" ? "error" : tier === "contextWarning" ? "warning" : "muted",
		codexQuotaText(quota),
	);
}
