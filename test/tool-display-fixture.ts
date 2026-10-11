import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { CodeHighlighter } from "../extensions/zentui/tool-display/bounds.js";
import {
	renderEditDiffResult,
	renderWriteDiffResult,
} from "../extensions/zentui/tool-display/diff-renderer.js";
import type { ToolDisplayConfig } from "../extensions/zentui/tool-display/types.js";
export function editFixture(
	diff: string,
	getConfig: () => ToolDisplayConfig,
	theme: Theme,
	expanded: boolean,
	options: { path?: string; highlighter?: CodeHighlighter } = {},
): Component {
	return {
		invalidate() {},
		render(width) {
			return renderEditDiffResult(
				{ diff },
				{ expanded, filePath: options.path, highlighter: options.highlighter },
				getConfig(),
				theme,
				"edited",
			).render(width);
		},
	};
}
export function writeFixture(
	before: string,
	after: string,
	getConfig: () => ToolDisplayConfig,
	theme: Theme,
	expanded: boolean,
	options: { path?: string; highlighter?: CodeHighlighter } = {},
): Component {
	return {
		invalidate() {},
		render(width) {
			return renderWriteDiffResult(
				after,
				{
					expanded,
					previousContent: before,
					fileExistedBeforeWrite: before !== "",
					filePath: options.path,
					highlighter: options.highlighter,
				},
				getConfig(),
				theme,
				"written",
			).render(width);
		},
	};
}
