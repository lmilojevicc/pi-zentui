import type { HostTemplateValues } from "./host-template-values";

export type OmpTemplateModeObserver = {
	read(
		receiver: object,
		session: object,
		editor: object,
		names: ReadonlySet<string>,
	): HostTemplateValues;
	workerTokenRate(receiver: object, session: object): number | null;
	dispose(): void;
};

type ModeName =
	| "plan_mode"
	| "goal_mode"
	| "vibe_mode"
	| "loop_mode"
	| "vim_mode"
	| "collaboration"
	| "stream_state";
type Field = ModeName | "workerTokenRate";
type Method = (this: unknown, ...args: unknown[]) => unknown;
type Patch = { name: string; field: Field; descriptor: PropertyDescriptor; wrapper: Method };
type Snapshot = { session: object; sessionId: string; values: Map<Field, string | Method | null> };
type Bundle = { count: number; patches: Patch[]; snapshots: WeakMap<object, Snapshot> };
const REGISTRY = Symbol.for("pi-zentui.omp-template-mode-observers");
const SETTERS = [
	["setPlanModeStatus", "plan_mode"],
	["setGoalModeStatus", "goal_mode"],
	["setVibeModeStatus", "vibe_mode"],
	["setLoopModeStatus", "loop_mode"],
	["setVimStatus", "vim_mode"],
	["setCollabStatus", "collaboration"],
	["setStreamStatus", "stream_state"],
	["setVibeWorkerTokenRateProvider", "workerTokenRate"],
] as const;
const NAMES = [...SETTERS.map(([, field]) => field), "prewalk_mode"] as const;

function object(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function callable(value: unknown): value is Method {
	return typeof value === "function";
}

function sharedBundle(value: unknown): value is Bundle {
	return (
		object(value) &&
		Number.isSafeInteger(value.count) &&
		typeof value.count === "number" &&
		value.count > 0 &&
		value.snapshots instanceof WeakMap &&
		Array.isArray(value.patches) &&
		value.patches.every(
			(patch) =>
				object(patch) &&
				object(patch.descriptor) &&
				callable(patch.wrapper) &&
				SETTERS.some(([name, field]) => patch.name === name && patch.field === field),
		)
	);
}

function identity(
	receiver: object,
	expected?: object,
): { session: object; sessionId: string } | undefined {
	try {
		const session: unknown = Object.getOwnPropertyDescriptor(receiver, "session")?.value;
		if (!object(session) || (expected !== undefined && session !== expected)) return undefined;
		const manager = session.sessionManager;
		if (!object(manager) || typeof manager.getSessionId !== "function") return undefined;
		const sessionId: unknown = manager.getSessionId();
		if (typeof sessionId !== "string" || !sessionId) return undefined;
		return { session, sessionId };
	} catch {
		return undefined;
	}
}

function owns(prototype: object, patch: Patch): boolean {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, patch.name);
		return (
			descriptor?.value === patch.wrapper &&
			descriptor.configurable === patch.descriptor.configurable &&
			descriptor.writable === patch.descriptor.writable &&
			descriptor.enumerable === patch.descriptor.enumerable
		);
	} catch {
		return false;
	}
}

function vimMode(value: unknown): string | null {
	return value === "insert" || value === "normal" || value === "visual" || value === "visual-line"
		? value
		: null;
}

function published(field: Field, value: unknown): string | Method | null {
	if (field === "workerTokenRate") return callable(value) ? value : null;
	if (!object(value)) return null;
	switch (field) {
		case "plan_mode":
		case "goal_mode": {
			if (typeof value.enabled !== "boolean" || typeof value.paused !== "boolean") return null;
			const label = field === "plan_mode" ? "Plan" : "Goal";
			return value.paused ? `${label} paused` : value.enabled ? label : null;
		}
		case "vibe_mode":
			return value.enabled === true ? "Vibe" : null;
		case "loop_mode":
			return value.state === "waiting" || value.state === "running" || value.state === "paused"
				? `Loop ${value.state}`
				: null;
		case "vim_mode":
			return vimMode(value.mode);
		case "collaboration":
			return (value.role === "host" || value.role === "guest") &&
				typeof value.participantCount === "number" &&
				Number.isSafeInteger(value.participantCount) &&
				value.participantCount > 0
				? `${value.role} · ${value.participantCount} participants`
				: null;
		case "stream_state":
			return typeof value.viewers === "number" &&
				Number.isSafeInteger(value.viewers) &&
				value.viewers >= 0
				? `live · ${value.viewers} viewers`
				: null;
	}
}

function getter(session: object, name: string): unknown {
	try {
		const method = object(session) ? session[name] : undefined;
		return callable(method) ? Reflect.apply(method, session, []) : undefined;
	} catch {
		return undefined;
	}
}

function fallback(session: object, field: ModeName | "prewalk_mode"): string | null {
	try {
		if (field === "prewalk_mode")
			return object(getter(session, "getPrewalkState")) ? "Prewalk" : null;
		const method =
			field === "plan_mode"
				? "getPlanModeState"
				: field === "goal_mode"
					? "getGoalModeState"
					: field === "vibe_mode"
						? "getVibeModeState"
						: undefined;
		if (!method) return null;
		const value = getter(session, method);
		if (!object(value) || typeof value.enabled !== "boolean") return null;
		if (
			field === "goal_mode" &&
			!value.enabled &&
			object(value.goal) &&
			value.goal.status === "paused"
		)
			return "Goal paused";
		return value.enabled
			? field === "plan_mode"
				? "Plan"
				: field === "goal_mode"
					? "Goal"
					: "Vibe"
			: null;
	} catch {
		return null;
	}
}

/**
 * Plan/Goal/Vibe belong to a conversation. Loop, stream, collaboration, Vim, and
 * the dynamic worker-rate callback belong to this native UI receiver and survive
 * its session/focus changes. They are never shared with a different receiver.
 */
function scopedSnapshot(
	observed: Snapshot | undefined,
	current: { session: object; sessionId: string },
): Snapshot {
	if (!observed) return { ...current, values: new Map() };
	if (observed.session !== current.session || observed.sessionId !== current.sessionId) {
		observed.values.delete("plan_mode");
		observed.values.delete("goal_mode");
		observed.values.delete("vibe_mode");
		observed.session = current.session;
		observed.sessionId = current.sessionId;
	}
	return observed;
}

/** Observe successful public publications without reading or changing native private state. */
export function observeOmpTemplateModes(prototype: object): OmpTemplateModeObserver {
	let bundle: Bundle | undefined;
	try {
		const registry = Object.getOwnPropertyDescriptor(prototype, REGISTRY);
		const existing: unknown = registry?.value;
		if (sharedBundle(existing)) {
			bundle = existing;
		} else if (registry === undefined && Object.isExtensible(prototype)) {
			const installed: Bundle = { count: 0, patches: [], snapshots: new WeakMap() };
			Object.defineProperty(prototype, REGISTRY, { value: installed, configurable: true });
			bundle = installed;
			for (const [name, field] of SETTERS) {
				try {
					const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
					const predecessor: unknown = descriptor?.value;
					if (!descriptor?.configurable || !descriptor.writable || !callable(predecessor)) continue;
					const wrapper: Method = function (...args) {
						const result = Reflect.apply(predecessor, this, args);
						try {
							if (installed.count <= 0 || !owns(prototype, patch) || !object(this)) return result;
							const current = identity(this);
							if (!current) return result;
							const snapshot = scopedSnapshot(installed.snapshots.get(this), current);
							installed.snapshots.set(this, snapshot);
							// Invalid successful publications also hide older data, rather than retaining stale labels.
							snapshot.values.set(field, published(field, args[0]));
						} catch {
							// Observation must never change a successful native call's result.
							if (object(this)) installed.snapshots.get(this)?.values.set(field, null);
						}
						return result;
					};
					const patch: Patch = { name, field, descriptor, wrapper };
					Object.defineProperty(prototype, name, { ...descriptor, value: wrapper });
					installed.patches.push(patch);
				} catch {
					// An unsafe setter disables only that observed capability.
				}
			}
		}
	} catch {
		// A locked or foreign registry still permits concrete public getter fallbacks.
	}
	const installed = bundle;
	if (installed) installed.count++;
	let active = true;
	function snapshot(
		receiver: object,
		current: { session: object; sessionId: string } | undefined,
	): Snapshot | undefined {
		if (!current) return undefined;
		const observed = installed?.snapshots.get(receiver);
		return observed ? scopedSnapshot(observed, current) : undefined;
	}
	function observedValue(
		observed: Snapshot | undefined,
		field: Field,
	): string | Method | null | undefined {
		const patch = installed?.patches.find((candidate) => candidate.field === field);
		return patch && owns(prototype, patch) ? observed?.values.get(field) : undefined;
	}
	return {
		read(receiver, session, editor, names) {
			const values: Partial<Record<ModeName | "prewalk_mode", string>> = {};
			if (!active || !NAMES.some((name) => name !== "workerTokenRate" && names.has(name)))
				return values;
			const current = identity(receiver, session);
			if (!current) return values;
			const observed = snapshot(receiver, current);
			for (const name of NAMES) {
				if (name === "workerTokenRate" || !names.has(name)) continue;
				let value: string | Method | null | undefined;
				if (name === "vim_mode") {
					try {
						if (object(editor)) {
							const enabled = editor.vimEnabled;
							if (typeof enabled === "boolean") value = enabled ? vimMode(editor.vimMode) : null;
						}
					} catch {
						/* Missing or throwing capabilities permit the observed fallback. */
					}
				}
				if (value === undefined && name !== "prewalk_mode") value = observedValue(observed, name);
				if (value === undefined) value = fallback(session, name);
				if (typeof value === "string") values[name] = value;
			}
			return values;
		},
		workerTokenRate(receiver, session) {
			if (!active) return null;
			const provider = observedValue(
				snapshot(receiver, identity(receiver, session)),
				"workerTokenRate",
			);
			if (typeof provider !== "function") return null;
			try {
				const rate: unknown = Reflect.apply(provider, undefined, []);
				return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : null;
			} catch {
				return null;
			}
		},
		dispose() {
			if (!active) return;
			active = false;
			if (!installed || --installed.count > 0) return;
			for (const patch of installed.patches) {
				if (!owns(prototype, patch)) continue;
				try {
					Object.defineProperty(prototype, patch.name, patch.descriptor);
				} catch {
					/* A locked wrapper becomes inert. */
				}
			}
			try {
				if (Object.getOwnPropertyDescriptor(prototype, REGISTRY)?.value === installed)
					Reflect.deleteProperty(prototype, REGISTRY);
			} catch {
				/* Preserve a foreign or locked registry owner. */
			}
		},
	};
}
