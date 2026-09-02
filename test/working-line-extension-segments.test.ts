import type { EventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	MAX_WORKING_LINE_EXTENSION_KEY_CODE_UNITS,
	MAX_WORKING_LINE_EXTENSION_SEGMENTS,
	MAX_WORKING_LINE_EXTENSION_TEXT_CODE_UNITS,
	WorkingLineExtensionSegments,
	ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT,
	ZENTUI_WORKING_LINE_SEGMENT_EVENT,
} from "../extensions/zentui/working-line-extension-segments";

function eventBus(): EventBus {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	return {
		emit(channel, data) {
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
		on(channel, handler) {
			const current = handlers.get(channel) ?? new Set();
			current.add(handler);
			handlers.set(channel, current);
			return () => current.delete(handler);
		},
	};
}

describe("working-line extension segments", () => {
	it("reports support and whether the integration is currently active", () => {
		const events = eventBus();
		let active = false;
		new WorkingLineExtensionSegments(
			events,
			() => active,
			() => {},
		);
		const capability = { supported: false, active: false };
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT, capability);
		expect(capability).toEqual({ supported: true, active: false });
		active = true;
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_CAPABILITY_EVENT, capability);
		expect(capability).toEqual({ supported: true, active: true });
	});

	it("ignores segment values while the Working line is inactive", () => {
		const events = eventBus();
		const onChange = vi.fn();
		new WorkingLineExtensionSegments(events, () => false, onChange);
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "inactive", text: "hidden" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("publishes keyed segments in deterministic order and supports update, removal, and clear", () => {
		const events = eventBus();
		const onChange = vi.fn();
		const segments = new WorkingLineExtensionSegments(events, () => true, onChange);
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "zeta", text: "second" });
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "alpha", text: "first" });
		expect(onChange).toHaveBeenLastCalledWith(["first", "second"]);
		const calls = onChange.mock.calls.length;
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "alpha", text: "first" });
		expect(onChange).toHaveBeenCalledTimes(calls);
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "alpha", text: "updated" });
		expect(onChange).toHaveBeenLastCalledWith(["updated", "second"]);
		events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, { key: "zeta" });
		expect(onChange).toHaveBeenLastCalledWith(["updated"]);
		segments.clear();
		expect(onChange).toHaveBeenLastCalledWith([]);
	});

	it("rejects malformed and over-limit updates and bounds unique keys", () => {
		const events = eventBus();
		const onChange = vi.fn();
		new WorkingLineExtensionSegments(events, () => true, onChange);
		for (const value of [
			null,
			{},
			{ key: "" },
			{ key: "x".repeat(MAX_WORKING_LINE_EXTENSION_KEY_CODE_UNITS + 1), text: "value" },
			{ key: "wrong-text", text: 1 },
			{
				key: "long-text",
				text: "x".repeat(MAX_WORKING_LINE_EXTENSION_TEXT_CODE_UNITS + 1),
			},
		]) {
			events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, value);
		}
		expect(onChange).not.toHaveBeenCalled();
		for (let index = 0; index < MAX_WORKING_LINE_EXTENSION_SEGMENTS + 1; index += 1) {
			events.emit(ZENTUI_WORKING_LINE_SEGMENT_EVENT, {
				key: `segment-${index}`,
				text: `${index}`,
			});
		}
		expect(onChange).toHaveBeenCalledTimes(MAX_WORKING_LINE_EXTENSION_SEGMENTS);
	});
});
