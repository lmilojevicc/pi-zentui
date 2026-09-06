import { truncateToWidth } from "@earendil-works/pi-tui";

/** Close retained links before joining/padding footer fragments, even on Pi < 0.84.0. */
export function truncateFooterText(text: string, width: number, ellipsis: string): string {
	const truncated = truncateToWidth(text, width, ellipsis);
	let activeLink = false;
	for (const match of truncated.matchAll(/\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
		activeLink = Boolean(match[1]);
	}
	return truncated + (activeLink ? "\x1b]8;;\x07" : "");
}
