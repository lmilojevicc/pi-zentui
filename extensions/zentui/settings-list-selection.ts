import type { SettingItem, SettingsList } from "@earendil-works/pi-tui";

/** Synchronize only the unfiltered list created by Zentui's settings panel. */
export function selectOwnedSetting(list: SettingsList, items: SettingItem[], id: string): boolean {
	const index = items.findIndex((item) => item.id === id);
	if (index < 0) return false;
	const publicList = list as SettingsList & { selectItem?: (id: string) => void };
	if (typeof publicList.selectItem === "function") {
		publicList.selectItem(id);
		return true;
	}
	return false;
}
