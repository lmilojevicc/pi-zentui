import { homedir } from "node:os";
import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	getLanguageFromPath,
	highlightCode,
	renderDiff,
} from "@mariozechner/pi-coding-agent";
import { Box, type Component, Container, Spacer, Text } from "@mariozechner/pi-tui";
import { type ToolOutputStyle, loadConfig } from "./config";

type BuiltInDefinitions = ReturnType<typeof createBuiltInDefinitions>;
type ToolArgs = Record<string, unknown>;

type CompactState = {
	summary?: string;
	error?: boolean;
	errorText?: string;
};

type CompactRenderContext = {
	args: ToolArgs;
	state: CompactState;
	isError: boolean;
	lastComponent?: Component;
	invalidate: () => void;
};

type CompactRenderCall = (args: ToolArgs, theme: Theme, context: CompactRenderContext) => Component;
type CompactExpandedRenderer = (
	result: AgentToolResult<unknown>,
	theme: Theme,
	context: CompactRenderContext,
	error: boolean,
	mode: ExpandedOutputMode,
) => string;
type CompactRenderResult = (
	result: AgentToolResult<unknown>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: CompactRenderContext,
) => Component;

type OutputMode = "one-line" | "preview" | "full";
type ExpandedOutputMode = Exclude<OutputMode, "one-line">;
type ExpandedBoxStatus = "pending" | "success" | "error";
type ToolBackground = Parameters<Theme["bg"]>[0];

const PREVIEW_LINES = 12;
const OUTPUT_MODES: OutputMode[] = ["one-line", "preview", "full"];

let outputMode: OutputMode = "one-line";
let observedPiExpanded = false;

const home = homedir();
const definitionsByCwd = new Map<string, BuiltInDefinitions>();

function createBuiltInDefinitions(cwd: string) {
	return {
		bash: createBashToolDefinition(cwd),
		edit: createEditToolDefinition(cwd),
		find: createFindToolDefinition(cwd),
		grep: createGrepToolDefinition(cwd),
		ls: createLsToolDefinition(cwd),
		read: createReadToolDefinition(cwd),
		write: createWriteToolDefinition(cwd),
	};
}

function getBuiltIns(cwd: string): BuiltInDefinitions {
	let definitions = definitionsByCwd.get(cwd);
	if (!definitions) {
		definitions = createBuiltInDefinitions(cwd);
		definitionsByCwd.set(cwd, definitions);
	}
	return definitions;
}

function stripAtPrefix(path: string): string {
	return path.startsWith("@") ? path.slice(1) : path;
}

function shortPath(path: unknown, fallback = "."): string {
	if (typeof path !== "string" || path.length === 0) return fallback;
	const cleaned = stripAtPrefix(path);
	return cleaned.startsWith(home) ? `~${cleaned.slice(home.length)}` : cleaned;
}

function quote(value: unknown): string {
	return `"${String(value ?? "")}"`;
}

function truncate(value: unknown, max = 120): string {
	const text = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function resultDetails(result: AgentToolResult<unknown>): Record<string, unknown> {
	return asRecord(result.details);
}

function isResultTruncated(result: AgentToolResult<unknown>): boolean {
	return Boolean(asRecord(resultDetails(result).truncation).truncated);
}

function textContent(result: AgentToolResult<unknown>): string {
	const block = result.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

function hasImage(result: AgentToolResult<unknown>): boolean {
	return result.content.some((item) => item.type === "image");
}

function visibleLineCount(text: string): number {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.length > 0 && !line.startsWith("[Showing ") && !line.startsWith("[Output truncated"),
		).length;
}

function firstUsefulLine(text: string): string | undefined {
	return text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
}

function normalizeDisplayText(text: string): string {
	return text.replace(/\r/g, "");
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") end--;
	return lines.slice(0, end);
}

function limitRenderedText(text: string, mode: ExpandedOutputMode, theme: Theme): string {
	if (mode === "full") return text;

	const lines = trimTrailingEmptyLines(text.split("\n"));
	if (lines.length <= PREVIEW_LINES) return lines.join("\n");

	const hidden = lines.length - PREVIEW_LINES;
	return `${lines.slice(0, PREVIEW_LINES).join("\n")}\n${theme.fg(
		"dim",
		`… ${hidden} more lines (Ctrl+O for full)`,
	)}`;
}

function nextOutputMode(mode: OutputMode): OutputMode {
	return OUTPUT_MODES[(OUTPUT_MODES.indexOf(mode) + 1) % OUTPUT_MODES.length] ?? "one-line";
}

function outputModeForToolStyle(style: ToolOutputStyle): OutputMode {
	switch (style) {
		case "full":
			return "full";
		case "truncated":
			return "preview";
		default:
			return "one-line";
	}
}

function configuredOutputMode(expanded: boolean): OutputMode {
	const configured = outputModeForToolStyle(loadConfig().tools.style);
	return configured === "one-line" && expanded ? "preview" : configured;
}

function syncOutputModeWithPiToggle(expanded: boolean) {
	if (expanded === observedPiExpanded) return;
	observedPiExpanded = expanded;
	outputMode = nextOutputMode(outputMode);
}

function argPath(context: CompactRenderContext): string | undefined {
	const rawPath = context.args.path ?? context.args.file_path;
	return typeof rawPath === "string" ? stripAtPrefix(rawPath) : undefined;
}

function renderHighlightedSource(
	source: string,
	path: string | undefined,
	theme: Theme,
	error: boolean,
	mode: ExpandedOutputMode,
): string {
	const normalized = replaceTabs(normalizeDisplayText(source)).trimEnd();
	if (!normalized) return "";
	if (error) return limitRenderedText(theme.fg("error", normalized), mode, theme);

	const language = path ? getLanguageFromPath(path) : undefined;
	if (!language) return limitRenderedText(theme.fg("muted", normalized), mode, theme);

	try {
		return limitRenderedText(
			trimTrailingEmptyLines(highlightCode(normalized, language)).join("\n"),
			mode,
			theme,
		);
	} catch {
		return limitRenderedText(theme.fg("muted", normalized), mode, theme);
	}
}

function highlightShellCommand(command: unknown, theme: Theme): string {
	const normalized = truncate(command, 180);
	if (!normalized) return theme.fg("muted", "...");

	try {
		return trimTrailingEmptyLines(highlightCode(normalized, "bash")).join(" ");
	} catch {
		return theme.fg("accent", normalized);
	}
}

function renderExpandedBox(content: string, theme: Theme, status: ExpandedBoxStatus) {
	const background: ToolBackground =
		status === "error" ? "toolErrorBg" : status === "pending" ? "toolPendingBg" : "toolSuccessBg";
	const box = new Box(3, 1, (text: string) => theme.bg(background, text));
	box.addChild(new Text(content, 0, 0));
	return box;
}

function renderPlainExpanded(
	result: AgentToolResult<unknown>,
	theme: Theme,
	_context: CompactRenderContext,
	error: boolean,
	mode: ExpandedOutputMode,
): string {
	return limitRenderedText(
		theme.fg(error ? "error" : "muted", textContent(result).trimEnd()),
		mode,
		theme,
	);
}

function renderReadExpanded(
	result: AgentToolResult<unknown>,
	theme: Theme,
	context: CompactRenderContext,
	error: boolean,
	mode: ExpandedOutputMode,
): string {
	return renderHighlightedSource(textContent(result), argPath(context), theme, error, mode);
}

function renderBashExpanded(
	result: AgentToolResult<unknown>,
	theme: Theme,
	_context: CompactRenderContext,
	error: boolean,
	mode: ExpandedOutputMode,
): string {
	const output = textContent(result).trimEnd();
	return output ? limitRenderedText(theme.fg(error ? "error" : "muted", output), mode, theme) : "";
}

function renderWriteExpanded(
	result: AgentToolResult<unknown>,
	theme: Theme,
	context: CompactRenderContext,
	error: boolean,
	mode: ExpandedOutputMode,
) {
	if (error) return renderPlainExpanded(result, theme, context, true, mode);
	const source =
		typeof context.args.content === "string" ? context.args.content : textContent(result);
	return renderHighlightedSource(source, argPath(context), theme, false, mode);
}

function renderEditExpanded(
	result: AgentToolResult<unknown>,
	theme: Theme,
	context: CompactRenderContext,
	error: boolean,
	mode: ExpandedOutputMode,
): string {
	if (error) return renderPlainExpanded(result, theme, context, true, mode);
	const diff = resultDetails(result).diff;
	if (typeof diff === "string" && diff.length > 0) {
		return limitRenderedText(renderDiff(diff, { filePath: argPath(context) }), mode, theme);
	}
	return renderPlainExpanded(result, theme, context, false, mode);
}

function setCompactState(context: CompactRenderContext, next: CompactState) {
	const state = context.state;
	const changed =
		state.summary !== next.summary ||
		state.error !== next.error ||
		state.errorText !== next.errorText;
	state.summary = next.summary;
	state.error = next.error;
	state.errorText = next.errorText;

	// renderCall runs before renderResult. Re-render once after renderResult stores
	// the final summary so the count/status can stay on the same compact line.
	if (changed) queueMicrotask(() => context.invalidate());
}

function suffix(state: CompactState): string {
	if (state.errorText) return ` — ${truncate(state.errorText, 100)}`;
	if (state.summary) return ` (${state.summary})`;
	return "";
}

function compactCall(format: (args: ToolArgs, state: CompactState) => string): CompactRenderCall {
	return (args, theme, context) => {
		const state = context.state;
		const component =
			context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
		const color = state.error || context.isError ? "error" : "muted";
		component.setText(theme.fg(color, format(args, state)));
		return component;
	};
}

const compactBashCall: CompactRenderCall = (args, theme, context) => {
	const state = context.state;
	const component =
		context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	const command = truncate(args.command, 180);
	const timeout = args.timeout !== undefined ? ` [timeout=${args.timeout}s]` : "";
	const meta = `${timeout}${suffix(state)}`;

	if (state.error || context.isError) {
		component.setText(theme.fg("error", `→ $ ${command}${meta}`));
	} else {
		component.setText(
			`${theme.fg("muted", "→ ")}${theme.fg("accent", "$")} ${highlightShellCommand(
				command,
				theme,
			)}${theme.fg("dim", meta)}`,
		);
	}

	return component;
};

function compactResult(
	summarize: (
		result: AgentToolResult<unknown>,
		context: CompactRenderContext,
	) => string | undefined,
	renderExpanded: CompactExpandedRenderer = renderPlainExpanded,
	gapBeforeExpanded = true,
): CompactRenderResult {
	return (result, { expanded, isPartial }, theme, context) => {
		const output = textContent(result);
		const error = Boolean(context.isError);
		const errorText = error ? firstUsefulLine(output) : undefined;
		const summary = isPartial ? "running" : summarize(result, context);

		setCompactState(context, { summary, error, errorText });

		syncOutputModeWithPiToggle(Boolean(expanded));
		if (outputMode === "one-line") return new Text("", 0, 0);

		const mode: ExpandedOutputMode = outputMode === "full" ? "full" : "preview";
		const expandedText = renderExpanded(result, theme, context, error, mode);
		if (!expandedText || expandedText.trim() === "") return new Text("", 0, 0);

		const status: ExpandedBoxStatus = error ? "error" : isPartial ? "pending" : "success";
		const box = renderExpandedBox(expandedText, theme, status);
		if (!gapBeforeExpanded) return box;

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	};
}

function summarizeRead(result: AgentToolResult<unknown>): string | undefined {
	if (hasImage(result)) return "image";
	const lines = visibleLineCount(textContent(result));
	const truncated = isResultTruncated(result);
	return lines > 0 ? `${plural(lines, "line")}${truncated ? ", truncated" : ""}` : undefined;
}

function summarizeBash(
	result: AgentToolResult<unknown>,
	context: CompactRenderContext,
): string | undefined {
	const output = textContent(result);
	if (context.isError) {
		const exit = output.match(/Command exited with code (\d+)/i)?.[1];
		if (exit) return `exit ${exit}`;
	}
	const lines = visibleLineCount(output);
	const truncated = isResultTruncated(result);
	if (lines === 0 || output.trim() === "(no output)") return "done";
	return `${plural(lines, "line")}${truncated ? ", truncated" : ""}`;
}

function summarizeEdit(result: AgentToolResult<unknown>): string | undefined {
	const diff = resultDetails(result).diff;
	if (typeof diff !== "string") return "done";
	let additions = 0;
	let removals = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		if (line.startsWith("-") && !line.startsWith("---")) removals++;
	}
	return `+${additions}/-${removals}`;
}

function summarizeWrite(): string {
	return "written";
}

function summarizeCount(noun: string, many = `${noun}s`) {
	return (result: AgentToolResult<unknown>): string | undefined => {
		const count = visibleLineCount(textContent(result));
		if (count === 0) return `0 ${many}`;
		return plural(count, noun, many);
	};
}

function registerCompactBuiltIn(
	pi: ExtensionAPI,
	name: keyof BuiltInDefinitions,
	renderCall: CompactRenderCall,
	renderResult: CompactRenderResult,
) {
	const initialDefinition = getBuiltIns(process.cwd())[name] as ToolDefinition;

	pi.registerTool({
		...initialDefinition,
		renderShell: "self",
		async execute(
			toolCallId: string,
			params: Parameters<ToolDefinition["execute"]>[1],
			signal: AbortSignal | undefined,
			onUpdate: Parameters<ToolDefinition["execute"]>[3],
			ctx: Parameters<ToolDefinition["execute"]>[4],
		) {
			const definition = getBuiltIns(ctx.cwd)[name] as ToolDefinition;
			return definition.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall: renderCall as NonNullable<ToolDefinition["renderCall"]>,
		renderResult: renderResult as NonNullable<ToolDefinition["renderResult"]>,
	});
}

export function registerCompactTools(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		observedPiExpanded = ctx.ui.getToolsExpanded();
		outputMode = configuredOutputMode(observedPiExpanded);
	});

	registerCompactBuiltIn(
		pi,
		"read",
		compactCall((args, state) => {
			const options: string[] = [];
			if (args.offset !== undefined) options.push(`offset=${args.offset}`);
			if (args.limit !== undefined) options.push(`limit=${args.limit}`);
			return `→ Read ${shortPath(args.path)}${
				options.length ? ` [${options.join(", ")}]` : ""
			}${suffix(state)}`;
		}),
		compactResult(summarizeRead, renderReadExpanded),
	);

	registerCompactBuiltIn(
		pi,
		"bash",
		compactBashCall,
		compactResult(summarizeBash, renderBashExpanded),
	);

	registerCompactBuiltIn(
		pi,
		"edit",
		compactCall((args, state) => {
			const edits = Array.isArray(args.edits) ? ` [${plural(args.edits.length, "edit")}]` : "";
			return `→ Edit ${shortPath(args.path)}${edits}${suffix(state)}`;
		}),
		compactResult(summarizeEdit, renderEditExpanded),
	);

	registerCompactBuiltIn(
		pi,
		"write",
		compactCall((args, state) => {
			const lines =
				typeof args.content === "string"
					? ` [${plural(args.content.split("\n").length, "line")}]`
					: "";
			return `→ Write ${shortPath(args.path)}${lines}${suffix(state)}`;
		}),
		compactResult(summarizeWrite, renderWriteExpanded),
	);

	registerCompactBuiltIn(
		pi,
		"find",
		compactCall((args, state) => {
			const limit = args.limit !== undefined ? ` [limit=${args.limit}]` : "";
			return `* Glob ${quote(args.pattern)} in ${shortPath(args.path)}${limit}${suffix(state)}`;
		}),
		compactResult(summarizeCount("match", "matches")),
	);

	registerCompactBuiltIn(
		pi,
		"grep",
		compactCall((args, state) => {
			const parts: string[] = [];
			if (args.glob) parts.push(`glob=${args.glob}`);
			if (args.ignoreCase) parts.push("ignoreCase=true");
			if (args.literal) parts.push("literal=true");
			if (args.context !== undefined) parts.push(`context=${args.context}`);
			if (args.limit !== undefined) parts.push(`limit=${args.limit}`);
			return `* Grep ${quote(args.pattern)} in ${shortPath(args.path)}${
				parts.length ? ` [${parts.join(", ")}]` : ""
			}${suffix(state)}`;
		}),
		compactResult(summarizeCount("match", "matches")),
	);

	registerCompactBuiltIn(
		pi,
		"ls",
		compactCall((args, state) => {
			const limit = args.limit !== undefined ? ` [limit=${args.limit}]` : "";
			return `→ List ${shortPath(args.path)}${limit}${suffix(state)}`;
		}),
		compactResult(summarizeCount("entry", "entries")),
	);
}
