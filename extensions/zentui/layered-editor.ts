/**
 * Records that a Zentui editor instance is still visible beneath a foreign predecessor-preserving
 * wrapper (`setEditorComponent((tui, theme, kb) => predecessor(tui, theme, kb))`).
 *
 * This is deliberately NOT installation ownership: Zentui does not own the outer factory, must not
 * replace or restore it, and keeps this record across ownership clearing. It only answers
 * "may a surface Zentui rendered still be on screen?" for read-only consumers such as usage demand
 * and redraw requests. The record is valid only while the outer factory observed at construction is
 * still the current editor factory, so any replacement of the chain invalidates it.
 */
export class LayeredEditorConsumer<Factory> {
	private record?: { outerFactory: Factory; generation: number; requestRender: () => void };

	constructor(private readonly isCurrentGeneration: (generation: number) => boolean) {}

	attach(outerFactory: Factory, generation: number, requestRender: () => void): void {
		this.record = { outerFactory, generation, requestRender };
	}

	detach(): void {
		this.record = undefined;
	}

	isVisibleThrough(currentFactory: Factory | undefined): boolean {
		const record = this.record;
		if (!record) return false;
		if (!this.isCurrentGeneration(record.generation) || record.outerFactory !== currentFactory) {
			this.record = undefined;
			return false;
		}
		return true;
	}

	requestRender(currentFactory: Factory | undefined): void {
		if (this.isVisibleThrough(currentFactory)) this.record?.requestRender();
	}
}
