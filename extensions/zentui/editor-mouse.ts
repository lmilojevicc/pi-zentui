// Structural subset keeps mouse support optional on Pi versions before 0.85.
export type EditorMouseEvent = {
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
};
export type EditorMouseResult = {
	handled?: boolean;
	capture?: boolean;
	focus?: boolean;
	render?: boolean;
};
export type EditorMouseHandler = (event: EditorMouseEvent) => EditorMouseResult | undefined;

type Cell = { x: number; y: number };
export type EditorMouseLayout = { body: Cell[]; completion: Cell[] };
type RowTranslation = { x: number; y: number };
const layouts = new WeakMap<string[], EditorMouseLayout>();
const translations = new WeakMap<string[], Map<number, RowTranslation>>();

/** Record only rows actually emitted, never infer positions from terminal text. */
export function rememberEditorMouseLayout(
	lines: string[],
	baseLines: string[],
	bodyCount: number,
	completionCount: number,
	layout: EditorMouseLayout,
): void {
	const base = layouts.get(baseLines) ?? {
		body: Array.from({ length: bodyCount }, (_, index) => ({ x: 0, y: index + 1 })),
		completion: Array.from({ length: completionCount }, (_, index) => ({
			x: 0,
			y: bodyCount + 2 + index,
		})),
	};
	const rows = new Map<number, RowTranslation>();
	for (const section of ["body", "completion"] as const) {
		layout[section].forEach((cell, index) => {
			const source = base[section][index];
			if (source) rows.set(cell.y, { x: source.x - cell.x, y: source.y - cell.y });
		});
	}
	layouts.set(lines, layout);
	translations.set(lines, rows);
}

export function editorMouseCells(count: number, x: number, y: number): Cell[] {
	return Array.from({ length: count }, (_, index) => ({ x, y: y + index }));
}

export class EditorMouseForwarder {
	private width?: number;
	private height?: number;
	private rows?: Map<number, RowTranslation>;
	private pendingBounds?: { width: number; height: number };
	private captured?: RowTranslation;

	baseRendered(width: number, lines: string[]): string[] {
		this.pendingBounds = { width, height: lines.length };
		return lines;
	}

	rendered(lines: string[]): string[] {
		this.width = this.pendingBounds?.width;
		this.height = this.pendingBounds?.height;
		this.rows = translations.get(lines);
		return lines;
	}

	forward(
		receiver: object,
		handler: EditorMouseHandler,
		event: EditorMouseEvent,
	): EditorMouseResult | undefined {
		const row = this.rows ? (this.rows.get(event.y) ?? this.captured) : undefined;
		if (this.rows && !row) return undefined;
		const translated =
			this.width === undefined
				? event
				: {
						...event,
						x: event.x + (row?.x ?? 0),
						y: event.y + (row?.y ?? 0),
						width: this.width,
						height: this.height ?? event.height,
					};
		const result = handler.call(receiver, translated);
		if (result?.capture) this.captured = row ?? { x: 0, y: 0 };
		if (event.type === "release") this.captured = undefined;
		return result;
	}
}
