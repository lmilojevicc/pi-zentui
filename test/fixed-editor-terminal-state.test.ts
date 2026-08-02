import { describe, expect, it } from "vitest";
import { OwnedTerminalStateParser } from "./helpers/terminal-state";

const unsafe = () =>
	new OwnedTerminalStateParser({
		buffer: "alternate",
		autowrap: false,
		cursorVisible: false,
		mouse1000: true,
		mouse1002: true,
		mouse1006: true,
		alternateScroll: true,
		scrollRegion: { top: 2, bottom: 9 },
	});

// Literal fixture intentionally independent of production constants.
const reset =
	"\x1b[?2026h\x1b[r\x1b[?1002l\x1b[?1006l\x1b[?1000l\x1b[?1007l\x1b[?7h\x1b[?25h\x1b[?1049l\x1b[?2026l";

describe("owned terminal state parser", () => {
	it("models the canonical teardown from an unsafe state", () => {
		const parser = unsafe();
		parser.feed(reset);
		expect(parser.isSafe()).toBe(true);
	});

	it("is chunk safe and ignores unrelated output", () => {
		const parser = unsafe();
		for (const byte of `noise\x1b[31m${reset}text`) parser.feed(byte);
		expect(parser.isSafe()).toBe(true);
	});

	it.each([
		["scroll region", "\x1b[r"],
		["mouse 1002", "\x1b[?1002l"],
		["mouse 1006", "\x1b[?1006l"],
		["mouse 1000", "\x1b[?1000l"],
		["alternate scroll", "\x1b[?1007l"],
		["autowrap", "\x1b[?7h"],
		["cursor", "\x1b[?25h"],
		["alternate buffer", "\x1b[?1049l"],
	])("remains unsafe when %s restoration is omitted", (_name, operation) => {
		const parser = unsafe();
		parser.feed(reset.replace(operation, ""));
		expect(parser.isSafe()).toBe(false);
	});

	it("records restricted and full scroll regions", () => {
		const parser = new OwnedTerminalStateParser();
		parser.feed("\x1b[2;10r");
		expect(parser.state.scrollRegion).toEqual({ top: 2, bottom: 10 });
		parser.feed("\x1b[r");
		expect(parser.state.scrollRegion).toBe("full");
	});
});
