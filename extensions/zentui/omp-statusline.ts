import { stripVTControlCharacters } from "node:util";
import type { ExtensionUIContext as PiUI } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import type { HostTemplateValues } from "./host-template-values";

export type OmpStatuslineOptions = {
	statusLinePrototype?: object;
	getSessionId?: () => string | undefined;
	getHookStatusSnapshot?: (receiver: object) => OmpHookStatusSnapshot | undefined;
	onProjectChanged?: () => void;
	getHostTemplateValues?: (
		receiver: object,
		session: object,
		names: ReadonlySet<string>,
		editor: object,
	) => HostTemplateValues | undefined;
};

export type OmpHookStatusSnapshot = {
	statuses: ReadonlyMap<string, string>;
	revision: number;
};
export type OmpHookStatusObserver = {
	getSnapshot(receiver: object): OmpHookStatusSnapshot | undefined;
	dispose(): void;
};

type FooterFactory = NonNullable<Parameters<PiUI["setFooter"]>[0]>;
type Footer = { render(width: number): string[]; invalidate(): void; dispose?(): void };
type Environment = { tui: TUI; theme: Theme };
type Method = (this: unknown, ...args: unknown[]) => unknown;
type MountedEditor = { composerFacts: unknown; isAutocompleteActive(): boolean };
type Association = { editor: MountedEditor; ancestors: Record<PropertyKey, unknown>[] };
type Owner = {
	matches(receiver: unknown): MountedEditor | undefined;
	render(width: number, editor: MountedEditor): readonly string[] | undefined;
	facts(editor: MountedEditor): unknown;
	syncStatuses(receiver: object): void;
	branchChanged(): void;
};
const METHODS = [
	"render",
	"getTopBorder",
	"getBandTopBorder",
	"getStandaloneTopBorder",
	"describeComposerFacts",
	"getPreviewLines",
	"invalidateGitCaches",
] as const;
type MethodName = (typeof METHODS)[number];
type Patch = { name: MethodName; descriptor: PropertyDescriptor; wrapper: Method };
type Bundle = { owners: Set<Owner>; patches: Patch[]; current(): boolean };
const REGISTRY = Symbol.for("pi-zentui.omp-statusline-renderers");
const EMPTY_LINES: readonly string[] = [];
const HOOK_REGISTRY = Symbol.for("pi-zentui.omp-hook-status-observers");
type HookBundle = {
	count: number;
	snapshots: WeakMap<
		object,
		{
			session: unknown;
			sessionId: unknown;
			snapshot: OmpHookStatusSnapshot;
		}
	>;
	descriptor: PropertyDescriptor;
	current(): boolean;
};
const EMPTY_BORDER = Object.freeze({ content: "", width: 0, revision: -1 });
const EMPTY_TEXT = Object.freeze({ k: "text", p: { text: "", wrap: "none" } });

function object(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

/** Public component tree + ComposerFactsSource identity, never constructor names. */
function mountedEditor(root: unknown, receiver?: unknown, depth = 0): Association | undefined {
	if (!object(root) || depth > 32) return undefined;
	if (
		object(root.composerFacts) &&
		(receiver === undefined || root.composerFacts === receiver) &&
		typeof root.isAutocompleteActive === "function"
	)
		return { editor: root as unknown as MountedEditor, ancestors: [] };
	if (Array.isArray(root.children)) {
		// The composer is near the end; do not traverse the retained transcript first.
		for (let index = root.children.length - 1; index >= 0; index--) {
			const found = mountedEditor(root.children[index], receiver, depth + 1);
			if (found) {
				found.ancestors.unshift(root);
				return found;
			}
		}
	}
	return undefined;
}

/** Observe only successful public native publications; never inspect the native status map. */
export function observeOmpHookStatuses(prototype: object): OmpHookStatusObserver | undefined {
	const existing: unknown = Object.getOwnPropertyDescriptor(prototype, HOOK_REGISTRY)?.value;
	if (
		existing &&
		(!object(existing) ||
			typeof existing.current !== "function" ||
			!(existing.snapshots instanceof WeakMap) ||
			typeof existing.count !== "number")
	)
		return undefined;
	let bundle = existing as HookBundle | undefined;
	if (bundle && !bundle.current()) return undefined;
	if (!bundle) {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, "setHookStatus");
		if (
			!Object.isExtensible(prototype) ||
			!descriptor?.configurable ||
			!descriptor.writable ||
			typeof descriptor.value !== "function"
		)
			return undefined;
		const predecessor = descriptor.value as Method;
		const snapshots: HookBundle["snapshots"] = new WeakMap();
		const wrapper: Method = function (...args) {
			const result = Reflect.apply(predecessor, this, args);
			if (
				installed.count > 0 &&
				installed.current() &&
				object(this) &&
				typeof args[0] === "string" &&
				(args[1] === undefined || typeof args[1] === "string")
			) {
				const session = Object.getOwnPropertyDescriptor(this, "session")?.value;
				let sessionId: unknown;
				try {
					if (
						object(session) &&
						object(session.sessionManager) &&
						typeof session.sessionManager.getSessionId === "function"
					)
						sessionId = session.sessionManager.getSessionId();
				} catch {
					return result;
				}
				let observed = snapshots.get(this);
				if (!observed || observed.session !== session || observed.sessionId !== sessionId) {
					observed = {
						session,
						sessionId,
						snapshot: { statuses: new Map<string, string>(), revision: 0 },
					};
					snapshots.set(this, observed);
				}
				const statuses = observed.snapshot.statuses as Map<string, string>;
				if (args[1] === undefined) statuses.delete(args[0]);
				else statuses.set(args[0], args[1]);
				observed.snapshot.revision++;
			}
			return result;
		};
		bundle = {
			count: 0,
			snapshots,
			descriptor,
			current: () => Object.getOwnPropertyDescriptor(prototype, "setHookStatus")?.value === wrapper,
		};
		const installed = bundle;
		try {
			Object.defineProperty(prototype, "setHookStatus", { ...descriptor, value: wrapper });
			Object.defineProperty(prototype, HOOK_REGISTRY, { value: installed, configurable: true });
		} catch {
			if (installed.current()) Object.defineProperty(prototype, "setHookStatus", descriptor);
			return undefined;
		}
	}
	const installed = bundle;
	installed.count++;
	let active = true;
	return {
		getSnapshot(receiver) {
			if (!active || !installed.current()) return undefined;
			const observed = installed.snapshots.get(receiver);
			if (!observed) return undefined;
			const session = Object.getOwnPropertyDescriptor(receiver, "session")?.value;
			try {
				const sessionId =
					object(session) &&
					object(session.sessionManager) &&
					typeof session.sessionManager.getSessionId === "function"
						? session.sessionManager.getSessionId()
						: undefined;
				if (observed.session === session && observed.sessionId === sessionId)
					return observed.snapshot;
			} catch {
				return undefined;
			}
			installed.snapshots.delete(receiver);
			return undefined;
		},
		dispose() {
			if (!active) return;
			active = false;
			if (--installed.count > 0) return;
			if (installed.current()) {
				try {
					Object.defineProperty(prototype, "setHookStatus", installed.descriptor);
				} catch {
					// An unremovable wrapper with no observers delegates without caching.
				}
			}
			if (Object.getOwnPropertyDescriptor(prototype, HOOK_REGISTRY)?.value === installed)
				Reflect.deleteProperty(prototype, HOOK_REGISTRY);
		},
	};
}

function register(prototype: object, owner: Owner): (() => void) | undefined {
	const existing: unknown = Object.getOwnPropertyDescriptor(prototype, REGISTRY)?.value;
	if (
		existing &&
		(!object(existing) ||
			typeof existing.current !== "function" ||
			!(existing.owners instanceof Set) ||
			!Array.isArray(existing.patches))
	)
		return undefined;
	let bundle = existing as Bundle | undefined;
	if (bundle && !bundle.current()) return undefined;
	if (!bundle) {
		if (!Object.isExtensible(prototype)) return undefined;
		const descriptors = METHODS.map((name) => Object.getOwnPropertyDescriptor(prototype, name));
		if (
			descriptors.some(
				(descriptor) =>
					!descriptor?.configurable ||
					!descriptor.writable ||
					typeof descriptor.value !== "function",
			)
		)
			return undefined;
		const owners = new Set<Owner>();
		const patches: Patch[] = [];
		const previews = new WeakSet<object>();
		const hookMethod = Object.getOwnPropertyDescriptor(prototype, "setHookStatus")?.value;
		bundle = {
			owners,
			patches,
			current: () =>
				Object.getOwnPropertyDescriptor(prototype, "setHookStatus")?.value === hookMethod &&
				patches.every(
					(patch) =>
						Object.getOwnPropertyDescriptor(prototype, patch.name)?.value === patch.wrapper,
				),
		};
		const installed = bundle;
		for (const [index, name] of METHODS.entries()) {
			const descriptor = descriptors[index];
			if (!descriptor) return undefined;
			const predecessor = descriptor.value as Method;
			const wrapper: Method = function (...args) {
				if (!installed.current() || !object(this) || previews.has(this))
					return Reflect.apply(predecessor, this, args);
				if (name === "getPreviewLines") {
					previews.add(this);
					try {
						return Reflect.apply(predecessor, this, args);
					} finally {
						previews.delete(this);
					}
				}
				for (const current of owners) {
					const editor = current.matches(this);
					if (!editor) continue;
					current.syncStatuses(this);
					if (name === "invalidateGitCaches") {
						const result = Reflect.apply(predecessor, this, args);
						current.branchChanged();
						return result;
					}
					if (name === "render") {
						const lines = current.render(args[0] as number, editor);
						if (lines !== undefined) return lines;
					} else if (name === "describeComposerFacts") {
						const facts = current.facts(editor);
						if (facts !== undefined) return facts;
					} else if (args[1] === undefined && current.render(0, editor) !== undefined) {
						return EMPTY_BORDER;
					}
				}
				return Reflect.apply(predecessor, this, args);
			};
			patches.push({ name, descriptor, wrapper });
		}
		try {
			for (const patch of patches)
				Object.defineProperty(prototype, patch.name, { ...patch.descriptor, value: patch.wrapper });
			Object.defineProperty(prototype, REGISTRY, { value: installed, configurable: true });
		} catch {
			for (const patch of patches) {
				if (Object.getOwnPropertyDescriptor(prototype, patch.name)?.value === patch.wrapper)
					Object.defineProperty(prototype, patch.name, patch.descriptor);
			}
			return undefined;
		}
	}
	bundle.owners.add(owner);
	const installed = bundle;
	return () => {
		installed.owners.delete(owner);
		if (installed.owners.size) return;
		for (const patch of installed.patches) {
			if (Object.getOwnPropertyDescriptor(prototype, patch.name)?.value !== patch.wrapper) continue;
			try {
				Object.defineProperty(prototype, patch.name, patch.descriptor);
			} catch {
				// A later owner may have frozen our descriptor. The owner set is
				// already empty, so even an unremovable wrapper delegates natively.
			}
		}
		if (Object.getOwnPropertyDescriptor(prototype, REGISTRY)?.value === installed)
			Reflect.deleteProperty(prototype, REGISTRY);
	};
}

export function createOmpStatusline(
	getEnvironment: () => Environment | undefined,
	statuses: Map<string, string>,
	branchListeners: Set<() => void>,
	canRetainEditor: () => boolean,
) {
	let options: OmpStatuslineOptions = {};
	let cleanup: (() => void) | undefined;
	let footer: Footer | undefined;
	let factory: FooterFactory | undefined;
	let sessionId: string | undefined;
	let disposed = false;
	let observation: OmpHookStatusObserver | undefined;
	let association:
		| (Association & { receiver: object; tui: TUI; session: object; id: string })
		| undefined;
	let snapshot: OmpHookStatusSnapshot | undefined;
	let snapshotRevision = -1;
	const owner: Owner = {
		matches(receiver) {
			if (disposed || !object(receiver)) return undefined;
			try {
				if (
					!options.statusLinePrototype ||
					!Object.prototype.isPrototypeOf.call(options.statusLinePrototype, receiver)
				)
					return undefined;
				const expected = options.getSessionId?.();
				if (!expected) {
					association = undefined;
					return undefined;
				}
				if (sessionId !== expected) {
					sessionId = expected;
					statuses.clear();
					association = undefined;
					snapshot = undefined;
					snapshotRevision = -1;
				}
				// OMP exports the renderer but not its session accessor. This is the one
				// private-runtime boundary: require an own data field and the public
				// StatusLineSession.sessionManager.getSessionId contract; fail open otherwise.
				const session = Object.getOwnPropertyDescriptor(receiver, "session")?.value;
				if (
					!object(session) ||
					!object(session.sessionManager) ||
					typeof session.sessionManager.getSessionId !== "function"
				) {
					if (association?.receiver === receiver) association = undefined;
					return undefined;
				}
				if (session.sessionManager.getSessionId() !== expected) {
					if (association?.receiver === receiver) association = undefined;
					return undefined;
				}
				const environment = getEnvironment();
				if (!environment) return undefined;
				if (association?.receiver === receiver) {
					const retained = association;
					const { ancestors, editor } = retained;
					if (
						retained.id === expected &&
						retained.session === session &&
						retained.tui === environment.tui &&
						editor.composerFacts === receiver &&
						Object.is(ancestors[0], environment.tui) &&
						ancestors.every(
							(parent, index) =>
								index === ancestors.length - 1 ||
								(Array.isArray(parent.children) && parent.children.includes(ancestors[index + 1])),
						)
					) {
						const container = ancestors[ancestors.length - 1];
						if (
							container &&
							Array.isArray(container.children) &&
							container.children.includes(editor)
						)
							return editor;
						const replacement = mountedEditor(container);
						if (!replacement && canRetainEditor()) return editor; // Temporary modal unmount.
						if (replacement?.editor === editor) return editor;
					}
					association = undefined;
				}
				const found = mountedEditor(environment.tui, receiver);
				if (!found) return undefined;
				association = { ...found, receiver, tui: environment.tui, session, id: expected };
				return found.editor;
			} catch {
				if (association?.receiver === receiver) association = undefined;
				return undefined;
			}
		},
		render(width, editor) {
			if (!factory || !cleanup) return undefined;
			if (width <= 0 || editor.isAutocompleteActive()) return EMPTY_LINES;
			return footer?.render(width) ?? EMPTY_LINES;
		},
		facts(editor) {
			if (!factory || !cleanup) return undefined;
			const width = getEnvironment()?.tui.terminal.columns ?? 0;
			const lines = owner.render(width, editor) ?? EMPTY_LINES;
			// TSP omits the ANSI status slot. Its supported composer extras carry
			// plain semantic text; native model/context/usage labels are suppressed.
			// OMP still owns the model-picker chip's icon/action chrome.
			return {
				context: EMPTY_TEXT,
				model: { spans: [] },
				usage: EMPTY_TEXT,
				extras: {
					k: "col",
					p: { role: "zentui.statusline" },
					c: lines.map((line) => ({
						k: "text",
						p: { text: stripVTControlCharacters(line), wrap: "none" },
					})),
				},
			};
		},
		syncStatuses(receiver) {
			const next = options.getHookStatusSnapshot?.(receiver) ?? observation?.getSnapshot(receiver);
			if (!next || (snapshot === next && snapshotRevision === next.revision)) return;
			statuses.clear();
			for (const [key, text] of next.statuses) statuses.set(key, text);
			snapshot = next;
			snapshotRevision = next.revision;
		},
		branchChanged() {
			for (const listener of branchListeners) listener();
			options.onProjectChanged?.();
		},
	};
	return {
		useOptions(next: OmpStatuslineOptions) {
			if (disposed) return;
			let nextId: string | undefined;
			try {
				nextId = next.getSessionId?.();
			} catch {
				nextId = undefined;
			}
			if (sessionId !== nextId) {
				statuses.clear();
				association = undefined;
				snapshot = undefined;
				snapshotRevision = -1;
			}
			sessionId = nextId;
			if (options.statusLinePrototype !== next.statusLinePrototype) {
				cleanup?.();
				cleanup = undefined;
				observation?.dispose();
				observation = undefined;
				association = undefined;
				snapshot = undefined;
				if (next.statusLinePrototype) {
					try {
						observation = observeOmpHookStatuses(next.statusLinePrototype);
						if (observation) cleanup = register(next.statusLinePrototype, owner);
					} catch {
						cleanup = undefined;
					}
				}
			}
			options = next;
		},
		getHostTemplateValues(names: ReadonlySet<string>): HostTemplateValues | undefined {
			if (disposed || !options.getHostTemplateValues) return undefined;
			try {
				let receiver: unknown = association?.receiver;
				if (!receiver || !owner.matches(receiver)) {
					receiver = mountedEditor(getEnvironment()?.tui)?.editor.composerFacts;
					if (!object(receiver) || !owner.matches(receiver)) return undefined;
				}
				if (!object(receiver) || !association) return undefined;
				return options.getHostTemplateValues(
					receiver,
					association.session,
					names,
					association.editor,
				);
			} catch {
				return undefined;
			}
		},
		requestRender() {
			if (disposed) return;
			try {
				getEnvironment()?.tui.requestRender();
			} catch {
				// An unavailable render environment must not break async metadata updates.
			}
		},
		editorChanged() {
			association = undefined;
		},
		setFooter(next: Parameters<PiUI["setFooter"]>[0]) {
			const previous = footer;
			footer = undefined;
			factory = undefined;
			const environment = previous || (next && cleanup) ? getEnvironment() : undefined;
			try {
				previous?.dispose?.();
			} finally {
				environment?.tui.requestRender();
			}
			if (disposed || !next || !cleanup || !environment) return;
			const mounted = mountedEditor(environment.tui);
			const receiver = mounted?.editor.composerFacts;
			if (object(receiver) && owner.matches(receiver)) owner.syncStatuses(receiver);
			const nextFooter = Reflect.apply(next, undefined, [
				environment.tui,
				environment.theme,
				{
					getExtensionStatuses: () => statuses,
					onBranchChange(listener: () => void) {
						branchListeners.add(listener);
						return () => {
							branchListeners.delete(listener);
						};
					},
				},
			]) as Footer;
			footer = nextFooter;
			factory = next;
			environment.tui.requestRender();
		},
		dispose() {
			disposed = true;
			const previous = footer;
			association = undefined;
			footer = undefined;
			factory = undefined;
			try {
				previous?.dispose?.();
			} finally {
				cleanup?.();
				cleanup = undefined;
				observation?.dispose();
				observation = undefined;
				if (previous) getEnvironment()?.tui.requestRender();
			}
		},
	};
}
