import { describe, expect, it } from "vitest";
import { defaultConfig, mergeConfig } from "../extensions/zentui/config";
import {
	componentPresets,
	getComponentPreset,
	matchingComponentPreset,
} from "../extensions/zentui/presets";

describe("component presets", () => {
	it("defines exactly the four selection-only maps", () => {
		expect(componentPresets.map(({ id, components }) => ({ id, components }))).toEqual([
			{
				id: "opencode",
				components: {
					editor: { enabled: true, style: "opencode" },
					footer: { style: "starship" },
					userMessages: { enabled: true, style: "framed" },
				},
			},
			{
				id: "opencode-copy-friendly",
				components: {
					editor: { enabled: true, style: "opencode-copy-friendly" },
					footer: { style: "starship" },
					userMessages: { enabled: true, style: "framed-copy-friendly" },
				},
			},
			{
				id: "rail",
				components: {
					editor: { enabled: true, style: "accent-rail" },
					footer: { style: "starship" },
					userMessages: { enabled: true, style: "compact" },
				},
			},
			{
				id: "minimalist",
				components: {
					editor: { enabled: true, style: "minimalist" },
					footer: { style: "hidden" },
					userMessages: { enabled: false },
				},
			},
		]);
	});

	it("leaves defaults unchanged and matching Opencode", () => {
		expect(matchingComponentPreset(defaultConfig)?.id).toBe("opencode");
		expect(matchingComponentPreset(mergeConfig({}))?.id).toBe("opencode");
	});

	it.each(["", "custom", "default", "Opencode", "opencode_copy_friendly", "constructor"])(
		"rejects unknown ID %s",
		(id) => {
			expect(getComponentPreset(id)).toBeUndefined();
		},
	);

	for (const preset of componentPresets) {
		it(`matches ${preset.id} independent of colors, options, and unrelated components`, () => {
			const config = mergeConfig({ components: preset.components });
			config.colors.cwd = "red";
			config.icons.mode = "ascii";
			config.components.editor.colorSource = "terminal";
			config.components.editor.styles.minimalist.showGit = false;
			config.components.userMessages.colorSource = "terminal";
			config.components.footer.colorSource = "terminal";
			config.components.footer.styles.starship.format = "$cwd";
			config.components.footer.styles.starship.segments.context = false;
			config.components.workingLine.enabled = true;
			config.components.thinkingSteps.enabled = true;
			config.components.selectorBorders.enabled = false;
			expect(matchingComponentPreset(config)?.id).toBe(preset.id);
		});

		for (const owner of ["editor", "footer", "userMessages"] as const) {
			for (const [key, value] of Object.entries(preset.components[owner])) {
				it(`detects ${preset.id} drift in ${owner}.${key} and restores matching after manual repair`, () => {
					const components = structuredClone(preset.components);
					Object.assign(components[owner], {
						[key]:
							typeof value === "boolean"
								? !value
								: owner === "footer"
									? "native"
									: owner === "editor"
										? "minimalist"
										: "labeled",
					});
					if (preset.id === "minimalist" && owner === "editor" && key === "style")
						Object.assign(components.editor, { style: "opencode" });
					expect(matchingComponentPreset(mergeConfig({ components }))).toBeUndefined();
					Object.assign(components[owner], { [key]: value });
					expect(matchingComponentPreset(mergeConfig({ components }))?.id).toBe(preset.id);
				});
			}
		}
	}

	it.each(["editor", "footer", "userMessages"] as const)(
		"does not mistake unsupported active %s styles for defaults",
		(owner) => {
			expect(
				matchingComponentPreset(mergeConfig({ components: { [owner]: { style: "future" } } })),
			).toBeUndefined();
		},
	);

	it("ignores dormant Minimalist message styles, even future styles", () => {
		const preset = getComponentPreset("minimalist");
		for (const style of ["framed", "framed-copy-friendly", "compact", "labeled", "future"]) {
			expect(
				matchingComponentPreset(
					mergeConfig({
						components: { ...preset?.components, userMessages: { enabled: false, style } },
					}),
				)?.id,
			).toBe("minimalist");
		}
	});
});
