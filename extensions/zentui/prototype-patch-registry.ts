export const ZENTUI_PROTOTYPE_PATCH_REGISTRY = Symbol.for("pi-zentui.prototype-patch-registry");

type PrototypePatchAdapter =
	| "user-message-render"
	| "user-message-invalidate"
	| "selector-border-render";

type PrototypeMethod = (this: unknown, ...args: unknown[]) => unknown;

type PatchInvocation = {
	predecessor: PrototypeMethod;
	receiver: unknown;
	args: unknown[];
};

type PatchBehavior = (invocation: PatchInvocation) => unknown;

type Registration = {
	token: symbol;
	behavior?: PatchBehavior;
};

type PatchRecord = {
	method: "render" | "invalidate";
	predecessor: PrototypeMethod;
	predecessorDescriptor?: PropertyDescriptor;
	wrapper: PrototypeMethod;
	registration?: Registration;
};

type PatchRegistry = Map<PrototypePatchAdapter, PatchRecord>;

type PatchTarget = Record<PropertyKey, unknown>;

function existingRegistry(target: PatchTarget): PatchRegistry | undefined {
	const existing = target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
	return existing instanceof Map ? (existing as PatchRegistry) : undefined;
}

function registryFor(target: PatchTarget): PatchRegistry {
	const existing = existingRegistry(target);
	if (existing) return existing;
	const registry: PatchRegistry = new Map();
	Object.defineProperty(target, ZENTUI_PROTOTYPE_PATCH_REGISTRY, {
		value: registry,
		configurable: true,
	});
	return registry;
}

function deactivateRecord(record: PatchRecord): void {
	if (!record.registration) return;
	record.registration.behavior = undefined;
	record.registration = undefined;
}

function restorePredecessor(target: PatchTarget, record: PatchRecord): void {
	if (target[record.method] !== record.wrapper) return;
	if (record.predecessorDescriptor) {
		Object.defineProperty(target, record.method, record.predecessorDescriptor);
	} else {
		delete target[record.method];
	}
}

function installWrapper(target: PatchTarget, record: PatchRecord): void {
	const descriptor = record.predecessorDescriptor;
	if (descriptor && "value" in descriptor) {
		Object.defineProperty(target, record.method, { ...descriptor, value: record.wrapper });
		return;
	}
	Object.defineProperty(target, record.method, {
		value: record.wrapper,
		writable: true,
		enumerable: descriptor?.enumerable ?? true,
		configurable: true,
	});
}

function createCleanup(
	target: PatchTarget,
	adapter: PrototypePatchAdapter,
	registry: PatchRegistry,
	record: PatchRecord,
	token: symbol,
): () => void {
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		if (record.registration?.token !== token) return;
		deactivateRecord(record);

		const current = registry.get(adapter);
		if (current !== record) return;
		restorePredecessor(target, record);
		registry.delete(adapter);
		if (registry.size === 0) delete target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
	};
}

export function installPrototypePatch(
	targetValue: object,
	method: "render" | "invalidate",
	adapter: PrototypePatchAdapter,
	behavior: PatchBehavior,
): () => void {
	const target = targetValue as PatchTarget;
	const registry = registryFor(target);
	let record = registry.get(adapter);

	if (!(record && record.method === method && target[method] === record.wrapper)) {
		const displacedRecord = record;
		const predecessorDescriptor = Object.getOwnPropertyDescriptor(target, method);
		const predecessor = target[method];
		if (typeof predecessor !== "function") {
			if (registry.size === 0) delete target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
			throw new TypeError(`Cannot patch ${method}: predecessor is not a function`);
		}
		const nextRecord: PatchRecord = {
			method,
			predecessor: predecessor as PrototypeMethod,
			predecessorDescriptor,
			wrapper: () => undefined,
		};
		const wrapper: PrototypeMethod = function zentuiPrototypeWrapper(
			this: unknown,
			...args: unknown[]
		): unknown {
			const activeBehavior = nextRecord.registration?.behavior;
			return activeBehavior
				? activeBehavior({ predecessor: nextRecord.predecessor, receiver: this, args })
				: Reflect.apply(nextRecord.predecessor, this, args);
		};
		nextRecord.wrapper = wrapper;
		try {
			installWrapper(target, nextRecord);
		} catch (error) {
			if (registry.size === 0) delete target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
			throw error;
		}
		record = nextRecord;
		registry.set(adapter, record);
		if (displacedRecord && displacedRecord !== record) deactivateRecord(displacedRecord);
	}

	const token = Symbol(adapter);
	record.registration = { token, behavior };
	return createCleanup(target, adapter, registry, record, token);
}

export function removePrototypePatch(
	targetValue: object,
	method: "render" | "invalidate",
	adapter: PrototypePatchAdapter,
): void {
	const target = targetValue as PatchTarget;
	const registry = existingRegistry(target);
	const record = registry?.get(adapter);
	if (!registry || !record || record.method !== method) return;

	deactivateRecord(record);
	restorePredecessor(target, record);
	registry.delete(adapter);
	if (registry.size === 0) delete target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
}
