import * as host from "@earendil-works/pi-coding-agent";
import type { CodeHighlighter } from "./bounds.js";
import type { ToolRenderers } from "./host-contract.js";
import { BUILTIN_TOOL_NAMES, type BuiltinToolName } from "./types.js";

/** Public factory identities from this host's module mapping; older hosts fail open. */
export function nativeToolRenderers(cwd: string): Partial<Record<BuiltinToolName, ToolRenderers>> {
	const exports = host as unknown as Record<string, unknown>;
	const renderers: Partial<Record<BuiltinToolName, ToolRenderers>> = {};
	for (const name of BUILTIN_TOOL_NAMES) {
		const factory = exports[`create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`];
		if (typeof factory !== "function") continue;
		try {
			renderers[name] = factory(cwd) as ToolRenderers;
		} catch {
			// Construction is a no-execution probe, never a compatibility execution wrapper.
		}
	}
	return renderers;
}

/** Public highlightCode and real tool callbacks share Pi's active theme; never mutate it. */
export const bashCommandHighlighter: ((text: string) => string[]) | undefined =
	typeof host.highlightCode === "function" ? (text) => host.highlightCode(text, "bash") : undefined;

export const toolDisplayHighlighter: CodeHighlighter | undefined =
	typeof host.highlightCode === "function" && typeof host.getLanguageFromPath === "function"
		? (text, path) => {
				const language = path ? host.getLanguageFromPath(path) : undefined;
				return language ? (host.highlightCode(text, language)[0] ?? text) : text;
			}
		: undefined;
