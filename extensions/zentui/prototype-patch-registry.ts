export const ZENTUI_PROTOTYPE_PATCH_REGISTRY = Symbol.for("pi-zentui.prototype-patch-registry");

type PrototypePatchAdapter =
	| "user-message-render"
	| "user-message-invalidate"
	| "selector-border-render"
	| "thinking-experimental-update-content";

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
	onDisplaced?: () => void;
};

type PatchMethod = "render" | "invalidate" | "updateContent";

type PatchRecord = {
	method: PatchMethod;
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

function deactivateRecord(record: PatchRecord, displaced = false): void {
	if (!record.registration) return;
	const registration = record.registration;
	const onDisplaced = registration.onDisplaced;
	registration.behavior = undefined;
	registration.onDisplaced = undefined;
	record.registration = undefined;
	if (displaced) {
		try {
			onDisplaced?.();
		} catch {
			// Registration handoff must not prevent the newer owner from installing.
		}
	}
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

export type PrototypePatchRegistration = (() => void) & Readonly<{ token: symbol }>;

function createCleanup(
	target: PatchTarget,
	adapter: PrototypePatchAdapter,
	registry: PatchRegistry,
	record: PatchRecord,
	token: symbol,
): PrototypePatchRegistration {
	let cleaned = false;
	const cleanup = () => {
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
	return Object.assign(cleanup, { token });
}

export function installPrototypePatch(
	targetValue: object,
	method: PatchMethod,
	adapter: PrototypePatchAdapter,
	behavior: PatchBehavior,
	onDisplaced?: () => void,
): PrototypePatchRegistration {
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
		if (displacedRecord && displacedRecord !== record) deactivateRecord(displacedRecord, true);
	}

	const previousRegistration = record.registration;
	const token = Symbol(adapter);
	record.registration = { token, behavior, onDisplaced };
	if (previousRegistration) {
		previousRegistration.behavior = undefined;
		try {
			previousRegistration.onDisplaced?.();
		} catch {
			// Registration handoff must not prevent the newer owner from installing.
		}
		previousRegistration.onDisplaced = undefined;
	}
	return createCleanup(target, adapter, registry, record, token);
}

export function isPrototypePatchCurrent(
	targetValue: object,
	method: PatchMethod,
	adapter: PrototypePatchAdapter,
	token?: symbol,
): boolean {
	const target = targetValue as PatchTarget;
	const record = existingRegistry(target)?.get(adapter);
	return Boolean(
		record &&
			record.method === method &&
			target[method] === record.wrapper &&
			(token === undefined || record.registration?.token === token),
	);
}

export function removePrototypePatch(
	targetValue: object,
	method: PatchMethod,
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
