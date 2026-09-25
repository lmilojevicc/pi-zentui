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
				config.icons.effectiveMode = iconMode;
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
							"$cwd$fill$model$wrap_sep($codex_quota)$wrap_sep$tokens",
							"$cwd( $codex_quota)$fill$model$wrap_sep$tokens",
							"$fill$codex_quota$wrap_sep$codex_quota$wrap$tokens",
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

it.each(["opencode", "opencode-copy-friendly"] as const)(
	"preserves shell model color while %s quota is included or omitted",
	(style) => {
		const config = mergeConfig({
			components: { editor: { style, colorSource: "terminal", codexQuota: true } },
		});
		config.components.editor.styles[style].metadataFormat = "$model( $codex_quota)";
		for (const width of [15, 100]) {
			const rows = renderPolishedEditorFrame({
				width,
				editorLines: ["!ls"],
				uiTheme: theme,
				config,
				modelMeta: { modelLabel: "Model", providerLabel: "", codexQuota: snapshots[1] },
				shellMode: true,
			});
			expect(rows.join("\n")).toContain("\x1b[96mModel\x1b[0m");
			expect(plain(rows.join("\n")).includes("5h 80% | week 60%")).toBe(width === 100);
			assertAtomic(rows, width, snapshots[1]);
		}
	},
);

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

it.each(["opencode", "opencode-copy-friendly", "minimalist"] as const)(
	"preserves selected model label in synthetic %s quota previews",
	(style) => {
		const config = mergeConfig({ components: { editor: { style, codexQuota: true } } });
		for (const modelLabel of ["id", "name"] as const) {
			config.components.editor.modelLabel = modelLabel;
			const output = plain(renderEditorSettingsPreview(config, theme, 72).join("\n"));
			expect(output).toContain(modelLabel === "name" ? "GPT-5.4" : "gpt-5.4");
		}
	},
);

it.each([
	{ responsive: true, masked: false },
	{ responsive: false, masked: false },
	{ responsive: true, masked: true },
	{ responsive: false, masked: true },
])(
	"tracks owned footer quota independently of matching statuses ($responsive, masked=$masked)",
	({ responsive, masked }) => {
		const quota = { fiveHour: 80, week: 60 };
		const text = codexQuotaText(quota);
		let status = `\x1b]8;;https://example.com/quota\x07\x1b[35m${text}\x1b[39m\x1b]8;;\x07`;
		const config = mergeConfig({ components: { footer: { codexQuota: true } } });
		const starship = config.components.footer.styles.starship;
		Object.assign(starship, {
			responsive,
			format: "Z:$codex_quota",
			compactFormat: "$codex_quota$wrap$extensions",
		});
		starship.extensionStatuses.colorModes.other = "original";
		let factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0];
		installFooter(
			{
				cwd: "/repo",
				model: { provider: "openai-codex" },
				sessionManager: { getSessionName: () => "" },
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
			getExtensionStatuses: () => new Map([["other", status]]),
		} as never);
		try {
			if (!masked) {
				const wide = footer?.render(100).join("\n") ?? "";
				expect(plain(wide)).toContain(`Z:${text}`);
				expect(wide).toContain(status);
				status = "AA AA% | AAAA AA%";
				const collision = footer?.render(100).join("\n") ?? "";
				expect(plain(collision)).toContain(`Z:${text}`);
				expect(collision).toContain(status);
				status = "";
				const conditional = "(AA AA% | AA${session_name}AA AA% $codex_quota)";
				const expected = `AA AA% | AAAA AA% ${text}`;
				starship.format = conditional;
				expect(plain(footer?.render(100).join("\n") ?? "")).toContain(expected);
				if (responsive) {
					starship.format = "force compact ".repeat(20);
					starship.compactFormat = conditional;
					expect(plain(footer?.render(100).join("\n") ?? "")).toContain(expected);
				}
				starship.responsive = false;
				starship.format = "AA AA% | AA $fill AA AA% $fill$codex_quota";
				expect(plain(footer?.render(36).join("\n") ?? "")).toContain(`AA AA% | AAAA AA%${text}`);
				starship.responsive = responsive;
				starship.format = "Z:$codex_quota";
				starship.compactFormat = "$codex_quota$wrap$extensions";
				status = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]
					.map((letter) => letter.repeat(4))
					.join(" ");
				const exhausted = footer?.render(500).join("\n") ?? "";
				expect(plain(exhausted)).not.toContain(`Z:${text}`);
				expect(exhausted).toContain(status);
				return;
			}
			// Legacy middle content is fitted after right statuses: the matching status must not
			// stand in for a clipped owned occurrence. Responsive compact has the same collision.
			starship.format = "$fill$codex_quota$fill";
			starship.compactFormat = "$extensions$wrap$codex_quota";
			starship.compactMaxLines = 1;
			for (let width = 1; width <= 100; width++) {
				const rows = footer?.render(width) ?? [];
				// Remove only the original-colored third-party span before checking owned output.
				const owned = rows.map((row) => row.replace(/\x1b\[35m[^\x1b]*/g, ""));
				assertAtomic(owned, width, quota);
				if (!plain(owned.join("\n")).includes(text)) {
					config.components.footer.codexQuota = false;
					expect(rows).toEqual(footer?.render(width));
					config.components.footer.codexQuota = true;
				}
			}
		} finally {
			footer?.dispose?.();
		}
	},
);
