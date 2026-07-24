import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import {
	type EditorMetadataValues,
	renderEditorMetadataFormat,
	sanitizeEditorMetadataText,
} from "../extensions/zentui/editor-metadata-format";

function makeTheme(): Theme {
	return {
		fg(color: string, text: string) {
			return `[${color}]${text}`;
		},
		bold(text: string) {
			return text;
		},
		italic(text: string) {
			return text;
		},
		underline(text: string) {
			return text;
		},
	} as unknown as Theme;
}

const values: EditorMetadataValues = {
	model: "Model Label",
	modelId: "model-id",
	modelName: "Model Name",
	provider: "Provider",
	thinking: "high",
	sessionName: "Session",
};

function render(format: string, overrides: Partial<EditorMetadataValues> = {}): string {
	return renderEditorMetadataFormat(
		format,
		{ ...values, ...overrides },
		makeTheme(),
		defaultConfig,
	);
}

describe("renderEditorMetadataFormat", () => {
	it("renders all supported variables in both syntaxes", () => {
		expect(render(`$model|\${model_id}|$model_name|\${provider}|$thinking|\${session_name}`)).toBe(
			"[accent]Model Label[border]|[accent]model-id[border]|[accent]Model Name[border]|[text]Provider[border]|[muted]high[border]|[border]Session",
		);
	});

	it("uses conditional groups for optional values", () => {
		expect(render("$model( · $thinking)", { thinking: "off" })).toBe("[accent]Model Label");
		expect(render("$model( · $thinking)")).toBe("[accent]Model Label[border] · [muted]high");
		expect(
			render("$model( · $model_name)( · $session_name)", { modelName: "", sessionName: "" }),
		).toBe("[accent]Model Label");
		expect(render("before((literal))after")).toBe("[border]before[border]literal[border]after");
	});

	it("renders unknown variables and fill as empty", () => {
		expect(render("a$unknown-b$fill-c($unknown)($fill)")).toBe("[border]a[border]-b[border]-c");
	});

	it("preserves the default layout and hides thinking when off", () => {
		expect(render(defaultConfig.editorMetadataFormat, { thinking: "off" })).toBe(
			"[accent]Model Label[border]  [text]Provider",
		);
		expect(render(defaultConfig.editorMetadataFormat)).toBe(
			"[accent]Model Label[border]  [text]Provider[border]  [muted]high",
		);
	});

	it("routes semantic and neutral styles", () => {
		const config = {
			...defaultConfig,
			colors: {
				...defaultConfig.colors,
				editorModel: "success",
				editorProvider: "syntaxKeyword",
				editorThinking: "thinkingText",
				editorThinkingHigh: "thinkingHigh",
			},
		};
		const rendered = renderEditorMetadataFormat(
			"$model $model_id $model_name $provider $thinking $session_name literal",
			values,
			makeTheme(),
			config,
		);
		expect(rendered).toContain("[success]Model Label");
		expect(rendered).toContain("[success]model-id");
		expect(rendered).toContain("[success]Model Name");
		expect(rendered).toContain("[syntaxKeyword]Provider");
		expect(rendered).toContain("[thinkingHigh]high");
		expect(rendered).toContain("[border]Session");
		expect(rendered).toContain("[border] literal");
	});

	it("falls back to the shared thinking color", () => {
		const config = {
			...defaultConfig,
			colors: { ...defaultConfig.colors, editorThinking: "thinkingText" },
		};
		expect(
			renderEditorMetadataFormat("$thinking", { ...values, thinking: "low" }, makeTheme(), config),
		).toBe("[thinkingText]low");
	});

	it("sanitizes literals and values without collapsing ordinary spaces", () => {
		const rendered = render(
			"\u001b]8;;https://example.com/$provider\u0007lit\u001b]8;;\u0007  x\n\ty:$model",
			{
				model: "\u001b]8;;https://example.com\u0007bad\u001b]8;;\u0007\r\n  model\u0000",
			},
		);
		expect(rendered).toBe("[border]lit  x y:[accent]bad   model");
		expect(rendered).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
	});
});

describe("sanitizeEditorMetadataText", () => {
	it("removes SGR and BEL while preserving regular spaces", () => {
		expect(sanitizeEditorMetadataText("a  b\r\n\tc\u0000\u0007\u001b[31md\u001b[0m")).toBe(
			"a  b cd",
		);
	});

	it("preserves hyperlink labels between ST-terminated OSC 8 sequences", () => {
		expect(
			sanitizeEditorMetadataText(
				"before \u001b]8;;https://example.com\u001b\\visible label\u001b]8;;\u001b\\ after",
			),
		).toBe("before visible label after");
	});

	it("removes C1 OSC, DCS, and CSI payloads", () => {
		expect(
			sanitizeEditorMetadataText(
				"a\u009d8;;https://example.com\u009cb\u0090hidden payload\u009cc\u009b31md",
			),
		).toBe("abcd");
	});

	it("resumes after CAN or SUB cancels ESC-prefixed control sequences", () => {
		expect(sanitizeEditorMetadataText("safe\u001b]8;;url\u0018 visible")).toBe("safe visible");
		expect(sanitizeEditorMetadataText("safe\u001bPpayload\u001a visible")).toBe("safe visible");
		expect(sanitizeEditorMetadataText("safe\u001b[31\u0018 visible")).toBe("safe visible");
		expect(sanitizeEditorMetadataText("safe\u001b[31\u001a visible")).toBe("safe visible");
	});

	it("resumes after CAN or SUB cancels C1 control sequences", () => {
		expect(sanitizeEditorMetadataText("safe\u009d8;;url\u001a visible")).toBe("safe visible");
		expect(sanitizeEditorMetadataText("safe\u0090payload\u0018 visible")).toBe("safe visible");
		expect(sanitizeEditorMetadataText("safe\u009b31\u0018 visible")).toBe("safe visible");
		expect(sanitizeEditorMetadataText("safe\u009b31\u001a visible")).toBe("safe visible");
	});

	it("drops unterminated control sequences conservatively", () => {
		expect(sanitizeEditorMetadataText("safe\u001b]8;;https://example.com/unsafe")).toBe("safe");
		expect(sanitizeEditorMetadataText("safe\u0090unsafe payload")).toBe("safe");
		expect(sanitizeEditorMetadataText("safe\u009b31")).toBe("safe");
	});

	it("normalizes NEL, line separators, and paragraph separators", () => {
		expect(sanitizeEditorMetadataText("a\u0085\u2028\u2029b  c")).toBe("a b  c");
	});
});
