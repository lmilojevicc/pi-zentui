import { stripVTControlCharacters } from "node:util";
import { getMarkdownTheme, initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
	type Box,
	getCapabilities,
	type Markdown,
	setCapabilities,
	Text,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

initTheme("dark", false);
const cleanups: Array<() => void> = [];
let capabilities = getCapabilities();
beforeEach(() => {
	capabilities = getCapabilities();
	setCapabilities({ ...capabilities, hyperlinks: true });
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	setCapabilities(capabilities);
});
const plain = (rows: string[]) => stripVTControlCharacters(rows.join("\n"));
type Transform = (
	text: string,
	context: { messageType: string; isStreaming: boolean; availableWidth: number },
) => string;
function message(text: string, transformers: Transform[] = [], markdownTheme = getMarkdownTheme()) {
	return Reflect.construct(UserMessageComponent, [
		text,
		markdownTheme,
		1,
		transformers,
	]) as UserMessageComponent;
}
function install(style: "framed" | "framed-copy-friendly" | "compact" | "labeled") {
	const config = structuredClone(defaultConfig);
	config.components.userMessages.style = style;
	cleanups.push(
		installUserMessageStyle(
			() => undefined,
			() => config,
		),
	);
}
const probe = message("test");
const nativeOptions = (
	probe.children[0] as { children?: Array<{ options?: { transform?: unknown } }> }
).children?.[0]?.options;
const supportsNativeOptions = Boolean(nativeOptions);
const supportsNativeTransform = typeof nativeOptions?.transform === "function";

describe("native user-message adapter", () => {
	it.each(["framed", "framed-copy-friendly", "compact", "labeled"] as const)(
		"preserves lists and literal escapes in %s",
		(style) => {
			const source = "7. seven\n3. three\n\n\\*star\\* and \\backslash";
			const native = plain(message(source).render(80));
			install(style);
			const rendered = plain(message(source).render(80));
			for (const text of ["7. seven", "3. three", "\\*star\\*", "\\backslash"]) {
				if (supportsNativeOptions) expect(native).toContain(text);
				expect(rendered).toContain(text);
			}
		},
	);

	it.skipIf(!supportsNativeTransform)(
		"delegates the registered transform chain, error continuation, and exact content width",
		() => {
			const calls: Array<[string, number]> = [];
			const transformers: Transform[] = [
				(text, context) => {
					calls.push([text, context.availableWidth]);
					expect(context.messageType).toBe("user");
					expect(context.isStreaming).toBe(false);
					return text.replace("TOKEN", "FIRST");
				},
				(text, context) => {
					calls.push([text, context.availableWidth]);
					throw new Error("extension failed");
				},
				(text, context) => {
					calls.push([text, context.availableWidth]);
					return text.replace("FIRST", "FINAL");
				},
			];
			const native = message("TOKEN", transformers);
			expect(plain(native.render(40))).toContain("FINAL");
			expect(calls).toEqual([
				["TOKEN", 38],
				["FIRST", 38],
				["FIRST", 38],
			]);
			calls.length = 0;
			install("labeled");
			const styled = message("TOKEN", transformers);
			expect(plain(styled.render(40))).toContain("FINAL");
			expect(calls).toEqual([
				["TOKEN", 36],
				["FIRST", 36],
				["FIRST", 36],
			]);
			styled.render(40);
			expect(calls).toHaveLength(3);
			styled.render(20);
			expect(calls.slice(3)).toEqual([
				["TOKEN", 16],
				["FIRST", 16],
				["FIRST", 16],
			]);
		},
	);

	it("retains native Markdown theme, highlighting, resizing and invalidation", () => {
		let color = "\x1b[31m";
		const highlightCode = vi.fn((text: string) => [`${color}${text}\x1b[0m`]);
		const markdownTheme = { ...getMarkdownTheme(), highlightCode, codeBlockIndent: " " };
		install("compact");
		const styled = message("```ts\nconst value = '界🙂';\n```", [], markdownTheme);
		const first = styled.render(40);
		expect(highlightCode).toHaveBeenCalled();
		expect(first.join("\n")).toContain("\x1b[31m");
		color = "\x1b[32m";
		expect(styled.render(40)).toEqual(first);
		styled.invalidate();
		expect(styled.render(40).join("\n")).toContain("\x1b[32m");
		expect(styled.render(12).every((row) => visibleWidth(row) <= 12)).toBe(true);
		styled.setOutputPad?.(0);
		expect(styled.render(40).join("\n")).toContain("const value");
	});

	it.skipIf(!supportsNativeTransform)(
		"sanitizes source and transformed controls and emits only owned OSC zones",
		() => {
			const seen = vi.fn((source: string) => `${source}\x1b]52;c;c2VjcmV0\x07\x1b]133;A\x07 FINAL`);
			install("compact");
			const rows = message("\x1b[2J\x1b]133;A\x07TOKEN", [seen]).render(40);
			expect(seen.mock.calls[0]?.[0]).toBe("TOKEN");
			expect(rows.join("\n")).not.toContain("c2VjcmV0");
			expect(rows.join("\n")).not.toContain("\x1b[2J");
			for (const zone of ["A", "B", "C"])
				expect(rows.join("\n").split(`\x1b]133;${zone}\x07`)).toHaveLength(2);
			expect(plain(rows)).toContain("TOKEN FINAL");
		},
	);

	it("fails open for unfamiliar trees and preserves predecessor ownership", () => {
		const original = UserMessageComponent.prototype.render;
		const predecessor = vi.fn(() => ["predecessor"]);
		UserMessageComponent.prototype.render = predecessor;
		try {
			install("compact");
			const unknown = { children: [{ text: "not a native Markdown" }] };
			expect(UserMessageComponent.prototype.render.call(unknown, 40)).toEqual(["predecessor"]);
			const cleanup = cleanups.pop();
			cleanup?.();
			expect(UserMessageComponent.prototype.render).toBe(predecessor);
		} finally {
			UserMessageComponent.prototype.render = original;
		}
	});

	it("invalidates when the native child is rebuilt or its text changes", () => {
		install("compact");
		const styled = message("before");
		styled.render(40);
		const child = (styled.children[0] as unknown as { children: Markdown[] }).children[0];
		child.setText("after");
		expect(plain(styled.render(40))).toContain("after");
	});
});

const rawOpen = "\x1b]8;;custom:raw-source\x07";
const rawSgr = "\x1b[38;2;1;2;3m";
const unsafeSource = `before ${rawOpen}RAW_LINK\x1b]8;;\x07 ${rawSgr}RAW_SGR\x1b[0m [docs](https://markdown.example) **BOLD** after`;
const shapes = ["canonical", "paddingX", "box sibling", "root sibling"] as const;
function shapedMessage(
	source: string,
	shape: (typeof shapes)[number],
	transforms: Transform[] = [],
) {
	const result = message(source, transforms);
	const box = result.children[0] as Box;
	const markdown = box.children[0] as Markdown;
	if (shape === "paddingX") Reflect.set(markdown, "paddingX", 1);
	if (shape === "box sibling") box.addChild(new Text("SIBLING", 0, 0));
	if (shape === "root sibling") result.addChild(new Text("SIBLING", 0, 0));
	return { result, markdown, box };
}

describe("native user-message source boundary independent of framing", () => {
	it.each(shapes)("sanitizes %s without losing Markdown, theme or predecessor layout", (shape) => {
		const { result, markdown } = shapedMessage(unsafeSource, shape);
		const original = UserMessageComponent.prototype.render;
		const predecessor = vi.fn(function (this: UserMessageComponent, width: number) {
			expect(this).toBe(result);
			expect(width).toBe(200);
			return [...original.call(this, width), "PREDECESSOR"];
		});
		const cleanSource = "before RAW_LINK RAW_SGR [docs](https://markdown.example) **BOLD** after";
		const expected = plain(shapedMessage(cleanSource, shape).result.render(200));
		// Prime an unsafe native cache before installation as well.
		result.render(200);
		const textDescriptor = Object.getOwnPropertyDescriptor(markdown, "text");
		const optionsDescriptor = Object.getOwnPropertyDescriptor(markdown, "options");
		UserMessageComponent.prototype.render = predecessor;
		try {
			install("compact");
			const rows = result.render(200);
			const output = rows.join("\n");
			expect(output).not.toContain(rawOpen);
			expect(output).not.toContain(rawSgr);
			for (const text of ["RAW_LINK", "RAW_SGR", "docs", "BOLD", "before", "after"])
				expect(plain(rows)).toContain(text);
			expect(output).toMatch(/\x1b\]8;;https:\/\/markdown\.example(?:\x07|\x1b\\)/);
			expect(output).toMatch(/\x1b\[38;2;[0-9;]+m/);
			for (const zone of ["A", "B", "C"])
				expect(output.split(`\x1b]133;${zone}\x07`)).toHaveLength(2);
			if (shape !== "canonical") {
				expect(plain(rows)).toBe(`${expected}\nPREDECESSOR`);
				expect(predecessor).toHaveBeenCalledOnce();
			}
			expect(Object.getOwnPropertyDescriptor(markdown, "text")).toEqual(textDescriptor);
			expect(Object.getOwnPropertyDescriptor(markdown, "options")).toEqual(optionsDescriptor);
			expect(result.render(200)).toEqual(rows);
			cleanups.pop()?.();
			expect(UserMessageComponent.prototype.render).toBe(predecessor);
			expect(result.render(200).join("\n")).toContain(rawOpen);
		} finally {
			cleanups.pop()?.();
			UserMessageComponent.prototype.render = original;
		}
	});

	it.skipIf(!supportsNativeTransform)(
		"preserves transform order, errors, widths and cache invalidation on rejected trees",
		() => {
			const calls: Array<[string, number]> = [];
			const { result, markdown } = shapedMessage(`${rawSgr}TOKEN`, "paddingX", [
				(source, ctx) => {
					calls.push([source, ctx.availableWidth]);
					return source.replace("TOKEN", "FIRST");
				},
				(source, ctx) => {
					calls.push([source, ctx.availableWidth]);
					throw new Error("extension failed");
				},
				(source, ctx) => {
					calls.push([source, ctx.availableWidth]);
					return `${source.replace("FIRST", "FINAL")}${rawOpen}LINK\x1b]8;;\x07`;
				},
			]);
			install("compact");
			const rows = result.render(40);
			expect(calls).toEqual([
				["TOKEN", 36],
				["FIRST", 36],
				["FIRST", 36],
			]);
			expect(plain(rows)).toContain("FINALLINK");
			expect(rows.join("\n")).not.toContain(rawOpen);
			expect(result.render(40)).toEqual(rows);
			expect(calls).toHaveLength(3);
			result.invalidate();
			result.render(40);
			expect(calls).toHaveLength(6);
			markdown.setText("CHANGED");
			expect(plain(result.render(40))).toContain("CHANGEDLINK");
			result.render(20);
			expect(calls.at(-1)).toEqual(["CHANGED", 16]);
			cleanups.pop()?.();
			expect(result.render(20).join("\n")).toContain(rawOpen);
		},
	);

	it.each(["render", "transform"])(
		"restores source/options exactly after a throwing %s",
		(failure) => {
			const { result, markdown } = shapedMessage(unsafeSource, "root sibling");
			const options = Reflect.get(markdown, "options");
			if (failure === "transform")
				options.transform = function (this: object, source: string, width: number) {
					expect(this).toBe(options);
					expect(source).not.toContain(rawOpen);
					expect(width).toBe(38);
					throw new Error("failure");
				};
			else
				markdown.render = function () {
					expect(this).toBe(markdown);
					throw new Error("failure");
				};
			const descriptors = ["text", "options"].map((key) =>
				Object.getOwnPropertyDescriptor(markdown, key),
			);
			install("compact");
			expect(() => result.render(40)).toThrow("failure");
			expect(
				["text", "options"].map((key) => Object.getOwnPropertyDescriptor(markdown, key)),
			).toEqual(descriptors);
		},
	);
});

describe("source boundary fallback ownership", () => {
	it("keeps a rejected native tree and Markdown semantics when the theme getter fails", () => {
		const { result, markdown } = shapedMessage(unsafeSource, "root sibling");
		cleanups.push(
			installUserMessageStyle(
				() => {
					throw new Error("theme unavailable");
				},
				() => defaultConfig,
			),
		);
		const rows = result.render(200);
		expect(plain(rows)).toContain("SIBLING");
		expect(rows.join("\n")).toContain("https://markdown.example");
		expect(rows.join("\n")).not.toContain(rawOpen);
		expect(rows.join("\n")).not.toContain(rawSgr);
		expect(Reflect.get(markdown, "text")).toBe(unsafeSource);
	});

	it("fails open for arbitrary predecessor shapes, preserving generated links/theme and source ownership", () => {
		const original = UserMessageComponent.prototype.render;
		const unknown = { children: [{ text: unsafeSource }] };
		const generated =
			"\x1b]8;;https://predecessor.example\x07docs\x1b]8;;\x07 \x1b[31mtheme\x1b[0m";
		const predecessor = vi.fn(function (this: unknown, width: number) {
			expect(this).toBe(unknown);
			expect(width).toBe(80);
			return [generated, "SIBLING\x1b[2J"];
		});
		UserMessageComponent.prototype.render = predecessor;
		try {
			cleanups.push(
				installUserMessageStyle(
					() => {
						throw new Error("theme unavailable");
					},
					() => defaultConfig,
				),
			);
			expect(UserMessageComponent.prototype.render.call(unknown, 80)).toEqual([
				generated,
				"SIBLING",
			]);
			expect(unknown.children[0].text).toBe(unsafeSource);
			expect(predecessor).toHaveBeenCalledOnce();
		} finally {
			cleanups.pop()?.();
			UserMessageComponent.prototype.render = original;
		}
	});
});
