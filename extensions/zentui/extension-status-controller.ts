import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionStatusVisibilityConfig } from "./config";

type StatusUi = Pick<ExtensionUIContext, "setStatus">;
type Publication = { receiver: unknown; args: Parameters<StatusUi["setStatus"]> };

/** Best-effort public-method decoration, never a Footer replacement or provider-map patch. */
export function createExtensionStatusController(getPolicy: () => ExtensionStatusVisibilityConfig) {
	let installation: { ui: StatusUi; reconcile(): void; dispose(): void } | undefined;
	const observed = new Map<string, string>();
	const hidden = (key: string) => {
		const policy = getPolicy();
		return (
			(Object.hasOwn(policy.visibility, key)
				? policy.visibility[key]
				: policy.defaultVisibility) === "hide"
		);
	};
	const dispose = () => {
		installation?.dispose();
		installation = undefined;
		observed.clear();
	};

	return {
		install(ui: StatusUi) {
			if (installation?.ui === ui) {
				installation.reconcile();
				return;
			}
			dispose();
			try {
				const original = Object.getOwnPropertyDescriptor(ui, "setStatus");
				// Accessors, inherited methods and locked objects are unsupported: leave them alone.
				if (
					!original ||
					!("value" in original) ||
					!original.writable ||
					!original.configurable ||
					typeof original.value !== "function"
				)
					return;
				const predecessor = original.value as StatusUi["setStatus"];
				const successful = new Map<string, Publication>();
				const suppressed = new Set<string>();
				const pending = new Map<string, symbol>();
				let active = true;
				let releasing = false;
				const owns = () => {
					try {
						const current = Object.getOwnPropertyDescriptor(ui, "setStatus");
						return (
							current?.value === wrapper &&
							current.writable === original.writable &&
							current.configurable === original.configurable &&
							current.enumerable === original.enumerable
						);
					} catch {
						return false;
					}
				};
				const eligible = () => {
					if (active && !owns()) {
						active = false;
						successful.clear();
						suppressed.clear();
					}
					return active;
				};
				function wrapper(this: unknown, ...args: Parameters<StatusUi["setStatus"]>) {
					if (!eligible()) return Reflect.apply(predecessor, this, args);
					const [key, text] = args;
					if (text === undefined) observed.delete(key);
					else observed.set(key, text);
					// A failed publication (including deletion) must never resurrect an older value.
					successful.delete(key);
					suppressed.delete(key);
					const suppress = !releasing && text !== undefined && hidden(key);
					const forwarded = [...args];
					if (suppress) forwarded[1] = undefined;
					const token = Symbol();
					pending.set(key, token);
					try {
						const result = Reflect.apply(predecessor, this, forwarded);
						// A reentrant publication supersedes this call's replay provenance.
						if (eligible() && pending.get(key) === token && text !== undefined && this === ui) {
							successful.set(key, { receiver: this, args });
							if (suppress) suppressed.add(key);
						}
						return result;
					} finally {
						if (pending.get(key) === token) pending.delete(key);
					}
				}
				const reconcile = () => {
					if (!eligible()) return;
					for (const [key, publication] of [...successful]) {
						if (!eligible()) break;
						if (successful.get(key) !== publication) continue;
						const suppress = !releasing && hidden(key);
						if (suppress === suppressed.has(key)) continue;
						const args = [...publication.args];
						if (suppress) args[1] = undefined;
						try {
							Reflect.apply(predecessor, publication.receiver, args);
							if (!eligible()) break;
							if (successful.get(key) !== publication) continue;
							if (suppress) suppressed.add(key);
							else suppressed.delete(key);
						} catch {
							// Uncertain side effects are not safe replay provenance.
							successful.delete(key);
							suppressed.delete(key);
						}
					}
				};
				Object.defineProperty(ui, "setStatus", { ...original, value: wrapper });
				installation = {
					ui,
					reconcile,
					dispose() {
						// Nested publications must pass through while still superseding stale replay provenance.
						releasing = true;
						reconcile();
						active = false;
						successful.clear();
						suppressed.clear();
						try {
							if (owns()) Object.defineProperty(ui, "setStatus", original);
						} catch {
							// A failed restoration leaves only an inactive, neutral delegate.
						}
					},
				};
			} catch {
				// Unsupported public UI shapes fail open.
			}
		},
		reconcile() {
			installation?.reconcile();
		},
		snapshot(): ReadonlyMap<string, string> {
			return new Map(observed);
		},
		dispose,
	};
}
