/**
 * Records that a Zentui editor instance is still visible beneath a foreign predecessor-preserving
 * wrapper (`setEditorComponent((tui, theme, kb) => predecessor(tui, theme, kb))`).
 *
 * This is deliberately NOT installation ownership: Zentui does not own the outer factory, must not
 * replace or restore it, and keeps this record across ownership clearing. It only answers
 * "may a surface Zentui rendered still be on screen?" for read-only consumers such as usage demand
 * and redraw requests. The record is valid only while the outer factory observed at construction is
 * still the current editor factory, so any replacement of the chain invalidates it.
 *
 * Visibility is only evidence that a wrapper constructed the editor, not that its rows reach the
 * screen, so surfaces that mutate host UI (for example hiding the native Working row) must keep
 * requiring exclusive installation ownership instead of consulting this record.
 */
export class LayeredEditorConsumer<Factory, Editor = unknown> {
	private record?: {
		outerFactory: Factory;
		generation: number;
		editor: Editor;
		requestRender: () => void;
	};

	constructor(private readonly isCurrentGeneration: (generation: number) => boolean) {}

	attach(
		outerFactory: Factory,
		generation: number,
		editor: Editor,
		requestRender: () => void,
	): void {
		this.record = { outerFactory, generation, editor, requestRender };
	}

	detach(): void {
		this.record = undefined;
	}

	editorVisibleThrough(currentFactory: Factory | undefined): Editor | undefined {
		const record = this.record;
		if (!record) return undefined;
		if (!this.isCurrentGeneration(record.generation) || record.outerFactory !== currentFactory) {
			this.record = undefined;
			return undefined;
		}
		return record.editor;
	}

	isVisibleThrough(currentFactory: Factory | undefined): boolean {
		return this.editorVisibleThrough(currentFactory) !== undefined;
	}

	requestRender(currentFactory: Factory | undefined): void {
		if (this.isVisibleThrough(currentFactory)) this.record?.requestRender();
	}
}
