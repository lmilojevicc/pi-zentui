import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { createBashProgress } from "./bash-display.js";
import type { ToolRendererResolver, ToolRenderers } from "./host-contract.js";
import { record } from "./presets.js";
import {
	createToolDisplayRenderers,
	hasSupportedContent,
	type RendererResources,
} from "./renderers.js";
import { type BuiltinToolName, isBuiltinToolName, type ToolDisplayConfig } from "./types.js";

/** Modern Pi catches callback failures and invokes its own generic slot fallback.
 * This signal must never escape from Component.render or be used on unsupported hosts.
 */
class NativeToolDisplayFallback extends Error {
	constructor() {
		super("Use host-native tool rendering");
	}
}

export interface ToolDisplayRendererAPI {
	registerToolRenderer?: (resolver: ToolRendererResolver) => void;
	getAllTools?: () => readonly {
		name: string;
		namespace?: { name: string };
		sourceInfo?: { source?: string; path?: string };
	}[];
}
export interface ToolDisplayStatus {
	available: boolean;
	active: boolean;
	reason?: string;
	/** Ambiguous native Bash functions require explicit rendering-only consent. */
	bashRequiresOverride: boolean;
}
export interface ToolDisplayControllerOptions extends RendererResources {
	/** Identities from public create*ToolDefinition factories on the actual host. No private imports. */
	nativeRenderers: Partial<Record<BuiltinToolName, ToolRenderers>>;
}
function rendererIdentityMatches(
	actual: ToolRenderers,
	native: ToolRenderers | undefined,
): boolean {
	return (
		!!native &&
		actual.renderCall === native.renderCall &&
		actual.renderResult === native.renderResult &&
		actual.renderShell === native.renderShell
	);
}
/** One runtime-scoped resolver. Pi returns void; disposal makes the closure delegate forever. */
export function createToolDisplayController(
	api: ToolDisplayRendererAPI,
	getConfig: () => ToolDisplayConfig,
	options: ToolDisplayControllerOptions,
) {
	const progress = options.progress ?? createBashProgress();
	let installed = false;
	let disposed = false;
	let failure: string | undefined;
	// Proof is recorded by actual row callbacks, never by tool-name discovery. Only live
	// events may consume it; bounded retention cannot accumulate restored history.
	const pendingRows = new Map<
		string,
		{ name: "write" | "edit"; path: string; cwd: string; current: () => boolean; time: number }
	>();
	const clearPending = () => {
		pendingRows.clear();
		options.pending?.clear();
	};
	const enabled = () => {
		try {
			return !disposed && !failure && getConfig().enabled && getConfig().style !== "native";
		} catch {
			return false;
		}
	};
	const canOwn = (name: string, previous: ToolRenderers | undefined): boolean => {
		if (!enabled()) return false;
		const config = getConfig();
		if (isBuiltinToolName(name)) {
			if (!config.registerToolOverrides[name]) return false;
			let source: { source?: string; path?: string } | undefined;
			try {
				source = api.getAllTools?.().find((tool) => tool.name === name)?.sourceInfo;
			} catch {
				return false;
			}
			if (source?.source !== "builtin" || source.path !== `builtin:${name}`) return false;
			return (
				!previous ||
				rendererIdentityMatches(previous, options.nativeRenderers[name]) ||
				config.builtinRendererOverrides[name] === true
			);
		}
		const custom = Object.hasOwn(config.customToolOverrides, name)
			? config.customToolOverrides[name]
			: undefined;
		return (
			custom?.enabled === true &&
			((!previous?.renderCall && !previous?.renderResult && !previous?.renderShell) ||
				custom.overrideExistingRenderers === true)
		);
	};
	const resolver: ToolRendererResolver = (name, next) => {
		const previous = next();
		if (!canOwn(name, previous)) return previous;
		interface Slot {
			keyFor: () => readonly unknown[];
			build: () => Component | undefined;
			key: readonly unknown[];
			inner: Component;
			wrapper: Component;
		}
		interface Row {
			ownedCall?: Slot;
			ownedResult?: Slot;
			released: boolean;
			delegated: boolean;
			predecessor?: ToolRenderers;
			call?: Component;
			result?: Component;
		}
		const rows = new WeakMap<object, Row>();
		const ownedComponents = new WeakSet<Component>();
		const rowKey = (state: unknown): object | undefined =>
			state !== null && typeof state === "object" ? state : undefined;
		const rowFor = (state: unknown): Row | undefined => {
			const key = rowKey(state);
			if (!key) return undefined;
			let row = rows.get(key);
			if (!row) {
				row = { released: false, delegated: false };
				rows.set(key, row);
			}
			return row;
		};
		const namespaceName = (): string | undefined => {
			try {
				return api.getAllTools?.().find((tool) => tool.name === name)?.namespace?.name;
			} catch {
				return undefined;
			}
		};
		const own = () =>
			createToolDisplayRenderers(
				name,
				getConfig,
				{ ...options, progress, mcpNamespaceName: namespaceName() },
				isBuiltinToolName(name) ? undefined : getConfig().customToolOverrides[name],
			);
		const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
			a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
		const keyFor = (
			theme: unknown,
			context: Parameters<NonNullable<ToolRenderers["renderCall"]>>[2],
			result?: unknown,
			options?: { expanded: boolean; isPartial: boolean },
		): readonly unknown[] => {
			const config = getConfig();
			const custom = config.customToolOverrides[name];
			const args = record(context.args);
			const data = record(result);
			const snapshot = JSON.stringify([
				config.enabled,
				config.style,
				config.readOutputMode,
				config.searchOutputMode,
				config.mcpOutputMode,
				config.bashOutputMode,
				config.previewLines,
				config.expandedPreviewMaxLines,
				config.bashCollapsedLines,
				config.diffViewMode,
				config.diffIndicatorMode,
				config.diffSplitMinWidth,
				config.diffCollapsedLines,
				config.diffWordWrap,
				config.showTruncationHints,
				custom?.enabled,
				custom?.kind,
				custom?.outputMode,
				custom?.overrideExistingRenderers,
			]);
			const colors = record(theme).colors;
			const pending = name === "write" || name === "edit" ? optionsPending(context) : undefined;
			return [
				snapshot,
				theme,
				colors,
				context.args,
				args.path,
				args.file_path,
				args.content,
				args.oldText,
				args.newText,
				args.edits,
				args.lines,
				args.command,
				args.pattern,
				args.glob,
				args.limit,
				args.offset,
				args.tool,
				args.server,
				args.search,
				args.describe,
				args.connect,
				Object.keys(args).length,
				data.content,
				data.details,
				record(data.details).diff,
				options?.expanded,
				options?.isPartial,
				context.executionStarted,
				context.argsComplete,
				context.isPartial,
				context.expanded,
				context.isError,
				context.showImages,
				pending,
				namespaceName(),
			];
		};
		const optionsPending = (context: Parameters<NonNullable<ToolRenderers["renderCall"]>>[2]) =>
			options.pending?.get(context.toolCallId, name as "write" | "edit", context.args, context.cwd);
		const component = (
			row: Row,
			slotName: "ownedCall" | "ownedResult",
			key: () => readonly unknown[],
			build: () => Component | undefined,
		): Component | undefined => {
			const currentKey = key();
			const existing = row[slotName];
			if (existing) {
				existing.keyFor = key;
				existing.build = build;
			}
			if (existing && sameKey(existing.key, currentKey)) return existing.wrapper;
			const initial = build();
			if (!initial) return undefined;
			if (existing) {
				existing.key = currentKey;
				existing.inner = initial;
				return existing.wrapper;
			}
			const slot: Slot = {
				keyFor: key,
				build,
				key: currentKey,
				inner: initial,
				wrapper: {
					invalidate() {
						slot.inner.invalidate();
					},
					render(width) {
						try {
							const nextKey = slot.keyFor();
							if (!sameKey(slot.key, nextKey)) {
								slot.inner = slot.build() ?? slot.inner;
								slot.key = nextKey;
							}
							return slot.inner.render(width);
						} catch {
							row.released = true;
							return width > 0
								? [truncateToWidth("Tool preview unavailable; awaiting native update.", width, "")]
								: [];
						}
					},
				},
			};
			ownedComponents.add(slot.wrapper);
			row[slotName] = slot;
			return slot.wrapper;
		};
		return {
			// Newly owned rows use upstream native cards; existing shells need host rebuild to release.
			renderShell: "default",
			renderCall(args, theme, context) {
				const row = rowFor(context.state);
				const current = next();
				const delegate = () => {
					progress.release(context);
					if (row) {
						row.released = true;
						if (!row.delegated) {
							row.predecessor = current;
							row.delegated = true;
						}
					}
					const predecessor = row ? row.predecessor : current;
					pendingRows.delete(context.toolCallId);
					if (!predecessor?.renderCall) throw new NativeToolDisplayFallback();
					const lastComponent =
						row?.call ??
						(context.lastComponent && !ownedComponents.has(context.lastComponent)
							? context.lastComponent
							: undefined);
					const result = predecessor.renderCall(args, theme, { ...context, lastComponent });
					if (row) row.call = result;
					return result;
				};
				if (!row || row.released || !canOwn(name, current)) return delegate();
				if (name === "write" || name === "edit") {
					const proofCurrent = () => !row.released && canOwn(name, next());
					try {
						const path = record(args).path;
						// Streamed JSON may expose only a prefix of the eventual path. Do not
						// authorize a preimage until this same row reports completed arguments.
						if (
							proofCurrent() &&
							!context.executionStarted &&
							context.argsComplete &&
							typeof path === "string" &&
							path.length > 0
						) {
							pendingRows.set(context.toolCallId, {
								name,
								path,
								cwd: context.cwd,
								current: proofCurrent,
								time: Date.now(),
							});
							for (const [id, proof] of pendingRows)
								if (pendingRows.size > 16 || Date.now() - proof.time >= 60_000)
									pendingRows.delete(id);
						} else pendingRows.delete(context.toolCallId);
					} catch {
						pendingRows.delete(context.toolCallId);
					}
				}
				try {
					return (
						component(
							row,
							"ownedCall",
							() => keyFor(theme, context),
							() => own().renderCall?.(args, theme, context),
						) ?? delegate()
					);
				} catch {
					return delegate();
				}
			},
			renderResult(result, renderOptions, theme, context) {
				const row = rowFor(context.state);
				const current = next();
				const delegate = () => {
					progress.release(context);
					if (row) {
						row.released = true;
						if (!row.delegated) {
							row.predecessor = current;
							row.delegated = true;
						}
					}
					const predecessor = row ? row.predecessor : current;
					pendingRows.delete(context.toolCallId);
					if (!predecessor?.renderResult) throw new NativeToolDisplayFallback();
					const lastComponent =
						row?.result ??
						(context.lastComponent && !ownedComponents.has(context.lastComponent)
							? context.lastComponent
							: undefined);
					const rendered = predecessor.renderResult(result, renderOptions, theme, {
						...context,
						lastComponent,
					});
					if (row) row.result = rendered;
					return rendered;
				};
				if (!row || row.released || !canOwn(name, current) || !hasSupportedContent(result))
					return delegate();
				try {
					return (
						component(
							row,
							"ownedResult",
							() => keyFor(theme, context, result, renderOptions),
							() => own().renderResult?.(result, renderOptions, theme, context),
						) ?? delegate()
					);
				} catch {
					return delegate();
				}
			},
		};
	};
	return {
		resolver,
		clearPending,
		/** No evidence for this exact live call means no filesystem read. */
		observePending(
			event: { toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string },
			cwd: string,
		): void {
			const proof = pendingRows.get(event.toolCallId);
			if (!proof || event.parentToolCallId) return;
			try {
				if (
					proof.name === event.toolName &&
					proof.path === record(event.args).path &&
					proof.cwd === cwd &&
					Date.now() - proof.time < 60_000 &&
					proof.current()
				) {
					options.pending?.observe(event.toolCallId, proof.name, event.args, cwd);
				} else pendingRows.delete(event.toolCallId);
			} catch {
				// Preview failures cannot block or transform execution.
				pendingRows.delete(event.toolCallId);
			}
		},
		install(): void {
			if (installed || disposed || typeof api.registerToolRenderer !== "function") return;
			try {
				api.registerToolRenderer(resolver);
				installed = true;
			} catch {
				failure = "Tool renderer registration unavailable; native rendering retained.";
			}
		},
		status(): ToolDisplayStatus {
			const available = typeof api.registerToolRenderer === "function" && !failure;
			return {
				available,
				active: installed && enabled(),
				bashRequiresOverride:
					getConfig().registerToolOverrides.bash &&
					getConfig().builtinRendererOverrides.bash !== true,
				reason:
					failure ??
					(!available
						? "Public tool renderer API unavailable; native rendering retained."
						: undefined),
			};
		},
		dispose(): void {
			disposed = true;
			progress.dispose();
			clearPending();
		},
	};
}
