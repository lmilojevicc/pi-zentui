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
try {
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
		const expected = render(fixture, originalRenderers(fixture, fixture.config, corrected));
		corrected.disposable.disposeAll();
		const unicodeCorrected = JSON.stringify(unchangedRows) !== JSON.stringify(expected);
		if (unicodeCorrected) {
			correctedVectors++;
			correctedRows += expected.filter((row, index) => row !== unchangedRows[index]).length;
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
			...(unicodeCorrected ? { unicodeCorrected: true, unchangedRows } : {}),
		});
	}
} finally {
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
