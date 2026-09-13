import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mergeConfig, type PolishedTuiConfig } from "../extensions/zentui/config";

const settings = vi.hoisted(() => ({ config: undefined as PolishedTuiConfig | undefined }));
vi.mock("../extensions/zentui/config", async (original) => ({
	...(await original<typeof import("../extensions/zentui/config")>()),
	loadConfig: () => settings.config,
	ensureConfigExists() {},
}));
vi.mock("../extensions/zentui/telemetry", () => ({ resolveFooterTelemetry: () => ({}) }));
vi.mock("../extensions/zentui/git", async (original) => {
	const actual = await original<typeof import("../extensions/zentui/git")>();
	return {
		...actual,
		readGitStatus: async () => ({ kind: "ok", status: actual.emptyGitStatus() }),
	};
});
vi.mock("../extensions/zentui/runtime", () => ({ readRuntimeInfo: async () => ({ kind: "ok" }) }));
vi.mock("../extensions/zentui/accent-rail-layout-patch", async (original) => ({
	...(await original<typeof import("../extensions/zentui/accent-rail-layout-patch")>()),
	retainAccentRailLayoutPatchInstallation: async () => "retained",
}));

import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
let handlers: Map<string, Handler[]>;
let ctx: ExtensionContext;
let http: ReturnType<typeof vi.fn>;
let auth: ReturnType<typeof vi.fn>;
let editorFactory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
let footer: { render(width: number): string[]; dispose?(): void } | undefined;
const emit = async (name: string) => {
	for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
};
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
	vi.useFakeTimers();
	settings.config = mergeConfig({
		projectRefreshIntervalMs: 0,
		components: {
			editor: { enabled: false, style: "minimalist" },
			footer: { style: "native" },
			userMessages: { enabled: false },
			selectorBorders: { enabled: false },
		},
	});
	http = vi.fn(async () =>
		Response.json({
			rate_limit: {
				primary_window: { used_percent: 20, limit_window_seconds: 18_000 },
				secondary_window: { used_percent: 40, limit_window_seconds: 604_800 },
			},
		}),
	);
	vi.stubGlobal("fetch", http);
	auth = vi.fn(async () => ({ auth: { apiKey: "synthetic-token" } }));
	editorFactory = undefined;
	footer = undefined;
	const theme = { fg: (_color: string, text: string) => text } as Theme;
	ctx = {
		hasUI: true,
		mode: "tui",
		cwd: "/tmp",
		model: { id: "gpt-codex", provider: "openai-codex", contextWindow: 200000 },
		modelRegistry: { getProviderAuth: auth },
		getContextUsage: () => undefined,
		sessionManager: { getBranch: () => [], getSessionName: () => undefined },
		ui: {
			theme,
			getEditorText: () => "prompt",
			setEditorText() {},
			getEditorComponent: () => editorFactory,
			setEditorComponent(value: typeof editorFactory) {
				editorFactory = value;
			},
			setFooter(factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0]) {
				footer?.dispose?.();
				footer = factory?.({ requestRender() {} } as never, theme, {
					onBranchChange: () => () => {},
					getExtensionStatuses: () => new Map(),
				} as never);
			},
		},
	} as unknown as ExtensionContext;
	handlers = new Map();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel: () => "off",
	} as never);
});
afterEach(async () => {
	await emit("session_shutdown");
	expect(vi.getTimerCount()).toBe(0);
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it.each(["editor", "footer", "both"])(
	"shares collection for %s without requiring another surface",
	async (consumer) => {
		const config = settings.config as PolishedTuiConfig;
		if (consumer !== "footer")
			Object.assign(config.components.editor, { enabled: true, codexQuota: true });
		if (consumer !== "editor")
			Object.assign(config.components.footer, { style: "starship", codexQuota: true });
		else config.components.footer.style = "hidden";
		await emit("session_start");
		await flush();
		expect(http).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(http).toHaveBeenCalledTimes(2);
		if (consumer === "editor") expect(footer?.render(120)).toEqual([]);
		else expect(footer?.render(160).join("\n")).toContain("5h 80% | week 60%");
		if (consumer === "footer") expect(editorFactory).toBeUndefined();
		config.components.editor.codexQuota = false;
		await emit("model_select");
		await vi.advanceTimersByTimeAsync(60_000);
		expect(http).toHaveBeenCalledTimes(consumer === "editor" ? 2 : 3);
		config.components.footer.codexQuota = false;
		await emit("model_select");
		await vi.advanceTimersByTimeAsync(120_000);
		expect(http).toHaveBeenCalledTimes(consumer === "editor" ? 2 : 3);
	},
);

it.each(["print", "json", "rpc"])("does not collect in %s mode", async (mode) => {
	Object.assign((settings.config as PolishedTuiConfig).components.editor, {
		enabled: true,
		codexQuota: true,
	});
	Object.assign(ctx, { mode, hasUI: mode === "rpc" });
	await emit("session_start");
	await flush();
	expect(auth).not.toHaveBeenCalled();
	expect(http).not.toHaveBeenCalled();
});

it("does not collect with defaults or custom templates lacking the exact token", async () => {
	await emit("session_start");
	await flush();
	expect(auth).not.toHaveBeenCalled();
	await emit("session_shutdown");
	const config = settings.config as PolishedTuiConfig;
	Object.assign(config.components.editor, { enabled: true, codexQuota: true, style: "opencode" });
	config.components.editor.styles.opencode.metadataFormat = "$model $codex_quota_other";
	Object.assign(config.components.footer, { style: "starship", codexQuota: true });
	config.components.footer.styles.starship.format = "$cwd";
	config.components.footer.styles.starship.compactFormat = "$tokens";
	await emit("session_start");
	await flush();
	expect(auth).not.toHaveBeenCalled();
	config.components.footer.styles.starship.compactFormat = `\${codex_quota}`;
	await emit("model_select");
	await flush();
	expect(http).toHaveBeenCalledOnce();
});

it("does not collect with a missing model and clears quota when the model disappears", async () => {
	Object.assign((settings.config as PolishedTuiConfig).components.footer, {
		style: "starship",
		codexQuota: true,
	});
	const model = ctx.model;
	Object.assign(ctx, { model: undefined });
	await emit("session_start");
	await flush();
	expect(auth).not.toHaveBeenCalled();
	expect(footer?.render(160).join("\n")).not.toContain("5h");
	Object.assign(ctx, { model });
	await emit("model_select");
	await flush();
	expect(http).toHaveBeenCalledOnce();
	Object.assign(ctx, { model: undefined });
	await emit("model_select");
	await vi.advanceTimersByTimeAsync(120_000);
	expect(http).toHaveBeenCalledOnce();
	expect(footer?.render(160).join("\n")).not.toContain("5h");
});

it("reconciles quota demand across live editor styles with Native Footer", async () => {
	const editor = (settings.config as PolishedTuiConfig).components.editor;
	Object.assign(editor, { enabled: true, codexQuota: true });
	editor.styles.opencode.metadataFormat = "$model";
	await emit("session_start");
	await flush();
	const ownedFactory = editorFactory;
	expect(ownedFactory).toBeDefined();
	expect(footer).toBeUndefined();
	expect(http).toHaveBeenCalledOnce();
	editor.style = "opencode";
	await emit("model_select");
	await vi.advanceTimersByTimeAsync(120_000);
	expect(http).toHaveBeenCalledOnce();
	for (const style of ["opencode-copy-friendly", "accent-rail", "minimalist"] as const) {
		editor.style = style;
		await emit("model_select");
		await flush();
		expect(editorFactory).toBe(ownedFactory);
		expect(http).toHaveBeenCalledTimes(2);
	}
	await vi.advanceTimersByTimeAsync(60_000);
	expect(http).toHaveBeenCalledTimes(3);
	editor.style = "opencode-copy-friendly";
	editor.styles[editor.style].metadataFormat = "$model";
	await emit("model_select");
	await vi.advanceTimersByTimeAsync(120_000);
	expect(http).toHaveBeenCalledTimes(3);
});

it("stops for other providers, clears cache, and starts fresh on return/new session", async () => {
	Object.assign((settings.config as PolishedTuiConfig).components.footer, {
		style: "starship",
		codexQuota: true,
	});
	Object.assign(ctx.model as object, { provider: "openai" });
	await emit("session_start");
	await flush();
	expect(auth).not.toHaveBeenCalled();
	Object.assign(ctx.model as object, { provider: "openai-codex" });
	await emit("model_select");
	await flush();
	expect(http).toHaveBeenCalledOnce();
	Object.assign(ctx.model as object, { provider: "custom-codex-proxy" });
	await emit("model_select");
	expect(footer?.render(160).join("\n")).not.toContain("5h");
	await vi.advanceTimersByTimeAsync(120_000);
	expect(http).toHaveBeenCalledOnce();
	Object.assign(ctx.model as object, { provider: "openai-codex" });
	http.mockRejectedValueOnce(new Error("offline"));
	await emit("model_select");
	await flush();
	expect(footer?.render(160).join("\n")).toContain("5h -- | week --");
	await emit("session_shutdown");
	await emit("session_start");
	await flush();
	expect(http).toHaveBeenCalledTimes(3);
});

it.each(["editor", "footer"])("releases collection on loss of %s ownership", async (consumer) => {
	const config = settings.config as PolishedTuiConfig;
	if (consumer === "editor")
		Object.assign(config.components.editor, { enabled: true, codexQuota: true });
	else Object.assign(config.components.footer, { style: "starship", codexQuota: true });
	await emit("session_start");
	await flush();
	expect(http).toHaveBeenCalledOnce();
	if (consumer === "editor") editorFactory = undefined;
	else footer?.dispose?.();
	await vi.advanceTimersByTimeAsync(120_000);
	expect(http).toHaveBeenCalledOnce();
});
