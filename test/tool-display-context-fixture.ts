// Pi 1.1 defaults: no recorded execution duration and one cell of horizontal padding.
// Pi 1.5 adds the host's keybinding hints. Spread these fields so older supported
// ToolRenderContext types remain structurally compatible.
export const toolRenderContextDefaults = {
	durationMs: undefined,
	outputPad: 1,
	keyText: (keybinding: string) => (keybinding === "app.tools.expand" ? "ctrl+o" : ""),
	keyHint: (keybinding: string, description: string) =>
		`${keybinding === "app.tools.expand" ? "ctrl+o" : ""} ${description}`.trim(),
};
