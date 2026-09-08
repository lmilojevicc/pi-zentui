import {
	type Keybinding,
	type KeyId,
	matchesKey,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// Injected managers on older hosts may not expose namespaced TUI actions.
type SettingsKeybindings = {
	getKeys?(action: Keybinding): string[];
	getDefinition?(action: Keybinding): unknown;
};
const actions = {
	up: ["tui.select.up", "selectUp", "up"],
	down: ["tui.select.down", "selectDown", "down"],
	confirm: ["tui.select.confirm", "selectConfirm", "enter"],
	cancel: ["tui.select.cancel", "selectCancel", "escape"],
} as const;
export function settingsKeys(manager: SettingsKeybindings) {
	const keys = (action: keyof typeof actions): string[] => {
		const [id, legacy, fallback] = actions[action];
		if (typeof manager.getKeys === "function") {
			const current = manager.getKeys(id);
			if (current.length || manager.getDefinition?.(id)) return current;
			const old = manager.getKeys(legacy as Keybinding);
			if (old.length) return old;
		}
		return [fallback];
	};
	return {
		matches(data: string, action: keyof typeof actions) {
			return keys(action).some((key) => matchesKey(data, key as KeyId));
		},
		help(width: number, cancelLabel: "Close" | "Back" = "Close"): string[] {
			const spaceChanges = !(["up", "down", "cancel"] as const).some((action) =>
				keys(action).some((key) => matchesKey(" ", key as KeyId)),
			);
			const label = (action: keyof typeof actions) =>
				keys(action)[0] ?? (action === "confirm" && spaceChanges ? "Space" : "unbound");
			const core = [
				`${label("confirm")} Change`,
				"Tab Sections",
				`${label("cancel")} ${cancelLabel}`,
			];
			const change = `${label("confirm")}${spaceChanges ? "/Space" : ""} Change`;
			const full = `${label("up")}/${label("down")} Navigate · ${change} · Tab/Shift+Tab Sections · ${label("cancel")} ${cancelLabel}`;
			if (visibleWidth(full) <= width) return [full];
			const rows: string[] = [];
			for (const hint of core) {
				const previous = rows.at(-1);
				if (previous && visibleWidth(`${previous} · ${hint}`) <= width)
					rows[rows.length - 1] = `${previous} · ${hint}`;
				else rows.push(...wrapTextWithAnsi(hint, Math.max(1, width)));
			}
			return rows;
		},
	};
}
