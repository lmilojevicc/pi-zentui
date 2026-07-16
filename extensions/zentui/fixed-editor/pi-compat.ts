/** Verified private Pi TUI capabilities required by the experimental fixed editor. @internal */
export type PiMethodCapability = {
	target: Record<PropertyKey, unknown>;
	key: "render" | "doRender" | "write";
	method: (...args: unknown[]) => unknown;
	ownDescriptor: PropertyDescriptor | undefined;
};

export type PiRenderableCapability = {
	target: Record<PropertyKey, unknown>;
	render: (width: number) => string[];
	ownDescriptor: PropertyDescriptor | undefined;
};

export type PiFixedCluster = {
	status: PiRenderableCapability | null;
	aboveWidget: PiRenderableCapability | null;
	editor: PiRenderableCapability;
	belowWidget: PiRenderableCapability | null;
	footer: PiRenderableCapability | null;
};

export type PiFixedEditorCapabilities = {
	tui: Record<PropertyKey, unknown>;
	terminal: Record<PropertyKey, unknown>;
	cluster: PiFixedCluster;
	renderMethod: PiMethodCapability;
	doRenderMethod: PiMethodCapability;
	writeMethod: PiMethodCapability;
	rowsOwnDescriptor: PropertyDescriptor | undefined;
	readRawRows: () => number;
	getColumns: () => number;
	hasVisibleOverlay: () => boolean;
	getCursorBookkeeping: () => { hardwareCursorRow: number; previousViewportTop: number };
	addInputListener: (
		listener: (data: string) => { consume?: boolean; data?: string } | undefined,
	) => unknown;
	removeInputListener: (
		listener: (data: string) => { consume?: boolean; data?: string } | undefined,
	) => void;
	requestRender?: (force?: boolean) => void;
};

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

function ownDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
	return Object.getOwnPropertyDescriptor(target, key);
}

function descriptorInChain(target: object, key: PropertyKey): PropertyDescriptor | undefined {
	let current: object | null = target;
	while (current) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor) return descriptor;
		current = Object.getPrototypeOf(current);
	}
	return undefined;
}

function writableMethod(
	target: Record<PropertyKey, unknown>,
	key: PiMethodCapability["key"],
): PiMethodCapability | undefined {
	const method = Reflect.get(target, key);
	if (typeof method !== "function") return undefined;
	const descriptor = ownDescriptor(target, key);
	if (descriptor) {
		if (!("value" in descriptor) || descriptor.writable !== true) return undefined;
	} else if (!Object.isExtensible(target)) {
		return undefined;
	}
	return {
		target,
		key,
		method: method as (...args: unknown[]) => unknown,
		ownDescriptor: descriptor,
	};
}

function renderable(value: unknown): PiRenderableCapability | undefined {
	if (!isRecord(value)) return undefined;
	const method = writableMethod(value, "render");
	if (!method) return undefined;
	return {
		target: value,
		render: method.method as (width: number) => string[],
		ownDescriptor: method.ownDescriptor,
	};
}

function isEditorLike(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof Reflect.get(value, "getText") === "function" &&
		typeof Reflect.get(value, "setText") === "function" &&
		typeof Reflect.get(value, "handleInput") === "function"
	);
}

function containerChildren(value: unknown): unknown[] | undefined {
	if (!isRecord(value)) return undefined;
	const children = Reflect.get(value, "children");
	return Array.isArray(children) ? children : undefined;
}

export function findEditorContainerIndex(
	children: unknown[],
	focusedComponent?: unknown,
): number | undefined {
	if (focusedComponent && isRecord(focusedComponent)) {
		const focusedIndex = children.findIndex(
			(child) => renderable(child) && containerChildren(child)?.includes(focusedComponent),
		);
		if (focusedIndex !== -1) return focusedIndex;
	}
	const index = children.findIndex(
		(child) => renderable(child) && containerChildren(child)?.some(isEditorLike),
	);
	return index === -1 ? undefined : index;
}

function clusterCapability(children: unknown[], editorIndex: number): PiFixedCluster | undefined {
	const editor = renderable(children[editorIndex]);
	if (!editor) return undefined;
	const optional = (index: number): PiRenderableCapability | null | undefined => {
		if (index < 0 || index >= children.length) return null;
		return renderable(children[index]);
	};
	const status = optional(editorIndex - 2);
	const aboveWidget = optional(editorIndex - 1);
	const belowWidget = optional(editorIndex + 1);
	const footer = optional(editorIndex + 2);
	if (
		status === undefined ||
		aboveWidget === undefined ||
		belowWidget === undefined ||
		footer === undefined
	) {
		return undefined;
	}
	return { status, aboveWidget, editor, belowWidget, footer };
}

function readRowsValue(
	terminal: Record<PropertyKey, unknown>,
	descriptor: PropertyDescriptor,
): unknown {
	return descriptor.get
		? descriptor.get.call(terminal)
		: "value" in descriptor
			? descriptor.value
			: Reflect.get(terminal, "rows");
}

function rowsReader(
	terminal: Record<PropertyKey, unknown>,
	descriptor: PropertyDescriptor,
	fallback: number,
): () => number {
	return () => {
		try {
			const value = readRowsValue(terminal, descriptor);
			return typeof value === "number" && Number.isFinite(value) ? value : fallback;
		} catch {
			return fallback;
		}
	};
}

function inspectPiTuiUnsafe(value: unknown): PiFixedEditorCapabilities | undefined {
	if (!isRecord(value)) return undefined;
	const terminalValue = Reflect.get(value, "terminal");
	if (!isRecord(terminalValue)) return undefined;

	const renderMethod = writableMethod(value, "render");
	const doRenderMethod = writableMethod(value, "doRender");
	const writeMethod = writableMethod(terminalValue, "write");
	if (!renderMethod || !doRenderMethod || !writeMethod) return undefined;

	const addInputListenerValue = Reflect.get(value, "addInputListener");
	const removeInputListenerValue = Reflect.get(value, "removeInputListener");
	if (
		typeof addInputListenerValue !== "function" ||
		typeof removeInputListenerValue !== "function"
	) {
		return undefined;
	}
	const children = Reflect.get(value, "children");
	if (!Array.isArray(children) || children.length < 3) return undefined;
	const editorIndex = findEditorContainerIndex(children, Reflect.get(value, "focusedComponent"));
	if (editorIndex === undefined) return undefined;
	const cluster = clusterCapability(children, editorIndex);
	if (!cluster) return undefined;

	const rowsOwnDescriptor = ownDescriptor(terminalValue, "rows");
	if (
		rowsOwnDescriptor
			? rowsOwnDescriptor.configurable !== true
			: !Object.isExtensible(terminalValue)
	) {
		return undefined;
	}
	const rowsDescriptor = descriptorInChain(terminalValue, "rows");
	if (!rowsDescriptor) return undefined;
	const initialRows = readRowsValue(terminalValue, rowsDescriptor);
	if (typeof initialRows !== "number" || !Number.isFinite(initialRows)) return undefined;
	const columns = Reflect.get(terminalValue, "columns");
	if (typeof columns !== "number" || !Number.isFinite(columns)) return undefined;

	const hasOverlayValue = Reflect.get(value, "hasOverlay");
	const overlayStackValue = Reflect.get(value, "overlayStack");
	if (typeof hasOverlayValue !== "function" && !Array.isArray(overlayStackValue)) return undefined;
	const hardwareCursorRow = Reflect.get(value, "hardwareCursorRow");
	const previousViewportTop = Reflect.get(value, "previousViewportTop");
	if (
		typeof hardwareCursorRow !== "number" ||
		!Number.isFinite(hardwareCursorRow) ||
		typeof previousViewportTop !== "number" ||
		!Number.isFinite(previousViewportTop)
	) {
		return undefined;
	}

	const requestRenderValue = Reflect.get(value, "requestRender");
	return {
		tui: value,
		terminal: terminalValue,
		cluster,
		renderMethod,
		doRenderMethod,
		writeMethod,
		rowsOwnDescriptor,
		readRawRows: rowsReader(terminalValue, rowsDescriptor, initialRows),
		getColumns: () => {
			try {
				const current = Reflect.get(terminalValue, "columns");
				return typeof current === "number" && Number.isFinite(current) ? current : columns;
			} catch {
				return columns;
			}
		},
		hasVisibleOverlay: () => {
			try {
				if (
					typeof hasOverlayValue === "function" &&
					Reflect.apply(hasOverlayValue, value, []) === true
				) {
					return true;
				}
				const stack = Reflect.get(value, "overlayStack");
				return (
					Array.isArray(stack) && stack.some((entry) => isRecord(entry) && entry.hidden !== true)
				);
			} catch {
				return true;
			}
		},
		getCursorBookkeeping: () => {
			try {
				const currentHardwareCursorRow = Reflect.get(value, "hardwareCursorRow");
				const currentViewportTop = Reflect.get(value, "previousViewportTop");
				return {
					hardwareCursorRow:
						typeof currentHardwareCursorRow === "number" &&
						Number.isFinite(currentHardwareCursorRow)
							? currentHardwareCursorRow
							: hardwareCursorRow,
					previousViewportTop:
						typeof currentViewportTop === "number" && Number.isFinite(currentViewportTop)
							? currentViewportTop
							: previousViewportTop,
				};
			} catch {
				return { hardwareCursorRow, previousViewportTop };
			}
		},
		addInputListener: (listener) => Reflect.apply(addInputListenerValue, value, [listener]),
		removeInputListener: (listener) => {
			Reflect.apply(removeInputListenerValue, value, [listener]);
		},
		requestRender:
			typeof requestRenderValue === "function"
				? (force) => Reflect.apply(requestRenderValue, value, [force])
				: undefined,
	};
}

export function inspectPiTui(value: unknown): PiFixedEditorCapabilities | undefined {
	try {
		return inspectPiTuiUnsafe(value);
	} catch {
		return undefined;
	}
}
