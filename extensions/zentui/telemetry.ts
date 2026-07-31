import { type ExtensionContext, SettingsManager } from "@earendil-works/pi-coding-agent";

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
		const settings = factory.create(ctx.cwd, undefined, { projectTrusted: trusted });
		if (
			typeof settings?.drainErrors !== "function" ||
			typeof settings.getCompactionEnabled !== "function"
		) {
			return undefined;
		}
		if (settings.drainErrors().length > 0) return undefined;
		const enabled = settings.getCompactionEnabled();
		return typeof enabled === "boolean" ? enabled : undefined;
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
