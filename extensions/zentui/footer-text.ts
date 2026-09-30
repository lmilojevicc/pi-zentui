import { truncateToWidth } from "@earendil-works/pi-tui";

/** Close retained links before joining/padding footer fragments, even when truncation drops the final closure. */
export function truncateFooterText(text: string, width: number, ellipsis: string): string {
	const truncated = truncateToWidth(text, width, ellipsis);
	let activeLink = false;
	for (const match of truncated.matchAll(/\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
		activeLink = Boolean(match[1]);
	}
	return truncated + (activeLink ? "\x1b]8;;\x07" : "");
}
