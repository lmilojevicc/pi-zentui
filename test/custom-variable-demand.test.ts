import { describe, expect, it } from "vitest";
import { editorWantsCodexQuota } from "../extensions/zentui/codex-quota";
import { mergeConfig } from "../extensions/zentui/config";
import {
	editorDemandsCustomVariable,
	editorMetadataReferences,
	footerDemandsCustomVariable,
} from "../extensions/zentui/custom-variable-demand";
import { projectDemand } from "../extensions/zentui/project-demand";
import { editorWantsContext } from "../extensions/zentui/ui";

describe("Minimalist template dependency demand", () => {
	it("omitting all metadata stops context/quota/git/root and usage template demand", () => {
		const config = mergeConfig({
			components: {
				editor: {
					style: "minimalist",
					codexQuota: true,
					styles: {
						minimalist: {
							pathDisplay: "project",
							formats: {
								topLeft: "",
								topMiddle: "",
								topRight: "",
								bottomLeft: "",
								bottomMiddle: "",
								bottomRight: "",
							},
						},
					},
				},
			},
		});
		expect(editorMetadataReferences(config).size).toBe(0);
		expect(editorWantsContext(config)).toBe(false);
		expect(editorWantsCodexQuota(config)).toBe(false);
		expect(projectDemand(config, new Set(), true)).toMatchObject({
			active: false,
			git: false,
			root: false,
		});
		expect(editorDemandsCustomVariable(config)).toBe(false);
	});
	it("explicit variables create demand even when corresponding ordinary toggles are off", () => {
		const config = mergeConfig({
			components: {
				editor: {
					style: "minimalist",
					styles: {
						minimalist: {
							showGit: false,
							showTimer: false,
							showCost: false,
							formats: { bottomLeft: "$git_branch", topLeft: "$turn_duration $cost" },
						},
					},
				},
			},
		});
		expect(projectDemand(config, new Set(), true).git).toBe(true);
		expect(editorMetadataReferences(config).has("turn_duration")).toBe(true);
		expect(editorMetadataReferences(config).has("cost")).toBe(true);
	});
	it("does not acquire consent, enable a component, or interpret an unused alias as demand", () => {
		const config = mergeConfig({
			components: {
				editor: {
					style: "minimalist",
					styles: {
						minimalist: {
							variables: { quota: "@scope/usage:quota" },
							formats: { topRight: "$model $codex_quota" },
						},
					},
				},
			},
		});
		expect(editorWantsCodexQuota(config)).toBe(false);
		expect(editorDemandsCustomVariable(config, "@scope/usage:quota")).toBe(false);
		config.components.editor.enabled = false;
		expect(editorMetadataReferences(config).size).toBe(0);
	});
});

it.each(["minimalist", "opencode", "opencode-copy-friendly"] as const)(
	"join_sep alone acquires no data demand in %s; joined content still does",
	(style) => {
		const config = mergeConfig({
			components: {
				editor: {
					style,
					codexQuota: true,
					styles: {
						minimalist: {
							formats: {
								topLeft: "$join_sep",
								topMiddle: "",
								topRight: "",
								bottomLeft: "",
								bottomMiddle: "",
								bottomRight: "",
							},
							variables: { join_sep: "pkg.reserved", build: "pkg.build" },
						},
						opencode: {
							metadataFormat: "$join_sep",
							variables: { join_sep: "pkg.reserved", build: "pkg.build" },
						},
						"opencode-copy-friendly": {
							metadataFormat: "$join_sep",
							variables: { join_sep: "pkg.reserved", build: "pkg.build" },
						},
					},
				},
			},
		});
		expect([...editorMetadataReferences(config)]).toEqual([]);
		expect(editorDemandsCustomVariable(config)).toBe(false);
		expect(editorWantsContext(config)).toBe(false);
		expect(editorWantsCodexQuota(config)).toBe(false);
		expect(projectDemand(config, new Set(), true)).toMatchObject({
			active: false,
			git: false,
			root: false,
		});
		const format = "$git_branch$join_sep$build$join_sep$usage_quota$join_sep$codex_quota";
		if (style === "minimalist")
			config.components.editor.styles.minimalist.formats = {
				...config.components.editor.styles.minimalist.formats,
				topLeft: format,
			};
		else config.components.editor.styles[style].metadataFormat = format;
		expect([...editorMetadataReferences(config)]).toEqual([
			"git_branch",
			"build",
			"usage_quota",
			"codex_quota",
		]);
		expect(editorDemandsCustomVariable(config, "pkg.build")).toBe(true);
		expect(editorWantsCodexQuota(config)).toBe(true);
	},
);

it("Footer join_sep alone does not demand a publisher; joined wide and compact fields still do", () => {
	const config = mergeConfig({
		components: {
			footer: {
				style: "starship",
				styles: {
					starship: {
						format: "$join_sep",
						compactFormat: "$" + "{join_sep}",
						responsive: true,
						variables: { join_sep: "pkg.reserved", build: "pkg.build" },
					},
				},
			},
		},
	});
	expect(footerDemandsCustomVariable(config)).toBe(false);
	config.components.footer.styles.starship.format = "$build$join_sep$missing";
	expect(footerDemandsCustomVariable(config, "pkg.build")).toBe(true);
	config.components.footer.styles.starship.format = "$join_sep";
	config.components.footer.styles.starship.compactFormat = "$missing$join_sep$build";
	expect(footerDemandsCustomVariable(config, "pkg.build")).toBe(true);
	config.components.footer.styles.starship.responsive = false;
	expect(footerDemandsCustomVariable(config)).toBe(false);
});
