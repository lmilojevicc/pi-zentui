import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";

export const ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR = Symbol.for("pi-zentui.accent-rail-layout-editor");
const ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY = Symbol.for("pi-zentui.accent-rail-layout-registry");
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

const SUPPORTED_PI_TUI_VERSION = /^0\.84\.\d+$/;

type AccentRailEditorMarker = {
	owner: symbol;
	active: () => boolean;
};

type MarkedEditor = {
	[ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR]?: AccentRailEditorMarker;
};

type StackEntry = {
	component?: unknown;
	minSize?: number;
	shrink?: number;
	[key: PropertyKey]: unknown;
};

type LayoutNode = {
	type?: unknown;
	entries?: unknown;
	[key: PropertyKey]: unknown;
};

type LayoutMethod = (this: unknown, ...args: unknown[]) => unknown;

type LayoutPatchRegistry = {
	method: symbol;
	predecessor: LayoutMethod;
	predecessorDescriptor?: PropertyDescriptor;
	wrapper: LayoutMethod;
	owners: Map<symbol, number>;
	active: boolean;
};

type PatchPrototype = Record<PropertyKey, unknown>;

type LayoutComponent = {
	render: (...args: unknown[]) => unknown;
	invalidate?: (...args: unknown[]) => unknown;
};

const forwardingComponents = new WeakMap<object, LayoutComponent>();

function forwardingLayoutComponent(component: object): LayoutComponent | undefined {
	const cached = forwardingComponents.get(component);
	if (cached) return cached;
	const render = (component as Partial<LayoutComponent>).render;
	if (typeof render !== "function") return undefined;
	try {
		const wrapper: LayoutComponent = {
			render: (...args: unknown[]) => {
				const rows = Reflect.apply(render, component, args);
				return Array.isArray(rows) && rows.length === 1 ? ["", rows[0]] : rows;
			},
			invalidate: (...args: unknown[]) => {
				const invalidate = (component as Partial<LayoutComponent>).invalidate;
				return typeof invalidate === "function"
					? Reflect.apply(invalidate, component, args)
					: undefined;
			},
		};
		forwardingComponents.set(component, wrapper);
		return wrapper;
	} catch {
		return undefined;
	}
}

export type AccentRailLayoutPatchTarget = {
	prototype: object;
	version: string;
	canonicalEntrypoint?: string;
	resolvedModulePath?: string;
	localModulePath?: string;
};

export type AccentRailLayoutPatchDiagnostic =
	| "installed"
	| "reused"
	| "displaced"
	| "unsupported-version"
	| "unsupported-shape"
	| "host-module-unavailable";

export type AccentRailLayoutPatchInstallation = {
	cleanup: () => void;
	diagnostic: AccentRailLayoutPatchDiagnostic;
	version?: string;
};

export type AccentRailLayoutPatchRetention = "retained" | "stale" | "failed";

export async function retainAccentRailLayoutPatchInstallation(
	install: () => Promise<AccentRailLayoutPatchInstallation>,
	isCurrent: () => boolean,
	retain: (installation: AccentRailLayoutPatchInstallation) => void,
): Promise<AccentRailLayoutPatchRetention> {
	let installation: AccentRailLayoutPatchInstallation;
	try {
		installation = await install();
	} catch {
		return "failed";
	}
	if (!isCurrent()) {
		installation.cleanup();
		return "stale";
	}
	try {
		retain(installation);
	} catch {
		installation.cleanup();
		return "failed";
	}
	return "retained";
}

function ownMarker(value: unknown): AccentRailEditorMarker | undefined {
	if (!value || typeof value !== "object") return undefined;
	if (!Object.hasOwn(value, ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR)) {
		return undefined;
	}
	const marker = (value as MarkedEditor)[ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR];
	return marker && typeof marker.owner === "symbol" && typeof marker.active === "function"
		? marker
		: undefined;
}

function entryMarker(entry: StackEntry): AccentRailEditorMarker | undefined {
	const component = entry.component;
	if (!component || typeof component !== "object") return undefined;
	if (!Object.hasOwn(component, "children")) return undefined;
	const children = (component as { children?: unknown }).children;
	if (!Array.isArray(children) || children.length !== 1) return undefined;
	return ownMarker(children[0]);
}

export function adjustAccentRailLayoutNode(
	node: unknown,
	activeOwners: ReadonlySet<symbol>,
): unknown {
	if (!node || typeof node !== "object") return node;
	const candidate = node as LayoutNode;
	if (candidate.type !== "vstack" || !Array.isArray(candidate.entries)) return node;

	const entries = candidate.entries as StackEntry[];
	const matches: number[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry?.minSize !== 3 || entry.shrink !== 1) continue;
		const marker = entryMarker(entry);
		if (!marker || !activeOwners.has(marker.owner)) continue;
		let active = false;
		try {
			active = marker.active() === true;
		} catch {
			return node;
		}
		if (active) matches.push(index);
	}
	if (matches.length !== 1) return node;

	const match = matches[0];
	const matchedEntry = entries[match];
	if (!matchedEntry?.component || typeof matchedEntry.component !== "object") return node;
	const component = forwardingLayoutComponent(matchedEntry.component);
	if (!component) return node;
	const nextEntries = entries.map((entry, index) =>
		index === match ? { ...entry, component } : entry,
	);
	return { ...candidate, entries: nextEntries };
}

export function markAccentRailLayoutEditor(
	editor: object,
	owner: symbol,
	active: () => boolean,
): boolean {
	try {
		Object.defineProperty(editor, ZENTUI_ACCENT_RAIL_LAYOUT_EDITOR, {
			value: { owner, active } satisfies AccentRailEditorMarker,
			configurable: true,
			enumerable: false,
			writable: false,
		});
		return true;
	} catch {
		return false;
	}
}

function registryOn(prototype: PatchPrototype): LayoutPatchRegistry | undefined {
	const value = prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY];
	if (!value || typeof value !== "object") return undefined;
	const registry = value as Partial<LayoutPatchRegistry>;
	return registry.owners instanceof Map && typeof registry.wrapper === "function"
		? (value as LayoutPatchRegistry)
		: undefined;
}

function discoverLayoutMethod(prototype: PatchPrototype): symbol | undefined {
	const symbols = new Set<PropertyKey>([LAYOUT_NODE, ...Object.getOwnPropertySymbols(prototype)]);
	for (const key of symbols) {
		const method = prototype[key];
		if (typeof method !== "function") continue;
		try {
			const receiver = Object.create(prototype) as Record<PropertyKey, unknown>;
			receiver.entries = [];
			receiver.layoutType = "vstack";
			receiver.gap = 0;
			receiver.align = "stretch";
			const node = Reflect.apply(method as LayoutMethod, receiver, []);
			if (
				node &&
				typeof node === "object" &&
				(node as LayoutNode).type === "vstack" &&
				Array.isArray((node as LayoutNode).entries)
			) {
				return key as symbol;
			}
		} catch {
			// Probe candidates fail open.
		}
	}
	return undefined;
}

function restorePredecessor(prototype: PatchPrototype, registry: LayoutPatchRegistry): void {
	if (prototype[registry.method] !== registry.wrapper) return;
	if (registry.predecessorDescriptor) {
		Object.defineProperty(prototype, registry.method, registry.predecessorDescriptor);
	} else {
		delete prototype[registry.method];
	}
}

function cleanupOwner(
	prototype: PatchPrototype,
	registry: LayoutPatchRegistry,
	owner: symbol,
): () => void {
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		const count = registry.owners.get(owner) ?? 0;
		if (count <= 1) registry.owners.delete(owner);
		else registry.owners.set(owner, count - 1);
		if (registry.owners.size > 0) return;

		// Deactivate before restoration. If a successor patch captured and later
		// restores our wrapper, the ownerless wrapper remains an inert pass-through.
		registry.active = false;
		if (registryOn(prototype) !== registry) return;
		restorePredecessor(prototype, registry);
		if (prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY] === registry) {
			delete prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY];
		}
	};
}

export function installAccentRailLayoutPatchOnTarget(
	target: AccentRailLayoutPatchTarget,
	owner: symbol,
): AccentRailLayoutPatchInstallation {
	if (!SUPPORTED_PI_TUI_VERSION.test(target.version)) {
		return { cleanup: () => {}, diagnostic: "unsupported-version", version: target.version };
	}
	const prototype = target.prototype as PatchPrototype;
	const existing = registryOn(prototype);
	if (existing) {
		if (existing.active && prototype[existing.method] === existing.wrapper) {
			existing.owners.set(owner, (existing.owners.get(owner) ?? 0) + 1);
			return {
				cleanup: cleanupOwner(prototype, existing, owner),
				diagnostic: "reused",
				version: target.version,
			};
		}

		// A later extension displaced the method. Never wrap that successor and
		// never leave our old wrapper active if the successor restores it later.
		existing.active = false;
		if (prototype[existing.method] !== existing.wrapper) {
			if (prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY] === existing) {
				delete prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY];
			}
			return { cleanup: () => {}, diagnostic: "displaced", version: target.version };
		}

		// An inactive wrapper restored by a former successor can be safely reduced
		// to its original predecessor before a fresh installation.
		restorePredecessor(prototype, existing);
		if (prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY] === existing) {
			delete prototype[ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY];
		}
	}

	const method = discoverLayoutMethod(prototype);
	if (!method) {
		return { cleanup: () => {}, diagnostic: "unsupported-shape", version: target.version };
	}
	const predecessorDescriptor = Object.getOwnPropertyDescriptor(prototype, method);
	const predecessor = prototype[method];
	if (typeof predecessor !== "function" || predecessorDescriptor?.configurable === false) {
		return { cleanup: () => {}, diagnostic: "unsupported-shape", version: target.version };
	}

	const registry: LayoutPatchRegistry = {
		method,
		predecessor: predecessor as LayoutMethod,
		predecessorDescriptor,
		wrapper: () => undefined,
		owners: new Map([[owner, 1]]),
		active: true,
	};
	registry.wrapper = function accentRailLayoutNodePatch(this: unknown, ...args: unknown[]) {
		const node = Reflect.apply(registry.predecessor, this, args);
		if (!registry.active || registry.owners.size === 0) return node;
		try {
			return adjustAccentRailLayoutNode(node, new Set(registry.owners.keys()));
		} catch {
			return node;
		}
	};
	try {
		Object.defineProperty(prototype, method, {
			...(predecessorDescriptor ?? {
				configurable: true,
				enumerable: false,
				writable: true,
			}),
			value: registry.wrapper,
		});
		Object.defineProperty(prototype, ZENTUI_ACCENT_RAIL_LAYOUT_REGISTRY, {
			value: registry,
			configurable: true,
			enumerable: false,
		});
	} catch {
		registry.active = false;
		restorePredecessor(prototype, registry);
		return { cleanup: () => {}, diagnostic: "unsupported-shape", version: target.version };
	}
	return {
		cleanup: cleanupOwner(prototype, registry, owner),
		diagnostic: "installed",
		version: target.version,
	};
}

type PackageLocation = {
	root: string;
	version: string;
};

function packageLocationFromEntry(
	entry: string,
	expectedName: string,
): PackageLocation | undefined {
	const root = parse(entry).root;
	let current = dirname(entry);
	while (current !== root) {
		try {
			const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as {
				name?: unknown;
				version?: unknown;
			};
			if (packageJson.name === expectedName && typeof packageJson.version === "string") {
				return { root: current, version: packageJson.version };
			}
		} catch {
			// Continue walking to the package root.
		}
		current = dirname(current);
	}
	return undefined;
}

function canonicalFile(path: string): string | undefined {
	try {
		const canonical = realpathSync(path);
		return statSync(canonical).isFile() ? canonical : undefined;
	} catch {
		return undefined;
	}
}

function localPiTuiPath(): string | undefined {
	try {
		return canonicalFile(createRequire(import.meta.url).resolve("@earendil-works/pi-tui"));
	} catch {
		return undefined;
	}
}

export async function discoverAccentRailLayoutPatchTargetFromEntrypoint(
	entrypoint: string,
): Promise<AccentRailLayoutPatchTarget | undefined> {
	try {
		const canonicalEntrypoint = canonicalFile(entrypoint);
		if (!canonicalEntrypoint) return undefined;
		if (!packageLocationFromEntry(canonicalEntrypoint, "@earendil-works/pi-coding-agent")) {
			return undefined;
		}

		const hostRequire = createRequire(canonicalEntrypoint);
		const unresolved = hostRequire.resolve("@earendil-works/pi-tui");
		const resolvedModulePath = canonicalFile(unresolved);
		if (!resolvedModulePath) return undefined;
		const packageLocation = packageLocationFromEntry(resolvedModulePath, "@earendil-works/pi-tui");
		if (!packageLocation || !SUPPORTED_PI_TUI_VERSION.test(packageLocation.version)) {
			return undefined;
		}

		const module = (await import(pathToFileURL(resolvedModulePath).href)) as {
			VStack?: { prototype?: object };
		};
		const prototype = module.VStack?.prototype;
		if (!prototype || !discoverLayoutMethod(prototype as PatchPrototype)) return undefined;

		return {
			prototype,
			version: packageLocation.version,
			canonicalEntrypoint,
			resolvedModulePath,
			localModulePath: localPiTuiPath(),
		};
	} catch {
		return undefined;
	}
}

export async function discoverHostAccentRailLayoutPatchTarget(): Promise<
	AccentRailLayoutPatchTarget | undefined
> {
	const entrypoint = process.argv[1];
	return entrypoint ? discoverAccentRailLayoutPatchTargetFromEntrypoint(entrypoint) : undefined;
}

export async function installHostAccentRailLayoutPatch(
	owner: symbol,
): Promise<AccentRailLayoutPatchInstallation> {
	const target = await discoverHostAccentRailLayoutPatchTarget();
	return target
		? installAccentRailLayoutPatchOnTarget(target, owner)
		: { cleanup: () => {}, diagnostic: "host-module-unavailable" };
}
