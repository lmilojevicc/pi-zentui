import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as asyncFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
	configure: (_config: unknown) => {},
	hooks: {} as Record<string, (...args: unknown[]) => unknown>,
	exec: vi.fn(),
	runtime: vi.fn(),
	packageVersion: vi.fn(),
}));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
		readdirSync: vi.fn(actual.readdirSync),
		readFileSync: vi.fn(actual.readFileSync),
	};
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, readdir: vi.fn(actual.readdir), readFile: vi.fn(actual.readFile) };
});
vi.mock("node:child_process", () => ({
	execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: fixture.exec }),
}));
vi.mock("../extensions/zentui/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../extensions/zentui/config")>();
	let current: typeof actual.defaultConfig;
	return {
		...actual,
		ensureConfigExists() {},
		loadConfig: vi.fn(() => {
			current = structuredClone(actual.defaultConfig);
			current.components.footer.colorSource = "theme";
			current.projectRefreshIntervalMs = 5000;
			current.components.editor.enabled = false;
			current.components.footer.styles.starship.format = "$git_branch";
			current.components.footer.styles.starship.compactFormat = "";
			fixture.configure(current);
			return current;
		}),
		saveStarshipFooterStylePatch: vi.fn((patch) => {
			Object.assign(current.components.footer.styles.starship, patch);
			return current;
		}),
	};
});
vi.mock("../extensions/zentui/settings-command", () => ({
	registerZentuiSettingsCommand(_pi: unknown, hooks: typeof fixture.hooks) {
		fixture.hooks = hooks;
	},
}));
vi.mock("../extensions/zentui/runtime", () => ({ readRuntimeInfo: fixture.runtime }));
vi.mock("../extensions/zentui/package-version", () => ({
	readPackageVersionResult: fixture.packageVersion,
}));
vi.mock("../extensions/zentui/telemetry", () => ({
	resolveFooterTelemetry: () => ({}),
	FooterTelemetryController: class {
		resolve() {
			return {};
		}
		reset() {}
	},
}));

import { loadConfig, type ZentuiConfig } from "../extensions/zentui/config";
import zentui, { activeFooterReferences } from "../extensions/zentui/index";
import { RepositoryRootController } from "../extensions/zentui/repository-root";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Footer = { render(width: number): string[]; dispose?(): void };
type FooterFactory = (...args: unknown[]) => Footer;
let cwd: string;
let status: string;
let failStatus: string | undefined;
let deferred: undefined | (() => Promise<{ stdout: string }>);
let shutdown: undefined | (() => Promise<void>);
function configure(fn: (config: ZentuiConfig) => void) {
	fixture.configure = (value) => fn(value as ZentuiConfig);
}
function config() {
	return vi.mocked(loadConfig).mock.results.at(-1)?.value as ZentuiConfig;
}
async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

function harness() {
	let footerFactory: FooterFactory | undefined;
	let editorFactory: unknown;
	const requestRender = vi.fn();
	const theme = {
		fg: (_: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
	} as unknown as Theme;
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd,
		model: { id: "test", provider: "test", contextWindow: 10000 },
		getContextUsage: () => undefined,
		sessionManager: SessionManager.inMemory(cwd),
		isIdle: () => true,
		ui: {
			theme,
			setFooter(factory: FooterFactory | undefined) {
				footerFactory = factory;
			},
			setEditorComponent(value: unknown) {
				editorFactory = value;
			},
			getEditorComponent: () => editorFactory,
			getEditorText: () => "",
			setEditorText() {},
		},
	};
	const handlers = new Map<string, Handler[]>();
	zentui({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getThinkingLevel: () => "off",
		registerCommand() {},
	} as never);
	const emit = async (name: string) => {
		for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
		await flush();
	};
	shutdown = () => emit("session_shutdown");
	return {
		ctx,
		emit,
		requestRender,
		footer() {
			if (!footerFactory) throw new Error("no footer factory");
			return footerFactory({ requestRender }, theme, {
				onBranchChange: () => () => {},
				getExtensionStatuses: () => new Map(),
			});
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	cwd = mkdtempSync(join(tmpdir(), "zentui-project-demand-"));
	fixture.configure = () => {};
	fixture.hooks = {};
	status = "# branch.oid abc123\n# branch.head main\n";
	failStatus = undefined;
	deferred = undefined;
	shutdown = undefined;
	fixture.runtime.mockReset().mockResolvedValue({ kind: "ok", runtime: undefined });
	fixture.packageVersion.mockReset().mockResolvedValue({ kind: "ok", result: null });
	fixture.exec.mockReset().mockImplementation(async (_command, args: string[], options) => {
		if (args[0] === "status") {
			if (failStatus) throw new Error(failStatus);
			return deferred ? deferred() : { stdout: status };
		}
		if (args.includes("--is-inside-work-tree")) return { stdout: "true" };
		if (args[0] === "rev-parse") {
			const specs = args.filter((_, i) => args[i - 1] === "--git-path");
			return { stdout: `${specs.map((spec) => join(options.cwd, ".git", spec)).join("\n")}\n` };
		}
		return { stdout: "" };
	});
});
afterEach(async () => {
	await shutdown?.();
	// Native filesystem promises outlive fake-timer shutdown; finish them before
	// restoring shared spies or deleting the project used by the current test.
	let settled = -1;
	while (true) {
		const results = [
			...vi.mocked(asyncFs.readdir).mock.results,
			...vi.mocked(asyncFs.readFile).mock.results,
		];
		if (results.length === settled) break;
		settled = results.length;
		await Promise.allSettled(results.map((result) => result.value));
		await flush();
	}
	vi.useRealTimers();
	vi.restoreAllMocks();
	rmSync(cwd, { recursive: true, force: true });
});

describe("owned project demand through real index and git reader", () => {
	it("refreshes visible package metadata after its project manifest changes", async () => {
		const runtime = await vi.importActual<typeof import("../extensions/zentui/runtime")>(
			"../extensions/zentui/runtime",
		);
		const packageVersion = await vi.importActual<
			typeof import("../extensions/zentui/package-version")
		>("../extensions/zentui/package-version");
		fixture.runtime.mockImplementation(runtime.readRuntimeInfo);
		fixture.packageVersion.mockImplementation(packageVersion.readPackageVersionResult);
		configure((c) => {
			c.components.footer.styles.starship.format = "$runtime $package";
		});
		writeFileSync(join(cwd, "test.gemspec"), "spec.version = '1.0.0'");
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		await vi.waitFor(() => expect(footer.render(200).join("")).toContain("1.0.0"));
		writeFileSync(join(cwd, "test.gemspec"), "spec.version = '2.0.0'");
		await vi.advanceTimersByTimeAsync(5000);
		await vi.waitFor(() => expect(footer.render(200).join("")).toContain("2.0.0"));
		footer.dispose?.();
	});

	it("does not start discovery when neither runtime nor package is demanded", async () => {
		configure((c) => {
			c.components.footer.styles.starship.format = "$cwd";
		});
		vi.mocked(asyncFs.readdir).mockClear();
		vi.mocked(asyncFs.readFile).mockClear();
		const h = harness();
		await h.emit("session_start");
		await vi.advanceTimersByTimeAsync(10000);
		expect(asyncFs.readdir).not.toHaveBeenCalled();
		expect(asyncFs.readFile).not.toHaveBeenCalled();
		expect(fixture.runtime).not.toHaveBeenCalled();
		expect(fixture.packageVersion).not.toHaveBeenCalled();
	});

	it("shares one syntax compile per exact format across 100 renders and reference requests", async () => {
		configure((c) => {
			c.components.footer.styles.starship.format = "syntax-count-wide $directory $fill $tokens";
			c.components.footer.styles.starship.compactFormat = "syntax-count-compact $cwd $wrap $tokens";
		});
		const h = harness();
		// Capture actual parser regex execution, including internally called helpers.
		const source = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g.source;
		const exec = RegExp.prototype.exec;
		let parses = 0;
		vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (this: RegExp, text: string) {
			if (this.source === source) parses += 1;
			return exec.call(this, text);
		});
		await h.emit("session_start");
		const footer = h.footer();
		for (let i = 0; i < 100; i++) {
			footer.render(30);
			expect(activeFooterReferences(config())).toEqual(new Set(["cwd", "tokens"]));
		}
		expect(parses).toBe(6);
		const references = activeFooterReferences(config());
		references.clear();
		expect(activeFooterReferences(config())).toEqual(new Set(["cwd", "tokens"]));
		config().components.footer.styles.starship.format = "syntax-edited $session_name";
		config().components.footer.styles.starship.compactFormat = "syntax-edited $git_branch";
		expect(activeFooterReferences(config())).toEqual(new Set(["session_name", "git_branch"]));
		expect(parses).toBe(8);
		expect(footer.render(200).join("")).toContain("syntax-edited");
		expect(parses).toBe(8);
		footer.dispose?.();
	});

	it.each(["directory", "file"])(
		"performs zero marker checks for 100 root-only renders (%s), refreshing removal and creation on polls",
		async (kind) => {
			configure((c) => {
				c.icons.cwd = "";
				c.components.footer.styles.starship.format = "$cwd";
				c.components.footer.styles.starship.pathDisplay = { mode: "repository", depth: 0 };
			});
			const marker = join(cwd, ".git");
			const create = () =>
				kind === "file"
					? writeFileSync(marker, "gitdir: /elsewhere/worktrees/test\n")
					: mkdirSync(marker);
			create();
			const h = harness();
			h.ctx.cwd = join(cwd, "nested");
			mkdirSync(h.ctx.cwd);
			await h.emit("session_start");
			const footer = h.footer();
			vi.mocked(existsSync).mockClear();
			for (let i = 0; i < 100; i++) expect(footer.render(200).join("").trim()).toBe("nested");
			expect(existsSync).not.toHaveBeenCalled();
			rmSync(marker, { recursive: true });
			// Render retains the last controlled snapshot, rather than doing hidden filesystem work.
			expect(footer.render(200).join("").trim()).toBe("nested");
			expect(existsSync).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(5000);
			expect(existsSync).toHaveBeenCalled();
			expect(footer.render(200).join("")).toContain(h.ctx.cwd);
			create();
			await vi.advanceTimersByTimeAsync(5000);
			vi.mocked(existsSync).mockClear();
			expect(footer.render(200).join("").trim()).toBe("nested");
			expect(existsSync).not.toHaveBeenCalled();
			expect(fixture.exec).not.toHaveBeenCalled();
			footer.dispose?.();
		},
	);

	it.each(["$tokens", "$runtime", "$package", "$package_version", "$cwd"])(
		"runs zero git processes for %s",
		async (format) => {
			configure((c) => {
				c.components.footer.styles.starship.format = format;
			});
			const h = harness();
			await h.emit("session_start");
			await vi.advanceTimersByTimeAsync(10000);
			expect(fixture.exec).toHaveBeenCalledTimes(0);
			expect(fixture.runtime).toHaveBeenCalledTimes(format === "$runtime" ? 3 : 0);
			expect(fixture.packageVersion).toHaveBeenCalledTimes(format.startsWith("$package") ? 3 : 0);
		},
	);

	it.each(["native", "hidden"] as const)(
		"does no probes for %s footer with disabled editor",
		async (style) => {
			configure((c) => {
				c.components.footer.style = style;
			});
			const h = harness();
			await h.emit("session_start");
			await vi.advanceTimersByTimeAsync(10000);
			expect(fixture.exec).toHaveBeenCalledTimes(0);
		},
	);

	it("keeps builtin default branch/status/operation demand", async () => {
		configure((c) => {
			c.components.footer.styles.starship.format = "";
		});
		const h = harness();
		await h.emit("session_start");
		expect(fixture.exec.mock.calls.map((call) => call[1][0])).toEqual([
			"status",
			"stash",
			"rev-parse",
		]);
	});

	it("includes compact-only git and stops when compact responsiveness is disabled", async () => {
		configure((c) => {
			c.components.footer.styles.starship.format = "$tokens";
			c.components.footer.styles.starship.compactFormat = "$branch";
		});
		const h = harness();
		await h.emit("session_start");
		expect(fixture.exec).toHaveBeenCalledTimes(1);
		config().components.footer.styles.starship.responsive = false;
		await vi.advanceTimersByTimeAsync(5000);
		expect(fixture.exec).toHaveBeenCalledTimes(1);
	});

	it.each([
		["$git_branch", ["status"]],
		["$git_status", ["status", "stash"]],
		["$git_state", ["status", "rev-parse"]],
		["$git_commit", ["status"]],
		["$git_tag", ["status", "describe"]],
		["$git_metrics", ["status", "diff"]],
		["$git_added $git_deleted", ["status", "diff"]],
	] as const)("runs only displayed probes for %s", async (format, commands) => {
		configure((c) => {
			c.components.footer.styles.starship.format = format;
			c.components.footer.styles.starship.gitCommit.showTag = false;
		});
		const h = harness();
		await h.emit("session_start");
		expect(fixture.exec.mock.calls.map((call) => call[1][0])).toEqual(commands);
	});

	it("clears demand on footer disposal without changing the other surface", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		const editor = h.ctx.ui.getEditorComponent();
		footer.dispose?.();
		fixture.exec.mockClear();
		await vi.advanceTimersByTimeAsync(10000);
		expect(fixture.exec).not.toHaveBeenCalled();
		expect(h.ctx.ui.getEditorComponent()).toBe(editor);
	});

	it("clears deactivated git data before a failed reactivation", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		fixture.hooks.setFooterFormat("$tokens", h.ctx);
		await flush();
		failStatus = "transient error";
		fixture.hooks.setFooterFormat("$git_branch", h.ctx);
		await flush();
		expect(footer.render(200).join("\n")).not.toContain("main");
		footer.dispose?.();
	});

	it("minimalist root-only validates a worktree marker with no git processes", async () => {
		writeFileSync(join(cwd, ".git"), "gitdir: /elsewhere/worktree\n");
		configure((c) => {
			c.components.footer.style = "native";
			c.components.editor.enabled = true;
			c.components.editor.style = "minimalist";
			c.components.editor.styles.minimalist.showGit = false;
			c.components.editor.styles.minimalist.formats = { bottomLeft: "" };
			c.components.editor.styles.minimalist.pathDisplay = "project";
		});
		const roots = vi.spyOn(RepositoryRootController.prototype, "update");
		const h = harness();
		await h.emit("session_start");
		expect(roots.mock.results.at(-1)?.value).toBe(cwd);
		expect(fixture.exec).toHaveBeenCalledTimes(0);
		rmSync(join(cwd, ".git"));
		await vi.advanceTimersByTimeAsync(5000);
		expect(roots.mock.results.at(-1)?.value).toBeUndefined();
		expect(fixture.exec).toHaveBeenCalledTimes(0);
	});

	it("minimalist git demand works with native footer and stops on ownership loss", async () => {
		configure((c) => {
			c.components.footer.style = "native";
			c.components.editor.enabled = true;
			c.components.editor.style = "minimalist";
			c.components.editor.styles.minimalist.showGit = true;
		});
		const h = harness();
		await h.emit("session_start");
		expect(fixture.exec).toHaveBeenCalledTimes(1);
		h.ctx.ui.setEditorComponent(() => ({}));
		await vi.advanceTimersByTimeAsync(10000);
		expect(fixture.exec).toHaveBeenCalledTimes(1);
	});

	it("suppresses unchanged snapshots but polls external changes and keeps last-good errors", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		h.requestRender.mockClear();
		await vi.advanceTimersByTimeAsync(10000);
		expect.soft(fixture.exec).toHaveBeenCalledTimes(3);
		expect.soft(h.requestRender).toHaveBeenCalledTimes(0);
		status = "# branch.oid abc124\n# branch.head external-change\n";
		await vi.advanceTimersByTimeAsync(5000);
		expect.soft(h.requestRender).toHaveBeenCalledTimes(1);
		expect(footer.render(200).join("\n")).toContain("external-change");
		failStatus = "temporary failure";
		await vi.advanceTimersByTimeAsync(5000);
		expect.soft(h.requestRender).toHaveBeenCalledTimes(1);
		expect(footer.render(200).join("\n")).toContain("external-change");
		failStatus = "not a git repository";
		await vi.advanceTimersByTimeAsync(5000);
		expect.soft(h.requestRender).toHaveBeenCalledTimes(2);
		expect(footer.render(200).join("\n")).not.toContain("external-change");
		footer.dispose?.();
	});

	it("forced settings refresh still probes equal values and rejects in-flight old demand", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		h.requestRender.mockClear();
		fixture.hooks.setGitCommit({ showTag: false }, h.ctx);
		await flush();
		expect(fixture.exec).toHaveBeenCalledTimes(2);
		expect(h.requestRender).toHaveBeenCalledTimes(0);
		let resolve!: (result: { stdout: string }) => void;
		deferred = () =>
			new Promise((done) => {
				resolve = done;
			});
		fixture.hooks.setGitCommit({ showTag: false }, h.ctx);
		await flush();
		config().components.footer.styles.starship.format = "$tokens";
		resolve({ stdout: "# branch.head stale\n" });
		await flush();
		expect(h.requestRender).toHaveBeenCalledTimes(0);
		config().components.footer.styles.starship.format = "$git_branch";
		expect(footer.render(200).join("\n")).toContain("main");
		footer.dispose?.();
	});

	it("root-only footer renders changed markers and path-mode activation without git", async () => {
		configure((c) => {
			c.components.footer.styles.starship.format = "$cwd";
		});
		mkdirSync(join(cwd, ".git"));
		const roots = vi.spyOn(RepositoryRootController.prototype, "update");
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		h.requestRender.mockClear();
		fixture.hooks.setPathDisplay({ mode: "repository", depth: 0 });
		await flush();
		expect(roots.mock.results.at(-1)?.value).toBe(cwd);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.requestRender).toHaveBeenCalledTimes(1);
		rmSync(join(cwd, ".git"), { recursive: true });
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.requestRender).toHaveBeenCalledTimes(2);
		expect(fixture.exec).toHaveBeenCalledTimes(0);
		footer.dispose?.();
	});

	it("rejects stale A→B→A refresh results and old session results", async () => {
		const h = harness();
		await h.emit("session_start");
		const footer = h.footer();
		const pending: Array<(value: { stdout: string }) => void> = [];
		deferred = () => new Promise((done) => pending.push(done));
		fixture.hooks.setGitCommit({ showTag: false }, h.ctx);
		await flush();
		h.ctx.cwd = join(cwd, "nested");
		fixture.hooks.setGitCommit({ showTag: false }, h.ctx);
		await flush();
		h.ctx.cwd = cwd;
		fixture.hooks.setGitCommit({ showTag: false }, h.ctx);
		await flush();
		pending[2]({ stdout: "# branch.head current\n" });
		await flush();
		pending[0]({ stdout: "# branch.head stale-a\n" });
		pending[1]({ stdout: "# branch.head stale-b\n" });
		await flush();
		expect(footer.render(200).join("\n")).toContain("current");
		expect(footer.render(200).join("\n")).not.toContain("stale");
		fixture.hooks.setGitCommit({ showTag: false }, h.ctx);
		await flush();
		await h.emit("session_shutdown");
		h.requestRender.mockClear();
		pending[3]({ stdout: "# branch.head stale-session\n" });
		await flush();
		expect(h.requestRender).toHaveBeenCalledTimes(0);
		footer.dispose?.();
	});
});
