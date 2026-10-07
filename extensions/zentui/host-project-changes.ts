/** Runtime-local synchronous invalidation only; subscribers defer any process work themselves. */
export class HostProjectChanges {
	private readonly listeners = new Set<() => void>();
	private disposed = false;
	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	notify(): void {
		if (this.disposed) return;
		for (const listener of [...this.listeners]) {
			if (!this.listeners.has(listener)) continue;
			try {
				listener();
			} catch {
				/* One unavailable owner must not block another. */
			}
		}
	}
	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
	}
}
