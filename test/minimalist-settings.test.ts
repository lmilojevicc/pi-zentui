import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { mergeConfig } from "../extensions/zentui/config";
import {
	editMinimalistTemplates,
	editMinimalistVariables,
} from "../extensions/zentui/minimalist-settings";
import { SessionLifecycle } from "../extensions/zentui/session-lifecycle";

function harness(selections: Array<string | undefined>, edits: Array<string | undefined>) {
	const lifecycle = new SessionLifecycle();
	lifecycle.start();
	const config = mergeConfig({
		components: {
			editor: { styles: { minimalist: { variables: { quota: "@scope/usage:quota" } } } },
		},
	});
	const setMinimalist = vi.fn();
	const notify = vi.fn();
	const select = vi.fn(async () => selections.shift());
	const editor = vi.fn(async () => edits.shift());
	const ctx = { hasUI: true, ui: { select, editor, notify } } as unknown as ExtensionContext;
	const deps = {
		sessionLifecycle: lifecycle,
		getConfig: () => config,
		setMinimalist,
		requestRender: vi.fn(),
	};
	return { ctx, deps, select, editor, notify, setMinimalist, lifecycle };
}

describe("Minimalist metadata settings", () => {
	it("saves a deliberately empty slot without rewriting other slots", async () => {
		const h = harness(["topMiddle", "Edit template", undefined], [""]);
		await editMinimalistTemplates(h.ctx, h.deps);
		expect(h.setMinimalist).toHaveBeenCalledExactlyOnceWith({ formats: { topMiddle: "" } }, h.ctx);
	});
	it("resets only the selected slot using a nullable sparse patch", async () => {
		const h = harness(["bottomRight", "Reset / inherit", undefined], []);
		await editMinimalistTemplates(h.ctx, h.deps);
		expect(h.setMinimalist).toHaveBeenCalledExactlyOnceWith(
			{ formats: { bottomRight: null } },
			h.ctx,
		);
	});
	it("does not save canceled or stale editor submissions", async () => {
		const canceled = harness(["topLeft", "Edit template", undefined], [undefined]);
		await editMinimalistTemplates(canceled.ctx, canceled.deps);
		expect(canceled.setMinimalist).not.toHaveBeenCalled();
		const stale = harness(["topLeft", "Edit template"], ["changed"]);
		stale.editor.mockImplementationOnce(async () => {
			stale.lifecycle.shutdown();
			return "changed";
		});
		await editMinimalistTemplates(stale.ctx, stale.deps);
		expect(stale.setMinimalist).not.toHaveBeenCalled();
	});
	it("replaces normalized aliases and rejects reserved or malformed names without saving", async () => {
		const h = harness(["Edit aliases"], ['{"jobs":"@scope/jobs:queue"}']);
		await editMinimalistVariables(h.ctx, h.deps);
		expect(h.setMinimalist).toHaveBeenCalledExactlyOnceWith(
			{ variables: { quota: null, jobs: "@scope/jobs:queue" } },
			h.ctx,
		);
		const reserved = harness(["Edit aliases"], ['{"model":"@scope/jobs:queue"}']);
		await editMinimalistVariables(reserved.ctx, reserved.deps);
		expect(reserved.setMinimalist).not.toHaveBeenCalled();
		expect(reserved.notify).toHaveBeenCalledWith(expect.stringContaining("unchanged"), "warning");
		const invalid = harness(["Edit aliases"], ["not JSON"]);
		await editMinimalistVariables(invalid.ctx, invalid.deps);
		expect(invalid.setMinimalist).not.toHaveBeenCalled();
	});
	it("resets only aliases and leaves colors, templates, and other owners alone", async () => {
		const h = harness(["Reset aliases"], []);
		await editMinimalistVariables(h.ctx, h.deps);
		expect(h.setMinimalist).toHaveBeenCalledExactlyOnceWith({ variables: { quota: null } }, h.ctx);
	});
});

it.each(["\u00a0", "\u009b"])(
	"rejects alias-key whitespace/controls in settings: %j",
	async (control) => {
		const h = harness(["Edit aliases"], [JSON.stringify({ quota: `pkg${control}quota` })]);
		await editMinimalistVariables(h.ctx, h.deps);
		expect(h.setMinimalist).not.toHaveBeenCalled();
		expect(h.notify).toHaveBeenCalledWith(expect.stringContaining("unchanged"), "warning");
	},
);

it("accepts and resets an explicit ci publisher alias without renaming it", async () => {
	const h = harness(["Edit aliases"], ['{"ci":"vendor.package/build"}']);
	await editMinimalistVariables(h.ctx, h.deps);
	expect(h.setMinimalist).toHaveBeenCalledExactlyOnceWith(
		{ variables: { quota: null, ci: "vendor.package/build" } },
		h.ctx,
	);
	const config = h.deps.getConfig();
	config.components.editor.styles.minimalist.variables = { ci: "vendor.package/build" };
	h.select.mockResolvedValueOnce("Reset aliases");
	h.setMinimalist.mockClear();
	await editMinimalistVariables(h.ctx, h.deps);
	expect(h.setMinimalist).toHaveBeenCalledExactlyOnceWith({ variables: { ci: null } }, h.ctx);
});
