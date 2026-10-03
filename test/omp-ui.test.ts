import type { ExtensionUIContext } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { replaceEditorComponentWithExpandedText } from "../extensions/zentui/editor-transfer";
import { createOmpUiAdapter } from "../extensions/zentui/omp-ui";

type Buffer = { getText(): string; getExpandedText(): string; setText(text: string): void };
function buffer(initial = ""): Buffer {
	let text = initial;
	return {
		getText: () => text,
		getExpandedText: () => (text === "[paste #1]" ? "first line\nsecond line" : text),
		setText(next) {
			text = next;
		},
	};
}

/** OMP binds and caches delegated methods independently for each event handler. */
function scope(ui: ExtensionUIContext): ExtensionUIContext {
	const cache = new Map<PropertyKey, unknown>();
	return new Proxy(ui, {
		get(target, key) {
			if (cache.has(key)) return cache.get(key);
			const value: unknown = Reflect.get(target, key);
			if (typeof value !== "function") return value;
			const bound: unknown = value.bind(target);
			cache.set(key, bound);
			return bound;
		},
	});
}

function host() {
	let active = buffer("draft");
	const statuses = new Map<string, string>();
	const native = {
		getEditorText: () => active.getText(),
		setEditorText(text: string) {
			active.setText(text);
		},
		setEditorComponent(factory?: () => Buffer) {
			const draft = active.getText();
			active = factory?.() ?? buffer();
			active.setText(draft);
		},
		setStatus(key: string, value: string | undefined) {
			if (value === undefined) statuses.delete(key);
			else statuses.set(key, value);
		},
	} as unknown as ExtensionUIContext;
	return {
		native,
		statuses,
		get active() {
			return active;
		},
	};
}

describe("OMP handler-scoped editor ownership", () => {
	it("preserves an expanded paste when settings replace the editor from a later handler", () => {
		const h = host();
		const first = createOmpUiAdapter(scope(h.native));
		const installed = buffer();
		const factory = () => installed;
		try {
			expect(replaceEditorComponentWithExpandedText(first.ui, factory as never)).toEqual({
				ok: true,
			});
			expect(installed.getText()).toBe("draft");
			installed.setText("[paste #1]");
			const next = createOmpUiAdapter(scope(h.native));
			expect(replaceEditorComponentWithExpandedText(next.ui, undefined)).toEqual({ ok: true });
			expect(h.active.getText()).toBe("first line\nsecond line");
		} finally {
			first.dispose();
		}
	});

	it("does not undo a later extension's editor setter or draft on disposal", () => {
		const h = host();
		const adapter = createOmpUiAdapter(scope(h.native));
		const setter = h.native.setEditorComponent;
		const foreign = buffer("foreign draft");
		h.native.setEditorComponent = () => {
			h.active.setText(foreign.getText());
		};
		adapter.dispose();
		h.native.setEditorComponent(undefined);
		expect(h.active.getText()).toBe("foreign draft");
		expect(h.native.setEditorComponent).not.toBe(setter);
	});
});
