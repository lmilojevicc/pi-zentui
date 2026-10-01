import { describe, expect, it } from "vitest";
import { editorWantsCodexQuota } from "../extensions/zentui/codex-quota";
import { mergeConfig } from "../extensions/zentui/config";
import {
	editorDemandsCustomVariable,
	editorMetadataReferences,
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
