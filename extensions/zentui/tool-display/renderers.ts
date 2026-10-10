/* Adapted from pi-tool-display 0.5.0, commit91cef7580078371f8dc49a8607222807ad6a424d.
 * MIT License
 *
 * Copyright (c) 2026 MasuRii
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type BashProgress, createBashProgress } from "./bash-display.js";
import { type CodeHighlighter, safeWidth } from "./diff.js";
import { renderWriteDiffResult } from "./diff-renderer.js";
import type { ToolRenderers } from "./host-contract.js";
import { type PendingPreimages, projectPending } from "./pending.js";
import { PresentationText as Text } from "./presentation-text.js";
import { record } from "./presets.js";
import { sanitizeTerminalControls, shortenPath } from "./render-utils.js";
import * as presentation from "./tool-presentation.js";
import type { CustomToolDisplayConfig, ToolDisplayConfig } from "./types.js";
import {
	countWriteContentLines,
	getWriteContentSizeBytes,
	shouldRenderWriteCallSummary,
} from "./write-display-utils.js";
export type ToolDisplayRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
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
/** Known text/image blocks stay intact for the host image pipeline; unknown shapes fail open. */
export function hasSupportedContent(result: unknown): boolean {
	const content = record(result).content;
	return (
		Array.isArray(content) &&
		content.every((block) => {
			const value = record(block);
			return value.type === "image" || (value.type === "text" && typeof value.text === "string");
		})
	);
}
export interface RendererResources {
	pending?: PendingPreimages;
	highlighter?: CodeHighlighter;
	progress?: BashProgress;
}
function boundedComponent(component: Component, safetyRows: number): Component {
	if (component instanceof Text) component.setSafetyRows(safetyRows);
	return {
		invalidate() {
			component.invalidate();
		},
		render(rawWidth) {
			const width = safeWidth(rawWidth);
			if (!width) return [];
			const rows = component.render(width);
			// Normal upstream rows pass through byte-for-byte; hard output guard is safety-only.
			if (rows.length <= 20_000)
				return rows.map((line) =>
					visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
				);
			return [...rows.slice(0, 20_000), truncateToWidth("… (preview output omitted)", width, "")];
		},
	};
}
export function createToolDisplayRenderers(
	name: string,
	getConfig: () => ToolDisplayConfig,
	resources: RendererResources = {},
	custom?: CustomToolDisplayConfig,
): ToolRenderers {
	const progress = resources.progress ?? createBashProgress();
	const config = (): presentation.PresentationConfig => ({
		...getConfig(),
		showRtkCompactionHints: false,
	});
	const text = (value: string) => new Text(value, 0, 0);
	const pendingCall = (
		summary: string,
		args: unknown,
		ctx: ToolDisplayRenderContext,
		theme: Theme,
	): Component => {
		if ((name !== "edit" && name !== "write") || !ctx.argsComplete || !ctx.isPartial)
			return text(summary);
		const preimage = resources.pending?.get(ctx.toolCallId, name, args, ctx.cwd);
		const projected = projectPending(
			name,
			args,
			preimage ?? { notice: "Preview unavailable: no live preimage." },
		);
		return presentation.buildPendingDiffCallComponent(
			summary,
			{
				filePath: presentation.getToolPathArg(args) ?? "",
				previousContent: projected.content,
				nextContent: projected.nextContent,
				fileExistedBeforeWrite: projected.exists === true,
				headerLabel: projected.label,
				notice: projected.notice,
			},
			ctx,
			config(),
			theme,
		);
	};
	// Theme is supplied by the host at every callback, never taken from another surface/config.
	return {
		renderShell: "default",
		renderCall(args, theme, ctx) {
			const rawInput = record(args);
			const input = Object.fromEntries(
				Object.entries(rawInput).map(([key, value]) => [
					key,
					typeof value === "string" ? sanitizeTerminalControls(value) : value,
				]),
			);
			if (custom) {
				return custom.kind === "mcp"
					? presentation.formatMcpCallLine("mcp", "MCP Proxy", input, theme)
					: presentation.formatGenericToolCallLine(name, args, theme);
			}
			switch (name) {
				case "read":
					return presentation.renderReadDisplayCall(input, theme);
				case "bash":
					return boundedComponent(progress.renderCall(input, theme, ctx), 20000);
				case "grep":
					return presentation.formatSearchCallLine(
						name,
						`/${input.pattern}/`,
						` in ${presentation.getSearchScope(input)}${input.glob ? ` (${input.glob})` : ""}${input.limit !== undefined ? ` limit ${input.limit}` : ""}`,
						theme,
					);
				case "find":
					return presentation.formatSearchCallLine(
						name,
						String(input.pattern ?? ""),
						` in ${presentation.getSearchScope(input)}${input.limit !== undefined ? ` (limit ${input.limit})` : ""}`,
						theme,
					);
				case "ls":
					return presentation.formatSearchCallLine(
						name,
						presentation.getSearchScope(input),
						input.limit !== undefined ? ` (limit ${input.limit})` : "",
						theme,
					);
				case "edit":
					return boundedComponent(
						pendingCall(
							`${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", shortenPath(presentation.getToolPathArg(input)) || "...")}${presentation.formatLineCountSuffix(presentation.getEditLineCount(args), theme)}`,
							args,
							ctx,
							theme,
						),
						20000,
					);
				case "write": {
					const content = presentation.getToolContentArg(args);
					const suffix = shouldRenderWriteCallSummary({
						hasContent: content !== undefined,
						hasDetailedResultHeader: false,
					})
						? presentation.formatWriteCallSuffix(
								countWriteContentLines(content),
								getWriteContentSizeBytes(content),
								theme,
							)
						: "";
					return boundedComponent(
						pendingCall(
							`${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", shortenPath(presentation.getToolPathArg(input)) || "...")}${suffix}`,
							args,
							ctx,
							theme,
						),
						20000,
					);
				}
				default:
					return presentation.formatGenericToolCallLine(name, args, theme);
			}
		},
		renderResult(result, options, theme, ctx) {
			const cfg = config();
			const safe = result; // Full result/image/error identity remains available to host and execution.
			let component: Component;
			if (custom) {
				component = presentation.renderCustomToolResult(
					safe,
					options,
					cfg,
					custom.outputMode ?? (custom.kind === "mcp" ? cfg.mcpOutputMode : "summary"),
					theme,
				);
			} else if (name === "read")
				component = presentation.renderReadDisplayResult(safe, options, cfg, theme);
			else if (name === "bash")
				component = presentation.renderBashDisplayResult(safe, options, theme, ctx, config);
			else if (["grep", "find", "ls"].includes(name))
				component = presentation.renderSearchResult(
					safe,
					options,
					cfg,
					theme,
					name === "grep" ? "match" : name === "find" ? "result" : "entry",
					result.details as never,
					name === "grep" ? "matches" : name === "ls" ? "entries" : undefined,
				);
			else if (name === "edit")
				component = presentation.renderEditDisplayResult(
					safe,
					options,
					theme,
					ctx,
					{ highlighter: resources.highlighter },
					config,
				) as Component;
			else if (name === "write") {
				const content = presentation.getToolContentArg(ctx.args);
				const early = presentation.handleEditOrWriteResult(
					safe,
					options,
					ctx,
					theme,
					countWriteContentLines(content),
					"writing",
					"Write failed.",
				);
				if (early.earlyResult) component = early.earlyResult;
				else {
					const preimage = resources.pending?.get(ctx.toolCallId, "write", ctx.args, ctx.cwd);
					if (preimage?.content === undefined || preimage.notice || typeof content !== "string")
						component = text(theme.fg("muted", "↳ write completed • preimage unavailable"));
					else
						component = renderWriteDiffResult(
							content,
							{
								expanded: options.expanded,
								filePath: presentation.getToolPathArg(ctx.args),
								previousContent: preimage.content,
								fileExistedBeforeWrite: preimage.exists === true,
								highlighter: resources.highlighter,
							},
							cfg,
							theme,
							early.fallbackText,
						);
				}
			} else
				component = presentation.renderCustomToolResult(
					safe,
					options,
					cfg,
					cfg.mcpOutputMode,
					theme,
				);
			return boundedComponent(
				component,
				options.expanded ? cfg.expandedPreviewMaxLines || 20000 : cfg.previewLines + 1,
			);
		},
	};
}
