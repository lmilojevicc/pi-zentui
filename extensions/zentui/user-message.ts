import { type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Markdown, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ZentuiConfig } from "./config";
import { installPrototypePatch, removePrototypePatch } from "./prototype-patch-registry";
import {
	sanitizeRenderedUserMessageLines,
	sanitizeRenderedUserMessageText,
	sanitizeUserMessageSourceText,
} from "./user-message-osc";
import {
	renderUserMessageStyle,
	type UserMessageStyleRenderInput,
	userMessageStyleCacheKey,
} from "./user-message-styles";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

type PatchableUserMessagePrototype = {
	children?: unknown[];
};

type Cleanup = () => void;

type UserMessageRenderCache = {
	markdown: object;
	text: string;
	width: number;
	theme?: Theme;
	configKey: string;
	renderedLines: string[];
};

const userMessageRenderCache = new WeakMap<object, UserMessageRenderCache>();

function isObject(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNativeMarkdown(renderer: unknown): boolean {
	return (
		isRecord(renderer) &&
		renderer.constructor?.name === "Markdown" &&
		typeof renderer.text === "string" &&
		["render", "setText", "invalidate"].every((key) => typeof renderer[key] === "function")
	);
}

const sanitizedMarkdownCache = new WeakMap<
	object,
	{ lines: unknown; text: string; options: unknown }
>();

// Framing eligibility is deliberately narrower than the source trust boundary.
// Unknown renderers still fail open: rendered controls alone cannot distinguish
// raw input from renderer-generated hyperlinks or theme styles.
function withSanitizedMarkdownSources<T>(instance: unknown, render: (adapted: boolean) => T): T {
	const restore: Array<() => void> = [];
	const visited = new Set<object>();
	const visit = (value: unknown) => {
		if (!isRecord(value) || visited.has(value)) return;
		visited.add(value);
		if (isNativeMarkdown(value)) {
			const text = Object.getOwnPropertyDescriptor(value, "text");
			const options = Object.getOwnPropertyDescriptor(value, "options");
			const cachedText = Object.getOwnPropertyDescriptor(value, "cachedText");
			if (!text?.writable || !options?.writable || !cachedText?.writable) return;
			if (!isRecord(options.value)) return;
			const transform = options.value.transform;
			if (transform !== undefined && typeof transform !== "function") return;
			const source = sanitizeUserMessageSourceText(text.value);
			const safeOptions = {
				...options.value,
				...(transform
					? {
							transform: (input: string, width: number) =>
								sanitizeUserMessageSourceText(
									Reflect.apply(transform, options.value, [input, width]),
								),
						}
					: {}),
			};
			const cached = sanitizedMarkdownCache.get(value);
			restore.push(() => {
				Object.defineProperty(value, "text", text);
				Object.defineProperty(value, "options", options);
				// Never let a native/unpatched render reuse a source-sanitized cache.
				// Keep the lines only for the next guarded render; invalidate() clears
				// them normally, and cleanup needs no retained component references.
				sanitizedMarkdownCache.set(value, {
					lines: value.cachedText === source ? value.cachedLines : undefined,
					text: source,
					options: options.value,
				});
				Object.defineProperty(value, "cachedText", { ...cachedText, value: undefined });
			});
			value.text = source;
			value.options = safeOptions;
			value.cachedText =
				cached?.lines &&
				cached.lines === value.cachedLines &&
				cached.text === source &&
				cached.options === options.value
					? source
					: undefined;
			return;
		}
		if (Array.isArray(value.children)) for (const child of value.children) visit(child);
	};
	try {
		try {
			visit(instance);
		} catch {
			// Uninspectable predecessor state remains outside the native adapter.
		}
		return render(restore.length > 0);
	} finally {
		for (const undo of restore.reverse()) undo();
	}
}

// Normal user messages have no public framing renderer. Only adapt the native
// zero-padding Markdown child; unfamiliar component trees delegate unchanged.
// Shape checks also support separate same-version Pi TUI package instances.
function nativeMarkdown(instance: PatchableUserMessagePrototype):
	| {
			renderer: Markdown;
			text: string;
			input: NonNullable<UserMessageStyleRenderInput["markdown"]>;
	  }
	| undefined {
	const children = instance.children;
	if (!Array.isArray(children) || children.length !== 1) return undefined;
	const box = children[0];
	if (!isRecord(box) || !Array.isArray(box.children) || box.children.length !== 1) return undefined;
	const renderer = box.children[0];
	if (!isNativeMarkdown(renderer)) return undefined;
	const child = renderer as unknown as Record<string, unknown>;
	if (
		typeof child.text !== "string" ||
		child.paddingX !== 0 ||
		child.paddingY !== 0 ||
		!isRecord(child.theme)
	)
		return undefined;
	for (const key of [
		"heading",
		"link",
		"linkUrl",
		"code",
		"codeBlock",
		"codeBlockBorder",
		"quote",
		"quoteBorder",
		"hr",
		"listBullet",
		"bold",
		"italic",
		"underline",
		"strikethrough",
	]) {
		if (typeof child.theme[key] !== "function") return undefined;
	}
	if (child.options !== undefined && !isRecord(child.options)) return undefined;
	if (
		isRecord(child.options) &&
		child.options.transform !== undefined &&
		typeof child.options.transform !== "function"
	)
		return undefined;
	if (child.defaultTextStyle !== undefined && !isRecord(child.defaultTextStyle)) return undefined;
	return {
		renderer: renderer as unknown as Markdown,
		text: child.text,
		input: {
			theme: child.theme as unknown as NonNullable<
				UserMessageStyleRenderInput["markdown"]
			>["theme"],
			defaultTextStyle: child.defaultTextStyle as NonNullable<
				UserMessageStyleRenderInput["markdown"]
			>["defaultTextStyle"],
			options: child.options as NonNullable<UserMessageStyleRenderInput["markdown"]>["options"],
		},
	};
}

function renderZentuiUserMessage(
	instance: PatchableUserMessagePrototype,
	width: number,
	theme: Theme | undefined,
	config: ZentuiConfig,
): string[] | undefined {
	if (!isRecord(instance)) return undefined;

	const native = nativeMarkdown(instance);
	if (!native) return undefined;
	const text = native.text;
	const configKey = userMessageStyleCacheKey(config);
	const cached = userMessageRenderCache.get(instance);
	if (
		cached?.markdown === native.renderer &&
		cached.text === text &&
		cached.width === width &&
		cached.theme === theme &&
		cached.configKey === configKey &&
		cached.renderedLines
	) {
		return cached.renderedLines;
	}

	const lines = renderUserMessageStyle({
		markdown: native.input,
		text,
		width,
		theme,
		config,
	});
	userMessageRenderCache.set(instance, {
		markdown: native.renderer,
		text,
		width,
		theme,
		configKey,
		renderedLines: lines,
	});
	return lines;
}

function withPromptZoneMarkers(lines: string[]): string[] {
	if (lines.length === 1) {
		return [`${OSC133_ZONE_START}${lines[0]}${OSC133_ZONE_END}${OSC133_ZONE_FINAL}`];
	}
	const markedLines = [...lines];
	markedLines[0] = OSC133_ZONE_START + markedLines[0];
	markedLines[markedLines.length - 1] =
		OSC133_ZONE_END + OSC133_ZONE_FINAL + markedLines[markedLines.length - 1];
	return markedLines;
}

function sanitizePredecessorRender(result: unknown): unknown {
	if (typeof result === "string") return sanitizeRenderedUserMessageText(result);
	if (!Array.isArray(result)) return result;
	const stringRows = result.every((line): line is string => typeof line === "string");
	if (stringRows) return sanitizeRenderedUserMessageLines(result);
	return result.map((line) =>
		typeof line === "string" ? sanitizeRenderedUserMessageText(line) : line,
	);
}

function renderSafeSourceFallback(
	instance: PatchableUserMessagePrototype,
	width: number,
): string[] | undefined {
	let text: string | undefined;
	try {
		// A plain fallback is only for an eligible frame that failed to render.
		// Never replace an unfamiliar predecessor tree (and its siblings) with it.
		text = isRecord(instance) ? nativeMarkdown(instance)?.text : undefined;
	} catch {
		return undefined;
	}
	if (text === undefined) return undefined;
	const stripped = sanitizeUserMessageSourceText(text);
	if (stripped === text) return undefined;
	const lines = (width > 0 ? wrapTextWithAnsi(stripped, width) : [""]).map(
		sanitizeRenderedUserMessageText,
	);
	return withPromptZoneMarkers(lines.length > 0 ? lines : [""]);
}

export function removeUserMessageStyle(): void {
	const prototype = UserMessageComponent.prototype;
	removePrototypePatch(prototype, "render", "user-message-render");
	removePrototypePatch(prototype, "invalidate", "user-message-invalidate");
}

export function installUserMessageStyle(
	getTheme: () => Theme | undefined,
	getConfig: () => ZentuiConfig,
): Cleanup {
	const prototype = UserMessageComponent.prototype;
	const cleanupInvalidate = installPrototypePatch(
		prototype,
		"invalidate",
		"user-message-invalidate",
		({ predecessor, receiver, args }) => {
			if (isObject(receiver)) userMessageRenderCache.delete(receiver);
			return Reflect.apply(predecessor, receiver, args);
		},
	);
	let cleanupRender: Cleanup;
	try {
		cleanupRender = installPrototypePatch(
			prototype,
			"render",
			"user-message-render",
			({ predecessor, receiver, args }) => {
				const renderPredecessor = () =>
					withSanitizedMarkdownSources(receiver, (adapted) => {
						const result = sanitizePredecessorRender(Reflect.apply(predecessor, receiver, args));
						return adapted &&
							Array.isArray(result) &&
							result.length > 0 &&
							result.every((row) => typeof row === "string")
							? withPromptZoneMarkers(result)
							: result;
					});
				const width = args[0];
				if (typeof width !== "number") return renderPredecessor();
				try {
					const lines = renderZentuiUserMessage(
						receiver as PatchableUserMessagePrototype,
						width,
						getTheme(),
						getConfig(),
					);
					if (lines) return lines.length ? withPromptZoneMarkers(lines) : lines;
				} catch {
					const safeFallback = renderSafeSourceFallback(
						receiver as PatchableUserMessagePrototype,
						width,
					);
					if (safeFallback) return safeFallback;
				}
				return renderPredecessor();
			},
		);
	} catch (error) {
		cleanupInvalidate();
		throw error;
	}
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		cleanupRender();
		cleanupInvalidate();
	};
}
