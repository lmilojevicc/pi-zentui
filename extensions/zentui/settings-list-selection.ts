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
	// Pi 0.80.5 has no public selectItem. Its render computes scrolling from
	// selectedIndex. Guard the exact owned, search-disabled, main-list shape;
	// never synthesize input through a possibly different global key manager.
	const own = (key: string) => Object.getOwnPropertyDescriptor(list, key);
	const selection = own("selectedIndex");
	if (
		own("items")?.value !== items ||
		own("filteredItems")?.value !== items ||
		own("searchEnabled")?.value !== false ||
		own("submenuComponent")?.value !== null ||
		!selection?.writable ||
		!Number.isInteger(selection.value) ||
		selection.value < 0 ||
		selection.value >= items.length
	)
		return false;
	Object.defineProperty(list, "selectedIndex", { ...selection, value: index });
	return true;
}
