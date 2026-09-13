import { stripVTControlCharacters as plain } from "node:util";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderAccentRailEditorFrame } from "../extensions/zentui/accent-rail-editor";
import type { CodexQuota } from "../extensions/zentui/codex-quota";
import { codexQuotaText } from "../extensions/zentui/codex-quota-display";
import { mergeConfig } from "../extensions/zentui/config";
import { renderEditorMetadataFormat } from "../extensions/zentui/editor-metadata-format";
import { installFooter } from "../extensions/zentui/footer";
import { emptyGitStatus } from "../extensions/zentui/git";
import { renderMinimalistFrame } from "../extensions/zentui/minimalist-editor";
import { renderEditorSettingsPreview } from "../extensions/zentui/settings-previews";
import { createInitialState } from "../extensions/zentui/state";
import { renderPolishedEditorFrame } from "../extensions/zentui/ui";

const theme = {
	fg: (_color: string, text: string) => `\x1b[32m${text}\x1b[39m`,
	bold: (text: string) => text,
} as Theme;
const snapshots: CodexQuota[] = [
	{},
	{ fiveHour: 80, week: 60 },
	{ fiveHour: 20, week: 0 },
	{ week: 49 },
	{ fiveHour: 80, week: 60, stale: true },
];

function assertAtomic(rows: string[], width: number, quota: CodexQuota) {
	for (const row of rows) {
		expect(visibleWidth(row)).toBeLessThanOrEqual(width);
		if (plain(row).includes("5h")) expect(plain(row)).toContain(codexQuotaText(quota));
	}
}

describe.each(["theme", "terminal"] as const)("quota with %s colors", (colorSource) => {
	it.each(["opencode", "opencode-copy-friendly", "minimalist", "accent-rail"] as const)(
		"renders %s atomically at every width without editing input",
		(style) => {
			const config = mergeConfig({
				components: {
					editor: { style, colorSource, codexQuota: true },
					footer: { style: "hidden" },
				},
			});
			for (const iconMode of ["ascii", "nerd"] as const) {
				config.icons.mode = iconMode;
				for (const quota of snapshots) {
					for (let width = 1; width <= 140; width++) {
						const common = {
							width,
							editorLines: ["prompt"],
							autocompleteLines: ["completion"],
							uiTheme: theme,
							config,
						};
						const rows =
							style === "accent-rail"
								? renderAccentRailEditorFrame({ ...common, codexQuota: quota })
								: style === "minimalist"
									? renderMinimalistFrame({
											...common,
											inputText: "prompt",
											metadata: {
												cwd: "/repo",
												modelLabel: "model",
												contextPercent: 20,
												codexQuota: quota,
											},
										})
									: renderPolishedEditorFrame({
											...common,
											modelMeta: {
												modelLabel: "model",
												providerLabel: "OpenAI Codex",
												codexQuota: quota,
											},
										});
						assertAtomic(rows, width, quota);
						if (width === 140) {
							expect(plain(rows.join("\n"))).toContain(codexQuotaText(quota));
							expect(plain(rows.join("\n"))).toContain("prompt");
							expect(plain(rows.join("\n"))).toContain("completion");
						}
					}
				}
			}
		},
	);

	it.each(["opencode", "opencode-copy-friendly", "minimalist", "accent-rail"] as const)(
		"keeps stale quota atomic beside long model names and viewport controls in %s",
		(style) => {
			const config = mergeConfig({
				components: { editor: { style, colorSource, codexQuota: true } },
			});
			config.components.editor.styles.opencode.metadataFormat =
				"$model$fill($codex_quota)$fill$context";
			config.components.editor.styles["opencode-copy-friendly"].metadataFormat =
				"$model$fill($codex_quota)$fill$context";
			const modelLabel = "very-long-model-name-".repeat(6);
			const quota = { fiveHour: 80, week: 60, stale: true };
			for (let width = 5; width <= 240; width++) {
				const common = {
					width,
					editorLines: ["draft", "continuation"],
					autocompleteLines: ["completion"],
					viewport: { above: "2", below: "3" },
					uiTheme: theme,
					config,
				};
				const rows =
					style === "minimalist"
						? renderMinimalistFrame({
								...common,
								inputText: "draft\ncontinuation",
								metadata: { cwd: "/repo", modelLabel, contextPercent: 20, codexQuota: quota },
							})
						: style === "accent-rail"
							? renderAccentRailEditorFrame({ ...common, codexQuota: quota })
							: renderPolishedEditorFrame({
									...common,
									modelMeta: {
										modelLabel,
										providerLabel: "OpenAI Codex",
										codexQuota: quota,
										contextPercent: 20,
										contextWindow: 1_048_576,
									},
									rightStatus: "INSERT",
								});
				assertAtomic(rows, width, quota);
				if (width === 240) {
					const text = plain(rows.join("\n"));
					for (const label of [
						codexQuotaText(quota),
						"draft",
						"continuation",
						"completion",
						"↑ 2 more",
						"↓ 3 more",
					])
						expect(text).toContain(label);
				}
			}
		},
	);

	it("gates footer wide/compact templates and preserves atomic quota in mixed chunks", () => {
		const config = mergeConfig({ components: { footer: { codexQuota: true, colorSource } } });
		const starship = config.components.footer.styles.starship;
		let provider = "openai-codex";
		let quota = snapshots[4];
		let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
		installFooter(
			{
				cwd: "/repo",
				get model() {
					return { provider };
				},
				sessionManager: { getSessionName: () => "session" },
				getContextUsage: () => undefined,
				ui: {
					setFooter(value: typeof factory) {
						factory = value;
					},
				},
			} as unknown as ExtensionContext,
			createInitialState(emptyGitStatus()),
			() => config,
			{ setRequestRender() {}, scheduleProjectRefresh() {}, getCodexQuota: () => quota },
		);
		const footer = factory?.({ requestRender() {} } as never, theme, {
			onBranchChange: () => () => {},
			getExtensionStatuses: () => new Map(),
		} as never);
		expect(footer).toBeDefined();
		try {
			for (const snapshot of snapshots) {
				quota = snapshot;
				for (const format of [
					"",
					"$codex_quota",
					"$cwd($sep$codex_quota)$fill$tokens",
					"$codex_quota $codex_quota",
				]) {
					for (const responsive of [true, false]) {
						starship.format = format;
						starship.responsive = responsive;
						for (const compact of [
							"$codex_quota",
							"$cwd $codex_quota$wrap$tokens",
							"$cwd$wrap_sep($codex_quota)$wrap$tokens",
						]) {
							starship.compactFormat = compact;
							for (let width = 1; width <= 100; width++)
								assertAtomic(footer?.render(width) ?? [], width, snapshot);
						}
					}
				}
			}
			starship.format = "$codex_quota";
			expect(plain(footer?.render(140).join("\n") ?? "")).toContain("5h");
			provider = "openai";
			expect(plain(footer?.render(140).join("\n") ?? "")).not.toContain("5h");
			provider = "openai-codex";
			config.components.footer.codexQuota = false;
			expect(plain(footer?.render(140).join("\n") ?? "")).not.toContain("5h");
			starship.format = "long-wide-template-that-forces-compact";
			starship.responsive = true;
			for (let width = 1; width < 36; width++) {
				starship.compactFormat = "$cwd$wrap$tokens";
				const withoutToken = footer?.render(width);
				starship.compactFormat = "$cwd( $codex_quota)$wrap$tokens";
				expect(footer?.render(width)).toEqual(withoutToken);
			}
			config.components.footer.codexQuota = true;
			starship.format = "$cwd";
			starship.compactFormat = "$cwd";
			expect(plain(footer?.render(140).join("\n") ?? "")).not.toContain("5h");
		} finally {
			footer?.dispose?.();
		}
	});
});

it("preserves default spacing and custom editor template authority when gated", () => {
	const config = mergeConfig({});
	const values = {
		model: "model",
		modelId: "",
		modelName: "",
		provider: "OpenAI Codex",
		thinking: "high",
		sessionName: "",
		codexQuota: snapshots[1],
	};
	const render = (format: string) =>
		plain(renderEditorMetadataFormat(format, values, theme, config));
	expect(render(config.components.editor.styles.opencode.metadataFormat)).toBe(
		"model  OpenAI Codex  high",
	);
	expect(render("$model( | $codex_quota)")).toBe("model");
	config.components.editor.codexQuota = true;
	expect(render("$model")).toBe("model");
	expect(render(`$model( | \${codex_quota})`)).toBe("model | 5h 80% | week 60%");
});

it("uses synthetic preview data and adds no rail quota row when off", () => {
	const config = mergeConfig({ components: { editor: { style: "accent-rail" } } });
	const before = renderEditorSettingsPreview(config, theme, 72);
	expect(plain(before.join("\n"))).not.toContain("5h");
	config.components.editor.codexQuota = true;
	const after = renderEditorSettingsPreview(config, theme, 72);
	expect(plain(after.join("\n"))).toContain("5h 80% | week 60%");
	expect(after.length).toBe(before.length + 1);
});
