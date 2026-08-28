import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const versions = [
	["0.80.5", false],
	["0.83.0", false],
	["0.84.0", true],
	["0.84.3", true],
];
const root = join(import.meta.dirname, "..");
const workspace = mkdtempSync(join(tmpdir(), "zentui-thinking-compat-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run this harness through npm");

const checkSource = `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";

const version = process.argv[2];
const expected = process.argv[3] === "present";
const cwd = process.cwd();
const agentDir = join(cwd, "agent-" + version);
mkdirSync(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
writeFileSync(
	join(agentDir, "zentui.json"),
	JSON.stringify({ components: { thinkingSteps: { enabled: true, mode: "summary" } } }),
);

const loaded = await discoverAndLoadExtensions(
	[join(cwd, "extensions", "zentui", "index.ts")],
	cwd,
	agentDir,
);
if (!loaded || !Array.isArray(loaded.extensions) || !Array.isArray(loaded.errors)) {
	throw new Error("Pi " + version + " returned an unsupported public loader result");
}
if (loaded.errors.length !== 0) {
	throw new Error("Pi " + version + " loader errors: " + JSON.stringify(loaded.errors));
}
if (loaded.extensions.length !== 1) {
	throw new Error("Pi " + version + " extension count: " + loaded.extensions.length);
}
const extension = loaded.extensions[0];
const transformer = extension?.markdownTransformer;
if ((typeof transformer === "function") !== expected) {
	throw new Error(
		"Pi " + version + " markdownTransformer=" + typeof transformer + ", expected " +
		(expected ? "function" : "absence"),
	);
}
const input = "# First\\n# Latest";
const transformed = typeof transformer === "function"
	? transformer(input, {
			messageType: "assistant-thinking",
			isStreaming: true,
			availableWidth: 80,
		})
	: input;
const expectedOutput = expected
	? "┆ Thinking Steps · Summary  \\n├─ · Step 1: First  \\n└─ • Step 2: Latest"
	: input;
if (transformed !== expectedOutput) {
	throw new Error("Pi " + version + " unexpected transform: " + JSON.stringify(transformed));
}
if (expected) {
	let structuralMarkdownCalls = 0;
	const identity = (text) => text;
	const theme = Object.fromEntries(
		[
			"heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "hr",
			"bold", "italic", "strikethrough", "underline",
		].map((key) => [key, identity]),
	);
	theme.listBullet = (text) => { structuralMarkdownCalls += 1; return text; };
	theme.quote = (text) => { structuralMarkdownCalls += 1; return text; };
	theme.quoteBorder = (text) => { structuralMarkdownCalls += 1; return text; };
	const rendered = new Markdown(transformed, 0, 0, theme, undefined, {
		preserveBackslashEscapes: false,
		renderLatex: false,
	}).render(80);
	const visible = rendered.map((line) => line.trimEnd());
	const expectedVisible = [
		"┆ Thinking Steps · Summary",
		"├─ · Step 1: First",
		"└─ • Step 2: Latest",
	];
	if (JSON.stringify(visible) !== JSON.stringify(expectedVisible)) {
		throw new Error("Pi " + version + " unexpected Markdown render: " + JSON.stringify(visible));
	}
	if (structuralMarkdownCalls !== 0 || rendered.some((line) => visibleWidth(line) > 80)) {
		throw new Error("Pi " + version + " Markdown render added structure or exceeded width");
	}
}
console.log(
	version +
		": public-loader=ok errors=0 markdownTransformer=" +
		(typeof transformer === "function" ? "present" : "absent") +
		" transform=" +
		JSON.stringify(transformed),
);
`;

try {
	cpSync(join(root, "extensions"), join(workspace, "extensions"), { recursive: true });
	writeFileSync(join(workspace, "package.json"), '{"type":"module","private":true}\n');
	writeFileSync(join(workspace, "check.mts"), checkSource);
	for (const [version, available] of versions) {
		rmSync(join(workspace, "node_modules"), { recursive: true, force: true });
		execFileSync(
			process.execPath,
			[
				npmCli,
				"install",
				"--ignore-scripts",
				"--no-package-lock",
				"--no-audit",
				"--no-fund",
				"--silent",
				`@earendil-works/pi-ai@${version}`,
				`@earendil-works/pi-coding-agent@${version}`,
				`@earendil-works/pi-tui@${version}`,
				"tsx@4",
			],
			{ cwd: workspace, stdio: "inherit", timeout: 180_000 },
		);
		execFileSync(
			process.execPath,
			[
				join(workspace, "node_modules", "tsx", "dist", "cli.mjs"),
				"check.mts",
				version,
				available ? "present" : "absent",
			],
			{ cwd: workspace, stdio: "inherit", timeout: 60_000 },
		);
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
