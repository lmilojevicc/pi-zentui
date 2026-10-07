import { componentColor } from "./component-colors";
import type { ZentuiConfig } from "./config";

/** New roles have no legacy shared-color key; consumers supply their existing safe fallback. */
export function liveMetadataColor(
	config: ZentuiConfig,
	owner: "editor" | "footer",
	name: string,
): string | undefined {
	const role =
		name === "pr_number"
			? "prNumber"
			: name === "pr_url"
				? "prUrl"
				: name === "ci"
					? "ci"
					: name === "token_rate"
						? "tokenRate"
						: undefined;
	return role ? componentColor(config, owner, role) : undefined;
}
