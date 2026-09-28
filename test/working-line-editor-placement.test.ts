import { CustomEditor, type Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EditorStyle, mergeConfig } from "../extensions/zentui/config";
import { PolishedEditor, WrappedPolishedEditor } from "../extensions/zentui/ui";

const styles = ["minimalist", "opencode", "opencode-copy-friendly"] as const;
const adapters = ["standalone", "wrapped"] as const;
const frame = "✧ Zigzagging…";
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	strikethrough: (text: string) => text,
	inverse: (text: string) => text,
} as Theme;

function harness(adapter: (typeof adapters)[number], style: EditorStyle) {
	const config = mergeConfig({
		components: {
			editor: { enabled: true, style },
			workingLine: { enabled: true, placement: "border" },
		},
	});
	const tui = { requestRender() {}, terminal: { rows: 24, cols: 100 } };
	const editorTheme = { borderColor: (text: string) => text, selectList: {} };
	const keybindings = { matches: () => false };
	const base = new CustomEditor(tui as never, editorTheme as never, keybindings as never, {
		paddingX: 0,
	});
	let editor: PolishedEditor | WrappedPolishedEditor;
	const trace: string[] = [];
	const transitions: boolean[] = [];
	const duration = vi.fn();
	let active = true;
	let metadataFailure = false;
	const metadata = vi.fn(() => {
		trace.push(`metadata:${editor.canEmbedWorkingLineBorder()}`);
		if (metadataFailure) throw new Error("metadata unavailable");
		return {
			cwd: "/project",
			modelLabel: "model",
			contextPercent: 42,
			sessionName: "session",
			agentDurationMs: 5000,
			agentActive: active,
			// Simulate the controller's gated metadata seam, not another placement resolver.
			workingLineFrame: active && editor.canEmbedWorkingLineBorder() ? frame : undefined,
		};
	});
	const onCapability = () => {
		transitions.push(editor.canEmbedWorkingLineBorder());
		trace.push(`capability:${editor.canEmbedWorkingLineBorder()}`);
	};
	const args = [
		theme,
		() => config,
		() => ({ modelLabel: "model", providerLabel: "provider" }),
		() => "high",
		metadata,
		duration,
		onCapability,
	] as const;
	editor =
		adapter === "standalone"
			? new PolishedEditor(tui as never, editorTheme as never, keybindings as never, ...args)
			: new WrappedPolishedEditor(base as never, ...args);
	editor.focused = true;
	return {
		editor,
		base,
		config,
		metadata,
		transitions,
		trace,
		duration,
		setActive(value: boolean) {
			active = value;
		},
		failMetadata(value: boolean) {
			metadataFailure = value;
		},
		source: adapter === "standalone" ? editor : base,
	};
}

afterEach(() => vi.restoreAllMocks());

for (const adapter of adapters) {
	describe(`${adapter} working-line border capability`, () => {
		it.each(styles)(
			"revokes %s on blur without rendering and waits for a safe focused render",
			(style) => {
				const h = harness(adapter, style);
				h.editor.setText("followup");
				expect(h.editor.render(100)[0]).toContain(frame);
				h.metadata.mockClear();
				h.editor.focused = false;
				expect(h.editor.focused).toBe(false);
				if (adapter === "wrapped") expect(h.base.focused).toBe(false);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				expect(h.transitions).toEqual([true, false]);
				expect(h.metadata).not.toHaveBeenCalled();
				h.editor.focused = false;
				h.editor.focused = true;
				if (adapter === "wrapped") expect(h.base.focused).toBe(true);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				expect(h.transitions).toEqual([true, false]);
				expect(h.editor.render(12).join("\n")).not.toContain(frame);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				expect(h.editor.render(100)[0]).toContain(frame);
				expect(h.transitions).toEqual([true, false, true]);
				h.editor.focused = false;
				const unfocused = h.editor.render(100).join("\n");
				expect(unfocused).not.toContain(frame);
				expect(unfocused).not.toContain(CURSOR_MARKER);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				h.editor.focused = true;
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				const focused = h.editor.render(100).join("\n");
				expect(focused).toContain(frame);
				expect(focused).toContain(CURSOR_MARKER);
				expect(focused).toContain("followup");
				expect(h.editor.getText()).toBe("followup");
			},
		);

		it.each(styles)(
			"bootstraps %s before gated metadata, independently of the duration callback",
			(style) => {
				const h = harness(adapter, style);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				const rows = h.editor.render(100);
				expect(h.trace).toEqual(["capability:true", "metadata:true"]);
				expect(rows[0]).toContain(frame);
				expect(rows.slice(1).join("\n")).not.toContain(frame);
				expect(rows.join("\n")).toContain("model");
				expect(h.duration).toHaveBeenLastCalledWith(style === "minimalist");
				h.editor.render(100);
				expect(h.transitions).toEqual([true]);
				h.setActive(false);
				expect(h.editor.render(100).join("\n")).not.toContain(frame);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(true);
				// The frame is already controller-resolved; consumers never inspect Working settings.
				h.config.components.workingLine.enabled = false;
				h.config.components.workingLine.placement = "above";
				h.setActive(true);
				expect(h.editor.render(100)[0]).toContain(frame);
			},
		);

		it.each(styles)("releases %s before narrow metadata and resumes on a wide render", (style) => {
			const h = harness(adapter, style);
			h.editor.render(100);
			h.trace.length = 0;
			const rows = h.editor.render(12);
			expect(h.trace).toEqual(["capability:false", "metadata:false"]);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			expect(rows.join("\n")).not.toContain(frame);
			h.editor.render(100);
			expect(h.transitions).toEqual([true, false, true]);
		});

		it.each(styles)(
			"releases %s on disable, Accent Rail and metadata failure, retaining canonical Border",
			(style) => {
				const h = harness(adapter, style);
				const working = structuredClone(h.config.components.workingLine);
				h.editor.render(100);
				h.config.components.editor.enabled = false;
				expect(h.editor.render(100).join("\n")).not.toContain(frame);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				h.config.components.editor.enabled = true;
				h.editor.render(100);
				h.config.components.editor.style = "accent-rail";
				expect(h.editor.render(100).join("\n")).not.toContain(frame);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				h.config.components.editor.style = style;
				h.editor.render(100);
				h.failMetadata(true);
				expect(h.editor.render(100).join("\n")).not.toContain(frame);
				expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
				h.failMetadata(false);
				expect(h.editor.render(100)[0]).toContain(frame);
				expect(h.config.components.workingLine).toEqual(working);
			},
		);

		it.each(styles)("clears %s capability for short and throwing native renders", (style) => {
			const h = harness(adapter, style);
			h.editor.render(100);
			const render = vi.spyOn(CustomEditor.prototype, "render").mockReturnValue(["unframed"]);
			expect(h.editor.render(100)).toEqual(["unframed"]);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			render.mockRestore();
			h.editor.render(100);
			vi.spyOn(CustomEditor.prototype, "render").mockImplementation(() => {
				throw new Error("native failed");
			});
			expect(() => h.editor.render(100)).toThrow("native failed");
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
		});

		it.each(styles)("does not claim %s on unknown or uncaptured autocomplete", (style) => {
			const h = harness(adapter, style);
			h.editor.render(100);
			h.metadata.mockClear();
			const showing = vi
				.spyOn(h.source as CustomEditor, "isShowingAutocomplete")
				.mockReturnValue(true);
			const rows = h.editor.render(100);
			expect(rows.join("\n")).not.toContain(frame);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			expect(h.metadata).not.toHaveBeenCalled();
			showing.mockRestore();
			h.editor.render(100);
			Object.defineProperty(h.source, "isShowingAutocomplete", {
				value: undefined,
				configurable: true,
			});
			expect(h.editor.render(100).join("\n")).not.toContain(frame);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
		});

		it.each(styles)("releases %s after a late composition exception", (style) => {
			const h = harness(adapter, style);
			const target =
				style === "minimalist"
					? h.config.components.editor.styles.minimalist
					: h.config.components.editor.styles[style];
			Object.defineProperty(target, style === "minimalist" ? "showTimer" : "metadataFormat", {
				get() {
					throw new Error("composition failed");
				},
				configurable: true,
			});
			const rows = h.editor.render(100);
			expect(rows.join("\n")).not.toContain(frame);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
			expect(h.trace).toEqual(["capability:true", "metadata:true", "capability:false"]);
		});

		it.each(styles)("preserves safe %s autocomplete and releases on unsafe capture", (style) => {
			const h = harness(adapter, style);
			const list = { render: vi.fn(() => ["suggestion"]) };
			Object.defineProperty(h.source, "autocompleteList", { value: list, configurable: true });
			vi.spyOn(h.source as CustomEditor, "isShowingAutocomplete").mockReturnValue(true);
			vi.spyOn(CustomEditor.prototype, "render").mockImplementation((width) => [
				"─".repeat(width),
				`draft${CURSOR_MARKER}\x1b[7m \x1b[27m`,
				"─".repeat(width),
				...list.render(),
			]);
			const rows = h.editor.render(100);
			expect(rows[0]).toContain(frame);
			expect(rows.join("\n")).toContain("suggestion");
			expect(rows.join("\n")).toContain(`draft${CURSOR_MARKER}\x1b[7m \x1b[27m`);
			expect(list.render).toHaveBeenCalledTimes(1);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(true);
			Object.defineProperty(list, "render", { writable: false });
			expect(h.editor.render(100).join("\n")).not.toContain(frame);
			expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
		});

		it.each(styles)(
			"keeps %s input, cursor, typing and widths unchanged while working",
			(style) => {
				const h = harness(adapter, style);
				for (const text of ["", "steer next", "界面 👋"]) {
					// Pi 0.87.1 recursively wraps a wide grapheme forever at native width 1.
					const widths =
						text === "界面 👋"
							? [8, 12, 15, 16, 20, 40, 100]
							: [1, 2, 4, 8, 12, 15, 16, 20, 40, 100];
					for (const width of widths) {
						h.editor.setText(text);
						h.setActive(false);
						const idle = h.editor.render(width);
						h.setActive(true);
						const active = h.editor.render(width);
						expect(active.slice(1)).toEqual(idle.slice(1));
						expect(active.every((line) => visibleWidth(line) <= width)).toBe(true);
						if (width >= 16) {
							expect(active[0]).toContain("✧");
							const cursor = active.find((line) => line.includes(CURSOR_MARKER));
							expect(cursor).toBeDefined();
							expect(cursor).toContain("\x1b[7m");
						}
						expect(h.editor.getText()).toBe(text);
					}
				}
				h.editor.setText("");
				h.editor.handleInput("followup");
				expect(h.editor.getText()).toBe("followup");
				expect(h.editor.render(100).slice(1).join("\n")).toContain("followup");
			},
		);
	});
}

describe("wrapped working-line provenance", () => {
	it.each(styles)("releases %s for malformed or unsafe predecessor rows", (style) => {
		const h = harness("wrapped", style);
		h.editor.render(100);
		const render = vi
			.spyOn(h.base, "render")
			.mockReturnValue(["unknown top", "draft", "unknown bottom"]);
		expect(h.editor.render(100)).toEqual(["unknown top", "draft", "unknown bottom"]);
		expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
		render.mockRestore();
		h.editor.render(100);
		Object.defineProperty(h.base, Symbol.for("pi-zentui.polished-frame"), { value: true });
		expect(h.editor.render(100).join("\n")).not.toContain(frame);
		expect(h.editor.canEmbedWorkingLineBorder()).toBe(false);
	});
});
