import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** Rendering-only structural contract. Older supported Pi versions export these
 * ToolDefinition slots but not the newer ToolRenderers/ToolRendererResolver aliases.
 * Runtime support still requires capability detection; this is not an API shim.
 */
export type ToolRenderers = Pick<ToolDefinition, "renderCall" | "renderResult" | "renderShell">;
export type ToolRendererResolver = (
	toolName: string,
	next: () => ToolRenderers | undefined,
) => ToolRenderers | undefined;
