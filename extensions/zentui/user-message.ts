import { type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { ZentuiConfig } from "./config";
import { installPrototypePatch, removePrototypePatch } from "./prototype-patch-registry";
import { renderUserMessageStyle, userMessageStyleCacheKey } from "./user-message-styles";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const ESC = "\x1b";
const BEL = "\x07";
const C1_OSC = "\x9d";
const C1_ST = "\x9c";

function oscStartLength(text: string, index: number): number {
	if (text[index] === C1_OSC) return 1;
	return text[index] === ESC && text[index + 1] === "]" ? 2 : 0;
}

type OscBoundary =
	| { kind: "terminator"; index: number; length: number }
	| { kind: "start"; index: number };

function findOscBoundary(text: string, payloadStart: number): OscBoundary | undefined {
	for (let index = payloadStart; index < text.length; index += 1) {
		if (oscStartLength(text, index) > 0) return { kind: "start", index };
		if (text[index] === BEL || text[index] === C1_ST) {
			return { kind: "terminator", index, length: 1 };
		}
		if (text[index] === ESC && text[index + 1] === "\\") {
			return { kind: "terminator", index, length: 2 };
		}
	}
	return undefined;
}

function isCompleteOsc133Payload(payload: string): boolean {
	return payload === "133" || payload.startsWith("133;");
}

function incompleteOsc133PrefixLength(payload: string): number {
	if (payload.length > 0 && "133".startsWith(payload)) return payload.length;
	if (!payload.startsWith("133;")) return 0;

	let length = 4;
	if (/^[A-D]$/.test(payload[length] ?? "")) length += 1;
	if (payload[length] === ";") length += 1;
	return length;
}

function stripOsc133Sequences(text: string): string {
	let output = "";
	let index = 0;
	while (index < text.length) {
		const startLength = oscStartLength(text, index);
		if (startLength === 0) {
			output += text[index];
			index += 1;
			continue;
		}

		const payloadStart = index + startLength;
		const boundary = findOscBoundary(text, payloadStart);
		const payloadEnd = boundary?.index ?? text.length;
		const payload = text.slice(payloadStart, payloadEnd);
		if (boundary?.kind === "terminator") {
			const sequenceEnd = boundary.index + boundary.length;
			if (!isCompleteOsc133Payload(payload)) output += text.slice(index, sequenceEnd);
			index = sequenceEnd;
			continue;
		}

		// An unterminated OSC introducer must not remain open and consume a later
		// Zentui prompt marker. Preserve its human-readable payload, but remove a
		// recognized (including partial) OSC 133 command prefix. A nested OSC start
		// is processed independently on the next loop iteration.
		const prefixLength = incompleteOsc133PrefixLength(payload);
		output += payload.slice(prefixLength);
		index = payloadEnd;
		if (!boundary) break;
	}
	return output;
}

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
		text: stripOsc133Sequences(text),
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
				const width = args[0];
				if (typeof width !== "number") return Reflect.apply(predecessor, receiver, args);
				try {
					const lines = renderZentuiUserMessage(
						receiver as PatchableUserMessagePrototype,
						width,
						getTheme(),
						getConfig(),
					);
					if (!lines) return Reflect.apply(predecessor, receiver, args);
					return lines.length ? withPromptZoneMarkers(lines) : lines;
				} catch {
					return Reflect.apply(predecessor, receiver, args);
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
