import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as host from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createToolDisplayController } from "../extensions/zentui/tool-display/controller.js";
import { normalizeToolDisplayConfig } from "../extensions/zentui/tool-display/presets.js";
import {
	formatGenericToolCallLine,
	formatMcpArgsLine,
	formatMcpCallLine,
} from "../extensions/zentui/tool-display/tool-presentation.js";

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

describe("OpenCode-style bracketed MCP arguments", () => {
	const theme = { fg: (_token: string, value: string) => value, bold: (value: string) => value };
	for (const kind of ["direct", "proxy"])
		for (const width of [80, 150])
			it(`${kind} wraps at ${width} with hanging indent and no width truncation`, () => {
				const payload = {
					message: "long message with spaces ".repeat(24),
					repeat: 2,
					tags: ["demo", "cross-cli"],
				};
				const args = kind === "proxy" ? { server: "demo", tool: "echo", ...payload } : payload;
				const name = kind === "proxy" ? "mcp" : "mcp__demo__echo";
				const rows = formatMcpCallLine(name, "demo/echo", args, theme).render(width);
				expect(rows.length).toBeGreaterThan(1);
				expect(rows.slice(1).every((row) => row.startsWith("  "))).toBe(true);
				expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
				expect(rows.join("")).not.toContain("…");
				const joined = rows.map((row, index) => (index ? row.slice(2) : row)).join(" ");
				expect(joined).toContain(', repeat=2, tags=["demo","cross-cli"]]');
				expect(joined.match(/long/g)).toHaveLength(24);
				expect(joined).not.toMatch(/server=|tool=/);
			});
	it("keeps quoted/escaped values, own-data-only bounds and empty args", () => {
		let reads = 0;
		const args = {
			message: "hi\x1b[31m\n",
			repeat: 3,
			ok: true,
			nothing: null,
			secret: "not-masked",
			nested: { tags: [1, "a"] },
		};
		expect(
			formatMcpCallLine("mcp__demo__echo", "demo/echo", args, theme).render(300).join(""),
		).toBe(
			'demo/echo [message="hi\\u001b[31m\\n", repeat=3, ok=true, nothing=null, secret="not-masked", nested={"tags":[1,"a"]}]',
		);
		Object.defineProperty(args, "getter", {
			enumerable: true,
			get() {
				reads++;
				throw new Error("must not run");
			},
		});
		expect(() => formatMcpCallLine("mcp", "demo/echo", args, theme).render(80)).not.toThrow();
		expect(reads).toBe(0);
		for (const width of [1, 7, 17, 80, 150]) {
			const rows = formatMcpCallLine(
				"mcp__demo__echo",
				"demo/echo",
				{ message: "界🙂".repeat(10000) },
				theme,
			).render(width);
			expect(
				rows.every((row) => visibleWidth(row) <= width && Buffer.from(row).toString() === row),
			).toBe(true);
			expect(rows.join("")).toContain("…"); // Source safety bound, not width ellipsis.
		}
		expect(formatMcpCallLine("mcp__demo__echo", "demo/echo", {}, theme).render(80)).toEqual([
			"demo/echo (no args)",
		]);
		expect(
			formatMcpCallLine("mcp", "", { server: "demo", tool: "echo" }, theme).render(80),
		).toEqual(["call demo:echo (no args)"]);
	});
	it("leaves generic custom calls unchanged", () => {
		expect(
			formatGenericToolCallLine("sandbox_echo", { message: "hello", repeat: 3 }, theme, true)
				.render(80)[0]
				.trimEnd(),
		).toBe('sandbox_echo message="hello" repeat=3');
	});
});

describe("production controller MCP expansion through public Pi ToolExecutionComponent", () => {
	(modern ? it : it.skip)(
		"matches full ANSI edge fixtures and keeps output behind expansion in all MCP modes",
		async () => {
			// Resolve the SDK's declared pi-tui, not an ambient copy: older hosts nest their
			// own pi-tui, and the theme reads capabilities from that instance.
			const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
			const tui = await import(
				pathToFileURL(createRequire(sdkEntry).resolve("@earendil-works/pi-tui")).href
			);
			const capabilities = tui.getCapabilities();
			const { default: chalk } = await import(
				pathToFileURL(createRequire(sdkEntry).resolve("chalk")).href
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
				for (const fixture of design.cases.filter((value) => !value.id.startsWith("option-D")))
					for (const width of [72, 80, 100, 132, 150]) {
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
						const row = new host.ToolExecutionComponent(
							fixture.name,
							fixture.id,
							fixture.args,
							{ showImages: false },
							controller.resolver(fixture.name, () => ({})),
							{ requestRender() {} } as unknown as TUI,
							agent,
						);
						row.updateResult({ ...fixture.result, isError: false });
						const collapsed = row.render(width);
						for (const expanded of [false, true]) {
							row.setExpanded(expanded);
							const oracle = palette.cases.find(
								(
									value: DesignCase & {
										width: number;
										theme: string;
										expanded: boolean;
										argsDesignCase?: string;
									},
								) =>
									value.argsDesignCase === fixture.id &&
									value.width === width &&
									value.theme === "reference-system" &&
									value.expanded === expanded,
							);
							expect(oracle, fixture.id).toBeDefined();
							expect(row.render(width)).toEqual(oracle.rows);
							for (const line of row.render(width))
								expect(tui.visibleWidth(line)).toBeLessThanOrEqual(width);
						}
						row.setExpanded(false);
						expect(row.render(width)).toEqual(collapsed);
						controller.dispose();
					}
				const captures: string[] = [];
				for (const name of ["mcp__demo__echo", "mcp"])
					for (const width of [80, 150])
						for (const empty of [false, true])
							for (const mode of ["preview", "summary", "hidden"] as const) {
								const payload = empty
									? {}
									: { message: "long call with spaces ".repeat(12), repeat: 2 };
								const args =
									name === "mcp" ? { server: "demo", tool: "echo", ...payload } : payload;
								const cfg = normalizeToolDisplayConfig({
									enabled: true,
									customToolOverrides: {
										[name]: { enabled: true, kind: "mcp", outputMode: mode },
									},
								});
								const controller = createToolDisplayController({}, () => cfg, {
									nativeRenderers: {},
								});
								const row = new host.ToolExecutionComponent(
									name,
									name,
									args,
									{ showImages: false },
									controller.resolver(name, () => ({})),
									{ requestRender() {} } as unknown as TUI,
									agent,
								);
								const resultLines = [
									"RESULT_ONE " + "output words ".repeat(20),
									"RESULT_TWO short",
									"",
									"RESULT_THREE final",
								];
								row.updateResult({
									content: [{ type: "text", text: resultLines.join("\n") }],
									details: {},
									isError: false,
								});
								const collapsed = plain(row.render(width));
								expect(collapsed.join("\n")).not.toMatch(/RESULT_|output:|returned/);
								expect(collapsed.join("\n").includes("• Ctrl+O to expand")).toBe(mode !== "hidden");
								expect(collapsed.join("\n")).toContain(empty ? "(no args)" : "[message=");
								row.setExpanded(true);
								const expanded = plain(row.render(width));
								if (mode === "hidden") expect(expanded).toEqual(collapsed);
								else {
									const label = expanded.indexOf(" output:");
									expect(label).toBeGreaterThan(2);
									expect(expanded[label - 1]).toBe("");
									if (mode === "summary") {
										expect(expanded[label + 1]).toBe(" ↳ 3 lines returned");
										expect(expanded.join("\n")).not.toContain("RESULT_");
									} else {
										for (const marker of ["RESULT_ONE", "RESULT_TWO", "RESULT_THREE"])
											expect(expanded.some((line) => line.startsWith(` ${marker}`))).toBe(true);
										expect(
											expanded.slice(label + 2).some((line) => line.startsWith("   output words")),
										).toBe(true);
										expect(expanded.join("\n").match(/output/g)).toHaveLength(21);
										expect(expanded.join("\n").match(/words/g)).toHaveLength(20);
									}
								}
								if (mode === "preview")
									captures.push(
										`### ${name}, ${width} columns, ${empty ? "empty args" : "args"}\n\nCollapsed:\n\n\`\`\`text\n${collapsed.join("\n")}\n\`\`\`\n\nExpanded:\n\n\`\`\`text\n${expanded.join("\n")}\n\`\`\``,
									);
								row.updateResult({ content: [], details: {}, isError: false });
								row.setExpanded(false);
								expect(plain(row.render(width)).join("\n")).not.toContain("Ctrl+O");
								controller.dispose();
							}
				if (process.env.ZENTUI_MCP_ROW_EVIDENCE)
					writeFileSync(process.env.ZENTUI_MCP_ROW_EVIDENCE, captures.join("\n\n"));
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
