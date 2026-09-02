import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	assertExtensionLoaderDiagnosticFixtures,
	hasExtensionLoaderDiagnostic,
} from "./thinking-experimental-loader-diagnostics.mjs";

const versions = process.env.ZENTUI_PI_VERSIONS?.split(",") ?? [
	"0.80.5",
	"0.82.1",
	"0.83.0",
	"0.84.0",
	"0.84.4",
];
const root = join(import.meta.dirname, "..");
const workspace = mkdtempSync(join(tmpdir(), "zentui-thinking-tui-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run this harness through npm");

function resolveInstalledManifest(installRoot, packageName) {
	const path = realpathSync(join(installRoot, "node_modules", packageName, "package.json"));
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	if (manifest.name !== packageName)
		throw new Error(`Resolved manifest ${path} was ${String(manifest.name)}, not ${packageName}`);
	return { manifest, path };
}

function attestInstalledVersions(installRoot, requestedVersion) {
	const packages = {
		codingAgent: "@earendil-works/pi-coding-agent",
		tui: "@earendil-works/pi-tui",
		ai: "@earendil-works/pi-ai",
	};
	const resolved = Object.fromEntries(
		Object.entries(packages).map(([key, packageName]) => [
			key,
			resolveInstalledManifest(installRoot, packageName),
		]),
	);
	const versions = Object.fromEntries(
		Object.entries(resolved).map(([key, value]) => [key, value.manifest.version]),
	);
	for (const [key, measured] of Object.entries(versions)) {
		if (measured !== requestedVersion) {
			throw new Error(
				`Installed ${key} version ${measured} did not equal requested ${requestedVersion}`,
			);
		}
	}
	return { resolved, versions };
}

function structuralLinkSemantics(actualLabels, expectedLabels, width) {
	if (width < 80) return { capability: "cropped", preserved: true };
	const osc8 = "\x1b]8;;https://example.com/";
	const fallback = "(https://example.com/";
	const expectedOsc8 = expectedLabels.every((row) => row.includes(osc8));
	const actualOsc8 = actualLabels.every((row) => row.includes(osc8));
	const expectedFallback = expectedLabels.every((row) => row.includes(fallback));
	const actualFallback = actualLabels.every((row) => row.includes(fallback));
	return {
		capability: expectedOsc8 ? "osc8" : "fallback-url",
		preserved: expectedOsc8
			? actualOsc8 && !actualFallback
			: expectedFallback && actualFallback && !actualOsc8,
	};
}

function assertStructuralLinkSemanticsFixtures() {
	const osc8 = "\x1b]8;;https://example.com/1\x07link\x1b]8;;\x07";
	const fallback = "link (https://example.com/1)";
	if (
		!structuralLinkSemantics([osc8], [osc8], 80).preserved ||
		!structuralLinkSemantics([fallback], [fallback], 80).preserved ||
		structuralLinkSemantics([osc8], [fallback], 80).preserved
	) {
		throw new Error("Structural link capability simulation failed");
	}
}

function boundedJson(value, maxLength = 12_000) {
	const json = JSON.stringify(value, (_key, current) => {
		if (typeof current === "string" && current.length > 240) {
			return `${current.slice(0, 240)}…<${current.length} chars>`;
		}
		if (Array.isArray(current) && current.length > 20) {
			return [...current.slice(0, 20), `…<${current.length} items>`];
		}
		return current;
	});
	if (json.length <= maxLength) return json;
	return JSON.stringify({
		truncated: true,
		originalLength: json.length,
		preview: json.slice(0, Math.min(2_000, Math.floor(maxLength / 4))),
	});
}

function assertBoundedJsonFixtures() {
	const diagnostic = boundedJson({
		rows: Array.from({ length: 100 }, () => "\x1b[31m".repeat(100)),
	});
	JSON.parse(diagnostic);
	if (diagnostic.length > 12_000) throw new Error("Structural diagnostic bound simulation failed");
}

const streamingHeaderPattern = /^(\s*)Thinking \d+\.\d+s {2}\(ctrl\+t to expand\)$/;

function canonicalizeStreamingElapsed(rows) {
	return rows.map((row) =>
		row.replace(streamingHeaderPattern, "$1Thinking <elapsed>s  (ctrl+t to expand)"),
	);
}

function assertStreamingElapsedVarianceFixtures() {
	const expected = [" Thinking <elapsed>s  (ctrl+t to expand)", " exact native tail row"];
	const startup = [" Thinking 0.0s  (ctrl+t to expand)", " exact native tail row"];
	const delayedLinux = [" Thinking 0.1s  (ctrl+t to expand)", " exact native tail row"];
	const malformed = [" Thinking soon  (ctrl+t to expand)", " exact native tail row"];
	if (
		JSON.stringify(canonicalizeStreamingElapsed(startup)) !== JSON.stringify(expected) ||
		JSON.stringify(canonicalizeStreamingElapsed(delayedLinux)) !== JSON.stringify(expected) ||
		JSON.stringify(canonicalizeStreamingElapsed(malformed)) === JSON.stringify(expected)
	)
		throw new Error("Streaming elapsed-time variance simulation failed");
}

assertExtensionLoaderDiagnosticFixtures();
assertStructuralLinkSemanticsFixtures();
assertBoundedJsonFixtures();
assertStreamingElapsedVarianceFixtures();

const completedThinkingRows = [
	"PTY exact row 1  ",
	"  PTY indented row 2  ",
	"PTY exact row 3",
	"",
	"PTY exact row 5  ",
	"PTY exact row 6  ",
	"PTY exact row 7  ",
	"PTY exact row 8",
];
const thinking = completedThinkingRows.join("\n");
const assistant = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking },
		{ type: "text", text: "Offline fixture answer." },
	],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "offline-fixture",
	usage: {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.parse("2024-01-01T00:00:01.000Z"),
};

const liveThinking = [
	"LIVE rendered row 1  ",
	"LIVE rendered row 2  ",
	"LIVE rendered row 3  ",
	"LIVE wrapping row 4 has enough deliberately repeated padding words padding words padding words padding words KNOWN WRAPPED CONTINUATION  ",
	"LIVE rendered row 5  ",
	"LIVE rendered row 6  ",
	"LIVE rendered row 7  ",
	"LIVE rendered row 8  ",
].join("\n");
const liveAssistant = {
	...assistant,
	content: [{ type: "thinking", thinking: liveThinking }],
	stopReason: "pending",
	timestamp: Date.parse("2024-01-01T00:00:20.000Z"),
};

const resourceProbeSource = `
const state = { inputs: 0, timers: new Set() };
globalThis.__ZENTUI_RESOURCE_PROBE__ = state;
const fromThinkingController = () => String(new Error().stack).includes("thinking-experimental");
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
globalThis.setInterval = function (callback, delay, ...args) {
	const owned = fromThinkingController();
	const handle = Reflect.apply(nativeSetInterval, this, [callback, delay, ...args]);
	if (owned) state.timers.add(handle);
	return handle;
};
globalThis.clearInterval = function (handle) {
	state.timers.delete(handle);
	return Reflect.apply(nativeClearInterval, this, [handle]);
};
export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		const nativeInput = ctx.ui.onTerminalInput.bind(ctx.ui);
		ctx.ui.onTerminalInput = (handler) => {
			const owned = fromThinkingController();
			const cleanup = nativeInput(handler);
			if (!owned) return cleanup;
			state.inputs += 1;
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				cleanup();
				state.inputs -= 1;
			};
		};
	});
}
`;

const probeSource = `
import { appendFileSync, writeFileSync } from "node:fs";
import {
	AssistantMessageComponent,
	getMarkdownTheme,
	initTheme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, SettingsList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { hasThinkingExperimentalMarkdownIdentity } from "./extensions/zentui/thinking-experimental.ts";

const originalUpdate = AssistantMessageComponent.prototype.updateContent;
const originalDescriptor = Object.getOwnPropertyDescriptor(AssistantMessageComponent.prototype, "updateContent");
const forwarded = [];
function predecessorProbe(...args) {
	forwarded.push({ count: args.length, isStreaming: args[1], message: args[0] });
	return Reflect.apply(originalUpdate, this, args);
}
Object.defineProperty(AssistantMessageComponent.prototype, "updateContent", { ...originalDescriptor, value: predecessorProbe });
const nativeUpdate = predecessorProbe;
const nativeDescriptor = Object.getOwnPropertyDescriptor(AssistantMessageComponent.prototype, "updateContent");
const settingsInputDescriptor = Object.getOwnPropertyDescriptor(SettingsList.prototype, "handleInput");
if (process.env.ZENTUI_DIRECT_RAIL === "1" && settingsInputDescriptor?.value) {
	Object.defineProperty(SettingsList.prototype, "handleInput", {
		...settingsInputDescriptor,
		value: function directRailProbeInput(data) {
			if (data === "\\x1c") {
				const item = this.items?.[this.selectedIndex];
				if (item?.currentValue === "Streaming" && item.values?.includes("Rail")) {
					// Make one real SettingsList activation select Rail without notifying the
					// controller about the intermediate cyclic Tree value.
					item.currentValue = "Tree";
					return Reflect.apply(settingsInputDescriptor.value, this, [" "]);
				}
			}
			return Reflect.apply(settingsInputDescriptor.value, this, [data]);
		},
	});
}
const compareDescriptor = (before, after) => {
	const fields = {
		value: after?.value === before?.value,
		get: after?.get === before?.get,
		set: after?.set === before?.set,
		configurable: after?.configurable === before?.configurable,
		enumerable: after?.enumerable === before?.enumerable,
		writable: after?.writable === before?.writable,
	};
	return { fields, all: Object.values(fields).every(Boolean) };
};
const probePath = process.env.ZENTUI_PROBE_PATH;
const fixture = ${JSON.stringify(assistant)};
const liveFixture = ${JSON.stringify(liveAssistant)};
const version = process.env.ZENTUI_PI_VERSION;
const mode = process.env.ZENTUI_THINKING_MODE ?? "streaming";
const cleanRows = (rows) => rows.map((text) => text.replace(/\\x1b\\](?:[^\\x07\\x1b]|\\x1b(?!\\\\))*(?:\\x07|\\x1b\\\\)/g, "").replace(/\\x1b\\[[0-?]*[ -/]*[@-~]/g, "").trimEnd());
const structuralLinkSemantics = ${structuralLinkSemantics.toString()};
const LIVE_SECTION_START = "__ZENTUI_EXPERIMENTAL_LIVE_START_7D91B2__";
const LIVE_SECTION_END = "__ZENTUI_EXPERIMENTAL_LIVE_END_7D91B2__";
const COMPLETED_SECTION_START = "__ZENTUI_EXPERIMENTAL_COMPLETED_START_4A62C9__";
const COMPLETED_SECTION_END = "__ZENTUI_EXPERIMENTAL_COMPLETED_END_4A62C9__";
const TRANSITION_SECTION_START = "__ZENTUI_EXPERIMENTAL_TRANSITION_START_52F0A8__";
const TRANSITION_SECTION_END = "__ZENTUI_EXPERIMENTAL_TRANSITION_END_52F0A8__";

let removeProbeWidget;
let structuralWidths = [];
let structuralGenerations = [];
let removeLiveProbeWidget;
let stopProbeInput;
const ownedProbeWidgets = new Set();
export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		const setProbeWidget = (key, factory, options) => {
			ctx.ui.setWidget(key, factory, options);
			if (factory) ownedProbeWidgets.add(key);
			else ownedProbeWidgets.delete(key);
		};
		if (mode === "rail" || mode === "tree") {
			const labels = Array.from(
				{ length: 8 },
				(_, index) =>
					"PTY label " +
					(index + 1) +
					" with *emphasis* and \`code\` plus [link](https://example.com/" +
					(index + 1) +
					")",
			);
			const structuralBlocks = [
				labels.slice(0, 4).map((label) => "# " + label).join("\\n"),
				labels.slice(4).map((label) => "# " + label).join("\\n"),
			];
			const baseStructuralFixture = {
				...liveFixture,
				content: structuralBlocks.map((thinking) => ({ type: "thinking", thinking })),
			};
			const specs = ["current", "dark", "light"].flatMap((themeName) => [
				{ themeName, active: true },
				{ themeName, active: false },
			]);
			let generation = 0;
			let tested;
			let initialCalls = [];
			const crop = (markdown, source, width) => {
				const rows = markdown.render(width);
				const first = rows[0];
				if (!first) return undefined;
				if (rows.length > 1)
					return width === 1 ? "…" : truncateToWidth(first, width - 1, "") + "…";
				return visibleWidth(first) <= width ? first : truncateToWidth(first, width, "…");
			};
			const compareAnsi = (component, nativeShape, selected, incomplete, width) => {
				const rendered = component.render(width);
				const structuralRows = rendered.filter((row) =>
					/^\\s*(?:│|┆|├─|└─)/.test(cleanRows([row])[0] ?? ""),
				);
				const actualLabels = structuralRows
					.slice(1)
					.map((row) => row.replace(/\\x1b\\]133;[ABC]\\x07/g, ""));
				const outer = nativeShape.paddingX;
				const innerWidth = width - outer * 2;
				const expectedLabels = selected.map((label, index) => {
					const final = index === selected.length - 1;
					const connector =
						mode === "rail"
							? final && incomplete
								? "│ • "
								: "│ "
							: final
								? incomplete
									? "└─ • "
									: "└─ · "
								: "├─ · ";
					const budget = innerWidth - visibleWidth(connector);
					const markdown = new Markdown(
						label,
						0,
						0,
						nativeShape.theme,
						nativeShape.defaultTextStyle,
						nativeShape.options,
					);
					const nativeLabel = crop(markdown, label, budget);
					return (
						" ".repeat(outer) +
						ctx.ui.theme.fg("accent", connector) +
						nativeLabel +
						" ".repeat(outer)
					);
				});
				const links = structuralLinkSemantics(actualLabels, expectedLabels, width);
				return {
					width,
					rendered,
					actualLabels,
					expectedLabels,
					exactNativeLabels: JSON.stringify(actualLabels) === JSON.stringify(expectedLabels),
					linkCapability: links.capability,
					linkSemantics: links.preserved,
					croppedWithEllipsis:
						width > 20 || cleanRows(actualLabels).every((row) => row.includes("…")),
				};
			};
			const createGeneration = () => {
				const spec = specs[generation];
				if (spec.themeName !== "current") initTheme(spec.themeName, false);
				const structuralFixture = {
					...baseStructuralFixture,
					stopReason: spec.active ? "pending" : "stop",
					timestamp: baseStructuralFixture.timestamp + generation,
				};
				tested = new AssistantMessageComponent(
					undefined,
					false,
					getMarkdownTheme(),
					"Thinking...",
					1,
					[],
				);
				const beforeWrapperCalls = forwarded.length;
				if (version === "0.80.5" || version === "0.83.0") tested.updateContent(structuralFixture);
				else tested.updateContent(structuralFixture, spec.active);
				if (generation === 0) {
					initialCalls = forwarded.slice(beforeWrapperCalls).map((call) => ({
						count: call.count,
						isStreaming: call.isStreaming,
						messageIdentity: call.message === structuralFixture,
					}));
				}
				const native = new AssistantMessageComponent(
					undefined,
					false,
					getMarkdownTheme(),
					"Thinking...",
					1,
					[],
				);
				Reflect.apply(originalUpdate, native, [structuralFixture, spec.active]);
				const nativeMarkdown = (native.contentContainer?.children ?? []).find(
					(child) => child instanceof Markdown && child.text.includes("PTY label 1"),
				);
				if (!nativeMarkdown) throw new Error("native structural Markdown shape missing");
				const selected = mode === "rail" ? labels : labels.slice(-5);
				const record = {
					generation,
					themeName: spec.themeName,
					active: spec.active,
					constructors: (tested.contentContainer?.children ?? []).map(
						(child) => child.constructor.name,
					),
					comparisons: [20, 80].map((width) =>
						compareAnsi(tested, nativeMarkdown, selected, spec.active, width),
					),
				};
				structuralGenerations.push(record);
			};
			createGeneration();
			const hidden = new AssistantMessageComponent(
				undefined,
				true,
				getMarkdownTheme(),
				"Thinking...",
				1,
				[],
			);
			hidden.updateContent(baseStructuralFixture, true);
			const nativeHidden = new AssistantMessageComponent(
				undefined,
				true,
				getMarkdownTheme(),
				"Thinking...",
				1,
				[],
			);
			Reflect.apply(originalUpdate, nativeHidden, [baseStructuralFixture, true]);
			const transition = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
			const transitionFixture = {
				...liveFixture,
				content: [{ type: "thinking", thinking: Array.from({ length: 6 }, (_, index) => "# Live transition " + (index + 1)).join("\\n") }],
			};
			transition.updateContent(transitionFixture, true);
			const widget = {
				render(width) {
					structuralWidths.push(width);
					const marker = "Z" + generation + "W" + width;
					const resources = globalThis.__ZENTUI_RESOURCE_PROBE__;
					return [
						"«" + marker + "»",
						...tested.render(width),
						"«/" + marker + "»",
						TRANSITION_SECTION_START,
						...transition.render(width),
						TRANSITION_SECTION_END,
						"__ZENTUI_RESOURCES__ input=" + resources.inputs + " timer=" + resources.timers.size,
					];
				},
				invalidate() {
					tested.invalidate();
					transition.invalidate();
				},
			};
			setProbeWidget("zentui-structural-probe", () => widget, { placement: "aboveEditor" });
			stopProbeInput = ctx.ui.onTerminalInput((data) => {
				if (data !== "\\x1d" || generation >= specs.length - 1) return;
				generation += 1;
				createGeneration();
				process.stdout.emit("resize");
				return { consume: true };
			});
			removeProbeWidget = () => setProbeWidget("zentui-structural-probe", undefined);
			writeFileSync(
				probePath,
				JSON.stringify({
					ready: true,
					mode,
					installed: AssistantMessageComponent.prototype.updateContent !== nativeUpdate,
					wrapperCalls: initialCalls.length,
					testedCalls: initialCalls,
					hidden80: hidden.render(80),
					nativeHidden80: nativeHidden.render(80),
					hiddenStatePreserved: hidden.hideThinkingBlock === true,
				}) + "\\n",
			);
			return;
		}
		const nativeLive = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		Reflect.apply(originalUpdate, nativeLive, [liveFixture, true]);
		const nativeChildren = nativeLive.contentContainer?.children ?? [];
		const nativeMarkdown = nativeChildren.find((child) => child instanceof Markdown && child.text.includes("LIVE rendered row 1"));
		const nativeRows = nativeMarkdown ? cleanRows(nativeMarkdown.render(40)) : [];
		const nativeScreenRows = cleanRows(nativeLive.render(100));
		const importedAssistantIdentity = nativeLive.constructor === AssistantMessageComponent;
		const importedMarkdownIdentity = Boolean(nativeMarkdown && nativeMarkdown.constructor === Markdown);
		const markdownIdentity = hasThinkingExperimentalMarkdownIdentity(nativeLive, liveFixture);
		const installed = AssistantMessageComponent.prototype.updateContent !== nativeUpdate;

		const tested = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		const beforeWrapperCalls = forwarded.length;
		if (version === "0.80.5" || version === "0.83.0") tested.updateContent(liveFixture);
		else tested.updateContent(liveFixture, true);
		const testedCalls = forwarded.slice(beforeWrapperCalls).map((call) => ({
			count: call.count,
			isStreaming: call.isStreaming,
			messageIdentity: call.message === liveFixture,
		}));
		const wrapperCalls = testedCalls.length;
		const signature = (component) => (component.contentContainer?.children ?? []).map((child) => ({
			constructor: child.constructor.name,
			text: typeof child.text === "string" ? child.text : undefined,
		}));
		const collision = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		collision.updateContent({
			...fixture,
			content: [
				{ type: "thinking", thinking: "collision A" },
				{ type: "text", text: "collision B" },
				{ type: "thinking", thinking: "collision B" },
			],
		}, false);
		const equal = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		equal.updateContent({
			...fixture,
			content: [
				{ type: "text", text: "equal source" },
				{ type: "thinking", thinking: "equal source" },
			],
		}, false);
		const contiguous = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		contiguous.updateContent({
			...fixture,
			content: [
				{ type: "thinking", thinking: "contiguous A" },
				{ type: "thinking", thinking: "contiguous B" },
			],
		}, false);
		const toolSeparated = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		toolSeparated.updateContent({
			...fixture,
			content: [
				{ type: "thinking", thinking: "tool-separated A" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: {} },
				{ type: "thinking", thinking: "tool-separated B" },
			],
		}, false);
		const orderedIdentitySignatures = {
			collision: signature(collision),
			equal: signature(equal),
			contiguous: signature(contiguous),
			toolSeparated: signature(toolSeparated),
		};
		const liveCollapsedRows = cleanRows(tested.render(40));
		const liveProbeWidget = {
			render(width) {
				const rendered = tested.render(width);
				const headerIndex = cleanRows(rendered).findIndex((row) =>
					/^Thinking \\d+\\.\\d+s {2}\\(ctrl\\+t to expand\\)$/.test(row.trimStart()),
				);
				return [
					LIVE_SECTION_START,
					...(headerIndex >= 0 ? rendered.slice(headerIndex) : rendered),
					LIVE_SECTION_END,
				];
			},
			invalidate() {
				tested.invalidate();
			},
		};
		setProbeWidget("zentui-stream-live-probe", () => liveProbeWidget, { placement: "aboveEditor" });
		const completed = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		const completedFixture = { ...fixture, content: fixture.content.filter((part) => part.type === "thinking") };
		completed.updateContent(completedFixture, false);
		const completedProbeWidget = {
			render(width) {
				const rendered = completed.render(width);
				const cleaned = cleanRows(rendered);
				const headerIndex = cleaned.findIndex((row) =>
					/^Thought {2}\\(ctrl\\+t to expand\\)$/.test(row.trimStart()),
				);
				const nativeIndex = cleaned.findIndex((row) => row.trimStart() === "PTY exact row 1");
				const startIndex = headerIndex >= 0 ? headerIndex : nativeIndex >= 0 ? nativeIndex : 0;
				return [
					COMPLETED_SECTION_START,
					...rendered.slice(startIndex),
					COMPLETED_SECTION_END,
				];
			},
			invalidate() {
				completed.invalidate();
			},
		};
		setProbeWidget("zentui-stream-completed-probe", () => completedProbeWidget, { placement: "aboveEditor" });
		const transition = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, []);
		const transitionFixture = {
			...liveFixture,
			content: [{ type: "thinking", thinking: Array.from({ length: 6 }, (_, index) => "# Live transition " + (index + 1)).join("\\n") }],
		};
		transition.updateContent(transitionFixture, true);
		const transitionProbeWidget = {
			render(width) {
				const resources = globalThis.__ZENTUI_RESOURCE_PROBE__;
				return [
					TRANSITION_SECTION_START,
					...transition.render(width),
					TRANSITION_SECTION_END,
					"__ZENTUI_RESOURCES__ input=" + resources.inputs + " timer=" + resources.timers.size,
				];
			},
			invalidate() {
				transition.invalidate();
			},
		};
		setProbeWidget("zentui-stream-transition-probe", () => transitionProbeWidget, { placement: "aboveEditor" });
		removeLiveProbeWidget = () => setProbeWidget("zentui-stream-live-probe", undefined);
		removeProbeWidget = () => {
			removeLiveProbeWidget?.();
			setProbeWidget("zentui-stream-completed-probe", undefined);
			setProbeWidget("zentui-stream-transition-probe", undefined);
		};
		stopProbeInput = ctx.ui.onTerminalInput((data) => {
			if (data !== "\\x07") return;
			removeLiveProbeWidget?.();
			removeLiveProbeWidget = undefined;
			return { consume: true };
		});

		const hidden = new AssistantMessageComponent(undefined, true, getMarkdownTheme(), "Thinking...", 1, []);
		hidden.updateContent(liveFixture, version === "0.80.5" || version === "0.83.0" ? undefined : true);
		const hiddenFolded = cleanRows(hidden.render(40)).some((row) => row.includes("Thinking"));
		const hiddenStatePreserved = hidden.hideThinkingBlock === true;

		writeFileSync(probePath, JSON.stringify({
			ready: true,
			installed,
			markdownIdentity,
			importedAssistantIdentity,
			importedMarkdownIdentity,
			liveCollapsedRows,
			nativeTail: nativeRows.slice(-5),
			nativeRows,
			nativeScreenTail: nativeScreenRows.slice(-5),
			liveSectionStart: LIVE_SECTION_START,
			liveSectionEnd: LIVE_SECTION_END,
			completedSectionStart: COMPLETED_SECTION_START,
			completedSectionEnd: COMPLETED_SECTION_END,
			wrapperCalls,
			testedCalls,
			orderedIdentitySignatures,
			hiddenFolded,
			hiddenStatePreserved,
		}) + "\\n");
	});
	pi.on("session_shutdown", () => {
		removeProbeWidget?.();
		removeProbeWidget = undefined;
		stopProbeInput?.();
		stopProbeInput = undefined;
		const shutdownDescriptor = Object.getOwnPropertyDescriptor(AssistantMessageComponent.prototype, "updateContent");
		const descriptorEvidence = compareDescriptor(nativeDescriptor, shutdownDescriptor);
		const resources = globalThis.__ZENTUI_RESOURCE_PROBE__;
		appendFileSync(
			probePath,
			JSON.stringify({
				restored: descriptorEvidence.all,
				descriptorEvidence,
				widgetRemoved: ownedProbeWidgets.size === 0,
				widgetOwnershipCount: ownedProbeWidgets.size,
				controllerResources: { inputs: resources.inputs, timers: resources.timers.size },
				structuralWidths,
				structuralGenerations,
			}) + "\\n",
		);
		Object.defineProperty(AssistantMessageComponent.prototype, "updateContent", originalDescriptor);
		if (settingsInputDescriptor)
			Object.defineProperty(SettingsList.prototype, "handleInput", settingsInputDescriptor);
	});
}
`;

const ptySource = String.raw`
import codecs, json, os, select, signal, struct, sys, termios, time, fcntl

command = json.loads(sys.argv[1])
environment = os.environ.copy()
environment.update(json.loads(sys.argv[2]))
probe_path = environment["ZENTUI_PROBE_PATH"]
supervisor_path = environment["ZENTUI_SUPERVISOR_PATH"]
rows = 40
cols = 80 if environment.get("ZENTUI_THINKING_MODE") in ("rail", "tree") else 100

class Screen:
    def __init__(self):
        self.cells = [[" "] * cols for _ in range(rows)]
        self.r = 0; self.c = 0; self.saved = (0, 0)
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.pending = ""
    def resize(self, height, width):
        global rows, cols
        resized = []
        for y in range(height):
            previous = self.cells[y] if y < len(self.cells) else []
            resized.append((previous[:width] + [" "] * width)[:width])
        self.cells = resized
        rows, cols = height, width
        self.r = max(0, min(rows - 1, self.r))
        self.c = max(0, min(cols - 1, self.c))
        self.saved = (
            max(0, min(rows - 1, self.saved[0])),
            max(0, min(cols - 1, self.saved[1])),
        )
    def clear_line(self, mode=0):
        if mode == 2: start, end = 0, cols
        elif mode == 1: start, end = 0, self.c + 1
        else: start, end = self.c, cols
        for x in range(max(0, start), min(cols, end)): self.cells[self.r][x] = " "
    def clear_display(self, mode=0):
        if mode == 0:
            self.clear_line(0)
            for y in range(self.r + 1, rows): self.cells[y] = [" "] * cols
        elif mode == 1:
            for y in range(0, self.r): self.cells[y] = [" "] * cols
            self.clear_line(1)
        elif mode == 2:
            self.cells = [[" "] * cols for _ in range(rows)]
        elif mode == 3:
            pass
    def scroll(self, count=1):
        for _ in range(max(1, count)):
            self.cells.pop(0); self.cells.append([" "] * cols)
        self.r = rows - 1
    def reverse_scroll(self, count=1):
        for _ in range(max(1, count)):
            self.cells.pop(); self.cells.insert(0, [" "] * cols)
    def put(self, ch):
        if ch == "\r": self.c = 0; return
        if ch == "\n":
            self.r += 1
            if self.r >= rows: self.scroll()
            return
        if ch == "\b": self.c = max(0, self.c - 1); return
        if ord(ch) < 32 or ch == "\x7f": return
        if self.c >= cols:
            self.c = 0; self.r += 1
            if self.r >= rows: self.scroll()
        self.cells[self.r][self.c] = ch
        self.c += 1
    def csi(self, body, final):
        private = body.startswith("?")
        if private: body = body[1:]
        values = []
        for value in body.split(";") if body else []:
            try: values.append(int(value.split(":")[0] or "0"))
            except ValueError: values.append(0)
        n = values[0] if values and values[0] else 1
        if final in "Hf":
            self.r = max(0, min(rows - 1, (values[0] if values else 1) - 1))
            self.c = max(0, min(cols - 1, (values[1] if len(values) > 1 else 1) - 1))
        elif final == "A": self.r = max(0, self.r - n)
        elif final == "B": self.r = min(rows - 1, self.r + n)
        elif final == "C": self.c = min(cols - 1, self.c + n)
        elif final == "D": self.c = max(0, self.c - n)
        elif final == "E": self.r = min(rows - 1, self.r + n); self.c = 0
        elif final == "F": self.r = max(0, self.r - n); self.c = 0
        elif final == "G": self.c = max(0, min(cols - 1, n - 1))
        elif final in "de": self.r = max(0, min(rows - 1, (n - 1) if final == "d" else self.r + n))
        elif final == "K": self.clear_line(values[0] if values else 0)
        elif final == "J": self.clear_display(values[0] if values else 0)
        elif final == "X":
            for x in range(self.c, min(cols, self.c + n)): self.cells[self.r][x] = " "
        elif final == "P":
            line = self.cells[self.r]; del line[self.c:min(cols, self.c + n)]; line.extend([" "] * (cols - len(line)))
        elif final == "@":
            line = self.cells[self.r]; line[self.c:self.c] = [" "] * n; del line[cols:]
        elif final == "L":
            for _ in range(n): self.cells.insert(self.r, [" "] * cols); self.cells.pop()
        elif final == "M":
            for _ in range(n): self.cells.pop(self.r); self.cells.append([" "] * cols)
        elif final == "S": self.scroll(n)
        elif final == "T": self.reverse_scroll(n)
        elif final == "s": self.saved = (self.r, self.c)
        elif final == "u": self.r, self.c = self.saved
    def feed(self, data):
        text = self.pending + self.decoder.decode(data)
        self.pending = ""
        i = 0
        while i < len(text):
            if text[i] != "\x1b": self.put(text[i]); i += 1; continue
            if i + 1 >= len(text): self.pending = text[i:]; break
            if text[i + 1] == "[":
                j = i + 2
                while j < len(text) and not ("@" <= text[j] <= "~"): j += 1
                if j >= len(text): self.pending = text[i:]; break
                self.csi(text[i + 2:j], text[j]); i = j + 1; continue
            if text[i + 1] in "78":
                if text[i + 1] == "7": self.saved = (self.r, self.c)
                else: self.r, self.c = self.saved
                i += 2; continue
            if text[i + 1] in "]P_^":
                bell = text.find("\x07", i + 2)
                st = text.find("\x1b\\", i + 2)
                ends = [value for value in (bell, st) if value >= 0]
                if not ends: self.pending = text[i:]; break
                end = min(ends); i = end + (2 if text[end] == "\x1b" else 1); continue
            i += 2
    def text(self):
        return "\n".join("".join(line).rstrip() for line in self.cells).rstrip()

master = slave = pid = pgid = None
group_established = False
status = None
cleanup_started = False
screen = Screen()
raw = bytearray()
overall_deadline = time.monotonic() + 18.0
supervisor_data = {"pythonPid": os.getpid(), "cleanupSignals": []}

def record_supervisor(**fields):
    supervisor_data.update(fields)
    temporary = supervisor_path + "." + str(os.getpid()) + ".tmp"
    with open(temporary, "w") as metadata:
        json.dump(supervisor_data, metadata)
        metadata.flush()
        os.fsync(metadata.fileno())
    os.replace(temporary, supervisor_path)

record_supervisor()
if environment.get("ZENTUI_DELAY_METADATA_COMPLETION") == "1": time.sleep(0.2)

def group_exists():
    if not group_established or pgid is None: return False
    try: os.killpg(pgid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True

def child_exists():
    if pid is None or status is not None: return False
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False

def reap_leader(block=False):
    global status
    if pid is None or status is not None: return
    try:
        waited, value = os.waitpid(pid, 0 if block else os.WNOHANG)
        if waited == pid: status = value
    except ChildProcessError:
        if status is None: status = 0

def signal_target(sig):
    sent = False
    try:
        if group_established and pgid is not None: os.killpg(pgid, sig); sent = True
        elif pid is not None: os.kill(pid, sig); sent = True
    except ProcessLookupError: pass
    if sent:
        signals = [*supervisor_data.get("cleanupSignals", []), signal.Signals(sig).name]
        record_supervisor(cleanupSignals=signals)
    return sent

def cleanup():
    global status, cleanup_started
    if pid is None or cleanup_started: return
    cleanup_started = True
    signal_target(signal.SIGTERM)
    end = time.monotonic() + 1.0
    while time.monotonic() < end:
        reap_leader(False)
        if not group_exists() and not child_exists(): break
        time.sleep(0.02)
    if group_exists() or child_exists():
        signal_target(signal.SIGKILL)
        end = time.monotonic() + 1.0
        while time.monotonic() < end and (group_exists() or child_exists()):
            reap_leader(False); time.sleep(0.02)
    reap_leader(False)
    if status is None and not group_exists() and not child_exists(): reap_leader(True)
    record_supervisor(
        leaderReaped=status is not None,
        groupAliveAfterCleanup=group_exists(),
        leaderAliveAfterCleanup=child_exists(),
    )

def handle_signal(_signum, _frame):
    cleanup()
    raise SystemExit(128 + _signum)

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

try:
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    ready_r, ready_w = os.pipe()
    ack_r, ack_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(ready_r); os.close(ack_w)
        try:
            if environment.get("ZENTUI_SIMULATE_GROUP_FAILURE") == "1":
                raise RuntimeError("simulated process-group establishment failure")
            os.setsid()
            child_pgid = os.getpgrp()
            os.write(ready_w, ("OK " + str(child_pgid) + "\n").encode())
            os.close(ready_w)
            if os.read(ack_r, 1) != b"1": raise RuntimeError("parent did not acknowledge process group")
            os.close(ack_r)
            os.close(master)
            os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
            if slave > 2: os.close(slave)
            os.execvpe(command[0], command, environment)
        except BaseException as error:
            try: os.write(ready_w, ("ERR " + repr(error) + "\n").encode())
            except OSError: pass
            os._exit(125)
    os.close(ready_w); os.close(ack_r)
    os.close(slave); slave = None
    record_supervisor(piPid=pid)
    handshake_deadline = time.monotonic() + 2.0
    handshake = b""
    while b"\n" not in handshake and time.monotonic() < handshake_deadline:
        ready, _, _ = select.select([ready_r], [], [], max(0, handshake_deadline - time.monotonic()))
        if not ready: break
        part = os.read(ready_r, 4096)
        if not part: break
        handshake += part
    os.close(ready_r)
    if handshake.startswith(b"OK "):
        pgid = int(handshake.splitlines()[0].split()[1])
        group_established = pgid == pid and os.getpgid(pid) == pgid
    record_supervisor(
        piPgid=pgid,
        groupEstablished=group_established,
        handshake=handshake.decode("utf-8", "replace").strip(),
    )
    if not group_established:
        os.close(ack_w)
        raise RuntimeError("Pi process-group handshake failed: " + handshake.decode("utf-8", "replace"))
    os.write(ack_w, b"1"); os.close(ack_w)

    def pump_until(predicate, label):
        matched = False
        quiet_since = None
        def reevaluate():
            nonlocal matched, quiet_since
            now = time.monotonic()
            if predicate():
                if not matched:
                    matched = True; quiet_since = now
            else:
                matched = False; quiet_since = None
        while time.monotonic() < overall_deadline:
            reevaluate()
            now = time.monotonic()
            timeout = min(0.05, max(0, overall_deadline - now))
            ready, _, _ = select.select([master], [], [], timeout)
            if ready:
                try: part = os.read(master, 65536)
                except OSError: part = b""
                if part:
                    raw.extend(part); screen.feed(part)
                    reevaluate()
            reap_leader(False)
            reevaluate()
            if status is not None and not matched and label != "process exit":
                raise RuntimeError("Pi exited before " + label + ": " + raw.decode("utf-8", "replace")[-4000:])
            if matched and quiet_since is not None and time.monotonic() - quiet_since >= 0.15:
                return
        raise TimeoutError("deadline waiting for " + label + ": " + screen.text()[-2000:])

    folded = live_section = expanded = refolded = tree_transition = rail_transition = quiescence_snapshot = ""
    transition_sequence = []
    structural_snapshots = []

    def switch_thinking_mode(action, expected_mode, expected_active, expected_row):
        os.write(master, b"/zentui\r")
        pump_until(lambda: "Appearance (1/9)" in screen.text(), "settings open")
        os.write(master, b"\t\t\t")
        pump_until(lambda: "Thinking (Experimental) (4/9)" in screen.text(), "Thinking settings section")
        os.write(master, b"\x1b[B")
        before = screen.text()
        previous = [value for value in ("Streaming", "Tree", "Rail") if "Mode     " + value in before]
        if len(previous) != 1: raise AssertionError("could not parse previous Thinking mode: " + before[-2000:])
        os.write(master, action)
        expected_label = "Mode     " + expected_mode
        expected_status = "Saved: " + expected_mode + " · Active: " + expected_active
        if expected_mode == "Streaming" and expected_active != "Streaming": expected_status += " · restart required"
        pump_until(lambda: expected_label in screen.text() and expected_status in screen.text(), "Thinking mode " + expected_mode)
        settings_snapshot = screen.text()
        status_rows = [row.strip() for row in settings_snapshot.split("\n") if row.strip().startswith("Saved: ")]
        status_regions = [row.split(" Rail shows", 1)[0].split(" Live switching", 1)[0] for row in status_rows]
        if not status_regions or any(row != expected_status for row in status_regions):
            raise AssertionError("unexpected complete Thinking status regions: " + repr(status_regions))
        os.write(master, b"\x1b")
        expected_resource = 1 if expected_active == "Streaming" else 0
        expected_resources = "__ZENTUI_RESOURCES__ input=" + str(expected_resource) + " timer=" + str(expected_resource)
        def exact_resource_rows():
            return [row.strip() for row in screen.text().split("\n") if row.strip().startswith("__ZENTUI_RESOURCES__")]
        pump_until(lambda: expected_row in screen.text() and exact_resource_rows() == [expected_resources] and "__ZENTUI_EXPERIMENTAL_TRANSITION_START_52F0A8__" in screen.text() and "__ZENTUI_EXPERIMENTAL_TRANSITION_END_52F0A8__" in screen.text(), expected_mode + " transition screen")
        snapshot = screen.text()
        transition_sequence.append({"from": previous[0].lower(), "to": expected_mode.lower(), "mode": expected_active.lower(), "saved": expected_mode.lower(), "active": expected_active.lower(), "status": expected_status, "statusRows": status_regions, "resources": expected_resources, "settingsScreen": settings_snapshot, "screen": snapshot})
        return snapshot

    if environment.get("ZENTUI_QUIESCENCE_SIMULATION") == "1":
        pump_until(lambda: "TRANSIENT_READY" in screen.text() and "STABLE_GATE" in screen.text(), "stable simulated state")
        quiescence_snapshot = screen.text()
        pump_until(lambda: status is not None, "process exit")
    elif environment.get("ZENTUI_ACTIVE_STREAMING_SHUTDOWN") == "1":
        pump_until(lambda: os.path.exists(probe_path) and os.path.getsize(probe_path) > 0 and "__ZENTUI_EXPERIMENTAL_TRANSITION_START_52F0A8__" in screen.text() and "__ZENTUI_RESOURCES__ input=1 timer=1" in screen.text(), "active Streaming shutdown readiness")
        folded = screen.text()
        os.write(master, b"\x04")
        pump_until(lambda: status is not None, "process exit")
    elif environment.get("ZENTUI_DIRECT_RAIL") == "1":
        pump_until(lambda: os.path.exists(probe_path) and os.path.getsize(probe_path) > 0 and "__ZENTUI_EXPERIMENTAL_TRANSITION_START_52F0A8__" in screen.text() and "__ZENTUI_RESOURCES__ input=1 timer=1" in screen.text(), "direct Rail transition readiness")
        folded = screen.text()
        rail_transition = switch_thinking_mode(b"\x1c", "Rail", "Rail", "│ • Live transition 6")
        os.write(master, b"\x04")
        pump_until(lambda: status is not None, "process exit")
    elif environment.get("ZENTUI_THINKING_MODE") in ("rail", "tree"):
        def sentinel_rows(snapshot, start, end):
            values = snapshot.split("\n")
            try: start_index = next(i for i, row in enumerate(values) if row.strip() == start)
            except StopIteration: return []
            try: end_index = next(i for i, row in enumerate(values[start_index + 1:], start_index + 1) if row.strip() == end)
            except StopIteration: return []
            return [row.rstrip() for row in values[start_index + 1:end_index]]
        pump_until(lambda: os.path.exists(probe_path) and os.path.getsize(probe_path) > 0 and "«Z0W80»" in screen.text() and "«/Z0W80»" in screen.text(), "initial 80-column structural screen")
        for generation in range(6):
            for width in (20, 80):
                screen.resize(rows, width)
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, width, 0, 0))
                os.kill(pid, signal.SIGWINCH)
                start = "«Z" + str(generation) + "W" + str(width) + "»"
                end = "«/Z" + str(generation) + "W" + str(width) + "»"
                pump_until(lambda start=start, end=end: start in screen.text() and end in screen.text(), str(width) + "-column structural generation " + str(generation))
                snapshot = screen.text()
                structural_snapshots.append({
                    "generation": generation,
                    "width": width,
                    "rows": sentinel_rows(snapshot, start, end),
                    "screen": snapshot,
                })
                if generation == 0 and width == 80: folded = snapshot
            if generation < 5:
                os.write(master, b"\x1d")
                next_start = "«Z" + str(generation + 1) + "W80»"
                pump_until(lambda next_start=next_start: next_start in screen.text(), "structural generation " + str(generation + 1))
        mode = environment.get("ZENTUI_THINKING_MODE")
        if mode == "rail":
            tree_transition = switch_thinking_mode(b" ", "Tree", "Tree", "└─ • Live transition 6")
            switch_thinking_mode(b" ", "Streaming", "Tree", "└─ • Live transition 6")
        else:
            rail_transition = switch_thinking_mode(b" ", "Rail", "Rail", "│ • Live transition 6")
            switch_thinking_mode(b" ", "Streaming", "Rail", "│ • Live transition 6")
        os.write(master, b"\x04")
        pump_until(lambda: status is not None, "process exit")
    else:
        pump_until(lambda: os.path.exists(probe_path) and os.path.getsize(probe_path) > 0 and "Thought" in screen.text() and "ctrl+t to expand" in screen.text() and "Thinking" in screen.text() and "KNOWN WRAPPED CONTINUATION" in screen.text() and "__ZENTUI_EXPERIMENTAL_LIVE_START_7D91B2__" in screen.text() and "__ZENTUI_EXPERIMENTAL_LIVE_END_7D91B2__" in screen.text() and "__ZENTUI_EXPERIMENTAL_COMPLETED_START_4A62C9__" in screen.text() and "__ZENTUI_EXPERIMENTAL_COMPLETED_END_4A62C9__" in screen.text(), "fold readiness")
        folded = screen.text()
        folded_lines = folded.split("\n")
        live_start = next(i for i, row in enumerate(folded_lines) if row.strip() == "__ZENTUI_EXPERIMENTAL_LIVE_START_7D91B2__")
        live_end = next(i for i, row in enumerate(folded_lines[live_start + 1:], live_start + 1) if row.strip() == "__ZENTUI_EXPERIMENTAL_LIVE_END_7D91B2__")
        live_section = "\n".join(folded_lines[live_start + 1:live_end])
        os.write(master, b"\x07")
        pump_until(lambda: "LIVE rendered row 8" not in screen.text() and "__ZENTUI_EXPERIMENTAL_COMPLETED_START_4A62C9__" in screen.text(), "live widget removal")
        os.write(master, b"\x14")
        pump_until(lambda: "PTY exact row 8" in screen.text() and "__ZENTUI_EXPERIMENTAL_COMPLETED_END_4A62C9__" in screen.text(), "expanded screen")
        expanded = screen.text()
        os.write(master, b"\x14")
        pump_until(lambda: "PTY exact row 8" not in screen.text() and "__ZENTUI_EXPERIMENTAL_COMPLETED_START_4A62C9__" in screen.text(), "refolded screen")
        refolded = screen.text()

        tree_transition = switch_thinking_mode(b" ", "Tree", "Tree", "└─ • Live transition 6")
        rail_transition = switch_thinking_mode(b" ", "Rail", "Rail", "│ • Live transition 6")
        os.write(master, b"\x04")
        pump_until(lambda: status is not None, "process exit")
finally:
    cleanup()
    if master is not None:
        try: os.close(master)
        except OSError: pass
    if slave is not None:
        try: os.close(slave)
        except OSError: pass

group_alive = group_exists()
print(json.dumps({
    "exit": os.waitstatus_to_exitcode(status),
    "groupEstablished": group_established,
    "pgid": pgid,
    "folded": folded,
    "liveSection": live_section,
    "expanded": expanded,
    "refolded": refolded,
    "treeTransition": tree_transition,
    "railTransition": rail_transition,
    "transitionSequence": transition_sequence,
    "quiescenceSnapshot": quiescence_snapshot,
    "structuralSnapshots": structural_snapshots,
    "raw": raw.decode("utf-8", "replace"),
    "groupAlive": group_alive,
    "pid": pid,
}))
`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processAlive(pid) {
	if (!Number.isInteger(pid)) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

function processGroupAlive(pgid) {
	if (!Number.isInteger(pgid)) return false;
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

function extractSentinelRows(screen, start, end) {
	const rows = screen.split("\n");
	const startIndex = rows.findIndex((row) => row.trim() === start);
	const endIndex = rows.findIndex((row, index) => index > startIndex && row.trim() === end);
	if (startIndex < 0 || endIndex < 0) return [];
	return rows.slice(startIndex + 1, endIndex).map((row) => row.trimEnd());
}

function topLevelTransientArtifacts(rootPath) {
	if (!existsSync(rootPath)) return [];
	return readdirSync(rootPath, { withFileTypes: true })
		.filter((entry) => /\.(?:tmp|lock)$/.test(entry.name))
		.map((entry) => join(rootPath, entry.name));
}

function transientArtifacts(rootPath) {
	if (!existsSync(rootPath)) return [];
	const artifacts = topLevelTransientArtifacts(rootPath);
	for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
		if (entry.isDirectory()) artifacts.push(...transientArtifacts(join(rootPath, entry.name)));
	}
	return artifacts;
}

function assertTransientArtifactFixtures() {
	const fixture = join(workspace, "artifact-scan-fixture");
	mkdirSync(join(fixture, "nested"), { recursive: true });
	const topTmp = join(fixture, "leftover.tmp");
	const topLock = join(fixture, "leftover.lock");
	const nestedLock = join(fixture, "nested", "nested.lock");
	writeFileSync(topTmp, "fixture");
	writeFileSync(topLock, "fixture");
	writeFileSync(nestedLock, "fixture");
	const topLevel = topLevelTransientArtifacts(fixture).sort();
	const recursive = transientArtifacts(fixture).sort();
	if (
		JSON.stringify(topLevel) !== JSON.stringify([topLock, topTmp].sort()) ||
		JSON.stringify(recursive) !== JSON.stringify([nestedLock, topLock, topTmp].sort())
	) {
		throw new Error("Transient artifact scan simulation failed");
	}
	rmSync(fixture, { recursive: true, force: true });
}

function assertNoTransientArtifacts(version, phase, versionRoot, agentDir, home) {
	const artifacts = [
		...topLevelTransientArtifacts(versionRoot),
		...transientArtifacts(agentDir),
		...transientArtifacts(home),
	];
	if (artifacts.length) {
		throw new Error(
			`Pi ${version} left temporary artifacts after ${phase}: ${JSON.stringify(artifacts)}`,
		);
	}
}

assertTransientArtifactFixtures();

async function readSupervisorMetadata(path, fallbackPythonPid) {
	const deadline = Date.now() + 2_500;
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			try {
				return { pythonPid: fallbackPythonPid, ...JSON.parse(readFileSync(path, "utf8")) };
			} catch {
				// Retry if a platform exposes the atomic replacement between directory operations.
			}
		}
		await delay(20);
	}
	return { pythonPid: fallbackPythonPid };
}

async function rereadSupervisorMetadata(path, metadata, fallbackPythonPid) {
	try {
		if (existsSync(path)) {
			return {
				pythonPid: fallbackPythonPid,
				...metadata,
				...JSON.parse(readFileSync(path, "utf8")),
			};
		}
	} catch {
		// Keep the last complete snapshot; the next escalation/detection rereads it again.
	}
	return { pythonPid: fallbackPythonPid, ...metadata };
}

function labelsForSnapshot(metadata, fallbackPythonPid) {
	const leaks = [];
	if (processAlive(metadata.pythonPid ?? fallbackPythonPid))
		leaks.push(`python:${metadata.pythonPid ?? fallbackPythonPid}`);
	if (processAlive(metadata.piPid)) leaks.push(`pi:${metadata.piPid}`);
	if (processGroupAlive(metadata.piPgid)) leaks.push(`pi-group:${metadata.piPgid}`);
	return leaks;
}

async function detectSurvivors(path, metadata, fallbackPythonPid) {
	const refreshed = await rereadSupervisorMetadata(path, metadata, fallbackPythonPid);
	return { metadata: refreshed, leaks: labelsForSnapshot(refreshed, fallbackPythonPid) };
}

async function terminateSurvivors(path, metadata, fallbackPythonPid) {
	const signal = async (name) => {
		metadata = await rereadSupervisorMetadata(path, metadata, fallbackPythonPid);
		if (processGroupAlive(metadata.piPgid)) {
			try {
				process.kill(-metadata.piPgid, name);
			} catch {}
		}
		for (const pid of new Set([metadata.piPid, metadata.pythonPid ?? fallbackPythonPid])) {
			if (!processAlive(pid)) continue;
			try {
				process.kill(pid, name);
			} catch {}
		}
	};
	await signal("SIGTERM");
	await delay(1_000);
	await signal("SIGKILL");
	const deathDeadline = Date.now() + 1_500;
	let detected = await detectSurvivors(path, metadata, fallbackPythonPid);
	while (detected.leaks.length && Date.now() < deathDeadline) {
		await delay(25);
		detected = await detectSurvivors(path, detected.metadata, fallbackPythonPid);
	}
	return detected;
}

async function runDriver(python, command, environment, cwd, options = {}) {
	const child = spawn("python3", [python, JSON.stringify(command), JSON.stringify(environment)], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let spawnError;
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (data) => (stdout += data));
	child.stderr.on("data", (data) => (stderr += data));
	child.on("error", (error) => (spawnError = error));
	const closed = new Promise((resolve) => child.on("close", (code) => resolve(code)));
	let timeout;
	const deadline = new Promise((resolve) => {
		timeout = setTimeout(() => resolve("timeout"), options.timeoutMs ?? 22_000);
	});
	const metadataPath = environment.ZENTUI_SUPERVISOR_PATH;
	let metadata = await readSupervisorMetadata(metadataPath, child.pid);
	const initialMetadata = { ...metadata };
	let outcome = await Promise.race([closed, deadline]);
	const timedOut = outcome === "timeout";
	if (timedOut) {
		metadata = await rereadSupervisorMetadata(metadataPath, metadata, child.pid);
		child.kill("SIGTERM");
		outcome = await Promise.race([
			closed,
			delay(options.graceMs ?? 2_500).then(() => "grace-expired"),
		]);
		if (outcome === "grace-expired") {
			metadata = await rereadSupervisorMetadata(metadataPath, metadata, child.pid);
			child.kill("SIGKILL");
			outcome = await closed;
		}
	}
	clearTimeout(timeout);

	await delay(100);
	let detected = await detectSurvivors(metadataPath, metadata, child.pid);
	metadata = detected.metadata;
	if (timedOut || detected.leaks.length) {
		detected = await terminateSurvivors(metadataPath, metadata, child.pid);
		metadata = detected.metadata;
	}
	if (detected.leaks.length)
		throw new Error(`PTY cleanup leaked after TERM/KILL ${detected.leaks.join(", ")}`);
	if (spawnError) throw spawnError;
	if (timedOut && !options.expectTimeout)
		throw new Error(`PTY driver timed out after cleanup: ${stderr || stdout}`);
	if (!timedOut && outcome !== 0)
		throw new Error(`PTY driver exit=${outcome}: ${stderr || stdout}`);
	if (timedOut)
		return { timedOut: true, supervisor: metadata, initialMetadata, stdout, stderr, outcome };
	return { ...JSON.parse(stdout.trim()), supervisor: metadata };
}

try {
	const python = join(workspace, "driver.py");
	writeFileSync(python, ptySource);
	const quiescenceSupervisorPath = join(workspace, "quiescence-supervisor.json");
	const quiescence = await runDriver(
		python,
		[
			process.execPath,
			"-e",
			'process.stdout.write("TRANSIENT_READY\\nSTABLE_GATE\\n"); setTimeout(() => process.stdout.write("\\x1b[2J\\x1b[HSTABLE_GATE\\n"), 40); setTimeout(() => process.stdout.write("TRANSIENT_READY\\n"), 300); setTimeout(() => process.exit(0), 650);',
		],
		{
			ZENTUI_PROBE_PATH: join(workspace, "quiescence-unused-probe.jsonl"),
			ZENTUI_SUPERVISOR_PATH: quiescenceSupervisorPath,
			ZENTUI_QUIESCENCE_SIMULATION: "1",
		},
		workspace,
	);
	if (
		!quiescence.quiescenceSnapshot.includes("STABLE_GATE") ||
		!quiescence.quiescenceSnapshot.includes("TRANSIENT_READY")
	)
		throw new Error(
			`PTY quiescence simulation captured an erased transient: ${JSON.stringify(quiescence.quiescenceSnapshot)}`,
		);
	console.log(
		`quiescence-simulation: transient-erased=not-captured stable=${JSON.stringify(quiescence.quiescenceSnapshot.split("\n").filter(Boolean))}`,
	);

	const simulatedSupervisorPath = join(workspace, "simulated-supervisor.json");
	let simulatedFailure = "";
	try {
		await runDriver(
			python,
			[process.execPath, "-e", "setInterval(() => {}, 1000)"],
			{
				ZENTUI_PROBE_PATH: join(workspace, "unused-probe.jsonl"),
				ZENTUI_SUPERVISOR_PATH: simulatedSupervisorPath,
				ZENTUI_SIMULATE_GROUP_FAILURE: "1",
			},
			workspace,
		);
	} catch (error) {
		simulatedFailure = error instanceof Error ? error.message : String(error);
	}
	const simulatedMetadata = JSON.parse(readFileSync(simulatedSupervisorPath, "utf8"));
	if (
		!simulatedFailure.includes("process-group handshake failed") ||
		simulatedMetadata.groupEstablished !== false ||
		processAlive(simulatedMetadata.pythonPid) ||
		processAlive(simulatedMetadata.piPid)
	)
		throw new Error(`PTY process-group failure cleanup simulation failed: ${simulatedFailure}`);
	console.log(
		`cleanup-simulation: setsid/pgid failure=fallback-child-pid reaped signals=${JSON.stringify(simulatedMetadata.cleanupSignals ?? [])}`,
	);

	const stubbornPath = join(workspace, "stubborn-group.json");
	const stubbornSupervisorPath = join(workspace, "stubborn-supervisor.json");
	const stubbornSource = `
import json, os, signal, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
descendant = os.fork()
if descendant == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True: time.sleep(1)
temporary = sys.argv[1] + ".tmp"
with open(temporary, "w") as output:
    json.dump({"leaderPid": os.getpid(), "leaderPgid": os.getpgrp(), "descendantPid": descendant, "descendantPgid": os.getpgid(descendant)}, output)
    output.flush(); os.fsync(output.fileno())
os.replace(temporary, sys.argv[1])
while True: time.sleep(1)
`;
	const stubborn = await runDriver(
		python,
		["python3", "-c", stubbornSource, stubbornPath],
		{
			ZENTUI_PROBE_PATH: join(workspace, "stubborn-unused-probe.jsonl"),
			ZENTUI_SUPERVISOR_PATH: stubbornSupervisorPath,
			ZENTUI_DELAY_METADATA_COMPLETION: "1",
		},
		workspace,
		{ timeoutMs: 750, graceMs: 5_000, expectTimeout: true },
	);
	const stubbornGroup = JSON.parse(readFileSync(stubbornPath, "utf8"));
	const stubbornMetadata = stubborn.supervisor;
	if (
		!stubborn.timedOut ||
		Object.hasOwn(stubborn.initialMetadata, "piPid") ||
		Object.hasOwn(stubborn.initialMetadata, "piPgid") ||
		Object.hasOwn(stubborn.initialMetadata, "handshake") ||
		stubbornMetadata.handshake !== `OK ${stubbornMetadata.piPgid}` ||
		stubbornMetadata.groupEstablished !== true ||
		stubbornMetadata.piPid !== stubbornGroup.leaderPid ||
		stubbornMetadata.piPgid !== stubbornGroup.leaderPgid ||
		stubbornGroup.leaderPgid !== stubbornGroup.descendantPgid ||
		JSON.stringify(stubbornMetadata.cleanupSignals) !== JSON.stringify(["SIGTERM", "SIGKILL"]) ||
		stubbornMetadata.leaderReaped !== true ||
		stubbornMetadata.groupAliveAfterCleanup !== false ||
		stubbornMetadata.leaderAliveAfterCleanup !== false ||
		processAlive(stubbornMetadata.pythonPid) ||
		processAlive(stubbornGroup.leaderPid) ||
		processAlive(stubbornGroup.descendantPid) ||
		processGroupAlive(stubbornGroup.leaderPgid)
	) {
		throw new Error(
			`PTY stubborn TERM/KILL cleanup simulation failed: ${JSON.stringify({ stubborn, stubbornGroup })}`,
		);
	}
	console.log(
		`cleanup-simulation: late-metadata=${JSON.stringify(stubborn.initialMetadata)}->${stubbornMetadata.handshake} established-group=${stubbornGroup.leaderPgid} same-group-descendant=${stubbornGroup.descendantPgid} signals=${JSON.stringify(stubbornMetadata.cleanupSignals)} python=${stubbornMetadata.pythonPid}:reaped leader=${stubbornGroup.leaderPid}:reaped descendant=${stubbornGroup.descendantPid}:gone group=gone`,
	);

	for (const version of versions) {
		const versionRoot = join(workspace, version);
		mkdirSync(versionRoot, { recursive: true });
		cpSync(join(root, "extensions"), join(versionRoot, "extensions"), { recursive: true });
		writeFileSync(join(versionRoot, "package.json"), '{"type":"module","private":true}\n');
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
			],
			{ cwd: versionRoot, stdio: "inherit", timeout: 180_000 },
		);

		const attestation = attestInstalledVersions(versionRoot, version);
		const runtimeVersion = attestation.versions.codingAgent;
		const agentDir = join(versionRoot, "agent");
		const home = join(versionRoot, "home");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(home, { recursive: true });
		writeFileSync(
			join(agentDir, "zentui.json"),
			JSON.stringify({
				components: {
					thinkingSteps: { enabled: true, mode: "streaming" },
					editor: { enabled: false },
					userMessages: { enabled: false },
					workingLine: { enabled: false },
					selectorBorders: { enabled: false },
					footer: { style: "native" },
				},
			}),
		);
		const session = join(versionRoot, "fixture.jsonl");
		const entries = [
			{
				type: "session",
				version: 3,
				id: `zentui-${version.replaceAll(".", "-")}`,
				timestamp: "2024-01-01T00:00:00.000Z",
				cwd: versionRoot,
			},
			{
				type: "message",
				id: "user-1",
				parentId: null,
				timestamp: "2024-01-01T00:00:00.500Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Use the offline reasoning fixture." }],
					timestamp: Date.parse("2024-01-01T00:00:00.500Z"),
				},
			},
			{
				type: "message",
				id: "assistant-1",
				parentId: "user-1",
				timestamp: "2024-01-01T00:00:13.300Z",
				message: assistant,
			},
		];
		writeFileSync(session, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		const resourceProbe = join(versionRoot, "resource-probe.ts");
		const probe = join(versionRoot, "probe.ts");
		const probePath = join(versionRoot, "probe.jsonl");
		const supervisorPath = join(versionRoot, "supervisor.json");
		writeFileSync(resourceProbe, resourceProbeSource);
		writeFileSync(probe, probeSource);
		const codingAgent = attestation.resolved.codingAgent;
		const cliRelative = codingAgent.manifest.bin?.pi;
		if (typeof cliRelative !== "string")
			throw new Error(`Pi ${runtimeVersion} coding-agent manifest has no pi binary`);
		const cli = join(dirname(codingAgent.path), cliRelative);
		const command = [
			process.execPath,
			cli,
			"--offline",
			"--no-extensions",
			"-e",
			resourceProbe,
			"-e",
			join(versionRoot, "extensions", "zentui", "index.ts"),
			"-e",
			probe,
			"--session",
			session,
			"--no-context-files",
		];
		const environment = {
			HOME: home,
			PI_CODING_AGENT_DIR: agentDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			PI_TELEMETRY: "0",
			TERM: "xterm-256color",
			ZENTUI_PROBE_PATH: probePath,
			ZENTUI_SUPERVISOR_PATH: supervisorPath,
			ZENTUI_PI_VERSION: runtimeVersion,
		};
		const result = await runDriver(python, command, environment, versionRoot);
		if (result.exit !== 0) throw new Error(`Pi ${version} exit=${result.exit}`);
		if (!result.groupEstablished || !result.supervisor?.groupEstablished)
			throw new Error(`Pi ${version} process-group handshake was not established`);
		if (result.pgid !== result.pid || result.supervisor.piPgid !== result.supervisor.piPid)
			throw new Error(`Pi ${version} recorded inconsistent pid/pgid metadata`);
		if (result.groupAlive)
			throw new Error(`Pi ${version} process group ${result.pgid} survived cleanup`);
		if (hasExtensionLoaderDiagnostic(result.raw)) {
			throw new Error(`Pi ${runtimeVersion} emitted loader diagnostics`);
		}
		const completedStart = "__ZENTUI_EXPERIMENTAL_COMPLETED_START_4A62C9__";
		const completedEnd = "__ZENTUI_EXPERIMENTAL_COMPLETED_END_4A62C9__";
		const foldedCompletedRows = extractSentinelRows(result.folded, completedStart, completedEnd);
		const expandedCompletedRows = extractSentinelRows(
			result.expanded,
			completedStart,
			completedEnd,
		);
		const refoldedCompletedRows = extractSentinelRows(
			result.refolded,
			completedStart,
			completedEnd,
		);
		const expectedFoldedCompletedRows = [" Thought  (ctrl+t to expand)"];
		const expectedExpandedCompletedRows = [
			" PTY exact row 1",
			"   PTY indented row 2",
			" PTY exact row 3",
			"",
			" PTY exact row 5",
			" PTY exact row 6",
			" PTY exact row 7",
			" PTY exact row 8",
		];
		const transitionStart = "__ZENTUI_EXPERIMENTAL_TRANSITION_START_52F0A8__";
		const transitionEnd = "__ZENTUI_EXPERIMENTAL_TRANSITION_END_52F0A8__";
		const treeTransitionRows = extractSentinelRows(
			result.treeTransition,
			transitionStart,
			transitionEnd,
		);
		const railTransitionRows = extractSentinelRows(
			result.railTransition,
			transitionStart,
			transitionEnd,
		);
		const expectedTreeTransitionRows = [
			"",
			" ┆ Thinking",
			" ├─ · Live transition 2",
			" ├─ · Live transition 3",
			" ├─ · Live transition 4",
			" ├─ · Live transition 5",
			" └─ • Live transition 6",
		];
		const expectedRailTransitionRows = [
			"",
			" │ Thinking",
			" │ Live transition 1",
			" │ Live transition 2",
			" │ Live transition 3",
			" │ Live transition 4",
			" │ Live transition 5",
			" │ • Live transition 6",
		];
		const expectedTransitionPairs = [
			["streaming", "tree"],
			["tree", "rail"],
		];
		if (
			JSON.stringify(result.transitionSequence?.map(({ from, to }) => [from, to])) !==
			JSON.stringify(expectedTransitionPairs)
		)
			throw new Error(
				`Pi ${version} exact transition sequence was incorrect: ${JSON.stringify(result.transitionSequence)}`,
			);
		const startupResourceRows = result.folded
			.split("\n")
			.map((row) => row.trim())
			.filter((row) => /^__ZENTUI_RESOURCES__ input=\d+ timer=\d+$/.test(row));
		if (
			JSON.stringify(startupResourceRows) !==
			JSON.stringify(["__ZENTUI_RESOURCES__ input=1 timer=1"])
		)
			throw new Error(
				`Pi ${version} startup Streaming resources were not exactly 1/1: ${JSON.stringify(startupResourceRows)}`,
			);
		for (const transition of result.transitionSequence) {
			const resourceRows = transition.screen
				.split("\n")
				.map((row) => row.trim())
				.filter((row) => /^__ZENTUI_RESOURCES__ input=\d+ timer=\d+$/.test(row));
			const resourceMatch = resourceRows[0]?.match(
				/^__ZENTUI_RESOURCES__ input=(\d+) timer=(\d+)$/,
			);
			const expectedResource = transition.mode === "streaming" ? 1 : 0;
			if (
				!transition.settingsScreen.split("\n").some((row) => row.trim() === transition.status) ||
				resourceRows.length !== 1 ||
				Number(resourceMatch?.[1]) !== expectedResource ||
				Number(resourceMatch?.[2]) !== expectedResource ||
				resourceRows[0] !== transition.resources
			)
				throw new Error(
					`Pi ${version} transition state/resources were incorrect: ${JSON.stringify(transition)}`,
				);
			const rows = extractSentinelRows(transition.screen, transitionStart, transitionEnd);
			const expectedRows =
				transition.mode === "tree"
					? expectedTreeTransitionRows
					: transition.mode === "rail"
						? expectedRailTransitionRows
						: undefined;
			if (expectedRows && JSON.stringify(rows) !== JSON.stringify(expectedRows))
				throw new Error(
					`Pi ${version} ${transition.mode} direct transition rows were incorrect: ${JSON.stringify(rows)}`,
				);
			if (transition.mode === "streaming" && !rows.some((row) => row.includes("Thinking")))
				throw new Error(`Pi ${version} direct Streaming transition did not fold`);
		}
		if (JSON.stringify(foldedCompletedRows) !== JSON.stringify(expectedFoldedCompletedRows))
			throw new Error(
				`Pi ${version} exact folded completed rows were incorrect: ${JSON.stringify(foldedCompletedRows)}`,
			);
		if (JSON.stringify(expandedCompletedRows) !== JSON.stringify(expectedExpandedCompletedRows))
			throw new Error(
				`Pi ${version} exact expanded completed rows were incorrect: ${JSON.stringify(expandedCompletedRows)}`,
			);
		if (JSON.stringify(refoldedCompletedRows) !== JSON.stringify(expectedFoldedCompletedRows))
			throw new Error(
				`Pi ${version} exact refolded completed rows were incorrect: ${JSON.stringify(refoldedCompletedRows)}`,
			);
		if (JSON.stringify(treeTransitionRows) !== JSON.stringify(expectedTreeTransitionRows))
			throw new Error(
				`Pi ${version} exact live Tree transition rows were incorrect: ${JSON.stringify(treeTransitionRows)}`,
			);
		if (JSON.stringify(railTransitionRows) !== JSON.stringify(expectedRailTransitionRows))
			throw new Error(
				`Pi ${version} exact live Rail transition rows were incorrect: ${JSON.stringify(railTransitionRows)}`,
			);
		if (!existsSync(probePath)) throw new Error(`Pi ${version} probe artifact missing`);
		const probes = readFileSync(probePath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const live = probes[0];
		const liveRows = live?.liveCollapsedRows ?? [];
		const liveBody = liveRows.filter((row) => !row.includes("Thinking"));
		const liveTail = live?.nativeTail ?? [];
		const expectedScreenTail = (live?.nativeScreenTail ?? []).map((row) => row.trimEnd());
		const extractedLiveRows = result.liveSection.split("\n").map((row) => row.trimEnd());
		const expectedStartupStreamingRows = [
			" Thinking <elapsed>s  (ctrl+t to expand)",
			" padding words KNOWN WRAPPED CONTINUATION",
			" LIVE rendered row 5",
			" LIVE rendered row 6",
			" LIVE rendered row 7",
			" LIVE rendered row 8",
		];
		const canonicalExtractedLiveRows = canonicalizeStreamingElapsed(extractedLiveRows);
		const extractedLiveHeaderIndexes = extractedLiveRows.flatMap((row, index) =>
			streamingHeaderPattern.test(row) ? [index] : [],
		);
		const extractedLiveBody = extractedLiveRows.filter(
			(_row, index) => index !== extractedLiveHeaderIndexes[0],
		);
		const oldContract = runtimeVersion === "0.80.5" || runtimeVersion === "0.83.0";
		const call = live?.testedCalls?.[0];
		const signatures = live?.orderedIdentitySignatures;
		const countConstructor = (signature, name) =>
			(signature ?? []).filter((child) => child.constructor === name).length;
		const markdownTexts = (signature) =>
			(signature ?? [])
				.filter((child) => child.constructor === "Markdown")
				.map((child) => child.text);
		const equalRows = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
		const callPredicates = {
			probeCount: probes.length === 2,
			ready: live?.ready === true,
			installed: live?.installed === true,
			markdownIdentity: live?.markdownIdentity === true,
			importedAssistantIdentity: live?.importedAssistantIdentity === true,
			importedMarkdownIdentity: live?.importedMarkdownIdentity === true,
			wrapperCallCount: live?.wrapperCalls === 1,
			testedCallCount: live?.testedCalls?.length === 1,
			argumentCount: call?.count === (oldContract ? 1 : 2),
			messageIdentity: call?.messageIdentity === true,
			streamingArgument: oldContract ? call?.isStreaming === undefined : call?.isStreaming === true,
			hiddenFolded: live?.hiddenFolded === true,
			hiddenStatePreserved: live?.hiddenStatePreserved === true,
		};
		const signaturePredicates = {
			collisionThinkingCount:
				countConstructor(signatures?.collision, "FoldedThinkingSection") === 2,
			collisionMarkdown: equalRows(markdownTexts(signatures?.collision), ["collision B"]),
			equalThinkingCount: countConstructor(signatures?.equal, "FoldedThinkingSection") === 1,
			equalMarkdown: equalRows(markdownTexts(signatures?.equal), ["equal source"]),
			contiguousThinkingCount:
				countConstructor(signatures?.contiguous, "FoldedThinkingSection") ===
				(runtimeVersion === "0.80.5" ? 2 : 1),
			toolSeparatedThinkingCount:
				countConstructor(signatures?.toolSeparated, "FoldedThinkingSection") === 2,
			toolSeparatedMarkdownCount: markdownTexts(signatures?.toolSeparated).length === 0,
		};
		const livePredicates = {
			liveHeaderPresent: liveRows.some((row) => row.includes("Thinking")),
			liveRowsOneThroughThreeAbsent: !liveRows.some((row) => /LIVE rendered row [123]/.test(row)),
			liveBodyTailEqualsNativeTail: equalRows(liveBody.slice(-5), liveTail),
			extractedRowsEqualExpectedStartup: equalRows(
				canonicalExtractedLiveRows,
				expectedStartupStreamingRows,
			),
			nativeScreenTailHasFiveRows: expectedScreenTail.length === 5,
			extractedHasOneHeader: extractedLiveHeaderIndexes.length === 1,
			extractedBodyHasFiveRows: extractedLiveBody.length === 5,
			extractedBodyEqualsNativeScreenTail: equalRows(extractedLiveBody, expectedScreenTail),
			extractedBodyStartsWithWrappedContinuation:
				extractedLiveBody[0]?.includes("KNOWN WRAPPED CONTINUATION") === true,
			extractedBodyHasRowsFiveThroughEight: [5, 6, 7, 8].every((row) =>
				extractedLiveBody.some((text) => text.includes(`LIVE rendered row ${row}`)),
			),
			extractedBodyRowsOneThroughThreeAbsent: !extractedLiveBody.some((row) =>
				/LIVE rendered row [123]/.test(row),
			),
			extractedBodyWrappingSourceAbsent: !extractedLiveBody.some((row) =>
				row.includes("LIVE wrapping row 4"),
			),
		};
		const shutdown = probes.at(-1);
		const restoredPredicates = {
			restored: shutdown?.restored === true,
			descriptorAll: shutdown?.descriptorEvidence?.all === true,
			descriptorFields: Object.values(shutdown?.descriptorEvidence?.fields ?? {}).every(Boolean),
			widgetRemoved: shutdown?.widgetRemoved === true,
			widgetOwnershipCountZero: shutdown?.widgetOwnershipCount === 0,
			controllerInputsZero: shutdown?.controllerResources?.inputs === 0,
			controllerTimersZero: shutdown?.controllerResources?.timers === 0,
		};
		const predicateGroups = {
			call: callPredicates,
			signature: signaturePredicates,
			live: livePredicates,
			restored: restoredPredicates,
		};
		const failedPredicates = Object.entries(predicateGroups).flatMap(([group, predicates]) =>
			Object.entries(predicates).flatMap(([name, passed]) => (passed ? [] : [`${group}.${name}`])),
		);
		if (failedPredicates.length > 0) {
			throw new Error(
				`Pi ${version} live identity/tail/cleanup probe failed: ${boundedJson({
					failedPredicates,
					predicates: predicateGroups,
					extractedLiveRows,
					canonicalExtractedLiveRows,
					expectedStartupStreamingRows,
					expectedScreenTail,
					extractedLiveHeaderIndexes,
					extractedLiveBody,
					liveRows,
					liveBody,
					liveTail,
					call,
					signatures,
					shutdown,
				})}`,
			);
		}

		writeFileSync(
			join(agentDir, "zentui.json"),
			JSON.stringify({
				components: {
					thinkingSteps: { enabled: true, mode: "streaming" },
					editor: { enabled: false },
					userMessages: { enabled: false },
					workingLine: { enabled: false },
					selectorBorders: { enabled: false },
					footer: { style: "native" },
				},
			}),
		);
		const directProbePath = join(versionRoot, "probe-direct-rail.jsonl");
		const directSupervisorPath = join(versionRoot, "supervisor-direct-rail.json");
		const directRail = await runDriver(
			python,
			command,
			{
				...environment,
				ZENTUI_PROBE_PATH: directProbePath,
				ZENTUI_SUPERVISOR_PATH: directSupervisorPath,
				ZENTUI_DIRECT_RAIL: "1",
			},
			versionRoot,
		);
		const directProbes = readFileSync(directProbePath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const directTransition = directRail.transitionSequence?.[0];
		const directRows = extractSentinelRows(
			directTransition?.screen ?? "",
			transitionStart,
			transitionEnd,
		);
		const directResources = (directTransition?.screen ?? "")
			.split("\n")
			.map((row) => row.trim())
			.filter((row) => row.startsWith("__ZENTUI_RESOURCES__"));
		const directShutdown = directProbes.at(-1);
		if (
			directRail.exit !== 0 ||
			directRail.groupAlive ||
			hasExtensionLoaderDiagnostic(directRail.raw) ||
			JSON.stringify(directRail.transitionSequence?.map(({ from, to }) => [from, to])) !==
				JSON.stringify([["streaming", "rail"]]) ||
			directTransition?.saved !== "rail" ||
			directTransition?.active !== "rail" ||
			directTransition?.status !== "Saved: Rail · Active: Rail" ||
			directTransition?.statusRows?.some((row) => row !== "Saved: Rail · Active: Rail") ||
			JSON.stringify(directResources) !==
				JSON.stringify(["__ZENTUI_RESOURCES__ input=0 timer=0"]) ||
			JSON.stringify(directRows) !== JSON.stringify(expectedRailTransitionRows) ||
			directShutdown?.controllerResources?.inputs !== 0 ||
			directShutdown?.controllerResources?.timers !== 0 ||
			directShutdown?.restored !== true ||
			directShutdown?.descriptorEvidence?.all !== true ||
			!Object.values(directShutdown?.descriptorEvidence?.fields ?? {}).every(Boolean) ||
			directShutdown?.widgetRemoved !== true ||
			directShutdown?.widgetOwnershipCount !== 0
		)
			throw new Error(
				`Pi ${version} direct Streaming->Rail PTY probe failed: ${boundedJson({ directTransition, directRows, directResources, directShutdown, exit: directRail.exit, groupAlive: directRail.groupAlive })}`,
			);

		writeFileSync(
			join(agentDir, "zentui.json"),
			JSON.stringify({
				components: {
					thinkingSteps: { enabled: true, mode: "streaming" },
					editor: { enabled: false },
					userMessages: { enabled: false },
					workingLine: { enabled: false },
					selectorBorders: { enabled: false },
					footer: { style: "native" },
				},
			}),
		);
		const activeShutdownProbePath = join(versionRoot, "probe-active-shutdown.jsonl");
		const activeShutdownSupervisorPath = join(versionRoot, "supervisor-active-shutdown.json");
		const activeShutdown = await runDriver(
			python,
			command,
			{
				...environment,
				ZENTUI_PROBE_PATH: activeShutdownProbePath,
				ZENTUI_SUPERVISOR_PATH: activeShutdownSupervisorPath,
				ZENTUI_ACTIVE_STREAMING_SHUTDOWN: "1",
			},
			versionRoot,
		);
		const activeShutdownProbes = readFileSync(activeShutdownProbePath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const activeShutdownFinal = activeShutdownProbes.at(-1);
		const activeStartupResources = activeShutdown.folded
			.split("\n")
			.map((row) => row.trim())
			.filter((row) => /^__ZENTUI_RESOURCES__ input=\d+ timer=\d+$/.test(row));
		if (
			activeShutdown.exit !== 0 ||
			activeShutdown.groupAlive ||
			hasExtensionLoaderDiagnostic(activeShutdown.raw) ||
			(activeShutdown.transitionSequence?.length ?? -1) !== 0 ||
			JSON.stringify(activeStartupResources) !==
				JSON.stringify(["__ZENTUI_RESOURCES__ input=1 timer=1"]) ||
			activeShutdownFinal?.controllerResources?.inputs !== 0 ||
			activeShutdownFinal?.controllerResources?.timers !== 0 ||
			activeShutdownFinal?.restored !== true ||
			activeShutdownFinal?.descriptorEvidence?.all !== true ||
			!Object.values(activeShutdownFinal?.descriptorEvidence?.fields ?? {}).every(Boolean) ||
			activeShutdownFinal?.widgetRemoved !== true ||
			activeShutdownFinal?.widgetOwnershipCount !== 0
		)
			throw new Error(
				`Pi ${version} active Streaming shutdown PTY probe failed: ${boundedJson({ transitions: activeShutdown.transitionSequence, activeStartupResources, activeShutdownFinal, exit: activeShutdown.exit, groupAlive: activeShutdown.groupAlive })}`,
			);
		console.log(
			`${runtimeVersion} direct/shutdown: Streaming->Rail rows=exact status="${directTransition.status}" resources=${directResources[0]} active-Streaming-EOF=1/1->${activeShutdownFinal.controllerResources.inputs}/${activeShutdownFinal.controllerResources.timers} descriptor=${JSON.stringify(activeShutdownFinal.descriptorEvidence.fields)} widgets=0 process-group=gone`,
		);

		for (const mode of ["rail", "tree"]) {
			writeFileSync(
				join(agentDir, "zentui.json"),
				JSON.stringify({
					components: {
						thinkingSteps: { enabled: true, mode },
						editor: { enabled: false },
						userMessages: { enabled: false },
						workingLine: { enabled: false },
						selectorBorders: { enabled: false },
						footer: { style: "native" },
					},
				}),
			);
			const modeProbePath = join(versionRoot, `probe-${mode}.jsonl`);
			const modeSupervisorPath = join(versionRoot, `supervisor-${mode}.json`);
			const modeResult = await runDriver(
				python,
				command,
				{
					...environment,
					ZENTUI_PROBE_PATH: modeProbePath,
					ZENTUI_SUPERVISOR_PATH: modeSupervisorPath,
					ZENTUI_THINKING_MODE: mode,
				},
				versionRoot,
			);
			if (
				modeResult.exit !== 0 ||
				modeResult.groupAlive ||
				hasExtensionLoaderDiagnostic(modeResult.raw)
			) {
				throw new Error(`Pi ${version} ${mode} PTY/process probe failed`);
			}
			const expectedModeTransitions =
				mode === "rail"
					? [
							["rail", "tree"],
							["tree", "streaming"],
						]
					: [
							["tree", "rail"],
							["rail", "streaming"],
						];
			if (
				JSON.stringify(modeResult.transitionSequence?.map(({ from, to }) => [from, to])) !==
				JSON.stringify(expectedModeTransitions)
			)
				throw new Error(
					`Pi ${version} ${mode} exact transition sequence was incorrect: ${JSON.stringify(modeResult.transitionSequence)}`,
				);
			for (const [index, transition] of modeResult.transitionSequence.entries()) {
				const expectedActive = mode === "rail" ? "tree" : "rail";
				const expectedSaved = index === 0 ? expectedActive : "streaming";
				const expectedStatus = `Saved: ${expectedSaved[0].toUpperCase()}${expectedSaved.slice(1)} · Active: ${expectedActive[0].toUpperCase()}${expectedActive.slice(1)}${index === 1 ? " · restart required" : ""}`;
				const expectedRows =
					expectedActive === "tree" ? expectedTreeTransitionRows : expectedRailTransitionRows;
				const rows = extractSentinelRows(transition.screen, transitionStart, transitionEnd);
				const resources = transition.screen
					.split("\n")
					.map((row) => row.trim())
					.filter((row) => row.startsWith("__ZENTUI_RESOURCES__"));
				if (
					transition.active !== expectedActive ||
					transition.saved !== expectedSaved ||
					transition.status !== expectedStatus ||
					transition.statusRows.some((row) => row !== expectedStatus) ||
					JSON.stringify(resources) !== JSON.stringify(["__ZENTUI_RESOURCES__ input=0 timer=0"]) ||
					JSON.stringify(rows) !== JSON.stringify(expectedRows)
				)
					throw new Error(
						`Pi ${version} ${mode} transition status/resources/screen mismatch: ${JSON.stringify(transition)}`,
					);
			}
			const modeProbes = readFileSync(modeProbePath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			const structural = modeProbes[0];
			const completedStructural = modeProbes.at(-1);
			const cleanExact = (rows) =>
				(rows ?? []).map((text) =>
					text
						.replace(/\x1b\]133;[ABC]\x07/g, "")
						.replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, "")
						.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
						.trimEnd(),
				);
			const clean = (rows) => cleanExact(rows).filter((text) => text.trim().length > 0);
			const generations = completedStructural?.structuralGenerations ?? [];
			const snapshots = modeResult.structuralSnapshots ?? [];
			const oldContract = runtimeVersion === "0.80.5" || runtimeVersion === "0.83.0";
			const modeCall = structural?.testedCalls?.[0];
			let generationFailure;
			for (const generation of generations) {
				const replacementCount = generation.constructors.filter(
					(name) => name === "ThinkingStepsRows",
				).length;
				if (replacementCount !== 1) {
					generationFailure = {
						generation: generation.generation,
						predicates: { replacementConstructorCount: replacementCount === 1 },
						constructors: generation.constructors,
					};
					break;
				}
				for (const comparison of generation.comparisons ?? []) {
					const snapshot = snapshots.find(
						(value) =>
							value.generation === generation.generation && value.width === comparison.width,
					);
					const exactScreen =
						JSON.stringify(snapshot?.rows) === JSON.stringify(cleanExact(comparison.rendered));
					const structuralRows = clean(comparison.rendered).filter((row) =>
						/^(?:│|┆|├─|└─)/.test(row.trimStart()),
					);
					const labels = structuralRows.slice(1);
					const expectedFirst = mode === "rail" ? "PTY label 1" : "PTY label 4";
					const expectedFinal = generation.active
						? mode === "rail"
							? "│ • PTY label 8"
							: "└─ • PTY label 8"
						: mode === "rail"
							? "│ PTY label 8"
							: "└─ · PTY label 8";
					const predicates = {
						snapshotPresent: Boolean(snapshot),
						exactScreen,
						exactNativeLabels: comparison.exactNativeLabels === true,
						linkSemantics: comparison.linkSemantics === true,
						croppedWithEllipsis: comparison.croppedWithEllipsis === true,
						structuralRowCount: structuralRows.length === (mode === "rail" ? 9 : 6),
						oneTitle: structuralRows.filter((row) => row.includes("Thinking")).length === 1,
						labelCount: labels.length === (mode === "rail" ? 8 : 5),
						firstLabel: labels[0]?.includes(expectedFirst) === true,
						finalLabel: labels.at(-1)?.includes(expectedFinal) === true,
						nonemptyLabels: !labels.some((row) => row.trim().length === 0),
					};
					if (!Object.values(predicates).every(Boolean)) {
						generationFailure = {
							generation: generation.generation,
							width: comparison.width,
							linkCapability: comparison.linkCapability,
							predicates,
							structuralRows,
							actualLabels: comparison.actualLabels,
							expectedLabels: comparison.expectedLabels,
							snapshot: snapshot?.rows,
						};
						break;
					}
				}
				if (generationFailure) break;
			}
			const expectedThemeStates = [
				["current", true],
				["current", false],
				["dark", true],
				["dark", false],
				["light", true],
				["light", false],
			];
			const hiddenExact = structural?.hidden80;
			const nativeHiddenExact = structural?.nativeHidden80;
			const hiddenMatchesNativeByteForByte =
				Array.isArray(hiddenExact) &&
				Array.isArray(nativeHiddenExact) &&
				JSON.stringify(hiddenExact) === JSON.stringify(nativeHiddenExact);
			const nativeHiddenHasThinkingLabel =
				Array.isArray(nativeHiddenExact) &&
				nativeHiddenExact.some((row) => row.includes("Thinking..."));
			const hiddenRows = clean(hiddenExact);
			const nativeHiddenRows = clean(nativeHiddenExact);
			const summaryPredicates = {
				probeRecordCount: modeProbes.length === 2,
				ready: structural?.ready === true,
				installed: structural?.installed === true,
				wrapperCallCount: structural?.wrapperCalls === 1,
				forwardedArgumentCount: modeCall?.count === (oldContract ? 1 : 2),
				forwardedMessageIdentity: modeCall?.messageIdentity === true,
				generationCount: generations.length === 6,
				snapshotCount: snapshots.length === 12,
				themeAndActivityOrder:
					JSON.stringify(generations.map(({ themeName, active }) => [themeName, active])) ===
					JSON.stringify(expectedThemeStates),
				generationsValid: !generationFailure,
				hiddenHasNoStructuralLabels: !hiddenRows.some((row) => row.includes("PTY label")),
				hiddenMatchesNativeByteForByte,
				nativeHiddenHasThinkingLabel,
				hiddenStatePreserved: structural?.hiddenStatePreserved === true,
				width20Rendered: completedStructural?.structuralWidths?.includes(20) === true,
				width80Rendered: completedStructural?.structuralWidths?.includes(80) === true,
				descriptorRestored:
					completedStructural?.restored === true &&
					completedStructural?.descriptorEvidence?.all === true &&
					Object.values(completedStructural?.descriptorEvidence?.fields ?? {}).every(Boolean),
				widgetRemoved:
					completedStructural?.widgetRemoved === true &&
					completedStructural?.widgetOwnershipCount === 0,
			};
			if (!Object.values(summaryPredicates).every(Boolean)) {
				console.error(
					`ZENTUI_STRUCTURAL_DIAGNOSTIC ${boundedJson({
						version: runtimeVersion,
						mode,
						summaryPredicates,
						generationFailure,
						state: {
							modeCall,
							themeStates: generations.map(({ themeName, active }) => [themeName, active]),
							snapshotKeys: snapshots.map(({ generation, width }) => [generation, width]),
							hiddenRows,
							nativeHiddenRows,
							structuralWidths: completedStructural?.structuralWidths,
						},
					})}`,
				);
				throw new Error(`Pi ${version} ${mode} structural probe failed; see diagnostic above`);
			}
			const screenArrays = snapshots.map(({ generation, width, rows }) => ({
				generation,
				width,
				rows,
			}));
			const linkCapabilities = [
				...new Set(
					generations.flatMap((generation) =>
						generation.comparisons.map((comparison) => comparison.linkCapability),
					),
				),
			];
			console.log(
				`${runtimeVersion} ${mode}: private-wrapper=exact args=${modeCall.count}:${String(modeCall.isStreaming)} contiguous-run=one-title labels=${mode === "rail" ? "all-8" : "latest-5"} exact-screen=${JSON.stringify(screenArrays)} ansi=current/dark/light:host-Markdown-exact+connector-accent-only links=${linkCapabilities.join("+")}:preserved width=20/80 ellipsis=yes active->settled=yes hidden=native-byte-exact:${JSON.stringify(hiddenExact)} label=Thinking... descriptor=${JSON.stringify(completedStructural.descriptorEvidence.fields)} process-group=gone`,
			);
		}

		assertNoTransientArtifacts(version, "normal PTY cases", versionRoot, agentDir, home);

		if (runtimeVersion === "0.84.4") {
			writeFileSync(
				join(agentDir, "zentui.json"),
				JSON.stringify({
					components: {
						thinkingSteps: { enabled: true, mode: "streaming" },
						editor: { enabled: false },
						userMessages: { enabled: false },
						workingLine: { enabled: false },
						selectorBorders: { enabled: false },
						footer: { style: "native" },
					},
				}),
			);
			const fullscreenProbePath = join(versionRoot, "probe-fullscreen.jsonl");
			const fullscreenSupervisorPath = join(versionRoot, "supervisor-fullscreen.json");
			const fullscreen = await runDriver(
				python,
				[...command, "--tui-mode", "fullscreen"],
				{
					...environment,
					ZENTUI_PROBE_PATH: fullscreenProbePath,
					ZENTUI_SUPERVISOR_PATH: fullscreenSupervisorPath,
				},
				versionRoot,
			);
			const fullscreenPairs = fullscreen.transitionSequence?.map(({ from, to }) => [from, to]);
			const fullscreenProbes = readFileSync(fullscreenProbePath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			const fullscreenShutdown = fullscreenProbes.at(-1);
			const fullscreenTransitionsValid = fullscreen.transitionSequence?.every((transition) => {
				const expected = transition.mode === "streaming" ? 1 : 0;
				const resources = transition.screen
					.split("\n")
					.map((row) => row.trim())
					.filter((row) => /^__ZENTUI_RESOURCES__ input=\d+ timer=\d+$/.test(row));
				const parsed = resources[0]?.match(/^__ZENTUI_RESOURCES__ input=(\d+) timer=(\d+)$/);
				const rows = extractSentinelRows(transition.screen, transitionStart, transitionEnd);
				const expectedRows =
					transition.mode === "tree"
						? expectedTreeTransitionRows
						: transition.mode === "rail"
							? expectedRailTransitionRows
							: undefined;
				return (
					transition.settingsScreen.split("\n").some((row) => row.trim() === transition.status) &&
					resources.length === 1 &&
					Number(parsed?.[1]) === expected &&
					Number(parsed?.[2]) === expected &&
					(expectedRows
						? JSON.stringify(rows) === JSON.stringify(expectedRows)
						: rows.some((row) => /^ Thinking \d+\.\d+s {2}\(ctrl\+t to expand\)$/.test(row)))
				);
			});
			if (
				fullscreen.exit !== 0 ||
				fullscreen.groupAlive ||
				hasExtensionLoaderDiagnostic(fullscreen.raw) ||
				JSON.stringify(fullscreenPairs) !== JSON.stringify(expectedTransitionPairs) ||
				fullscreenTransitionsValid !== true ||
				fullscreenShutdown?.restored !== true ||
				fullscreenShutdown?.widgetRemoved !== true ||
				fullscreenShutdown?.widgetOwnershipCount !== 0 ||
				fullscreenShutdown?.descriptorEvidence?.all !== true ||
				!Object.values(fullscreenShutdown?.descriptorEvidence?.fields ?? {}).every(Boolean) ||
				JSON.stringify(
					fullscreen.folded
						.split("\n")
						.map((row) => row.trim())
						.filter((row) => /^__ZENTUI_RESOURCES__ input=\d+ timer=\d+$/.test(row)),
				) !== JSON.stringify(["__ZENTUI_RESOURCES__ input=1 timer=1"])
			)
				throw new Error(
					`Pi 0.84.4 fullscreen live transition smoke failed: ${boundedJson({ fullscreenPairs, fullscreenTransitionsValid, fullscreenShutdown, exit: fullscreen.exit, groupAlive: fullscreen.groupAlive })}`,
				);
			writeFileSync(
				join(agentDir, "zentui.json"),
				JSON.stringify({
					components: {
						thinkingSteps: { enabled: true, mode: "streaming" },
						editor: { enabled: false },
						userMessages: { enabled: false },
						workingLine: { enabled: false },
						selectorBorders: { enabled: false },
						footer: { style: "native" },
					},
				}),
			);
			const fullscreenActiveProbePath = join(versionRoot, "probe-fullscreen-active-shutdown.jsonl");
			const fullscreenActiveSupervisorPath = join(
				versionRoot,
				"supervisor-fullscreen-active-shutdown.json",
			);
			const fullscreenActive = await runDriver(
				python,
				[...command, "--tui-mode", "fullscreen"],
				{
					...environment,
					ZENTUI_PROBE_PATH: fullscreenActiveProbePath,
					ZENTUI_SUPERVISOR_PATH: fullscreenActiveSupervisorPath,
					ZENTUI_ACTIVE_STREAMING_SHUTDOWN: "1",
				},
				versionRoot,
			);
			const fullscreenActiveProbes = readFileSync(fullscreenActiveProbePath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			const fullscreenActiveFinal = fullscreenActiveProbes.at(-1);
			if (
				fullscreenActive.exit !== 0 ||
				fullscreenActive.groupAlive ||
				hasExtensionLoaderDiagnostic(fullscreenActive.raw) ||
				(fullscreenActive.transitionSequence?.length ?? -1) !== 0 ||
				fullscreenActiveFinal?.controllerResources?.inputs !== 0 ||
				fullscreenActiveFinal?.controllerResources?.timers !== 0 ||
				fullscreenActiveFinal?.restored !== true ||
				fullscreenActiveFinal?.descriptorEvidence?.all !== true ||
				!Object.values(fullscreenActiveFinal?.descriptorEvidence?.fields ?? {}).every(Boolean) ||
				fullscreenActiveFinal?.widgetRemoved !== true ||
				fullscreenActiveFinal?.widgetOwnershipCount !== 0
			)
				throw new Error(
					`Pi 0.84.4 fullscreen active Streaming shutdown failed: ${boundedJson({ transitions: fullscreenActive.transitionSequence, fullscreenActiveFinal, exit: fullscreenActive.exit, groupAlive: fullscreenActive.groupAlive })}`,
				);
			assertNoTransientArtifacts(version, "fullscreen PTY cases", versionRoot, agentDir, home);
			console.log(
				`0.84.4 fullscreen: live=Streaming->Tree,Tree->Rail entering-Streaming=restart-only rows/status/resources=exact active-Streaming-EOF=1/1->${fullscreenActiveFinal.controllerResources.inputs}/${fullscreenActiveFinal.controllerResources.timers} descriptor=${JSON.stringify(fullscreenActiveFinal.descriptorEvidence.fields)} widget-ownership=0 process-group=gone artifacts=none`,
			);
		}

		console.log(
			`${runtimeVersion}: measured=${JSON.stringify(attestation.versions)} live=Thinking sentinel-rows=${JSON.stringify(extractedLiveRows)} header-index=${extractedLiveHeaderIndexes[0]} native-tail=${JSON.stringify(expectedScreenTail)} exact=5/5 wrapped=row4-continuation+rows5-8 args=${call.count}:${String(call.isStreaming)} wrapperCalls=${live.wrapperCalls} identities=exact ordered-collisions=thinking2+text1/equal1+text1 contiguous=${runtimeVersion === "0.80.5" ? "legacy2" : "coalesced1"} tool-separated=2 binding=validated-ctrl+t descriptor=${JSON.stringify(probes.at(-1).descriptorEvidence.fields)} restored-completed=Thought folded=${JSON.stringify(foldedCompletedRows)} expanded=${JSON.stringify(expandedCompletedRows)} refolded=${JSON.stringify(refoldedCompletedRows)} live-transitions=Streaming->Tree,Tree->Rail entering-Streaming=restart-only states/resources=${JSON.stringify(result.transitionSequence.map(({ from, to, status, resources }) => ({ from, to, status, resources })))} tree=${JSON.stringify(treeTransitionRows)} rail=${JSON.stringify(railTransitionRows)} hidden-start=preserved widget=removed artifacts=none handshake=${result.supervisor.handshake} cleanup-signals=${JSON.stringify(result.supervisor.cleanupSignals ?? [])} python=${result.supervisor.pythonPid}:reaped pi=${result.supervisor.piPid}:reaped group=${result.supervisor.piPgid}:gone`,
		);
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
