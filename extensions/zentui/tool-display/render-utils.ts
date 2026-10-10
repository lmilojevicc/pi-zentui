/* Adapted from pi-tool-display 0.5.0, commit91cef7580078371f8dc49a8607222807ad6a424d.
 * MIT License
 *
 * Copyright (c) 2026 MasuRii
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { homedir } from "node:os";
import { sanitizeAnsiForThemedOutput } from "./ansi-utils.js";

export { sanitizeAnsiForThemedOutput };

interface ToolResultLike {
	content?: unknown;
}

const QUIET_COMMAND_PREFIXES = [
	"cd",
	"mkdir",
	"rmdir",
	"rm",
	"mv",
	"cp",
	"touch",
	"chmod",
	"chown",
	"git add",
	"git checkout",
	"git switch",
	"git restore",
	"git reset",
	"git clean",
	"npm install",
	"pnpm install",
	"yarn install",
	"bun install",
	"pip install",
	"poetry install",
	"cargo fetch",
	"go mod tidy",
	"Set-Location",
	"New-Item",
	"Remove-Item",
	"Move-Item",
	"Copy-Item",
] as const;

interface CompactOutputOptions {
	expanded: boolean;
	maxCollapsedConsecutiveEmptyLines?: number;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	const next = [...lines];
	while (next.length > 0 && next[next.length - 1]?.trim().length === 0) {
		next.pop();
	}
	return next;
}

function collapseConsecutiveEmptyLines(
	lines: string[],
	maxConsecutiveEmptyLines: number,
): string[] {
	const maxAllowed = Math.max(0, maxConsecutiveEmptyLines);
	if (maxAllowed === 0) {
		return lines.filter((line) => line.trim().length > 0);
	}

	const compacted: string[] = [];
	let consecutiveEmpty = 0;

	for (const line of lines) {
		if (line.trim().length === 0) {
			consecutiveEmpty++;
			if (consecutiveEmpty > maxAllowed) {
				continue;
			}
		} else {
			consecutiveEmpty = 0;
		}
		compacted.push(line);
	}

	return compacted;
}

export function shortenPath(inputPath: string | undefined): string {
	if (!inputPath) {
		return "";
	}
	const home = homedir();
	return inputPath.startsWith(home) ? `~${inputPath.slice(home.length)}` : inputPath;
}

/** Terminal instructions are never presentation data; ordinary SGR color/style is retained. */
export function sanitizeTerminalControls(text: string): string {
	return text
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (sequence) => (sequence.endsWith("m") ? sequence : ""))
		.replace(/\x1b(?!\[[0-9;]*m)/g, "")
		.replace(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g, "");
}
export function extractTextOutput(result: ToolResultLike): string {
	const rawBlocks = Array.isArray(result.content) ? result.content : [];
	let remaining = 1024 * 1024;
	const output: string[] = [];
	for (const raw of rawBlocks) {
		if (
			!raw ||
			typeof raw !== "object" ||
			!("type" in raw) ||
			raw.type !== "text" ||
			!("text" in raw) ||
			typeof raw.text !== "string"
		)
			continue;
		if (remaining <= 0) {
			output.push("… (input preview capped)");
			break;
		}
		const buffer = Buffer.alloc(Math.min(remaining, raw.text.length * 3));
		const bytes = buffer.write(raw.text.slice(0, remaining), "utf8");
		const text = sanitizeTerminalControls(buffer.subarray(0, bytes).toString("utf8"));
		output.push(text);
		remaining -= bytes + 1;
		if (bytes < Buffer.byteLength(raw.text)) output.push("… (input preview capped)");
	}
	return output.join("\n");
}

export function splitLines(text: string): string[] {
	if (!text) {
		return [];
	}
	const lines: string[] = [];
	let start = 0;
	const input = text.replace(/\r/g, "");
	while (start < input.length && lines.length < 20000) {
		const end = input.indexOf("\n", start);
		lines.push(input.slice(start, end < 0 ? input.length : end).replace(/\t/g, "    "));
		start = end < 0 ? input.length : end + 1;
	}
	if (start < input.length) lines.push("… (line preview capped)");
	else if (input.endsWith("\n")) lines.push("");
	return lines;
}

export function compactOutputLines(lines: string[], options: CompactOutputOptions): string[] {
	const trimmed = trimTrailingEmptyLines(lines);
	if (options.expanded) {
		return trimmed;
	}

	return collapseConsecutiveEmptyLines(trimmed, options.maxCollapsedConsecutiveEmptyLines ?? 1);
}

export function isLikelyQuietCommand(command: string | undefined): boolean {
	if (!command) {
		return false;
	}

	const normalized = command.trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	const primarySegment = normalized
		.split(/&&|\|\||;/)
		.map((segment) => segment.trim())
		.find((segment) => segment.length > 0);

	if (!primarySegment) {
		return false;
	}

	for (const prefix of QUIET_COMMAND_PREFIXES) {
		const normalizedPrefix = prefix.toLowerCase();
		if (primarySegment === normalizedPrefix || primarySegment.startsWith(`${normalizedPrefix} `)) {
			return true;
		}
	}

	return false;
}

export function countNonEmptyLines(lines: string[]): number {
	return lines.filter((line) => line.trim().length > 0).length;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return count === 1 ? singular : plural;
}

export function previewLines(
	lines: string[],
	maxLines: number,
): { shown: string[]; remaining: number } {
	const limit = Math.max(0, maxLines);
	const shown = lines.slice(0, limit);
	const remaining = Math.max(0, lines.length - shown.length);
	return { shown, remaining };
}
