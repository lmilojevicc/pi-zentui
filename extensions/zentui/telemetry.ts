import { type BigIntStats, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export type FooterTelemetry = {
	subscription?: boolean;
	autoCompaction?: boolean;
};

type SettingsManagerLike = {
	drainErrors?: () => unknown[];
	getCompactionEnabled?: () => unknown;
};

type SettingsManagerFactory = {
	create?: (
		cwd: string,
		agentDir?: string,
		options?: { projectTrusted?: boolean },
	) => SettingsManagerLike;
};

export type TelemetryCapabilities = {
	settingsManager?: SettingsManagerFactory;
};

export type TelemetryDemand = {
	subscription: boolean;
	autoCompaction: boolean;
};

type SnapshotCapabilities = TelemetryCapabilities & {
	getAgentDir?: () => string;
	stat?: (path: string) => Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs">;
};

function resolveSubscription(ctx: ExtensionContext): boolean | undefined {
	const model = ctx.model;
	if (!model) return undefined;
	if (model.provider === "kimi-coding") return true;

	try {
		const registry = ctx.modelRegistry as {
			isUsingOAuth?: (candidate: typeof model) => unknown;
		};
		if (typeof registry?.isUsingOAuth !== "function") return undefined;
		const result = registry.isUsingOAuth(model);
		return typeof result === "boolean" ? result : undefined;
	} catch {
		return undefined;
	}
}

function resolveAutoCompaction(
	ctx: ExtensionContext,
	factory: SettingsManagerFactory | undefined,
): boolean | undefined {
	try {
		const isProjectTrusted = (
			ctx as ExtensionContext & {
				isProjectTrusted?: () => unknown;
			}
		).isProjectTrusted;
		if (typeof factory?.create !== "function" || typeof isProjectTrusted !== "function") {
			return undefined;
		}
		const trusted = isProjectTrusted.call(ctx);
		if (typeof trusted !== "boolean") return undefined;
		return readAutoCompaction(factory.create(ctx.cwd, undefined, { projectTrusted: trusted }));
	} catch {
		return undefined;
	}
}

/** Resolve optional Pi telemetry without depending on private session or TUI fields. */
export function resolveFooterTelemetry(
	ctx: ExtensionContext,
	capabilities: TelemetryCapabilities = {},
): FooterTelemetry {
	const settingsManager = capabilities.settingsManager ?? SettingsManager;
	return {
		subscription: resolveSubscription(ctx),
		autoCompaction: resolveAutoCompaction(ctx, settingsManager),
	};
}

function readAutoCompaction(settings: SettingsManagerLike): boolean | undefined {
	if (
		typeof settings?.drainErrors !== "function" ||
		typeof settings.getCompactionEnabled !== "function"
	) {
		return undefined;
	}
	if (settings.drainErrors().length > 0) return undefined;
	const enabled = settings.getCompactionEnabled();
	return typeof enabled === "boolean" ? enabled : undefined;
}

/** One owner-local settings snapshot; OAuth is deliberately never cached. */
export class FooterTelemetryController {
	private snapshot:
		| { key: string; session: ExtensionContext["sessionManager"]; enabled: boolean }
		| undefined;

	constructor(private readonly capabilities: SnapshotCapabilities = {}) {}

	reset(): void {
		this.snapshot = undefined;
	}

	refresh(ctx: ExtensionContext, demand: TelemetryDemand): FooterTelemetry {
		this.reset();
		return this.resolve(ctx, demand);
	}

	resolve(ctx: ExtensionContext, demand: TelemetryDemand): FooterTelemetry {
		if (!demand.autoCompaction) this.reset();
		return {
			subscription: demand.subscription ? resolveSubscription(ctx) : undefined,
			autoCompaction: demand.autoCompaction ? this.autoCompaction(ctx) : undefined,
		};
	}

	private fileSignature(path: string): string {
		try {
			const stat = this.capabilities.stat?.(path) ?? statSync(path, { bigint: true });
			return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;
			if (code === "ENOENT" || code === "ENOTDIR") return "missing";
			throw error;
		}
	}

	private autoCompaction(ctx: ExtensionContext): boolean | undefined {
		try {
			const factory = this.capabilities.settingsManager ?? SettingsManager;
			const trust = (ctx as ExtensionContext & { isProjectTrusted?: () => unknown })
				.isProjectTrusted;
			if (typeof factory.create !== "function" || typeof trust !== "function") {
				this.reset();
				return undefined;
			}
			const trusted = trust.call(ctx);
			if (typeof trusted !== "boolean") {
				this.reset();
				return undefined;
			}
			const cwd = resolve(ctx.cwd);
			const agentDir = resolve((this.capabilities.getAgentDir ?? getAgentDir)());
			// Metadata changes, not a TTL, invalidate ordinary edits and atomic replacements.
			// Never even stat project settings before trust has been established.
			const key = () =>
				JSON.stringify([
					cwd,
					agentDir,
					trusted,
					this.fileSignature(join(agentDir, "settings.json")),
					trusted ? this.fileSignature(join(cwd, CONFIG_DIR_NAME, "settings.json")) : null,
				]);
			const before = key();
			if (this.snapshot?.key === before && this.snapshot.session === ctx.sessionManager) {
				return this.snapshot.enabled;
			}
			this.reset();
			const enabled = readAutoCompaction(
				factory.create(cwd, agentDir, { projectTrusted: trusted }),
			);
			if (enabled !== undefined && key() === before) {
				this.snapshot = { key: before, session: ctx.sessionManager, enabled };
			}
			return enabled;
		} catch {
			// Do not retain a successful-looking key after a read, lock, or stat failure.
			this.reset();
			return undefined;
		}
	}
}
