import { randomUUID } from "node:crypto";

type Bus = {
	on(name: string, handler: (data: unknown) => void): (() => void) | undefined;
	emit(name: string, data: unknown): void;
};
export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readError(value: unknown): Error {
	// Never coerce arbitrary provider values: a throwing toString can strand a read
	// on Pi's exception-catching event bus after its timeout has been removed.
	let message: unknown;
	try {
		message = record(value).message;
	} catch {}
	return new Error(typeof message === "string" ? message.slice(0, 240) : "Subagent read failed");
}

/** Correlated local waits, not authentication, session validation, or owner-side cancellation. */
export class SubagentReader {
	private pending = new Set<() => void>();
	private closed = false;
	constructor(private bus: Bus) {}
	read(): Promise<Record<string, unknown>> {
		if (this.closed) return Promise.reject(new Error("Subagent view closed"));
		return new Promise((resolve, reject) => {
			const id = randomUUID();
			let settled = false;
			let off: (() => void) | undefined;
			const unsubscribe = () => {
				const cleanup = off;
				off = undefined;
				try {
					cleanup?.();
				} catch {
					/* Settlement must survive a broken bus. */
				}
			};
			const settle = (error?: Error, data?: Record<string, unknown>) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.pending.delete(cancel);
				unsubscribe();
				if (error) reject(error);
				else resolve(data ?? {});
			};
			const cancel = () => settle(new Error("Subagent view closed"));
			const timer = setTimeout(() => settle(new Error("Subagent status is unavailable")), 2500);
			timer.unref();
			this.pending.add(cancel);
			try {
				off = this.bus.on(`subagents:rpc:v1:reply:${id}`, (raw) => {
					if (settled) return;
					try {
						const reply = record(raw);
						if (
							reply.requestId !== id ||
							reply.version !== 1 ||
							(reply.method !== undefined && reply.method !== "status")
						)
							return;
						if (reply.success === true) settle(undefined, record(reply.data));
						else settle(readError(reply.error));
					} catch {
						settle(new Error("Subagent read failed"));
					}
				});
				// Also handle unusual buses that deliver during registration.
				if (settled) {
					unsubscribe();
					return;
				}
				this.bus.emit("subagents:rpc:v1:request", {
					version: 1,
					requestId: id,
					method: "status",
					params: {},
					source: { extension: "zentui-subagent-summary" },
				});
			} catch {
				settle(new Error("Subagent status is unavailable"));
			}
		});
	}
	dispose(): void {
		this.closed = true;
		for (const cancel of [...this.pending]) cancel();
	}
}
