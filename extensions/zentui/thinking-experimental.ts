import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import * as PiTui from "@earendil-works/pi-tui";
import {
	type Component,
	getKeybindings,
	Markdown,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ThinkingStepsComponentConfig, ThinkingStepsMode } from "./config";
import {
	installPrototypePatch,
	isPrototypePatchCurrent,
	type PrototypePatchRegistration,
} from "./prototype-patch-registry";
import { parseThinkingSteps, type ThinkingStep } from "./thinking-steps";

/*
 * The rendered-row folding and lifecycle below are adapted from
 * @99percentpeople/pi-thinking-fold 0.1.9 at commit 555160c.
 *
 * MIT License
 *
 * Copyright (c) 2026 Zach Yuen
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

export const THINKING_EXPERIMENTAL_TAIL_ROWS = 5;
/** Bounds expand/refold ownership to the most recent retained session components. */
export const THINKING_EXPERIMENTAL_MAX_TRACKED_COMPONENTS = 256;
const PATCH_ADAPTER = "thinking-experimental-update-content" as const;
const MAX_TIMINGS = 256;

type PatchableAssistant = {
	contentContainer?: { children?: Component[] };
	hideThinkingBlock?: boolean;
	isStreaming?: boolean;
};

type PrivateAssistantConstructor = {
	prototype: PatchableAssistant & {
		render?: unknown;
		updateContent?: (this: unknown, ...args: unknown[]) => unknown;
	};
};

// This renderer is private and has disappeared from published entrypoints before.
// Resolve it as optional data so a missing/renamed export cannot reject ESM linking.
const AssistantMessageComponent = (
	PiCodingAgent as unknown as { AssistantMessageComponent?: PrivateAssistantConstructor }
).AssistantMessageComponent;
const keyText = PiCodingAgent.keyText;

function requestTerminalRender(): void {
	try {
		// Pi has no public transcript-redraw method. Its TUI owns resize as a full redraw.
		process.stdout.emit("resize");
	} catch {
		// The next native host update will render the already-reconciled children.
	}
}

type HiddenState = { own: boolean; value: boolean | undefined };

type TrackedState = {
	message: AssistantMessage;
	args: unknown[];
	predecessor: (this: unknown, ...args: unknown[]) => unknown;
	incomplete: boolean;
	nativeHidden: HiddenState;
	folded: boolean;
};

type Timing = { startedAt?: number; completedAt?: number };

type KeybindingsShape = {
	getDefinition(action: string): unknown;
	getKeys?(action: string): string[];
	matches(data: string, action: string): boolean;
};

type ToggleInput = Readonly<{
	label: string;
	keys: readonly string[];
	matches: (data: string) => boolean;
	rawFallback: boolean;
}>;

export type ThinkingExperimentalDiagnostics = Readonly<{
	trackedComponents: number;
	activeComponents: number;
	lastTimerWork: number;
}>;

export type ThinkingExperimentalState = Readonly<{
	available: boolean;
	active: boolean;
	activeMode?: ThinkingStepsMode;
	startup: Readonly<ThinkingStepsComponentConfig>;
	displaced: boolean;
	restartRequired: boolean;
	reason?: string;
}>;

function messageTimestamp(message: AssistantMessage): number | undefined {
	return Number.isFinite(message.timestamp) ? message.timestamp : undefined;
}

function hasThinking(message: AssistantMessage): boolean {
	return message.content.some(
		(content) => content.type === "thinking" && Boolean(content.thinking.trim()),
	);
}

function formatSeconds(milliseconds: number): string {
	return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

type NativeMarkdownShape = {
	text: string;
	paddingX: number;
	paddingY: number;
	theme: ConstructorParameters<typeof Markdown>[3];
	defaultTextStyle?: ConstructorParameters<typeof Markdown>[4];
	options?: ConstructorParameters<typeof Markdown>[5];
};

type AccentTheme = { fg(color: "accent", text: string): string };
type StructuralThinkingMode = Exclude<ThinkingStepsMode, "streaming">;

/*
 * The visual title/connector language below is adapted from pi-thinking-steps d0a59a4.
 *
 * MIT License
 *
 * Copyright (c) 2026 Marc Mironescu / FluxGear
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

function unsafeRenderedRow(source: string, row: string): boolean {
	return (
		/!\[[^\]]*\]\(/.test(source) ||
		row.includes("\x1b_G") ||
		/\x1b\]1337;File=/.test(row) ||
		visibleWidth(row) === 0
	);
}

function croppedMarkdownRow(markdown: Markdown, source: string, width: number): string | undefined {
	if (width <= 0) return undefined;
	const rows = markdown.render(width);
	const first = rows[0];
	if (!first || unsafeRenderedRow(source, first)) return undefined;
	if (rows.length > 1) {
		if (width === 1) return "…";
		return `${truncateToWidth(first, width - 1, "")}…`;
	}
	return visibleWidth(first) <= width ? first : truncateToWidth(first, width, "…");
}

/** A width-bounded private replacement for one native contiguous thinking run. */
export class ThinkingStepsRows implements Component {
	private readonly title: Markdown;
	private readonly labels: Array<{ source: string; markdown: Markdown }>;

	constructor(
		private readonly native: Component,
		private readonly shape: NativeMarkdownShape,
		steps: readonly ThinkingStep[],
		private readonly mode: StructuralThinkingMode,
		private readonly incomplete: boolean,
		private readonly getTheme: () => AccentTheme,
	) {
		const selected = mode === "rail" ? steps : steps.slice(-5);
		this.title = new Markdown(
			"**Thinking**",
			0,
			0,
			shape.theme,
			shape.defaultTextStyle,
			shape.options,
		);
		this.labels = selected.map((step) => ({
			source: step.label,
			markdown: new Markdown(step.label, 0, 0, shape.theme, shape.defaultTextStyle, shape.options),
		}));
	}

	render(width: number): string[] {
		try {
			const outer = this.shape.paddingX;
			const innerWidth = Math.floor(width) - outer * 2;
			const titleConnector = this.mode === "rail" ? "│ " : "┆ ";
			const titleBudget = innerWidth - visibleWidth(titleConnector);
			const title = croppedMarkdownRow(this.title, "**Thinking**", titleBudget);
			if (!title) return this.native.render(width);
			const renderedLabels: Array<{ connector: string; label: string }> = [];
			for (const [index, value] of this.labels.entries()) {
				const final = index === this.labels.length - 1;
				const connector =
					this.mode === "rail"
						? final && this.incomplete
							? "│ • "
							: "│ "
						: final
							? this.incomplete
								? "└─ • "
								: "└─ · "
							: "├─ · ";
				const budget = innerWidth - visibleWidth(connector);
				const label = croppedMarkdownRow(value.markdown, value.source, budget);
				if (!label) return this.native.render(width);
				renderedLabels.push({ connector, label });
			}
			const theme = this.getTheme();
			const left = " ".repeat(outer);
			const right = " ".repeat(outer);
			const rows = [
				`${left}${theme.fg("accent", titleConnector)}${title}${right}`,
				...renderedLabels.map(
					({ connector, label }) => `${left}${theme.fg("accent", connector)}${label}${right}`,
				),
			];
			return rows.every((row) => visibleWidth(row) <= width) ? rows : this.native.render(width);
		} catch {
			return this.native.render(width);
		}
	}

	invalidate(): void {
		this.native.invalidate();
		this.title.invalidate();
		for (const label of this.labels) label.markdown.invalidate();
	}
}

/** Pure factory shared by settings previews and the private assistant wrapper. */
export function createThinkingStepsRows(
	native: Component,
	shape: NativeMarkdownShape,
	steps: readonly ThinkingStep[],
	mode: StructuralThinkingMode,
	incomplete: boolean,
	getTheme: () => AccentTheme,
): ThinkingStepsRows {
	return new ThinkingStepsRows(native, shape, steps, mode, incomplete, getTheme);
}

class FoldContext {
	readonly sections: FoldedThinkingSection[] = [];
	private preparedWidth: number | undefined;
	private allocations = new Map<FoldedThinkingSection, string[]>();
	private hidden = false;

	constructor(
		readonly incomplete: boolean,
		readonly header: (hidden: boolean) => string,
		private readonly template: NativeMarkdownShape,
	) {}

	add(section: FoldedThinkingSection): void {
		this.sections.push(section);
	}

	prepare(width: number): void {
		if (this.preparedWidth === width) return;
		const rendered = this.sections.map((section) => section.renderNative(width));
		const total = rendered.reduce((count, rows) => count + rows.length, 0);
		this.hidden = !this.incomplete || total > THINKING_EXPERIMENTAL_TAIL_ROWS;
		let remaining = this.incomplete ? Math.min(total, THINKING_EXPERIMENTAL_TAIL_ROWS) : 0;
		this.allocations = new Map();
		for (let index = rendered.length - 1; index >= 0; index -= 1) {
			const rows = rendered[index] ?? [];
			const take = Math.min(remaining, rows.length);
			this.allocations.set(
				this.sections[index] as FoldedThinkingSection,
				take > 0 ? rows.slice(-take) : [],
			);
			remaining -= take;
		}
		this.preparedWidth = width;
	}

	rowsFor(section: FoldedThinkingSection, width: number): string[] {
		this.prepare(width);
		return this.allocations.get(section) ?? [];
	}

	headerRows(width: number): string[] {
		this.prepare(width);
		return new Markdown(
			this.header(this.hidden),
			this.template.paddingX,
			this.template.paddingY,
			this.template.theme,
			this.template.defaultTextStyle,
			this.template.options,
		).render(width);
	}

	invalidate(): void {
		this.preparedWidth = undefined;
		this.allocations.clear();
	}
}

class FoldedThinkingSection implements Component {
	private nativeRows: string[] = [];
	private preparedWidth: number | undefined;

	constructor(
		private readonly native: Markdown,
		private readonly context: FoldContext,
		private readonly first: boolean,
	) {
		context.add(this);
	}

	renderNative(width: number): string[] {
		if (this.preparedWidth !== width) {
			this.nativeRows = this.native.render(width);
			this.preparedWidth = width;
		}
		return this.nativeRows;
	}

	render(width: number): string[] {
		const rows = this.context.rowsFor(this, width);
		return this.first ? [...this.context.headerRows(width), ...rows] : rows;
	}

	invalidate(): void {
		this.native.invalidate();
		this.preparedWidth = undefined;
		this.context.invalidate();
	}
}

function markdownShape(component: Markdown): NativeMarkdownShape | undefined {
	const value = component as unknown as Record<string, unknown>;
	if (
		typeof value.text !== "string" ||
		typeof value.paddingX !== "number" ||
		typeof value.paddingY !== "number" ||
		!value.theme
	)
		return undefined;
	return value as unknown as NativeMarkdownShape;
}

type NativeChildDescriptor =
	| Readonly<{ kind: "markdown"; source: string; thinkingRun?: number }>
	| Readonly<{ kind: "spacer" }>
	| Readonly<{ kind: "text"; markers: readonly string[] }>;

type ThinkingMarkdownMatch = Readonly<{
	index: number;
	markdown: Markdown;
	shape: NativeMarkdownShape;
	run: number;
}>;

type ThinkingMarkdownLayout = Readonly<{
	matches: readonly ThinkingMarkdownMatch[];
	descriptors: readonly NativeChildDescriptor[];
}>;

class NativeThinkingRun implements Component {
	constructor(private readonly children: readonly Component[]) {}

	render(width: number): string[] {
		return this.children.flatMap((child) => child.render(width));
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
	}
}

const legacyLengthMarkers = [
	"Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
	"Response was truncated before completion.",
] as const;

function hasVisibleContentAfter(message: AssistantMessage, start: number): boolean {
	return message.content
		.slice(start)
		.some(
			(content) =>
				(content.type === "text" && Boolean(content.text.trim())) ||
				(content.type === "thinking" && Boolean(content.thinking.trim())),
		);
}

function trailingDescriptors(message: AssistantMessage): NativeChildDescriptor[] {
	if (message.stopReason === "length") {
		return [{ kind: "spacer" }, { kind: "text", markers: legacyLengthMarkers }];
	}
	if (message.content.some((content) => content.type === "toolCall")) return [];
	if (message.stopReason === "aborted") {
		const marker =
			message.errorMessage && message.errorMessage !== "Request was aborted"
				? message.errorMessage
				: "Operation aborted";
		return [{ kind: "spacer" }, { kind: "text", markers: [marker] }];
	}
	if (message.stopReason === "error") {
		return [
			{ kind: "spacer" },
			{ kind: "text", markers: [`Error: ${message.errorMessage || "Unknown error"}`] },
		];
	}
	return [];
}

/**
 * Mirrors the visible child layouts shipped by the supported Pi hosts. Pi 0.83+
 * coalesces a contiguous thinking run; Pi 0.80.5 emitted one section per block.
 * Tool calls emit no child here, but still terminate a thinking run and suppress
 * trailing errors, so iteration over the original ordered content is required.
 */
function nativeChildLayouts(message: AssistantMessage): NativeChildDescriptor[][] {
	const build = (coalesceThinking: boolean): NativeChildDescriptor[] => {
		const descriptors: NativeChildDescriptor[] = [];
		let nextRun = 0;
		let contiguousRun: number | undefined;
		if (hasVisibleContentAfter(message, 0)) descriptors.push({ kind: "spacer" });
		for (let index = 0; index < message.content.length; index += 1) {
			const content = message.content[index];
			if (content?.type === "text") {
				contiguousRun = undefined;
				const source = content.text.trim();
				if (source) descriptors.push({ kind: "markdown", source });
				continue;
			}
			if (content?.type !== "thinking") {
				contiguousRun = undefined;
				continue;
			}
			const run = contiguousRun ?? nextRun++;
			contiguousRun = run;
			if (!coalesceThinking) {
				const source = content.thinking.trim();
				if (source) {
					descriptors.push({ kind: "markdown", source, thinkingRun: run });
					if (hasVisibleContentAfter(message, index + 1)) descriptors.push({ kind: "spacer" });
				}
				continue;
			}
			const blocks: string[] = [];
			for (; index < message.content.length; index += 1) {
				const next = message.content[index];
				if (next?.type !== "thinking") break;
				const source = next.thinking.trim();
				if (source) blocks.push(source);
			}
			index -= 1;
			if (!blocks.length) continue;
			descriptors.push({ kind: "markdown", source: blocks.join("\n\n"), thinkingRun: run });
			if (hasVisibleContentAfter(message, index + 1)) descriptors.push({ kind: "spacer" });
		}
		return [...descriptors, ...trailingDescriptors(message)];
	};
	const coalesced = build(true);
	const legacy = build(false);
	return JSON.stringify(coalesced) === JSON.stringify(legacy) ? [coalesced] : [coalesced, legacy];
}

function plainTextMarker(text: string): string {
	return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function exactConstructor(component: Component, expected: { prototype: object }): boolean {
	return Object.getPrototypeOf(component) === expected.prototype;
}

function matchNativeLayout(
	children: Component[],
	descriptors: NativeChildDescriptor[],
): ThinkingMarkdownLayout | undefined {
	if (children.length !== descriptors.length) return undefined;
	const thinking: ThinkingMarkdownMatch[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		const child = children[index];
		const descriptor = descriptors[index];
		if (!child || !descriptor) return undefined;
		if (descriptor.kind === "spacer") {
			if (!exactConstructor(child, Spacer) || (child as unknown as { lines?: unknown }).lines !== 1)
				return undefined;
			continue;
		}
		if (descriptor.kind === "text") {
			if (!exactConstructor(child, Text)) return undefined;
			const text = (child as unknown as { text?: unknown }).text;
			if (typeof text !== "string") return undefined;
			const marker = plainTextMarker(text);
			if (!descriptor.markers.includes(marker)) return undefined;
			continue;
		}
		if (!exactConstructor(child, Markdown)) return undefined;
		const shape = markdownShape(child as Markdown);
		if (!shape || shape.text !== descriptor.source) return undefined;
		if (descriptor.thinkingRun !== undefined) {
			thinking.push({
				index,
				markdown: child as Markdown,
				shape,
				run: descriptor.thinkingRun,
			});
		}
	}
	return { matches: thinking, descriptors };
}

function thinkingMarkdownLayout(
	children: Component[],
	message: AssistantMessage,
): ThinkingMarkdownLayout | undefined {
	for (const descriptors of nativeChildLayouts(message)) {
		const layout = matchNativeLayout(children, descriptors);
		if (layout?.matches.length) return layout;
	}
	return undefined;
}

function writableOwnChildren(
	instance: PatchableAssistant,
): { container: { children?: Component[] }; children: Component[] } | undefined {
	const container = instance.contentContainer;
	if (!container) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(container, "children");
	if (
		!descriptor ||
		!("value" in descriptor) ||
		descriptor.writable !== true ||
		!Array.isArray(descriptor.value)
	)
		return undefined;
	return { container, children: descriptor.value };
}

export function hasThinkingExperimentalMarkdownIdentity(
	instance: object,
	message: AssistantMessage,
): boolean {
	const owned = writableOwnChildren(instance as PatchableAssistant);
	return Boolean(owned && thinkingMarkdownLayout(owned.children, message) !== undefined);
}

function activeThinkingRun(message: AssistantMessage, incomplete: boolean): number | undefined {
	if (!incomplete || message.content.at(-1)?.type !== "thinking") return undefined;
	let nextRun = 0;
	let contiguousRun: number | undefined;
	for (const content of message.content) {
		if (content.type !== "thinking") {
			contiguousRun = undefined;
			continue;
		}
		contiguousRun ??= nextRun++;
	}
	return contiguousRun;
}

function replaceThinkingChildren(
	instance: PatchableAssistant,
	message: AssistantMessage,
	mode: ThinkingStepsMode,
	incomplete: boolean,
	header: (hidden: boolean) => string,
	getTheme: () => AccentTheme,
): boolean {
	const owned = writableOwnChildren(instance);
	if (!owned) return false;
	const { container, children } = owned;
	const layout = thinkingMarkdownLayout(children, message);
	if (!layout) return false;
	const replacements = new Map<number, Component>();
	const removals = new Set<number>();
	if (mode === "streaming") {
		const template = layout.matches[0]?.shape;
		if (!template) return false;
		const context = new FoldContext(incomplete, header, template);
		for (const [position, match] of layout.matches.entries()) {
			replacements.set(
				match.index,
				new FoldedThinkingSection(match.markdown, context, position === 0),
			);
		}
	} else {
		const runs = new Map<number, ThinkingMarkdownMatch[]>();
		for (const match of layout.matches) {
			const matches = runs.get(match.run) ?? [];
			matches.push(match);
			runs.set(match.run, matches);
		}
		const activeRun = activeThinkingRun(message, incomplete);
		for (const [run, matches] of runs) {
			const first = matches[0];
			const last = matches.at(-1);
			if (!first || !last) continue;
			const source = matches.map((match) => match.shape.text).join("\n\n");
			const steps = parseThinkingSteps(source);
			if (!steps?.length) continue;
			const nativeChildren = children.slice(first.index, last.index + 1);
			const native =
				nativeChildren.length === 1 ? first.markdown : new NativeThinkingRun(nativeChildren);
			replacements.set(
				first.index,
				createThinkingStepsRows(
					native,
					{ ...first.shape, text: source },
					steps,
					mode,
					run === activeRun,
					getTheme,
				),
			);
			for (let index = first.index + 1; index <= last.index; index += 1) removals.add(index);
		}
	}
	if (replacements.size === 0) return true;
	const nextChildren = children.flatMap((child, index) => {
		const replacement = replacements.get(index);
		if (replacement) return [replacement];
		return removals.has(index) ? [] : [child];
	});
	container.children = nextChildren;
	return true;
}

function eventType(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const nested = (event as { assistantMessageEvent?: unknown }).assistantMessageEvent;
	if (!nested || typeof nested !== "object") return undefined;
	const type = (nested as { type?: unknown }).type;
	return typeof type === "string" ? type : undefined;
}

function assistantMessage(event: unknown): AssistantMessage | undefined {
	if (!event || typeof event !== "object") return undefined;
	const message = (event as { message?: unknown }).message;
	if (
		!message ||
		typeof message !== "object" ||
		(message as { role?: unknown }).role !== "assistant"
	)
		return undefined;
	return message as AssistantMessage;
}

function beginsThinkingPhase(type: string | undefined): boolean {
	return type === "thinking_start" || type === "thinking_delta";
}

function endsThinkingPhase(type: string | undefined): boolean {
	return (
		type === "thinking_end" ||
		type === "text_start" ||
		type === "text_delta" ||
		type === "toolcall_start" ||
		type === "toolcall_delta"
	);
}

function hiddenState(instance: PatchableAssistant): HiddenState {
	return {
		own: Object.hasOwn(instance, "hideThinkingBlock"),
		value: typeof instance.hideThinkingBlock === "boolean" ? instance.hideThinkingBlock : undefined,
	};
}

function setHiddenState(instance: PatchableAssistant, state: HiddenState): void {
	if (state.own) instance.hideThinkingBlock = state.value;
	else delete instance.hideThinkingBlock;
}

function renderWithHiddenState(
	instance: PatchableAssistant,
	predecessor: (this: unknown, ...args: unknown[]) => unknown,
	args: unknown[],
	hidden: HiddenState,
): unknown {
	const current = hiddenState(instance);
	try {
		instance.hideThinkingBlock = hidden.value;
		return Reflect.apply(predecessor, instance, args);
	} finally {
		setHiddenState(instance, current);
	}
}

function isKeyRelease(data: string): boolean {
	const publicCheck = (PiTui as unknown as { isKeyRelease?: (value: string) => boolean })
		.isKeyRelease;
	if (typeof publicCheck === "function") {
		try {
			if (publicCheck(data)) return true;
		} catch {
			// Continue with the protocol's structural event marker.
		}
	}
	return /^\x1b\[[0-9]+(?:;[0-9]+)?(?::3)?u$/.test(data) && /:3u$/.test(data);
}

/** Owns the opt-in private renderer wrapper for one Zentui extension/session lifecycle. */
export class ThinkingExperimentalController {
	private installed = false;
	private active = false;
	private displaced = false;
	private restartRequired = false;
	private unavailableReason: string | undefined;
	private patchRegistration: PrototypePatchRegistration | undefined;
	private context: ExtensionContext | undefined;
	private stopInput: (() => void) | undefined;
	private interval: ReturnType<typeof setInterval> | undefined;
	private expanded = false;
	private toggleInput: ToggleInput | undefined;
	private tracked = new Set<WeakRef<object>>();
	private activeComponents = new Set<WeakRef<object>>();
	private references = new WeakMap<object, WeakRef<object>>();
	private states = new WeakMap<object, TrackedState>();
	private timings = new Map<number, Timing>();
	private lastTimerWork = 0;
	private currentMessage: AssistantMessage | undefined;
	private rerendering = false;
	private shapeFailureDuringRerender: string | undefined;
	private startup: ThinkingStepsComponentConfig = { enabled: false, mode: "tree" };
	private activeMode: ThinkingStepsMode | undefined;

	constructor(
		private readonly getConfig: () => ThinkingStepsComponentConfig,
		private readonly requestRender: () => void = requestTerminalRender,
		private readonly now: () => number = Date.now,
		private readonly getHostKeybindings:
			| (() => KeybindingsShape | undefined)
			| undefined = typeof getKeybindings === "function" ? getKeybindings : undefined,
		private readonly getHostKeyText: ((action: string) => string) | undefined = typeof keyText ===
		"function"
			? (action) => keyText(action as never)
			: undefined,
	) {
		const prototype = AssistantMessageComponent?.prototype;
		if (
			!prototype ||
			typeof (prototype as { updateContent?: unknown }).updateContent !== "function" ||
			typeof (prototype as { render?: unknown }).render !== "function"
		) {
			this.unavailableReason = "Pi's private AssistantMessageComponent renderer is unavailable";
		}
	}

	get state(): ThinkingExperimentalState {
		this.checkDisplacement();
		const reason = this.displaced
			? "Private renderer patch ownership was displaced; restart required"
			: (this.unavailableReason ??
				(this.restartRequired ? "Restart Pi to apply saved Thinking changes." : undefined));
		return Object.freeze({
			available: !this.unavailableReason && !this.displaced,
			active: this.active && !this.displaced,
			...(this.activeMode ? { activeMode: this.activeMode } : {}),
			startup: Object.freeze({ ...this.startup }),
			displaced: this.displaced,
			restartRequired: this.restartRequired,
			...(reason ? { reason } : {}),
		});
	}

	get diagnostics(): ThinkingExperimentalDiagnostics {
		return Object.freeze({
			trackedComponents: this.trackedEntries().length,
			activeComponents: this.activeEntries().length,
			lastTimerWork: this.lastTimerWork,
		});
	}

	/** Activates the private renderer only during session startup, before transcript restoration. */
	startSession(ctx: ExtensionContext): { applied: boolean; reason?: string } {
		if (ctx.mode === "tui" && ctx.hasUI) this.context = ctx;
		this.startup = { ...this.getConfig() };
		this.restartRequired = false;
		this.activeMode = undefined;
		if (!this.startup.enabled) return { applied: true };
		if (!this.context) {
			return { applied: false, reason: "Thinking (Experimental) requires a TUI session" };
		}
		if (this.unavailableReason) return { applied: false, reason: this.unavailableReason };
		if (this.startup.mode === "streaming" && !this.resolveToggleInput()) {
			return {
				applied: false,
				reason: this.unavailableReason ?? "Experimental thinking toggle is unavailable",
			};
		}
		if (!this.install()) {
			return {
				applied: false,
				reason:
					this.unavailableReason ?? "Experimental renderer unavailable; using native thinking",
			};
		}
		if (this.checkDisplacement()) {
			this.restartRequired = true;
			return {
				applied: false,
				reason: "Experimental renderer was displaced; restart required, using native thinking",
			};
		}
		this.active = true;
		this.activeMode = this.startup.mode;
		if (this.activeMode === "streaming") this.installInputListener();
		if (!this.active) {
			return {
				applied: false,
				reason: this.unavailableReason ?? "Experimental input handling is unavailable",
			};
		}
		return { applied: true };
	}

	/** Persists live settings while retaining the immutable startup renderer snapshot. */
	reconcile(): { applied: boolean; reason?: string } {
		const desired = this.getConfig();
		this.restartRequired =
			desired.enabled !== this.startup.enabled || desired.mode !== this.startup.mode;
		if (!this.restartRequired) return { applied: true };
		return { applied: false, reason: "Restart Pi to apply saved Thinking changes." };
	}

	private install(): boolean {
		if (this.unavailableReason) return false;
		if (this.installed) return !this.displaced;
		if (this.displaced) return false;
		const prototype = AssistantMessageComponent?.prototype;
		if (!prototype) {
			this.unavailableReason = "Pi's private AssistantMessageComponent renderer is unavailable";
			return false;
		}
		try {
			this.patchRegistration = installPrototypePatch(
				prototype,
				"updateContent",
				PATCH_ADAPTER,
				({ predecessor, receiver, args }) => {
					const component = receiver as object;
					const dropFailedPredecessor = () => {
						try {
							this.dropComponent(component, true);
						} catch {
							// Preserve the predecessor's exact thrown value over bookkeeping failures.
						}
					};
					const renderNative = () => {
						try {
							return Reflect.apply(predecessor, receiver, args);
						} catch (error) {
							dropFailedPredecessor();
							throw error;
						}
					};
					const renderNativeWithHiddenState = (
						instance: PatchableAssistant,
						hidden: HiddenState,
					) => {
						try {
							return renderWithHiddenState(instance, predecessor, args, hidden);
						} catch (error) {
							dropFailedPredecessor();
							throw error;
						}
					};
					if (!this.active || this.checkDisplacement()) return renderNative();
					const instance = receiver as PatchableAssistant;
					const message = args[0] as AssistantMessage | undefined;
					if (!message || !Array.isArray(message.content) || !hasThinking(message)) {
						const nativeResult = renderNative();
						this.declineOwnership(component);
						return nativeResult;
					}
					// Host-driven calls are the authority for Pi's latest hidden preference.
					// Controller rerenders bypass this wrapper and therefore cannot overwrite it.
					const nativeHidden = hiddenState(instance);
					const mode = this.activeMode;
					if (!mode) {
						const nativeResult = renderNative();
						this.declineOwnership(component);
						return nativeResult;
					}
					// The predecessor is outside decoration error containment. Its exact exception,
					// including object identity, remains authoritative to the host.
					const nativeResult =
						mode === "streaming"
							? renderNativeWithHiddenState(instance, {
									own: true,
									value: false,
								})
							: renderNative();
					if (mode !== "streaming" && nativeHidden.value === true) {
						this.declineOwnership(component);
						return nativeResult;
					}
					try {
						const timestamp = messageTimestamp(message);
						const timing = timestamp === undefined ? undefined : this.timings.get(timestamp);
						const streamingArgument = args[1];
						const streaming =
							typeof streamingArgument === "boolean"
								? streamingArgument
								: instance.isStreaming === true ||
									message.stopReason === undefined ||
									(message.stopReason as string) === "pending" ||
									(timing?.startedAt !== undefined && timing.completedAt === undefined);
						const incomplete = streaming && timing?.completedAt === undefined;
						if (!writableOwnChildren(instance)) {
							this.failShape("Pi's private assistant renderer shape is incompatible");
							return nativeResult;
						}
						this.track(component, message, args, predecessor, incomplete, nativeHidden);
						if (mode === "streaming" && this.expanded) return nativeResult;
						if (
							!replaceThinkingChildren(
								instance,
								message,
								mode,
								incomplete,
								(hidden) => this.headerFor(message, incomplete, hidden),
								() => {
									const theme = this.context?.ui.theme as unknown as AccentTheme | undefined;
									if (!theme || typeof theme.fg !== "function")
										throw new Error("theme unavailable");
									return theme;
								},
							)
						) {
							this.failShape("Pi's private assistant renderer shape is incompatible");
							return nativeResult;
						}
						const state = this.states.get(component);
						if (state) state.folded = true;
						return nativeResult;
					} catch {
						this.declineOwnership(component);
						return nativeResult;
					}
				},
				() => {
					this.checkDisplacement();
				},
			);
			this.installed = true;
			return true;
		} catch (error) {
			this.unavailableReason =
				error instanceof Error ? error.message : "Private renderer patch installation failed";
			return false;
		}
	}

	private track(
		component: object,
		message: AssistantMessage,
		args: unknown[],
		predecessor: (this: unknown, ...args: unknown[]) => unknown,
		incomplete: boolean,
		nativeHidden: HiddenState,
	): void {
		this.states.set(component, {
			message,
			args: [...args],
			predecessor,
			incomplete,
			nativeHidden,
			folded: false,
		});
		let reference = this.references.get(component);
		if (!reference) {
			reference = new WeakRef(component);
			this.references.set(component, reference);
			this.tracked.add(reference);
		}
		if (incomplete) this.activeComponents.add(reference);
		else this.activeComponents.delete(reference);
		this.enforceTrackedCapacity();
		const timestamp = messageTimestamp(message);
		if (timestamp !== undefined) {
			const timing = this.timings.get(timestamp);
			if (timing?.completedAt !== undefined) {
				const state = this.states.get(component);
				if (state) state.incomplete = false;
			}
			if (incomplete && timing?.completedAt === undefined && !timing?.startedAt) {
				this.setTiming(timestamp, { ...timing, startedAt: this.now() });
			}
			if (!incomplete && timing?.startedAt !== undefined && timing.completedAt === undefined) {
				this.setTiming(timestamp, { ...timing, completedAt: this.now() });
			}
		}
		this.pruneTimings();
		this.reconcileTimer();
	}

	private headerFor(message: AssistantMessage, incomplete: boolean, hidden: boolean): string {
		const timestamp = messageTimestamp(message);
		const timing = timestamp === undefined ? undefined : this.timings.get(timestamp);
		const hint = hidden ? `  (${this.toggleKey()} to expand)` : "";
		if (incomplete) {
			const duration = timing?.startedAt === undefined ? 0 : this.now() - timing.startedAt;
			return `Thinking ${formatSeconds(duration)}${hint}`;
		}
		if (timing?.startedAt !== undefined && timing.completedAt !== undefined) {
			return `Thought for ${formatSeconds(timing.completedAt - timing.startedAt)}${hint}`;
		}
		return `Thought${hint}`;
	}

	private toggleKey(): string {
		return this.toggleInput?.label ?? "configured thinking toggle";
	}

	private resolveToggleInput(): boolean {
		if (this.toggleInput) return true;
		const action = "app.thinking.toggle";
		if (!this.getHostKeybindings) {
			this.toggleInput = {
				label: "ctrl+t",
				keys: ["ctrl+t"],
				matches: (data) => {
					const parseKey = (PiTui as unknown as { parseKey?: (value: string) => string }).parseKey;
					return data === "\x14" || (typeof parseKey === "function" && parseKey(data) === "ctrl+t");
				},
				rawFallback: true,
			};
			return true;
		}
		let keybindings: KeybindingsShape | undefined;
		try {
			keybindings = this.getHostKeybindings();
		} catch {
			return this.failToggleCapability("Pi's thinking-toggle keybinding discovery failed");
		}
		if (!keybindings) {
			this.toggleInput = {
				label: "ctrl+t",
				keys: ["ctrl+t"],
				matches: (data) => data === "\x14",
				rawFallback: true,
			};
			return true;
		}
		if (
			typeof keybindings.getDefinition !== "function" ||
			typeof keybindings.matches !== "function"
		)
			return this.failToggleCapability("Pi's thinking-toggle keybinding APIs are incompatible");
		let definition: unknown;
		try {
			definition = keybindings.getDefinition(action);
		} catch {
			return this.failToggleCapability("Pi's thinking-toggle action discovery failed");
		}
		// Hosts predating the action have no discoverable action API, so retain their raw default.
		if (definition === undefined || definition === null) {
			this.toggleInput = {
				label: "ctrl+t",
				keys: ["ctrl+t"],
				matches: (data) => data === "\x14",
				rawFallback: true,
			};
			return true;
		}
		if (typeof keybindings.getKeys !== "function")
			return this.failToggleCapability("Pi's thinking-toggle configured bindings are unavailable");
		let keys: string[];
		let label: string;
		try {
			keys = keybindings.getKeys(action);
			label = this.getHostKeyText?.(action) ?? "";
		} catch {
			return this.failToggleCapability("Pi's thinking-toggle binding discovery failed");
		}
		if (
			!Array.isArray(keys) ||
			keys.length === 0 ||
			keys.some((key) => typeof key !== "string" || key.length === 0)
		)
			return this.failToggleCapability("Pi's thinking-toggle has no usable configured binding");
		this.toggleInput = {
			label: label.trim() || keys.join("/"),
			keys: [...keys],
			matches: (data) => keybindings?.matches(data, action) === true,
			rawFallback: false,
		};
		return true;
	}

	private failToggleCapability(reason: string): false {
		this.unavailableReason = reason;
		this.active = false;
		this.stopTimer();
		this.stopInput?.();
		this.stopInput = undefined;
		this.rerenderTracked(true);
		this.clearTrackedSnapshots();
		this.toggleInput = undefined;
		return false;
	}

	private installInputListener(): void {
		if (this.stopInput || !this.context || !this.toggleInput) return;
		try {
			const stopInput = this.context.ui.onTerminalInput((data) => {
				if (!this.active || this.checkDisplacement()) return;
				const input = this.toggleInput;
				if (!input) return;
				let matches = false;
				try {
					matches = input.matches(data);
					if (!matches && !input.rawFallback && isKeyRelease(data)) {
						const parseKey = (PiTui as unknown as { parseKey?: (value: string) => string })
							.parseKey;
						const parsed = typeof parseKey === "function" ? parseKey(data) : undefined;
						matches = parsed !== undefined && input.keys.includes(parsed);
					}
				} catch {
					this.failToggleCapability("Pi's thinking-toggle matcher failed at runtime");
					return;
				}
				if (!matches) return;
				if (!isKeyRelease(data)) {
					this.expanded = !this.expanded;
					this.rerenderTracked();
				}
				return { consume: true };
			});
			if (typeof stopInput !== "function") {
				this.failToggleCapability("Pi's terminal input listener cleanup is unavailable");
				return;
			}
			this.stopInput = stopInput;
		} catch {
			this.failToggleCapability("Pi's terminal input listener is unavailable");
		}
	}

	private trackedEntries(): Array<[object, TrackedState]> {
		const entries: Array<[object, TrackedState]> = [];
		for (const reference of this.tracked) {
			const component = reference.deref();
			if (!component) {
				this.tracked.delete(reference);
				this.activeComponents.delete(reference);
				continue;
			}
			const state = this.states.get(component);
			if (state) entries.push([component, state]);
			else {
				this.tracked.delete(reference);
				this.activeComponents.delete(reference);
				this.references.delete(component);
			}
		}
		return entries;
	}

	private activeEntries(): Array<[object, TrackedState]> {
		const entries: Array<[object, TrackedState]> = [];
		for (const reference of this.activeComponents) {
			const component = reference.deref();
			if (!component) {
				this.activeComponents.delete(reference);
				this.tracked.delete(reference);
				continue;
			}
			const state = this.states.get(component);
			if (state?.incomplete) entries.push([component, state]);
			else this.activeComponents.delete(reference);
		}
		return entries;
	}

	private declineOwnership(component: object): void {
		try {
			this.dropComponent(component, true);
		} catch {
			// Native already completed; private bookkeeping must fail open.
		}
	}

	private dropComponent(component: object, dropTiming = false): void {
		const state = this.states.get(component);
		const reference = this.references.get(component);
		if (reference) {
			this.tracked.delete(reference);
			this.activeComponents.delete(reference);
		}
		this.references.delete(component);
		this.states.delete(component);
		if (!dropTiming || !state) return;
		const timestamp = messageTimestamp(state.message);
		if (timestamp === undefined) return;
		const stillReferenced = this.trackedEntries().some(
			([, tracked]) => messageTimestamp(tracked.message) === timestamp,
		);
		if (!stillReferenced) this.timings.delete(timestamp);
		if (this.currentMessage && messageTimestamp(this.currentMessage) === timestamp) {
			this.currentMessage = undefined;
		}
		this.reconcileTimer();
	}

	private enforceTrackedCapacity(): void {
		while (this.tracked.size > THINKING_EXPERIMENTAL_MAX_TRACKED_COMPONENTS) {
			const reference = this.tracked.values().next().value as WeakRef<object> | undefined;
			if (!reference) break;
			const component = reference.deref();
			const state = component ? this.states.get(component) : undefined;
			if (component && state?.folded) {
				this.restoreNative([[component, state]]);
				this.requestHostRender();
			}
			if (component) this.dropComponent(component);
			else {
				this.tracked.delete(reference);
				this.activeComponents.delete(reference);
			}
		}
	}

	private restoreNative(entries: Array<[object, TrackedState]>): number {
		let processed = 0;
		for (const [component, state] of entries) {
			processed += 1;
			const instance = component as PatchableAssistant;
			try {
				renderWithHiddenState(instance, state.predecessor, state.args, state.nativeHidden);
			} catch {
				// A stale transcript component must never break restoration of later components.
			} finally {
				setHiddenState(instance, state.nativeHidden);
				state.folded = false;
			}
		}
		return processed;
	}

	private rerenderEntries(entries: Array<[object, TrackedState]>, nativeOnly = false): number {
		let processed = 0;
		if (nativeOnly) return this.restoreNative(entries);
		this.rerendering = true;
		this.shapeFailureDuringRerender = undefined;
		try {
			for (const [component, state] of entries) {
				processed += 1;
				const instance = component as PatchableAssistant;
				try {
					const mode = this.activeMode;
					if (!mode) continue;
					if (mode === "streaming") {
						renderWithHiddenState(instance, state.predecessor, state.args, {
							own: true,
							value: false,
						});
					} else {
						renderWithHiddenState(instance, state.predecessor, state.args, state.nativeHidden);
						if (state.nativeHidden.value === true) continue;
					}
					state.folded = false;
					if (
						this.active &&
						(mode !== "streaming" || !this.expanded) &&
						hasThinking(state.message)
					) {
						if (
							!replaceThinkingChildren(
								instance,
								state.message,
								mode,
								state.incomplete,
								(hidden) => this.headerFor(state.message, state.incomplete, hidden),
								() => {
									const theme = this.context?.ui.theme as unknown as AccentTheme | undefined;
									if (!theme || typeof theme.fg !== "function")
										throw new Error("theme unavailable");
									return theme;
								},
							)
						) {
							this.failShape("Pi's private assistant renderer shape is incompatible");
							break;
						}
						state.folded = true;
					}
				} catch {
					this.dropComponent(component);
				}
				if (this.shapeFailureDuringRerender) break;
			}
		} finally {
			this.rerendering = false;
		}
		if (this.shapeFailureDuringRerender) {
			// The failed fold may already have revealed one component. Abort the outer
			// iteration and restore every original hidden state in one dedicated pass.
			processed = this.restoreNative(this.trackedEntries());
			this.shapeFailureDuringRerender = undefined;
			this.clearTrackedSnapshots();
		}
		return processed;
	}

	private rerenderTracked(nativeOnly = false): void {
		const entries = this.trackedEntries();
		const processed = this.rerenderEntries(entries, nativeOnly);
		if (processed > 0) this.requestHostRender();
	}

	private rerenderActive(): void {
		const entries = this.activeEntries();
		this.lastTimerWork = this.rerenderEntries(entries);
		if (this.lastTimerWork > 0) this.requestHostRender();
	}

	private requestHostRender(): void {
		this.requestRender();
	}

	private reconcileTimer(): void {
		if (!this.active || this.activeMode !== "streaming") {
			this.stopTimer();
			return;
		}
		if (this.activeEntries().length === 0) {
			this.stopTimer();
			return;
		}
		if (!this.interval) {
			this.interval = setInterval(() => {
				if (!this.active || this.checkDisplacement()) {
					this.stopTimer();
					return;
				}
				this.rerenderActive();
				this.reconcileTimer();
			}, 1000);
		}
	}

	private stopTimer(): void {
		if (this.interval) clearInterval(this.interval);
		this.interval = undefined;
	}

	private checkDisplacement(): boolean {
		if (
			this.installed &&
			(!AssistantMessageComponent ||
				!isPrototypePatchCurrent(
					AssistantMessageComponent.prototype,
					"updateContent",
					PATCH_ADAPTER,
					this.patchRegistration?.token,
				))
		) {
			if (!this.displaced) {
				this.displaced = true;
				this.active = false;
				this.restartRequired = true;
				// Restore every component synchronously before relinquishing input/timer ownership.
				this.rerenderTracked(true);
				this.clearTrackedSnapshots();
				this.stopTimer();
				this.stopInput?.();
				this.stopInput = undefined;
			}
		}
		return this.displaced;
	}

	private failShape(reason: string): void {
		this.unavailableReason = reason;
		this.active = false;
		this.stopTimer();
		this.stopInput?.();
		this.stopInput = undefined;
		if (this.rerendering) {
			this.shapeFailureDuringRerender = reason;
			return;
		}
		this.rerenderTracked(true);
		this.clearTrackedSnapshots();
	}

	private clearTrackedSnapshots(): void {
		this.tracked.clear();
		this.activeComponents.clear();
		this.references = new WeakMap();
		this.states = new WeakMap();
		this.lastTimerWork = 0;
	}

	private clearLiveState(): void {
		this.timings.clear();
		this.currentMessage = undefined;
	}

	private deactivate(): void {
		this.active = false;
		this.activeMode = undefined;
		this.expanded = false;
		this.stopTimer();
		this.stopInput?.();
		this.stopInput = undefined;
		this.rerenderTracked(true);
		// Cached host components stay native until Pi next rebuilds/updates them. Dropping
		// snapshots is intentional: reactivation must never replay pre-disable content.
		this.clearTrackedSnapshots();
		this.clearLiveState();
		this.toggleInput = undefined;
	}

	beginMessage(event: unknown): void {
		if (!this.active) return;
		const message = assistantMessage(event);
		if (!message) return;
		this.currentMessage = message;
		const timestamp = messageTimestamp(message);
		if (timestamp !== undefined) this.setTiming(timestamp, { startedAt: this.now() });
	}

	updateMessage(event: unknown): void {
		if (!this.active) return;
		const message = assistantMessage(event);
		if (!message) return;
		this.currentMessage = message;
		const type = eventType(event);
		if (beginsThinkingPhase(type)) this.reopen(message);
		else if (endsThinkingPhase(type)) this.complete(message);
	}

	endMessage(event: unknown): void {
		if (!this.active) return;
		const message = assistantMessage(event) ?? this.currentMessage;
		if (message) this.complete(message);
		this.currentMessage = undefined;
	}

	endAgent(): void {
		if (!this.active) return;
		if (this.currentMessage) this.complete(this.currentMessage);
		this.currentMessage = undefined;
	}

	private reopen(message: AssistantMessage): void {
		const timestamp = messageTimestamp(message);
		if (timestamp === undefined) return;
		const timing = this.timings.get(timestamp);
		if (timing?.completedAt === undefined) return;
		this.setTiming(timestamp, { startedAt: timing.startedAt ?? this.now() });
		const reopenedEntries = this.trackedEntries().filter(([, state]) => {
			if (messageTimestamp(state.message) !== timestamp) return false;
			state.incomplete = true;
			return true;
		});
		for (const [component] of reopenedEntries) {
			const reference = this.references.get(component);
			if (reference) this.activeComponents.add(reference);
		}
		const processed = this.rerenderEntries(reopenedEntries);
		if (processed > 0) this.requestHostRender();
		this.reconcileTimer();
	}

	private complete(message: AssistantMessage): void {
		const timestamp = messageTimestamp(message);
		if (timestamp === undefined) return;
		const timing = this.timings.get(timestamp);
		if (timing?.completedAt !== undefined) return;
		this.setTiming(timestamp, {
			...timing,
			completedAt: this.now(),
		});
		const completedEntries = this.activeEntries().filter(([, state]) => {
			if (messageTimestamp(state.message) !== timestamp) return false;
			state.incomplete = false;
			return true;
		});
		for (const [component] of completedEntries) {
			const reference = this.references.get(component);
			if (reference) this.activeComponents.delete(reference);
		}
		const processed = this.rerenderEntries(completedEntries);
		if (processed > 0) this.requestHostRender();
		this.reconcileTimer();
	}

	private setTiming(timestamp: number, timing: Timing): void {
		this.timings.set(timestamp, timing);
		this.pruneTimings();
	}

	private pruneTimings(): void {
		while (this.timings.size > MAX_TIMINGS) {
			const oldest = this.timings.keys().next().value;
			if (oldest === undefined) break;
			this.timings.delete(oldest);
		}
	}

	shutdown(): void {
		this.deactivate();
		this.startup = { enabled: false, mode: "tree" };
		this.restartRequired = false;
		this.patchRegistration?.();
		this.patchRegistration = undefined;
		this.installed = false;
		this.context = undefined;
		this.clearTrackedSnapshots();
		this.clearLiveState();
	}
}
