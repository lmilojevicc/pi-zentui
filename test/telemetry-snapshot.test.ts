import {
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionContext, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FooterTelemetryController } from "../extensions/zentui/telemetry";
import { FileSettingsStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js";

const all = { subscription: true, autoCompaction: true };
const none = { subscription: false, autoCompaction: false };
function context() {
	return {
		cwd: "/project",
		model: { id: "test", provider: "test" },
		modelRegistry: { isUsingOAuth: vi.fn(() => false) },
		isProjectTrusted: vi.fn(() => true),
		sessionManager: {},
	} as unknown as ExtensionContext;
}
function fixture() {
	let revision = 1n;
	let enabled: unknown = true;
	let errors: unknown[] = [];
	const stat = vi.fn((_path: string) => ({
		dev: 1n,
		ino: 2n,
		size: 10n,
		mtimeNs: revision,
		ctimeNs: revision,
	}));
	const create = vi.fn(() => ({ drainErrors: () => errors, getCompactionEnabled: () => enabled }));
	const getAgentDir = vi.fn(() => "/agent");
	const controller = new FooterTelemetryController({
		settingsManager: { create },
		stat,
		getAgentDir,
	});
	return {
		ctx: context(),
		controller,
		stat,
		create,
		getAgentDir,
		change(value: unknown) {
			enabled = value;
			revision++;
		},
		setErrors(value: unknown[]) {
			errors = value;
			revision++;
		},
	};
}

afterEach(() => vi.restoreAllMocks());

describe("FooterTelemetryController", () => {
	it("constructs settings once for 100 stable requests while OAuth remains live", () => {
		const f = fixture();
		for (let i = 0; i < 100; i++)
			expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(true);
		expect(f.create).toHaveBeenCalledTimes(1);
		expect(f.stat).toHaveBeenCalledTimes(202); // Two signatures per lookup plus post-load validation.
		expect(f.ctx.modelRegistry.isUsingOAuth).toHaveBeenCalledTimes(100);
		vi.mocked(f.ctx.modelRegistry.isUsingOAuth).mockReturnValue(true);
		expect(f.controller.resolve(f.ctx, all).subscription).toBe(true);
		expect(f.create).toHaveBeenCalledTimes(1);
	});

	it("does no work without consumers and gates each field independently", () => {
		const f = fixture();
		for (let i = 0; i < 100; i++) f.controller.resolve(f.ctx, none);
		expect(f.stat).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.getAgentDir).not.toHaveBeenCalled();
		expect(f.ctx.isProjectTrusted).not.toHaveBeenCalled();
		expect(f.ctx.modelRegistry.isUsingOAuth).not.toHaveBeenCalled();
		f.controller.resolve(f.ctx, { ...none, subscription: true });
		expect(f.stat).not.toHaveBeenCalled();
		f.controller.resolve(f.ctx, { ...none, autoCompaction: true });
		expect(f.ctx.modelRegistry.isUsingOAuth).toHaveBeenCalledTimes(1);
	});

	it("invalidates on cwd, session identity, agent directory, explicit refresh/reset and demand activation", () => {
		const f = fixture();
		const resolve = () => f.controller.resolve(f.ctx, all);
		resolve();
		f.ctx.cwd = "/other";
		resolve();
		f.ctx.cwd = "/project";
		resolve(); // Returning to an old cwd cannot resurrect a second retained snapshot.
		f.ctx.sessionManager = {} as ExtensionContext["sessionManager"];
		resolve();
		f.getAgentDir.mockReturnValue("/other-agent");
		resolve();
		f.controller.refresh(f.ctx, all);
		f.controller.reset();
		resolve();
		f.controller.resolve(f.ctx, none);
		resolve();
		expect(f.create).toHaveBeenCalledTimes(8);
	});

	it("checks live trust and never stats or loads untrusted project settings", () => {
		const f = fixture();
		vi.mocked(f.ctx.isProjectTrusted).mockReturnValue(false);
		f.controller.resolve(f.ctx, all);
		expect(f.stat.mock.calls.every(([path]) => path === "/agent/settings.json")).toBe(true);
		expect(f.create).toHaveBeenLastCalledWith("/project", "/agent", { projectTrusted: false });
		vi.mocked(f.ctx.isProjectTrusted).mockReturnValue(true);
		f.controller.resolve(f.ctx, all);
		expect(f.stat).toHaveBeenCalledWith("/project/.pi/settings.json");
		f.stat.mockClear();
		vi.mocked(f.ctx.isProjectTrusted).mockReturnValue(false);
		f.controller.resolve(f.ctx, all);
		expect(f.stat.mock.calls.every(([path]) => path === "/agent/settings.json")).toBe(true);
		expect(f.create).toHaveBeenCalledTimes(3);
	});

	it.each(["ino", "size", "mtimeNs", "ctimeNs", "dev"] as const)(
		"invalidates on %s alone",
		(field) => {
			const f = fixture();
			f.controller.resolve(f.ctx, all);
			const signature = f.stat.mock.results[0].value;
			f.stat.mockReturnValue({ ...signature, [field]: signature[field] + 1n });
			f.controller.resolve(f.ctx, all);
			expect(f.create).toHaveBeenCalledTimes(2);
		},
	);

	it("retries errors, missing capabilities and invalid values without retaining successful keys", () => {
		const f = fixture();
		f.controller.resolve(f.ctx, all);
		f.stat.mockImplementationOnce(() => {
			throw Object.assign(new Error("denied"), { code: "EACCES" });
		});
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBeUndefined();
		f.controller.resolve(f.ctx, all);
		expect(f.create).toHaveBeenCalledTimes(2);
		f.change(false);
		f.create.mockImplementationOnce(() => {
			throw new Error("locked");
		});
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBeUndefined();
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(false);
		f.setErrors([new Error("bad JSON")]);
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBeUndefined();
		f.setErrors([]);
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(false);
		f.change("true");
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBeUndefined();
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBeUndefined();
		f.change(true);
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(true);
		vi.mocked(f.ctx.isProjectTrusted).mockImplementationOnce(() => {
			throw new Error("trust unavailable");
		});
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBeUndefined();
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(true);
	});

	it("does not pin signatures when files change during construction", () => {
		const f = fixture();
		f.create.mockImplementationOnce(() => {
			f.change(false);
			return { drainErrors: () => [], getCompactionEnabled: () => true };
		});
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(true);
		expect(f.controller.resolve(f.ctx, all).autoCompaction).toBe(false);
		expect(f.create).toHaveBeenCalledTimes(2);
	});
});

describe("telemetry real settings files", () => {
	it("reuses locked reads and observes edits, replacement, creation/deletion, trust and parse recovery", () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-telemetry-"));
		const agent = join(dir, "agent");
		const cwd = join(dir, "project");
		mkdirSync(agent);
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const global = join(agent, "settings.json");
		const project = join(cwd, ".pi", "settings.json");
		const write = (path: string, enabled: boolean) =>
			writeFileSync(path, JSON.stringify({ compaction: { enabled } }));
		write(global, true);
		write(project, false);
		const create = vi.fn(SettingsManager.create.bind(SettingsManager));
		const reads = vi.spyOn(FileSettingsStorage.prototype, "withLock");
		const stat = vi.fn((path: string) => statSync(path, { bigint: true }));
		const controller = new FooterTelemetryController({
			settingsManager: { create },
			getAgentDir: () => agent,
			stat,
		});
		const ctx = context();
		ctx.cwd = cwd;
		const resolve = () => controller.resolve(ctx, all).autoCompaction;
		try {
			for (let i = 0; i < 100; i++) expect(resolve()).toBe(false);
			expect(create).toHaveBeenCalledTimes(1);
			expect(reads).toHaveBeenCalledTimes(2); // Pi withLock reads each existing settings file once.
			write(project, true);
			expect(resolve()).toBe(true);
			write(`${project}.new`, false);
			renameSync(`${project}.new`, project);
			expect(resolve()).toBe(false);
			unlinkSync(project);
			expect(resolve()).toBe(true);
			write(global, false);
			expect(resolve()).toBe(false);
			unlinkSync(global);
			expect(resolve()).toBe(true); // Pi's actual default, not a substitute on error.
			write(global, false);
			expect(resolve()).toBe(false);
			write(project, true);
			expect(resolve()).toBe(true);
			vi.mocked(ctx.isProjectTrusted).mockReturnValue(false);
			stat.mockClear();
			reads.mockClear();
			expect(resolve()).toBe(false);
			expect(stat.mock.calls.every(([path]) => path === global)).toBe(true);
			expect(reads.mock.calls.map(([scope]) => scope)).toEqual(["global"]);
			vi.mocked(ctx.isProjectTrusted).mockReturnValue(true);
			expect(resolve()).toBe(true);
			writeFileSync(project, "{broken");
			expect(resolve()).toBeUndefined();
			const attempts = create.mock.calls.length;
			expect(resolve()).toBeUndefined();
			expect(create).toHaveBeenCalledTimes(attempts + 1);
			write(project, false);
			expect(resolve()).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
