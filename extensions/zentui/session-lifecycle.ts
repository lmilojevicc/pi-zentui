export class SessionLifecycle {
	private generation = 0;
	private active = false;
	private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();

	start(): number {
		this.cancelTimeouts();
		this.generation += 1;
		this.active = true;
		return this.generation;
	}

	currentGeneration(): number {
		return this.generation;
	}

	isCurrent(generation = this.generation): boolean {
		return this.active && generation === this.generation;
	}

	defer(callback: () => void): void {
		if (!this.active) return;
		const generation = this.generation;
		const timeout = setTimeout(() => {
			this.timeouts.delete(timeout);
			if (this.isCurrent(generation)) callback();
		}, 0);
		this.timeouts.add(timeout);
	}

	queueMicrotask(callback: () => void): () => void {
		let canceled = !this.active;
		const generation = this.generation;
		queueMicrotask(() => {
			if (!canceled && this.isCurrent(generation)) callback();
		});
		return () => {
			canceled = true;
		};
	}

	shutdown(): void {
		if (!this.active && this.timeouts.size === 0) return;
		this.active = false;
		this.generation += 1;
		this.cancelTimeouts();
	}

	private cancelTimeouts(): void {
		for (const timeout of this.timeouts) clearTimeout(timeout);
		this.timeouts.clear();
	}
}
