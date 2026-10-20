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
import { boundedContentMetadata } from "./source-bounds.ts";

export { boundedContentMetadata as getWriteContentMetadata } from "./source-bounds.ts";

export interface WriteCallSummaryOptions {
	hasContent: boolean;
	hasDetailedResultHeader: boolean;
}

export function splitWriteContentLines(content: string): string[] {
	if (!content) {
		return [];
	}

	const normalized = content.replace(/\r/g, "");
	const lines = normalized.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

export function countWriteContentLines(value: unknown): number {
	return boundedContentMetadata(value).lineCount;
}

export function getWriteContentSizeBytes(value: unknown): number {
	return boundedContentMetadata(value).sizeBytes;
}

export function shouldRenderWriteCallSummary(options: WriteCallSummaryOptions): boolean {
	return options.hasContent && !options.hasDetailedResultHeader;
}
