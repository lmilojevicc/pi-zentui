import type { EventBus } from "@earendil-works/pi-coding-agent";

export const ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT =
	"zentui:working-line-segment-capability";
export const ZENTUI_WORKING_LINE_SEGMENT_EVENT = "zentui:working-line-segment";

export const MAX_WORKING_LINE_EXTENSION_SEGMENTS = 16;
export const MAX_WORKING_LINE_EXTENSION_KEY_CODE_UNITS = 64;
export const MAX_WORKING_LINE_EXTENSION_TEXT_CODE_UNITS = 256;

export type WorkingLineSegmentCapability = {
	supported: boolean;
	active: boolean;
};

export type WorkingLineSegmentUpdate = {
	key: string;
	text?: string;
};

type EventRecord = Record<string, unknown>;

function eventRecord(value: unknown): EventRecord | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as EventRecord)
		: undefined;
}

function segmentUpdate(value: unknown): WorkingLineSegmentUpdate | undefined {
	const record = eventRecord(value);
	if (!record) return undefined;
	if (
		typeof record.key !== "string" ||
		record.key.length === 0 ||
		record.key.length > MAX_WORKING_LINE_EXTENSION_KEY_CODE_UNITS
	) {
		return undefined;
	}
	if (
		record.text !== undefined &&
		(typeof record.text !== "string" ||
			record.text.length > MAX_WORKING_LINE_EXTENSION_TEXT_CODE_UNITS)
	) {
		return undefined;
	}
	return { key: record.key, text: record.text as string | undefined };
}

/** Collects keyed third-party segments and publishes deterministic snapshots to the Working line. */
export class WorkingLineExtensionSegments {
	private readonly segments = new Map<string, string>();

	constructor(
		events: EventBus | undefined,
		private readonly isActive: () => boolean,
		private readonly onChange: (segments: readonly string[]) => void,
	) {
		if (!events) return;
		events.on(ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT, (value) => {
			const capability = eventRecord(value);
			if (!capability) return;
			capability.supported = true;
			capability.active = this.isActive();
		});
		events.on(ZENTUI_WORKING_LINE_SEGMENT_EVENT, (value) => {
			const update = segmentUpdate(value);
			if (!update) return;
			if (update.text !== undefined && update.text.length > 0 && !this.isActive()) return;
			if (update.text === undefined || update.text.length === 0) {
				if (!this.segments.delete(update.key)) return;
			} else {
				if (
					!this.segments.has(update.key) &&
					this.segments.size >= MAX_WORKING_LINE_EXTENSION_SEGMENTS
				)
					return;
				if (this.segments.get(update.key) === update.text) return;
				this.segments.set(update.key, update.text);
			}
			this.publish();
		});
	}

	clear(): void {
		if (this.segments.size === 0) return;
		this.segments.clear();
		this.publish();
	}

	private publish(): void {
		this.onChange(
			[...this.segments.entries()]
				.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
				.map(([, text]) => text),
		);
	}
}
