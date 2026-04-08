import { describe, expect, it } from "vitest";
import { colorize } from "../extensions/zentui/config";

describe("colorize", () => {
	const theme = {
		fg(token: string, text: string) {
			return `<${token}>${text}</${token}>`;
		},
	};

	it("uses theme tokens when provided", () => {
		expect(colorize(theme, "accent", "hello")).toBe("<accent>hello</accent>");
	});

	it("supports hex colors", () => {
		expect(colorize(theme, "#89b4fa", "hello")).toBe("\u001b[38;2;137;180;250mhello\u001b[39m");
	});

	it("falls back to text token for unknown colors", () => {
		expect(colorize(theme, "wat", "hello")).toBe("<text>hello</text>");
	});
});
