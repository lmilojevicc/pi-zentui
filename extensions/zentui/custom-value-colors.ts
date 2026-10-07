import type { ColorSource, ColorSpec } from "./config";
import {
	type CustomVariableColorMode,
	MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS,
	sanitizeCustomVariableText,
} from "./custom-variables";
import { isSupportedColorSpec, renderStyleForSource, type ThemeLike } from "./style";

export type CustomValueColors = Readonly<Record<string, ColorSpec>>;

// Persistent overrides are independent of the protocol's 16 active values. Reject
// oversized maps as a whole rather than silently retaining an arbitrary subset.
const MAX_CUSTOM_VALUE_COLOR_PROPERTIES = 1024;
const MAX_CUSTOM_VALUE_COLOR_STYLE_CODE_UNITS = 4096;
const excludedKeys = new Set(["__proto__", "constructor", "prototype"]);

function isPublisherKey(key: string): boolean {
	return (
		typeof key === "string" &&
		key.length > 0 &&
		key.length <= MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS &&
		!excludedKeys.has(key) &&
		!/[\s\x00-\x20\x7f-\x9f]/.test(key)
	);
}

function isStyle(value: unknown): value is ColorSpec {
	return (
		typeof value === "string" &&
		value.length <= MAX_CUSTOM_VALUE_COLOR_STYLE_CODE_UNITS &&
		isSupportedColorSpec(value)
	);
}

function emptyColors(): Record<string, ColorSpec> {
	return Object.create(null) as Record<string, ColorSpec>;
}

/** Detached sparse data only; accessors and inherited properties never supply styles. */
export function normalizeCustomValueColors(raw: unknown): CustomValueColors {
	const colors = emptyColors();
	try {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Object.freeze(colors);
		const keys = Reflect.ownKeys(raw);
		if (keys.length > MAX_CUSTOM_VALUE_COLOR_PROPERTIES) return Object.freeze(colors);
		for (const key of keys) {
			if (typeof key !== "string" || !isPublisherKey(key)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(raw, key);
			if (descriptor?.enumerable && "value" in descriptor && isStyle(descriptor.value)) {
				colors[key] = descriptor.value;
			}
		}
		return Object.freeze(colors);
	} catch {
		// Failed reflection (e.g. a revoked Proxy) must not leave a partial palette.
		return Object.freeze(emptyColors());
	}
}

/** Resolve by stable publisher ID, never an alias or prototype lookup. Empty is an override. */
export function customValueColor(
	colors: CustomValueColors | undefined,
	key: string,
): ColorSpec | undefined {
	try {
		if (!colors || typeof colors !== "object" || Array.isArray(colors) || !isPublisherKey(key))
			return undefined;
		const descriptor = Object.getOwnPropertyDescriptor(colors, key);
		return descriptor?.enumerable && "value" in descriptor && isStyle(descriptor.value)
			? descriptor.value
			: undefined;
	} catch {
		return undefined;
	}
}

export function renderCustomValue(options: {
	key: string;
	raw: string;
	colors?: CustomValueColors;
	mode: CustomVariableColorMode;
	theme: ThemeLike;
	source: ColorSource;
	fallbackStyle: ColorSpec;
}): string {
	const { key, raw, colors, mode, theme, source, fallbackStyle } = options;
	const override = customValueColor(colors, key);
	// An explicit override replaces all publisher SGR and links, including resets.
	const text = sanitizeCustomVariableText(raw, override === undefined ? mode : "zentui");
	if (!text) return "";
	if (override !== undefined) return renderStyleForSource(theme, source, override, text);
	return mode === "zentui" ? renderStyleForSource(theme, source, fallbackStyle, text) : text;
}
