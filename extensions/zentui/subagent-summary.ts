import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { SubagentReader } from "./subagent-summary-rpc";
import { projectSubagentSummary, subagentSummaryLines } from "./subagent-summary-view";

const KEY = "zentui-subagent-summary";
export type SubagentSummaryStatus =
	| "disabled"
	| "checking"
	| "compatible"
	| "status unavailable"
	| "incompatible"
	| "unsupported context"
	| "disabled this session; not saved";
export type SubagentSummaryState = Readonly<{
	status: SubagentSummaryStatus;
	savedEnabled: boolean;
	effectiveEnabled: boolean;
}>;

export function supportsSubagentSummary(ctx: ExtensionContext): boolean {
	try {
		return ctx.hasUI && ctx.mode === "tui" && !process.env.PI_SUBAGENT_CHILD;
	} catch {
		return false;
	}
}

/** No resources until the owning extension's guarded session startup completes. */
export class SubagentSummaryController {
	private stop: (() => void) | undefined;
	private ctx: ExtensionContext | undefined;
	private suppressed = false;
	private status: SubagentSummaryStatus = "disabled";
	private generation = 0;
	constructor(
		private pi: Pick<ExtensionAPI, "events">,
		private enabled: () => boolean,
	) {}
	get state(): SubagentSummaryState {
		return { status: this.status, savedEnabled: this.enabled(), effectiveEnabled: !!this.stop };
	}
	startSession(ctx: ExtensionContext): void {
		this.dispose();
		this.suppressed = false;
		this.ctx = ctx;
		this.reconcile();
	}
	resetTree(): void {
		this.stopPolling();
		this.reconcile();
	}
	reconcile(): void {
		if (this.suppressed) return;
		if (!this.enabled()) {
			this.stopPolling();
			this.status = "disabled";
			return;
		}
		if (!this.ctx || !supportsSubagentSummary(this.ctx)) {
			this.stopPolling();
			this.status = "unsupported context";
			return;
		}
		if (this.stop) return;
		const generation = ++this.generation;
		this.status = "checking";
		this.stop = startSummary(this.pi, this.ctx, (status) => {
			if (generation === this.generation) this.status = status;
		});
	}
	setEnabled(enabled: boolean, save: () => void): { applied: boolean; reason?: string } {
		if (!enabled) {
			this.suppressed = true;
			this.stopPolling();
			this.status = "disabled this session; not saved";
		}
		try {
			save();
		} catch {
			return {
				applied: false,
				reason: enabled
					? "not saved; existing settings retained"
					: "disabled this session; not saved; existing settings retained",
			};
		}
		// Only an explicit successful enable or replacement session releases failed-off suppression.
		if (enabled) this.suppressed = false;
		else this.status = "disabled";
		this.reconcile();
		return {
			applied: true,
			...(enabled && this.status === "unsupported context"
				? { reason: "saved; requires a non-child TUI context with ctx.mode = tui" }
				: {}),
		};
	}
	private stopPolling(): void {
		this.generation++;
		const stop = this.stop;
		this.stop = undefined;
		stop?.();
	}
	dispose(): void {
		this.stopPolling();
		this.ctx = undefined;
		this.status = "disabled";
	}
}

/** Serial local reads: the next poll starts 1.5 seconds after settlement, including failure. */
export function startSummary(
	pi: Pick<ExtensionAPI, "events">,
	ctx: ExtensionContext,
	onStatus: (status: SubagentSummaryStatus) => void = () => {},
): () => void {
	const reader = new SubagentReader(pi.events);
	let live = true;
	let registered = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = "";
	const clear = () => {
		const owned = registered;
		registered = false;
		last = "";
		try {
			if (owned) ctx.ui.setWidget(KEY, undefined);
		} catch {
			/* Best-effort owned cleanup. */
		}
	};
	const poll = async () => {
		try {
			const data = await reader.read();
			if (!live) return;
			const projection = projectSubagentSummary(data, Date.now());
			onStatus(projection.compatible ? "compatible" : "incompatible");
			const lines = subagentSummaryLines(projection);
			if (!lines.length) clear();
			else {
				// Serialize only bounded, projected display strings, never the owner payload.
				const key = JSON.stringify(lines);
				if (key !== last) {
					ctx.ui.setWidget(
						KEY,
						(_tui, theme) => ({
							render: (width: number) =>
								width <= 0
									? []
									: lines.map((line, i) =>
											truncateToWidth(theme.fg(i === 0 ? "accent" : "dim", line), width),
										),
							invalidate() {},
						}),
						{ placement: "aboveEditor" },
					);
					registered = true;
					last = key;
				}
			}
		} catch {
			if (live) {
				onStatus("status unavailable");
				clear();
			}
		} finally {
			if (live) {
				timer = setTimeout(poll, 1500);
				timer.unref();
			}
		}
	};
	void poll();
	return () => {
		live = false;
		clearTimeout(timer);
		reader.dispose();
		clear();
	};
}
