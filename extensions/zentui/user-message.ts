import { type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ZentuiConfig } from "./config";
import { installPrototypePatch, removePrototypePatch } from "./prototype-patch-registry";
import {
	sanitizeRenderedUserMessageLines,
	sanitizeRenderedUserMessageText,
	sanitizeUserMessageSourceText,
} from "./user-message-osc";
import { renderUserMessageStyle, userMessageStyleCacheKey } from "./user-message-styles";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

type PatchableUserMessagePrototype = {
	children?: unknown[];
};

type Cleanup = () => void;

type UserMessageRenderCache = {
	hasMarkdownText: boolean;
	text?: string;
	width?: number;
	theme?: Theme;
	configKey?: string;
	renderedLines?: string[];
};

const userMessageRenderCache = new WeakMap<object, UserMessageRenderCache>();

function isObject(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findMarkdownText(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.text === "string") return value.text;

	const children = value.children;
	if (!Array.isArray(children)) return undefined;

	for (const child of children) {
		const text = findMarkdownText(child);
		if (text !== undefined) return text;
	}

	return undefined;
}

function getCachedMarkdownText(instance: object): string | undefined {
	const cached = userMessageRenderCache.get(instance);
	if (cached?.hasMarkdownText) return cached.text;

	const text = findMarkdownText(instance);
	if (text !== undefined) {
		userMessageRenderCache.set(instance, { ...cached, hasMarkdownText: true, text });
	}
	return text;
}

function renderZentuiUserMessage(
	instance: PatchableUserMessagePrototype,
	width: number,
	theme: Theme | undefined,
	config: ZentuiConfig,
): string[] | undefined {
	if (!isRecord(instance)) return undefined;

	const text = getCachedMarkdownText(instance);
	if (text === undefined) return undefined;
	const configKey = userMessageStyleCacheKey(config);
	const cached = userMessageRenderCache.get(instance);
	if (
		cached?.hasMarkdownText &&
		cached.width === width &&
		cached.theme === theme &&
		cached.configKey === configKey &&
		cached.renderedLines
	) {
		return cached.renderedLines;
	}

	const lines = renderUserMessageStyle({
		text,
		width,
		theme,
		config,
	});
	userMessageRenderCache.set(instance, {
		hasMarkdownText: true,
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
		text = isRecord(instance) ? getCachedMarkdownText(instance) : undefined;
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
					sanitizePredecessorRender(Reflect.apply(predecessor, receiver, args));
				const width = args[0];
				if (typeof width !== "number") return renderPredecessor();
				try {
					const lines = renderZentuiUserMessage(
						receiver as PatchableUserMessagePrototype,
						width,
						getTheme(),
						getConfig(),
					);
					if (!lines) return renderPredecessor();
					return lines.length ? withPromptZoneMarkers(lines) : lines;
				} catch {
					const safeFallback = renderSafeSourceFallback(
						receiver as PatchableUserMessagePrototype,
						width,
					);
					return safeFallback ?? renderPredecessor();
				}
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
