import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
	ExtensionStatusColorMode,
	ExtensionStatusComponentConfig,
	ExtensionStatusPlacement,
	HiddenExtensionStatusPlacement,
	ZentuiConfig,
} from "./config";
import {
	getExtensionStatusColorMode,
	getExtensionStatusPlacement,
	getHiddenExtensionStatusPlacement,
	isExtensionStatusPlacement,
} from "./config";
import { truncateFooterText } from "./footer-text";

export type ExtensionStatusSegment = {
	key: string;
	text: string;
	placement: ExtensionStatusPlacement;
	colorMode: ExtensionStatusColorMode;
};

export type ExtensionStatusSegmentsByPlacement = {
	left: ExtensionStatusSegment[];
	middle: ExtensionStatusSegment[];
	right: ExtensionStatusSegment[];
};

function compareKeys(a: ExtensionStatusSegment, b: ExtensionStatusSegment): number {
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function normalizeStatusWhitespace(value: string): string {
	return value
		.replace(/[\r\n\t\f\v]+/g, " ")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function sanitizeExtensionStatusText(value: string): string {
	return normalizeStatusWhitespace(stripVTControlCharacters(value));
}

function hasVisibleStatusText(value: string): boolean {
	return sanitizeExtensionStatusText(value).length > 0;
}

export function sanitizeExtensionStatusOriginalText(value: string): string {
	// Preserve only SGR and HTTP(S) OSC 8 links. Never pass title/clipboard/cursor controls.
	const marker = `__ZENTUI_${randomUUID()}_`;
	const sequences: Array<{ sequence: string; url: string | undefined }> = [];
	const protectedValue = value.replace(
		/\x1b\[[0-9;:]*m|\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g,
		(sequence, url: string | undefined) => `${marker}${sequences.push({ sequence, url }) - 1}__`,
	);
	const cleaned = normalizeStatusWhitespace(stripVTControlCharacters(protectedValue));
	// Other controls can swallow placeholders. Track only sequences that survive
	// stripping, including invalid targets that must end any surviving link.
	let activeLink = false;
	const restored = cleaned.replace(new RegExp(`${marker}(\\d+)__`, "g"), (_match, index) => {
		const entry = sequences[Number(index)];
		if (!entry) return "";
		const { sequence, url } = entry;
		if (url === undefined) return sequence;
		const close = activeLink ? "\x1b]8;;\x07" : "";
		activeLink = false;
		if (!url || /[\s\x00-\x1f\x7f-\x9f]/.test(url)) return close;
		try {
			const parsed = new URL(url);
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return close;
			activeLink = true;
			return `${close}\x1b]8;;${parsed.href}\x07`;
		} catch {
			return close;
		}
	});
	const result = restored + (activeLink ? "\x1b]8;;\x07" : "");
	return hasVisibleStatusText(result) ? result : "";
}

function closeExtensionStatusStyle(text: string): string {
	let lastSgr: string | undefined;
	for (const match of text.matchAll(/\x1b\[[0-9;:]*m/g)) lastSgr = match[0];
	return lastSgr && lastSgr !== "\x1b[0m" && lastSgr !== "\x1b[m" ? `${text}\x1b[0m` : text;
}

/** Hidden's single row: bounded fair budgets, anchored edges, centered/clamped middle. */
function layoutExtensionStatusLine(
	zones: Record<HiddenExtensionStatusPlacement, string>,
	width: number,
	ellipsis: string,
): string[] {
	const order: HiddenExtensionStatusPlacement[] = ["left", "middle", "right"];
	// At least one visible cell per zone and one blank between zones; prefer L/M/R if impossible.
	const entries = order
		.map((placement) => ({
			placement,
			text: zones[placement],
			width: visibleWidth(zones[placement]),
		}))
		.filter((entry) => entry.width > 0)
		.slice(0, Math.ceil(width / 2));
	if (!entries.length) return [];
	let remaining = width - (entries.length - 1);
	const byWidth = [...entries].sort((a, b) => a.width - b.width);
	// At most three allocations; short zones return unused budget to longer ones.
	for (const [index, entry] of byWidth.entries()) {
		const budget = Math.min(entry.width, Math.floor(remaining / (byWidth.length - index)));
		remaining -= budget;
		entry.text = closeExtensionStatusStyle(truncateFooterText(entry.text, budget, ellipsis));
		entry.width = visibleWidth(entry.text);
	}
	const leftWidth = entries.find((entry) => entry.placement === "left")?.width ?? 0;
	const rightWidth = entries.find((entry) => entry.placement === "right")?.width ?? 0;
	let row = "";
	let column = 0;
	for (const entry of entries) {
		const start =
			entry.placement === "left"
				? 0
				: entry.placement === "right"
					? width - entry.width
					: Math.max(
							leftWidth ? leftWidth + 1 : 0,
							Math.min(
								Math.floor((width - entry.width) / 2),
								width - entry.width - (rightWidth ? rightWidth + 1 : 0),
							),
						);
		row += " ".repeat(Math.max(0, start - column)) + entry.text;
		column = start + entry.width;
	}
	return [row];
}

/** Status-only presentation for Hidden: native ordering/colors, never Starship preferences. */
export function renderExtensionStatusLine(
	statuses: ReadonlyMap<string, string>,
	policy: ExtensionStatusComponentConfig,
	theme: Theme,
	width: number,
): string[] {
	if (width <= 0) return [];
	const zones: Record<HiddenExtensionStatusPlacement, string[]> = {
		left: [],
		middle: [],
		right: [],
	};
	for (const [key, value] of [...statuses].sort(([a], [b]) => a.localeCompare(b))) {
		if (
			(Object.hasOwn(policy.visibility, key)
				? policy.visibility[key]
				: policy.defaultVisibility) === "hide"
		)
			continue;
		const text = sanitizeExtensionStatusOriginalText(value);
		if (text)
			zones[getHiddenExtensionStatusPlacement(policy, key)].push(closeExtensionStatusStyle(text));
	}
	return layoutExtensionStatusLine(
		{
			left: zones.left.join(" "),
			middle: zones.middle.join(" "),
			right: zones.right.join(" "),
		},
		width,
		theme.fg("dim", "..."),
	);
}

export function collectExtensionStatusSegments(
	statuses: ReadonlyMap<string, string>,
	config: ZentuiConfig,
): ExtensionStatusSegmentsByPlacement {
	const segments: ExtensionStatusSegmentsByPlacement = {
		left: [],
		middle: [],
		right: [],
	};

	for (const [key, value] of statuses.entries()) {
		const placement = getExtensionStatusPlacement(config, key);
		if (placement === "off" || !isExtensionStatusPlacement(placement)) continue;
		if (placement !== "left" && placement !== "middle" && placement !== "right") continue;

		const colorMode = getExtensionStatusColorMode(config, key);
		const text =
			colorMode === "original"
				? sanitizeExtensionStatusOriginalText(value)
				: sanitizeExtensionStatusText(value);
		if (!text) continue;

		segments[placement].push({ key, text, placement, colorMode });
	}

	segments.left.sort(compareKeys);
	segments.middle.sort(compareKeys);
	segments.right.sort(compareKeys);
	return segments;
}
