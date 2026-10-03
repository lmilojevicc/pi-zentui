import type {
	ExtensionAPI as PiAPI,
	ExtensionCommandContext as PiCommandContext,
	ExtensionContext as PiContext,
} from "@earendil-works/pi-coding-agent";
import {
	realizesPriorityServiceTier,
	resolveModelServiceTier,
	shouldSendServiceTier,
} from "@oh-my-pi/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "@oh-my-pi/pi-coding-agent";
import zentui from "./extensions/zentui/index";
import { observeOmpHookStatuses } from "./extensions/zentui/omp-statusline";
import { OmpTemplateLookups } from "./extensions/zentui/omp-template-lookups";
import { readOmpTemplateMetrics } from "./extensions/zentui/omp-template-metrics";
import { observeOmpTemplateModes } from "./extensions/zentui/omp-template-modes";
import { createOmpUiAdapter, type OmpUiAdapter } from "./extensions/zentui/omp-ui";

/** Focused OMP skin: editors, user messages, and the native status-line slot. */
const extension: ExtensionFactory = (pi) => {
	const adapters = new Set<OmpUiAdapter>();
	const statusObserver = observeOmpHookStatuses(pi.pi.StatusLineComponent.prototype);
	const modeObserver = observeOmpTemplateModes(pi.pi.StatusLineComponent.prototype);
	const lookups = new OmpTemplateLookups(pi.exec, () => {
		for (const adapter of adapters) adapter.requestRender();
	});
	const withContext = <T>(ctx: ExtensionContext, callback: (ctx: PiContext) => T): T => {
		if (!ctx.hasUI || (ctx.mode !== undefined && ctx.mode !== "tui"))
			return callback(ctx as unknown as PiContext);
		const adapter = createOmpUiAdapter(ctx.ui, {
			statusLinePrototype: pi.pi.StatusLineComponent.prototype,
			getSessionId: () => ctx.sessionManager.getSessionId(),
			getHookStatusSnapshot: statusObserver?.getSnapshot,
			onProjectChanged: () => lookups.invalidateProject(ctx.cwd),
			getHostTemplateValues(receiver, session, names, editor) {
				const values = readOmpTemplateMetrics(ctx, names, {
					receiver,
					session,
					workerTokenRate: names.has("token_rate")
						? modeObserver.workerTokenRate(receiver, session)
						: undefined,
				});
				const model = ctx.model;
				return Object.assign(
					values,
					modeObserver.read(receiver, session, editor, names),
					lookups.read(
						{
							session,
							sessionId: ctx.sessionManager.getSessionId(),
							cwd: ctx.cwd,
							provider: model?.provider,
							modelId: model?.id,
						},
						names,
					),
				);
			},
		});
		adapters.add(adapter);
		const ui = adapter.ui;
		const adapted = new Proxy(ctx, {
			get(target, key, receiver) {
				return key === "ui" ? ui : Reflect.get(target, key, receiver);
			},
		}) as unknown as PiContext;
		return adapter.runWithUi(ctx.ui, () => callback(adapted));
	};
	const api = new Proxy(pi, {
		get(target, key, receiver) {
			if (key === "on") {
				return (event: string, handler: (event: unknown, ctx: PiContext) => unknown) => {
					pi.on(
						event as never,
						(async (payload: unknown, ctx: ExtensionContext) => {
							return withContext(ctx, async (adapted) => {
								try {
									return await handler(payload, adapted);
								} finally {
									if (
										event === "tool_execution_end" ||
										event === "session_tree" ||
										event === "session_start"
									) {
										for (const adapter of adapters) {
											if (adapter.ui === adapted.ui) adapter.projectChanged();
										}
									}
								}
							});
						}) as never,
					);
				};
			}
			if (key === "registerCommand") {
				return (name: string, options: Parameters<PiAPI["registerCommand"]>[1]) => {
					// Zentui's command completions are synchronous; OMP does not accept async providers.
					const completions = options.getArgumentCompletions as Parameters<
						typeof pi.registerCommand
					>[1]["getArgumentCompletions"];
					pi.registerCommand(name, {
						...options,
						getArgumentCompletions: completions,
						handler: (args, ctx) =>
							withContext(ctx, (adapted) => options.handler(args, adapted as PiCommandContext)),
					});
				};
			}
			if (key === "registerShortcut") {
				return (
					shortcut: Parameters<PiAPI["registerShortcut"]>[0],
					options: Parameters<PiAPI["registerShortcut"]>[1],
				) => {
					pi.registerShortcut(shortcut as never, {
						...options,
						handler: (ctx) => withContext(ctx, (adapted) => options.handler(adapted)),
					});
				};
			}
			return Reflect.get(target, key, receiver);
		},
	});
	zentui(api as unknown as PiAPI, {
		wrapEditor: false,
		skinOnly: true,
		liveModel: true,
		getHostTemplateValues(ctx, names) {
			for (const adapter of adapters) {
				if (adapter.ui !== ctx.ui) continue;
				const values = adapter.getHostTemplateValues(names);
				if (values) return values;
			}
			return readOmpTemplateMetrics(ctx, names);
		},
		getFastMode(ctx) {
			const model = ctx.model as unknown as ExtensionContext["model"];
			if (!model) return undefined;
			const tier = resolveModelServiceTier(pi.getServiceTiers(), model);
			if (tier === "ultrafast" && shouldSendServiceTier(tier, model)) return "ultrafast";
			return realizesPriorityServiceTier(tier, model) ? "fast" : undefined;
		},
	});
	// Register after Zentui so its owned surfaces are released before observation stops.
	pi.on("session_shutdown", () => {
		lookups.dispose();
		for (const adapter of adapters.values()) adapter.dispose();
		adapters.clear();
		statusObserver?.dispose();
		modeObserver.dispose();
	});
};

export default extension;
