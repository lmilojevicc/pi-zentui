import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { record } from "./presets.js";

export const PREIMAGE_MAX_BYTES = 256 * 1024;
const CACHE_MAX_BYTES = 1024 * 1024;
const CACHE_MAX_ENTRIES = 16;
const CACHE_TTL_MS = 60_000;
export interface Preimage {
	content?: string;
	exists?: boolean;
	notice?: string;
}
export interface PendingProjection extends Preimage {
	nextContent?: string;
	label: "pending edit" | "pending overwrite" | "pending create";
}
function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
/** Best-effort, bounded preview only; never follows symlinks or changes tool execution. */
export function readWorkspacePreimage(cwd: string, path: string): Preimage {
	let fd: number | undefined;
	try {
		const root = realpathSync(cwd);
		const logicalRoot = resolve(cwd);
		const requested = resolve(cwd, path);
		const target = inside(logicalRoot, requested)
			? resolve(root, relative(logicalRoot, requested))
			: requested;
		if (!inside(root, target)) return { notice: "Preview unavailable: outside workspace." };
		const parts = relative(root, target).split(sep);
		let current = root;
		for (let i = 0; i < parts.length; i++) {
			current = resolve(current, parts[i]);
			try {
				const stat = lstatSync(current);
				if (stat.isSymbolicLink()) return { notice: "Preview unavailable: symbolic link." };
				if (i < parts.length - 1 && !stat.isDirectory())
					return { notice: "Preview unavailable: not a directory." };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					return { exists: false, content: "" };
				throw error;
			}
		}
		const before = lstatSync(target);
		if (!before.isFile() || before.size > PREIMAGE_MAX_BYTES)
			return { exists: true, notice: "Preview unavailable: file exceeds preview limits." };
		if (!inside(root, realpathSync(target)))
			return { notice: "Preview unavailable: outside workspace." };
		fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const opened = fstatSync(fd);
		if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino)
			return { notice: "Preview unavailable: file changed." };
		// Verify the opened inode still names a symlink-free workspace file before reading.
		current = root;
		for (const part of parts) {
			current = resolve(current, part);
			if (lstatSync(current).isSymbolicLink())
				return { notice: "Preview unavailable: symbolic link." };
		}
		const after = lstatSync(target);
		if (!inside(root, realpathSync(target)) || after.ino !== opened.ino || after.dev !== opened.dev)
			return { notice: "Preview unavailable: file changed." };
		const buffer = Buffer.alloc(PREIMAGE_MAX_BYTES + 1);
		let bytes = 0;
		while (bytes < buffer.length) {
			const count = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
			if (!count) break;
			bytes += count;
		}
		if (bytes > PREIMAGE_MAX_BYTES)
			return { exists: true, notice: "Preview unavailable: file exceeds preview limits." };
		const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes));
		if (content.includes("\0"))
			return { exists: true, notice: "Preview unavailable: binary file." };
		return { exists: true, content };
	} catch {
		return { notice: "Preview unavailable: unreadable file." };
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
export function projectPending(
	tool: "write" | "edit",
	args: unknown,
	preimage: Preimage,
): PendingProjection {
	const input = record(args);
	const label =
		tool === "edit" ? "pending edit" : preimage.exists ? "pending overwrite" : "pending create";
	if (preimage.notice || preimage.exists === undefined)
		return {
			...preimage,
			label,
			notice: preimage.notice ?? "Preview unavailable: no live preimage.",
		};
	if (tool === "write") {
		return typeof input.content === "string" &&
			Buffer.byteLength(input.content) <= PREIMAGE_MAX_BYTES
			? { ...preimage, label, nextContent: input.content }
			: { ...preimage, label, notice: "Preview unavailable: incomplete or oversized content." };
	}
	if (!preimage.exists)
		return { ...preimage, label, notice: "Preview unavailable: file does not exist." };
	const source = preimage.content ?? "";
	const edits = Array.isArray(input.edits) ? input.edits : [input];
	const ranges: { start: number; end: number; text: string }[] = [];
	for (const raw of edits) {
		const edit = record(raw);
		if (typeof edit.oldText !== "string" || !edit.oldText || typeof edit.newText !== "string")
			return { ...preimage, label, notice: "Preview unavailable: exact replacement required." };
		const start = source.indexOf(edit.oldText);
		if (start < 0 || source.indexOf(edit.oldText, start + 1) >= 0)
			return { ...preimage, label, notice: "Preview unavailable: replacement is not unique." };
		ranges.push({ start, end: start + edit.oldText.length, text: edit.newText });
	}
	ranges.sort((a, b) => a.start - b.start);
	if (!ranges.length || ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end))
		return { ...preimage, label, notice: "Preview unavailable: overlapping replacements." };
	let nextContent = source;
	for (const range of ranges.reverse())
		nextContent = nextContent.slice(0, range.start) + range.text + nextContent.slice(range.end);
	if (Buffer.byteLength(nextContent) > PREIMAGE_MAX_BYTES)
		return { ...preimage, label, notice: "Preview unavailable: oversized projection." };
	return { ...preimage, label, nextContent };
}
interface Entry {
	path: string;
	cwd: string;
	tool: "write" | "edit";
	preimage: Preimage;
	time: number;
	bytes: number;
}
/** Populate only from public live tool events; clear on session/tree/reload boundaries. */
export class PendingPreimages {
	private entries = new Map<string, Entry>();
	constructor(private now: () => number = Date.now) {}
	observe(toolCallId: string, tool: "write" | "edit", args: unknown, cwd: string): void {
		this.prune();
		if (this.entries.has(toolCallId)) return;
		const path = record(args).path;
		if (typeof path !== "string" || !path) return;
		const preimage = readWorkspacePreimage(cwd, path);
		this.entries.set(toolCallId, {
			path,
			cwd,
			tool,
			preimage,
			time: this.now(),
			bytes: Buffer.byteLength(preimage.content ?? ""),
		});
		this.prune();
	}
	get(
		toolCallId: string,
		tool: "write" | "edit",
		args: unknown,
		cwd: string,
	): Preimage | undefined {
		this.prune();
		const entry = this.entries.get(toolCallId);
		return entry?.tool === tool && entry.path === record(args).path && entry.cwd === cwd
			? entry.preimage
			: undefined;
	}
	clear(): void {
		this.entries.clear();
	}
	get size(): number {
		this.prune();
		return this.entries.size;
	}
	private prune(): void {
		for (const [id, entry] of this.entries)
			if (this.now() - entry.time >= CACHE_TTL_MS) this.entries.delete(id);
		let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
		for (const [id, entry] of this.entries) {
			if (this.entries.size <= CACHE_MAX_ENTRIES && bytes <= CACHE_MAX_BYTES) break;
			this.entries.delete(id);
			bytes -= entry.bytes;
		}
	}
}
