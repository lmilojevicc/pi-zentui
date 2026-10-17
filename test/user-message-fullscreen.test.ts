import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

initTheme("dark", false);

// Pi's fullscreen renderer (pi-tui layout.js and tui-alt-screen.js) strips only a
// leading run of OSC 133 zone markers from each row before painting the screen.
const FULLSCREEN_ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
const ZONE_START = "\x1b]133;A\x07";
const ZONE_END_AND_FINAL = "\x1b]133;B\x07\x1b]133;C\x07";

const styles = ["framed", "framed-copy-friendly", "compact", "labeled"] as const;
const messages = [
	"hello",
	"日本語のテキスト、長い文章です",
	"😀 emoji 👨‍👩‍👧",
	"[Image #1] /var/folders/xx/T/pi-clipboard-0f3a9c.png",
	"line one\nline two",
	"x".repeat(120),
];

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function install(style: (typeof styles)[number], getTheme: () => undefined = () => undefined) {
	const config = structuredClone(defaultConfig);
	config.components.userMessages.style = style;
	cleanups.push(installUserMessageStyle(getTheme, () => config));
}

const fullscreenRows = (rows: string[]) =>
	rows.map((row) => row.replace(FULLSCREEN_ZONE_PREFIX, ""));

describe("user messages in fullscreen mode", () => {
	it.each(styles.flatMap((style) => messages.map((text) => [style, text] as const)))(
		"leaves no OSC 133 marker behind the fullscreen prefix strip for %s %j",
		(style, text) => {
			install(style);
			for (const width of [1, 3, 10, 40, 80]) {
				const rows = new UserMessageComponent(text).render(width);
				expect(rows.join("\n").match(/\x1b\]133;A\x07/g)).toHaveLength(1);
				expect(rows.join("\n").match(/\x1b\]133;B\x07/g)).toHaveLength(1);
				expect(rows.join("\n").match(/\x1b\]133;C\x07/g)).toHaveLength(1);
				for (const row of fullscreenRows(rows)) expect(row).not.toContain("\x1b]133;");
			}
		},
	);

	it.each(styles)("keeps %s rows within the width and stable between renders", (style) => {
		install(style);
		for (const text of messages) {
			for (const width of [1, 3, 10, 40, 80]) {
				const message = new UserMessageComponent(text);
				const first = message.render(width);
				for (const row of fullscreenRows(first))
					expect(visibleWidth(row)).toBeLessThanOrEqual(width);
				expect(message.render(width)).toEqual(first);
				expect(new UserMessageComponent(text).render(width)).toEqual(first);
			}
		}
	});

	it("places single-row zone markers where Pi's native message places them", () => {
		install("compact");
		const [row, ...rest] = new UserMessageComponent("hello").render(40);
		expect(rest).toEqual([]);
		expect(row.startsWith(ZONE_START + ZONE_END_AND_FINAL)).toBe(true);
	});

	it("places single-row zone markers at the row start when the source fallback renders", () => {
		install("compact", () => {
			throw new Error("theme unavailable");
		});
		const [row, ...rest] = new UserMessageComponent("hi\x1b[2J there").render(40);
		expect(rest).toEqual([]);
		expect(row.startsWith(ZONE_START + ZONE_END_AND_FINAL)).toBe(true);
		expect(row.replace(FULLSCREEN_ZONE_PREFIX, "")).toBe("hi there");
	});
});
