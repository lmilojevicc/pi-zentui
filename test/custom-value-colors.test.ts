import { describe, expect, it, vi } from "vitest";
import type { ColorSource } from "../extensions/zentui/config";
import {
	type CustomValueColors,
	customValueColor,
	normalizeCustomValueColors,
	renderCustomValue,
} from "../extensions/zentui/custom-value-colors";
import { normalizeTemplateVariables } from "../extensions/zentui/custom-variable-format";
import { sanitizeCustomVariableText } from "../extensions/zentui/custom-variables";
import { renderStyleForSource, type ThemeLike } from "../extensions/zentui/style";

const key = "vendor.package/value";
const theme: ThemeLike = {
	fg: (color, text) => {
		const codes: Record<string, number> = { accent: 36, syntaxKeyword: 35, success: 32 };
		if (!Object.hasOwn(codes, color)) throw new Error(`Unexpected theme token: ${color}`);
		return `\x1b[${codes[color]}m${text}\x1b[0m`;
	},
	bold: (text) => `\x1b[1m${text}\x1b[0m`,
	italic: (text) => `\x1b[3m${text}\x1b[0m`,
	underline: (text) => `\x1b[4m${text}\x1b[0m`,
};

function render(options: Partial<Parameters<typeof renderCustomValue>[0]> = {}): string {
	return renderCustomValue({
		key,
		raw: "\x1b[31mqueue\x1b[0m",
		mode: "original",
		theme,
		source: "terminal",
		fallbackStyle: "bold blue",
		...options,
	});
}

function unchecked(raw: unknown): CustomValueColors {
	return raw as CustomValueColors;
}

describe("normalizeCustomValueColors", () => {
	it("retains sparse valid styles verbatim, including deliberate empty and whitespace", () => {
		const raw = {
			[key]: " bold purple ",
			"pkg/empty": "",
			"pkg/whitespace": " \t ",
			"pkg/theme": "syntaxKeyword",
			"pkg/hex": "#abc",
			"pkg/index": "202",
			"pkg/background": "italic fg:202 bg:#bf5700",
		};
		const normalized = normalizeCustomValueColors(raw);
		expect(normalized).toEqual(raw);
		expect(Object.getPrototypeOf(normalized)).toBeNull();
		expect(Object.isFrozen(normalized)).toBe(true);
		raw[key] = "red";
		expect(customValueColor(normalized, key)).toBe(" bold purple ");
	});

	it.each([null, undefined, false, 3, "red", [], ["red"], () => "red"])(
		"ignores non-record input %s",
		(raw) => {
			expect(normalizeCustomValueColors(raw)).toEqual({});
		},
	);

	it("ignores invalid specs without coercing or invoking their functions", () => {
		const callback = vi.fn(() => "red");
		const raw = {
			good: "red",
			unknown: "not-a-style",
			partial: "bold nope",
			ansi: "\x1b[31m",
			index: "fg:256",
			hex: "#abcd",
			control: "red\x00",
			number: 31,
			object: { toString: callback },
			function: callback,
			missing: undefined,
			nil: null,
		};
		expect(normalizeCustomValueColors(raw)).toEqual({ good: "red" });
		expect(callback).not.toHaveBeenCalled();
	});

	it("accepts publisher punctuation and exact UTF-16 bounds, not alias-name rules", () => {
		const maxAscii = "a".repeat(64);
		const maxUnicode = "😀".repeat(32);
		const raw = Object.fromEntries(
			[key, "@scope/pkg:value-1.2", "__proto__/value", "toString", maxAscii, maxUnicode].map(
				(name) => [name, "green"],
			),
		);
		expect(normalizeCustomValueColors(raw)).toEqual(raw);
		for (const invalid of [
			"",
			`${maxAscii}a`,
			`${maxUnicode}a`,
			"has space",
			"has\tgap",
			"has\ngap",
			"a\u00a0b",
			"a\x00b",
			"a\x1fb",
			"a\x7fb",
			"a\x9fb",
		]) {
			expect(normalizeCustomValueColors({ [invalid]: "red" })).toEqual({});
			expect(customValueColor(unchecked({ [invalid]: "red" }), invalid)).toBeUndefined();
		}
	});

	it("rejects prototype-control names and ignores inherited, hidden, symbol and accessor entries", () => {
		const getter = vi.fn(() => "red");
		const setter = vi.fn();
		const inheritedGetter = vi.fn(() => "green");
		const prototype = Object.defineProperty({ inherited: "red" }, "inheritedGetter", {
			get: inheritedGetter,
			enumerable: true,
		});
		const raw = Object.create(prototype);
		Object.defineProperties(raw, {
			[key]: { value: "blue", enumerable: true },
			hidden: { value: "red" },
			accessor: { get: getter, enumerable: true },
			setter: { set: setter, enumerable: true },
			["__proto__"]: { get: getter, enumerable: true },
			constructor: { get: getter, enumerable: true },
			prototype: { get: getter, enumerable: true },
		});
		raw[Symbol("color")] = "purple";
		expect(normalizeCustomValueColors(raw)).toEqual({ [key]: "blue" });
		for (const name of [
			"inherited",
			"inheritedGetter",
			"hidden",
			"accessor",
			"setter",
			"__proto__",
			"constructor",
			"prototype",
		]) {
			expect(customValueColor(raw, name)).toBeUndefined();
		}
		expect(getter).not.toHaveBeenCalled();
		expect(setter).not.toHaveBeenCalled();
		expect(inheritedGetter).not.toHaveBeenCalled();
		const forbiddenData = JSON.parse(
			'{"__proto__":"red","constructor":"green","prototype":"blue"}',
		);
		expect(normalizeCustomValueColors(forbiddenData)).toEqual({});
		for (const name of Object.keys(forbiddenData))
			expect(customValueColor(forbiddenData, name)).toBeUndefined();
	});

	it("bounds persistent overrides independently of active protocol capacity, without partial truncation", () => {
		const raw = Object.fromEntries(
			Array.from({ length: 1024 }, (_, index) => [`pkg/${index}`, "red"]),
		);
		expect(Object.keys(normalizeCustomValueColors(raw))).toHaveLength(1024);
		raw.overflow = "green";
		expect(normalizeCustomValueColors(raw)).toEqual({});
		const hiddenProperties = Object.create(null);
		for (let index = 0; index < 1025; index++)
			Object.defineProperty(hiddenProperties, `hidden/${index}`, { value: "red" });
		expect(normalizeCustomValueColors(hiddenProperties)).toEqual({});
	});

	it("bounds style-validation input at 4096 code units", () => {
		const atLimit = `red${" ".repeat(4093)}`;
		const tooLong = `${atLimit} `;
		expect(normalizeCustomValueColors({ [key]: atLimit })).toEqual({ [key]: atLimit });
		expect(customValueColor(unchecked({ [key]: atLimit }), key)).toBe(atLimit);
		expect(normalizeCustomValueColors({ [key]: tooLong })).toEqual({});
		expect(customValueColor(unchecked({ [key]: tooLong }), key)).toBeUndefined();
	});

	it("fails quiet on reflection errors and never returns a partial map", () => {
		const ownKeysFailure = new Proxy(
			{},
			{
				ownKeys: () => {
					throw new Error("bad keys");
				},
			},
		);
		const descriptorFailure = new Proxy(
			{ good: "red", bad: "green" },
			{
				getOwnPropertyDescriptor: (target, name) => {
					if (name === "bad") throw new Error("bad descriptor");
					return Object.getOwnPropertyDescriptor(target, name);
				},
			},
		);
		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		for (const raw of [ownKeysFailure, descriptorFailure, revoked.proxy])
			expect(normalizeCustomValueColors(raw)).toEqual({});
		expect(customValueColor(unchecked(descriptorFailure), "bad")).toBeUndefined();
		expect(customValueColor(unchecked(revoked.proxy), key)).toBeUndefined();
	});
});

describe("customValueColor", () => {
	it("distinguishes absent or invalid inheritance from explicit unstyled overrides", () => {
		for (const raw of [undefined, null, [], { [key]: "invalid" }, { [key]: 3 }, { other: "red" }])
			expect(customValueColor(unchecked(raw), key)).toBeUndefined();
		expect(customValueColor(normalizeCustomValueColors({ [key]: "" }), key)).toBe("");
		expect(customValueColor(normalizeCustomValueColors({ [key]: " \t " }), key)).toBe(" \t ");
		expect(customValueColor(normalizeCustomValueColors({ [key]: "blue" }), key)).toBe("blue");
	});

	it("does not use ordinary prototype indexing or read map accessors", () => {
		const get = vi.fn(() => "red");
		const raw = new Proxy({ [key]: "blue" }, { get });
		expect(customValueColor(raw, key)).toBe("blue");
		expect(customValueColor(normalizeCustomValueColors({}), "toString")).toBeUndefined();
		expect(get).not.toHaveBeenCalled();
	});
});

describe("renderCustomValue", () => {
	it.each([
		"\x1b[31mqueue\x1b[0m",
		"\x1b[1:2mqueue\x1b[m",
		"\x1b[38;2;1;2;3mqueue",
		"\x1b[31ma\x1b[0m\x1b[32mb",
		"\x1b]8;id=queue;https://example.com\x1b\\link",
		" \x1b]0;title\x07\x1b]52;c;secret\x07\x1b[2Jqueue\n\t2\x00 ",
		"界 e\u0301 👩‍💻",
	])("preserves legacy Original sanitizer bytes without an override: %s", (raw) => {
		const expected = sanitizeCustomVariableText(raw, "original");
		for (const source of ["terminal", "theme"] as const) {
			expect(render({ raw, source })).toBe(expected);
			expect(render({ raw, source, colors: normalizeCustomValueColors({ other: "red" }) })).toBe(
				expected,
			);
			expect(render({ raw, source, colors: unchecked({ [key]: "bad style" }) })).toBe(expected);
		}
	});

	it.each<ColorSource>(["terminal", "theme"])(
		"retains the exact legacy Zentui fallback with %s source",
		(source) => {
			const raw = "\x1b[31m\x1b]8;;https://example.com\x07queue\n2\x1b[0m";
			const text = sanitizeCustomVariableText(raw, "zentui");
			const expected = renderStyleForSource(theme, source, "bold blue", text);
			expect(render({ raw, mode: "zentui", source })).toBe(expected);
			expect(render({ raw, mode: "zentui", source, colors: unchecked({ [key]: "bad" }) })).toBe(
				expected,
			);
			expect(render({ raw, mode: "zentui", source, fallbackStyle: "" })).toBe(text);
		},
	);

	it("explicit foreground and modifiers replace nested publisher SGR, resets and links", () => {
		const colors = normalizeCustomValueColors({ [key]: "bold underline fg:202 bg:blue" });
		const raw = "\x1b[31m\x1b]8;;https://example.com\x07queue\x1b[0m\x1b[32m 2\x1b[39m";
		for (const mode of ["original", "zentui"] as const) {
			for (const source of ["terminal", "theme"] as const) {
				expect(render({ raw, colors, mode, source })).toBe("\x1b[1;4;38;5;202;44mqueue 2\x1b[0m");
			}
		}
	});

	it.each(["", " \t "])(
		"empty override %j is unstyled, while Reset resumes legacy mode",
		(style) => {
			const colors = normalizeCustomValueColors({ [key]: style });
			const raw = "\x1b[31m\x1b]8;;https://example.com\x07queue\x1b[0m";
			for (const mode of ["original", "zentui"] as const) {
				for (const source of ["terminal", "theme"] as const)
					expect(render({ raw, colors, mode, source })).toBe("queue");
				const reset = { [key]: style };
				delete (reset as Partial<typeof reset>)[key];
				expect(render({ raw, mode, colors: normalizeCustomValueColors(reset) })).toBe(
					render({ raw, mode }),
				);
			}
		},
	);

	it.each<ColorSource>(["terminal", "theme"])(
		"uses theme tokens, terminal styles and modifiers through the existing %s renderer",
		(source) => {
			for (const style of [
				"accent",
				"syntaxKeyword",
				"green",
				"bold purple",
				"italic underline",
				"#abc",
				"202",
				"fg:202 bg:#bf5700",
			]) {
				const colors = normalizeCustomValueColors({ [key]: style });
				expect(render({ source, colors })).toBe(
					renderStyleForSource(theme, source, style, "queue"),
				);
			}
		},
	);

	it("keeps all aliases and extension references to a publisher consistent within an owner", () => {
		const aliases = normalizeTemplateVariables({ queue: key, pending: key }, []);
		const colors = normalizeCustomValueColors({ [key]: "cyan", queue: "red" });
		const published = new Map([[key, "\x1b[31mqueue\x1b[0m"]]);
		const aliasValues = Object.values(aliases).map((publisherKey) =>
			render({
				key: publisherKey,
				raw: published.get(publisherKey) ?? "",
				colors,
			}),
		);
		const extensionValues = [...published].map(([publisherKey, raw]) =>
			render({ key: publisherKey, raw, colors }),
		);
		expect(aliasValues).toEqual(["\x1b[36mqueue\x1b[0m", "\x1b[36mqueue\x1b[0m"]);
		expect(extensionValues).toEqual([aliasValues[0]]);
		expect(render({ colors: normalizeCustomValueColors({ queue: "cyan" }) })).toBe(render());
	});

	it("keeps owner maps independent across styles and has no shared default palette", () => {
		const editor = normalizeCustomValueColors({ [key]: "blue" });
		const footer = normalizeCustomValueColors({ [key]: "green" });
		expect(render({ colors: editor })).toBe("\x1b[34mqueue\x1b[0m");
		expect(render({ colors: footer })).toBe("\x1b[32mqueue\x1b[0m");
		expect(render({ colors: normalizeCustomValueColors({}) })).toBe("\x1b[31mqueue\x1b[0m");
		expect(customValueColor(editor, key)).toBe("blue");
	});

	it("does not execute accessor overrides, and invalid overrides inherit Original or Zentui", () => {
		const get = vi.fn(() => "green");
		const colors = Object.defineProperty({}, key, { enumerable: true, get });
		for (const mode of ["original", "zentui"] as const) {
			expect(render({ mode, colors })).toBe(render({ mode }));
			expect(render({ mode, colors: unchecked({ [key]: "fg:999" }) })).toBe(render({ mode }));
		}
		expect(get).not.toHaveBeenCalled();
	});

	it("strips terminal controls and normalizes one line without interpreting template-like content", () => {
		const raw =
			"\x1b]0;title\x07\x1b]52;c;secret\x07\x1b[2J\x1b[4H\x1b[31m$fill $ci \ue000\n\t界 e\u0301\r\f\v👩‍💻\x00\x7f\x9f";
		expect(render({ raw, colors: normalizeCustomValueColors({ [key]: "" }) })).toBe(
			"$fill $ci \ue000 界 e\u0301 👩‍💻",
		);
	});

	it("closes styling and links before adjacent frame text", () => {
		const raw = "\x1b[31m\x1b]8;;https://example.com\x07queue";
		const adjacent = " | next";
		expect(render({ raw }) + adjacent).toBe(
			"\x1b[31m\x1b]8;;https://example.com/\x07queue\x1b]8;;\x07\x1b[0m | next",
		);
		for (const mode of ["original", "zentui"] as const) {
			expect(
				render({ raw, mode, colors: normalizeCustomValueColors({ [key]: "bold red" }) }) + adjacent,
			).toBe("\x1b[1;31mqueue\x1b[0m | next");
			expect(
				render({
					raw,
					mode,
					source: "theme",
					colors: normalizeCustomValueColors({ [key]: "accent" }),
				}) + adjacent,
			).toBe("\x1b[36mqueue\x1b[0m | next");
		}
	});

	it("does not emit styled control-only or empty values", () => {
		for (const raw of [
			"",
			" \n\t ",
			"\x1b[31m\x1b[0m",
			"\x1b]8;;https://example.com\x07\x1b]8;;\x07",
		]) {
			for (const mode of ["original", "zentui"] as const) {
				expect(render({ raw, mode })).toBe("");
				expect(
					render({ raw, mode, colors: normalizeCustomValueColors({ [key]: "bold red" }) }),
				).toBe("");
			}
		}
	});

	it("retains the existing renderer's safe fallback when a theme token is unavailable", () => {
		const unavailable: ThemeLike = {
			fg: () => {
				throw new Error("missing theme");
			},
		};
		expect(
			render({ theme: unavailable, colors: normalizeCustomValueColors({ [key]: "accent" }) }),
		).toBe("queue");
	});
});
