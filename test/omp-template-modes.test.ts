import { describe, expect, it } from "vitest";
import {
	type OmpTemplateModeObserver,
	observeOmpTemplateModes,
} from "../extensions/zentui/omp-template-modes";

function fixture(beforeObserve?: (prototype: object) => void) {
	let sessionId: unknown = "first";
	const session = {
		sessionManager: { getSessionId: () => sessionId },
		getPlanModeState: (): unknown => undefined,
		getGoalModeState: (): unknown => undefined,
		getVibeModeState: (): unknown => undefined,
		getPrewalkState: (): unknown => undefined,
	};
	class NativeStatusline {
		session = session;
		fail = false;
		result = { native: true };
		accept() {
			if (this.fail) throw new Error("native failure");
			return this.result;
		}
		setPlanModeStatus(_status: unknown) {
			return this.accept();
		}
		setGoalModeStatus(_status: unknown) {
			return this.accept();
		}
		setVibeModeStatus(_status: unknown) {
			return this.accept();
		}
		setLoopModeStatus(_status: unknown) {
			return this.accept();
		}
		setVimStatus(_status: unknown) {
			return this.accept();
		}
		setCollabStatus(_status: unknown) {
			return this.accept();
		}
		setStreamStatus(_status: unknown) {
			return this.accept();
		}
		setVibeWorkerTokenRateProvider(_provider: unknown) {
			return this.accept();
		}
	}
	beforeObserve?.(NativeStatusline.prototype);
	const observer = observeOmpTemplateModes(NativeStatusline.prototype);
	const receiver = new NativeStatusline();
	const editor: Record<string, unknown> = {};
	return {
		NativeStatusline,
		receiver,
		session,
		editor,
		observer,
		read(...names: string[]) {
			return observer.read(receiver, receiver.session, editor, new Set(names));
		},
		setSessionId(value: unknown) {
			sessionId = value;
		},
	};
}

const pausedModes = [
	["plan_mode", "setPlanModeStatus", "Plan"],
	["goal_mode", "setGoalModeStatus", "Goal"],
] as const;

describe("OMP public template mode observations", () => {
	it.each(pausedModes)(
		"tracks %s active, paused, and explicit clear over persisted state",
		(name, setter, label) => {
			const h = fixture();
			h.session.getPlanModeState = () => ({ enabled: true });
			h.session.getGoalModeState = () => ({ enabled: true });
			try {
				expect(h.read(name)).toEqual({ [name]: label });
				h.receiver[setter]({ enabled: true, paused: false });
				expect(h.read(name)).toEqual({ [name]: label });
				h.receiver[setter]({ enabled: false, paused: true });
				expect(h.read(name)).toEqual({ [name]: `${label} paused` });
				h.receiver[setter](undefined);
				expect(h.read(name)).toEqual({});
				h.receiver[setter]({ enabled: false, paused: false });
				expect(h.read(name)).toEqual({});
			} finally {
				h.observer.dispose();
			}
		},
	);

	it("keeps zero stream viewers active and validates collab counts including the host", () => {
		const h = fixture();
		try {
			h.receiver.setStreamStatus({ viewers: 0 });
			h.receiver.setCollabStatus({ role: "host", participantCount: 1 });
			expect(h.read("stream_state", "collaboration")).toEqual({
				stream_state: "live · 0 viewers",
				collaboration: "host · 1 participants",
			});
			h.receiver.setStreamStatus({ viewers: 7 });
			h.receiver.setCollabStatus({ role: "guest", participantCount: 3 });
			expect(h.read("stream_state", "collaboration")).toEqual({
				stream_state: "live · 7 viewers",
				collaboration: "guest · 3 participants",
			});
			h.receiver.setStreamStatus(null);
			h.receiver.setCollabStatus(null);
			expect(h.read("stream_state", "collaboration")).toEqual({});
		} finally {
			h.observer.dispose();
		}
	});

	it("tracks Vibe and every Loop state without fabricating missing states", () => {
		const h = fixture();
		try {
			expect(h.read("vibe_mode", "loop_mode")).toEqual({});
			h.receiver.setVibeModeStatus({ enabled: true });
			for (const state of ["waiting", "running", "paused"]) {
				h.receiver.setLoopModeStatus({ state });
				expect(h.read("vibe_mode", "loop_mode")).toEqual({
					vibe_mode: "Vibe",
					loop_mode: `Loop ${state}`,
				});
			}
			h.receiver.setVibeModeStatus(undefined);
			h.receiver.setLoopModeStatus(undefined);
			expect(h.read("vibe_mode", "loop_mode")).toEqual({});
		} finally {
			h.observer.dispose();
		}
	});

	it("invalid successful publications hide older data and cannot fabricate labels", () => {
		const h = fixture();
		h.session.getPlanModeState = () => ({ enabled: true });
		try {
			for (const invalid of [
				null,
				false,
				"active",
				{},
				{ enabled: 1, paused: false },
				{ enabled: true },
				{ enabled: true, paused: "false" },
			]) {
				h.receiver.setPlanModeStatus({ enabled: true, paused: false });
				h.receiver.setPlanModeStatus(invalid);
				expect(h.read("plan_mode")).toEqual({});
			}
			for (const viewers of [-1, 1.5, NaN, Infinity, "0"]) {
				h.receiver.setStreamStatus({ viewers });
				expect(h.read("stream_state")).toEqual({});
			}
			for (const participantCount of [0, -1, 1.5, NaN, Infinity, "2"]) {
				h.receiver.setCollabStatus({ role: "host", participantCount });
				expect(h.read("collaboration")).toEqual({});
			}
			h.receiver.setCollabStatus({ role: "observer", participantCount: 2 });
			h.receiver.setLoopModeStatus({ state: "stopped" });
			h.receiver.setVibeModeStatus({ enabled: "true" });
			h.receiver.setVimStatus({ mode: "replace" });
			expect(h.read("collaboration", "loop_mode", "vibe_mode", "vim_mode")).toEqual({});
			const throwingPayload = {
				get enabled(): boolean {
					throw new Error("unsupported payload");
				},
			};
			expect(h.receiver.setPlanModeStatus(throwingPayload)).toBe(h.receiver.result);
			expect(h.read("plan_mode")).toEqual({});
		} finally {
			h.observer.dispose();
		}
	});

	it("publishes only successful native calls and preserves the native result or exception", () => {
		const h = fixture();
		try {
			expect(h.receiver.setPlanModeStatus({ enabled: true, paused: false })).toBe(
				h.receiver.result,
			);
			h.receiver.fail = true;
			expect(() => h.receiver.setPlanModeStatus({ enabled: false, paused: true })).toThrow(
				"native failure",
			);
			expect(() => h.receiver.setPlanModeStatus(undefined)).toThrow("native failure");
			expect(h.read("plan_mode")).toEqual({ plan_mode: "Plan" });
			h.receiver.fail = false;
			h.receiver.setPlanModeStatus({ enabled: false, paused: true });
			expect(h.read("plan_mode")).toEqual({ plan_mode: "Plan paused" });
		} finally {
			h.observer.dispose();
		}
	});

	it("uses concrete initial getters only when referenced and safely rejects unsupported getter shapes", () => {
		const h = fixture();
		let planReads = 0;
		h.session.getPlanModeState = () => {
			planReads++;
			return { enabled: true };
		};
		h.session.getGoalModeState = () => ({ enabled: false, goal: { status: "paused" } });
		h.session.getVibeModeState = () => ({ enabled: true });
		h.session.getPrewalkState = () => ({ tasks: [] });
		try {
			expect(h.read("goal_mode", "vibe_mode", "prewalk_mode")).toEqual({
				goal_mode: "Goal paused",
				vibe_mode: "Vibe",
				prewalk_mode: "Prewalk",
			});
			expect(planReads).toBe(0);
			expect(h.read("plan_mode")).toEqual({ plan_mode: "Plan" });
			expect(planReads).toBe(1);
			h.session.getPlanModeState = () => ({ enabled: "true" });
			h.session.getVibeModeState = () => {
				throw new Error("missing capability");
			};
			h.session.getPrewalkState = () => true;
			h.session.getGoalModeState = () => ({ enabled: false, goal: { status: "completed" } });
			expect(h.read("plan_mode", "goal_mode", "vibe_mode", "prewalk_mode")).toEqual({});
			h.session.getPrewalkState = () => undefined;
			expect(h.read("prewalk_mode", "unknown")).toEqual({});
		} finally {
			h.observer.dispose();
		}
	});

	it("prefers current Vim getters, including disabled, over observations and presentation preferences", () => {
		const h = fixture();
		try {
			h.receiver.setVimStatus({ mode: "normal", display: "none" });
			expect(h.read("vim_mode")).toEqual({ vim_mode: "normal" });
			h.editor.vimEnabled = true;
			for (const mode of ["insert", "normal", "visual", "visual-line"]) {
				h.editor.vimMode = mode;
				expect(h.read("vim_mode")).toEqual({ vim_mode: mode });
			}
			h.editor.vimEnabled = false;
			expect(h.read("vim_mode")).toEqual({});
			h.editor.vimEnabled = true;
			h.editor.vimMode = "unsupported";
			expect(h.read("vim_mode")).toEqual({});
			Object.defineProperty(h.editor, "vimEnabled", {
				configurable: true,
				get() {
					throw new Error("unsupported editor");
				},
			});
			expect(h.read("vim_mode")).toEqual({ vim_mode: "normal" });
			h.receiver.setVimStatus(undefined);
			expect(h.read("vim_mode")).toEqual({});
		} finally {
			h.observer.dispose();
		}
	});

	it("resets conversation snapshots on identity change while retaining receiver-local UI state", () => {
		const h = fixture();
		let rate = 4;
		try {
			h.receiver.setPlanModeStatus({ enabled: true, paused: false });
			h.receiver.setGoalModeStatus({ enabled: true, paused: false });
			h.receiver.setVibeModeStatus({ enabled: true });
			h.receiver.setLoopModeStatus({ state: "paused" });
			h.receiver.setStreamStatus({ viewers: 0 });
			h.receiver.setCollabStatus({ role: "host", participantCount: 2 });
			h.receiver.setVibeWorkerTokenRateProvider(() => rate);
			h.setSessionId("second");
			rate = 9;
			expect(
				h.read("plan_mode", "goal_mode", "vibe_mode", "loop_mode", "stream_state", "collaboration"),
			).toEqual({
				loop_mode: "Loop paused",
				stream_state: "live · 0 viewers",
				collaboration: "host · 2 participants",
			});
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBe(9);
			h.receiver.session = { ...h.session, sessionManager: { getSessionId: () => "replacement" } };
			expect(h.observer.read(h.receiver, h.session, h.editor, new Set(["stream_state"]))).toEqual(
				{},
			);
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			expect(h.read("plan_mode", "stream_state")).toEqual({ stream_state: "live · 0 viewers" });
			const other = new h.NativeStatusline();
			expect(
				h.observer.read(other, other.session, h.editor, new Set(["stream_state", "loop_mode"])),
			).toEqual({});
			expect(h.observer.workerTokenRate(other, other.session)).toBeNull();
		} finally {
			h.observer.dispose();
		}
	});

	it("requires an own concrete session and valid public identity even for current Vim and worker callbacks", () => {
		const h = fixture();
		let calls = 0;
		try {
			h.receiver.setVibeWorkerTokenRateProvider(() => {
				calls++;
				return 3;
			});
			h.editor.vimEnabled = true;
			h.editor.vimMode = "insert";
			for (const invalidId of [undefined, null, 7, ""]) {
				h.setSessionId(invalidId);
				expect(h.read("vim_mode")).toEqual({});
				expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			}
			expect(calls).toBe(0);
			h.setSessionId("valid");
			Object.defineProperty(h.receiver, "session", {
				configurable: true,
				get() {
					return h.session;
				},
			});
			expect(h.read("vim_mode")).toEqual({});
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			expect(calls).toBe(0);
		} finally {
			h.observer.dispose();
		}
	});

	it("reads current finite nonnegative worker aggregates and treats clear, invalid, or throwing callbacks as unavailable", () => {
		const h = fixture();
		let rate: unknown = 0;
		try {
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			h.receiver.setVibeWorkerTokenRateProvider(() => rate);
			for (const valid of [0, 3.75]) {
				rate = valid;
				expect(h.observer.workerTokenRate(h.receiver, h.session)).toBe(valid);
			}
			for (const invalid of [null, undefined, "3", -1, NaN, Infinity]) {
				rate = invalid;
				expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			}
			h.receiver.setVibeWorkerTokenRateProvider(() => {
				throw new Error("worker gone");
			});
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			h.receiver.setVibeWorkerTokenRateProvider(undefined);
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			h.receiver.setVibeWorkerTokenRateProvider(7);
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
		} finally {
			h.observer.dispose();
		}
	});

	it("tolerates locked and missing setters while preserving other publications and getter fallbacks", () => {
		const h = fixture((prototype) => {
			const descriptor = Object.getOwnPropertyDescriptor(prototype, "setPlanModeStatus");
			if (!descriptor) throw new Error("Native plan setter unavailable");
			Object.defineProperty(prototype, "setPlanModeStatus", { ...descriptor, configurable: false });
			Reflect.deleteProperty(prototype, "setVibeModeStatus");
			Object.defineProperty(prototype, "setGoalModeStatus", {
				configurable: true,
				get() {
					throw new Error("unsafe method accessor");
				},
			});
		});
		h.session.getPlanModeState = () => ({ enabled: true });
		h.session.getGoalModeState = () => ({ enabled: true });
		h.session.getVibeModeState = () => ({ enabled: true });
		try {
			h.receiver.setStreamStatus({ viewers: 0 });
			expect(h.read("plan_mode", "goal_mode", "vibe_mode", "stream_state")).toEqual({
				plan_mode: "Plan",
				goal_mode: "Goal",
				vibe_mode: "Vibe",
				stream_state: "live · 0 viewers",
			});
		} finally {
			h.observer.dispose();
		}
		const locked = fixture((prototype) => {
			Object.preventExtensions(prototype);
		});
		locked.session.getPlanModeState = () => ({ enabled: true });
		try {
			locked.receiver.setStreamStatus({ viewers: 0 });
			expect(locked.read("plan_mode", "stream_state")).toEqual({ plan_mode: "Plan" });
		} finally {
			locked.observer.dispose();
		}
	});

	it("shares repeated observers, supports out-of-order release, and restores only after the last reader", () => {
		let original: PropertyDescriptor | undefined;
		const h = fixture((prototype) => {
			original = Object.getOwnPropertyDescriptor(prototype, "setPlanModeStatus");
		});
		const second = observeOmpTemplateModes(h.NativeStatusline.prototype);
		const third = observeOmpTemplateModes(h.NativeStatusline.prototype);
		try {
			h.receiver.setPlanModeStatus({ enabled: false, paused: true });
			second.dispose();
			h.observer.dispose();
			expect(h.read("plan_mode")).toEqual({});
			expect(third.read(h.receiver, h.session, h.editor, new Set(["plan_mode"]))).toEqual({
				plan_mode: "Plan paused",
			});
			h.receiver.setPlanModeStatus(undefined);
			expect(third.read(h.receiver, h.session, h.editor, new Set(["plan_mode"]))).toEqual({});
		} finally {
			second.dispose();
			h.observer.dispose();
			third.dispose();
		}
		expect(
			Object.getOwnPropertyDescriptor(h.NativeStatusline.prototype, "setPlanModeStatus"),
		).toEqual(original);
		const reloaded = observeOmpTemplateModes(h.NativeStatusline.prototype);
		try {
			h.receiver.setPlanModeStatus({ enabled: true, paused: false });
			expect(reloaded.read(h.receiver, h.session, h.editor, new Set(["plan_mode"]))).toEqual({
				plan_mode: "Plan",
			});
		} finally {
			reloaded.dispose();
		}
	});

	it("ignores displaced observations and preserves foreign method and registry owners during cleanup", () => {
		const h = fixture();
		const registry = Symbol.for("pi-zentui.omp-template-mode-observers");
		const foreignRegistry = { owner: "foreign" };
		const foreignSetter = () => {};
		let second: OmpTemplateModeObserver | undefined;
		try {
			h.receiver.setPlanModeStatus({ enabled: false, paused: true });
			h.receiver.setStreamStatus({ viewers: 5 });
			h.receiver.setVibeWorkerTokenRateProvider(() => 7);
			h.session.getPlanModeState = () => ({ enabled: true });
			Object.defineProperty(h.NativeStatusline.prototype, "setPlanModeStatus", {
				configurable: true,
				writable: true,
				value: foreignSetter,
			});
			Object.defineProperty(h.NativeStatusline.prototype, "setVibeWorkerTokenRateProvider", {
				configurable: true,
				writable: true,
				value: foreignSetter,
			});
			second = observeOmpTemplateModes(h.NativeStatusline.prototype);
			expect(h.read("plan_mode", "stream_state")).toEqual({
				plan_mode: "Plan",
				stream_state: "live · 5 viewers",
			});
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			Object.defineProperty(h.NativeStatusline.prototype, registry, {
				configurable: true,
				value: foreignRegistry,
			});
		} finally {
			h.observer.dispose();
			second?.dispose();
		}
		expect(
			Object.getOwnPropertyDescriptor(h.NativeStatusline.prototype, "setPlanModeStatus")?.value,
		).toBe(foreignSetter);
		expect(Object.getOwnPropertyDescriptor(h.NativeStatusline.prototype, registry)?.value).toBe(
			foreignRegistry,
		);
		const foreign = observeOmpTemplateModes(h.NativeStatusline.prototype);
		try {
			expect(
				foreign.read(h.receiver, h.session, h.editor, new Set(["plan_mode", "stream_state"])),
			).toEqual({ plan_mode: "Plan" });
		} finally {
			foreign.dispose();
		}
	});

	it("preserves foreign accessor registries without evaluating them and falls back to public state", () => {
		const registry = Symbol.for("pi-zentui.omp-template-mode-observers");
		let registryReads = 0;
		const descriptor = {
			configurable: true,
			get() {
				registryReads++;
				throw new Error("foreign registry");
			},
		};
		const h = fixture((prototype) => {
			Object.defineProperty(prototype, registry, descriptor);
		});
		h.session.getPlanModeState = () => ({ enabled: true });
		try {
			h.receiver.setPlanModeStatus({ enabled: false, paused: true });
			expect(h.read("plan_mode")).toEqual({ plan_mode: "Plan" });
			expect(registryReads).toBe(0);
		} finally {
			h.observer.dispose();
		}
		expect(Object.getOwnPropertyDescriptor(h.NativeStatusline.prototype, registry)?.get).toBe(
			descriptor.get,
		);
	});

	it("does not read unrelated editor capabilities and guards throwing session identity getters", () => {
		const h = fixture();
		let editorReads = 0;
		Object.defineProperty(h.editor, "vimEnabled", {
			get() {
				editorReads++;
				return true;
			},
		});
		h.session.getPlanModeState = () => ({ enabled: true });
		try {
			expect(h.read("plan_mode")).toEqual({ plan_mode: "Plan" });
			expect(h.read("unknown")).toEqual({});
			expect(editorReads).toBe(0);
			h.session.sessionManager.getSessionId = () => {
				throw new Error("detached session");
			};
			expect(h.read("plan_mode", "vim_mode")).toEqual({});
			expect(h.observer.workerTokenRate(h.receiver, h.session)).toBeNull();
			expect(editorReads).toBe(0);
		} finally {
			h.observer.dispose();
		}
	});

	it("does not overwrite descriptor metadata claimed by a foreign owner on cleanup", () => {
		const h = fixture();
		const descriptor = Object.getOwnPropertyDescriptor(
			h.NativeStatusline.prototype,
			"setStreamStatus",
		);
		if (!descriptor) {
			h.observer.dispose();
			throw new Error("Native stream setter unavailable");
		}
		const claimed = { ...descriptor, enumerable: !descriptor.enumerable };
		try {
			h.receiver.setStreamStatus({ viewers: 2 });
			Object.defineProperty(h.NativeStatusline.prototype, "setStreamStatus", claimed);
			expect(h.read("stream_state")).toEqual({});
		} finally {
			h.observer.dispose();
		}
		expect(
			Object.getOwnPropertyDescriptor(h.NativeStatusline.prototype, "setStreamStatus"),
		).toEqual(claimed);
	});
});
