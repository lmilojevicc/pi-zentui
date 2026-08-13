import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolishedTuiConfig } from "../extensions/zentui/config";
import { emptyGitStatus, type GitReadResult } from "../extensions/zentui/git";

const mocks = vi.hoisted(() => ({
	config: undefined as unknown as PolishedTuiConfig,
	readGitStatus: vi.fn(),
	readRuntimeInfo: vi.fn(),
	readPackageVersionResult: vi.fn(),
	syncState: vi.fn(),
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
		saveEditorComponentPatch(patch: Record<string, unknown>) {
			mocks.config = {
				...mocks.config,
				components: {
					...mocks.config.components,
					editor: { ...mocks.config.components.editor, ...patch },
				},
				...(patch.modelLabel === undefined
					? {}
					: { editorModelLabel: patch.modelLabel as "id" | "name" }),
			};
			return mocks.config;
		},
		saveFooterComponentPatch(patch: Record<string, unknown>) {
			const footer = mocks.config.components.footer;
			mocks.config = {
				...mocks.config,
				components: {
					...mocks.config.components,
					footer: { ...footer, ...patch },
				},
			};
			return mocks.config;
		},
		saveStarshipFooterStylePatch(patch: Record<string, unknown>) {
			const footer = mocks.config.components.footer;
			const starship = footer.styles.starship;
			const nextStarship = {
				...starship,
				...patch,
				...(patch.segments
					? { segments: { ...starship.segments, ...(patch.segments as object) } }
					: {}),
				...(patch.gitCommit
					? { gitCommit: { ...starship.gitCommit, ...(patch.gitCommit as object) } }
					: {}),
				...(patch.gitMetrics
					? { gitMetrics: { ...starship.gitMetrics, ...(patch.gitMetrics as object) } }
					: {}),
			};
			mocks.config = {
				...mocks.config,
				...(patch.format === undefined ? {} : { footerFormat: patch.format as string }),
				...(patch.responsive === undefined
					? {}
					: { responsiveFooter: patch.responsive as boolean }),
				...(patch.compactMaxLines === undefined
					? {}
					: { compactFooterMaxLines: patch.compactMaxLines as 1 | 2 | 3 | "unlimited" }),
				...(patch.segments === undefined ? {} : { footerSegments: nextStarship.segments }),
				...(patch.gitCommit === undefined ? {} : { gitCommit: nextStarship.gitCommit }),
				...(patch.gitMetrics === undefined ? {} : { gitMetrics: nextStarship.gitMetrics }),
				components: {
					...mocks.config.components,
					footer: { ...footer, styles: { starship: nextStarship } },
				},
			};
			return mocks.config;
		},
		saveEditorModelLabel(value: "id" | "name") {
			mocks.config = {
				...mocks.config,
				editorModelLabel: value,
				components: {
					...mocks.config.components,
					editor: { ...mocks.config.components.editor, modelLabel: value },
					footer: { ...mocks.config.components.footer, modelLabel: value },
				},
			};
			return mocks.config;
		},
		saveFooterFormatPatch(value: string) {
			const footer = mocks.config.components.footer;
			mocks.config = {
				...mocks.config,
				footerFormat: value,
				components: {
					...mocks.config.components,
					footer: {
						...footer,
						styles: { starship: { ...footer.styles.starship, format: value } },
					},
				},
			};
			return mocks.config;
		},
		saveFooterSegmentsPatch(patch: Record<string, boolean>) {
			const footer = mocks.config.components.footer;
			mocks.config = {
				...mocks.config,
				footerSegments: { ...mocks.config.footerSegments, ...patch },
				components: {
					...mocks.config.components,
					footer: {
						...footer,
						styles: {
							starship: {
								...footer.styles.starship,
								segments: { ...footer.styles.starship.segments, ...patch },
							},
						},
					},
				},
			};
			return mocks.config;
		},
		saveResponsiveFooterPatch(patch: Record<string, unknown>) {
			const footer = mocks.config.components.footer;
			mocks.config = {
				...mocks.config,
				...patch,
				components: {
					...mocks.config.components,
					footer: {
						...footer,
						styles: {
							starship: {
								...footer.styles.starship,
								...(patch.responsiveFooter === undefined
									? {}
									: { responsive: patch.responsiveFooter as boolean }),
								...(patch.compactFooterMaxLines === undefined
									? {}
									: {
											compactMaxLines: patch.compactFooterMaxLines as 1 | 2 | 3 | "unlimited",
										}),
							},
						},
					},
				},
			};
			return mocks.config;
		},
		saveGitCommitPatch(patch: Record<string, boolean>) {
			const footer = mocks.config.components.footer;
			mocks.config = {
				...mocks.config,
				gitCommit: { ...mocks.config.gitCommit, ...patch },
				components: {
					...mocks.config.components,
					footer: {
						...footer,
						styles: {
							starship: {
								...footer.styles.starship,
								gitCommit: { ...footer.styles.starship.gitCommit, ...patch },
							},
						},
					},
				},
			};
			return mocks.config;
		},
		saveGitMetricsPatch(patch: Record<string, boolean>) {
			const footer = mocks.config.components.footer;
			mocks.config = {
				...mocks.config,
				gitMetrics: { ...mocks.config.gitMetrics, ...patch },
				components: {
					...mocks.config.components,
					footer: {
						...footer,
						styles: {
							starship: {
								...footer.styles.starship,
								gitMetrics: { ...footer.styles.starship.gitMetrics, ...patch },
							},
						},
					},
				},
			};
			return mocks.config;
		},
	};
});

vi.mock("../extensions/zentui/git", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/git")>();
	mocks.readGitStatus.mockImplementation(async () => ({
		kind: "ok" as const,
		status: actual.emptyGitStatus(),
	}));
	return { ...actual, readGitStatus: mocks.readGitStatus };
});
vi.mock("../extensions/zentui/runtime", () => ({ readRuntimeInfo: mocks.readRuntimeInfo }));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: mocks.readPackageVersionResult,
}));
vi.mock("../extensions/zentui/state", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/state")>();
	return {
		...actual,
		syncState(...args: Parameters<typeof actual.syncState>) {
			mocks.syncState(...args);
			return actual.syncState(...args);
		},
	};
});

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

function updateStarship(
	patch: Partial<PolishedTuiConfig["components"]["footer"]["styles"]["starship"]>,
) {
	const footer = mocks.config.components.footer;
	mocks.config = {
		...mocks.config,
		components: {
			...mocks.config.components,
			footer: {
				...footer,
				styles: { starship: { ...footer.styles.starship, ...patch } },
			},
		},
	};
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
			getEditorText: () => "",
			setEditorText() {},
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
	const footer = defaultConfig.components.footer;
	mocks.config = {
		...defaultConfig,
		features: { ...defaultConfig.features, editor: false, statusLine: true },
		components: {
			...defaultConfig.components,
			editor: { ...defaultConfig.components.editor, enabled: false },
			footer: {
				...footer,
				style: "starship",
				styles: {
					starship: {
						...footer.styles.starship,
						format: "$cwd",
						responsive: false,
						compactFormat: "$package",
					},
				},
			},
		},
		projectRefreshIntervalMs: 0,
		footerFormat: "$cwd",
		responsiveFooter: false,
		compactFooterFormat: "$package",
	};
	mocks.readGitStatus.mockClear();
	mocks.readRuntimeInfo.mockReset().mockResolvedValue({ kind: "ok", runtime: undefined });
	mocks.readPackageVersionResult.mockReset().mockResolvedValue({ kind: "ok", result: null });
	mocks.syncState.mockClear();
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
		expect(mocks.readRuntimeInfo).not.toHaveBeenCalled();

		const gitReads = mocks.readGitStatus.mock.calls.length;
		await command.handler('format "$directory"', ctx);
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(gitReads);

		await command.handler('format "$package"', ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledOnce();
	});

	it("clears package state when its reference deactivates before a failed re-enable", async () => {
		updateStarship({ format: "$package", responsive: false });
		mocks.readPackageVersionResult.mockResolvedValueOnce({
			kind: "ok",
			result: { ecosystem: "nodejs", version: "1.2.3" },
		});
		const { handlers, command } = loadExtension();
		const ctx = createContext();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		const state = mocks.syncState.mock.calls[0]?.[0] as {
			packageVersion?: { ecosystem: string; version: string };
		};
		expect(state.packageVersion).toEqual({ ecosystem: "nodejs", version: "1.2.3" });

		await command.handler('format "$cwd"', ctx);
		await settleProjectRefresh();
		expect(state.packageVersion).toBeUndefined();

		mocks.readPackageVersionResult.mockResolvedValue({ kind: "error" });
		await command.handler('format "$package"', ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledTimes(2);
		expect(state.packageVersion).toBeUndefined();
	});

	it("invalidates an in-flight package read across remove and failed re-enable", async () => {
		updateStarship({ format: "$package", responsive: false });
		let resolveObsoleteRead:
			| ((value: { kind: "ok"; result: { ecosystem: string; version: string } }) => void)
			| undefined;
		mocks.readPackageVersionResult
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveObsoleteRead = resolve;
					}),
			)
			.mockResolvedValueOnce({ kind: "error" });
		const { handlers, command } = loadExtension();
		const ctx = createContext();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledOnce();

		const state = mocks.syncState.mock.calls[0]?.[0] as {
			packageVersion?: { ecosystem: string; version: string };
		};
		await command.handler('format "$cwd"', ctx);
		await settleProjectRefresh();
		expect(state.packageVersion).toBeUndefined();

		await command.handler('format "$package"', ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledTimes(2);
		expect(state.packageVersion).toBeUndefined();

		resolveObsoleteRead?.({
			kind: "ok",
			result: { ecosystem: "nodejs", version: "9.9.9-obsolete" },
		});
		await settleProjectRefresh();
		expect(state.packageVersion).toBeUndefined();
	});

	it("replaces in-flight Footer probes across live styles while Minimalist keeps refresh active", async () => {
		const editor = mocks.config.components.editor;
		updateStarship({ format: "$package $runtime", responsive: false });
		mocks.config = {
			...mocks.config,
			components: {
				...mocks.config.components,
				editor: {
					...editor,
					enabled: true,
					style: "minimalist",
					styles: {
						...editor.styles,
						minimalist: { ...editor.styles.minimalist, showGit: true },
					},
				},
			},
		};
		let resolveObsoletePackage:
			| ((value: { kind: "ok"; result: { ecosystem: string; version: string } }) => void)
			| undefined;
		let resolveObsoleteRuntime:
			| ((value: {
					kind: "ok";
					runtime: { name: string; symbol: string; style: string; version: string };
			  }) => void)
			| undefined;
		mocks.readPackageVersionResult
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveObsoletePackage = resolve;
					}),
			)
			.mockResolvedValueOnce({ kind: "error" });
		mocks.readRuntimeInfo
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveObsoleteRuntime = resolve;
					}),
			)
			.mockResolvedValueOnce({ kind: "error" });
		const { handlers, command } = loadExtension();
		const ctx = createContext();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledOnce();
		expect(mocks.readRuntimeInfo).toHaveBeenCalledOnce();

		const state = mocks.syncState.mock.calls[0]?.[0] as {
			packageVersion?: { ecosystem: string; version: string };
			runtime?: { name: string; version?: string };
		};
		await command.handler("footer off", ctx);
		await settleProjectRefresh();
		expect(state.packageVersion).toBeUndefined();
		expect(state.runtime).toBeUndefined();

		await command.handler("footer on", ctx);
		await settleProjectRefresh();
		expect(mocks.readPackageVersionResult).toHaveBeenCalledTimes(2);
		expect(mocks.readRuntimeInfo).toHaveBeenCalledTimes(2);
		expect(state.packageVersion).toBeUndefined();
		expect(state.runtime).toBeUndefined();

		resolveObsoletePackage?.({
			kind: "ok",
			result: { ecosystem: "nodejs", version: "9.9.9-obsolete" },
		});
		resolveObsoleteRuntime?.({
			kind: "ok",
			runtime: {
				name: "Obsolete",
				symbol: "O",
				style: "bold red",
				version: "9.9.9-obsolete",
			},
		});
		await settleProjectRefresh();
		expect(state.packageVersion).toBeUndefined();
		expect(state.runtime).toBeUndefined();

		const footerFactory = ctx.footerFactory as
			| ((
					tui: { requestRender(): void },
					theme: Theme,
					data: {
						onBranchChange(callback: () => void): () => void;
						getExtensionStatuses(): Map<string, string>;
					},
			  ) => { render(width: number): string[] })
			| undefined;
		const rendered =
			footerFactory?.({ requestRender() {} }, makeTheme(), {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			})
				.render(120)
				.join("\n") ?? "";
		expect(rendered).not.toContain("9.9.9-obsolete");
		expect(rendered).not.toContain("Obsolete");
	});

	it("probes runtime only while a custom Footer format references it", async () => {
		const { handlers, command } = loadExtension();
		const ctx = createContext();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();
		expect(mocks.readRuntimeInfo).not.toHaveBeenCalled();

		await command.handler('format "$runtime"', ctx);
		await settleProjectRefresh();
		expect(mocks.readRuntimeInfo).toHaveBeenCalledOnce();

		await command.handler('format "$cwd"', ctx);
		await settleProjectRefresh();
		expect(mocks.readRuntimeInfo).toHaveBeenCalledOnce();
	});

	it("counts the enabled built-in runtime segment as an active reference", async () => {
		updateStarship({
			format: "",
			responsive: false,
			segments: { ...mocks.config.components.footer.styles.starship.segments, runtime: true },
		});
		const { handlers } = loadExtension();
		await emit(handlers, "session_start", createContext());
		await settleProjectRefresh();
		expect(mocks.readRuntimeInfo).toHaveBeenCalledOnce();
	});

	it("skips runtime and package probes for Minimalist-only project refreshes", async () => {
		const editor = mocks.config.components.editor;
		const footer = mocks.config.components.footer;
		mocks.config = {
			...mocks.config,
			components: {
				...mocks.config.components,
				editor: {
					...editor,
					enabled: true,
					style: "minimalist",
					styles: {
						...editor.styles,
						minimalist: { ...editor.styles.minimalist, showGit: true },
					},
				},
				footer: { ...footer, style: "native" },
			},
		};
		const { handlers } = loadExtension();
		await emit(handlers, "session_start", createContext());
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledOnce();
		expect(mocks.readRuntimeInfo).not.toHaveBeenCalled();
		expect(mocks.readPackageVersionResult).not.toHaveBeenCalled();
	});

	it("keeps Git state while an obsolete cwd refresh finishes before the queued live cwd", async () => {
		const editor = mocks.config.components.editor;
		const footer = mocks.config.components.footer;
		mocks.config = {
			...mocks.config,
			components: {
				...mocks.config.components,
				editor: {
					...editor,
					enabled: true,
					style: "minimalist",
					styles: {
						...editor.styles,
						minimalist: { ...editor.styles.minimalist, showGit: true },
					},
				},
				footer: { ...footer, style: "native" },
			},
		};

		let resolveObsoleteRead: ((result: GitReadResult) => void) | undefined;
		let resolveLiveRead: ((result: GitReadResult) => void) | undefined;
		mocks.readGitStatus
			.mockResolvedValueOnce({
				kind: "ok",
				status: { ...emptyGitStatus(), branch: "repo-a" },
			})
			.mockImplementationOnce(
				() =>
					new Promise<GitReadResult>((resolve) => {
						resolveObsoleteRead = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<GitReadResult>((resolve) => {
						resolveLiveRead = resolve;
					}),
			);

		const { handlers } = loadExtension();
		const ctx = createContext();
		const repoCwd = "/worktrees/repo-a/nested";
		ctx.cwd = repoCwd;
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();

		const state = mocks.syncState.mock.calls[0]?.[0] as { branch?: string };
		expect(state.branch).toBe("repo-a");

		ctx.cwd = "/tmp/not-a-repo";
		await emit(handlers, "tool_execution_end", ctx);
		vi.advanceTimersByTime(5_000);
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(2);

		ctx.cwd = repoCwd;
		await emit(handlers, "tool_execution_end", ctx);
		resolveObsoleteRead?.({ kind: "not_a_repo" });
		await settleProjectRefresh();

		expect(state.branch).toBe("repo-a");
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(5_000);
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(3);
		expect(state.branch).toBe("repo-a");

		resolveLiveRead?.({
			kind: "ok",
			status: { ...emptyGitStatus(), branch: "repo-a-updated" },
		});
		await settleProjectRefresh();
		expect(state.branch).toBe("repo-a-updated");
	});

	it("refreshes compact-only probes immediately when responsiveness is enabled", async () => {
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput?: (data: string) => void;
			};
			for (let index = 0; index < 4; index++) component.handleInput?.("\t");
			for (let index = 0; index < 3; index++) component.handleInput?.("\x1b[B");
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

	it("immediately resyncs editor state when the model label source changes", async () => {
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				render(width: number): string[];
				handleInput(data: string): void;
			};
			component.handleInput("\t");
			for (let attempts = 0; attempts < 8; attempts++) {
				if (component.render(120).some((line) => line.includes("> Editor model label"))) break;
				component.handleInput("\x1b[B");
			}
			component.handleInput(" ");
		});
		const { handlers, command } = loadExtension();
		await emit(handlers, "session_start", ctx);
		const before = mocks.syncState.mock.calls.length;
		await command.handler("", ctx);
		expect(mocks.config.components.editor.modelLabel).toBe("name");
		expect(mocks.config.components.footer.modelLabel).toBe("id");
		expect(mocks.syncState).toHaveBeenCalledTimes(before + 1);
	});

	it("forces Git refreshes for exact-tag and submodule probe changes", async () => {
		updateStarship({ format: "$git_commit $git_metrics", responsive: false });
		let target: "showTag" | "ignoreSubmodules" = "showTag";
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				render(width: number): string[];
				handleInput(data: string): void;
			};
			for (let index = 0; index < 6; index++) component.handleInput("\t");
			const label = target === "showTag" ? "Show exact-match tag" : "Ignore submodules";
			for (let attempts = 0; attempts < 12; attempts++) {
				if (component.render(140).some((line) => line.includes(`> ${label}`))) break;
				component.handleInput("\x1b[B");
			}
			component.handleInput(" ");
		});
		const { handlers, command } = loadExtension();
		await emit(handlers, "session_start", ctx);
		await settleProjectRefresh();

		const initialReads = mocks.readGitStatus.mock.calls.length;
		await command.handler("", ctx);
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(initialReads + 1);
		expect(mocks.readGitStatus.mock.calls.at(-1)?.[1]).toMatchObject({ readExactTag: false });

		target = "ignoreSubmodules";
		await command.handler("", ctx);
		await settleProjectRefresh();
		expect(mocks.readGitStatus).toHaveBeenCalledTimes(initialReads + 2);
		expect(mocks.readGitStatus.mock.calls.at(-1)?.[1]).toMatchObject({ ignoreSubmodules: true });
	});

	it("refreshes probes activated by built-in segment settings", async () => {
		updateStarship({ format: "", compactFormat: "$cwd" });
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput?: (data: string) => void;
			};
			for (let index = 0; index < 5; index++) component.handleInput?.("\t");
			for (let index = 0; index < 11; index++) component.handleInput?.("\x1b[B");
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
		updateStarship({ responsive: true });
		const ctx = createContext(async (factory) => {
			const component = factory({ requestRender() {} }, makeTheme(), {}, () => {}) as {
				handleInput?: (data: string) => void;
			};
			for (let index = 0; index < 4; index++) component.handleInput?.("\t");
			for (let index = 0; index < 4; index++) component.handleInput?.("\x1b[B");
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
