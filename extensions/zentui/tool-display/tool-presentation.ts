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
import type {
	BashToolDetails,
	EditToolDetails,
	FindToolDetails,
	GrepToolDetails,
	LsToolDetails,
	ReadToolDetails,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { ANSI_SGR_PATTERN } from "./ansi-utils.js";
import { renderEditDiffResult, renderWriteDiffResult } from "./diff-renderer.js";
import { PresentationText as Text } from "./presentation-text.js";
import { record as toRecord } from "./presets.js";
import {
	compactOutputLines,
	countNonEmptyLines,
	extractTextOutput,
	isLikelyQuietCommand,
	pluralize,
	previewLines,
	sanitizeAnsiForThemedOutput,
	sanitizeTerminalControls,
	shortenPath,
	splitLines,
} from "./render-utils.js";
import type { ToolDisplayConfig as OwnedConfig } from "./types.js";
export type PresentationConfig = OwnedConfig & { showRtkCompactionHints: boolean };
type ToolDisplayConfig = PresentationConfig;
type ConfigGetter = () => ToolDisplayConfig;
interface RenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}
interface RtkCompactionInfo {
	applied: boolean;
	techniques: string[];
	truncated: boolean;
	originalLineCount?: number;
	compactedLineCount?: number;
}
interface ToolRenderContextLike {
	args?: unknown;
	state?: unknown;
	cwd?: string;
	toolCallId?: string;
	argsComplete?: boolean;
	isError?: boolean;
	isPartial?: boolean;
	expanded?: boolean;
}

import { type CodeHighlighter, safeWidth } from "./bounds.js";
import {
	boundedContentMetadata,
	graphemePrefix,
	MAX_PRESENTATION_SOURCE_BYTES,
	MAX_PREVIEW_LINE_CHARS,
	type PresentationMetadata,
} from "./source-bounds.js";

interface ToolDisplayAdapter {
	highlighter?: CodeHighlighter;
	pathFields?: string[];
	getPath?: (args: unknown) => string | undefined;
	getEditLineCount?: (args: unknown) => number;
}
interface PendingDiffPreviewData {
	filePath: string;
	previousContent?: string;
	nextContent?: string;
	fileExistedBeforeWrite: boolean;
	headerLabel: string;
	notice?: string;
}
interface CustomToolOverrideConfig {
	outputMode: "hidden" | "summary" | "preview";
}
const RTK_COMPACTION_LABEL = "compacted by RTK";
function getTextField(args: Record<string, unknown>, field: string): string | undefined {
	const value = args[field];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function formatExpandHint(theme: RenderTheme): string {
	return theme.fg("muted", " • Ctrl+O to expand");
}

function formatTruncationHint(remaining: number, expanded: boolean, theme: RenderTheme): string {
	if (remaining <= 0) {
		return "";
	}
	const hint = expanded ? "" : " • Ctrl+O to expand";
	return `\n${theme.fg("muted", `... (${remaining} more ${pluralize(remaining, "line")}${hint})`)}`;
}

function buildPreviewText(
	lines: string[],
	maxLines: number,
	theme: RenderTheme,
	expanded: boolean,
): string {
	if (lines.length === 0) {
		return theme.fg("muted", "↳ (no output)");
	}

	const { shown, remaining } = previewLines(lines, maxLines);
	let text = shown
		.map((line) => theme.fg("toolOutput", sanitizeAnsiForThemedOutput(line)))
		.join("\n");
	text += formatTruncationHint(remaining, expanded, theme);
	return text;
}

function prepareOutputLines(rawText: string, options: ToolRenderResultOptions): string[] {
	return compactOutputLines(splitLines(rawText), {
		expanded: options.expanded,
		maxCollapsedConsecutiveEmptyLines: 1,
	});
}

function formatBashNoOutputLine(command: string | undefined, theme: RenderTheme): string {
	if (isLikelyQuietCommand(command)) {
		return theme.fg("muted", "↳ command completed (no output)");
	}
	return theme.fg("muted", "↳ (no output)");
}

function truncationHint(details: { truncation?: { truncated?: boolean } } | undefined): string {
	return details?.truncation?.truncated ? " • truncated" : "";
}

function getStringField(value: unknown, field: string): string | undefined {
	const raw = toRecord(value)[field];
	return typeof raw === "string" ? raw : undefined;
}

function getNumericField(value: unknown, field: string): number | undefined {
	const raw = toRecord(value)[field];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function getToolPathArg(value: unknown): string | undefined {
	return getStringField(value, "file_path") ?? getStringField(value, "path");
}

export function getToolContentArg(value: unknown): string | undefined {
	return getStringField(value, "content");
}

function getEditPayloadMetadata(value: unknown): PresentationMetadata {
	const input = toRecord(value);
	if (Array.isArray(input.lines)) {
		let count = 0;
		const limit = Math.min(input.lines.length, 4000);
		for (let i = 0; i < limit; i++) if (typeof input.lines[i] === "string") count++;
		return { lineCount: count, sizeBytes: 0, capped: input.lines.length > limit };
	}
	return boundedContentMetadata(
		typeof input.lines === "string" ? input.lines : input.newText,
		true,
	);
}
export function getEditLineMetadata(value: unknown): PresentationMetadata {
	const input = toRecord(value);
	const edits = Array.isArray(input.edits) && input.edits.length ? input.edits : undefined;
	if (!edits) return getEditPayloadMetadata(value);
	let lineCount = 0;
	let sizeBytes = 0;
	let capped = false;
	for (let i = 0; i < Math.min(edits.length, 4000); i++) {
		const meta = getEditPayloadMetadata(edits[i]);
		lineCount += meta.lineCount;
		sizeBytes += meta.sizeBytes;
		if (meta.capped || lineCount > 4000 || sizeBytes > MAX_PRESENTATION_SOURCE_BYTES) {
			capped = true;
			break;
		}
	}
	return { lineCount, sizeBytes, capped: capped || edits.length > 4000 };
}
export function getEditLineCount(value: unknown): number {
	return getEditLineMetadata(value).lineCount;
}

function isToolError(result: unknown, context?: ToolRenderContextLike): boolean {
	return context?.isError === true || toRecord(result).isError === true;
}

export function buildPendingDiffCallComponent(
	summaryText: string,
	previewData: PendingDiffPreviewData | undefined,
	context: ToolRenderContextLike | undefined,
	config: ToolDisplayConfig,
	theme: RenderTheme,
): Text | Container {
	if (!context?.isPartial || !previewData) {
		return textResult(summaryText);
	}

	const container = new Container();
	container.addChild(new Text(summaryText, 0, 0));
	container.addChild(new Spacer(1));

	if (previewData.notice || typeof previewData.nextContent !== "string") {
		container.addChild(
			new Text(theme.fg("warning", previewData.notice || "Preview unavailable."), 0, 0),
		);
		return container;
	}

	container.addChild(
		renderWriteDiffResult(
			previewData.nextContent,
			{
				expanded: context.expanded === true,
				filePath: previewData.filePath,
				previousContent: previewData.previousContent,
				fileExistedBeforeWrite: previewData.fileExistedBeforeWrite,
				headerLabel: previewData.headerLabel,
			},
			config,
			theme,
			"",
		),
	);
	return container;
}

export function formatLineCountSuffix(lineCount: number, theme: RenderTheme): string {
	return theme.fg("muted", ` (${lineCount} ${pluralize(lineCount, "line")})`);
}

export function formatWriteCallSuffix(
	lineCount: number,
	sizeBytes: number,
	theme: RenderTheme,
): string {
	return theme.fg(
		"muted",
		` (${lineCount} ${pluralize(lineCount, "line")} • ${formatSize(sizeBytes)})`,
	);
}

function formatInProgressLineCount(action: string, lineCount: number, theme: RenderTheme): string {
	return theme.fg("warning", `${action}...`) + formatLineCountSuffix(lineCount, theme);
}

function normalizePositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: undefined;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function getRtkCompactionInfo(details: unknown): RtkCompactionInfo | undefined {
	const detailRecord = toRecord(details);
	const metadataRecord = toRecord(detailRecord.metadata);
	const topLevel = toRecord(detailRecord.rtkCompaction);
	const nested = toRecord(metadataRecord.rtkCompaction);

	const source =
		Object.keys(topLevel).length > 0
			? topLevel
			: Object.keys(nested).length > 0
				? nested
				: undefined;

	if (!source) {
		return undefined;
	}

	const techniques = toStringArray(source.techniques);
	const info: RtkCompactionInfo = {
		applied: source.applied === true,
		techniques,
		truncated: source.truncated === true,
		originalLineCount: normalizePositiveInteger(source.originalLineCount),
		compactedLineCount: normalizePositiveInteger(source.compactedLineCount),
	};

	if (
		!info.applied &&
		info.techniques.length === 0 &&
		!info.truncated &&
		info.originalLineCount === undefined &&
		info.compactedLineCount === undefined
	) {
		return undefined;
	}

	return info;
}

function formatRtkTechniqueList(techniques: string[]): string {
	if (techniques.length === 0) {
		return "";
	}

	const visible = techniques.slice(0, 3).join(", ");
	const hidden = techniques.length - 3;
	return hidden > 0 ? `${visible}, +${hidden} more` : visible;
}

function getRtkCompactionInfoIfApplied(
	details: unknown,
	config: ToolDisplayConfig,
): RtkCompactionInfo | undefined {
	if (!config.showRtkCompactionHints) {
		return undefined;
	}
	const info = getRtkCompactionInfo(details);
	return info?.applied ? info : undefined;
}

function withRtkCompactionInfo(
	params: RtkHintParams,
	handler: (info: RtkCompactionInfo) => string,
): string {
	const info = getRtkCompactionInfoIfApplied(params.details, params.config);
	return info ? handler(info) : "";
}

interface RtkHintParams {
	details: unknown;
	config: ToolDisplayConfig;
	theme: RenderTheme;
}

interface PreviewHintContext {
	lines: string[];
	config: ToolDisplayConfig;
	theme: RenderTheme;
	options: ToolRenderResultOptions;
	details: unknown;
}

interface McpPreviewHintContext extends PreviewHintContext {
	truncation: { truncated: boolean; fullOutputPath?: string };
}

function handlePartialResult(
	options: ToolRenderResultOptions,
	theme: RenderTheme,
	message: string,
): Text | undefined {
	return options.isPartial ? partialResultText(theme, message) : undefined;
}

function renderSearchPreview(ctx: PreviewHintContext, expandedOnly = false): Text {
	return renderPreviewText(
		ctx.lines,
		ctx.config,
		ctx.theme,
		ctx.options,
		(p) => appendPreviewHints(p, ctx),
		expandedOnly,
	);
}

function renderMcpPreview(ctx: McpPreviewHintContext, expandedOnly = false): Text {
	return renderPreviewText(
		ctx.lines,
		ctx.config,
		ctx.theme,
		ctx.options,
		(p) => appendMcpPreviewHints(p, ctx),
		expandedOnly,
	);
}

function formatRtkSummarySuffix(params: RtkHintParams): string {
	const { theme } = params;
	return withRtkCompactionInfo(params, (info) => {
		const segments: string[] = [RTK_COMPACTION_LABEL];

		const techniqueText = formatRtkTechniqueList(info.techniques);
		if (techniqueText) {
			segments.push(techniqueText);
		}
		if (info.truncated) {
			segments.push("RTK removed content");
		}

		if (segments.length === 0) {
			return "";
		}

		return theme.fg("warning", ` • ${segments.join(" • ")}`);
	});
}

function getExpandedPreviewLineLimit(lines: string[], config: ToolDisplayConfig): number {
	const limit = Math.max(0, config.expandedPreviewMaxLines);
	if (limit === 0) {
		return lines.length;
	}
	return Math.min(lines.length, limit);
}

function formatExpandedPreviewCapHint(
	lines: string[],
	config: ToolDisplayConfig,
	theme: RenderTheme,
): string {
	const cap = Math.max(0, config.expandedPreviewMaxLines);
	if (cap === 0 || lines.length <= cap) {
		return "";
	}

	return `\n${theme.fg("warning", `(display capped at ${cap} lines by tool-display setting)`)}`;
}

function formatRtkPreviewHint(params: RtkHintParams): string {
	const { theme } = params;
	return withRtkCompactionInfo(params, (info) => {
		const hints: string[] = [];
		const techniqueText = formatRtkTechniqueList(info.techniques);
		if (techniqueText) {
			hints.push(`${RTK_COMPACTION_LABEL}: ${techniqueText}`);
		} else {
			hints.push(`${RTK_COMPACTION_LABEL} applied`);
		}

		if (
			info.originalLineCount !== undefined &&
			info.compactedLineCount !== undefined &&
			info.originalLineCount > info.compactedLineCount
		) {
			hints.push(`${info.compactedLineCount}/${info.originalLineCount} lines kept`);
		}

		if (info.truncated) {
			hints.push("RTK removed content");
		}

		return hints.length > 0 ? `\n${theme.fg("warning", `(${hints.join(" • ")})`)}` : "";
	});
}

function appendRtkAndExpandedHints(preview: string, ctx: PreviewHintContext): string {
	preview += formatRtkPreviewHint(ctx);
	if (ctx.options.expanded) {
		preview += formatExpandedPreviewCapHint(ctx.lines, ctx.config, ctx.theme);
	}
	return preview;
}

function appendMcpPreviewHints(preview: string, ctx: McpPreviewHintContext): string {
	const { config, theme, truncation } = ctx;
	if (config.showTruncationHints && (truncation.truncated || truncation.fullOutputPath)) {
		const hints: string[] = [];
		if (truncation.truncated) {
			hints.push("truncated by backend limits");
		}
		if (truncation.fullOutputPath) {
			hints.push(`full output: ${truncation.fullOutputPath}`);
		}
		preview += `\n${theme.fg("warning", `(${hints.join(" • ")})`)}`;
	}
	return appendRtkAndExpandedHints(preview, ctx);
}

function appendPreviewHints(preview: string, ctx: PreviewHintContext): string {
	const { config, theme, details } = ctx;
	if (config.showTruncationHints && toRecord(toRecord(details).truncation).truncated) {
		preview += `\n${theme.fg("warning", "(truncated by backend limits)")}`;
	}
	return appendRtkAndExpandedHints(preview, ctx);
}

function renderPreviewText(
	lines: string[],
	config: ToolDisplayConfig,
	theme: RenderTheme,
	options: ToolRenderResultOptions,
	appendHints: (preview: string) => string,
	expandedOnly: boolean = false,
): Text {
	const useExpanded = expandedOnly || options.expanded;
	const maxLines = useExpanded ? getExpandedPreviewLineLimit(lines, config) : config.previewLines;
	const preview = buildPreviewText(lines, maxLines, theme, useExpanded);
	return textResult(appendHints(preview));
}

function formatReadSummary(
	lines: string[],
	details: ReadToolDetails | undefined,
	theme: RenderTheme,
	showTruncationHints: boolean,
): string {
	const lineCount = lines.length;
	let summary = theme.fg("muted", `↳ loaded ${lineCount} ${pluralize(lineCount, "line")}`);
	summary += theme.fg("warning", showTruncationHints ? truncationHint(details) : "");
	return summary;
}

function formatSearchSummary(
	lines: string[],
	unitLabel: string,
	details: { truncation?: { truncated?: boolean } } | undefined,
	theme: RenderTheme,
	showTruncationHints: boolean,
	pluralLabel?: string,
): string {
	const count = countNonEmptyLines(lines);
	let summary = theme.fg(
		"muted",
		`↳ ${count} ${pluralize(count, unitLabel, pluralLabel)} returned`,
	);
	summary += theme.fg("warning", showTruncationHints ? truncationHint(details) : "");
	return summary;
}

function formatBashSummary(
	lines: string[],
	_details: BashToolDetails | undefined,
	theme: RenderTheme,
	_showTruncationHints: boolean,
): string {
	const lineCount = lines.length;
	return theme.fg("muted", `↳ ${lineCount} ${pluralize(lineCount, "line")} returned`);
}

function formatBashTruncationHints(
	details: BashToolDetails | undefined,
	theme: RenderTheme,
): string {
	if (!details) {
		return "";
	}

	const hints: string[] = [];
	if (details.truncation?.truncated) {
		hints.push("output truncated");
	}
	if (details.fullOutputPath) {
		hints.push(`full output: ${details.fullOutputPath}`);
	}
	if (hints.length === 0) {
		return "";
	}
	return `\n${theme.fg("warning", `(${hints.join(" • ")})`)}`;
}

function getBashPreviewLineLimit(
	lines: string[],
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
): number {
	if (options.expanded) {
		return getExpandedPreviewLineLimit(lines, config);
	}

	return config.bashOutputMode === "opencode" ? config.bashCollapsedLines : config.previewLines;
}

type ToolRenderInput = {
	content?: Array<{ type: string; text?: string }>;
	details?: unknown;
};

function textResult(text: string): Text {
	return new Text(text, 0, 0);
}

function partialResultText(theme: RenderTheme, label: string): Text {
	return textResult(theme.fg("warning", label));
}

function renderBashPreviewWithHints(
	lines: string[],
	maxLines: number,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	options: ToolRenderResultOptions,
	details: BashToolDetails | undefined,
): Text {
	let preview = buildPreviewText(lines, maxLines, theme, options.expanded);
	if (config.showTruncationHints) {
		preview += formatBashTruncationHints(details, theme);
	}
	if (options.expanded) {
		preview += formatExpandedPreviewCapHint(lines, config, theme);
	}
	return textResult(preview);
}

function prepareBashLivePreview(
	rawOutput: string,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
): { lines: string[]; maxLines: number } | undefined {
	const lines = prepareOutputLines(rawOutput, options);
	if (lines.length === 0) {
		return undefined;
	}
	const maxLines = getBashPreviewLineLimit(lines, options, config);
	if (!options.expanded && maxLines === 0) {
		return undefined;
	}
	return { lines, maxLines };
}

function renderBashLivePreview(
	rawOutput: string,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	details: BashToolDetails | undefined,
): Text {
	const prepared = prepareBashLivePreview(rawOutput, options, config);
	if (!prepared) {
		return textResult("");
	}
	return renderBashPreviewWithHints(
		prepared.lines,
		prepared.maxLines,
		config,
		theme,
		options,
		details,
	);
}

function renderBashErrorResult(
	rawOutput: string,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	details: BashToolDetails | undefined,
): Text {
	const lines = prepareOutputLines(rawOutput, options);
	let text = theme.fg("error", "↳ command failed");

	if (lines.length > 0) {
		const maxLines = getBashPreviewLineLimit(lines, options, config);
		if (options.expanded || maxLines > 0) {
			const { shown, remaining } = previewLines(lines, maxLines);
			text += `\n${shown
				.map((line) => theme.fg("error", sanitizeAnsiForThemedOutput(line)))
				.join("\n")}`;
			text += formatTruncationHint(remaining, options.expanded, theme);
		}
	}

	if (config.showTruncationHints) {
		text += formatBashTruncationHints(details, theme);
	}
	if (options.expanded && lines.length > 0) {
		text += formatExpandedPreviewCapHint(lines, config, theme);
	}

	return textResult(text);
}

export function renderSearchResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
	unitLabel: string,
	details: GrepToolDetails | FindToolDetails | LsToolDetails | undefined,
	pluralLabel?: string,
): Text {
	if (options.isPartial) {
		return partialResultText(theme, "running...");
	}

	const lines = prepareOutputLines(extractTextOutput(result), options);

	if (config.searchOutputMode === "hidden") {
		return textResult("");
	}

	const hintCtx: PreviewHintContext = { lines, config, theme, options, details };

	if (config.searchOutputMode === "count") {
		if (options.expanded) {
			return renderSearchPreview(hintCtx, true);
		}

		let summary = formatSearchSummary(
			lines,
			unitLabel,
			details,
			theme,
			config.showTruncationHints,
			pluralLabel,
		);
		summary += formatExpandHint(theme);
		summary += formatRtkSummarySuffix({ details, config, theme });
		return textResult(summary);
	}

	return renderSearchPreview(hintCtx);
}

function resolveMcpProxyCallTarget(args: Record<string, unknown>): string {
	const tool = getTextField(args, "tool");
	const connect = getTextField(args, "connect");
	const describe = getTextField(args, "describe");
	const search = getTextField(args, "search");
	const server = getTextField(args, "server");

	if (tool) {
		return server ? `call ${server}:${tool}` : `call ${tool}`;
	}
	if (connect) {
		return `connect ${connect}`;
	}
	if (describe) {
		return server ? `describe ${describe} @${server}` : `describe ${describe}`;
	}
	if (search) {
		return server ? `search "${search}" @${server}` : `search "${search}"`;
	}
	if (server) {
		return `tools ${server}`;
	}
	return "status";
}

function formatArgCountSuffix(argCount: number, theme: RenderTheme): string {
	return argCount === 0
		? theme.fg("muted", " (no args)")
		: theme.fg("muted", ` (${argCount} ${pluralize(argCount, "arg")})`);
}

export function formatMcpCallLine(
	toolName: string,
	toolLabel: string,
	args: Record<string, unknown>,
	theme: RenderTheme,
	expanded = false,
	payloadArgs = args,
): Component {
	const target =
		toolName === "mcp"
			? resolveMcpProxyCallTarget(args)
			: toolLabel.startsWith("MCP ")
				? toolLabel.slice("MCP ".length)
				: toolLabel;
	const title = theme.fg("accent", target);
	return expanded
		? new Text(title, 0, 0)
		: formatInlineArgsCall(title, toolName, payloadArgs, theme);
}

/** Reuse the expanded args formatter, reserving columns for the call identity. */
function formatInlineArgsCall(
	title: string,
	toolName: string,
	args: Record<string, unknown>,
	theme: RenderTheme,
): Component {
	return {
		invalidate() {},
		render(rawWidth) {
			const width = safeWidth(rawWidth);
			if (!width) return [];
			// The formatter's six-column "args: " prefix is replaced by the call title.
			const available = width - visibleWidth(title) - 1;
			const payload = formatMcpArgsLine(toolName, args, Math.max(7, available + 6));
			const suffix = payload
				? theme.fg("muted", ` ${payload.slice(6)}`)
				: formatArgCountSuffix(0, theme);
			return new Text(truncateToWidth(`${title}${suffix}`, width, "…"), 0, 0).render(width);
		},
	};
}

/** Bound inspection before JSON serialization; never invoke payload toJSON methods or accessors. */
export function formatMcpArgsLine(
	toolName: string,
	args: Record<string, unknown>,
	width: number,
): string | undefined {
	const columns = safeWidth(width);
	if (!columns) return undefined;
	let remaining = MAX_PREVIEW_LINE_CHARS;
	let entries = 256;
	let capped = false;
	const ancestors = new Set<object>();
	// Only own data properties are payload values. Accessors are never invoked: a getter
	// could throw inside render or hide work behind a side effect. Model arguments are
	// JSON-parsed data properties, so ordinary rendering is unaffected.
	const dataValue = (source: object, key: string): { present: boolean; value?: unknown } => {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (!descriptor || !("value" in descriptor)) return { present: false };
		return { present: true, value: descriptor.value };
	};
	const prefix = (value: string): string => {
		const text = graphemePrefix(value, remaining);
		remaining -= text.length;
		capped ||= text.length < value.length;
		return text;
	};
	const inspect = (value: unknown, depth: number): unknown => {
		if (typeof value === "string") return prefix(value);
		if (value === null || typeof value === "number" || typeof value === "boolean") return value;
		if (!value || typeof value !== "object") return null;
		if (depth >= 16 || ancestors.has(value)) {
			capped = true;
			return null;
		}
		ancestors.add(value);
		const copy: Record<string, unknown> | unknown[] = Array.isArray(value)
			? []
			: Object.create(null);
		for (const key in value) {
			if (!Object.hasOwn(value, key)) continue;
			if (remaining <= 0 || entries-- <= 0) {
				capped = true;
				break;
			}
			const entry = dataValue(value, key);
			if (!entry.present) {
				capped = true;
				continue;
			}
			const label = prefix(key);
			const child = inspect(entry.value, depth + 1);
			if (Array.isArray(copy)) copy.push(child);
			else copy[label] = child;
			if (capped) break;
		}
		ancestors.delete(value);
		return copy;
	};
	const parts: string[] = [];
	for (const key in args) {
		if (!Object.hasOwn(args, key)) continue;
		// Proxy routing is already visible in the target; nested args remains one payload value.
		if (toolName === "mcp" && ["tool", "server", "connect", "describe", "search"].includes(key))
			continue;
		if (remaining <= 0 || entries-- <= 0) {
			capped = true;
			break;
		}
		const entry = dataValue(args, key);
		if (!entry.present) {
			capped = true;
			continue;
		}
		parts.push(`${prefix(key)}=${JSON.stringify(inspect(entry.value, 0))}`);
		if (capped) break;
	}
	if (!parts.length) return undefined;
	const line = sanitizeTerminalControls(`args: ${parts.join(" ")}`, "escape");
	// The host truncator adds SGR resets; this plain formatter leaves all styling to the theme.
	return truncateToWidth(capped ? `${line}…` : line, columns, "…").replace(ANSI_SGR_PATTERN, "");
}

export function buildExpandedMcpCall(
	call: Component,
	toolName: string,
	args: Record<string, unknown>,
	theme: RenderTheme,
): Component {
	return {
		invalidate() {
			call.invalidate();
		},
		render(width) {
			const rows = call.render(width);
			const line = formatMcpArgsLine(toolName, args, width);
			return line ? [...rows, theme.fg("muted", line)] : rows;
		},
	};
}

function getMcpTruncationDetails(details: unknown): {
	truncated: boolean;
	fullOutputPath?: string;
} {
	const detailRecord = toRecord(details);
	const truncation = toRecord(detailRecord.truncation);

	const fullOutputPath =
		typeof truncation.fullOutputPath === "string"
			? truncation.fullOutputPath
			: typeof detailRecord.fullOutputPath === "string"
				? detailRecord.fullOutputPath
				: undefined;

	return {
		truncated: truncation.truncated === true,
		fullOutputPath,
	};
}

function renderMcpResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
): Text {
	const partial = handlePartialResult(options, theme, "running...");
	if (partial) {
		return partial;
	}

	if (config.mcpOutputMode === "hidden") {
		return textResult("");
	}

	const lines = prepareOutputLines(extractTextOutput(result), options);
	const truncation = getMcpTruncationDetails(result.details);
	const mcpCtx: McpPreviewHintContext = {
		lines,
		config,
		theme,
		options,
		details: result.details,
		truncation,
	};

	if (config.mcpOutputMode === "summary") {
		if (options.expanded) {
			return renderMcpPreview(mcpCtx, true);
		}

		const lineCount = countNonEmptyLines(lines);
		let summary = theme.fg("muted", `↳ ${lineCount} ${pluralize(lineCount, "line")} returned`);
		summary += formatExpandHint(theme);
		if (config.showTruncationHints && truncation.truncated) {
			summary += theme.fg("warning", " • truncated");
		}
		summary += formatRtkSummarySuffix({ details: result.details, config, theme });
		return textResult(summary);
	}

	return renderMcpPreview(mcpCtx);
}

export function formatGenericToolCallLine(
	toolName: string,
	args: unknown,
	theme: RenderTheme,
	inlineArgs = false,
): Component {
	const argRecord = toRecord(args);
	if (inlineArgs)
		return formatInlineArgsCall(
			theme.fg("toolTitle", theme.bold(toolName)),
			"generic",
			argRecord,
			theme,
		);
	const argCount = Object.keys(argRecord).length;
	const argSuffix = formatArgCountSuffix(argCount, theme);
	return new Text(`${theme.fg("toolTitle", theme.bold(toolName))}${argSuffix}`, 0, 0);
}

export function getSearchScope(args: Record<string, unknown>): string {
	return shortenPath((args.path as string) || ".");
}

export function formatSearchCallLine(
	toolName: string,
	accent: string,
	mutedSuffix: string,
	theme: RenderTheme,
): Text {
	return new Text(
		`${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("accent", accent)}${theme.fg("muted", mutedSuffix)}`,
		0,
		0,
	);
}

export function renderCustomToolResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	outputMode: CustomToolOverrideConfig["outputMode"],
	theme: RenderTheme,
): Text {
	return renderMcpResult(
		result as ToolRenderInput,
		options,
		{ ...config, mcpOutputMode: outputMode },
		theme,
	);
}

function getAdapterPath(args: unknown, adapter: ToolDisplayAdapter): string | undefined {
	const explicitPath = adapter.getPath?.(args);
	if (explicitPath) {
		return explicitPath;
	}

	for (const field of adapter.pathFields ?? ["file_path", "path"]) {
		const value = getStringField(args, field);
		if (value) {
			return value;
		}
	}

	return undefined;
}

export function renderReadDisplayCall(
	args: unknown,
	theme: RenderTheme,
	adapter: ToolDisplayAdapter = {},
): Text {
	const path = shortenPath(getAdapterPath(args, adapter));
	const offset = getNumericField(args, "offset");
	const limit = getNumericField(args, "limit");
	let suffix = "";
	if (offset !== undefined || limit !== undefined) {
		const from = offset ?? 1;
		const to = limit !== undefined ? from + limit - 1 : undefined;
		suffix = to ? `:${from}-${to}` : `:${from}`;
	}
	const line = `${theme.fg("toolTitle", theme.bold("read"))} ${theme.fg("accent", path || "...")}${theme.fg("warning", suffix)}`;
	return textResult(line);
}

export function renderReadDisplayResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	config: ToolDisplayConfig,
	theme: RenderTheme,
): Text {
	if (options.isPartial) {
		return partialResultText(theme, "reading...");
	}

	if (config.readOutputMode === "hidden") {
		return textResult("");
	}

	const details = result.details as ReadToolDetails | undefined;
	const rawOutput = extractTextOutput(result);
	const lines = prepareOutputLines(rawOutput, options);
	const hintCtx: PreviewHintContext = { lines, config, theme, options, details };

	if (config.readOutputMode === "summary") {
		if (options.expanded) {
			return renderSearchPreview(hintCtx, true);
		}

		const summaryLines = compactOutputLines(splitLines(rawOutput), {
			expanded: true,
		});
		let summary = formatReadSummary(summaryLines, details, theme, config.showTruncationHints);
		summary += formatExpandHint(theme);
		summary += formatRtkSummarySuffix({ details: result.details, config, theme });
		return textResult(summary);
	}

	return renderSearchPreview(hintCtx);
}

export function renderEditDisplayResult(
	result: ToolRenderInput & { isError?: boolean },
	options: ToolRenderResultOptions,
	theme: RenderTheme,
	context: ToolRenderContextLike | undefined,
	adapter: ToolDisplayAdapter = {},
	getConfig: ConfigGetter,
): unknown {
	const metadata = options.isPartial ? getEditLineMetadata(context?.args) : undefined;
	if (metadata?.capped)
		return new Text(
			theme.fg("warning", `editing... (≥${metadata.lineCount} lines • preview capped)`),
			0,
			0,
		);
	const lineCount = options.isPartial
		? (adapter.getEditLineCount?.(context?.args) ?? metadata?.lineCount ?? 0)
		: 0;
	const { fallbackText, earlyResult } = handleEditOrWriteResult(
		result,
		options,
		context,
		theme,
		lineCount,
		"editing",
		"Edit failed.",
	);
	if (earlyResult) {
		return earlyResult;
	}

	const config = getConfig();
	const details = result.details as EditToolDetails | undefined;
	return renderEditDiffResult(
		details,
		{
			expanded: options.expanded,
			filePath: getAdapterPath(context?.args, adapter),
			highlighter: adapter.highlighter,
		},
		config,
		theme,
		fallbackText,
	);
}

export function handleEditOrWriteResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	context: ToolRenderContextLike | undefined,
	theme: RenderTheme,
	lineCount: number,
	progressLabel: string,
	errorMessage: string,
): { fallbackText: string; earlyResult: Text | undefined } {
	if (options.isPartial) {
		return {
			fallbackText: "",
			earlyResult: new Text(formatInProgressLineCount(progressLabel, lineCount, theme), 0, 0),
		};
	}
	const fallbackText = extractTextOutput(result);
	if (isToolError(result, context)) {
		return {
			fallbackText,
			earlyResult: textResult(theme.fg("error", fallbackText || errorMessage)),
		};
	}
	return { fallbackText, earlyResult: undefined };
}

export function renderBashDisplayResult(
	result: ToolRenderInput,
	options: ToolRenderResultOptions,
	theme: RenderTheme,
	context: ToolRenderContextLike,
	getConfig: ConfigGetter,
): Text {
	const config = getConfig();
	const details = result.details as BashToolDetails | undefined;
	const rawOutput = extractTextOutput(result);

	if (options.isPartial) {
		return renderBashLivePreview(rawOutput, options, config, theme, details);
	}

	if (isToolError(result, context)) {
		return renderBashErrorResult(rawOutput, options, config, theme, details);
	}

	const lines = prepareOutputLines(rawOutput, options);

	if (lines.length === 0) {
		let text = formatBashNoOutputLine(getStringField(context?.args, "command"), theme);
		if (config.showTruncationHints) {
			text += formatBashTruncationHints(details, theme);
		}
		return textResult(text);
	}

	if (config.bashOutputMode === "summary") {
		if (options.expanded) {
			const maxLines = getExpandedPreviewLineLimit(lines, config);
			return renderBashPreviewWithHints(lines, maxLines, config, theme, options, details);
		}

		let summary = formatBashSummary(lines, details, theme, config.showTruncationHints);
		summary += formatExpandHint(theme);
		if (config.showTruncationHints) {
			summary += formatBashTruncationHints(details, theme);
		}
		return textResult(summary);
	}

	if (config.bashOutputMode === "preview") {
		const maxLines = options.expanded
			? getExpandedPreviewLineLimit(lines, config)
			: config.previewLines;
		return renderBashPreviewWithHints(lines, maxLines, config, theme, options, details);
	}

	if (!options.expanded && config.bashCollapsedLines === 0) {
		let hidden = theme.fg("muted", "↳ output hidden");
		if (config.showTruncationHints) {
			hidden += formatBashTruncationHints(details, theme);
		}
		return textResult(hidden);
	}

	const maxLines = options.expanded ? lines.length : config.bashCollapsedLines;
	let text = buildPreviewText(lines, maxLines, theme, options.expanded);
	if (config.showTruncationHints) {
		text += formatBashTruncationHints(details, theme);
	}
	return textResult(text);
}
