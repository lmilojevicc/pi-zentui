import type { EventBus } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
	CustomVariables,
	MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS,
	MAX_CUSTOM_VARIABLE_TEXT_CODE_UNITS,
	MAX_CUSTOM_VARIABLES,
	sanitizeCustomVariableText,
	ZENTUI_VARIABLE_CAPABILITY_EVENT,
	ZENTUI_VARIABLE_EVENT,
	ZENTUI_VARIABLE_PROTOCOL_VERSION,
} from "../extensions/zentui/custom-variables";

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

function registry(isActive: (key?: string) => boolean = () => true) {
	const events = eventBus();
	const onChange = vi.fn();
	const variables = new CustomVariables(events, isActive, onChange);
	return { events, onChange, variables };
}

function publish(events: EventBus, key: string, text?: string) {
	events.emit(ZENTUI_VARIABLE_EVENT, { key, text });
}

describe("custom-variable protocol", () => {
	it("reports v1 support and any-consumer or per-key demand without requiring a value", () => {
		let active = false;
		const isActive = vi.fn((key?: string) => active && (key === undefined || key === "pkg:queue"));
		const { events, variables, onChange } = registry(isActive);
		const capability = { supported: false, active: false };
		events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, capability);
		expect(capability).toEqual({ supported: true, active: false, version: 1 });
		expect(isActive).toHaveBeenLastCalledWith(undefined);
		active = true;
		events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, capability);
		expect(capability.active).toBe(true);
		for (const [key, expected] of [
			["pkg:queue", true],
			["pkg:unused", false],
		] as const) {
			const keyed = { supported: false, active: false, key };
			events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, keyed);
			expect(keyed).toEqual({
				supported: true,
				active: expected,
				key,
				version: ZENTUI_VARIABLE_PROTOCOL_VERSION,
			});
			expect(isActive).toHaveBeenLastCalledWith(key);
		}
		expect(variables.snapshot().size).toBe(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("ignores malformed, immutable, or hostile capability probes without running accessors", () => {
		const isActive = vi.fn(() => true);
		const { events } = registry(isActive);
		const getter = vi.fn(() => "pkg:queue");
		const accessor = Object.defineProperty({}, "key", { get: getter });
		const hostile = new Proxy(
			{},
			{
				getOwnPropertyDescriptor: () => {
					throw new Error("bad");
				},
			},
		);
		for (const probe of [
			null,
			undefined,
			[],
			"probe",
			{},
			{ key: 1 },
			{ key: "" },
			{ key: "x".repeat(MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS + 1) },
			accessor,
			hostile,
			Object.freeze({ supported: false, active: false }),
		]) {
			expect(() => events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, probe)).not.toThrow();
		}
		expect(getter).not.toHaveBeenCalled();
		expect(isActive).toHaveBeenCalledTimes(2);
		const setter = vi.fn();
		const probe = Object.defineProperty({}, "supported", { set: setter, configurable: true });
		events.emit(ZENTUI_VARIABLE_CAPABILITY_EVENT, probe);
		expect(setter).not.toHaveBeenCalled();
		expect(probe).toMatchObject({ supported: true, active: true, version: 1 });
	});

	it("stores raw last-update-wins values in deterministic, locale-independent key order", () => {
		const { events, variables, onChange } = registry();
		for (const key of ["z:queue", "a:queue", "A:queue", "@scope/pkg:queue"]) {
			publish(events, key, key);
		}
		const raw = "\x1b[31mqueue\n2\x1b]8;;https://example.com\x07link";
		publish(events, "a:queue", raw);
		expect([...variables.snapshot()]).toEqual([
			["@scope/pkg:queue", "@scope/pkg:queue"],
			["A:queue", "A:queue"],
			["a:queue", raw],
			["z:queue", "z:queue"],
		]);
		expect(onChange).toHaveBeenCalledTimes(5);
		publish(events, "a:queue", raw);
		expect(onChange).toHaveBeenCalledTimes(5);
	});

	it("returns detached snapshots that cannot modify registry state", () => {
		const { events, variables } = registry();
		publish(events, "pkg:key", "one");
		const snapshot = variables.snapshot();
		(snapshot as Map<string, string>).set("pkg:key", "tampered");
		(snapshot as Map<string, string>).set("other", "tampered");
		expect([...variables.snapshot()]).toEqual([["pkg:key", "one"]]);
		publish(events, "pkg:key", "two");
		expect(snapshot.get("pkg:key")).toBe("tampered");
	});

	it("ignores inactive positive updates but accepts inactive removals", () => {
		let active = true;
		const { events, variables, onChange } = registry((key) => active && key !== "unused");
		publish(events, "pkg:a", "one");
		publish(events, "pkg:b", "two");
		publish(events, "unused", "ignored");
		active = false;
		publish(events, "pkg:a", "ignored");
		publish(events, "new", "ignored");
		expect(onChange).toHaveBeenCalledTimes(2);
		publish(events, "pkg:a", "");
		publish(events, "pkg:b");
		publish(events, "absent");
		expect(variables.snapshot().size).toBe(0);
		expect(onChange).toHaveBeenCalledTimes(4);
	});

	it("rejects malformed and over-limit updates without executing publisher functions", () => {
		const { events, variables, onChange } = registry();
		const callback = vi.fn();
		const accessor = Object.defineProperty({ key: "pkg:key" }, "text", { get: callback });
		const hostile = new Proxy(
			{},
			{
				getOwnPropertyDescriptor: () => {
					throw new Error("bad");
				},
			},
		);
		for (const update of [
			null,
			undefined,
			[],
			{},
			"text",
			{ key: 1, text: "x" },
			{ key: "", text: "x" },
			{ key: "x".repeat(MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS + 1), text: "x" },
			{ key: "pkg:key", text: null },
			{ key: "pkg:key", text: 1 },
			{ key: "pkg:key", text: callback },
			{ key: "pkg:key", text: "x".repeat(MAX_CUSTOM_VARIABLE_TEXT_CODE_UNITS + 1) },
			accessor,
			hostile,
		]) {
			expect(() => events.emit(ZENTUI_VARIABLE_EVENT, update)).not.toThrow();
		}
		expect(callback).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		expect(variables.snapshot().size).toBe(0);
	});

	it("accepts exact UTF-16 bounds and rejects one extra code unit", () => {
		const { events, variables, onChange } = registry();
		const key = "😀".repeat(MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS / 2);
		const text = "😀".repeat(MAX_CUSTOM_VARIABLE_TEXT_CODE_UNITS / 2);
		publish(events, key, text);
		publish(events, `${key}x`, text);
		publish(events, key, `${text}x`);
		expect([...variables.snapshot()]).toEqual([[key, text]]);
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("bounds unique keys while permitting updates, removals, and replacement keys at capacity", () => {
		const { events, variables, onChange } = registry();
		for (let index = 0; index < MAX_CUSTOM_VARIABLES; index += 1) {
			publish(events, `pkg:${index}`, `${index}`);
		}
		publish(events, "overflow", "ignored");
		expect(variables.snapshot().size).toBe(MAX_CUSTOM_VARIABLES);
		expect(onChange).toHaveBeenCalledTimes(MAX_CUSTOM_VARIABLES);
		publish(events, "pkg:0", "updated");
		expect(variables.snapshot().get("pkg:0")).toBe("updated");
		publish(events, "pkg:1");
		publish(events, "replacement", "accepted");
		expect(variables.snapshot().size).toBe(MAX_CUSTOM_VARIABLES);
		expect(variables.snapshot().get("replacement")).toBe("accepted");
		expect(onChange).toHaveBeenCalledTimes(MAX_CUSTOM_VARIABLES + 3);
	});

	it("reconciles only inactive keys across independent consumers and notifies once", () => {
		const editor = new Set(["pkg:shared", "pkg:editor"]);
		const footer = new Set(["pkg:shared", "pkg:footer"]);
		const { events, variables, onChange } = registry((key) =>
			key === undefined ? editor.size + footer.size > 0 : editor.has(key) || footer.has(key),
		);
		for (const key of ["pkg:shared", "pkg:editor", "pkg:footer"]) publish(events, key, key);
		editor.clear();
		variables.reconcile();
		expect([...variables.snapshot().keys()]).toEqual(["pkg:footer", "pkg:shared"]);
		expect(onChange).toHaveBeenCalledTimes(4);
		variables.reconcile();
		expect(onChange).toHaveBeenCalledTimes(4);
		footer.clear();
		variables.reconcile();
		expect(variables.snapshot().size).toBe(0);
		expect(onChange).toHaveBeenCalledTimes(5);
		editor.add("pkg:editor");
		expect(variables.snapshot().size).toBe(0);
		publish(events, "pkg:editor", "fresh");
		expect([...variables.snapshot()]).toEqual([["pkg:editor", "fresh"]]);
	});

	it("clears session state once and keeps runtime listeners available for the next session", () => {
		const { events, variables, onChange } = registry();
		variables.clear();
		variables.reconcile();
		expect(onChange).not.toHaveBeenCalled();
		publish(events, "pkg:key", "old session");
		variables.clear();
		variables.clear();
		expect(onChange).toHaveBeenCalledTimes(2);
		expect(variables.snapshot().size).toBe(0);
		publish(events, "pkg:key", "new session");
		expect(variables.snapshot().get("pkg:key")).toBe("new session");
		expect(onChange).toHaveBeenCalledTimes(3);
	});

	it("does not start resources or notify when no event bus is provided", () => {
		const isActive = vi.fn(() => true);
		const onChange = vi.fn();
		const variables = new CustomVariables(undefined, isActive, onChange);
		variables.clear();
		variables.reconcile();
		expect(variables.snapshot().size).toBe(0);
		expect(isActive).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("sanitizeCustomVariableText", () => {
	it("normalizes a single line and strips cursor, title, clipboard, and other terminal controls", () => {
		const raw =
			" \x1b]0;title\x07\x1b]52;c;secret\x07\x1b[2J\x1b[4Hqueue\n\t2\r\f\vitems\x00\x7f\x9f ";
		expect(sanitizeCustomVariableText(raw)).toBe("queue 2 items");
		expect(sanitizeCustomVariableText(raw, "zentui")).toBe("queue 2 items");
	});

	it("preserves safe SGR in Original and closes styles before adjacent content", () => {
		expect(sanitizeCustomVariableText("\x1b[31mqueue 2")).toBe("\x1b[31mqueue 2\x1b[0m");
		expect(sanitizeCustomVariableText("\x1b[38;2;1;2;3mqueue\x1b[0m")).toBe(
			"\x1b[38;2;1;2;3mqueue\x1b[0m",
		);
		expect(sanitizeCustomVariableText("\x1b[1:2mqueue\x1b[m")).toBe("\x1b[1:2mqueue\x1b[m");
		expect(sanitizeCustomVariableText("\x1b[0;31mqueue")).toBe("\x1b[0;31mqueue\x1b[0m");
	});

	it("preserves HTTP(S) OSC8 links, normalizes URLs, and closes unclosed links", () => {
		for (const protocol of ["http", "https"]) {
			expect(
				sanitizeCustomVariableText(`\x1b]8;id=queue;${protocol}://example.com\x1b\\link`),
			).toBe(`\x1b]8;;${protocol}://example.com/\x07link\x1b]8;;\x07`);
		}
		expect(sanitizeCustomVariableText("\x1b[32m\x1b]8;;https://example.com\x07link")).toBe(
			"\x1b[32m\x1b]8;;https://example.com/\x07link\x1b]8;;\x07\x1b[0m",
		);
	});

	it("rejects unsafe or malformed link targets and prevents a preceding link leaking through", () => {
		for (const url of [
			"file:///tmp/a",
			"javascript:alert(1)",
			"data:text/plain,hi",
			"not a url",
			"https://a b",
		]) {
			expect(sanitizeCustomVariableText(`\x1b]8;;${url}\x07text`)).toBe("text");
			expect(
				sanitizeCustomVariableText(`\x1b]8;;https://example.com\x07a\x1b]8;;${url}\x07b`),
			).toBe("\x1b]8;;https://example.com/\x07a\x1b]8;;\x07b");
		}
	});

	it("strips all publisher styling and links in Zentui mode", () => {
		const raw = "\x1b[31m\x1b]8;;https://example.com\x07queue\n2\x1b]8;;\x07\x1b[0m";
		expect(sanitizeCustomVariableText(raw, "zentui")).toBe("queue 2");
	});

	it("drops invisible control-only values and preserves wide glyphs and graphemes", () => {
		for (const raw of [
			"",
			" \n\t ",
			"\x1b[31m\x1b[0m",
			"\x1b]8;;https://example.com\x07\x1b]8;;\x07",
		]) {
			expect(sanitizeCustomVariableText(raw)).toBe("");
		}
		const visible = "界 e\u0301 👩‍💻";
		const sanitized = sanitizeCustomVariableText(`\x1b[35m${visible}`);
		expect(sanitized).toBe(`\x1b[35m${visible}\x1b[0m`);
		expect(visibleWidth(sanitized)).toBe(visibleWidth(visible));
		expect(sanitizeCustomVariableText(sanitized, "zentui")).toBe(visible);
	});
});
