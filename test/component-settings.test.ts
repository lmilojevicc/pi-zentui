import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	type ComponentSettingsDeps,
	confirmComponentMigration,
	editComponentColors,
} from "../extensions/zentui/component-settings";
import {
	mergeConfig,
	migrateComponentSelections,
	saveComponentColor,
} from "../extensions/zentui/config";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

function harness() {
	const sessionLifecycle = new SessionLifecycle();
	sessionLifecycle.start();
	const config = mergeConfig({});
	let draft = "expanded\nlong paste";
	const ui = {
		confirm: vi.fn(async () => true),
		select: vi.fn<() => Promise<string | undefined>>(async () => undefined),
		editor: vi.fn<() => Promise<string | undefined>>(async () => undefined),
		notify: vi.fn(),
		getEditorText: vi.fn(() => draft),
		setEditorText: vi.fn((value: string) => {
			draft = value;
		}),
	};
	const ctx = { hasUI: true, ui } as unknown as ExtensionContext;
	const deps: ComponentSettingsDeps = {
		sessionLifecycle,
		getConfig: () => config,
		migrateSelections: vi.fn(),
		setComponentColor: vi.fn(),
	};
	return { ctx, deps, ui, config, draft: () => draft };
}

describe("confirmed component migration dialogs", () => {
	it("explains retained color inheritance and writes only after explicit confirmation", async () => {
		const h = harness();
		h.ui.confirm.mockImplementationOnce(async () => {
			expect(h.deps.migrateSelections).not.toHaveBeenCalled();
			return true;
		});
		await confirmComponentMigration(h.ctx, h.deps);
		expect(h.ui.confirm).toHaveBeenCalledWith(
			"Migrate component selections?",
			expect.stringContaining("Shared colors remain inherited fallbacks"),
		);
		expect(h.deps.migrateSelections).toHaveBeenCalledOnce();
		expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("migrated"), "info");
		expect(h.draft()).toBe("expanded\nlong paste");
	});
	it.each(["cancel", "no-ui", "stale", "restarted"])(
		"does not save or notify on %s",
		async (mode) => {
			const h = harness();
			if (mode === "no-ui") Object.assign(h.ctx, { hasUI: false });
			h.ui.confirm.mockImplementationOnce(async () => {
				if (mode === "stale" || mode === "restarted") {
					h.deps.sessionLifecycle.shutdown();
					if (mode === "restarted") h.deps.sessionLifecycle.start();
				}
				return mode !== "cancel";
			});
			await confirmComponentMigration(h.ctx, h.deps);
			expect(h.deps.migrateSelections).not.toHaveBeenCalled();
			expect(h.ui.notify).not.toHaveBeenCalled();
			if (mode === "no-ui") expect(h.ui.confirm).not.toHaveBeenCalled();
		},
	);
	it("reports write failure without a success notification", async () => {
		const h = harness();
		h.deps.migrateSelections = vi.fn(() => {
			throw new Error("read-only");
		});
		await confirmComponentMigration(h.ctx, h.deps);
		expect(h.ui.notify).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("read-only"),
			"error",
		);
	});
	it("suppresses stale dialog rejection notifications", async () => {
		const h = harness();
		h.ui.confirm.mockImplementationOnce(async () => {
			h.deps.sessionLifecycle.shutdown();
			throw new Error("closed");
		});
		await confirmComponentMigration(h.ctx, h.deps);
		expect(h.ui.notify).not.toHaveBeenCalled();
	});
	it("reads latest disk data after confirmation rather than the displayed snapshot", async () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-migration-dialog-"));
		const path = join(dir, "zentui.json");
		try {
			writeFileSync(path, JSON.stringify({ features: { editor: true } }));
			const h = harness();
			h.deps.migrateSelections = () => {
				migrateComponentSelections(path);
			};
			h.ui.confirm.mockImplementationOnce(async () => {
				writeFileSync(
					path,
					JSON.stringify({ features: { editor: false }, future: { keep: true } }),
				);
				return true;
			});
			await confirmComponentMigration(h.ctx, h.deps);
			const saved = JSON.parse(readFileSync(path, "utf8"));
			expect(saved.components.editor.enabled).toBe(false);
			expect(saved.future).toEqual({ keep: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("component color override dialogs", () => {
	it.each(["", "   ", "fg:202", "bold purple"])(
		"saves supported explicit value %j, not inherited defaults",
		async (value) => {
			const h = harness();
			h.ui.select.mockResolvedValueOnce("accent").mockResolvedValueOnce("Edit override");
			h.ui.editor.mockResolvedValueOnce(value);
			await editComponentColors(h.ctx, h.deps, "editor");
			expect(h.deps.setComponentColor).toHaveBeenCalledExactlyOnceWith(
				"editor",
				"accent",
				value,
				h.ctx,
			);
			expect(h.draft()).toBe("expanded\nlong paste");
		},
	);
	it("resets by deleting only the owner key on latest disk", async () => {
		const dir = mkdtempSync(join(tmpdir(), "zentui-color-dialog-"));
		const path = join(dir, "zentui.json");
		try {
			const h = harness();
			h.config.components.editor.colors = { accent: "red" };
			writeFileSync(
				path,
				JSON.stringify({
					colors: { editorAccent: "green" },
					components: {
						editor: { colors: { accent: "red", future: true } },
						userMessages: { colors: { accent: "blue" } },
					},
				}),
			);
			h.deps.setComponentColor = (owner, key, value) => {
				saveComponentColor(owner, key, value, path);
			};
			h.ui.select.mockResolvedValueOnce("accent").mockResolvedValueOnce("Reset / inherit");
			await editComponentColors(h.ctx, h.deps, "editor");
			const saved = JSON.parse(readFileSync(path, "utf8"));
			expect(saved.components.editor.colors).toEqual({ future: true });
			expect(saved.components.userMessages).toEqual({ colors: { accent: "blue" } });
			expect(saved.colors.editorAccent).toBe("green");
			expect(h.ui.editor).not.toHaveBeenCalled();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it.each([undefined, "unknown color", "\x1b[31m"])(
		"does not persist canceled or invalid value %j",
		async (value) => {
			const h = harness();
			h.ui.select.mockResolvedValueOnce("border").mockResolvedValueOnce("Edit override");
			h.ui.editor.mockResolvedValueOnce(value);
			await editComponentColors(h.ctx, h.deps, "userMessages");
			expect(h.deps.setComponentColor).not.toHaveBeenCalled();
			if (value === undefined) expect(h.ui.notify).not.toHaveBeenCalled();
			else
				expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unsupported"), "warning");
		},
	);
	it.each(["role", "action", "value"])(
		"rejects stale %s completion without save, notification, or next dialog",
		async (stage) => {
			const h = harness();
			h.ui.select.mockImplementationOnce(async () => {
				if (stage === "role") h.deps.sessionLifecycle.shutdown();
				return "accent";
			});
			h.ui.select.mockImplementationOnce(async () => {
				if (stage === "action") h.deps.sessionLifecycle.shutdown();
				return "Edit override";
			});
			h.ui.editor.mockImplementationOnce(async () => {
				h.deps.sessionLifecycle.shutdown();
				h.deps.sessionLifecycle.start();
				return "red";
			});
			await editComponentColors(h.ctx, h.deps, "editor");
			expect(h.deps.setComponentColor).not.toHaveBeenCalled();
			expect(h.ui.notify).not.toHaveBeenCalled();
			expect(h.ui.select).toHaveBeenCalledTimes(stage === "role" ? 1 : 2);
			expect(h.ui.editor).toHaveBeenCalledTimes(stage === "value" ? 1 : 0);
		},
	);
	it("does nothing without UI and reports an active save failure", async () => {
		const h = harness();
		Object.assign(h.ctx, { hasUI: false });
		await editComponentColors(h.ctx, h.deps, "footer");
		expect(h.ui.select).not.toHaveBeenCalled();
		Object.assign(h.ctx, { hasUI: true });
		h.ui.select.mockResolvedValueOnce("cwd").mockResolvedValueOnce("Reset / inherit");
		h.deps.setComponentColor = vi.fn(() => {
			throw new Error("read-only");
		});
		await editComponentColors(h.ctx, h.deps, "footer");
		expect(h.ui.notify).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("read-only"),
			"error",
		);
	});
});

describe("color dialog errors and draft transfer", () => {
	it.each(["role", "action", "value"])(
		"contains %s rejection without a save and preserves draft",
		async (stage) => {
			const h = harness();
			const reject = async () => {
				throw new Error("dialog unavailable");
			};
			h.ui.select.mockResolvedValueOnce("accent").mockResolvedValueOnce("Edit override");
			if (stage === "role") h.ui.select.mockReset().mockImplementationOnce(reject);
			if (stage === "action")
				h.ui.select.mockReset().mockResolvedValueOnce("accent").mockImplementationOnce(reject);
			h.ui.editor.mockImplementationOnce(reject);
			await editComponentColors(h.ctx, h.deps, "editor");
			expect(h.deps.setComponentColor).not.toHaveBeenCalled();
			expect(h.ui.notify).toHaveBeenCalledExactlyOnceWith(
				expect.stringContaining("dialog unavailable"),
				"error",
			);
			expect(h.draft()).toBe("expanded\nlong paste");
		},
	);
	it("suppresses a stale color dialog error without another dialog or notice", async () => {
		const h = harness();
		h.ui.select.mockResolvedValueOnce("accent").mockResolvedValueOnce("Edit override");
		h.ui.editor.mockImplementationOnce(async () => {
			h.deps.sessionLifecycle.shutdown();
			throw new Error("closed");
		});
		await editComponentColors(h.ctx, h.deps, "editor");
		expect(h.deps.setComponentColor).not.toHaveBeenCalled();
		expect(h.ui.notify).not.toHaveBeenCalled();
		expect(h.ui.select).toHaveBeenCalledTimes(2);
	});
});
