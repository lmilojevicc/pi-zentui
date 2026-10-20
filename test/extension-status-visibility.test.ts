import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getExtensionStatusPlacement,
	mergeConfig,
	saveExtensionStatusChoice,
} from "../extensions/zentui/config";
import { collectExtensionStatusSegments } from "../extensions/zentui/extension-status";
import { extensionStatusChoice } from "../extensions/zentui/extension-status-settings";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(record: object): string {
	const dir = mkdtempSync(join(tmpdir(), "zentui-extension-visibility-"));
	dirs.push(dir);
	const path = join(dir, "zentui.json");
	writeFileSync(path, JSON.stringify(record));
	return path;
}

function renderedKeys(config: ReturnType<typeof mergeConfig>, statuses: Record<string, string>) {
	const segments = collectExtensionStatusSegments(new Map(Object.entries(statuses)), config);
	return [
		...segments.left.map((segment) => segment.key),
		...segments.middle.map((segment) => segment.key),
		...segments.right.map((segment) => segment.key),
	];
}

describe("Starship extension status visibility", () => {
	it("hides a per-key status regardless of a positive Starship placement", () => {
		const config = mergeConfig({
			components: {
				footer: {
					style: "starship",
					styles: {
						starship: {
							extensionStatuses: { placements: { "pi-cache-stats": "right" } },
						},
					},
				},
				extensionStatuses: { visibility: { "pi-cache-stats": "hide" } },
			},
		});
		expect(getExtensionStatusPlacement(config, "pi-cache-stats")).toBe("off");
		expect(
			renderedKeys(config, { "pi-cache-stats": "cache 42%", "other-status": "other" }),
		).toEqual(["other-status"]);
	});

	it("keeps the panel choice aligned with what the Starship footer renders", () => {
		const config = mergeConfig({
			components: {
				footer: {
					style: "starship",
					styles: {
						starship: {
							extensionStatuses: { placements: { "pi-cache-stats": "right" } },
						},
					},
				},
				extensionStatuses: { visibility: { "pi-cache-stats": "hide" } },
			},
		});
		expect(extensionStatusChoice(config, "pi-cache-stats")).toBe("off");
		expect(getExtensionStatusPlacement(config, "pi-cache-stats")).toBe("off");
	});

	it("hides inherited keys while the default visibility is Off", () => {
		const config = mergeConfig({
			components: { extensionStatuses: { defaultVisibility: "hide" } },
		});
		expect(getExtensionStatusPlacement(config, "unset")).toBe("off");
		expect(extensionStatusChoice(config, "unset")).toBe("off");
		expect(renderedKeys(config, { unset: "text" })).toEqual([]);
	});

	it("keeps an explicitly shown key visible while the default visibility is Off", () => {
		const config = mergeConfig({
			components: {
				extensionStatuses: { defaultVisibility: "hide", visibility: { shown: "show" } },
			},
		});
		expect(getExtensionStatusPlacement(config, "shown")).toBe("right");
		expect(extensionStatusChoice(config, "shown")).toBe("right");
		expect(renderedKeys(config, { shown: "text" })).toEqual(["shown"]);
	});

	it("keeps a Starship local off placement authoritative for a shown key", () => {
		const config = mergeConfig({
			components: {
				footer: {
					style: "starship",
					styles: {
						starship: { extensionStatuses: { placements: { local: "off" } } },
					},
				},
				extensionStatuses: { visibility: { local: "show" } },
			},
		});
		expect(getExtensionStatusPlacement(config, "local")).toBe("off");
		expect(extensionStatusChoice(config, "local")).toBe("off");
		expect(renderedKeys(config, { local: "text" })).toEqual([]);
	});
});

describe("Off write consistency", () => {
	it("removes the Starship placement when Off is chosen", () => {
		const path = fixture({
			components: {
				footer: {
					style: "starship",
					styles: {
						starship: {
							extensionStatuses: { placements: { "pi-cache-stats": "right", keep: "left" } },
						},
					},
				},
				extensionStatuses: { visibility: { "pi-cache-stats": "show" } },
			},
		});
		saveExtensionStatusChoice("pi-cache-stats", "off", "starship", path);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		expect(saved.components.extensionStatuses.visibility["pi-cache-stats"]).toBe("hide");
		expect(saved.components.footer.styles.starship.extensionStatuses.placements).toEqual({
			keep: "left",
		});
		const config = mergeConfig(saved);
		expect(getExtensionStatusPlacement(config, "pi-cache-stats")).toBe("off");
		expect(extensionStatusChoice(config, "pi-cache-stats")).toBe("off");
		expect(renderedKeys(config, { "pi-cache-stats": "cache 42%" })).toEqual([]);
	});

	it("removes the Hidden placement when Off is chosen under the Hidden footer", () => {
		const path = fixture({
			components: {
				footer: { style: "hidden" },
				extensionStatuses: {
					visibility: { "pi-cache-stats": "show" },
					hidden: { placements: { "pi-cache-stats": "right", keep: "left" } },
				},
			},
		});
		saveExtensionStatusChoice("pi-cache-stats", "off", "hidden", path);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		expect(saved.components.extensionStatuses.visibility["pi-cache-stats"]).toBe("hide");
		expect(saved.components.extensionStatuses.hidden.placements).toEqual({ keep: "left" });
	});

	it("keeps the dormant Starship placement when Off is chosen under the Native footer", () => {
		const path = fixture({
			components: {
				footer: {
					style: "native",
					styles: {
						starship: { extensionStatuses: { placements: { "pi-cache-stats": "right" } } },
					},
				},
			},
		});
		saveExtensionStatusChoice("pi-cache-stats", "off", "native", path);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		expect(saved.components.extensionStatuses.visibility["pi-cache-stats"]).toBe("hide");
		// Native owns no placement map, so the dormant Starship preference stays untouched.
		expect(saved.components.footer.styles.starship.extensionStatuses.placements).toEqual({
			"pi-cache-stats": "right",
		});
		const config = mergeConfig(saved);
		expect(extensionStatusChoice(config, "pi-cache-stats")).toBe("off");
		expect(getExtensionStatusPlacement(config, "pi-cache-stats")).toBe("off");
		expect(renderedKeys(config, { "pi-cache-stats": "cache 42%" })).toEqual([]);
	});

	it("keeps the dormant Hidden placement when Off is chosen under the Starship footer", () => {
		const path = fixture({
			components: {
				footer: {
					style: "starship",
					styles: {
						starship: { extensionStatuses: { placements: { "pi-cache-stats": "right" } } },
					},
				},
				extensionStatuses: { hidden: { placements: { "pi-cache-stats": "left" } } },
			},
		});
		saveExtensionStatusChoice("pi-cache-stats", "off", "starship", path);
		const saved = JSON.parse(readFileSync(path, "utf8"));
		expect(saved.components.extensionStatuses.hidden.placements).toEqual({
			"pi-cache-stats": "left",
		});
		expect(saved.components.footer.styles.starship.extensionStatuses.placements).toEqual({});
	});

	it("keeps the Starship footer hidden for an Off key saved with a positive placement", () => {
		const path = fixture({
			components: {
				footer: {
					style: "starship",
					styles: {
						starship: {
							extensionStatuses: { placements: { "pi-cache-stats": "right" } },
						},
					},
				},
			},
		});
		saveExtensionStatusChoice("pi-cache-stats", "off", "starship", path);
		const config = mergeConfig(JSON.parse(readFileSync(path, "utf8")));
		expect(config.components.extensionStatuses.visibility["pi-cache-stats"]).toBe("hide");
		expect(renderedKeys(config, { "pi-cache-stats": "cache 42%" })).toEqual([]);
	});
});
