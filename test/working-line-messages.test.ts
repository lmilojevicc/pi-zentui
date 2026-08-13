import { describe, expect, it } from "vitest";
import {
	PI_WORKING_LINE_DEFAULT_PHRASES,
	PI_WORKING_LINE_MESSAGES,
} from "../extensions/zentui/working-line-messages";

const EXPECTED_PHRASES = [
	"Sautéing",
	"Cooking",
	"Ionizing",
	"Zigzagging",
	"Razzle-dazzling",
	"Photosynthesizing",
	"Nucleating",
	"Brewing",
	"Combobulating",
	"Boogieing",
	"Befuddling",
	"Alchemizing",
	"Conjuring",
	"Baking",
	"Simmering",
	"Blanching",
];

describe("Working-line message catalog", () => {
	it("contains exactly the agreed 16 entries in display order", () => {
		expect(PI_WORKING_LINE_DEFAULT_PHRASES).toEqual(EXPECTED_PHRASES);
	});

	it("converts every verb consistently to a complete visible ellipsis message", () => {
		expect(PI_WORKING_LINE_MESSAGES).toEqual(EXPECTED_PHRASES.map((phrase) => `${phrase}…`));
	});
});
