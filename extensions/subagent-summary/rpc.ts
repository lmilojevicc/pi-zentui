type Bus = {
	on(name: string, handler: (data: unknown) => void): (() => void) | undefined;
	emit(name: string, data: unknown): void;
};
export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Read-only adapter to the installed owner's versioned protocol. No direct file or private-state access. */
export class SubagentReader {
	private pending = new Set<() => void>();
	private closed = false;
	constructor(private bus: Bus) {}
	read(params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		if (this.closed) return Promise.reject(new Error("Subagent view closed"));
		return new Promise((resolve, reject) => {
			const id = crypto.randomUUID();
			let off: (() => void) | undefined;
			const cleanup = () => {
				clearTimeout(timer);
				off?.();
				this.pending.delete(cancel);
			};
			const cancel = () => {
				cleanup();
				reject(new Error("Subagent view closed"));
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error("Subagent status is unavailable"));
			}, 2500);
			this.pending.add(cancel);
			off = this.bus.on(`subagents:rpc:v1:reply:${id}`, (raw) => {
				const reply = record(raw);
				if (reply.requestId !== id || reply.version !== 1) return;
				cleanup();
				if (reply.success === true) resolve(record(reply.data));
				else reject(new Error(String(record(reply.error).message ?? "Subagent read failed")));
			});
			try {
				this.bus.emit("subagents:rpc:v1:request", {
					version: 1,
					requestId: id,
					method: "status",
					params,
					source: { extension: "zentui-subagent-summary" },
				});
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	}
	dispose(): void {
		this.closed = true;
		for (const cancel of [...this.pending]) cancel();
	}
}

export type RunRow = {
	id: string;
	runId: string;
	childId?: string;
	label: string;
	state: string;
	action: string;
};
export function runRows(data: Record<string, unknown>): RunRow[] {
	const snapshot = record(data.asyncSnapshot);
	if (
		snapshot.kind !== "pi-subagents.async-status-snapshot" ||
		snapshot.version !== 1 ||
		!Array.isArray(snapshot.runs)
	)
		return [];
	return snapshot.runs.slice(0, 20).flatMap((raw) => {
		const run = record(raw);
		if (
			typeof run.id !== "string" ||
			!run.id ||
			run.id.length > 160 ||
			typeof run.label !== "string" ||
			typeof run.state !== "string"
		)
			return [];
		const tool = record(run.activity).currentTool;
		const result: RunRow[] = [
			{
				id: run.id,
				runId: run.id,
				label: run.label,
				state: run.state,
				action: typeof tool === "string" ? tool : "",
			},
		];
		if (Array.isArray(run.children))
			for (const value of run.children.slice(0, 8)) {
				const child = record(value);
				if (
					child.kind !== "step" ||
					typeof child.id !== "string" ||
					!child.id ||
					child.id.length > 160 ||
					typeof child.label !== "string" ||
					typeof child.state !== "string"
				)
					continue;
				const action = record(child.activity).currentTool;
				result.push({
					id: JSON.stringify([run.id, child.id]),
					runId: run.id,
					childId: child.id,
					label: `  ${child.label}`,
					state: child.state,
					action: typeof action === "string" ? action : "",
				});
			}
		return result;
	});
}
