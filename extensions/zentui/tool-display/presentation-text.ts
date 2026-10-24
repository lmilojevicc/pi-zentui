import { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { boundedContentLines, boundedWrap, MAX_PREVIEW_LINE_CHARS, safeWidth } from "./bounds.ts";

// Foreground-only SGR, i.e. the form the painter emits. `\x1b[0m`/attribute codes come
// from truncation or the caller and are real content, so they never match.
const FOREGROUND_ALL = /\x1b\[(?:3[0-7]|9[0-7]|39|38;5;\d{1,3}|38;2;\d{1,3};\d{1,3};\d{1,3})m/g;
/**
 * `wrapSingleLine` can push a row that holds only SGR bytes when a space token fills a
 * row exactly and the next token is wider than the row: the escape-only row is padded
 * into a blank transcript line. It is a pi-tui wrapping artifact shared by every
 * colored row (the legacy accent row too), so the production component drops those
 * rows; visible text, wraps, and trailing blank lines are unchanged.
 *
 * A colorless whitespace row counts too: when a color is active across a leading space
 * run, the artifact row can come out as padding alone, with the SGR already closed.
 * Genuine blank source lines are protected by the caller, which only drops a row where
 * the uncolored wrap has a visible row at the same position.
 */
function isEscapeOnlyRow(row: string): boolean {
	const rest = row.replace(FOREGROUND_ALL, "");
	return rest.indexOf("\x1b") < 0 && rest.trim() === "";
}
/** Native Text in the normal domain; bounds are checked before native wrapping allocates rows. */
export class PresentationText extends Text {
	private source: string;
	private safetyRows = 20_000;
	private layout?: { width: number; lines: string[] };
	private hasCustomBg = false;
	private paddingXValue: number;
	private paddingYValue = 0;
	constructor(text = "", paddingX = 0, paddingY = 0) {
		super(text, paddingX, paddingY);
		this.source = text;
		this.paddingXValue = paddingX;
		this.paddingYValue = paddingY;
	}
	setText(text: string): void {
		this.layout = undefined;
		this.source = text;
		super.setText(text);
	}
	setSafetyRows(rows: number): void {
		const next = Math.max(1, Math.min(20_000, rows));
		if (next === this.safetyRows) return;
		this.safetyRows = next;
		this.layout = undefined;
	}
	setCustomBgFn(customBgFn?: (text: string) => string): void {
		this.layout = undefined;
		// A background function wraps every row in SGR bytes, so blank rows are real.
		this.hasCustomBg = typeof customBgFn === "function";
		super.setCustomBgFn(customBgFn);
	}
	/**
	 * Drop only the wrap artifact rows. The uncolored wrap is the reference: a row is
	 * droppable only while the colored rows are longer than it and only where that
	 * reference row has visible text, so a real blank line (including one a trailing
	 * newline produces) always survives.
	 */
	private settleRows(rows: string[], source: string, width: number): string[] {
		// An uncolored source cannot produce the wrap artifact, so skip the reference wrap.
		if (this.hasCustomBg || source.indexOf("\x1b") < 0 || !rows.some(isEscapeOnlyRow)) return rows;
		const paddingX = Math.min(this.paddingXValue, Math.max(0, Math.floor((width - 1) / 2)));
		const contentWidth = Math.max(1, width - paddingX * 2);
		const plainText = source.replace(/\x1b\[[0-9;]*m/g, "");
		const plain = wrapTextWithAnsi(plainText.replace(/\t/g, "   "), contentWidth);
		// Native padding rows are blank by construction, so they must never be mistaken for
		// the artifact: settle only the content region between them.
		const padding = Math.max(0, Math.min(this.paddingYValue, Math.floor((rows.length - 1) / 2)));
		const head = rows.slice(0, padding);
		const tail = padding > 0 ? rows.slice(rows.length - padding) : [];
		const content = padding > 0 ? rows.slice(padding, rows.length - padding) : rows;
		let excess = content.length - plain.length;
		if (excess <= 0) return rows;
		const kept: string[] = [];
		let cursor = 0;
		for (const row of content) {
			const plainRow = plain[cursor];
			const droppable =
				excess > 0 && isEscapeOnlyRow(row) && (plainRow === undefined || plainRow.trim() !== "");
			if (droppable) excess--;
			else {
				kept.push(row);
				cursor++;
			}
		}
		return kept.length > 0 ? [...head, ...kept, ...tail] : rows;
	}
	setPaddingX(paddingX: number): void {
		this.paddingXValue = paddingX;
		this.layout = undefined;
		// Older supported Pi versions have no native setter, so look it up defensively
		// instead of extending the base signature.
		const nativeSetPaddingX = (Text.prototype as Text & { setPaddingX?: (value: number) => void })
			.setPaddingX;
		nativeSetPaddingX?.call(this, paddingX);
	}
	invalidate(): void {
		this.layout = undefined;
		super.invalidate();
	}
	private rememberLayout(width: number, lines: string[]): string[] {
		this.layout = { width, lines };
		return lines.slice();
	}
	/** Truncate over-wide rows and drop the wrap artifact; shared by both render paths. */
	private finishRows(rows: string[], width: number): string[] {
		return this.settleRows(
			rows.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line)),
			this.source,
			width,
		);
	}
	/**
	 * Row-bounded render: wrap every line with an explicit row budget so a pathological
	 * source can never allocate more than `safetyRows` rows plus the omission notice.
	 */
	private renderBounded(lines: readonly string[], width: number, capped: boolean): string[] {
		const wrapped: string[] = [];
		let exhausted = capped;
		for (const line of lines) {
			if (wrapped.length >= 20_000) {
				exhausted = true;
				break;
			}
			const next = boundedWrap(line.replace(/\t/g, "   "), width, 20_000 - wrapped.length, true);
			exhausted ||= next.capped;
			for (const row of next.lines) wrapped.push(row);
		}
		if (!exhausted) {
			super.setText(this.source);
			return this.finishRows(super.render(width), width);
		}
		const shown = wrapped.slice(0, this.safetyRows);
		super.setText(
			`${shown.join("\n")}\n${truncateToWidth("… (preview output omitted)", width, "")}`,
		);
		return this.finishRows(super.render(width), width);
	}
	render(rawWidth: number): string[] {
		const width = safeWidth(rawWidth);
		if (!width) return [];
		// Cache only after safety validation; setters and host invalidation clear it.
		if (this.layout?.width === width) return this.layout.lines.slice();
		const input = boundedContentLines(this.source, 20_000);
		// The bounded pre-pass exists to build a capped row set. Prove it is unnecessary
		// with one cheap visible-width scan and a row-count estimate instead of wrapping
		// twice on every repaint; the estimate only triggers, the row count is the guard.
		const paddingX = Math.min(this.paddingXValue, Math.max(0, Math.floor((width - 1) / 2)));
		const contentWidth = Math.max(1, width - paddingX * 2);
		const columns = Math.min(MAX_PREVIEW_LINE_CHARS + 128, Math.max(1, width) * 20_000);
		const estimateLimit = Math.max(1, Math.floor(this.safetyRows / 2));
		let needsBound = input.capped || input.lines.length > this.safetyRows;
		if (!needsBound) {
			let estimate = 0;
			for (const line of input.lines) {
				const lineWidth = visibleWidth(line);
				if (lineWidth > columns) {
					needsBound = true;
					break;
				}
				estimate += Math.max(1, Math.ceil(lineWidth / contentWidth));
				if (estimate > estimateLimit) {
					needsBound = true;
					break;
				}
			}
		}
		if (needsBound)
			return this.rememberLayout(width, this.renderBounded(input.lines, width, input.capped));
		super.setText(this.source);
		const rows = this.finishRows(super.render(width), width);
		// Only bounded sources skip the pre-pass; a row count over the budget still takes
		// the capped path, so the fast path can never bypass the cap.
		if (rows.length > this.safetyRows)
			return this.rememberLayout(width, this.renderBounded(input.lines, width, true));
		return this.rememberLayout(width, rows);
	}
}
