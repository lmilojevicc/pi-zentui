import type { ExtensionStatusChoice, ExtensionStatusPlacement, ZentuiConfig } from "./config";

export const extensionStatusChoiceLabels: Record<ExtensionStatusChoice, string> = {
	default: "Default",
	off: "Off",
	left: "Left",
	middle: "Middle",
	right: "Right",
};

function defaultPosition(config: ZentuiConfig): ExtensionStatusPlacement {
	if (config.components.footer.style === "hidden")
		return config.components.extensionStatuses.hidden?.defaultPlacement ?? "left";
	const placement = config.components.footer.styles.starship.extensionStatuses.defaultPlacement;
	// A dormant Starship Off preference does not hide Pi's native status row.
	return config.components.footer.style === "native" && placement === "off" ? "right" : placement;
}

export function extensionStatusDefaultChoice(config: ZentuiConfig): ExtensionStatusPlacement {
	return config.components.extensionStatuses.defaultVisibility === "hide"
		? "off"
		: defaultPosition(config);
}

export function extensionStatusChoice(config: ZentuiConfig, key: string): ExtensionStatusChoice {
	const policy = config.components.extensionStatuses;
	const visibility = Object.hasOwn(policy.visibility, key) ? policy.visibility[key] : undefined;
	if (visibility === "hide") return "off";
	const mode = config.components.footer.style;
	const placements =
		mode === "hidden"
			? policy.hidden?.placements
			: config.components.footer.styles.starship.extensionStatuses.placements;
	let position = placements && Object.hasOwn(placements, key) ? placements[key] : undefined;
	if (mode === "native" && position === "off") position = undefined;
	if (mode === "starship" && position === "off") return "off";
	if (visibility === "show") return position ?? defaultPosition(config);
	// Legacy positions without a Show override still inherit a global Hide.
	if (policy.defaultVisibility === "hide") return "default";
	return position ?? "default";
}
