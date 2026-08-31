import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

function resolveInstalledVersion(installRoot, packageName) {
	const manifestPath = realpathSync(join(installRoot, "node_modules", packageName, "package.json"));
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (manifest.name !== packageName)
		throw new Error(
			`Resolved manifest ${manifestPath} was ${String(manifest.name)}, not ${packageName}`,
		);
	return manifest.version;
}

function attestInstalledVersions(installRoot, requestedVersion) {
	const measured = {
		codingAgent: resolveInstalledVersion(installRoot, "@earendil-works/pi-coding-agent"),
		tui: resolveInstalledVersion(installRoot, "@earendil-works/pi-tui"),
		ai: resolveInstalledVersion(installRoot, "@earendil-works/pi-ai"),
	};
	for (const [name, installedVersion] of Object.entries(measured)) {
		if (installedVersion !== requestedVersion) {
			throw new Error(
				`Installed ${name} version ${installedVersion} did not equal requested ${requestedVersion}`,
			);
		}
	}
	return measured;
}

const checkSource = `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
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
	const renderMarkdown = (markdown, width = 80, renderLatex = true) => {
		let structuralMarkdownCalls = 0;
		const headingCalls = [];
		const boldCalls = [];
		const codeCalls = [];
		const linkCalls = [];
		const linkUrlCalls = [];
		const thinkingCalls = [];
		const underlineCalls = [];
		const identity = (text) => text;
		const theme = Object.fromEntries(
			["hr", "italic", "strikethrough"].map((key) => [key, identity]),
		);
		theme.heading = (text) => { headingCalls.push(text); return text; };
		theme.bold = (text) => { boldCalls.push(text); return text; };
		theme.code = (text) => { codeCalls.push(text); return text; };
		theme.underline = (text) => { underlineCalls.push(text); return text; };
		for (const key of ["listBullet", "quote", "quoteBorder", "codeBlock", "codeBlockBorder"]) {
			theme[key] = (text) => { structuralMarkdownCalls += 1; return text; };
		}
		theme.link = (text, url) => { linkCalls.push([text, url]); return text; };
		theme.linkUrl = (url) => { linkUrlCalls.push(url); return url; };
		const rendered = new Markdown(
			markdown,
			0,
			0,
			theme,
			{ color: (text) => { thinkingCalls.push(text); return text; }, italic: true },
			{ preserveBackslashEscapes: false, renderLatex },
		).render(width);
		const compactRows = rendered.map((line) => line.trimEnd());
		return {
			boldCalls,
			codeCalls,
			compactRows,
			headingCalls,
			linkCalls,
			linkUrlCalls,
			rendered,
			structuralMarkdownCalls,
			thinkingCalls,
			underlineCalls,
			visible: compactRows.filter(Boolean),
		};
	};
	const assertRendered = (state, expectedVisible, label, width = 80) => {
		if (JSON.stringify(state.visible) !== JSON.stringify(expectedVisible)) {
			throw new Error(
				"Pi " + version + " " + mode + " unexpected " + label +
				" Markdown render: " + JSON.stringify(state.visible),
			);
		}
		if (
			state.structuralMarkdownCalls !== 0 ||
			state.rendered.some((line) => visibleWidth(line) > width)
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
			? "\`│\` **Thinking**  \\n\`│\` First  \\n\`│ •\` Latest"
			: "\`┆\` **Thinking**  \\n\`├─ ·\` First  \\n\`└─ •\` Latest";
	if (transformed !== expectedOutput) {
		throw new Error("Pi " + version + " " + mode + " unexpected transform: " + JSON.stringify(transformed));
	}

	const streamingState = renderMarkdown(transformed);
	if (!expected) {
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

		const longLabel = 'Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize") hack; docs say "compact rail and tree" latest commit changed semantics)';
		const fallbackCorpus = [
			{ name: "long", source: "# " + longLabel, expectsLink: false },
			{ name: "math-matrix", source: "# matrix $\\\\begin{matrix}a&b\\\\\\\\c&d\\\\end{matrix}$", expectsLink: false },
			{ name: "single-dollar", source: "# single $ unclosed", expectsLink: false },
			{ name: "backslash", source: "# literal \\\\ backslash and \\*native escape\\*", expectsLink: false },
			{ name: "markdown-link", source: "# [brackets](https://example.com/path) and [literal brackets]", expectsLink: true },
			{ name: "emphasis", source: "# *emphasis* _underscores_ and under_score", expectsLink: false },
			{ name: "backticks", source: "# \`\`code \` tick\`\` and backtick runs", expectsLink: false },
			{ name: "entities", source: "# ampersands & entities &amp; &#38;", expectsLink: false },
			{ name: "angle-links", source: "# <https://example.com/path> and <tag>", expectsLink: true },
			{ name: "inline-math", source: "# math \\\\(x^2 + y^2 and \\\\[x+y", expectsLink: false },
			{ name: "gfm-https", source: "# https://example.com/path", expectsLink: true },
			{ name: "gfm-www", source: "# www.example.com", expectsLink: true },
			{ name: "gfm-email", source: "# user@example.com", expectsLink: true },
			{ name: "at-malformed", source: "# foo@:bar.com", expectsLink: false },
			{ name: "at-host-only", source: "# name@host", expectsLink: false },
			{ name: "gfm-hyphen-domain", source: "# foo@-bar.com", expectsLink: true },
			{ name: "gfm-underscore-domain", source: "# foo@_bar.com", expectsLink: true },
			{ name: "gfm-prose-url", source: "# Review (https://example.com/path), then continue.", expectsLink: true },
			{ name: "gfm-prose-email", source: "# Contact user@example.com; then continue.", expectsLink: true },
			{ name: "grapheme-safe", source: "# family 👨‍👩‍👧‍👦 café 界語 wide", expectsLink: false },
			{ name: "grapheme-risky", source: "# family 👨‍👩‍👧‍👦 café 界語 *literal*", expectsLink: false },
		];
		const nativeEvidence = {
			cases: fallbackCorpus.length,
			widths: [20, 80, 200],
			rows: { min: Number.POSITIVE_INFINITY, max: 0 },
			callbacks: { heading: 0, bold: 0, underline: 0, link: 0, linkUrl: 0 },
			longRows: {},
		};
		for (const item of fallbackCorpus) {
			for (const width of nativeEvidence.widths) {
				const nativeOutput = typeof transformer === "function"
					? transformer(item.source, {
						messageType: "assistant-thinking", isStreaming: false, availableWidth: width,
					})
					: item.source;
				if (nativeOutput !== item.source) {
					throw new Error("Pi " + version + " " + mode + " changed absent-transformer source at " + width + ": " + item.name);
				}
				const state = renderMarkdown(nativeOutput, width);
				const repeated = renderMarkdown(item.source, width);
				const callbackSnapshot = (value) => JSON.stringify({
					rows: value.compactRows,
					heading: value.headingCalls,
					bold: value.boldCalls,
					underline: value.underlineCalls,
					code: value.codeCalls,
					link: value.linkCalls,
					linkUrl: value.linkUrlCalls,
				});
				if (
					state.rendered.length === 0 ||
					state.rendered.some((line) => visibleWidth(line) > width) ||
					callbackSnapshot(state) !== callbackSnapshot(repeated) ||
					state.headingCalls.length === 0 ||
					state.boldCalls.length === 0 ||
					state.underlineCalls.length === 0 ||
					(item.expectsLink && state.linkCalls.length === 0) ||
					(!item.expectsLink && state.linkCalls.length !== 0)
				) {
					throw new Error("Pi " + version + " " + mode + " native rows/callbacks failed at " + width + ": " + item.name + " " + callbackSnapshot(state));
				}
				nativeEvidence.rows.min = Math.min(nativeEvidence.rows.min, state.rendered.length);
				nativeEvidence.rows.max = Math.max(nativeEvidence.rows.max, state.rendered.length);
				nativeEvidence.callbacks.heading += state.headingCalls.length;
				nativeEvidence.callbacks.bold += state.boldCalls.length;
				nativeEvidence.callbacks.underline += state.underlineCalls.length;
				nativeEvidence.callbacks.link += state.linkCalls.length;
				nativeEvidence.callbacks.linkUrl += state.linkUrlCalls.length;
				if (item.name === "long") nativeEvidence.longRows[width] = state.compactRows;
			}
		}
		console.log(
			version + " " + mode +
				": public-loader=ok errors=0 markdownTransformer=absent passthrough=" +
				(fallbackCorpus.length * nativeEvidence.widths.length) + "/" +
				(fallbackCorpus.length * nativeEvidence.widths.length) +
				" native=" + JSON.stringify(nativeEvidence),
		);
		continue;
	} else {
		const title = mode === "rail" ? "│ Thinking" : "┆ Thinking";
		const streamingVisible = mode === "rail"
			? [title, "│ First", "│ • Latest"]
			: [title, "├─ · First", "└─ • Latest"];
		assertRendered(streamingState, streamingVisible, "streaming");
		const expectedStreamingCode = mode === "rail" ? ["│", "│", "│ •"] : ["┆", "├─ ·", "└─ •"];
		if (
			streamingState.compactRows.some((line) => line === "") ||
			streamingState.headingCalls.length !== 0 ||
			!streamingState.boldCalls.includes("Thinking") ||
			streamingState.boldCalls.includes("Latest") ||
			JSON.stringify(streamingState.codeCalls) !== JSON.stringify(expectedStreamingCode) ||
			!streamingState.thinkingCalls.some((text) => text.includes("First")) ||
			!streamingState.thinkingCalls.some((text) => text.includes("Latest")) ||
			streamingState.underlineCalls.length !== 0
		) {
			throw new Error("Pi " + version + " " + mode + " compact title, mdCode, or thinking style callbacks failed");
		}

		const settled = transformer(input, {
			messageType: "assistant-thinking",
			isStreaming: false,
			availableWidth: 80,
		});
		const expectedSettled = mode === "rail"
			? "\`│\` **Thinking**  \\n\`│\` First  \\n\`│\` Latest"
			: "\`┆\` **Thinking**  \\n\`├─ ·\` First  \\n\`└─ ·\` Latest";
		if (settled !== expectedSettled) {
			throw new Error("Pi " + version + " " + mode + " unexpected settled transform: " + JSON.stringify(settled));
		}
		const settledState = renderMarkdown(settled);
		const settledVisible = mode === "rail"
			? [title, "│ First", "│ Latest"]
			: [title, "├─ · First", "└─ · Latest"];
		assertRendered(settledState, settledVisible, "settled");
		if (
			settledState.compactRows.some((line) => line === "") ||
			settledState.headingCalls.length !== 0 ||
			!settledState.boldCalls.includes("Thinking") ||
			settledState.boldCalls.includes("Latest") ||
			settledState.underlineCalls.length !== 0 ||
			(mode === "rail" && settledState.visible.slice(1).some((line) => line.includes(" · "))) ||
			(mode === "tree" && !settledState.visible.slice(1).every((line) => line.includes(" · "))) ||
			settledState.visible.slice(1).some((line) => line.includes(" • "))
		) {
			throw new Error("Pi " + version + " " + mode + " settled title, markers, or bold callbacks failed");
		}

		const longLabel = 'Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize") hack; docs say "compact rail and tree" latest commit changed semantics)';
		const longEvidence = {};
		const expectedLongRows = mode === "rail"
			? {
				20: "│ Gaps/risks I noti…",
				80: '│ Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize") ha…',
				200: "│ " + longLabel,
			}
			: {
				20: "└─ · Gaps/risks I n…",
				80: '└─ · Gaps/risks I noticed (AGENTS.md not updated; process.stdout.emit("resize")…',
				200: "└─ · " + longLabel,
			};
		for (const width of [20, 80, 200]) {
			const longOutput = transformer("# " + longLabel, {
				messageType: "assistant-thinking", isStreaming: false, availableWidth: width,
			});
			const longState = renderMarkdown(longOutput, width);
			longEvidence[width] = longState.visible[1];
			const expectedLongCode = mode === "rail" ? ["│", "│"] : ["┆", "└─ ·"];
			if (
				longOutput === "# " + longLabel ||
				longState.rendered.length !== 2 ||
				longState.rendered.some((line) => visibleWidth(line) > width) ||
				longOutput.includes("\\\\") ||
				longState.visible[1] !== expectedLongRows[width] ||
				JSON.stringify(longState.codeCalls) !== JSON.stringify(expectedLongCode) ||
				!longState.thinkingCalls.some((text) => text.includes("Gaps/risks"))
			) {
				throw new Error("Pi " + version + " " + mode + " long-label row contract failed at " + width);
			}
		}

		const riskyLabels = [
			"matrix $\\\\begin{matrix}a&b\\\\\\\\c&d\\\\end{matrix}$",
			"single $ unclosed",
			"literal \\\\ backslash and \\*native escape\\*",
			"[brackets](https://example.com/path) and [literal brackets]",
			"*emphasis* _underscores_ and under_score",
			"\`\`code \` tick\`\` and backtick runs",
			"ampersands & entities &amp; &#38;",
			"<https://example.com/path> and <tag>",
			"math \\\\(x^2 + y^2 and \\\\[x+y",
		];
		for (const label of riskyLabels) {
			for (const width of [20, 80, 200]) {
				const output = transformer("# " + label, {
					messageType: "assistant-thinking", isStreaming: false, availableWidth: width,
				});
				const state = renderMarkdown(output, width);
				const connector = mode === "rail" ? "│" : "└─ ·";
				const literalLabel = state.codeCalls[2];
				if (
					output === "# " + label ||
					state.rendered.length !== 2 ||
					state.rendered.some((line) => visibleWidth(line) > width) ||
					state.structuralMarkdownCalls !== 0 ||
					state.linkCalls.length !== 0 ||
					state.linkUrlCalls.length !== 0 ||
					state.codeCalls.length !== 3 ||
					state.visible[1] !== connector + " " + literalLabel ||
					(width === 200 && literalLabel !== label)
				) {
					throw new Error("Pi " + version + " " + mode + " risky literal row failed at " + width + ": " + label);
				}
			}
		}

		const gfmCases = [
			{ label: "https://example.com/path", widths: [14, 20, 80, 200] },
			{ label: "ftp://example.com/file", widths: [14, 20, 80, 200] },
			{ label: "www.example.com", widths: [14, 20, 80, 200] },
			{ label: "user@example.com", widths: [14, 20, 80, 200] },
			{ label: "foo@:bar.com", widths: [80] },
			{ label: "foo@-bar.com", widths: [80] },
			{ label: "foo@_bar.com", widths: [80] },
			{ label: "foo+tag@host-name.com", widths: [80] },
			{ label: "name@host", widths: [80] },
			{ label: "trailing@", widths: [80] },
			{ label: "@domain.example", widths: [10] },
			{ label: "Review (https://example.com/path), then continue.", widths: [80, 200] },
			{ label: "Contact user@example.com; visit www.example.com.", widths: [80, 200] },
		];
		const gfmEvidence = {};
		for (const isStreaming of [true, false]) {
			for (const { label, widths } of gfmCases) {
				for (const width of widths) {
					const output = transformer("# " + label, {
						messageType: "assistant-thinking", isStreaming, availableWidth: width,
					});
					const state = renderMarkdown(output, width);
					const marker = mode === "rail"
						? (isStreaming ? "│ •" : "│")
						: (isStreaming ? "└─ •" : "└─ ·");
					const budget = Math.min(160, width - visibleWidth(marker + " "));
					const literalLabel = visibleWidth(label) <= budget
						? label
						: label.slice(0, budget - 1) + "…";
					const titleConnector = mode === "rail" ? "│" : "┆";
					const expectedConnectorCode = [titleConnector, marker];
					const connectorCode = state.codeCalls.slice(0, 2);
					const labelCode = state.codeCalls.slice(2);
					const tick = String.fromCharCode(96);
					const expectedOutput = tick + titleConnector + tick + " **Thinking**  " + String.fromCharCode(10) + tick + marker + tick + " " + tick + " " + literalLabel + " " + tick;
					if (
						output !== expectedOutput ||
						output.includes(String.fromCharCode(92)) ||
						output.includes(String.fromCharCode(27)) ||
						state.rendered.length !== 2 ||
						state.rendered.some((line) => visibleWidth(line) > width) ||
						state.structuralMarkdownCalls !== 0 ||
						JSON.stringify(connectorCode) !== JSON.stringify(expectedConnectorCode) ||
						JSON.stringify(labelCode) !== JSON.stringify([literalLabel]) ||
						state.linkCalls.length !== 0 ||
						state.linkUrlCalls.length !== 0 ||
						state.visible[1] !== marker + " " + literalLabel ||
						state.rendered.join("\\n").includes(String.fromCharCode(27) + "]8;")
					) {
						throw new Error("Pi " + version + " " + mode + " GFM callback/row isolation failed for " + (isStreaming ? "streaming" : "settled") + " at " + width + ": " + label + " " + JSON.stringify({ connectorCode, labelCode, links: state.linkCalls, linkUrls: state.linkUrlCalls, visible: state.visible }));
					}
					const key = (isStreaming ? "streaming" : "settled") + "-" + width;
					gfmEvidence[key] = (gfmEvidence[key] ?? 0) + 1;
				}
			}
		}

		for (const label of ["family 👨‍👩‍👧‍👦 café 界語 wide", "family 👨‍👩‍👧‍👦 café 界語 *literal*"]) {
			for (const width of [20, 80]) {
				const output = transformer("# " + label, {
					messageType: "assistant-thinking", isStreaming: false, availableWidth: width,
				});
				const state = renderMarkdown(output, width);
				if (
					state.rendered.length !== 2 ||
					state.rendered.some((line) => visibleWidth(line) > width) ||
					(output.includes("‍") && !output.includes("👨‍👩‍👧‍👦")) ||
					(output.includes("́") && !output.includes("é"))
				) {
					throw new Error("Pi " + version + " " + mode + " grapheme row failed at " + width + ": " + label);
				}
			}
		}

		const themeEvidence = {};
		for (const themeName of ["dark", "light"]) {
			initTheme(themeName, false);
			const callbackOutput = getMarkdownTheme().code(mode === "rail" ? "│" : "┆");
			const data = JSON.parse(readFileSync(join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "modes", "interactive", "theme", themeName + ".json"), "utf8"));
			const resolveColor = (value) => data.vars?.[value] ?? value;
			const mdCode = resolveColor(data.colors.mdCode);
			const thinkingText = resolveColor(data.colors.thinkingText);
			if (callbackOutput === (mode === "rail" ? "│" : "┆") || mdCode === thinkingText) {
				throw new Error("Pi " + version + " " + mode + " " + themeName + " theme-native color evidence failed");
			}
			themeEvidence[themeName] = { callbackOutput, mdCode, thinkingText };
		}
		console.log(
			version + " " + mode +
				": public-loader=ok errors=0 markdownTransformer=present" +
				" streaming=" + JSON.stringify(transformed) +
				" settled=" + JSON.stringify(settled) +
				" long=" + JSON.stringify(longEvidence) +
				" risky=9x3-literal gfm=" + JSON.stringify(gfmEvidence) +
				" grapheme=2x2-one-row" +
				" themes=" + JSON.stringify(themeEvidence),
		);
		continue;
	}
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
		const measured = attestInstalledVersions(workspace, version);
		execFileSync(
			process.execPath,
			[
				join(workspace, "node_modules", "tsx", "dist", "cli.mjs"),
				"check.mts",
				measured.codingAgent,
				available ? "present" : "absent",
			],
			{ cwd: workspace, stdio: "inherit", timeout: 60_000 },
		);
		console.log(`${measured.codingAgent}: measured=${JSON.stringify(measured)}`);
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
