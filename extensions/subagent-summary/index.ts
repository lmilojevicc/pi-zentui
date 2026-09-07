import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { runRows, SubagentReader } from "./rpc";

const KEY = "zentui-subagent-summary";
const clean = (value: string) =>
	stripVTControlCharacters(value)
		.replace(/[\x00-\x1f\x7f]/g, " ")
		.replace(/\s+/g, " ")
		.slice(0, 240);

/** An optional, passive view of nicobailon/pi-subagents' public status RPC. */
export default function subagentSummary(pi: ExtensionAPI) {
	const path = join(getAgentDir(), "zentui-subagents.json");
	let stop: (() => void) | undefined;
	const dispose = () => {
		stop?.();
		stop = undefined;
	};
	const readSettings = (): Record<string, unknown> => {
		try {
			const value: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!value || typeof value !== "object" || Array.isArray(value))
				throw new Error("Expected an object");
			const settings = value as Record<string, unknown>;
			if (settings.enabled !== undefined && typeof settings.enabled !== "boolean")
				throw new Error("enabled must be boolean");
			return settings;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
	};
	const reconcile = (ctx: ExtensionContext) => {
		dispose();
		if (!ctx.hasUI || process.env.PI_SUBAGENT_CHILD === "1") return;
		try {
			if (readSettings().enabled === true) stop = startSummary(pi, ctx);
		} catch {
			ctx.ui.notify("Subagent summary disabled: invalid zentui-subagents.json", "warning");
		}
	};
	pi.on("session_start", (_event, ctx) => reconcile(ctx));
	pi.on("session_tree", (_event, ctx) => reconcile(ctx));
	pi.on("session_shutdown", dispose);
	pi.registerCommand("zentui-subagents", {
		description: "Enable or disable the optional subagent summary (on/off)",
		handler: async (args, ctx) => {
			if (args.trim() !== "on" && args.trim() !== "off") {
				ctx.ui.notify("Usage: /zentui-subagents on|off", "info");
				return;
			}
			try {
				const settings = { ...readSettings(), enabled: args.trim() === "on" };
				mkdirSync(dirname(path), { recursive: true });
				const temp = `${path}.${crypto.randomUUID()}.tmp`;
				writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
				renameSync(temp, path);
				reconcile(ctx);
				ctx.ui.notify(`Subagent summary ${settings.enabled ? "enabled" : "disabled"}`, "info");
			} catch {
				ctx.ui.notify(
					"Unable to save subagent summary settings; existing settings retained",
					"error",
				);
			}
		},
	});
}

export function startSummary(pi: Pick<ExtensionAPI, "events">, ctx: ExtensionContext): () => void {
	const reader = new SubagentReader(pi.events);
	let live = true;
	let registered = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = "";
	const clear = () => {
		if (registered) ctx.ui.setWidget(KEY, undefined);
		registered = false;
		last = "";
	};
	const poll = async () => {
		try {
			const rows = runRows(await reader.read());
			if (!live) return;
			if (!rows.length) clear();
			else {
				const visible = rows.slice(0, 6);
				const lines = [
					"Subagents · use /subagents-fleet for details",
					...visible.map(
						(row) =>
							`  ${clean(row.label)} · ${clean(row.state)}${row.action ? ` · ${clean(row.action)}` : ""}`,
					),
					...(rows.length > visible.length ? ["  More entries available in /subagents-fleet"] : []),
				];
				const key = JSON.stringify(lines);
				if (key !== last) {
					ctx.ui.setWidget(
						KEY,
						(_tui, theme) => ({
							render: (width: number) =>
								lines.map((line, i) =>
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
			if (live) clear(); // Never leave an old running status visible after a failed read.
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
