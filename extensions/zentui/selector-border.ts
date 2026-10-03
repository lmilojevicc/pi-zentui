import type { Theme } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { componentColor } from "./component-colors";
import type { ZentuiConfig } from "./config";
import { installPrototypePatch, removePrototypePatch } from "./prototype-patch-registry";
import {
	EDITOR_BORDER_FALLBACK,
	renderEditorBorder,
	renderStyleForSourceOrFallback,
} from "./style";

type PatchableSelectorPrototype = {
	render: (width: number) => string[];
};

type Cleanup = () => void;

function selectorPrototypes(): PatchableSelectorPrototype[] {
	const exports = PiCodingAgent as unknown as Record<string, unknown>;
	return ["ModelSelectorComponent", "SettingsSelectorComponent"].flatMap((name) => {
		const value = exports[name] as { prototype?: PatchableSelectorPrototype } | undefined;
		return value?.prototype ? [value.prototype] : [];
	});
}

function stripAnsi(text: string): string {
	return text.replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function isHorizontalBorderLine(line: string): boolean {
	return /^─+$/.test(stripAnsi(line));
}

function renderBorderLine(
	text: string,
	theme: Theme | undefined,
	config: ZentuiConfig | undefined,
): string {
	if (theme && config) {
		return renderStyleForSourceOrFallback(
			theme,
			config.components.selectorBorders.colorSource,
			componentColor(config, "selectorBorders", "border"),
			EDITOR_BORDER_FALLBACK,
			text,
		);
	}
	return renderEditorBorder(text);
}

export function patchSelectorBorderStyle(
	prototype: PatchableSelectorPrototype,
	getTheme?: () => Theme | undefined,
	getConfig?: () => ZentuiConfig,
): Cleanup {
	return installPrototypePatch(
		prototype,
		"render",
		"selector-border-render",
		({ predecessor, receiver, args }) => {
			const lines = Reflect.apply(predecessor, receiver, args) as string[];
			const width = args[0];
			if (
				!Array.isArray(lines) ||
				!lines.every((line) => typeof line === "string") ||
				lines.length === 0 ||
				typeof width !== "number" ||
				width <= 0 ||
				getConfig?.().components.selectorBorders.enabled === false
			)
				return lines;
			const theme = getTheme?.();
			const config = getConfig?.();
			const paint = (text: string) => renderBorderLine(text, theme, config);
			return lines.map((line, index) => {
				if (index !== 0 && index !== lines.length - 1) return line;
				if (!isHorizontalBorderLine(line)) return line;
				return paint("─".repeat(Math.max(1, width)));
			});
		},
	);
}

export function removeSelectorBorderStyle(): void {
	for (const prototype of selectorPrototypes())
		removePrototypePatch(prototype, "render", "selector-border-render");
}

export function installSelectorBorderStyle(
	getTheme?: () => Theme | undefined,
	getConfig?: () => ZentuiConfig,
): Cleanup {
	const cleanups: Cleanup[] = [];
	try {
		for (const prototype of selectorPrototypes())
			cleanups.push(patchSelectorBorderStyle(prototype, getTheme, getConfig));
	} catch (error) {
		for (const cleanup of cleanups) cleanup();
		throw error;
	}
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}
