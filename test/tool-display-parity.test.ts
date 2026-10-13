import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as host from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller.js";
import { toolDisplayHighlighter } from "../extensions/zentui/tool-display/host.js";
import type { ToolRenderers } from "../extensions/zentui/tool-display/host-contract.js";
import { PendingPreimages, type Preimage } from "../extensions/zentui/tool-display/pending.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import type { ToolDisplayConfig } from "../extensions/zentui/tool-display/types.js";

interface Fixture {
	name: string;
	kind?: "generic" | "mcp";
	omitCustomOutputMode?: boolean;
	theme: string;
	width: number;
	expanded: boolean;
	clock: number;
	partial: boolean;
	error?: boolean;
	started?: boolean;
	elapsed?: number;
	argsComplete?: boolean;
	config: Partial<ToolDisplayConfig>;
	args: Record<string, unknown>;
	preimage?: Preimage;
	result: {
		content: { type: string; text?: string; data?: string; mimeType?: string }[];
		details: unknown;
	};
	mcpMetadata?: { rawServer: string; rawTool: string; label: string; namespace: { name: string } };
	rows: string[];
	unicodeCorrected?: boolean;
	unchangedRows?: string[];
	mcpOpenCode?: boolean;
	nativeMcpRows?: string[];
	mcpArgsExpanded?: boolean;
	upstreamMcpRows?: string[];
	inlineMcpRows?: string[];
	upstreamGenericRows?: string[];
	upstreamWriteRows?: string[];
	upstreamSearchRows?: string[];
	presentationDivergence?: string;
}
const data = JSON.parse(
	gunzipSync(
		readFileSync(new URL("./fixtures/tool-display-parity.json.gz", import.meta.url)),
	).toString("utf8"),
) as {
	provenance: {
		commit: string;
		version: string;
		sdk: string;
		files: Record<string, string>;
		livePaletteSha256: string;
		unicodePatchSha256: string;
		genericInlineArgs: {
			vectors: number;
			rows: number;
			unchangedVectors: number;
			rationale: string;
		};
		mcpInlineArgs: { vectors: number; rows: number; unchangedVectors: number; rationale: string };
		writeContentWithoutPreimage: {
			vectors: number;
			rows: number;
			unchangedVectors: number;
			rationale: string;
		};
		searchResultSeparator: {
			vectors: number;
			rows: number;
			unchangedVectors: number;
			rationale: string;
		};
		mcpOpenCode: { vectors: number; rows: number; unchangedVectors: number; rationale: string };
		mcpArgsExpansion: {
			vectors: number;
			rows: number;
			unchangedVectors: number;
			rationale: string;
		};
		unicodeCorrection: {
			vectors: number;
			rows: number;
			upstreamMalformedRows: number;
			unchangedVectors: number;
		};
		liveTheme: { mode: string; ansi: Record<string, string>; styles: Record<string, string> };
	};
	themeDefinitions: Record<string, unknown>;
	cases: Fixture[];
};
// Real public-card assertions require the modern renderer contract, not older native hosts.
const exports = host as unknown as Record<string, unknown>;
const currentVersion: unknown = JSON.parse(
	readFileSync(
		new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")),
		"utf8",
	),
).version;
const [major, minor, patch] =
	typeof currentVersion === "string" ? currentVersion.split(".").map(Number) : [0, 0, 0];
const modern =
	(major > 1 || (major === 1 && (minor > 0 || patch >= 3))) &&
	typeof exports.createReadToolDefinition === "function" &&
	typeof exports.ToolExecutionComponent === "function";
describe("tool-display pinned complete public-card parity", () => {
	it("records unchanged upstream provenance and real reference palette", () => {
		expect(data.provenance.commit).toBe("91cef7580078371f8dc49a8607222807ad6a424d");
		expect(data.provenance.version).toBe("0.5.0");
		const manifest = JSON.parse(
			readFileSync(
				new URL("./fixtures/tool-display-reference-hashes.json", import.meta.url),
				"utf8",
			),
		);
		expect(data.provenance.files).toEqual(manifest.files);
		expect(data.provenance.commit).toBe(manifest.commit);
		expect(data.provenance.livePaletteSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(data.provenance.unicodePatchSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(data.cases.filter((item) => item.unicodeCorrected).length).toBe(
			data.provenance.unicodeCorrection.vectors,
		);
		expect(data.cases.some((value) => value.theme === "reference-system")).toBe(true);
	});
	it("retains all oracle domains and omitted custom output-mode vectors", () => {
		expect(data.cases).toHaveLength(21366);
		expect(data.provenance.unicodeCorrection).toEqual({
			vectors: 1998,
			rows: 3123,
			upstreamMalformedRows: 2268,
			unchangedVectors: 19368,
		});
		expect(data.provenance.mcpArgsExpansion).toMatchObject({
			vectors: 1134,
			rows: 1134,
			unchangedVectors: 20232,
		});
		const argsExpanded = data.cases.filter((item) => item.mcpArgsExpanded);
		expect(argsExpanded).toHaveLength(data.provenance.mcpArgsExpansion.vectors);
		for (const fixture of argsExpanded) {
			expect(fixture.kind).toBe("mcp");
			expect(fixture.expanded).toBe(true);
			const upstream = fixture.inlineMcpRows as string[];
			const rows = fixture.nativeMcpRows as string[];
			const insertion = rows.findIndex((row, index) => row !== upstream[index]);
			expect(rows[insertion]).toContain("args: ");
			expect(rows).toHaveLength(upstream.length + 1);
			expect(rows.filter((_, index) => index !== insertion)).toEqual(upstream);
		}
		expect(
			data.cases
				.filter((item) => item.kind === "mcp" && !item.expanded)
				.every((item) => !item.mcpArgsExpanded),
		).toBe(true);
		for (const [domain, vectors, rows] of [
			["genericInlineArgs", 702, 702],
			["mcpInlineArgs", 2358, 6345],
			["writeContentWithoutPreimage", 2808, 2808],
			["searchResultSeparator", 702, 702],
		] as const) {
			expect(data.provenance[domain]).toMatchObject({
				vectors,
				rows,
				unchangedVectors: data.cases.length - vectors,
			});
			expect(data.provenance[domain].rationale).not.toBe("");
			const affected = data.cases.filter((value) => value.presentationDivergence === domain);
			expect(affected).toHaveLength(vectors);
			for (const fixture of affected) {
				const upstream =
					fixture.upstreamMcpRows ??
					fixture.upstreamGenericRows ??
					fixture.upstreamWriteRows ??
					fixture.upstreamSearchRows;
				expect(upstream).toBeDefined();
				const rows = fixture.nativeMcpRows ?? fixture.rows;
				expect(rows).not.toEqual(upstream);
				if (domain === "genericInlineArgs" || domain === "mcpInlineArgs") {
					expect(rows.slice(0, 2)).toEqual((upstream as string[]).slice(0, 2));
					expect(rows.slice(fixture.mcpArgsExpanded ? 4 : 3)).toEqual(
						(upstream as string[]).slice(3),
					);
				}
				if (domain === "writeContentWithoutPreimage") {
					const before = upstream as string[];
					const header = fixture.rows.findIndex((row, index) => row !== before[index]);
					expect(fixture.rows.filter((_, index) => index !== header)).toEqual(
						before.filter((_, index) => index !== header),
					);
				}
				if (domain === "searchResultSeparator") {
					const before = upstream as string[];
					const insertion = fixture.rows.findIndex((row, index) => row !== before[index]);
					expect(fixture.rows.filter((_, index) => index !== insertion)).toEqual(before);
				}
			}
		}
		expect(data.provenance.mcpOpenCode).toMatchObject({
			vectors: 2358,
			rows: 8229,
			unchangedVectors: 19008,
		});
		expect(data.provenance.mcpOpenCode.rationale).not.toBe("");
		const openCode = data.cases.filter((item) => item.mcpOpenCode);
		expect(openCode).toHaveLength(data.provenance.mcpOpenCode.vectors);
		let changedRows = 0;
		for (const fixture of openCode) {
			expect(fixture.kind).toBe("mcp");
			expect(fixture.nativeMcpRows).toBeDefined();
			expect(fixture.upstreamMcpRows).toBeDefined();
			expect(fixture.rows).not.toEqual(fixture.nativeMcpRows);
			const before = fixture.nativeMcpRows as string[];
			changedRows +=
				Math.max(before.length, fixture.rows.length) -
				fixture.rows.filter((row, index) => row === before[index]).length;
		}
		expect(changedRows).toBe(data.provenance.mcpOpenCode.rows);
		// All non-MCP domains keep their previous complete ANSI rows; no relaxed comparison.
		expect(
			data.cases
				.filter((item) => item.kind !== "mcp")
				.every((item) => !item.mcpOpenCode && !item.nativeMcpRows),
		).toBe(true);
		const omitted = data.cases.filter((item) => item.omitCustomOutputMode);
		expect(omitted).toHaveLength(108);
		expect(new Set(omitted.map((item) => item.name))).toEqual(
			new Set(["custom_mcp_gateway", "sandbox_echo"]),
		);
		for (const kind of ["generic", "mcp"])
			for (const expanded of [false, true])
				expect(
					omitted.some(
						(item) =>
							item.kind === kind &&
							item.expanded === expanded &&
							item.theme === "system" &&
							item.width === 112 &&
							item.config.mcpOutputMode === "hidden",
					),
				).toBe(true);
	});
	(modern ? it : it.skip)(
		"matches every complete ANSI/color/background/spacing row from the executable upstream oracle",
		async () => {
			// Load capability APIs only inside the modern-host oracle, not older-host imports.
			const tui = await import("@earendil-works/pi-tui");
			const previousCapabilities = tui.getCapabilities();
			// Resolve the SDK's declared Chalk dependency, not an ambient/global package.
			const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
			const chalkEntry = createRequire(sdkEntry).resolve("chalk");
			const { default: chalk } = await import(pathToFileURL(chalkEntry).href);
			const oldLevel = chalk.level;
			chalk.level = 3;
			const agent = mkdtempSync(join(tmpdir(), "zentui-parity-replay-"));
			const oldAgent = process.env.PI_CODING_AGENT_DIR;
			process.env.PI_CODING_AGENT_DIR = agent;
			mkdirSync(join(agent, "themes"));
			for (const [name, value] of Object.entries(data.themeDefinitions))
				writeFileSync(join(agent, "themes", `${name}.json`), JSON.stringify(value));
			vi.useFakeTimers();
			const ui = { requestRender() {} } as unknown as TUI;
			try {
				// Pin cached color capability without replacing ambient capability overrides.
				tui.setCapabilities({ ...previousCapabilities, trueColor: true });
				expect(data.provenance.liveTheme.mode).toBe("truecolor");
				expect(tui.getCapabilities().trueColor).toBe(true);
				for (const [index, fixture] of data.cases.entries()) {
					vi.setSystemTime(fixture.clock);
					host.initTheme(fixture.theme, false);
					const cfg = normalizeToolDisplayConfig({
						enabled: true,
						builtinRendererOverrides: { bash: true },
						...fixture.config,
						customToolOverrides: fixture.kind
							? {
									[fixture.name]: {
										enabled: true,
										kind: fixture.kind,
										...(fixture.omitCustomOutputMode
											? {}
											: { outputMode: fixture.config.mcpOutputMode ?? "hidden" }),
										overrideExistingRenderers: true,
									},
								}
							: {},
					});
					const pending = new PendingPreimages();
					vi.spyOn(pending, "get").mockReturnValue(fixture.preimage);
					const factory =
						exports[`create${fixture.name[0].toUpperCase()}${fixture.name.slice(1)}ToolDefinition`];
					const native: ToolRenderers = fixture.kind
						? {}
						: (factory as (cwd: string) => ToolRenderers)(agent);
					const controller = createToolDisplayController(
						{
							getAllTools: () => [
								{
									name: fixture.name,
									namespace: fixture.mcpMetadata?.namespace,
									sourceInfo: { source: "builtin", path: `builtin:${fixture.name}` },
								},
							],
						},
						() => cfg,
						{
							nativeRenderers: { [fixture.name]: native },
							pending,
							highlighter: toolDisplayHighlighter,
						},
					);
					if (fixture.argsComplete && fixture.preimage) {
						const path = join(agent, fixture.args.path as string);
						if (fixture.preimage.exists) writeFileSync(path, fixture.preimage.content ?? "");
						else rmSync(path, { force: true });
					}
					const renderers = controller.resolver(fixture.name, () => native);
					const row = new host.ToolExecutionComponent(
						fixture.name,
						"fixture",
						fixture.args,
						{ showImages: false },
						renderers,
						ui,
						realpathSync(agent),
					);
					const before = JSON.stringify(fixture.result);
					if (fixture.theme === "reference-system") {
						let theme: host.Theme | undefined;
						new host.ToolExecutionComponent(
							"theme",
							"theme",
							{},
							{},
							{
								renderCall(_args: unknown, value: host.Theme) {
									theme = value;
									return {
										invalidate() {},
										render() {
											return [];
										},
									};
								},
							},
							ui,
							agent,
						);
						if (!theme) throw new Error("Theme callback missing");
						const samples = {
							bold: theme.bold("probe"),
							italic: theme.italic("probe"),
							inverse: theme.inverse("probe"),
							toolOutput: theme.fg("toolOutput", "probe"),
							toolSuccess: theme.bg("toolSuccessBg", "probe"),
						};
						expect(samples).toEqual(data.provenance.liveTheme.styles);
						expect(theme.getColorMode()).toBe(data.provenance.liveTheme.mode);
					}
					row.updateResult({ ...fixture.result, isError: fixture.error === true }, fixture.partial);
					if (fixture.argsComplete) row.setArgsComplete();
					row.setExpanded(fixture.expanded);
					if (fixture.started) row.markExecutionStarted();
					if (fixture.elapsed) vi.advanceTimersByTime(fixture.elapsed);
					expect(
						row.render(fixture.width),
						`fixture${index} ${fixture.name}/${fixture.theme}/${fixture.width} ${JSON.stringify(fixture.config)}`,
					).toEqual(fixture.rows);
					for (const output of row.render(fixture.width))
						expect(Buffer.from(output, "utf8").toString("utf8")).toBe(output);
					if (fixture.unicodeCorrected) expect(fixture.rows).not.toEqual(fixture.unchangedRows);
					expect(JSON.stringify(fixture.result)).toBe(before);
					controller.dispose();
					expect(vi.getTimerCount()).toBe(0);
				}
			} finally {
				tui.setCapabilities(previousCapabilities);
				vi.useRealTimers();
				chalk.level = oldLevel;
				if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = oldAgent;
				host.initTheme("dark", false);
				rmSync(agent, { recursive: true, force: true });
				expect(tui.getCapabilities()).toBe(previousCapabilities);
			}
		},
		60000,
	);
	(modern ? it : it.skip)(
		"acquires native default cards only for new owned rows and restores native self shells on rebuild",
		() => {
			host.initTheme("dark", false);
			const native = host.createEditToolDefinition("/sandbox") as unknown as ToolRenderers;
			let config = normalizeToolDisplayConfig({ enabled: true });
			const controller = createToolDisplayController(
				{
					getAllTools: () => [
						{ name: "edit", sourceInfo: { source: "builtin", path: "builtin:edit" } },
					],
				},
				() => config,
				{ nativeRenderers: { edit: native } },
			);
			const owned = controller.resolver("edit", () => native);
			expect(owned?.renderShell).toBe("default");
			expect(native.renderShell).toBe("self");
			const ui = { requestRender() {} } as unknown as TUI;
			const args = { path: "example.ts", oldText: "old", newText: "new" };
			const result = {
				content: [{ type: "text", text: "edited" }],
				details: { diff: "-1|old\n+1|new" },
				isError: false,
			};
			const baseline = new host.ToolExecutionComponent(
				"edit",
				"native",
				args,
				{ showImages: false },
				native,
				ui,
				"/sandbox",
			);
			baseline.updateResult(result);
			const row = new host.ToolExecutionComponent(
				"edit",
				"owned",
				args,
				{ showImages: false },
				owned,
				ui,
				"/sandbox",
			);
			row.updateResult(result);
			expect(row.render(80)).not.toEqual(baseline.render(80));
			config = normalizeToolDisplayConfig({ enabled: false });
			row.updateResult(result);
			// Callbacks relinquish, but a constructed default card cannot become a self shell.
			expect(row.render(80)).not.toEqual(baseline.render(80));
			expect(controller.resolver("edit", () => native)).toBe(native);
			const rebuilt = new host.ToolExecutionComponent(
				"edit",
				"rebuilt",
				args,
				{ showImages: false },
				controller.resolver("edit", () => native),
				ui,
				"/sandbox",
			);
			rebuilt.updateResult(result);
			expect(rebuilt.render(80)).toEqual(baseline.render(80));
			controller.dispose();
		},
	);
	(modern ? it : it.skip)(
		"delivers actual host component-owned predecessor partial/final cleanup even without paint",
		() => {
			vi.useFakeTimers();
			try {
				class Resource implements Component {
					timer?: ReturnType<typeof setInterval>;
					invalidate() {}
					render() {
						return ["resource"];
					}
				}
				const seen: (Component | undefined)[] = [];
				const predecessor: ToolRenderers = {
					renderResult(_result, opts, _theme, ctx) {
						seen.push(ctx.lastComponent);
						const current =
							ctx.lastComponent instanceof Resource ? ctx.lastComponent : new Resource();
						if (opts.isPartial && !current.timer) current.timer = setInterval(() => {}, 1000);
						if (!opts.isPartial && current.timer) {
							clearInterval(current.timer);
							current.timer = undefined;
						}
						return current;
					},
				};
				let cfg = normalizeToolDisplayConfig({
					enabled: true,
					customToolOverrides: { resource: { enabled: true, overrideExistingRenderers: true } },
				});
				const controller = createToolDisplayController({}, () => cfg, { nativeRenderers: {} });
				const row = new host.ToolExecutionComponent(
					"resource",
					"resource",
					{},
					{ showImages: false },
					controller.resolver("resource", () => predecessor),
					{ requestRender() {} } as unknown as TUI,
					"/sandbox",
				);
				cfg = normalizeToolDisplayConfig({ enabled: false });
				row.updateResult({ content: [{ type: "text", text: "partial" }], isError: false }, true);
				expect(vi.getTimerCount()).toBe(1);
				cfg = normalizeToolDisplayConfig({
					enabled: true,
					customToolOverrides: { resource: { enabled: true, overrideExistingRenderers: true } },
				});
				row.updateResult({ content: [{ type: "text", text: "final" }], isError: false }, false);
				expect(seen).toHaveLength(2);
				expect(seen[0]).toBeUndefined();
				expect(seen[1]).toBeInstanceOf(Resource);
				expect(vi.getTimerCount()).toBe(0);
				controller.dispose();
			} finally {
				vi.useRealTimers();
			}
		},
	);
});
