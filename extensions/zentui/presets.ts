import {
	type EditorComponentConfig,
	type FooterComponentConfig,
	hasUnsupportedComponentStyle,
	type UserMessagesComponentConfig,
	type ZentuiConfig,
} from "./config";

export type PresetId = "opencode" | "opencode-copy-friendly" | "rail" | "minimalist";
export type ComponentPreset = Readonly<{
	id: PresetId;
	label: string;
	components: Readonly<{
		editor: Readonly<Pick<EditorComponentConfig, "enabled" | "style">>;
		footer: Readonly<Pick<FooterComponentConfig, "style">>;
		userMessages: Readonly<
			Pick<UserMessagesComponentConfig, "enabled"> &
				Partial<Pick<UserMessagesComponentConfig, "style">>
		>;
	}>;
}>;

export const componentPresets: readonly ComponentPreset[] = [
	{
		id: "opencode",
		label: "Opencode",
		components: {
			editor: { enabled: true, style: "opencode" },
			footer: { style: "starship" },
			userMessages: { enabled: true, style: "framed" },
		},
	},
	{
		id: "opencode-copy-friendly",
		label: "Opencode (copy-friendly)",
		components: {
			editor: { enabled: true, style: "opencode-copy-friendly" },
			footer: { style: "starship" },
			userMessages: { enabled: true, style: "framed-copy-friendly" },
		},
	},
	{
		id: "rail",
		label: "Rail",
		components: {
			editor: { enabled: true, style: "accent-rail" },
			footer: { style: "starship" },
			userMessages: { enabled: true, style: "compact" },
		},
	},
	{
		id: "minimalist",
		label: "Minimalist",
		components: {
			editor: { enabled: true, style: "minimalist" },
			footer: { style: "hidden" },
			userMessages: { enabled: false },
		},
	},
];

export function getComponentPreset(id: string): ComponentPreset | undefined {
	return componentPresets.find((preset) => preset.id === id);
}

/** Match configured selections, not live ownership or dormant style options. */
export function matchingComponentPreset(config: ZentuiConfig): ComponentPreset | undefined {
	return componentPresets.find(({ components }) =>
		(["editor", "footer", "userMessages"] as const).every((owner) => {
			const selection = components[owner];
			if ("style" in selection && hasUnsupportedComponentStyle(config, owner)) return false;
			return Object.entries(selection).every(
				([key, value]) => config.components[owner][key as keyof typeof selection] === value,
			);
		}),
	);
}
