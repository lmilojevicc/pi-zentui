import { stripVTControlCharacters } from "node:util";
import { record } from "./subagent-summary-rpc";

const ACTIVE = new Set(["queued", "running"]);
const TERMINAL = new Set(["complete", "failed", "partial", "paused", "stopped", "rejected"]);

/** Bound before regex/Unicode work. Replacing lone surrogates also repairs a sliced pair. */
export function cleanSubagentText(value: unknown): string {
	if (typeof value !== "string") return "";
	const bounded = value.slice(0, 240);
	return stripVTControlCharacters(bounded)
		.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
		.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�")
		.replace(/\s+/g, " ")
		.trim();
}

export type SubagentSummaryRow = {
	id: string;
	runId: string;
	childId?: string;
	label: string;
	state: string;
	action: string;
};
export type SubagentSummaryProjection = {
	compatible: boolean;
	rows: SubagentSummaryRow[];
	omitted: {
		runs: boolean;
		children: boolean;
		byteLimitExceeded: boolean;
		inspection: boolean;
		display: boolean;
	};
};

type Candidate = { row: SubagentSummaryRow; priority: number; endedAt: number };
function candidate(raw: unknown, now: number, parent?: SubagentSummaryRow): Candidate | undefined {
	const node = record(raw);
	if (
		typeof node.id !== "string" ||
		!node.id ||
		node.id.length > 160 ||
		typeof node.label !== "string" ||
		typeof node.state !== "string"
	)
		return;
	// Classify exact owner states, not truncated/sanitized lookalikes.
	const active = node.state.length <= 8 && ACTIVE.has(node.state);
	const terminal = node.state.length <= 8 && TERMINAL.has(node.state);
	const endedAt =
		typeof node.endedAt === "number" && Number.isFinite(node.endedAt) && node.endedAt >= 0
			? node.endedAt
			: -1;
	if (terminal && (endedAt < 0 || endedAt > now || now - endedAt > 10_000)) return;
	const label = cleanSubagentText(node.label);
	return {
		row: {
			id: parent ? JSON.stringify([parent.runId, node.id]) : node.id,
			runId: parent?.runId ?? node.id,
			...(parent ? { childId: node.id } : {}),
			label: parent ? `${parent.label} › ${label}` : label,
			state: cleanSubagentText(node.state) || "unknown",
			action: cleanSubagentText(record(node.activity).currentTool),
		},
		priority: active ? 0 : terminal ? 2 : 1,
		endedAt,
	};
}

/** Bounded projection of Nico's v1 async snapshot, not a foreground task registry. */
export function projectSubagentSummary(data: unknown, now: number): SubagentSummaryProjection {
	const snapshot = record(record(data).asyncSnapshot);
	const result: SubagentSummaryProjection = {
		compatible: false,
		rows: [],
		omitted: {
			runs: false,
			children: false,
			byteLimitExceeded: false,
			inspection: false,
			display: false,
		},
	};
	if (
		snapshot.kind !== "pi-subagents.async-status-snapshot" ||
		snapshot.version !== 1 ||
		!Array.isArray(snapshot.runs)
	)
		return result;
	result.compatible = true;
	const upstream = record(snapshot.omitted);
	result.omitted.runs = typeof upstream.runs === "number" && upstream.runs > 0;
	result.omitted.children = typeof upstream.children === "number" && upstream.children > 0;
	result.omitted.byteLimitExceeded = upstream.byteLimitExceeded === true;
	result.omitted.inspection = snapshot.runs.length > 20;
	const parents: Candidate[] = [];
	const groups: Candidate[][] = [];
	for (const raw of snapshot.runs.slice(0, 20)) {
		const run = record(raw);
		const parent = candidate(run, now);
		if (parent) parents.push(parent);
		// Expired parents may still have active immediate steps. Build identity without
		// inventing a recent parent or inheriting its timestamp into a child.
		const identity = candidate({ id: run.id, label: run.label, state: "unknown" }, now)?.row;
		if (!Array.isArray(run.children)) continue;
		if (run.children.length > 8) result.omitted.inspection = true;
		const children: Candidate[] = [];
		for (const rawChild of run.children.slice(0, 8)) {
			if (!identity || record(rawChild).kind !== "step") continue;
			const child = candidate(rawChild, now, identity);
			if (child) children.push(child);
		}
		groups.push(children);
	}
	const ordered: Candidate[] = [];
	for (const priority of [0, 1]) {
		ordered.push(...parents.filter((item) => item.priority === priority));
		const queues = groups.map((group) => group.filter((item) => item.priority === priority));
		for (let index = 0; index < 8; index++) {
			for (const queue of queues) if (queue[index]) ordered.push(queue[index]);
		}
	}
	ordered.push(
		...[...parents, ...groups.flat()]
			.filter((item) => item.priority === 2)
			.sort((a, b) => b.endedAt - a.endedAt),
	);
	result.rows = ordered.slice(0, 6).map((item) => item.row);
	result.omitted.display = ordered.length > 6;
	return result;
}

export function subagentSummaryLines(projection: SubagentSummaryProjection): string[] {
	const overflow = Object.values(projection.omitted).some(Boolean);
	if (!projection.rows.length && !overflow) return [];
	return [
		"Subagents · use /subagents-fleet for details",
		...projection.rows.map(
			(row) => `  ${row.label} · ${row.state}${row.action ? ` · ${row.action}` : ""}`,
		),
		...(overflow ? ["  More fleet details available in /subagents-fleet"] : []),
	];
}
