// Pi 1.1 defaults: no recorded execution duration and one cell of horizontal padding.
// Spread these fields so older supported ToolRenderContext types remain structurally compatible.
export const toolRenderContextDefaults = {
	durationMs: undefined,
	outputPad: 1,
};
