// Development-only oracle. Never imports upstream from production code or executes a tool.
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import { validateReferenceSources } from "./tool-display-reference-provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = process.env.ZENTUI_TOOL_DISPLAY_REFERENCE;
const jitiEntry = process.env.ZENTUI_TOOL_DISPLAY_JITI_ENTRY;
if (!reference || !jitiEntry)
	throw new Error(
		"Set ZENTUI_TOOL_DISPLAY_REFERENCE to the unchanged pinned checkout and ZENTUI_TOOL_DISPLAY_JITI_ENTRY to temporary jiti's public entry.",
	);
const pinnedManifest = JSON.parse(
	readFileSync(join(root, "test/fixtures/tool-display-reference-hashes.json"), "utf8"),
);
validateReferenceSources(reference, pinnedManifest);
if (process.argv.includes("--validate-reference-only")) {
	console.log(`Pinned reference validated: ${pinnedManifest.commit}`);
	process.exit(0);
}
const agent = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "zentui-parity-agent-"));
process.env.PI_CODING_AGENT_DIR = agent;
// The live TTY enables Chalk styles; headless oracle processes must do the same.
process.env.FORCE_COLOR = "3";
process.env.PI_OFFLINE = "1";
process.env.PI_SKIP_VERSION_CHECK = "1";
const sdkEntry =
	process.env.ZENTUI_TOOL_DISPLAY_HOST_ENTRY ??
	fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const tuiPackage = findPackageJSON("@earendil-works/pi-tui", pathToFileURL(sdkEntry).href);
if (!tuiPackage) throw new Error("Cannot locate the selected SDK's public TUI dependency");
const tuiEntry = join(dirname(tuiPackage), JSON.parse(readFileSync(tuiPackage, "utf8")).main);
const sdk = await import(sdkEntry);
const tui = await import(tuiEntry);
const { createJiti } = await import(jitiEntry);
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-coding-agent": sdkEntry, "@earendil-works/pi-tui": tuiEntry },
});
for (const [entry, exports] of [
	[sdkEntry, sdk],
	[tuiEntry, tui],
])
	for (const path of new Set([entry, realpathSync(entry)]))
		jiti.cache[path] = { id: path, filename: path, loaded: true, exports };
const unicodePatchPath = join(root, "test/fixtures/tool-display-unicode-reference-patch.json");
const unicodePatch = JSON.parse(readFileSync(unicodePatchPath, "utf8"));
const correctedRoot = mkdtempSync(
	join(process.env.TMPDIR ?? "/tmp", "zentui-parity-corrected-reference-"),
);
cpSync(join(reference, "src"), join(correctedRoot, "src"), { recursive: true });
let correctedSource = readFileSync(join(correctedRoot, unicodePatch.file), "utf8");
for (const replacement of unicodePatch.replacements) {
	if (correctedSource.split(replacement.oldText).length !== 2)
		throw new Error("Minimal reference patch target is not unique");
	correctedSource = correctedSource.replace(replacement.oldText, replacement.newText);
}
writeFileSync(join(correctedRoot, unicodePatch.file), correctedSource);
async function referenceModules(path) {
	return {
		upstream: await jiti.import(join(path, "src/tool-overrides.ts")),
		diff: await jiti.import(join(path, "src/diff-renderer.ts")),
		types: await jiti.import(join(path, "src/types.ts")),
		disposable: await jiti.import(join(path, "src/disposable.ts")),
	};
}
const original = await referenceModules(reference);
const corrected = await referenceModules(correctedRoot);
const candidateRoot = resolve(process.env.ZENTUI_TOOL_DISPLAY_CANDIDATE_ROOT ?? root);
const candidateHost = await jiti.import(
	join(candidateRoot, "extensions/zentui/tool-display/host.ts"),
);
const candidate = await jiti.import(
	join(candidateRoot, "extensions/zentui/tool-display/controller.ts"),
);
const configModule = await jiti.import(
	join(candidateRoot, "extensions/zentui/tool-display/presets.ts"),
);
const pendingModule = await jiti.import(
	join(candidateRoot, "extensions/zentui/tool-display/pending.ts"),
);
const themes = ["dark", "system"];
const themeDefinitions = {};
const livePalettePath = process.env.ZENTUI_TOOL_DISPLAY_REFERENCE_THEME;
if (livePalettePath) {
	const palette = JSON.parse(readFileSync(livePalettePath, "utf8"));
	const colors = Object.fromEntries(
		Object.entries(palette.ansi ?? palette.colors).map(([token, ansi]) => {
			if (!palette.ansi) return [token, ansi];
			const rgb = /\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/.exec(ansi);
			const indexed = /\x1b\[(?:38|48);5;(\d+)m/.exec(ansi);
			if (/\x1b\[2m/.test(ansi))
				throw new Error(
					"Captured faint ANSI requires an explicit public theme-instance harness; do not approximate it.",
				);
			return [
				token,
				rgb
					? `#${rgb
							.slice(1)
							.map((value) => Number(value).toString(16).padStart(2, "0"))
							.join("")}`
					: indexed
						? Number(indexed[1])
						: "",
			];
		}),
	);
	themeDefinitions["reference-system"] = {
		name: "reference-system",
		appearance: palette.appearance ?? "dark",
		colors,
	};
	mkdirSync(join(agent, "themes"));
	writeFileSync(
		join(agent, "themes/reference-system.json"),
		JSON.stringify(themeDefinitions["reference-system"]),
	);
	themes.push("reference-system");
}
const templates = [
	{
		name: "read",
		args: { path: "example.ts", offset: 3, limit: 6 },
		result: {
			content: [{ type: "text", text: "const value = 1;\n\nreturn value;\n" }],
			details: {},
		},
	},
	{
		name: "grep",
		args: { pattern: "value", path: "src", glob: "*.ts", limit: 20 },
		result: { content: [{ type: "text", text: "a.ts:1:value\nb.ts:2:value\n" }], details: {} },
	},
	{
		name: "find",
		args: { pattern: "*.ts", path: "src", limit: 20 },
		result: { content: [{ type: "text", text: "a.ts\nb.ts\n" }], details: {} },
	},
	{
		name: "ls",
		args: { path: "src", limit: 20 },
		result: { content: [{ type: "text", text: "a.ts\nb.ts\n" }], details: {} },
	},
	{
		name: "bash",
		args: { command: "printf 'hello\\nworld\\n'", timeout: 5 },
		result: { content: [{ type: "text", text: "hello\nworld\n" }], details: {} },
	},
	{
		name: "edit",
		args: { path: "long-line.txt", oldText: "before", newText: "after" },
		result: {
			content: [{ type: "text", text: "edited" }],
			details: {
				diff: ` 1|LONG_LINE ${"café 日本語 🙂 wrap-and-clip ".repeat(35)}\n-2|status: before\n+2|status: after`,
			},
		},
	},
	{
		name: "edit",
		args: { path: "many-lines.ts", oldText: "row 050: before", newText: "row 050: after" },
		result: {
			content: [{ type: "text", text: "edited" }],
			details: {
				diff: " 45|...\n 46|row 046: before\n 47|row 047: before\n 48|row 048: before\n 49|row 049: before\n-50|row 050: before\n+50|row 050: after\n 51|row 051: before\n 52|row 052: before\n 53|row 053: before\n 54|row 054: before\n 55|...",
			},
		},
	},
	{
		name: "edit",
		args: { path: "anchors.ts", oldText: "old", newText: "new" },
		result: {
			content: [{ type: "text", text: "edited" }],
			details: {
				diff: " 1#AA:const same = '界';\n-2#BB:const old = '🧪';\n+2#CC:const next = '🧫';\n+3#DD:const added = 2;\n 3#EE:return same;",
			},
		},
	},
	{
		name: "edit",
		args: { path: "combining.ts", oldText: "e\u0301", newText: "e\u0300" },
		result: {
			content: [{ type: "text", text: "edited" }],
			details: { diff: "-1|const text = 'e\u0301';\n+1|const text = 'e\u0300';" },
		},
	},
	{
		name: "edit",
		args: { path: "zwj.ts", oldText: "👩‍💻", newText: "👩‍🔬" },
		result: {
			content: [{ type: "text", text: "edited" }],
			details: { diff: "-1|const icon = '👩‍💻';\n+1|const icon = '👩‍🔬';" },
		},
	},
	{
		name: "write",
		args: { path: "new.ts", content: "const value = '界';\nconsole.log(value);\n" },
		preimage: { exists: false, content: "" },
		result: { content: [{ type: "text", text: "written" }], details: {} },
	},
	{
		name: "write",
		args: { path: "existing.ts", content: "const value = '🧫';\nconsole.log(value);\n" },
		preimage: { exists: true, content: "const value = '🧪';\nconsole.log(value);\n" },
		result: { content: [{ type: "text", text: "written" }], details: {} },
	},
	{
		name: "write",
		args: { path: "plain.txt", content: "LONG_LINE café 日本語 🙂 wrap-and-clip\n" },
		preimage: { exists: false, content: "" },
		result: { content: [{ type: "text", text: "written" }], details: {} },
	},
	{
		name: "write",
		args: { path: "empty.txt", content: "" },
		preimage: { exists: false, content: "" },
		result: { content: [{ type: "text", text: "written" }], details: {} },
	},
	{
		name: "demo_generic",
		kind: "generic",
		args: { query: "value", limit: 2 },
		result: { content: [{ type: "text", text: "first\nsecond\n" }], details: {} },
	},
	{
		name: "mcp",
		kind: "mcp",
		args: { tool: "echo", server: "demo", args: { value: "hello" } },
		result: { content: [{ type: "text", text: "first\nsecond\n" }], details: {} },
	},
];
templates.push({
	name: "mcp__demo__echo",
	kind: "mcp",
	args: { value: "hello" },
	result: { content: [{ type: "text", text: "echo response" }], details: {} },
});
for (const [label, tail, crlf] of [
	["absent", "", false],
	["lf", "\n", false],
	["two-blanks", "\n\n", false],
	["three-blanks", "\n\n\n", false],
	["crlf", "\r\n", true],
]) {
	const payload = (crlf ? "-1|old\r\n+1|new" : "-1|old\n+1|new") + tail;
	templates.push({
		name: "edit",
		args: { path: `terminal-${label}.txt`, oldText: "old", newText: "new" },
		result: { content: [{ type: "text", text: "edited" }], details: { diff: payload } },
	});
}
templates.push({
	name: "custom_mcp_gateway",
	kind: "mcp",
	args: { tool: "echo", server: "demo", args: { message: "gateway" } },
	result: { content: [{ type: "text", text: "gateway response" }], details: {} },
});
templates.push({
	name: "mcp__zentui_demo__echo",
	kind: "mcp",
	args: { message: "hello from real local MCP server" },
	result: { content: [{ type: "text", text: "hello from real local MCP server" }], details: {} },
});
templates.push({
	name: "sandbox_echo",
	kind: "generic",
	args: { message: "hello from real custom tool" },
	result: {
		content: [
			{
				type: "text",
				text: Array.from(
					{ length: 12 },
					(_, i) => `custom ${i + 1}: hello from real custom tool`,
				).join("\n"),
			},
		],
		details: {},
	},
});
templates.push({
	name: "mcp__demo__prod__echo",
	kind: "mcp",
	args: { message: "double underscore" },
	result: { content: [{ type: "text", text: "response" }], details: {} },
});
templates.push({
	name: "mcp__demo_prod__echo",
	kind: "mcp",
	args: { message: "single underscore" },
	result: { content: [{ type: "text", text: "response" }], details: {} },
});
const registeredMcpMetadata = {
	mcp__demo__echo: {
		rawServer: "demo",
		rawTool: "echo",
		label: "demo/echo",
		namespace: { name: "mcp__demo" },
	},
	mcp__zentui_demo__echo: {
		rawServer: "zentui_demo",
		rawTool: "echo",
		label: "zentui_demo/echo",
		namespace: { name: "mcp__zentui_demo" },
	},
	mcp__demo__prod__echo: {
		rawServer: "demo__prod",
		rawTool: "echo",
		label: "demo__prod/echo",
		namespace: { name: "mcp__demo__prod" },
	},
	mcp__demo_prod__echo: {
		rawServer: "demo_prod",
		rawTool: "echo",
		label: "demo_prod/echo",
		namespace: { name: "mcp__demo_prod" },
	},
};
for (const template of templates)
	if (/^mcp__/.test(template.name)) {
		template.mcpMetadata = registeredMcpMetadata[template.name];
		if (!template.mcpMetadata)
			throw new Error("Missing independently registered MCP label metadata");
	}
const cases = [];
for (const theme of themes)
	for (const width of [80, 110, 160])
		for (const expanded of [false, true])
			for (const mode of ["hidden", "summary", "preview"]) {
				for (const template of templates) {
					const base = {
						theme,
						width,
						expanded,
						clock: 1000000,
						partial: false,
						config: {
							readOutputMode: mode,
							searchOutputMode: mode === "summary" ? "count" : mode,
							mcpOutputMode: mode,
							bashOutputMode: mode === "hidden" ? "opencode" : mode,
							diffViewMode: "split",
						},
						...template,
					};
					cases.push(base);
					if (["edit", "write"].includes(template.name)) {
						cases.push({
							...base,
							error: true,
							result: { content: [{ type: "text", text: "Permission denied" }], details: {} },
						});
						cases.push({ ...base, partial: true });
						if (template.name === "write" && template.preimage)
							cases.push({ ...base, partial: true, argsComplete: true });
					}
					if (template.name === "bash")
						for (const elapsed of [0, 200, 1200])
							cases.push({ ...base, partial: true, started: true, elapsed });
					if (!["edit", "write"].includes(template.name)) {
						cases.push({
							...base,
							error: true,
							result: { content: [{ type: "text", text: "Permission denied" }], details: {} },
						});
						cases.push({
							...base,
							result: {
								content: [
									{ type: "text", text: "caption" },
									{ type: "image", data: "", mimeType: "image/png" },
								],
								details: {},
							},
						});
						cases.push({ ...base, result: { content: [], details: {} } });
						cases.push({
							...base,
							result: {
								content: [{ type: "image", data: "", mimeType: "image/png" }],
								details: {},
							},
						});
						cases.push({ ...base, partial: true });
					}
				}
			}
for (const theme of themes)
	for (const width of [7, 8, 17, 18, 80, 110, 160])
		for (const expanded of [false, true])
			for (const diffViewMode of ["split", "unified", "auto"])
				for (const diffIndicatorMode of ["bars", "classic", "none"])
					for (const diffWordWrap of [false, true])
						for (const template of templates.filter((value) =>
							["edit", "write"].includes(value.name),
						)) {
							cases.push({
								theme,
								width,
								expanded,
								clock: 1000000,
								partial: false,
								config: { diffViewMode, diffIndicatorMode, diffWordWrap, diffCollapsedLines: 24 },
								...template,
							});
						}
for (const theme of themes)
	for (const width of [80, 110, 160])
		for (const expanded of [false, true])
			for (const diffViewMode of ["split", "unified", "auto"])
				cases.push({
					name: "edit",
					theme,
					width,
					expanded,
					clock: 1000000,
					partial: true,
					argsComplete: true,
					config: { diffViewMode },
					args: { path: "pending.ts", oldText: "const value = 1;", newText: "const value = 2;" },
					preimage: { exists: true, content: "const value = 1;\n" },
					result: { content: [{ type: "text", text: "editing" }], details: {} },
				});
// Explicit custom entries default to summary, not the global MCP mode.
// Canonical MCP names stay in the independent automatic-registration domain above.
for (const theme of themes)
	for (const width of [80, 112, 160])
		for (const expanded of [false, true])
			for (const mcpOutputMode of ["hidden", "summary", "preview"])
				for (const [name, kind] of [
					["custom_mcp_gateway", "mcp"],
					["sandbox_echo", "generic"],
				])
					cases.push({
						name,
						kind,
						omitCustomOutputMode: true,
						theme,
						width,
						expanded,
						clock: 1000000,
						partial: false,
						config: { mcpOutputMode },
						args: { message: "hello from real local MCP server" },
						result: {
							content: [
								{
									type: "text",
									text: Array.from(
										{ length: 12 },
										(_, i) => `${i + 1}: hello from real local MCP server`,
									).join("\n"),
								},
							],
							details: {},
						},
					});
// Original-source CR metadata proof: raw truthiness precedes CR normalization.
for (const theme of themes)
	for (const width of [80, 110, 160])
		for (const [label, raw] of [
			["empty", ""],
			["cr", "\r"],
			["cr-only", "\r\r\r"],
			["lf", "\n"],
			["crlf", "\r\n"],
			["text-crlf", "x\r\n"],
		])
			for (const shape of ["newText", "lines", "multi-edit"]) {
				const payload =
					shape === "multi-edit"
						? {
								edits: [
									{ oldText: "old", newText: raw },
									{ oldText: "old", lines: raw },
								],
							}
						: shape === "lines"
							? { lines: raw }
							: { oldText: "old", newText: raw };
				cases.push({
					name: "edit",
					theme,
					width,
					expanded: false,
					clock: 1000000,
					partial: true,
					config: { diffViewMode: "split" },
					args: { path: `metadata-${label}-${shape}.txt`, ...payload },
					result: { content: [{ type: "text", text: "editing" }], details: {} },
				});
			}
// Replay the same successful write grids without execution preimages (history domain).
for (const fixture of [...cases].filter(
	(value) => value.name === "write" && !value.partial && !value.error,
)) {
	const { preimage: _preimage, ...history } = fixture;
	cases.push(history);
}
// Approved option D and edge inputs; the sample is not used as oracle expected output.
const argsDesign = JSON.parse(
	readFileSync(join(root, "test/fixtures/tool-display-mcp-args-design.json"), "utf8"),
);
for (const theme of themes)
	for (const width of [72, 80, 100, 132, 150])
		for (const expanded of [false, true])
			for (const sample of argsDesign.cases.filter((value) => !value.id.startsWith("option-D")))
				cases.push({
					name: sample.name,
					kind: "mcp",
					args: sample.args,
					result: sample.result,
					mcpMetadata: registeredMcpMetadata[sample.name],
					theme,
					width,
					expanded,
					clock: 1000000,
					partial: false,
					config: { mcpOutputMode: "summary" },
					argsDesignCase: sample.id,
				});

// Independent transforms of bounded fixture payloads, never candidate code or rows.
function declaredNativeRenderers(fixture, renderers, includeExpansion = true) {
	const payload = Object.entries(fixture.args).filter(
		([key]) =>
			fixture.kind !== "mcp" ||
			/^mcp__/.test(fixture.name) ||
			!["tool", "server", "connect", "describe", "search"].includes(key),
	);
	const escaped = payload
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(" ")
		.replace(
			/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
			(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
	if (escaped.length > 16384) throw new Error("Transform fixtures exceed source budget");
	const { tool, server, connect, describe, search } = fixture.args;
	const proxyTarget = tool
		? `call ${server ? `${server}:` : ""}${tool}`
		: connect
			? `connect ${connect}`
			: describe
				? `describe ${describe}${server ? ` @${server}` : ""}`
				: search
					? `search "${search}"${server ? ` @${server}` : ""}`
					: server
						? `tools ${server}`
						: "status";
	return {
		...renderers,
		renderCall(args, theme, ctx) {
			if (!fixture.kind) return renderers.renderCall(args, theme, ctx);
			const title =
				fixture.kind === "generic"
					? theme.fg("toolTitle", theme.bold(fixture.name))
					: theme.fg("accent", fixture.mcpMetadata?.label ?? proxyTarget);
			return {
				invalidate() {},
				render(width) {
					if (fixture.kind === "mcp" && fixture.expanded) {
						const rows = new tui.Text(title, 0, 0).render(width);
						const line = tui
							.truncateToWidth(`args: ${escaped}`, width, "…")
							.replace(/\x1b\[[0-9;]*m/g, "");
						return includeExpansion && escaped ? [...rows, theme.fg("muted", line)] : rows;
					}
					const bounded = tui
						.truncateToWidth(
							`args: ${escaped}`,
							Math.max(7, width - tui.visibleWidth(title) + 5),
							"…",
						)
						.replace(/\x1b\[[0-9;]*m/g, "")
						.slice(6);
					const suffix = theme.fg("muted", escaped ? ` ${bounded}` : " (no args)");
					return new tui.Text(tui.truncateToWidth(`${title}${suffix}`, width, "…"), 0, 0).render(
						width,
					);
				},
			};
		},
		renderResult(result, options, theme, ctx) {
			const historyWrite =
				fixture.name === "write" && !fixture.preimage && !fixture.partial && !fixture.error;
			const body = historyWrite
				? corrected.diff.renderWriteDiffResult(
						fixture.args.content,
						{ expanded: options.expanded, filePath: fixture.args.path, headerLabel: "written" },
						{ ...corrected.types.DEFAULT_TOOL_DISPLAY_CONFIG, ...fixture.config },
						theme,
						"",
					)
				: renderers.renderResult(result, options, theme, ctx);
			if (
				!["grep", "find", "ls"].includes(fixture.name) &&
				!(fixture.name === "write" && !fixture.preimage && !fixture.partial && !fixture.error)
			)
				return body;
			return {
				invalidate() {
					body.invalidate();
				},
				render(width) {
					const rows = body.render(width);
					return fixture.name === "write" ? rows : rows.length ? ["", ...rows] : rows;
				},
			};
		},
	};
}

// OpenCode-style MCP is a second, independently counted transform of the prior expectation.
const referenceUtils = await jiti.import(join(reference, "src/render-utils.ts"));
function declaredOpenCodeRenderers(fixture, renderers, legacy) {
	if (fixture.kind !== "mcp") return legacy;
	const mode = fixture.omitCustomOutputMode
		? "summary"
		: (fixture.config.mcpOutputMode ?? "hidden");
	const previewRenderers = originalRenderers(
		{ ...fixture, omitCustomOutputMode: false },
		{ ...fixture.config, mcpOutputMode: "preview" },
		corrected,
	);
	const wrap = (lines) => ({
		invalidate() {},
		render(width) {
			const indent = width > 2 ? "  " : "";
			return lines.flatMap((line) =>
				tui
					.wrapTextWithAnsi(line, width - indent.length)
					.map((row, index) => `${index ? indent : ""}${row}`),
			);
		},
	});
	return {
		...legacy,
		renderCall(args, theme, ctx) {
			const payload = Object.entries(fixture.args)
				.filter(
					([key]) =>
						/^mcp__/.test(fixture.name) ||
						!["tool", "server", "connect", "describe", "search"].includes(key),
				)
				.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
				.join(", ")
				.replace(
					/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
					(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
				);
			// Upstream-derived target-only call (before the previous args insertion).
			const target = declaredNativeRenderers({ ...fixture, expanded: true }, renderers, false)
				.renderCall(args, theme, ctx)
				.render(16384)[0]
				.trimEnd();
			return wrap([`${target}${theme.fg("muted", payload ? ` [${payload}]` : " (no args)")}`]);
		},
		renderResult(result, options, theme, ctx) {
			if (options.isPartial) return renderers.renderResult(result, options, theme, ctx);
			if (mode === "hidden") return new tui.Text("", 0, 0);
			const lines = referenceUtils.compactOutputLines(
				referenceUtils.splitLines(referenceUtils.extractTextOutput(result)),
				{ expanded: true },
			);
			if (!options.expanded)
				return new tui.Text(lines.length ? theme.fg("muted", "• Ctrl+O to expand") : "", 0, 0);
			const preview = previewRenderers
				.renderResult(result, { ...options, expanded: true }, theme, ctx)
				.render(16384)
				.map((row) => row.trimEnd());
			let output = preview;
			if (mode === "summary") {
				const count = referenceUtils.countNonEmptyLines(lines);
				// Keep upstream backend/cap hint rows after replacing just the result lines.
				const cap =
					fixture.config.expandedPreviewMaxLines ??
					corrected.types.DEFAULT_TOOL_DISPLAY_CONFIG.expandedPreviewMaxLines;
				const shown = lines.length ? (cap ? Math.min(lines.length, cap) : lines.length) : 1;
				output = [
					theme.fg("muted", `↳ ${count} ${referenceUtils.pluralize(count, "line")} returned`),
					...preview.slice(shown),
				];
			}
			return wrap(["", theme.fg("muted", "output:"), ...output]);
		},
	};
}

function publicTheme(themeName) {
	sdk.initTheme(themeName, false);
	let theme;
	new sdk.ToolExecutionComponent(
		"capture-theme",
		"theme",
		{},
		{},
		{
			renderCall(_args, current) {
				theme = current;
				return new tui.Text("", 0, 0);
			},
		},
		{ requestRender() {} },
		agent,
	);
	return theme;
}
function originalRenderers(fixture, cfg, modules) {
	const { upstream, types: upstreamTypes, disposable } = modules;
	disposable.resetDisposed();
	const tools = new Map();
	const pi = {
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		getAllTools() {
			return [];
		},
		on() {},
	};
	upstream.registerToolDisplayOverrides(pi, () => ({
		...upstreamTypes.DEFAULT_TOOL_DISPLAY_CONFIG,
		...cfg,
		customToolOverrides:
			fixture.kind && !/^mcp__(.+?)__(.+)$/.test(fixture.name)
				? {
						[fixture.name]: {
							enabled: true,
							kind: fixture.kind,
							...(fixture.omitCustomOutputMode ? {} : { outputMode: cfg.mcpOutputMode }),
						},
					}
				: {},
	}));
	if (fixture.kind)
		pi.registerTool({
			name: fixture.name,
			label: fixture.mcpMetadata?.label ?? fixture.name,
			namespace: fixture.mcpMetadata?.namespace,
			description: "fixture",
			parameters: {},
			execute() {
				throw new Error("Oracle must not execute tools");
			},
		});
	return tools.get(fixture.name);
}
function render(fixture, renderers) {
	if (fixture.argsComplete && fixture.preimage) {
		const path = join(agent, fixture.args.path);
		if (fixture.preimage.exists) writeFileSync(path, fixture.preimage.content);
		else rmSync(path, { force: true });
	}
	const wrapped = {
		...renderers,
		renderCall(args, theme, ctx) {
			if (fixture.preimage)
				ctx.state.__piToolDisplayWriteExecutionMeta = {
					previousContent: fixture.preimage.content,
					fileExistedBeforeWrite: fixture.preimage.exists,
				};
			return renderers.renderCall(args, theme, ctx);
		},
	};
	clock = fixture.clock;
	const row = new sdk.ToolExecutionComponent(
		fixture.name,
		"fixture",
		fixture.args,
		{ showImages: false },
		wrapped,
		{ requestRender() {} },
		realpathSync(agent),
	);
	row.updateResult(
		{ ...fixture.result, isError: fixture.error === true },
		fixture.partial === true,
	);
	if (fixture.argsComplete) row.setArgsComplete();
	row.setExpanded(fixture.expanded);
	if (fixture.started) row.markExecutionStarted();
	if (fixture.elapsed) advance(fixture.elapsed);
	return row.render(fixture.width);
}
const output = [];
let mismatches = 0;
let correctedVectors = 0;
let correctedRows = 0;
let upstreamMalformedRows = 0;
let openCodeVectors = 0;
let openCodeRows = 0;
let mcpArgsVectors = 0;
let mcpArgsRows = 0;
const presentationStats = Object.fromEntries(
	[
		"genericInlineArgs",
		"mcpInlineArgs",
		"writeContentWithoutPreimage",
		"searchResultSeparator",
	].map((name) => [name, { vectors: 0, rows: 0 }]),
);
const first = [];
let clock = 1000000;
const intervals = new Map();
let nextInterval = 0;
const advance = (elapsed) => {
	for (let tick = 0; tick < elapsed; tick += 200) {
		clock += Math.min(200, elapsed - tick);
		for (const timer of [...intervals.values()])
			if (clock - timer.last >= timer.delay) {
				timer.last = clock;
				timer.fn();
			}
	}
};
const originalNow = Date.now;
Date.now = () => clock;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
globalThis.setInterval = (fn, delay) => {
	const id = ++nextInterval;
	intervals.set(id, { fn, delay, last: clock });
	return id;
};
globalThis.clearInterval = (id) => intervals.delete(id);
const previousCapabilities = tui.getCapabilities();
try {
	// Match the captured truecolor rows without changing ambient capability overrides.
	tui.setCapabilities({ ...previousCapabilities, trueColor: true });
	if (!tui.getCapabilities().trueColor) throw new Error("Oracle requires truecolor capability");
	for (const fixture of cases) {
		const theme = publicTheme(fixture.theme);
		if (fixture.theme === "reference-system") {
			const palette = JSON.parse(readFileSync(livePalettePath, "utf8"));
			if (theme.getColorMode() !== palette.mode)
				throw new Error("Captured live color mode mismatch");
			const samples = {
				bold: theme.bold("probe"),
				italic: theme.italic("probe"),
				inverse: theme.inverse("probe"),
				toolOutput: theme.fg("toolOutput", "probe"),
				toolSuccess: theme.bg("toolSuccessBg", "probe"),
			};
			for (const [name, value] of Object.entries(palette.styles ?? {}))
				if (samples[name] !== value) throw new Error(`Captured style sample mismatch: ${name}`);
			for (const [token, ansi] of Object.entries(palette.ansi ?? {})) {
				const backgrounds = new Set([
					"selectedBg",
					"searchMatchBg",
					"userMessageBg",
					"customMessageBg",
					"toolPendingBg",
					"toolSuccessBg",
					"toolErrorBg",
				]);
				const actual = backgrounds.has(token) ? theme.getBgAnsi(token) : theme.getFgAnsi(token);
				if (actual !== ansi)
					throw new Error(
						`Captured live theme ANSI mismatch for ${token}: ${JSON.stringify(actual)} != ${JSON.stringify(ansi)}`,
					);
			}
		}
		const unchangedRows = render(fixture, originalRenderers(fixture, fixture.config, original));
		original.disposable.disposeAll();
		const correctedRenderers = originalRenderers(fixture, fixture.config, corrected);
		const unicodeRows = render(fixture, correctedRenderers);
		const inlineRows = render(fixture, declaredNativeRenderers(fixture, correctedRenderers, false));
		const nativeRows = render(fixture, declaredNativeRenderers(fixture, correctedRenderers));
		const expected = render(
			fixture,
			declaredOpenCodeRenderers(
				fixture,
				correctedRenderers,
				declaredNativeRenderers(fixture, correctedRenderers),
			),
		);
		const mcpOpenCode = JSON.stringify(expected) !== JSON.stringify(nativeRows);
		if (mcpOpenCode) {
			openCodeVectors++;
			openCodeRows +=
				Math.max(expected.length, nativeRows.length) -
				expected.filter((row, index) => row === nativeRows[index]).length;
		}
		corrected.disposable.disposeAll();
		const mcpArgsExpanded = JSON.stringify(nativeRows) !== JSON.stringify(inlineRows);
		if (mcpArgsExpanded) {
			const insertion = nativeRows.findIndex((row, index) => row !== inlineRows[index]);
			if (
				nativeRows.length !== inlineRows.length + 1 ||
				JSON.stringify(nativeRows.filter((_, index) => index !== insertion)) !==
					JSON.stringify(inlineRows)
			)
				throw new Error("Expanded args must be exactly one insertion after the target-only call");
			mcpArgsVectors++;
			mcpArgsRows++;
		}
		const domain =
			fixture.kind === "generic"
				? "genericInlineArgs"
				: fixture.kind === "mcp"
					? "mcpInlineArgs"
					: fixture.name === "write" && !fixture.preimage
						? "writeContentWithoutPreimage"
						: ["grep", "find", "ls"].includes(fixture.name)
							? "searchResultSeparator"
							: undefined;
		const presentationChanged = JSON.stringify(nativeRows) !== JSON.stringify(unicodeRows);
		if (domain && presentationChanged) {
			presentationStats[domain].vectors++;
			// Search counts inserted blank rows; other domains count changed/added row indices.
			presentationStats[domain].rows +=
				domain === "searchResultSeparator"
					? nativeRows.length - unicodeRows.length
					: nativeRows.filter((row, index) => row !== unicodeRows[index]).length;
		}
		const unicodeCorrected = JSON.stringify(unchangedRows) !== JSON.stringify(unicodeRows);
		if (unicodeCorrected) {
			correctedVectors++;
			correctedRows += unicodeRows.filter((row, index) => row !== unchangedRows[index]).length;
		}
		upstreamMalformedRows += unchangedRows.filter(
			(row) => Buffer.from(row, "utf8").toString("utf8") !== row,
		).length;
		for (const row of expected)
			if (Buffer.from(row, "utf8").toString("utf8") !== row)
				throw new Error("Corrected reference retains malformed Unicode");
		const config = configModule.normalizeToolDisplayConfig({
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
		const pending = new pendingModule.PendingPreimages();
		pending.get = () => fixture.preimage;
		const native = fixture.kind
			? {}
			: sdk[`create${fixture.name[0].toUpperCase() + fixture.name.slice(1)}ToolDefinition`](agent);
		const controller = candidate.createToolDisplayController(
			{
				getAllTools() {
					return [
						{
							name: fixture.name,
							namespace: fixture.mcpMetadata?.namespace,
							sourceInfo: { source: "builtin", path: `builtin:${fixture.name}` },
						},
					];
				},
			},
			() => config,
			{
				nativeRenderers: { [fixture.name]: native },
				pending,
				highlighter: candidateHost.toolDisplayHighlighter,
			},
		);
		const actual = render(
			fixture,
			controller.resolver(fixture.name, () => native),
		);
		controller.dispose();
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			mismatches++;
			if (first.length < 8)
				first.push({
					name: fixture.name,
					theme: fixture.theme,
					width: fixture.width,
					config: fixture.config,
					expanded: fixture.expanded,
					error: fixture.error,
					partial: fixture.partial,
					firstRow: actual.findIndex((line, index) => line !== expected[index]),
				});
		}
		output.push({
			...fixture,
			rows: expected,
			...(mcpOpenCode ? { mcpOpenCode: true, nativeMcpRows: nativeRows } : {}),
			...(unicodeCorrected ? { unicodeCorrected: true, unchangedRows } : {}),
			...(mcpArgsExpanded ? { mcpArgsExpanded: true, inlineMcpRows: inlineRows } : {}),
			...(domain && presentationChanged
				? {
						presentationDivergence: domain,
						[fixture.kind === "mcp"
							? "upstreamMcpRows"
							: fixture.kind === "generic"
								? "upstreamGenericRows"
								: fixture.name === "write"
									? "upstreamWriteRows"
									: "upstreamSearchRows"]: unicodeRows,
					}
				: {}),
		});
	}
} finally {
	tui.setCapabilities(previousCapabilities);
	Date.now = originalNow;
	globalThis.setInterval = originalSetInterval;
	globalThis.clearInterval = originalClearInterval;
	original.disposable.disposeAll();
	corrected.disposable.disposeAll();
	rmSync(correctedRoot, { recursive: true, force: true });
}
const provenance = {
	rendererDomains: {
		directMcp:
			"real extension automatic registration with native server/tool label and no custom override",
		proxyMcp: "builtin mcp or explicitly configured noncanonical custom gateway",
		generic: "explicit custom override; unlisted live sandbox_echo is outside matched config scope",
	},
	unicodePatchSha256: createHash("sha256").update(readFileSync(unicodePatchPath)).digest("hex"),
	unicodeCorrection: {
		vectors: correctedVectors,
		rows: correctedRows,
		upstreamMalformedRows,
		unchangedVectors: cases.length - correctedVectors,
	},
	mcpOpenCode: {
		vectors: openCodeVectors,
		rows: openCodeRows,
		unchangedVectors: cases.length - openCodeVectors,
		rationale:
			"MCP keeps bracketed args in both states with hanging wraps, never width ellipsis; collapsed shows only a real Pi expand hint, expanded preview shows output: then result lines, summary returns a nonempty-line count and hidden hides output. Independent upstream-derived transform; rows count changed/added/removed indices relative to the retained nativeMcpRows. Upstream rows remain retained separately.",
	},
	mcpArgsExpansion: {
		vectors: mcpArgsVectors,
		rows: mcpArgsRows,
		unchangedVectors: cases.length - mcpArgsVectors,
		rationale:
			"Expanded MCP retains one muted payload row below a target-only call, never duplicates inline arguments. Independent bounded-fixture transform; rows counts inserted args rows relative to target-only calls.",
	},
	...Object.fromEntries(
		Object.entries(presentationStats).map(([domain, stats]) => [
			domain,
			{
				...stats,
				unchangedVectors: cases.length - stats.vectors,
				rationale: {
					genericInlineArgs:
						"Owned generic custom calls show native-style inline payloads; empty args retain (no args). Independent bounded-fixture transform; rows counts changed/added indices.",
					mcpInlineArgs:
						"MCP collapsed calls show accent target plus inline payload without MCP prefix/count; expanded calls keep target plus one muted args row. Proxy targets/routing omission unchanged. Rows counts changed/added indices.",
					writeContentWithoutPreimage:
						"History writes display call content as addition-only grid with neutral written rather than upstream created; no invented preimage. Rows counts changed header indices.",
					searchResultSeparator:
						"Native grep/find/ls insert one blank separator before nonempty result rows; hidden/empty results stay unchanged. Rows counts inserted separators.",
				}[domain],
			},
		]),
	),
	commit: pinnedManifest.commit,
	version: pinnedManifest.version,
	sdk: JSON.parse(readFileSync(join(dirname(sdkEntry), "../package.json"), "utf8")).version,
	tui: JSON.parse(readFileSync(tuiPackage, "utf8")).version,
	files: pinnedManifest.files,
	liveTheme: livePalettePath
		? ((palette) => ({
				name: palette.name,
				appearance: palette.appearance,
				mode: palette.mode,
				ansi: palette.ansi,
				styles: palette.styles,
			}))(JSON.parse(readFileSync(livePalettePath, "utf8")))
		: undefined,
	livePaletteSha256: livePalettePath
		? createHash("sha256").update(readFileSync(livePalettePath)).digest("hex")
		: undefined,
};
const fixturePath =
	process.env.ZENTUI_TOOL_DISPLAY_FIXTURE_OUTPUT ??
	join(root, "test/fixtures/tool-display-parity.json.gz");
if (process.argv.includes("--write"))
	writeFileSync(
		fixturePath,
		gzipSync(JSON.stringify({ provenance, themeDefinitions, cases: output })),
	);
console.log(
	JSON.stringify(
		{
			provenance,
			cases: cases.length,
			correctedVectors,
			correctedRows,
			upstreamMalformedRows,
			mismatches,
			first,
		},
		null,
		2,
	),
);
if (mismatches) process.exitCode = 1;
