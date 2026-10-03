import { AsyncLocalStorage } from "node:async_hooks";
import type { ExtensionUIContext as PiUI } from "@earendil-works/pi-coding-agent";
import type { ExtensionUIContext, Theme } from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import { createOmpStatusline, type OmpStatuslineOptions } from "./omp-statusline";

export type OmpUiAdapterOptions = OmpStatuslineOptions;

export type OmpUiAdapter = {
	ui: PiUI;
	useUi(ui: ExtensionUIContext, options?: OmpUiAdapterOptions): void;
	runWithUi<T>(ui: ExtensionUIContext, callback: () => T): T;
	projectChanged(): void;
	dispose(): void;
};

type EditorFactory = NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]>;
const OMP_UI_ADAPTER = Symbol.for("pi-zentui.omp-ui-adapter");

/** OMP wraps and binds UI methods per handler; descriptors identify the shared host object. */
export function createOmpUiAdapter(
	native: ExtensionUIContext,
	options?: OmpUiAdapterOptions,
): OmpUiAdapter {
	const attached: unknown = Object.getOwnPropertyDescriptor(native, OMP_UI_ADAPTER)?.value;
	if (
		attached &&
		typeof attached === "object" &&
		"useUi" in attached &&
		typeof attached.useUi === "function"
	) {
		// This private symbol stores only the adapter installed by this module.
		const existing = attached as OmpUiAdapter;
		existing.useUi(native, options);
		return existing;
	}
	let scopedUi = native;
	const handlerScope = new AsyncLocalStorage<ExtensionUIContext>();
	let factory: EditorFactory | undefined;
	let editor: { getExpandedText?(): string } | undefined;
	let known = true;
	let active = true;
	const statuses = new Map<string, string>();
	const branchListeners = new Set<() => void>();
	let environment: { tui: TUI; theme: Theme } | undefined;
	const getEnvironment = () => {
		if (environment || !active) return environment;
		// OMP's footer setter is intentionally inert. The public widget factory
		// supplies the real render environment synchronously; the empty acquisition
		// component is removed before returning, never used as a footer slot.
		const key = "zentui.statusline-environment";
		try {
			scopedUi.setWidget(key, (tui, theme) => {
				environment = { tui, theme };
				return { render: () => [], invalidate() {} };
			});
		} finally {
			scopedUi.setWidget(key, undefined);
		}
		return environment;
	};
	const statusline = createOmpStatusline(
		getEnvironment,
		statuses,
		branchListeners,
		() =>
			active &&
			Object.getOwnPropertyDescriptor(native, "setEditorComponent")?.value === setEditorComponent,
	);
	statusline.useOptions(options ?? {});
	const setterDescriptor = Object.getOwnPropertyDescriptor(native, "setEditorComponent");
	const statusDescriptor = Object.getOwnPropertyDescriptor(native, "setStatus");
	const predecessor = native.setEditorComponent;
	const statusPredecessor = native.setStatus;
	const setEditorComponent: ExtensionUIContext["setEditorComponent"] = function (
		this: ExtensionUIContext,
		next,
	) {
		if (!active) return Reflect.apply(predecessor, this, [next]);
		statusline.editorChanged();
		let nextEditor: typeof editor;
		// Zentui's synchronous constructor observes the factory while the host builds it.
		factory = next;
		editor = undefined;
		known = true;
		try {
			const result = Reflect.apply(predecessor, this, [
				next
					? (...args: Parameters<EditorFactory>) => {
							const instance = next(...args);
							nextEditor = instance;
							return instance;
						}
					: undefined,
			]);
			editor = nextEditor;
			known = true;
			return result;
		} catch (error) {
			known = false;
			editor = undefined;
			throw error;
		}
	};
	const setStatus: ExtensionUIContext["setStatus"] = function (
		this: ExtensionUIContext,
		key,
		text,
	) {
		const result = Reflect.apply(statusPredecessor, this, [key, text]);
		if (active) {
			if (text === undefined) statuses.delete(key);
			else statuses.set(key, text);
		}
		return result;
	};
	if (setterDescriptor?.writable && setterDescriptor.configurable) {
		Object.defineProperty(native, "setEditorComponent", {
			...setterDescriptor,
			value: setEditorComponent,
		});
	} else {
		known = false;
	}
	if (statusDescriptor?.writable && statusDescriptor.configurable) {
		Object.defineProperty(native, "setStatus", { ...statusDescriptor, value: setStatus });
	}
	const ui = new Proxy(native, {
		get(_target, key) {
			const contextUi = handlerScope.getStore() ?? scopedUi;
			if (key === "getEditorComponent")
				return () => {
					if (
						!active ||
						!known ||
						Object.getOwnPropertyDescriptor(native, "setEditorComponent")?.value !==
							setEditorComponent
					) {
						throw new Error("Oh My Pi editor ownership is no longer observable");
					}
					return factory;
				};
			if (key === "getEditorText")
				return () => {
					if (
						active &&
						known &&
						Object.getOwnPropertyDescriptor(native, "setEditorComponent")?.value ===
							setEditorComponent &&
						editor?.getExpandedText
					) {
						return editor.getExpandedText();
					}
					return contextUi.getEditorText();
				};
			// Bypass a scoped proxy's cached predecessor after replacing the shared descriptor.
			if (key === "setEditorComponent" || key === "setStatus") {
				return Object.getOwnPropertyDescriptor(native, key)?.value ?? Reflect.get(contextUi, key);
			}
			if (key === "setFooter") return statusline.setFooter;
			return Reflect.get(contextUi, key);
		},
	}) as unknown as PiUI;
	const adapter: OmpUiAdapter = {
		ui,
		useUi(current, nextOptions) {
			scopedUi = current;
			if (nextOptions) statusline.useOptions(nextOptions);
		},
		runWithUi(current, callback) {
			return handlerScope.run(current, callback);
		},
		projectChanged() {
			if (active) for (const listener of branchListeners) listener();
		},
		dispose() {
			try {
				statusline.dispose();
			} finally {
				active = false;
				handlerScope.disable();
				branchListeners.clear();
				statuses.clear();
				editor = undefined;
				if (
					setterDescriptor &&
					Object.getOwnPropertyDescriptor(native, "setEditorComponent")?.value ===
						setEditorComponent
				) {
					Object.defineProperty(native, "setEditorComponent", setterDescriptor);
				}
				if (
					statusDescriptor &&
					Object.getOwnPropertyDescriptor(native, "setStatus")?.value === setStatus
				) {
					Object.defineProperty(native, "setStatus", statusDescriptor);
				}
				if (Object.getOwnPropertyDescriptor(native, OMP_UI_ADAPTER)?.value === adapter)
					Reflect.deleteProperty(native, OMP_UI_ADAPTER);
			}
		},
	};
	Object.defineProperty(native, OMP_UI_ADAPTER, { value: adapter, configurable: true });
	return adapter;
}
