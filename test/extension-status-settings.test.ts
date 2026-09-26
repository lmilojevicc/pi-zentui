import { describe, expect, it } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import {
	extensionStatusChoice,
	extensionStatusDefaultChoice,
} from "../extensions/zentui/extension-status-settings";

describe("effective extension status settings display", () => {
	it.each(["native", "hidden", "starship"] as const)(
		"resolves inherited positions and global Hide without mutation in %s",
		(style) => {
			for (const position of ["left", "middle", "right"] as const) {
				for (const defaultVisibility of ["show", "hide"] as const) {
					const config = mergeConfig({
						components: {
							footer: {
								style,
								styles: { starship: { extensionStatuses: { defaultPlacement: position } } },
							},
							extensionStatuses: {
								defaultVisibility,
								visibility: { shown: "show", hidden: "hide" },
								hidden: { defaultPlacement: position },
							},
						},
					});
					const before = structuredClone(config);
					const inherited = defaultVisibility === "hide" ? "off" : position;
					expect(extensionStatusDefaultChoice(config)).toBe(inherited);
					expect(extensionStatusChoice(config, "unset")).toBe(inherited);
					expect(extensionStatusChoice(config, "shown")).toBe(position);
					expect(extensionStatusChoice(config, "hidden")).toBe("off");
					expect(config).toEqual(before);
				}
			}
		},
	);

	it.each([
		["native", "right", "right", "left"],
		["hidden", "middle", "right", "middle"],
		["starship", "off", "off", "left"],
	] as const)(
		"keeps dormant Starship Off and per-mode positions bounded in %s",
		(style, inherited, legacyOff, legacyPosition) => {
			const config = mergeConfig({
				components: {
					footer: {
						style,
						styles: {
							starship: {
								extensionStatuses: {
									defaultPlacement: "off",
									placements: { legacyOff: "off", shownOff: "off", legacyPosition: "left" },
								},
							},
						},
					},
					extensionStatuses: {
						visibility: { shownOff: "show", shownPosition: "show" },
						hidden: { defaultPlacement: "middle", placements: { legacyOff: "right" } },
					},
				},
			});
			const before = structuredClone(config);
			expect(extensionStatusDefaultChoice(config)).toBe(inherited);
			expect(extensionStatusChoice(config, "unset")).toBe(inherited);
			expect(extensionStatusChoice(config, "shownOff")).toBe(inherited);
			expect(extensionStatusChoice(config, "legacyOff")).toBe(legacyOff);
			expect(extensionStatusChoice(config, "legacyPosition")).toBe(legacyPosition);
			expect(config).toEqual(before);
			config.components.extensionStatuses.defaultVisibility = "hide";
			expect(extensionStatusDefaultChoice(config)).toBe("off");
			for (const key of ["unset", "legacyOff", "legacyPosition"])
				expect(extensionStatusChoice(config, key)).toBe("off");
			expect(extensionStatusChoice(config, "shownPosition")).toBe(inherited);
		},
	);
});
