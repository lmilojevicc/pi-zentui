import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultConfig,
	mergeConfig,
	saveMinimalistEditorStylePatch,
	saveMinimalistTemplatePatch,
} from "../extensions/zentui/config";
import {
	MINIMALIST_BUILTIN_VARIABLES,
	MINIMALIST_FORMAT_SLOTS,
} from "../extensions/zentui/minimalist-template";

type StoredConfig = {
	future?: unknown;
	components: {
		editor: { style?: string; styles: { minimalist: Record<string, unknown>; opencode?: unknown } };
		footer?: unknown;
		userMessages?: unknown;
	};
};

function withConfig(record: unknown, run: (path: string, read: () => StoredConfig) => void) {
	const directory = mkdtempSync(join(tmpdir(), "zentui-minimalist-templates-"));
	const path = join(directory, "zentui.json");
	try {
		writeFileSync(path, JSON.stringify(record));
		run(path, () => JSON.parse(readFileSync(path, "utf8")));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
function style(value: unknown) {
	return mergeConfig({ components: { editor: { styles: { minimalist: value } } } }).components
		.editor.styles.minimalist;
}

describe("Minimalist template configuration", () => {
	it("inherits runtime defaults and accepts sparse slots including intentional empty strings", () => {
		const defaults = style({});
		expect(defaults.formats).toEqual(defaultConfig.components.editor.styles.minimalist.formats);
		expect(defaults.variables ?? {}).toEqual({});
		expect(defaults.extensionColorMode ?? "original").toBe("original");
		const formats = Object.fromEntries(
			MINIMALIST_FORMAT_SLOTS.map((slot, index) => [slot, index ? "$value" : ""]),
		);
		expect(style({ formats }).formats).toEqual(formats);
		expect(
			style({ formats: { topLeft: "", topRight: false, bottomRight: 42, bogus: "ignored" } })
				.formats,
		).toEqual({ ...defaults.formats, topLeft: "" });
		expect(style({ formats: false }).formats).toEqual(defaults.formats);
		for (const bottomLeft of [null, false, 42, []]) {
			expect(style({ formats: { bottomLeft, topRight: "" } }).formats).toEqual({
				...defaults.formats,
				topRight: "",
			});
		}
	});

	it("rejects reserved and malformed aliases and caps accepted aliases", () => {
		const variables = {
			...Object.fromEntries(MINIMALIST_BUILTIN_VARIABLES.map((name) => [name, "pkg.reserved"])),
			"bad-name": "pkg.bad",
			empty: "",
			long: "x".repeat(65),
			spaces: "bad key",
			valid: "x".repeat(64),
			...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`value${i}`, `pkg.${i}`])),
		};
		const normalized = style({ variables }).variables ?? {};
		expect(Object.keys(normalized)).toHaveLength(16);
		expect(normalized.valid).toHaveLength(64);
		for (const name of MINIMALIST_BUILTIN_VARIABLES)
			expect(Object.hasOwn(normalized, name)).toBe(name === "ci");
		expect(normalized.empty).toBeUndefined();
		expect(normalized.long).toBeUndefined();
		expect(normalized.spaces).toBeUndefined();
	});

	it.each(["original", "zentui"])(
		"accepts %s mode and rejects invalid modes",
		(extensionColorMode) => {
			expect(style({ extensionColorMode }).extensionColorMode).toBe(extensionColorMode);
			expect(style({ extensionColorMode: "invalid" }).extensionColorMode).toBeUndefined();
		},
	);

	it("saves a sparse format/alias/color patch without rewriting styles, owners, unknown data or selections", () => {
		const original = {
			future: { keep: true },
			components: {
				editor: {
					style: "future-editor",
					future: 7,
					styles: {
						opencode: { metadataFormat: "$model", future: 8 },
						minimalist: {
							future: 9,
							showTimer: false,
							formats: { topLeft: "$session_name", futureSlot: "future" },
							variables: { prior: "pkg.prior" },
						},
					},
				},
				footer: { style: "native", future: "footer" },
				userMessages: { enabled: false },
			},
		};
		withConfig(original, (path, read) => {
			saveMinimalistEditorStylePatch(
				{
					formats: { topRight: "", bottomMiddle: "$build" },
					variables: { build: "pkg.build", join_sep: "pkg.reserved" },
					extensionColorMode: "zentui",
				},
				path,
			);
			const saved = read();
			expect(saved.components.editor.style).toBe("future-editor");
			expect(saved.components.editor.styles.minimalist).toEqual({
				...original.components.editor.styles.minimalist,
				formats: {
					...original.components.editor.styles.minimalist.formats,
					topRight: "",
					bottomMiddle: "$build",
				},
				variables: { prior: "pkg.prior", build: "pkg.build" },
				extensionColorMode: "zentui",
			});
			expect(saved.components.editor.styles.opencode).toEqual(
				original.components.editor.styles.opencode,
			);
			expect(saved.components.footer).toEqual(original.components.footer);
			expect(saved.components.userMessages).toEqual(original.components.userMessages);
			expect(saved.future).toEqual(original.future);
		});
	});

	it("resets only selected leaves by deletion while keeping untouched sparse values", () => {
		withConfig(
			{
				components: {
					editor: {
						styles: {
							minimalist: {
								formats: { topLeft: "$session_name", topRight: "" },
								variables: { one: "pkg.one", two: "pkg.two" },
								extensionColorMode: "zentui",
							},
						},
					},
				},
			},
			(path, read) => {
				saveMinimalistTemplatePatch(
					{ formats: { topRight: null }, variables: { one: null }, extensionColorMode: null },
					path,
				);
				expect(read().components.editor.styles.minimalist).toEqual({
					formats: { topLeft: "$session_name" },
					variables: { two: "pkg.two" },
				});
				const resolved = saveMinimalistTemplatePatch(
					{ formats: { topLeft: null }, variables: { two: null } },
					path,
				);
				expect(read().components.editor.styles.minimalist).toEqual({});
				expect(resolved.components.editor.styles.minimalist.formats).toEqual(
					defaultConfig.components.editor.styles.minimalist.formats,
				);
			},
		);
	});

	it("persists mixed ordinary and template edits atomically without losing unedited threshold leaves", () => {
		withConfig(
			{
				components: {
					editor: {
						styles: { minimalist: { contextThresholds: { warning: 50, error: 90 }, future: 1 } },
					},
				},
			},
			(path, read) => {
				saveMinimalistTemplatePatch(
					{
						showCost: false,
						formats: { topLeft: "" },
						contextThresholds: { warning: 60, error: 90 },
					},
					path,
				);
				expect(read().components.editor.styles.minimalist).toEqual({
					future: 1,
					showCost: false,
					formats: { topLeft: "" },
					contextThresholds: { warning: 60, error: 90 },
				});
			},
		);
	});

	it("does not persist invalid new aliases or exceed capacity and permits replacing an existing alias", () => {
		const variables = Object.fromEntries(
			Array.from({ length: 16 }, (_, i) => [`v${i}`, `pkg.${i}`]),
		);
		withConfig(
			{ components: { editor: { styles: { minimalist: { variables } } } } },
			(path, read) => {
				saveMinimalistTemplatePatch(
					{
						variables: {
							extra: "pkg.extra",
							model: "pkg.reserved",
							v0: "pkg.replaced",
							malformed: "x".repeat(65),
						},
					},
					path,
				);
				expect(read().components.editor.styles.minimalist.variables).toEqual({
					...variables,
					v0: "pkg.replaced",
				});
			},
		);
	});
});

it.each(["\u00a0", "\u2003", "\u2028", "\u0085", "\u009b"])(
	"rejects Unicode whitespace and C1 controls in alias publisher keys: %j",
	(control) => {
		const config = mergeConfig({
			components: {
				editor: {
					styles: {
						minimalist: {
							variables: { quota: `pkg${control}quota` },
						},
					},
				},
			},
		});
		expect(config.components.editor.styles.minimalist.variables).toEqual({});
	},
);
