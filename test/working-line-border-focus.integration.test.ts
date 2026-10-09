import { CustomEditor, type Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import { LayeredEditorConsumer } from "../extensions/zentui/layered-editor";
import { PolishedEditor, WrappedPolishedEditor } from "../extensions/zentui/ui";
import { WorkingLineController } from "../extensions/zentui/working-line";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	strikethrough: (text: string) => text,
	inverse: (text: string) => text,
} as Theme;

// Portable cursor decorator contract: host blur filters presentation, never input ownership.
// This is not a Herdr event/AgentSession streaming reproduction.
function harness(adapter: "standalone" | "wrapped", animation: "disabled" | "classic" | "kitt") {
	vi.useFakeTimers();
	const config = mergeConfig({
		components: {
			editor: { enabled: true, style: "minimalist" },
			workingLine: {
				enabled: true,
				placement: "border",
				textAnimation: animation,
				messages: { custom: true, values: ["Stable"] },
				segments: { elapsed: false, thought: false },
			},
		},
	});
	const ui = {
		setWorkingVisible: vi.fn((_visible: boolean) => {}),
		setWorkingMessage: vi.fn((_message?: string) => {}),
		setWorkingIndicator: vi.fn((_options?: unknown) => {}),
	};
	const ctx = { mode: "tui", hasUI: true, ui };
	const tui = { requestRender() {}, terminal: { cols: 100, rows: 24 } };
	const editorTheme = { borderColor: (text: string) => text, selectList: {} };
	const keybindings = { matches: () => false };
	let editor: PolishedEditor | WrappedPolishedEditor;
	type Factory = () => typeof editor;
	const consumer = new LayeredEditorConsumer<Factory, typeof editor>(() => true);
	let currentFactory: Factory;
	const controller = new WorkingLineController(
		() => config,
		() => theme,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		() =>
			config.components.editor.enabled &&
			config.components.editor.style !== "accent-rail" &&
			consumer.editorVisibleThrough(currentFactory)?.canEmbedWorkingLineBorder() === true,
	);
	const metadata = () => ({
		cwd: "",
		modelLabel: "",
		contextPercent: 0,
		agentActive: true,
		workingLineFrame: controller.currentWorkingLineFrame(),
	});
	const args = [
		theme,
		() => config,
		() => ({ modelLabel: "", providerLabel: "" }),
		() => "off",
		metadata,
		() => {},
		() => controller.reconcile(ctx),
	] as const;
	const base = new CustomEditor(tui as never, editorTheme as never, keybindings as never, {
		paddingX: 0,
	});
	editor =
		adapter === "standalone"
			? new PolishedEditor(tui as never, editorTheme as never, keybindings as never, ...args)
			: new WrappedPolishedEditor(base as never, ...args);
	editor.focused = true;
	let hostFocused = true;
	const originalRender = editor.render.bind(editor);
	editor.render = (width) => {
		const rows = originalRender(width);
		return hostFocused
			? rows
			: rows.map((row) =>
					row.replaceAll(CURSOR_MARKER, "").replace(/\x1b\[7m([\s\S]*?)\x1b\[(?:0|27)m/g, "$1"),
				);
	};
	currentFactory = () => editor;
	consumer.attach(currentFactory, 1, editor, () => {});
	controller.startSession(ctx);
	controller.startAgent(ctx);
	expect(stripTerminalSequences(editor.render(100)[0])).toContain("Stable");
	expect(ui.setWorkingVisible.mock.calls).toEqual([[false]]);
	ui.setWorkingVisible.mockClear();
	return {
		editor,
		controller,
		config,
		ui,
		ctx,
		setHostFocused(value: boolean) {
			hostFocused = value;
		},
		loseVisibleEditor() {
			currentFactory = () => base as never;
			controller.reconcile(ctx);
		},
		hideEditor() {
			consumer.detach();
			controller.reconcile(ctx);
		},
		cleanup() {
			controller.dispose(ctx);
		},
	};
}

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

for (const adapter of ["standalone", "wrapped"] as const) {
	it.each(["disabled", "classic", "kitt"] as const)(
		`${adapter}: presentation-only host blur preserves %s border placement and cursor hiding`,
		(animation) => {
			const h = harness(adapter, animation);
			try {
				const focusedRows = h.editor.render(100);
				h.setHostFocused(false);
				const rows = h.editor.render(100);
				expect(stripTerminalSequences(rows[0])).toContain("Stable");
				expect(rows.slice(1).map(stripTerminalSequences)).toEqual(
					focusedRows.slice(1).map(stripTerminalSequences),
				);
				expect(rows.map(visibleWidth)).toEqual(focusedRows.map(visibleWidth));
				expect(rows.join("\n")).not.toContain(CURSOR_MARKER);
				expect(rows.join("\n")).not.toContain("\x1b[7m");
				expect(h.editor.focused).toBe(true);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(true);
				vi.advanceTimersByTime(1500);
				expect(stripTerminalSequences(h.editor.render(100)[0])).toContain("Stable");
				expect(h.ui.setWorkingVisible).not.toHaveBeenCalled();
				h.setHostFocused(true);
				expect(h.editor.render(100).join("\n")).toContain(CURSOR_MARKER);
				expect(h.ui.setWorkingVisible).not.toHaveBeenCalled();
			} finally {
				h.cleanup();
			}
		},
	);

	it(`${adapter}: genuine keyboard transfer revokes border before render, even while host blurred`, () => {
		const h = harness(adapter, "classic");
		try {
			h.setHostFocused(false);
			h.editor.focused = false;
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			expect(h.ui.setWorkingVisible.mock.calls).toEqual([[true]]);
			expect(stripTerminalSequences(h.editor.render(100)[0])).not.toContain("Stable");
			h.setHostFocused(true);
			expect(h.editor.focused).toBe(false);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			h.editor.focused = true;
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			expect(stripTerminalSequences(h.editor.render(100)[0])).toContain("Stable");
			expect(h.ui.setWorkingVisible.mock.calls).toEqual([[true], [false]]);
		} finally {
			h.cleanup();
		}
	});

	it.each(["narrow", "replacement", "hidden", "disabled", "native"] as const)(
		`${adapter}: cursor decoration preserves %s placement fallback`,
		(reason) => {
			const h = harness(adapter, "kitt");
			try {
				h.setHostFocused(false);
				if (reason === "narrow") h.editor.render(12);
				else if (reason === "replacement") h.loseVisibleEditor();
				else if (reason === "hidden") h.hideEditor();
				else {
					if (reason === "disabled") h.config.components.editor.enabled = false;
					else h.config.components.workingLine.enabled = false;
					h.controller.reconcile(h.ctx);
				}
				expect(h.ui.setWorkingVisible.mock.calls).toEqual([[true]]);
				expect(h.controller.currentWorkingLineFrame()).toBeUndefined();
			} finally {
				h.cleanup();
			}
		},
	);
}
