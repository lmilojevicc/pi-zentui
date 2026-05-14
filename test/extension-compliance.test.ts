import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import zentui from "../extensions/zentui/index";
import { PolishedEditor } from "../extensions/zentui/ui";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type FooterFactory = (...args: unknown[]) => {
	render(width: number): string[];
	dispose?: () => void;
};

const originalUserMessageRender = UserMessageComponent.prototype.render;

function makeTheme(): Theme {
	return {
		fg(_color: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
	} as Theme;
}

function loadExtension() {
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
		},
		getThinkingLevel() {
			return "off";
		},
	} as never);
	return handlers;
}

async function emit(handlers: Map<string, Handler[]>, eventName: string, ctx: unknown) {
	for (const handler of handlers.get(eventName) ?? []) {
		await handler({}, ctx);
	}
}

function makeContext(overrides: Record<string, unknown> = {}) {
	const theme = makeTheme();
	return {
		hasUI: true,
		cwd: process.cwd(),
		model: { id: "claude-sonnet", provider: "anthropic", contextWindow: 200_000 },
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 0.5 }),
		ui: {
			theme,
			setFooter() {},
			setEditorComponent() {},
		},
		...overrides,
	};
}

afterEach(() => {
	UserMessageComponent.prototype.render = originalUserMessageRender;
	(UserMessageComponent.prototype as unknown as Record<string, unknown>).__zentuiUserMessagePatch =
		undefined;
});

describe("Pi docs compliance", () => {
	it("uses the current @earendil-works Pi packages instead of the old @mariozechner scope", () => {
		const files = [
			"package.json",
			"extensions/zentui/config.ts",
			"extensions/zentui/index.ts",
			"extensions/zentui/ui.ts",
		];
		const content = files.map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");

		expect(content).not.toContain("@mariozechner/");
		expect(content).toContain("@earendil-works/");
	});

	it("does not install interactive TUI components when ctx.hasUI is false", async () => {
		const handlers = loadExtension();
		const throwingUi = {
			theme: makeTheme(),
			setFooter() {
				throw new Error("setFooter should not be called without UI");
			},
			setEditorComponent() {
				throw new Error("setEditorComponent should not be called without UI");
			},
		};
		const ctx = makeContext({ hasUI: false, ui: throwingUi });

		await expect(emit(handlers, "session_start", ctx)).resolves.toBeUndefined();
	});

	it("does not mutate Pi's built-in UserMessageComponent prototype", async () => {
		const handlers = loadExtension();
		const ctx = makeContext();

		await emit(handlers, "session_start", ctx);

		expect(UserMessageComponent.prototype.render).toBe(originalUserMessageRender);
		await emit(handlers, "session_shutdown", ctx);
	});

	it("keeps custom footer output within the requested render width", async () => {
		const handlers = loadExtension();
		let footerFactory: FooterFactory | undefined;
		const ui = {
			theme: makeTheme(),
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent() {},
		};
		const ctx = makeContext({ ui });

		await emit(handlers, "session_start", ctx);

		expect(footerFactory).toBeTypeOf("function");
		const footer = footerFactory?.({ requestRender() {} }, makeTheme(), {
			onBranchChange: () => () => {},
		});
		const lines = footer?.render(1) ?? [];

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 1)).toBe(true);
		footer?.dispose?.();
		await emit(handlers, "session_shutdown", ctx);
	});

	it("keeps custom editor output within the requested render width", () => {
		const editor = new PolishedEditor(
			{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{} as never,
			makeTheme(),
			() => "claude-sonnet  Anthropic",
			() => "off",
		);

		const lines = editor.render(1);

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 1)).toBe(true);
	});
});
