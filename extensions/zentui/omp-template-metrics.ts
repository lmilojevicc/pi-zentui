import { hostname } from "node:os";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { calculateTokensPerSecond } from "@oh-my-pi/pi-coding-agent/utils/token-rate";
import { formatElapsedDuration } from "./format";
import type { HostTemplateValues, HostTemplateVariable } from "./host-template-values";

export type OmpTemplateMetricsSource = {
	receiver: object;
	session: object;
	workerTokenRate?: number | null;
};

let machineHostname: string | undefined;

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function nonnegative(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= Number.MAX_SAFE_INTEGER
	);
}

/** Read public native metrics; never substitute session age for active work. */
export function readOmpTemplateMetrics(
	ctx: { sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionId"> },
	names: ReadonlySet<string>,
	source?: OmpTemplateMetricsSource,
): HostTemplateValues {
	const values: Partial<Record<HostTemplateVariable, string>> = {};
	if (names.has("session_id")) {
		try {
			const id = ctx.sessionManager.getSessionId();
			if (typeof id === "string" && id) values.session_id = id;
		} catch {
			// An unavailable session identity stays absent, not the session name.
		}
	}
	if (names.has("hostname")) {
		try {
			machineHostname ??= hostname();
			if (machineHostname) values.hostname = machineHostname;
		} catch {
			// Hostname is optional and must not break another metadata field.
		}
	}
	if (!source) return values;
	const receiver = object(source.receiver) ? source.receiver : undefined;
	const session = object(source.session) ? source.session : undefined;
	if (receiver && names.has("subagent_count")) {
		try {
			const count = receiver.subagentCount;
			if (nonnegative(count) && Number.isSafeInteger(count)) values.subagent_count = String(count);
		} catch {
			// Read the native badge getter; background jobs are a different count.
		}
	}
	if (receiver && names.has("active_time")) {
		try {
			if (typeof receiver.getActiveMs === "function") {
				const elapsed: unknown = receiver.getActiveMs();
				if (nonnegative(elapsed)) values.active_time = formatElapsedDuration(elapsed);
			}
		} catch {
			// No wall-clock or current-turn fallback for native active time.
		}
	}
	if (session && names.has("token_rate")) {
		try {
			const state = object(session.state) ? session.state : undefined;
			const messages = state?.messages ?? session.messages;
			if (Array.isArray(messages) && typeof session.isStreaming === "boolean") {
				// The verified native session exposes the public message-array contract.
				const nativeMessages = messages as Parameters<typeof calculateTokensPerSecond>[0];
				const main = calculateTokensPerSecond(nativeMessages, session.isStreaming);
				const worker = source.workerTokenRate;
				const rate = nonnegative(worker)
					? worker + (session.isStreaming && nonnegative(main) ? main : 0)
					: main;
				if (nonnegative(rate)) values.token_rate = `${rate.toFixed(1)} tok/s`;
			}
		} catch {
			// Unknown timings/output or unfamiliar message shapes remain empty.
		}
	}
	return values;
}
