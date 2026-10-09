import { stripVTControlCharacters } from "node:util";
import { initTheme, type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Markdown, Text, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installUserMessageStyle } from "../extensions/zentui/user-message";
import * as sourceBoundary from "../extensions/zentui/user-message-osc";

vi.mock("../extensions/zentui/user-message-osc", async (importOriginal) => {
	const original = await importOriginal<typeof sourceBoundary>();
	return {
		...original,
		sanitizeUserMessageSourceText: vi.fn(original.sanitizeUserMessageSourceText),
	};
});

initTheme("dark", false);
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.clearAllMocks();
});

const plain = (rows: string[]) => stripVTControlCharacters(rows.join("\n"));
const sourceCalls = (source: string) =>
	vi
		.mocked(sourceBoundary.sanitizeUserMessageSourceText)
		.mock.calls.filter(([text]) => text === source).length;

function markdownOf(message: UserMessageComponent): Markdown {
	const first = message.children[0];
	return (Reflect.get(first, "children")?.[0] ?? first) as Markdown;
}

function setup(source: string, delegated = true) {
	const config = structuredClone(defaultConfig);
	config.components.userMessages.style = "compact";
	let theme: Theme | undefined;
	const getTheme = vi.fn(() => theme);
	const getConfig = vi.fn(() => config);
	const message = new UserMessageComponent(source);
	if (delegated) message.addChild(new Text("SIBLING", 0, 0));
	const markdown = markdownOf(message);
	const cleanup = installUserMessageStyle(getTheme, getConfig);
	cleanups.push(cleanup);
	return {
		message,
		markdown,
		config,
		getTheme,
		getConfig,
		cleanup,
		setTheme: (value: Theme) => {
			theme = value;
		},
	};
}

function expectOwnedZones(rows: string[]) {
	for (const zone of ["A", "B", "C"])
		expect(rows.join("\n").split(`\x1b]133;${zone}\x07`)).toHaveLength(2);
}

describe("user-message sanitized source reuse", () => {
	it("skips only unchanged source sanitization on long delegated native cache hits", () => {
		const source = `\x1b]52;c;SECRET\x07${"界🙂 text\tvalue\n".repeat(2000)}TAIL\x1b[2J`;
		const { message, markdown, getTheme, getConfig } = setup(source);
		const descriptors = ["text", "options"].map((key) =>
			Object.getOwnPropertyDescriptor(markdown, key),
		);
		const render = vi.spyOn(markdown, "render");
		const first = message.render(80);
		expect(sourceCalls(source)).toBe(1);
		for (let index = 0; index < 3; index++) expect(message.render(80)).toEqual(first);
		expect(sourceCalls(source)).toBe(1);
		expect(render).toHaveBeenCalledTimes(4);
		expect(getTheme).toHaveBeenCalledTimes(4);
		expect(getConfig).toHaveBeenCalledTimes(4);
		expect(plain(first)).toContain("TAIL");
		expect(plain(first)).toContain("SIBLING");
		expect(first.join("\n")).not.toContain("SECRET");
		expect(first.join("\n")).not.toContain("\x1b[2J");
		expectOwnedZones(first);
		expect(
			["text", "options"].map((key) => Object.getOwnPropertyDescriptor(markdown, key)),
		).toEqual(descriptors);
	});

	it("rechecks changed source, replacement renderers and return-to-original source", () => {
		const before = "BEFORE\x1b[31m";
		const after = "AFTER\x9d52;c;SECRET\x9c";
		const { message, markdown } = setup(before);
		message.render(40);
		markdown.setText(after);
		expect(plain(message.render(40))).toContain("AFTER");
		expect(sourceCalls(after)).toBe(1);
		expect(message.render(40).join("\n")).not.toContain("SECRET");
		expect(sourceCalls(after)).toBe(1);
		// A direct field mutation must also miss, without relying on invalidate().
		Reflect.set(markdown, "text", before);
		expect(plain(message.render(40))).toContain("BEFORE");
		expect(sourceCalls(before)).toBe(2);
		const replacement = markdownOf(new UserMessageComponent(after));
		const parent = Reflect.get(message.children[0], "children") ? message.children[0] : message;
		Reflect.get(parent, "children")[0] = replacement;
		expect(plain(message.render(40))).toContain("AFTER");
		expect(sourceCalls(after)).toBe(2);
	});

	it("does not skip native invalidation, width changes or same-object theme updates", () => {
		const source = "**BOLD**\x1b[2J\n".repeat(20);
		const { message, markdown } = setup(source);
		const nativeTheme = Reflect.get(markdown, "theme");
		nativeTheme.bold = (text: string) => `\x1b[31m${text}\x1b[0m`;
		const first = message.render(80);
		nativeTheme.bold = (text: string) => `\x1b[32m${text}\x1b[0m`;
		expect(message.render(80)).toEqual(first);
		const invalidate = vi.spyOn(markdown, "invalidate");
		message.invalidate();
		expect(invalidate).toHaveBeenCalledOnce();
		expect(message.render(80).join("\n")).toContain("\x1b[32m");
		for (const width of [20, 80]) {
			const rows = message.render(width);
			expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
			expectOwnedZones(rows);
		}
		expect(sourceCalls(source)).toBe(1);
	});

	it("revalidates mutable options and executes changed transforms on invalidation when supported", () => {
		const { message, markdown } = setup("TOKEN\x1b[2J");
		const options = Reflect.get(markdown, "options");
		const transform = vi.fn((source: string) => `${source} FIRST\x1b]52;c;SECRET\x07`);
		options.transform = transform;
		const first = message.render(40);
		const supported = transform.mock.calls.length > 0;
		message.render(40);
		expect(transform).toHaveBeenCalledTimes(supported ? 1 : 0);
		options.transform = vi.fn((source: string) => `${source} SECOND\x1b[2J`);
		message.invalidate();
		const second = message.render(40);
		if (supported) {
			expect(plain(first)).toContain("FIRST");
			expect(plain(second)).toContain("SECOND");
			expect(options.transform).toHaveBeenCalledOnce();
		}
		expect(first.join("\n")).not.toContain("SECRET");
		expect(second.join("\n")).not.toContain("\x1b[2J");
		expect(sourceCalls("TOKEN\x1b[2J")).toBe(1);
	});

	it("restores descriptors after failures and retries the predecessor instead of caching its result", () => {
		const { message, markdown } = setup("SAFE\x1b[2J");
		const render = markdown.render;
		const descriptors = ["text", "options"].map((key) =>
			Object.getOwnPropertyDescriptor(markdown, key),
		);
		markdown.render = vi.fn(() => {
			throw new Error("render failed");
		});
		expect(() => message.render(40)).toThrow("render failed");
		expect(
			["text", "options"].map((key) => Object.getOwnPropertyDescriptor(markdown, key)),
		).toEqual(descriptors);
		markdown.render = render;
		expect(plain(message.render(40))).toContain("SAFE");
		expect(sourceCalls("SAFE\x1b[2J")).toBe(1);
	});

	it("preserves image Markdown and later-sibling fallback on source cache hits", () => {
		const { message } = setup("![image](https://example.test/image.png)\x1b[2J TAIL");
		const first = message.render(80);
		expect(message.render(80)).toEqual(first);
		expect(plain(first)).toContain("TAIL");
		expect(plain(first)).toContain("SIBLING");
		expectOwnedZones(first);
		const expected = [...first];
		first[0] = "CORRUPTED";
		expect(message.render(80)).toEqual(expected);
	});

	it("leaves native render/invalidate ownership intact through repeated install/dispose and reload", () => {
		const nativeRender = UserMessageComponent.prototype.render;
		const nativeInvalidate = UserMessageComponent.prototype.invalidate;
		const source = "SAFE\x1b[31mRAW\x1b[0m";
		const native = new UserMessageComponent(source);
		native.addChild(new Text("SIBLING", 0, 0));
		const before = native.render(80);
		for (let index = 0; index < 3; index++) {
			const cleanup = installUserMessageStyle(
				() => undefined,
				() => defaultConfig,
			);
			try {
				expect(native.render(80).join("\n")).not.toContain("\x1b[31mRAW");
				native.invalidate();
			} finally {
				cleanup();
				cleanup();
			}
			expect(UserMessageComponent.prototype.render).toBe(nativeRender);
			expect(UserMessageComponent.prototype.invalidate).toBe(nativeInvalidate);
			expect(native.render(80)).toEqual(before);
		}
	});
});

// The zero-padding framed adapter already owns a separate output cache. These
// tests ensure source reuse in delegated trees does not alter its cache keys.
describe("user-message framed cache compatibility", () => {
	it("tracks width, style, colors, theme identity and invalidation independently", () => {
		const { message, markdown, config, setTheme } = setup("**BOLD**", false);
		const first = message.render(40);
		expect(message.render(40)).toEqual(first);
		config.components.userMessages.style = "labeled";
		const second = message.render(40);
		// Hosts with padded/direct Markdown deliberately delegate unchanged.
		if (Reflect.get(markdown, "paddingX") === 0 && Reflect.get(message.children[0], "children")) {
			expect(second).not.toEqual(first);
			config.icons.rail = "┃";
			config.components.userMessages.style = "compact";
			expect(plain(message.render(40))).toContain("┃");
			const theme = { fg: (_color: unknown, text: string) => `\x1b[31m${text}\x1b[0m` } as Theme;
			config.components.userMessages.colorSource = "theme";
			setTheme(theme);
			const red = message.render(40);
			expect(red.join("\n")).toContain("\x1b[31m");
			setTheme({
				...theme,
				fg: (_color: unknown, text: string) => `\x1b[32m${text}\x1b[0m`,
			} as Theme);
			expect(message.render(40)).not.toEqual(red);
			config.components.userMessages.colorSource = "terminal";
			config.components.userMessages.colors = { accent: "fg:202" };
			expect(message.render(40).join("\n")).toContain("\x1b[38;5;202m");
		}
		message.invalidate();
		for (const width of [12, 40])
			expect(message.render(width).every((row) => visibleWidth(row) <= width)).toBe(true);
	});
});
