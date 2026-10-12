import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as host from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import { formatMcpArgsLine } from "../extensions/zentui/tool-display/tool-presentation.js";

interface DesignCase {
	id: string;
	name: string;
	args: Record<string, unknown>;
	result: { content: { type: "text"; text: string }[]; details: object };
	rows?: string[];
}
const design = JSON.parse(
	readFileSync(new URL("./fixtures/tool-display-mcp-args-design.json", import.meta.url), "utf8"),
) as { cases: DesignCase[] };
const plain = (rows: string[]) => rows.map((row) => row.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
const modern =
	typeof (host as unknown as Record<string, unknown>).createReadToolDefinition === "function";

describe("formatMcpArgsLine", () => {
	it("quotes strings, preserves order and compact JSON without masking", () => {
		expect(
			formatMcpArgsLine(
				"mcp__demo__echo",
				{
					message: "hello",
					repeat: 3,
					ok: true,
					nothing: null,
					nested: { apiKey: "secret", tags: [1, "a"] },
				},
				200,
			),
		).toBe(
			'args: message="hello" repeat=3 ok=true nothing=null nested={"apiKey":"secret","tags":[1,"a"]}',
		);
	});
	it("omits proxy routing but keeps nested args and extra payload fields", () => {
		expect(
			formatMcpArgsLine("mcp", { server: "demo", tool: "echo", args: { message: "hello" } }, 72),
		).toBe('args: args={"message":"hello"}');
		expect(formatMcpArgsLine("mcp", { server: "demo", search: "x", limit: 8 }, 72)).toBe(
			"args: limit=8",
		);
		expect(formatMcpArgsLine("mcp", { describe: "echo", verbose: true }, 72)).toBe(
			"args: verbose=true",
		);
		for (const args of [{}, { connect: "demo" }, { server: "demo" }])
			expect(formatMcpArgsLine("mcp", args, 72)).toBeUndefined();
		expect(formatMcpArgsLine("mcp__demo__echo", {}, 72)).toBeUndefined();
	});
	it("escapes terminal instructions, key controls, line breaks and bidi", () => {
		const line = formatMcpArgsLine(
			"mcp__demo__echo",
			{ "key\n": "hi\x1b[31m\n\t\r\x9b\u202e" },
			132,
		);
		expect(line).toBe('args: key\\u000a="hi\\u001b[31m\\n\\t\\r\\u009b\\u202e"');
		expect(line).not.toMatch(/[\x00-\x1f\x7f-\x9f\u202e]/);
	});
	for (const width of [72, 100, 132])
		it(`truncates with a trailing ellipsis at ${width} columns`, async () => {
			const { visibleWidth } = await import("@earendil-works/pi-tui");
			const line = formatMcpArgsLine(
				"mcp__demo__echo",
				{ message: "界🙂e\u0301".repeat(1000) },
				width,
			) as string;
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(line.endsWith("…")).toBe(true);
			expect(Buffer.from(line).toString()).toBe(line);
		});
	it("bounds strings, collections and recursion before serialization", () => {
		let reads = 0;
		const values = Array.from({ length: 10_000 }, (_, i) => ({
			get value() {
				reads++;
				return i;
			},
		}));
		expect(formatMcpArgsLine("mcp__demo__echo", { values }, 20000)?.endsWith("…")).toBe(true);
		// Accessors are never invoked, so bounded work cannot depend on them at all.
		expect(reads).toBe(0);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(formatMcpArgsLine("mcp__demo__echo", cyclic, 132)?.endsWith("…")).toBe(true);
		expect(
			formatMcpArgsLine("mcp__demo__echo", { message: "x".repeat(1_000_000) }, 20000)?.endsWith(
				"…",
			),
		).toBe(true);
	});

	it("never invokes accessors and renders plain JSON arguments unchanged", () => {
		let invoked = 0;
		const throwing: Record<string, unknown> = { message: "hello" };
		Object.defineProperty(throwing, "boom", {
			enumerable: true,
			get() {
				invoked++;
				throw new Error("getter must never run");
			},
		});
		expect(() => formatMcpArgsLine("mcp__demo__echo", throwing, 72)).not.toThrow();
		expect(invoked).toBe(0);
		expect(formatMcpArgsLine("mcp__demo__echo", throwing, 72)).toBe('args: message="hello"…');

		const returning: Record<string, unknown> = {};
		Object.defineProperty(returning, "value", {
			enumerable: true,
			get() {
				invoked++;
				return "from-accessor";
			},
		});
		expect(formatMcpArgsLine("mcp__demo__echo", returning, 72)).toBeUndefined();
		expect(invoked).toBe(0);

		const nested = { args: {} as Record<string, unknown> };
		Object.defineProperty(nested.args, "secret", {
			enumerable: true,
			get() {
				invoked++;
				return "nested";
			},
		});
		expect(formatMcpArgsLine("mcp", nested, 72)).toBe("args: args={}…");
		expect(invoked).toBe(0);

		// JSON-parsed arguments are data properties, so their rendering is unchanged.
		expect(
			formatMcpArgsLine("mcp__demo__echo", JSON.parse('{"message":"hello","repeat":3}'), 72),
		).toBe('args: message="hello" repeat=3');
	});
});

describe("production controller MCP expansion through public Pi ToolExecutionComponent", () => {
	(modern ? it : it.skip)(
		"matches approved option D ANSI rows and rebuilds the call slot across expansion for every edge input",
		async () => {
			const tui = await import("@earendil-works/pi-tui");
			const capabilities = tui.getCapabilities();
			const { default: chalk } = await import(
				pathToFileURL(
					createRequire(
						fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
					).resolve("chalk"),
				).href
			);
			const level = chalk.level;
			chalk.level = 3;
			const palette = JSON.parse(
				gunzipSync(
					readFileSync(new URL("./fixtures/tool-display-parity.json.gz", import.meta.url)),
				).toString(),
			);
			const agent = mkdtempSync(join(tmpdir(), "zentui-mcp-args-"));
			const oldAgent = process.env.PI_CODING_AGENT_DIR;
			process.env.PI_CODING_AGENT_DIR = agent;
			mkdirSync(join(agent, "themes"));
			writeFileSync(
				join(agent, "themes/reference-system.json"),
				JSON.stringify(palette.themeDefinitions["reference-system"]),
			);
			try {
				tui.setCapabilities({ ...capabilities, trueColor: true });
				host.initTheme("reference-system", false);
				for (const fixture of design.cases)
					for (const width of [72, 100, 132]) {
						const cfg = normalizeToolDisplayConfig({
							enabled: true,
							customToolOverrides: {
								[fixture.name]: {
									enabled: true,
									kind: "mcp",
									outputMode: "summary",
									overrideExistingRenderers: true,
								},
							},
						});
						const controller = createToolDisplayController(
							{ getAllTools: () => [{ name: fixture.name, namespace: { name: "mcp__demo" } }] },
							() => cfg,
							{ nativeRenderers: {} },
						);
						const renderers = controller.resolver(fixture.name, () => ({}));
						const row = new host.ToolExecutionComponent(
							fixture.name,
							fixture.id,
							fixture.args,
							{ showImages: false },
							renderers,
							{ requestRender() {} } as unknown as TUI,
							agent,
						);
						row.updateResult({ ...fixture.result, isError: false });
						const collapsed = row.render(width);
						expect(
							plain(collapsed).some((line) => line.startsWith(" args: ")),
							fixture.id,
						).toBe(false);
						if (width === 72 && fixture.id.startsWith("baseline-"))
							expect(collapsed).toEqual(fixture.rows);
						row.setExpanded(true);
						const expanded = row.render(width);
						const expected = formatMcpArgsLine(
							fixture.name.startsWith("mcp__") ? fixture.name : "mcp",
							fixture.args,
							width - 2,
						);
						const lines = plain(expanded);
						expect(lines.filter((line) => line.startsWith(" args: "))).toEqual(
							expected ? [` ${expected}`] : [],
						);
						if (expected) expect(lines[3]).toBe(` ${expected}`);
						if (width === 72 && fixture.id.startsWith("option-D"))
							expect(expanded).toEqual(fixture.rows);
						for (const line of expanded) expect(tui.visibleWidth(line)).toBeLessThanOrEqual(width);
						row.setExpanded(false);
						expect(row.render(width), `${fixture.id} collapsed after expansion`).toEqual(collapsed);
						row.setExpanded(true);
						expect(row.render(width)).toEqual(expanded);
						controller.dispose();
					}
				for (const name of ["demo_generic", "custom_mcp_gateway"]) {
					const cfg = normalizeToolDisplayConfig({
						enabled: true,
						customToolOverrides: {
							[name]: {
								enabled: true,
								kind: name === "demo_generic" ? "generic" : "mcp",
								outputMode: "summary",
							},
						},
					});
					const controller = createToolDisplayController({}, () => cfg, { nativeRenderers: {} });
					const row = new host.ToolExecutionComponent(
						name,
						name,
						{ tool: "echo", server: "demo", args: { message: "hello" } },
						{},
						controller.resolver(name, () => ({})),
						{ requestRender() {} } as unknown as TUI,
						agent,
					);
					const collapsed = row.render(72);
					row.setExpanded(true);
					expect(plain(row.render(72)).some((line) => line.startsWith(" args: "))).toBe(
						name !== "demo_generic",
					);
					if (name === "demo_generic") expect(row.render(72)).toEqual(collapsed);
					controller.dispose();
				}
			} finally {
				tui.setCapabilities(capabilities);
				chalk.level = level;
				if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = oldAgent;
				host.initTheme("dark", false);
				rmSync(agent, { recursive: true, force: true });
			}
		},
	);
});
