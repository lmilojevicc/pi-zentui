import { homedir } from "node:os";
import type { Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import {
	boundedContentLines,
	boundedWrap,
	type CodeHighlighter,
	cleanText,
	diffComponent,
	diffContents,
	focusDiffContext,
	parseDiff,
	safeWidth,
} from "./diff.js";
import type { ToolRenderers } from "./host-contract.js";
import { type PendingPreimages, PREIMAGE_MAX_BYTES, projectPending } from "./pending.js";
import { record } from "./presets.js";
import {
	type CustomToolDisplayConfig,
	isBuiltinToolName,
	type ToolDisplayConfig,
} from "./types.js";

export type ToolDisplayRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type ToolRenderContext = ToolDisplayRenderContext;
const RENDER_INPUT_MAX_CHARS = 1024 * 1024;
function string(value: unknown): string {
	return typeof value === "string" ? cleanText(value) : "";
}
function plural(n: number, word: string, many = `${word}s`): string {
	return n === 1 ? word : many;
}
function shortPath(value: unknown): string {
	const path = string(value);
	const home = homedir();
	return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
export function hasOnlyTextContent(result: unknown): boolean {
	const content = record(result).content;
	return (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every(
			(block) => record(block).type === "text" && typeof record(block).text === "string",
		) &&
		content.some((block) => (record(block).text as string).trim())
	);
}
function boundedOutput(result: unknown): { text: string; capped: boolean } {
	const content = record(result).content;
	if (!Array.isArray(content)) return { text: "", capped: false };
	let text = "";
	let bytes = 0;
	let capped = false;
	for (const block of content) {
		const raw = record(block).text;
		if (typeof raw !== "string") continue;
		const separator = text ? "\n" : "";
		const available = RENDER_INPUT_MAX_CHARS - bytes - separator.length;
		if (available <= 0) {
			capped = true;
			break;
		}
		// Buffer.write stops before a split UTF-8 code point and avoids an array of
		// lines or an unbounded encoding allocation for oversized source strings.
		const buffer = Buffer.alloc(Math.min(available, raw.length * 3));
		const written = buffer.write(raw.slice(0, available), "utf8");
		const prefix = buffer.subarray(0, written).toString("utf8");
		capped ||= prefix.length < raw.length;
		text += separator + cleanText(prefix);
		bytes += separator.length + written;
	}
	return { text, capped };
}
function countContentLines(text: string): number {
	if (!text) return 0;
	let count = 0;
	for (let i = 0; i < text.length; i++)
		if (text[i] === "\n" || (text[i] === "\r" && text[i + 1] !== "\n")) count++;
	return count + Number(!/[\r\n]$/.test(text));
}

function textOutput(result: unknown): string {
	return boundedOutput(result).text;
}
function textComponent(
	build: () => string[],
	wrap = true,
	maxRows: () => number = () => 20_000,
	footers: () => string[] = () => [],
): Component {
	return {
		invalidate() {},
		render(rawWidth) {
			const width = safeWidth(rawWidth);
			if (!width) return [];
			const limit = Math.min(20_000, Math.max(1, maxRows()));
			const output: string[] = [];
			let capped = false;
			for (const line of build()) {
				if (output.length >= limit) {
					capped = true;
					break;
				}
				const bounded = boundedWrap(line, width, limit - output.length, wrap);
				for (const row of bounded.lines) output.push(truncateToWidth(row, width, ""));
				capped ||= bounded.capped;
			}
			if (capped) output.push(truncateToWidth("… (preview output omitted)", width, ""));
			for (const footer of footers().slice(0, 4))
				output.push(truncateToWidth(footer.slice(0, 65_536), width, ""));
			return output;
		},
	};
}
function argCount(args: Record<string, unknown>): string {
	const n = Object.keys(args).length;
	return n ? ` (${n} ${plural(n, "arg")})` : " (no args)";
}
function callText(
	name: string,
	args: Record<string, unknown>,
	theme: Theme,
	context: ToolRenderContext,
	custom?: CustomToolDisplayConfig,
): string {
	const title = (text: string) => theme.fg("toolTitle", theme.bold(text));
	const accent = (value: unknown) => theme.fg("accent", string(value) || "...");
	const muted = (text: string) => theme.fg("muted", text);
	const path = shortPath(args.path ?? args.file_path);
	if (custom?.kind === "mcp") {
		const target = args.tool
			? `call ${args.server ? `${string(args.server)}:` : ""}${string(args.tool)}`
			: args.connect
				? `connect ${string(args.connect)}`
				: args.describe
					? `describe ${string(args.describe)}`
					: args.search
						? `search "${string(args.search)}"`
						: args.server
							? `tools ${string(args.server)}`
							: name.replace(/^mcp__(.+?)__(.+)$/, "$1/$2");
		return `${title("MCP")} ${accent(target)}${muted(argCount(args))}`;
	}
	if (custom || !isBuiltinToolName(name))
		return `${title(cleanText(name))}${muted(argCount(args))}`;
	switch (name) {
		case "read": {
			const offset = typeof args.offset === "number" ? args.offset : 1;
			const range =
				args.offset != null || args.limit != null
					? `:${offset}${typeof args.limit === "number" ? `-${offset + args.limit - 1}` : ""}`
					: "";
			return `${title("read")} ${accent(path)}${theme.fg("warning", range)}`;
		}
		case "bash":
			return `${context.executionStarted && context.isPartial ? theme.fg("warning", "⠋ ") : ""}${title("$")} ${accent(args.command)}${args.timeout ? muted(` (timeout ${args.timeout}s)`) : ""}`;
		case "grep":
			return `${title(name)} ${accent(`/${string(args.pattern)}/`)}${muted(` in ${path || "."}${args.glob ? ` (${string(args.glob)})` : ""}${args.limit != null ? ` limit ${args.limit}` : ""}`)}`;
		case "find":
			return `${title(name)} ${accent(args.pattern)}${muted(` in ${path || "."}${args.limit != null ? ` limit ${args.limit}` : ""}`)}`;
		case "ls":
			return `${title(name)} ${accent(path || ".")}${args.limit != null ? muted(` limit ${args.limit}`) : ""}`;
		case "write": {
			const content = typeof args.content === "string" ? args.content : undefined;
			const n = countContentLines(content ?? "");
			const bytes = Buffer.byteLength(content ?? "");
			const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
			return `${title(name)} ${accent(path)}${content === undefined ? "" : muted(` (${n} ${plural(n, "line")} • ${size})`)}`;
		}
		case "edit": {
			const edits = Array.isArray(args.edits) ? args.edits : [args];
			const n = edits.reduce(
				(sum, edit) =>
					sum +
					countContentLines(
						typeof record(edit).newText === "string" ? (record(edit).newText as string) : "",
					),
				0,
			);
			return `${title(name)} ${accent(path)}${muted(` (${n} ${plural(n, "line")})`)}`;
		}
	}
}
function outputLines(text: string, expanded: boolean): string[] {
	const lines = boundedContentLines(text, 20_000).lines;
	while (lines.at(-1)?.trim() === "") lines.pop();
	return expanded
		? lines
		: lines.filter((line, i) => line.trim() || i === 0 || lines[i - 1].trim());
}
function resultHints(result: unknown, config: ToolDisplayConfig, theme: Theme): string[] {
	const details = record(record(result).details);
	const hints: string[] = [];
	if (boundedOutput(result).capped || boundedContentLines(textOutput(result), 20_000).capped)
		hints.push(theme.fg("warning", "Preview capped at 1 MiB; counts cover displayed input only."));
	if (config.showTruncationHints && record(details.truncation).truncated)
		hints.push(theme.fg("warning", "↳ output truncated by backend limits"));
	if (config.showTruncationHints && typeof details.fullOutputPath === "string")
		hints.push(theme.fg("muted", `Full output: ${string(details.fullOutputPath)}`));
	return hints;
}
function resultLines(
	name: string,
	result: unknown,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ToolRenderContext,
	config: ToolDisplayConfig,
	custom?: CustomToolDisplayConfig,
): string[] {
	const lines = outputLines(textOutput(result), options.expanded);
	const isError = context.isError || record(result).isError === true;
	const mode =
		custom?.outputMode ??
		(custom?.kind === "generic"
			? "summary"
			: name === "read"
				? config.readOutputMode
				: name === "bash"
					? config.bashOutputMode
					: ["grep", "find", "ls"].includes(name)
						? config.searchOutputMode
						: config.mcpOutputMode);
	if (options.isPartial && name !== "bash")
		return [
			theme.fg(
				"warning",
				name === "read"
					? "reading..."
					: name === "write"
						? "writing..."
						: name === "edit"
							? "editing..."
							: "running...",
			),
		];
	if (!isError && !options.isPartial && mode === "hidden") return [];

	if (
		!isError &&
		!options.isPartial &&
		!options.expanded &&
		(mode === "summary" || mode === "count")
	) {
		const count =
			name === "read" || name === "bash"
				? outputLines(textOutput(result), true).length
				: lines.filter((line) => line.trim()).length;
		const unit =
			name === "grep"
				? plural(count, "match", "matches")
				: name === "ls"
					? plural(count, "entry", "entries")
					: name === "find"
						? plural(count, "result")
						: plural(count, "line");
		return [
			theme.fg(
				"muted",
				name === "read" ? `↳ loaded ${count} ${unit}` : `↳ ${count} ${unit} returned`,
			),
		];
	}
	const limit = options.expanded
		? Math.min(config.expandedPreviewMaxLines || 20_000, 20_000)
		: name === "bash" && mode === "opencode"
			? config.bashCollapsedLines
			: config.previewLines;
	const shown = lines
		.slice(0, limit)
		.map((line) => theme.fg(isError ? "error" : "toolOutput", line));
	if (isError)
		shown.unshift(
			theme.fg("error", name === "bash" ? "↳ command failed" : `↳ ${cleanText(name)} failed`),
		);
	if (options.isPartial && name === "bash") shown.unshift(theme.fg("warning", "running..."));
	if (lines.length > limit)
		shown.push(
			theme.fg("muted", `… (${lines.length - limit} more ${plural(lines.length - limit, "line")})`),
		);
	return shown;
}
export interface RendererResources {
	pending?: PendingPreimages;
	highlighter?: CodeHighlighter;
}
/** Rendering only: never imports upstream code or invokes/changes tool execution. */
export function createToolDisplayRenderers(
	name: string,
	getConfig: () => ToolDisplayConfig,
	resources: RendererResources = {},
	custom?: CustomToolDisplayConfig,
): ToolRenderers {
	return {
		renderCall(args, theme, context) {
			return {
				invalidate() {},
				render(width) {
					const head = textComponent(
						() => [callText(name, record(args), theme, context, custom)],
						false,
					).render(width);
					if (
						(name !== "write" && name !== "edit") ||
						!context.argsComplete ||
						!context.isPartial ||
						!getConfig().enabled
					)
						return head;
					const preimage = resources.pending?.get(context.toolCallId, name, args, context.cwd);
					const projected = projectPending(
						name,
						args,
						preimage ?? { notice: "Preview unavailable: no live preimage." },
					);
					if (projected.notice || projected.nextContent === undefined)
						return [
							...head,
							...textComponent(() => [
								theme.fg("muted", projected.notice ?? "Preview unavailable."),
							]).render(width),
						];
					return [
						...head,
						...diffComponent(
							focusDiffContext(diffContents(projected.content ?? "", projected.nextContent)),
							getConfig,
							theme,
							context.expanded,
							{
								label: projected.label,
								path: string(record(args).path),
								highlighter: resources.highlighter,
							},
						).render(width),
					];
				},
			};
		},
		renderResult(result, options, theme, context) {
			return {
				invalidate() {},
				render(width) {
					if (!options.isPartial && !context.isError && record(result).isError !== true) {
						const details = record(result.details);
						if (name === "edit" && typeof details.diff === "string")
							return diffComponent(parseDiff(details.diff), getConfig, theme, options.expanded, {
								path: string(record(context.args).path),
								highlighter: resources.highlighter,
							}).render(width);
						if (name === "write") {
							const preimage = resources.pending?.get(
								context.toolCallId,
								"write",
								context.args,
								context.cwd,
							);
							const content = record(context.args).content;
							if (
								preimage?.content !== undefined &&
								!preimage.notice &&
								typeof content === "string" &&
								Buffer.byteLength(content) <= PREIMAGE_MAX_BYTES
							)
								return diffComponent(
									focusDiffContext(diffContents(preimage.content, content)),
									getConfig,
									theme,
									options.expanded,
									{
										label: preimage.exists ? "overwrite" : "create",
										path: string(record(context.args).path),
										highlighter: resources.highlighter,
									},
								).render(width);
							return textComponent(() => [
								theme.fg("muted", "↳ write completed • preimage unavailable"),
							]).render(width);
						}
					}
					return textComponent(
						() => resultLines(name, result, options, theme, context, getConfig(), custom),
						true,
						() => {
							const config = getConfig();
							return (
								1 +
								(options.expanded
									? config.expandedPreviewMaxLines || 20_000
									: name === "bash" && config.bashOutputMode === "opencode"
										? config.bashCollapsedLines
										: config.previewLines)
							);
						},
						() =>
							resultLines(name, result, options, theme, context, getConfig(), custom).length
								? resultHints(result, getConfig(), theme)
								: [],
					).render(width);
				},
			};
		},
	};
}
