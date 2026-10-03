import * as PiTui from "@earendil-works/pi-tui";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

export type OmpEditorFrame = {
	editorLines: string[];
	trailingLines: string[];
	nativeStatusLine?: string;
};

type ChromeMethod = "renderTop" | "renderRow" | "renderBottom";
type ComposerStyle = Record<ChromeMethod, (...args: unknown[]) => unknown>;
type ComposerApi = {
	getComposerStyle?: (id: string) => ComposerStyle;
	isBuiltinComposerStyle?: (id: string) => boolean;
};
const api = PiTui as unknown as ComposerApi;
const frames = new WeakMap<string[], OmpEditorFrame>();

/** Read unframed rows through OMP's public composer contract; keep native layout/input untouched. */
export function renderWithOmpEditorFrame(
	source: { getBorderStyle?: () => unknown },
	width: number,
	render: () => string[],
): string[] {
	const id = source.getBorderStyle?.();
	if (typeof id !== "string" || !api.getComposerStyle || !api.isBuiltinComposerStyle?.(id))
		return render();
	const style = api.getComposerStyle(id);
	const methods: ChromeMethod[] = ["renderTop", "renderRow", "renderBottom"];
	const patches = methods.map((method) => ({
		method,
		descriptor: Object.getOwnPropertyDescriptor(style, method),
		wrapper: undefined as ((...args: unknown[]) => unknown) | undefined,
	}));
	if (
		patches.some(
			({ descriptor }) =>
				!descriptor?.writable || !descriptor.configurable || typeof descriptor.value !== "function",
		)
	)
		return render();
	let active = true;
	let compatible = true;
	let topCalls = 0;
	let bottomCalls = 0;
	let topRows = 0;
	let bottomRows = 0;
	let nativeStatus = false;
	const editorLines: string[] = [];
	const renderedBody: string[] = [];
	try {
		for (const patch of patches) {
			const descriptor = patch.descriptor;
			if (!descriptor) continue;
			const predecessor = descriptor.value;
			patch.wrapper = function (this: unknown, ...args: unknown[]) {
				const result: unknown = Reflect.apply(predecessor, this, args);
				if (!active) return result;
				if (patch.method === "renderRow") {
					const context = args[0];
					if (
						!context ||
						typeof context !== "object" ||
						!("text" in context) ||
						typeof context.text !== "string" ||
						!("pad" in context) ||
						typeof context.pad !== "string" ||
						("imeSafeCursorTail" in context && context.imeSafeCursorTail === true) ||
						!Array.isArray(result) ||
						!result.every((line): line is string => typeof line === "string")
					) {
						compatible = false;
						return result;
					}
					const text = context.text + context.pad;
					if (visibleWidth(text.replaceAll(CURSOR_MARKER, "")) > width) compatible = false;
					editorLines.push(text);
					renderedBody.push(...result);
					if (
						"topBorder" in context &&
						context.topBorder &&
						typeof context.topBorder === "object" &&
						"content" in context.topBorder &&
						typeof context.topBorder.content === "string" &&
						visibleWidth(context.topBorder.content) > 0
					)
						nativeStatus = true;
				} else {
					if (result !== undefined && typeof result !== "string") compatible = false;
					if (patch.method === "renderTop") {
						topCalls++;
						topRows = typeof result === "string" ? 1 : 0;
					} else {
						bottomCalls++;
						bottomRows = typeof result === "string" ? 1 : 0;
					}
				}
				return result;
			};
			Object.defineProperty(style, patch.method, { ...descriptor, value: patch.wrapper });
		}
		const lines = render();
		frames.delete(lines);
		const end = topRows + renderedBody.length + bottomRows;
		if (
			compatible &&
			topCalls === 1 &&
			bottomCalls === 1 &&
			editorLines.length > 0 &&
			end <= lines.length &&
			renderedBody.every((line, index) => lines[topRows + index] === line) &&
			patches.every(({ method, descriptor, wrapper }) => {
				const current = Object.getOwnPropertyDescriptor(style, method);
				return (
					current?.value === wrapper &&
					current?.writable === descriptor?.writable &&
					current?.configurable === descriptor?.configurable &&
					current?.enumerable === descriptor?.enumerable
				);
			})
		) {
			frames.set(lines, {
				editorLines,
				trailingLines: lines.slice(end),
				...(nativeStatus && topRows === 1 ? { nativeStatusLine: lines[0] } : {}),
			});
		}
		return lines;
	} finally {
		active = false;
		for (const { method, descriptor, wrapper } of patches) {
			const current = Object.getOwnPropertyDescriptor(style, method);
			if (descriptor && wrapper && current?.value === wrapper) {
				try {
					// Preserve a third party's descriptor changes while releasing only our method value.
					Object.defineProperty(style, method, { ...current, value: descriptor.value });
				} catch {
					// A locked wrapper remains an inactive delegate to the native predecessor.
				}
			}
		}
	}
}

/** Only rows proven to come from the owned native render have a captured payload. */
export function getOmpEditorFrame(lines: string[]): OmpEditorFrame | undefined {
	return frames.get(lines);
}
