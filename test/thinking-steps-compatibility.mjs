import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const versions = [
	["0.80.5", false],
	["0.83.0", false],
	["0.84.0", true],
	["0.84.4", true],
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
const input = "# First\\n# Latest";

for (const mode of ["rail", "tree"]) {
	const agentDir = join(cwd, "agent-" + version + "-" + mode);
	mkdirSync(agentDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = agentDir;
	writeFileSync(
		join(agentDir, "zentui.json"),
		JSON.stringify({ components: { thinkingSteps: { enabled: true, mode } } }),
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
	const transformer = loaded.extensions[0]?.markdownTransformer;
	if ((typeof transformer === "function") !== expected) {
		throw new Error(
			"Pi " + version + " markdownTransformer=" + typeof transformer + ", expected " +
			(expected ? "function" : "absence"),
		);
	}
	const renderMarkdown = (markdown) => {
		let structuralMarkdownCalls = 0;
		const headingCalls = [];
		const boldCalls = [];
		const underlineCalls = [];
		const identity = (text) => text;
		const theme = Object.fromEntries(
			[
				"link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "hr",
				"italic", "strikethrough",
			].map((key) => [key, identity]),
		);
		theme.heading = (text) => { headingCalls.push(text); return text; };
		theme.bold = (text) => { boldCalls.push(text); return text; };
		theme.underline = (text) => { underlineCalls.push(text); return text; };
		theme.listBullet = (text) => { structuralMarkdownCalls += 1; return text; };
		theme.quote = (text) => { structuralMarkdownCalls += 1; return text; };
		theme.quoteBorder = (text) => { structuralMarkdownCalls += 1; return text; };
		const rendered = new Markdown(markdown, 0, 0, theme, undefined, {
			preserveBackslashEscapes: false,
			renderLatex: false,
		}).render(80);
		return {
			boldCalls,
			headingCalls,
			rendered,
			structuralMarkdownCalls,
			underlineCalls,
			visible: rendered.map((line) => line.trimEnd()).filter(Boolean),
		};
	};
	const assertRendered = (state, expectedVisible, label) => {
		if (JSON.stringify(state.visible) !== JSON.stringify(expectedVisible)) {
			throw new Error(
				"Pi " + version + " " + mode + " unexpected " + label +
				" Markdown render: " + JSON.stringify(state.visible),
			);
		}
		if (
			state.structuralMarkdownCalls !== 0 ||
			state.rendered.some((line) => visibleWidth(line) > 80)
		) {
			throw new Error("Pi " + version + " " + mode + " " + label + " structure or width failed");
		}
	};

	const transformed = typeof transformer === "function"
		? transformer(input, {
			messageType: "assistant-thinking",
			isStreaming: true,
			availableWidth: 80,
		})
		: input;
	const expectedOutput = !expected
		? input
		: mode === "rail"
			? "## │ Thinking · Rail\\n│ · First  \\n│ • **Latest**"
			: "## ┆ Thinking · Tree\\n├─ · First  \\n└─ • **Latest**";
	if (transformed !== expectedOutput) {
		throw new Error("Pi " + version + " " + mode + " unexpected transform: " + JSON.stringify(transformed));
	}

	const streamingState = renderMarkdown(transformed);
	if (!expected) {
		assertRendered(streamingState, ["First", "Latest"], "native");
		if (
			!streamingState.headingCalls.includes("First") ||
			!streamingState.headingCalls.includes("Latest") ||
			!streamingState.boldCalls.includes("First") ||
			!streamingState.boldCalls.includes("Latest") ||
			!streamingState.underlineCalls.includes("First") ||
			!streamingState.underlineCalls.includes("Latest")
		) {
			throw new Error("Pi " + version + " " + mode + " native H1 callbacks failed");
		}
	} else {
		const title = mode === "rail" ? "│ Thinking · Rail" : "┆ Thinking · Tree";
		const streamingVisible = mode === "rail"
			? [title, "│ · First", "│ • Latest"]
			: [title, "├─ · First", "└─ • Latest"];
		assertRendered(streamingState, streamingVisible, "streaming");
		if (
			!streamingState.headingCalls.includes(title) ||
			!streamingState.boldCalls.includes(title) ||
			!streamingState.boldCalls.includes("Latest") ||
			streamingState.underlineCalls.length !== 0
		) {
			throw new Error("Pi " + version + " " + mode + " streaming H2 or latest-bold callbacks failed");
		}

		const settled = transformer(input, {
			messageType: "assistant-thinking",
			isStreaming: false,
			availableWidth: 80,
		});
		const expectedSettled = mode === "rail"
			? "## │ Thinking · Rail\\n│ · First  \\n│ · Latest"
			: "## ┆ Thinking · Tree\\n├─ · First  \\n└─ · Latest";
		if (settled !== expectedSettled) {
			throw new Error("Pi " + version + " " + mode + " unexpected settled transform: " + JSON.stringify(settled));
		}
		const settledState = renderMarkdown(settled);
		const settledVisible = mode === "rail"
			? [title, "│ · First", "│ · Latest"]
			: [title, "├─ · First", "└─ · Latest"];
		assertRendered(settledState, settledVisible, "settled");
		if (
			!settledState.headingCalls.includes(title) ||
			!settledState.boldCalls.includes(title) ||
			settledState.boldCalls.includes("Latest") ||
			settledState.underlineCalls.length !== 0 ||
			!settledState.visible.slice(1).every((line) => line.includes(" · ")) ||
			settledState.visible.slice(1).some((line) => line.includes(" • "))
		) {
			throw new Error("Pi " + version + " " + mode + " settled H2, markers, or latest-bold callbacks failed");
		}
		console.log(
			version + " " + mode +
				": public-loader=ok errors=0 markdownTransformer=present" +
				" streaming=" + JSON.stringify(transformed) +
				" settled=" + JSON.stringify(settled),
		);
		continue;
	}
	console.log(
		version + " " + mode +
			": public-loader=ok errors=0 markdownTransformer=absent" +
			" native=" + JSON.stringify(transformed),
	);
}
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
