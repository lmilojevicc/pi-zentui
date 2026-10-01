import type { EventBus } from "@earendil-works/pi-coding-agent";
import {
	sanitizeExtensionStatusOriginalText,
	sanitizeExtensionStatusText,
} from "./extension-status";

export const ZENTUI_VARIABLE_CAPABILITY_EVENT = "zentui:variable-capability";
export const ZENTUI_VARIABLE_EVENT = "zentui:variable";
export const ZENTUI_VARIABLE_PROTOCOL_VERSION = 1;

export const MAX_CUSTOM_VARIABLES = 16;
export const MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS = 64;
export const MAX_CUSTOM_VARIABLE_TEXT_CODE_UNITS = 256;

export type CustomVariableCapability = {
	supported: boolean;
	active: boolean;
	key?: string;
	version?: number;
};

export type CustomVariableUpdate = {
	key: string;
	text?: string;
};

export type CustomVariableColorMode = "original" | "zentui";

function isKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS
	);
}

function eventRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Read data only: publisher getters must not run as part of the protocol. */
function eventField(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (descriptor && !("value" in descriptor)) throw new TypeError("Accessor event field");
	return descriptor?.value;
}

function variableUpdate(value: unknown): CustomVariableUpdate | undefined {
	try {
		const record = eventRecord(value);
		if (!record) return undefined;
		const key = eventField(record, "key");
		const text = eventField(record, "text");
		if (!isKey(key)) return undefined;
		if (
			text !== undefined &&
			(typeof text !== "string" || text.length > MAX_CUSTOM_VARIABLE_TEXT_CODE_UNITS)
		)
			return undefined;
		return { key, text: text as string | undefined };
	} catch {
		return undefined;
	}
}

/** Session-scoped, surface-neutral values; keys are package-qualified by publisher convention. */
export class CustomVariables {
	private readonly values = new Map<string, string>();

	constructor(
		events: EventBus | undefined,
		private readonly isActive: (key?: string) => boolean,
		private readonly onChange: () => void,
	) {
		if (!events) return;
		// Registration lasts for the extension runtime, not an editor factory's lifetime.
		events.on(ZENTUI_VARIABLE_CAPABILITY_EVENT, (value) => {
			try {
				const capability = eventRecord(value);
				if (!capability) return;
				const key = eventField(capability, "key");
				if (key !== undefined && !isKey(key)) return;
				const active = this.isActive(key);
				// Define data properties rather than invoking publisher setters.
				Object.defineProperties(capability, {
					supported: { value: true, writable: true, enumerable: true, configurable: true },
					active: { value: active, writable: true, enumerable: true, configurable: true },
					version: {
						value: ZENTUI_VARIABLE_PROTOCOL_VERSION,
						writable: true,
						enumerable: true,
						configurable: true,
					},
				});
			} catch {
				// Malformed or immutable probes must not break the publisher's event dispatch.
			}
		});
		events.on(ZENTUI_VARIABLE_EVENT, (value) => {
			const update = variableUpdate(value);
			if (!update) return;
			if (update.text === undefined || update.text.length === 0) {
				if (!this.values.delete(update.key)) return;
			} else {
				if (!this.isActive(update.key)) return;
				if (!this.values.has(update.key) && this.values.size >= MAX_CUSTOM_VARIABLES) return;
				if (this.values.get(update.key) === update.text) return;
				this.values.set(update.key, update.text);
			}
			this.onChange();
		});
	}

	/** Detached raw snapshot in locale-independent key order; sanitize only at the consumer. */
	snapshot(): ReadonlyMap<string, string> {
		return new Map(
			[...this.values].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
		);
	}

	clear(): void {
		if (this.values.size === 0) return;
		this.values.clear();
		this.onChange();
	}

	/** Evict only keys no longer demanded by any independently owned consumer. */
	reconcile(): void {
		let changed = false;
		for (const key of this.values.keys()) {
			if (!this.isActive(key)) {
				this.values.delete(key);
				changed = true;
			}
		}
		if (changed) this.onChange();
	}
}

/** A safe single-line value, closing publisher links and styles before adjacent frame content. */
export function sanitizeCustomVariableText(
	value: string,
	colorMode: CustomVariableColorMode = "original",
): string {
	if (colorMode === "zentui") return sanitizeExtensionStatusText(value);
	const text = sanitizeExtensionStatusOriginalText(value);
	let lastSgr: string | undefined;
	for (const match of text.matchAll(/\x1b\[[0-9;:]*m/g)) lastSgr = match[0];
	return lastSgr && lastSgr !== "\x1b[0m" && lastSgr !== "\x1b[m" ? `${text}\x1b[0m` : text;
}
