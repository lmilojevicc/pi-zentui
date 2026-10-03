import type { ExtensionUIContext } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	type OmpHookStatusObserver,
	observeOmpHookStatuses,
} from "../extensions/zentui/omp-statusline";
import { readOmpTemplateMetrics } from "../extensions/zentui/omp-template-metrics";
import { createOmpUiAdapter, type OmpUiAdapter } from "../extensions/zentui/omp-ui";

function fixture(
	beforeAttach?: (
		prototype: object,
		status: { setHookStatus(key: string, text: string | undefined): void },
	) => OmpHookStatusObserver | undefined,
) {
	class NativeStatusline {
		session = { sessionManager: { getSessionId: () => "own" } };
		model = "model-a";
		attachment: "box" | "band" | "rule" | "bottom" = "box";
		statuses = new Map<string, string>();
		getTopBorder(width: number) {
			return { content: `native:${this.model}:${width}`, width, revision: 1 };
		}
		getBandTopBorder(width: number) {
			return this.getTopBorder(width);
		}
		getStandaloneTopBorder(width: number) {
			return this.getTopBorder(width);
		}
		describeComposerFacts() {
			return {
				model: { spans: [{ t: this.model }] },
				context: "native-context",
				usage: "native-cost",
				extras: "native-extras",
			};
		}
		getPreviewLines(width: number) {
			return [this.getTopBorder(width).content, ...this.render(width)];
		}
		setHookStatus(key: string, text: string | undefined) {
			if (text === undefined) this.statuses.delete(key);
			else this.statuses.set(key, text);
		}
		invalidateGitCaches() {}
		render(width: number) {
			return [
				...(this.attachment === "bottom" && !editor.isAutocompleteActive()
					? [`native:${this.model}:${width}`]
					: []),
				...this.statuses.values(),
			];
		}
	}
	const status = new NativeStatusline();
	let autocomplete = false;
	const editor = { composerFacts: status, isAutocompleteActive: () => autocomplete };
	const widgets = new Map<string, { render(width: number): readonly string[]; dispose?(): void }>();
	const composer: { children: unknown[] } = { children: [editor] };
	const tui = { children: [composer], terminal: { columns: 80 }, requestRender() {} };
	const native = {
		setEditorComponent() {},
		setStatus(key: string, text: string | undefined) {
			status.setHookStatus(key, text);
		},
		setWidget(
			key: string,
			factory:
				| ((...args: unknown[]) => { render(width: number): readonly string[]; dispose?(): void })
				| undefined,
		) {
			widgets.get(key)?.dispose?.();
			widgets.delete(key);
			if (factory) widgets.set(key, factory(tui, {}));
		},
		getEditorText: () => "native draft",
	} as unknown as ExtensionUIContext;
	let sessionId = "own";
	const earlyObserver = beforeAttach?.(NativeStatusline.prototype, status);
	const options = {
		statusLinePrototype: NativeStatusline.prototype,
		getSessionId: () => sessionId,
		getHookStatusSnapshot: earlyObserver?.getSnapshot,
	};
	const adapter = createOmpUiAdapter(native, options);
	const surface = (width = tui.terminal.columns) => {
		const top =
			status.attachment === "bottom"
				? ""
				: status.attachment === "band"
					? status.getBandTopBorder(width).content
					: status.attachment === "rule"
						? status.getStandaloneTopBorder(width).content
						: status.getTopBorder(width).content;
		return [
			...(top ? [top] : []),
			"editor",
			...status.render(width),
			...[...widgets.values()].flatMap((widget) => widget.render(width)),
		];
	};
	return {
		NativeStatusline,
		status,
		editor,
		composer,
		native,
		adapter,
		options,
		earlyObserver,
		surface,
		widgets,
		tui,
		setAutocomplete(value: boolean) {
			autocomplete = value;
		},
		setSessionId(value: string) {
			sessionId = value;
		},
	};
}

function starship(h: { adapter: OmpUiAdapter; status: { model: string } }, onDispose = () => {}) {
	h.adapter.ui.setFooter((_tui, _theme, data) => ({
		invalidate() {},
		dispose: onDispose,
		render(width) {
			return [`zentui:${h.status.model}:${width}`, ...data.getExtensionStatuses().values()];
		},
	}));
}

describe("OMP native statusline replacement", () => {
	it("replaces all native editor attachments and the bottom bar with one footer without replacing the editor", () => {
		const h = fixture();
		try {
			starship(h);
			h.native.setStatus("build", "Build passing");
			for (const attachment of ["box", "band", "rule", "bottom"] as const) {
				h.status.attachment = attachment;
				expect(h.surface()).toEqual(["editor", "zentui:model-a:80", "Build passing"]);
			}
			expect(h.widgets.size).toBe(0);
			h.status.model = "model-b";
			expect(h.surface(31)).toEqual(["editor", "zentui:model-b:31", "Build passing"]);
			h.setAutocomplete(true);
			expect(h.surface()).toEqual(["editor"]);
			h.setAutocomplete(false);
			expect(h.surface()).toEqual(["editor", "zentui:model-b:80", "Build passing"]);
		} finally {
			h.adapter.dispose();
		}
	});

	it("keeps its verified footer and facts through modal unmounting, without claiming modal previews", () => {
		const h = fixture();
		try {
			starship(h);
			h.native.setStatus("build", "Build passing");
			h.composer.children = [{ render: () => ["modal"] }];
			for (const attachment of ["box", "band", "rule", "bottom"] as const) {
				h.status.attachment = attachment;
				expect(h.surface()).toEqual(["editor", "zentui:model-a:80", "Build passing"]);
			}
			expect(h.status.describeComposerFacts().extras).toMatchObject({
				p: { role: "zentui.statusline" },
				c: [{ p: { text: "zentui:model-a:80" } }, { p: { text: "Build passing" } }],
			});
			const preview = new h.NativeStatusline();
			expect(preview.getTopBorder(40).content).toBe("native:model-a:40");
			expect(h.status.getPreviewLines(40)).toEqual([
				"native:model-a:40",
				"native:model-a:40",
				"Build passing",
			]);
			h.status.setHookStatus("build", "Build updated");
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80", "Build updated"]);
			h.adapter.ui.setFooter(() => ({ invalidate() {}, render: () => [] }));
			expect(h.surface()).toEqual(["editor"]);
			expect(h.status.describeComposerFacts()).toMatchObject({
				model: { spans: [] },
				extras: { c: [] },
			});
			starship(h);
			h.composer.children = [h.editor];
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80", "Build updated"]);
		} finally {
			h.adapter.dispose();
		}
	});

	it("drops cached ownership on editor replacement, detached containers and session switches", () => {
		const h = fixture();
		try {
			starship(h);
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80"]);
			const composer = h.composer;
			composer.children = [{ render: () => ["modal"] }];
			h.native.setEditorComponent(undefined);
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			composer.children = [h.editor];
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80"]);
			const replacement = new h.NativeStatusline();
			composer.children = [{ composerFacts: replacement, isAutocompleteActive: () => false }];
			expect(h.status.getTopBorder(80).content).toBe("native:model-a:80");
			expect(replacement.render(80)).toEqual(["zentui:model-a:80"]);
			composer.children = [h.editor];
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80"]);
			h.tui.children = [];
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			h.tui.children = [composer];
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80"]);
			composer.children = [{ render: () => ["modal"] }];
			h.setSessionId("next");
			h.status.session.sessionManager.getSessionId = () => "next";
			h.adapter.useUi(h.native, h.options);
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
		} finally {
			h.adapter.dispose();
		}
	});

	it("seeds real early publications before footer construction and tracks updates, deletions and new sessions", () => {
		const h = fixture((prototype, status) => {
			const observer = observeOmpHookStatuses(prototype);
			status.setHookStatus("early", "Published before Zentui attaches");
			status.setHookStatus("deleted", "Deleted before attachment");
			status.setHookStatus("deleted", undefined);
			return observer;
		});
		try {
			expect(h.earlyObserver).toBeDefined();
			h.adapter.ui.setFooter((_tui, _theme, data) => {
				expect([...data.getExtensionStatuses()]).toEqual([
					["early", "Published before Zentui attaches"],
				]);
				return { invalidate() {}, render: () => [...data.getExtensionStatuses().values()] };
			});
			expect(h.surface()).toEqual(["editor", "Published before Zentui attaches"]);
			const preview = new h.NativeStatusline();
			preview.setHookStatus("preview", "Not this receiver");
			h.composer.children = [{ render: () => ["modal"] }];
			h.status.setHookStatus("early", "Updated during modal");
			expect(h.surface()).toEqual(["editor", "Updated during modal"]);
			h.status.setHookStatus("early", undefined);
			expect(h.surface()).toEqual(["editor"]);
			h.status.setHookStatus("last", "Old session");
			h.adapter.ui.setFooter(undefined);
			expect(h.surface()).toEqual(["native:model-a:80", "editor", "Old session"]);
			h.composer.children = [h.editor];
			h.setSessionId("next");
			h.status.session.sessionManager.getSessionId = () => "next";
			h.adapter.useUi(h.native, h.options);
			h.adapter.ui.setFooter((_tui, _theme, data) => ({
				invalidate() {},
				render: () => [...data.getExtensionStatuses().values()],
			}));
			expect(h.surface()).toEqual(["editor"]);
			h.status.setHookStatus("new", "New session publication");
			expect(h.surface()).toEqual(["editor", "New session publication"]);
		} finally {
			h.adapter.dispose();
			h.earlyObserver?.dispose();
		}
	});

	it("transitions Starship to Hidden to Native, preserving native statuses and exact restoration", () => {
		const h = fixture();
		let disposals = 0;
		try {
			starship(h, () => {
				disposals++;
			});
			expect(disposals).toBe(0);
			h.native.setStatus("allowed", "Allowed");
			h.native.setStatus("hidden", "Hidden");
			h.adapter.ui.setFooter((_tui, _theme, data) => ({
				invalidate() {},
				render() {
					const text = data.getExtensionStatuses().get("allowed");
					return text ? [text] : [];
				},
			}));
			expect(disposals).toBe(1);
			expect(h.surface()).toEqual(["editor", "Allowed"]);
			h.native.setStatus("allowed", undefined);
			expect(h.surface()).toEqual(["editor"]);
			h.adapter.ui.setFooter(undefined);
			expect(h.surface()).toEqual(["native:model-a:80", "editor", "Hidden"]);
			starship(h);
		} finally {
			h.adapter.dispose();
		}
		expect(h.surface()).toEqual(["native:model-a:80", "editor", "Hidden"]);
	});

	it("leaves startup, previews, other sessions and unsupported session fields native", () => {
		const h = fixture();
		try {
			starship(h);
			const preview = new h.NativeStatusline();
			expect(preview.getPreviewLines(42)).toEqual(["native:model-a:42"]);
			expect(h.status.getPreviewLines(42)).toEqual(["native:model-a:42"]);
			h.status.session.sessionManager.getSessionId = () => "startup";
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			h.status.session.sessionManager.getSessionId = () => "other";
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			h.setSessionId("other");
			h.adapter.useUi(h.native, h.options);
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80"]);
			Reflect.deleteProperty(h.status, "session");
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
		} finally {
			h.adapter.dispose();
		}
	});

	it("reads native metrics with Footer native, but rejects forged facts and other sessions", () => {
		const h = fixture();
		const names = new Set(["session_id", "subagent_count"]);
		try {
			Object.defineProperty(h.status, "subagentCount", { value: 2 });
			h.adapter.useUi(h.native, {
				...h.options,
				getHostTemplateValues(receiver, session, requested) {
					return readOmpTemplateMetrics(
						{ sessionManager: { getSessionId: () => h.options.getSessionId() } },
						requested,
						{ receiver, session },
					);
				},
			});
			expect(h.adapter.getHostTemplateValues(names)).toEqual({
				session_id: "own",
				subagent_count: "2",
			});
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			Reflect.set(h.editor, "composerFacts", { session: h.status.session, subagentCount: 99 });
			expect(h.adapter.getHostTemplateValues(names)).toBeUndefined();
			Reflect.set(h.editor, "composerFacts", h.status);
			h.status.session.sessionManager.getSessionId = () => "other";
			expect(h.adapter.getHostTemplateValues(names)).toBeUndefined();
		} finally {
			h.adapter.dispose();
		}
	});

	it("fails open as a whole when another renderer displaces one method, and cleanup preserves that owner", () => {
		const h = fixture();
		starship(h);
		const previous = h.NativeStatusline.prototype.render;
		const foreign = function (this: InstanceType<typeof h.NativeStatusline>, width: number) {
			return [...previous.call(this, width), "foreign"];
		};
		h.NativeStatusline.prototype.render = foreign;
		expect(h.surface()).toEqual(["native:model-a:80", "editor", "foreign"]);
		h.adapter.dispose();
		expect(h.NativeStatusline.prototype.render).toBe(foreign);
		expect(h.surface()).toEqual(["native:model-a:80", "editor", "foreign"]);
	});

	it("keeps the whole native surface when a required method cannot be safely decorated", () => {
		const h = fixture();
		h.adapter.dispose();
		Object.defineProperty(h.NativeStatusline.prototype, "getBandTopBorder", {
			...Object.getOwnPropertyDescriptor(h.NativeStatusline.prototype, "getBandTopBorder"),
			configurable: false,
		});
		const rejected = createOmpUiAdapter(h.native, h.options);
		try {
			starship({ adapter: rejected, status: h.status });
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			h.status.attachment = "band";
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			h.status.attachment = "bottom";
			expect(h.surface()).toEqual(["editor", "native:model-a:80"]);
		} finally {
			rejected.dispose();
		}
	});

	it("restores native rendering even if a footer's disposal callback throws", () => {
		const h = fixture();
		starship(h, () => {
			throw new Error("footer disposal failed");
		});
		expect(() => h.adapter.dispose()).toThrow("footer disposal failed");
		h.native.setStatus("build", "Still visible");
		expect(h.surface()).toEqual(["native:model-a:80", "editor", "Still visible"]);
	});

	it("does not remove another session adapter's active renderer when one adapter releases", () => {
		const h = fixture();
		const other = new h.NativeStatusline();
		other.session.sessionManager.getSessionId = () => "second";
		const secondEditor = { composerFacts: other, isAutocompleteActive: () => false };
		const secondTui = { ...h.tui, children: [secondEditor] };
		const secondNative = {
			...h.native,
			setWidget(_key: string, factory: ((...args: unknown[]) => unknown) | undefined) {
				factory?.(secondTui, {});
			},
		} as unknown as ExtensionUIContext;
		const second = createOmpUiAdapter(secondNative, {
			statusLinePrototype: h.NativeStatusline.prototype,
			getSessionId: () => "second",
		});
		try {
			starship(h);
			second.ui.setFooter(() => ({ invalidate() {}, render: () => ["second-footer"] }));
			expect(other.getTopBorder(50).content).toBe("");
			expect(other.render(50)).toEqual(["second-footer"]);
			h.adapter.dispose();
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
			expect(other.getTopBorder(50).content).toBe("");
			expect(other.render(50)).toEqual(["second-footer"]);
		} finally {
			h.adapter.dispose();
			second.dispose();
		}
	});

	it("replaces TSP status facts and emits real branch notifications without touching native mode", () => {
		const h = fixture();
		let changes = 0;
		try {
			const native = h.status.describeComposerFacts();
			h.adapter.ui.setFooter((_tui, _theme, data) => {
				const unsubscribe = data.onBranchChange(() => {
					changes++;
				});
				return {
					invalidate() {},
					dispose: unsubscribe,
					render: () => ["\u001b[31mcustom-model\u001b[0m"],
				};
			});
			expect(h.status.describeComposerFacts()).toEqual({
				model: { spans: [] },
				context: { k: "text", p: { text: "", wrap: "none" } },
				usage: { k: "text", p: { text: "", wrap: "none" } },
				extras: {
					k: "col",
					p: { role: "zentui.statusline" },
					c: [{ k: "text", p: { text: "custom-model", wrap: "none" } }],
				},
			});
			h.status.invalidateGitCaches();
			expect(changes).toBe(1);
			h.adapter.ui.setFooter(undefined);
			h.status.invalidateGitCaches();
			expect(changes).toBe(1);
			expect(h.status.describeComposerFacts()).toEqual(native);
		} finally {
			h.adapter.dispose();
		}
	});

	it("fails open during a modal if public editor ownership is displaced", () => {
		const h = fixture();
		starship(h);
		h.composer.children = [{ render: () => ["modal"] }];
		h.native.setEditorComponent = () => {};
		try {
			expect(h.surface()).toEqual(["native:model-a:80", "editor"]);
		} finally {
			h.adapter.dispose();
		}
	});
});

describe("OMP early hook-status observation", () => {
	it("delegates native results and errors, scopes publications by receiver and restores after out-of-order release", () => {
		class Publisher {
			session = { sessionManager: { getSessionId: () => "session-a" } };
			statuses = new Map<string, string>();
			setHookStatus(key: string, text: string | undefined) {
				if (key === "failure") throw new Error("native failure");
				if (text === undefined) this.statuses.delete(key);
				else this.statuses.set(key, text);
				return `native:${key}`;
			}
		}
		const descriptor = Object.getOwnPropertyDescriptor(Publisher.prototype, "setHookStatus");
		const first = observeOmpHookStatuses(Publisher.prototype);
		if (!first) throw new Error("First observer unavailable");
		const second = observeOmpHookStatuses(Publisher.prototype);
		if (!second) {
			first.dispose();
			throw new Error("Second observer unavailable");
		}
		const a = new Publisher();
		const b = new Publisher();
		try {
			expect(a.setHookStatus("first", "First")).toBe("native:first");
			expect([...a.statuses]).toEqual([["first", "First"]]);
			b.setHookStatus("second", "Second");
			expect([...(first.getSnapshot(a)?.statuses ?? [])]).toEqual([["first", "First"]]);
			expect([...(second.getSnapshot(b)?.statuses ?? [])]).toEqual([["second", "Second"]]);
			const snapshot = first.getSnapshot(a);
			if (!snapshot) throw new Error("Published snapshot unavailable");
			const revision = snapshot.revision;
			expect(() => a.setHookStatus("failure", "Not published")).toThrow("native failure");
			expect(first.getSnapshot(a)?.revision).toBe(revision);
			expect([...(first.getSnapshot(a)?.statuses ?? [])]).toEqual([["first", "First"]]);
			first.dispose();
			expect(first.getSnapshot(a)).toBeUndefined();
			a.setHookStatus("first", undefined);
			a.setHookStatus("next", "Still observed");
			expect([...(second.getSnapshot(a)?.statuses ?? [])]).toEqual([["next", "Still observed"]]);
			a.session.sessionManager.getSessionId = () => "session-b";
			expect(second.getSnapshot(a)).toBeUndefined();
			a.setHookStatus("new-session", "New session");
			expect([...(second.getSnapshot(a)?.statuses ?? [])]).toEqual([
				["new-session", "New session"],
			]);
		} finally {
			second.dispose();
			first.dispose();
		}
		expect(Object.getOwnPropertyDescriptor(Publisher.prototype, "setHookStatus")).toEqual(
			descriptor,
		);
		a.setHookStatus("native-after-cleanup", "Native after cleanup");
		expect(a.statuses.get("native-after-cleanup")).toBe("Native after cleanup");
	});

	it("keeps real statuses when an early observer releases before its active adapter", () => {
		const h = fixture((prototype, status) => {
			const observer = observeOmpHookStatuses(prototype);
			status.setHookStatus("early", "Early");
			return observer;
		});
		try {
			starship(h);
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80", "Early"]);
			h.earlyObserver?.dispose();
			h.status.setHookStatus("early", "Updated");
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80", "Updated"]);
			h.status.setHookStatus("early", undefined);
			expect(h.surface()).toEqual(["editor", "zentui:model-a:80"]);
		} finally {
			h.adapter.dispose();
			h.earlyObserver?.dispose();
		}
	});

	it("does not claim or restore a displaced native setter", () => {
		class Publisher {
			statuses = new Map<string, string>();
			setHookStatus(key: string, text: string | undefined) {
				if (text === undefined) this.statuses.delete(key);
				else this.statuses.set(key, text);
			}
		}
		const observer = observeOmpHookStatuses(Publisher.prototype);
		if (!observer) throw new Error("Observer unavailable");
		const publisher = new Publisher();
		publisher.setHookStatus("owned", "Owned");
		const predecessor = Publisher.prototype.setHookStatus;
		const foreign = function (this: Publisher, key: string, text: string | undefined) {
			predecessor.call(this, key, text);
			this.statuses.set("foreign", "Foreign");
		};
		Publisher.prototype.setHookStatus = foreign;
		try {
			publisher.setHookStatus("later", "Later");
			expect(observer.getSnapshot(publisher)).toBeUndefined();
		} finally {
			observer.dispose();
		}
		expect(Publisher.prototype.setHookStatus).toBe(foreign);
		expect([...publisher.statuses]).toEqual([
			["owned", "Owned"],
			["later", "Later"],
			["foreign", "Foreign"],
		]);
	});
});
