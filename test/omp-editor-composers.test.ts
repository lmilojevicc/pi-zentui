import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type * as PiTui from "@earendil-works/pi-tui";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolishedTuiConfig } from "../extensions/zentui/config";
import { mergeConfig } from "../extensions/zentui/config";
import { PolishedEditor } from "../extensions/zentui/ui";

const nativeApi = vi.hoisted(() => ({ styles: new Map<string, object>() }));
vi.mock("@earendil-works/pi-tui", async () => ({
	...(await vi.importActual<typeof PiTui>("@earendil-works/pi-tui")),
	getComposerStyle: (id: string) => nativeApi.styles.get(id),
	isBuiltinComposerStyle: (id: string) => nativeApi.styles.has(id),
}));

type ChromeContext = {
	width: number;
	topBorder?: { content: string; width: number };
};
type RowContext = ChromeContext & {
	text: string;
	pad: string;
	gutter: string;
	paddingX: number;
};
type NativeStyle = {
	renderTop: (context: ChromeContext) => string | undefined;
	renderRow: (context: RowContext) => string[];
	renderBottom: (context: ChromeContext) => string | undefined;
};
type NativeEditor = CustomEditor & {
	getBorderStyle(): string;
	debugChildren: Array<{ render(width: number): string[] }>;
};

function theme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		inverse: (text: string) => text,
	} as Theme;
}

function config(): PolishedTuiConfig {
	const base = mergeConfig({ icons: { mode: "nerd" } }, {});
	return {
		...base,
		components: {
			...base.components,
			editor: {
				...base.components.editor,
				style: "opencode",
				styles: {
					...base.components.editor.styles,
					opencode: { ...base.components.editor.styles.opencode, completionMenu: "native" },
				},
			},
		},
	};
}

function standalone(
	id = "rail",
	completions: string[] = [],
	style: PolishedTuiConfig["components"]["editor"]["style"] = "opencode",
) {
	let currentConfig = config();
	currentConfig.components.editor.style = style;
	const editor = new PolishedEditor(
		{ requestRender() {}, terminal: { rows: 24, cols: 80 } } as never,
		{ borderColor: (text: string) => text, selectList: {} } as never,
		{} as never,
		theme(),
		() => currentConfig,
		() => ({ modelLabel: "composer-model", providerLabel: "composer-provider" }),
		() => "high",
		() => ({ cwd: "/repo", modelLabel: "composer-model", thinkingLevel: "high" }),
	);
	Object.assign(editor, {
		getBorderStyle: () => id,
		isShowingAutocomplete: () => completions.length > 0,
		debugChildren: [
			{
				filteredItems: completions.map((value) => ({ value })),
				selectedIndex: 0,
				maxVisible: Math.max(1, completions.length),
				render: (_width: number) => completions,
			},
		],
	});
	editor.focused = true;
	return {
		editor,
		disableDecoration() {
			currentConfig = {
				...currentConfig,
				components: {
					...currentConfig.components,
					editor: { ...currentConfig.components.editor, enabled: false },
				},
			};
		},
	};
}

// Model OMP's public composer calls rather than a Pi-shaped preframed array.
// Rail has no top/bottom rows; Claude attaches native status to its top rule.
function installNativeRenderer(
	options: {
		id?: "rail" | "claude";
		status?: string;
		beforeRow?: () => void;
		afterRows?: () => void;
		onTop?: (row: string | undefined) => void;
	} = {},
) {
	const id = options.id ?? "rail";
	const style: NativeStyle =
		id === "rail"
			? {
					renderTop: () => undefined,
					renderRow: (context) => [`▎${context.gutter}${context.text}${context.pad} `],
					renderBottom: () => undefined,
				}
			: {
					renderTop: (context) => {
						const chip = context.topBorder?.content ?? "";
						return `${"─".repeat(Math.max(0, context.width - visibleWidth(chip)))}${chip}`;
					},
					renderRow: (context) => [`${context.gutter}${context.text}${context.pad}`],
					renderBottom: (context) => "─".repeat(context.width),
				};
	nativeApi.styles.set(id, style);
	vi.spyOn(CustomEditor.prototype, "render").mockImplementation(function (
		this: CustomEditor,
		width,
	) {
		const source = this as NativeEditor;
		const selectedStyle = nativeApi.styles.get(source.getBorderStyle()) as NativeStyle;
		const context: ChromeContext = {
			width,
			...(options.status ? { topBorder: { content: options.status, width } } : {}),
		};
		const top = selectedStyle.renderTop(context);
		options.onTop?.(top);
		const lines = top === undefined ? [] : [top];
		const textRows = source.getText().split("\n");
		const gutter = id === "rail" ? "» " : "❯ ";
		const sideWidth = id === "rail" ? 2 : 0;
		for (const [index, input] of textRows.entries()) {
			const text =
				input +
				(source.focused && index === textRows.length - 1 ? `${CURSOR_MARKER}\x1b[7m \x1b[27m` : "");
			const pad = " ".repeat(
				Math.max(
					0,
					width -
						sideWidth -
						visibleWidth(gutter) -
						visibleWidth(text.replaceAll(CURSOR_MARKER, "")),
				),
			);
			options.beforeRow?.();
			lines.push(...selectedStyle.renderRow({ ...context, text, pad, gutter, paddingX: 0 }));
		}
		const bottom = selectedStyle.renderBottom(context);
		if (bottom !== undefined) lines.push(bottom);
		lines.push(...source.debugChildren[0].render(width));
		options.afterRows?.();
		return lines;
	});
	return style;
}

function plain(rows: string[]): string {
	return rows.map(stripVTControlCharacters).join("\n");
}

function expectPromptAndCursor(rows: string[], input: string, width: number) {
	for (const line of input.split("\n")) expect(plain(rows)).toContain(line);
	expect(rows.join("\n").split(CURSOR_MARKER)).toHaveLength(2);
	expect(rows.join("\n")).toContain(`${CURSOR_MARKER}\x1b[7m `);
	expect(rows.every((row) => visibleWidth(row.replaceAll(CURSOR_MARKER, "")) <= width)).toBe(true);
}

beforeEach(() => nativeApi.styles.clear());
afterEach(() => {
	vi.restoreAllMocks();
	nativeApi.styles.clear();
});

describe("PolishedEditor over OMP built-in composers", () => {
	it.each(["opencode", "opencode-copy-friendly", "accent-rail", "minimalist"] as const)(
		"decorates a one-row native Rail prompt in %s without requiring native chrome",
		(style) => {
			installNativeRenderer();
			const { editor } = standalone("rail", [], style);
			editor.setText("single prompt 中");
			const rows = editor.render(48);
			expect(plain(rows)).not.toContain("▎» ");
			expectPromptAndCursor(rows, "single prompt 中", 48);
			if (style !== "accent-rail") expect(plain(rows)).toContain("composer-model");
		},
	);
	it("adds Opencode metadata over Rail without changing native input, cursor or completion layout", () => {
		installNativeRenderer();
		const input = "draft 中👩‍💻\n  continuation";
		const completions = ["→ /help", "  /model"];
		const { editor, disableDecoration } = standalone("rail", completions);
		editor.setText(input);
		const nativeBefore = CustomEditor.prototype.render.call(editor, 48);

		const rows = editor.render(48);
		expect(plain(rows)).toContain("composer-model");
		expect(plain(rows)).toContain("high");
		expectPromptAndCursor(rows, input, 48);
		expect(rows.slice(-completions.length)).toEqual(completions);
		expect(plain(rows)).not.toContain("» ");

		// Disabling only Zentui restores the same native renderer and gutter.
		// This observes both leaked composer wrappers and unwanted input changes.
		disableDecoration();
		expect(editor.render(48)).toEqual(nativeBefore);
		editor.setText("edited 中");
		const edited = editor.render(48);
		expect(plain(edited)).toContain("▎» edited 中");
		expectPromptAndCursor(edited, "edited 中", 48);
		expect(edited.slice(-completions.length)).toEqual(completions);
	});

	it("keeps header-attached native status separate from Zentui metadata and prompt", () => {
		const status = "\x1b[36m native-status: 7% \x1b[0m";
		let nativeHeader: string | undefined;
		installNativeRenderer({
			id: "claude",
			status,
			onTop: (row) => {
				nativeHeader = row;
			},
		});
		const { editor } = standalone("claude", ["→ /status"]);
		editor.setText("status prompt 中");

		const rows = editor.render(48);
		expect(rows[0]).toBe(nativeHeader);
		expect(rows[0]).toContain(status);
		expect(plain(rows.slice(1))).not.toContain("native-status");
		expect(plain(rows.slice(1))).toContain("composer-model");
		expectPromptAndCursor(rows, "status prompt 中", 48);
		expect(rows.at(-1)).toBe("→ /status");
		expect(plain(rows)).not.toContain("❯ ");
	});

	it("preserves native Rail rows when a composer method is locked", () => {
		const style = installNativeRenderer();
		Object.defineProperty(style, "renderRow", { writable: false, configurable: false });
		const { editor } = standalone("rail", ["→ /locked"]);
		editor.setText("locked draft 中");
		const rows = editor.render(48);

		expect(plain(rows)).toContain("▎» locked draft 中");
		expect(plain(rows)).not.toContain("composer-model");
		expectPromptAndCursor(rows, "locked draft 中", 48);
		expect(rows.at(-1)).toBe("→ /locked");
	});

	it("fails open on foreign replacement and does not erase that renderer during cleanup", () => {
		let replace = true;
		const style = installNativeRenderer({
			afterRows: () => {
				if (!replace) return;
				replace = false;
				style.renderRow = (context) => [`F ${context.text}${context.pad}`];
			},
		});
		const { editor, disableDecoration } = standalone("rail", ["→ /foreign"]);
		editor.setText("foreign draft");
		const rows = editor.render(48);

		expect(plain(rows)).toContain("▎» foreign draft");
		expect(plain(rows)).not.toContain("composer-model");
		expectPromptAndCursor(rows, "foreign draft", 48);
		expect(rows.at(-1)).toBe("→ /foreign");
		disableDecoration();
		const foreignRows = editor.render(48);
		expect(plain(foreignRows)).toContain("F foreign draft");
		expect(plain(foreignRows)).not.toContain("▎»");
		expectPromptAndCursor(foreignRows, "foreign draft", 48);
	});

	it("does not mix another editor's reentrant rows into the outer prompt", () => {
		let reenter: (() => void) | undefined;
		installNativeRenderer({ beforeRow: () => reenter?.() });
		const outer = standalone("rail", ["→ /outer"]).editor;
		const inner = standalone("rail", ["→ /inner"]).editor;
		outer.setText("outer prompt");
		inner.setText("inner prompt 中");
		let innerRows: string[] = [];
		reenter = () => {
			reenter = undefined;
			innerRows = inner.render(40);
		};

		const outerRows = outer.render(48);
		expect(plain(outerRows)).toContain("▎» outer prompt");
		expect(plain(outerRows)).not.toContain("inner prompt");
		expect(plain(outerRows)).not.toContain("composer-model");
		expectPromptAndCursor(outerRows, "outer prompt", 48);
		expect(outerRows.at(-1)).toBe("→ /outer");
		expect(plain(innerRows)).toContain("composer-model");
		expect(plain(innerRows)).not.toContain("outer prompt");
		expectPromptAndCursor(innerRows, "inner prompt 中", 40);
		expect(innerRows.at(-1)).toBe("→ /inner");

		const recovered = outer.render(48);
		expect(plain(recovered)).toContain("composer-model");
		expectPromptAndCursor(recovered, "outer prompt", 48);
	});
});
