import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolishedTuiConfig } from "../extensions/zentui/config";

const mocks = vi.hoisted(() => ({
	config: undefined as unknown as PolishedTuiConfig,
	readGitStatus: vi.fn(),
	readRuntimeInfo: vi.fn(),
	readPackageVersionResult: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return {
		...actual,
		getSettingsListTheme: () => ({
			label: (text: string) => text,
			value: (text: string) => text,
			description: (text: string) => text,
			cursor: "> ",
			hint: (text: string) => text,
		}),
	};
});

vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	return {
		...actual,
		ensureConfigExists: () => {},
		loadConfig: () => mocks.config,
		saveFooterFormatPatch(value: string) {
			mocks.config = { ...mocks.config, footerFormat: value };
			return mocks.config;
		},
		saveFooterSegmentsPatch(patch: Record<string, boolean>) {
			mocks.config = {
				...mocks.config,
				footerSegments: { ...mocks.config.footerSegments, ...patch },
			};
			return mocks.config;
		},
		saveResponsiveFooterPatch(patch: Record<string, unknown>) {
			mocks.config = { ...mocks.config, ...patch };
			return mocks.config;
		},
	};
});

vi.mock("../extensions/zentui/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/git")>();
	mocks.readGitStatus.mockImplementation(async () => actual.emptyGitStatus());
	return { ...actual, readGitStatus: mocks.readGitStatus };
});
vi.mock("../extensions/zentui/runtime", () => ({ readRuntimeInfo: mocks.readRuntimeInfo }));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: mocks.readPackageVersionResult,
}));

import { defaultConfig } from "../extensions/zentui/config";
import zentui from "../extensions/zentui/index";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;
type Command = { handler: (args: string, ctx: unknown) => Promise<void> };

function makeTheme(): Theme {
	return {
		fg(_color: string, text: string) {
			return text;
		},
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
}

function loadExtension() {
	const handlers = new Map<string, Handler[]>();
	let command: Command | undefined;
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand(name: string, options: Command) {
			if (name === "zentui") command = options;
		},
		getThinkingLevel: () => "off",
	} as never);
	if (!command) throw new Error("zentui command was not registered");
	return { handlers, command };
}

async function emit(handlers: Map<string, Handler[]>, name: string, ctx: unknown) {
	for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
}

async function settleProjectRefresh() {
	for (let index = 0; index < 8; index++) await Promise.resolve();
}

function createContext(custom?: (factory: (...args: unknown[]) => unknown) => Promise<void>) {
	let footerFactory: unknown;
	let editorFactory: unknown;
	const theme = makeTheme();
	return {
		hasUI: true,
		mode: "tui",
		cwd: "/tmp/responsive-dependencies",
		model: { id: "test", provider: "test", contextWindow: 100_000 },
		getContextUsage: () => ({ tokens: 1, contextWindow: 100_000, percent: 1 }),
		sessionManager: {
			getBranch: () => [],
			getEntries: () => [],
			getSessionName: () => undefined,
		},
		ui: {
			theme,
			setFooter(factory: unknown) {
				footerFactory = factory;
			},
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			getEditorComponent: () => editorFactory,
			notify() {},
			custom,
		},
		get footerFactory() {
			return footerFactory;
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	mocks.config = {
		...defaultConfig,
		features: { ...defaultConfig.features, editor: false, statusLine: true },
		projectRefreshIntervalMs: 0,
		footerFormat: "$cwd",
		responsiveFooter: false,
		compactFooterFormat: "$package",
	};
	mocks.readGitStatus.mockClear();
	mocks.readRuntimeInfo.mockReset().mockResolvedValue(undefined);
	mocks.readPackageVersionResult.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("responsive footer dependency reconciliation", () => {
	it("refreshes newly active format probes with polling disabled and skips unchanged unions", async () => {
		const { handlers, command } = loadExtension();
		const ctx = createContext();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).not.toHaveBeenCalled();

		const gitReads = mocks.readGitStatus.mock.calls.length;
		await command.handler('format "$directory"', ctx);
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(gitReads);

		await command.handler('format "$package"', ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledOnce();
	});

	it("refreshes compact-only probes immediately when responsiveness is enabled", async () => {
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput?: (data: string) => void;
			};
			component.handleInput?.("\t");
			component.handleInput?.("\t");
			component.handleInput?.(" ");
		});
		const { handlers, command } = loadExtension();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).not.toHaveBeenCalled();
		await command.handler("", ctx);
		await settleProjectRefresh();
		expect(mocks.config.responsiveFooter).toBe(true);
		expect(mocks.readPackageVersionResult).toHaveBeenCalledOnce();
	});

	it("refreshes probes activated by built-in segment settings", async () => {
		mocks.config = { ...mocks.config, footerFormat: "", compactFooterFormat: "$cwd" };
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput?: (data: string) => void;
			};
			component.handleInput?.("\t");
			component.handleInput?.("\t");
			component.handleInput?.("\t");
			for (let index = 0; index < 13; index++) component.handleInput?.("\x1b[B");
			component.handleInput?.(" ");
		});
		const { handlers, command } = loadExtension();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).not.toHaveBeenCalled();
		await command.handler("", ctx);
		await settleProjectRefresh();
		expect(mocks.config.footerSegments.packageVersion).toBe(true);
		expect(mocks.readPackageVersionResult).toHaveBeenCalledOnce();
	});

	it("does not refresh when only the compact row limit changes", async () => {
		mocks.config = { ...mocks.config, responsiveFooter: true };
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput?: (data: string) => void;
			};
			component.handleInput?.("\t");
			component.handleInput?.("\t");
			component.handleInput?.("\x1b[B");
			component.handleInput?.(" ");
		});
		const { handlers, command } = loadExtension();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		const gitReads = mocks.readGitStatus.mock.calls.length;
		await command.handler("", ctx);
		await settleProjectRefresh();
		expect(mocks.config.compactFooterMaxLines).toBe(3);
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(gitReads);
	});

	it("installs exactly one timer only while active candidates require time or duration", async () => {
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
		const { handlers, command } = loadExtension();
		const ctx = createContext();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(setIntervalSpy).not.toHaveBeenCalled();

		await command.handler('format "$time"', ctx);
		expect(setIntervalSpy).toHaveBeenCalledTimes(1);
		await command.handler('format "$duration"', ctx);
		expect(setIntervalSpy).toHaveBeenCalledTimes(2);
		expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
		await command.handler('format "$cwd"', ctx);
		expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

		await emit(handlers, "session_shutdown", ctx);
		expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
	});
});
