import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionStatusColorMode, ExtensionStatusPlacement, ZentuiConfig } from "./config";
import {
	getExtensionStatusColorMode,
	getExtensionStatusPlacement,
	isExtensionStatusPlacement,
} from "./config";

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
	const sequences: string[] = [];
	const protect = (sequence: string) => `${marker}${sequences.push(sequence) - 1}__`;
	let activeLink = false;
	const protectedValue = value.replace(
		/\x1b\[[0-9;:]*m|\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g,
		(sequence, url: string | undefined) => {
			if (url === undefined) return protect(sequence);
			const close = activeLink ? protect("\x1b]8;;\x07") : "";
			activeLink = false;
			if (!url || /[\s\x00-\x1f\x7f-\x9f]/.test(url)) return close;
			try {
				const parsed = new URL(url);
				if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return close;
				activeLink = true;
				return close + protect(`\x1b]8;;${parsed.href}\x07`);
			} catch {
				return close;
			}
		},
	);
	const cleaned = normalizeStatusWhitespace(stripVTControlCharacters(protectedValue));
	const restored = cleaned.replace(
		new RegExp(`${marker}(\\d+)__`, "g"),
		(_match, index) => sequences[Number(index)] ?? "",
	);
	const result = restored + (activeLink ? "\x1b]8;;\x07" : "");
	return hasVisibleStatusText(result) ? result : "";
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
