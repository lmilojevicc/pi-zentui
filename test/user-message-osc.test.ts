import { describe, expect, it } from "vitest";
import {
	isValidUserMessageOsc8Payload,
	sanitizeRenderedUserMessageLines,
	sanitizeRenderedUserMessageText,
	sanitizeSgrOnlySourceText,
	sanitizeUserMessageSourceText,
} from "../extensions/zentui/user-message-osc";

const safeTerminators = ["\x07", "\x1b\\"];

describe("sanitizeUserMessageSourceText", () => {
	it.each(safeTerminators)("strips structurally valid 7-bit OSC 8 controls (%j)", (end) => {
		const open = `\x1b]8;id=docs;https://example.test/a${end}`;
		const close = `\x1b]8;;${end}`;
		expect(sanitizeUserMessageSourceText(`before ${open}link${close} after`)).toBe(
			"before link after",
		);
	});

	it("strips a balanced link spanning source rows while preserving text", () => {
		const open = "\x1b]8;;https://example.test\x07";
		const close = "\x1b]8;;\x07";
		expect(sanitizeUserMessageSourceText(`${open}first\nsecond${close}`)).toBe("first\nsecond");
	});

	it.each([
		["unmatched open", "\x1b]8;;https://example.test\x07before link after", "before link after"],
		["stray close", "before\x1b]8;;\x07 after", "before after"],
		[
			"nested open",
			"\x1b]8;;https://first.test\x07first \x1b]8;;https://second.test\x07second\x1b]8;;\x07",
			"first second",
		],
	] as const)(
		"strips every OSC 8 control for an unbalanced %s stream",
		(_name, source, visible) => {
			const output = sanitizeUserMessageSourceText(source);
			expect(output).toBe(visible);
			expect(output).not.toContain("\x1b]8;");
		},
	);

	it.each([
		["C1 introducer and terminator", "\x9d", "\x9c"],
		["C1 introducer with BEL", "\x9d", "\x07"],
		["7-bit introducer with C1 terminator", "\x1b]", "\x9c"],
	] as const)("strips unsupported %s OSC 8 controls", (_name, start, end) => {
		const open = `${start}8;;https://example.test${end}`;
		const close = `${start}8;;${end}`;
		expect(sanitizeUserMessageSourceText(`before ${open}link${close} after`)).toBe(
			"before link after",
		);
	});

	it.each(["0;title", "2;title", "52;c;c2VjcmV0", "133;A", "9;text", "hello"])(
		"removes complete non-OSC-8 command %j and its payload",
		(payload) => {
			expect(sanitizeUserMessageSourceText(`before\x1b]${payload}\x07after`)).toBe("beforeafter");
			expect(sanitizeUserMessageSourceText(`before\x9d${payload}\x9cafter`)).toBe("beforeafter");
		},
	);

	it.each([
		"8",
		"8;params",
		"88;;https://example.test",
		"8;badparam;https://example.test",
		"8;bad key=value;https://example.test",
		"8;;https://example.test/has space",
		"8;id=x;",
	])("removes malformed OSC 8 payload %j", (payload) => {
		expect(sanitizeUserMessageSourceText(`left\x1b]${payload}\x07right`)).toBe("leftright");
	});

	it("neutralizes unterminated and nested OSC without consuming later visible text", () => {
		expect(sanitizeUserMessageSourceText("left\x1b]133;A;visible")).toBe("leftvisible");
		expect(
			sanitizeUserMessageSourceText("left\x1b]2;title\x1b]8;;https://safe.test\x07right"),
		).toBe("left2;titleright");
	});

	it.each([
		["7-bit CSI", "a\x1b[2Jb", "ab"],
		["C1 CSI", "a\x9b2Jb", "ab"],
		["7-bit DCS", "a\x1bPpayload\x1b\\b", "ab"],
		["C1 DCS", "a\x90payload\x9cb", "ab"],
		["7-bit SOS", "a\x1bXpayload\x1b\\b", "ab"],
		["C1 SOS", "a\x98payload\x9cb", "ab"],
		["7-bit PM", "a\x1b^payload\x1b\\b", "ab"],
		["C1 PM", "a\x9epayload\x9cb", "ab"],
		["7-bit APC", "a\x1b_payload\x1b\\b", "ab"],
		["C1 APC", "a\x9fpayload\x9cb", "ab"],
		["BEL", "a\x07b", "ab"],
		["C0", "a\x01b", "ab"],
		["DEL", "a\x7fb", "ab"],
		["standalone C1", "a\x85b", "ab"],
		["generic escape", "a\x1b(0b", "ab"],
	] as const)("removes %s terminal controls", (_name, source, expected) => {
		expect(sanitizeUserMessageSourceText(source)).toBe(expected);
	});

	it("preserves Markdown-safe structural whitespace", () => {
		expect(sanitizeUserMessageSourceText("a\tb\nc")).toBe("a\tb\nc");
	});

	it("strips many raw links in one linear source pass", () => {
		const open = "\x1b]8;;https://example.test\x07";
		const close = "\x1b]8;;\x07";
		const source = Array.from({ length: 20_000 }, (_, index) => `${open}${index}${close}`).join(
			" ",
		);
		const expected = Array.from({ length: 20_000 }, (_, index) => String(index)).join(" ");
		expect(sanitizeUserMessageSourceText(source)).toBe(expected);
	});
});

describe("sanitizeSgrOnlySourceText", () => {
	it.each([
		["empty", "", ""],
		["standard", "before\x1b[31;1mred\x1b[0m after", "beforered after"],
		["256 color", "\x1b[38;5;202mvalue\x1b[39m", "value"],
		["colon parameters", "\x1b[38:2::137:180:250mvalue\x1b[m", "value"],
		[
			"observed truecolor sequences",
			"\x1b[38;2;137;180;250mfirst\x1b[39m \x1b[38;2;186;194;222msecond\x1b[39m",
			"first second",
		],
	] as const)("strips strict 7-bit CSI SGR for %s", (_name, source, expected) => {
		expect(sanitizeSgrOnlySourceText(source)).toBe(expected);
	});

	it("preserves source whitespace exactly", () => {
		expect(sanitizeSgrOnlySourceText("\t\x1b[1m first  \nsecond\t\x1b[22m\n")).toBe(
			"\t first  \nsecond\t\n",
		);
	});

	it.each([
		["cursor", "value\x1b[2A"],
		["erase", "value\x1b[2J"],
		["OSC", "\x1b]0;title\x07value"],
		["OSC 8", "\x1b]8;;https://example.test\x07link\x1b]8;;\x07"],
		["7-bit DCS", "\x1bPpayload\x1b\\"],
		["7-bit SOS", "\x1bXpayload\x1b\\"],
		["7-bit PM", "\x1b^payload\x1b\\"],
		["7-bit APC", "\x1b_payload\x1b\\"],
		["generic escape", "\x1b(0value"],
		["BEL", "a\x07b"],
		["NUL", "a\x00b"],
		["form feed", "a\x0cb"],
		["DEL", "a\x7fb"],
		["C1", "a\x85b"],
		["8-bit CSI", "a\x9b31mb"],
		["8-bit DCS", "a\x90payload\x9cb"],
		["8-bit SOS", "a\x98payload\x9cb"],
		["8-bit PM", "a\x9epayload\x9cb"],
		["8-bit APC", "a\x9fpayload\x9cb"],
	] as const)("rejects %s controls mixed with safe SGR", (_name, source) => {
		expect(sanitizeSgrOnlySourceText(`\x1b[1m${source}\x1b[0m`)).toBeUndefined();
	});

	it.each([
		["incomplete", "\x1b[38;2;137;180;250"],
		["private", "\x1b[?25m"],
		["intermediate", "\x1b[1 m"],
		["invalid parameter", "\x1b[31.1m"],
		["non-SGR CSI", "\x1b[31H"],
		["cancelled", "\x1b[31\x18m"],
	] as const)("rejects %s SGR-like input", (_name, source) => {
		expect(sanitizeSgrOnlySourceText(source)).toBeUndefined();
	});
});

describe("sanitizeRenderedUserMessageText", () => {
	it("preserves only SGR and structurally valid 7-bit OSC 8", () => {
		const sgr = "\x1b[38;5;202mstyled\x1b[0m";
		const open = "\x1b]8;;https://safe.example\x1b\\";
		const close = "\x1b]8;;\x1b\\";
		const source = `before ${sgr} ${open}link${close} \x1b]52;c;CLIP\x07\x1b[2J\x1bPSECRET\x1b\\\x07 after`;
		const sanitized = sanitizeRenderedUserMessageText(source);
		expect(sanitized).toContain(sgr);
		expect(sanitized).toContain(`${open}link${close}`);
		expect(sanitized).toContain("before");
		expect(sanitized).toContain("after");
		expect(sanitized).not.toContain("CLIP");
		expect(sanitized).not.toContain("SECRET");
		expect(sanitized).not.toContain("\x1b[2J");
		expect(sanitized).not.toContain("\x07 after");
	});

	it("balances predecessor hyperlinks across rendered rows", () => {
		const open = "\x1b]8;;https://safe.example\x07";
		const close = "\x1b]8;;\x07";
		const sgr = "\x1b[31mred\x1b[0m";
		expect(sanitizeRenderedUserMessageLines([`${open}first`, `second${close} ${sgr}`])).toEqual([
			`${open}first`,
			`second${close} ${sgr}`,
		]);
		expect(sanitizeRenderedUserMessageLines([`${open}first`, `second ${sgr}`])).toEqual([
			"first",
			`second ${sgr}`,
		]);
		expect(sanitizeRenderedUserMessageLines(["first", `second\x1b]8;;\x07 ${sgr}`])).toEqual([
			"first",
			`second ${sgr}`,
		]);
	});
});

describe("isValidUserMessageOsc8Payload", () => {
	it("accepts parameter entries and custom URI schemes", () => {
		expect(isValidUserMessageOsc8Payload("8;id=x:foo=bar;custom:target")).toBe(true);
	});

	it.each(["8;id=x;bad\nuri", "8;i\x1bd=x;https://x", "8;id=x;https://x\x9c"])(
		"rejects controls in params and URIs",
		(payload) => {
			expect(isValidUserMessageOsc8Payload(payload)).toBe(false);
		},
	);
});
