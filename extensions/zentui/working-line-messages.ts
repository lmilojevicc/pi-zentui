/** The built-in Working-line verb catalog, in display order. */
export const PI_WORKING_LINE_DEFAULT_PHRASES = [
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
] as const;

/** Complete visible messages derived consistently from the built-in verb catalog. */
export const PI_WORKING_LINE_MESSAGES = PI_WORKING_LINE_DEFAULT_PHRASES.map(
	(phrase) => `${phrase}…`,
);
