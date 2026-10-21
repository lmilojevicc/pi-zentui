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
 */
function isEscapeOnlyRow(row: string): boolean {
	if (row.indexOf("\x1b") < 0) return false;
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
	constructor(text = "", paddingX = 0, paddingY = 0) {
		super(text, paddingX, paddingY);
		this.source = text;
		this.paddingXValue = paddingX;
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
	 * Drop only as many escape-only rows as the plain text is short of; a whitespace
	 * row that a colored sequence legitimately produces (wide graphemes) is kept.
	 */
	private settleRows(rows: string[], source: string, width: number): string[] {
		if (this.hasCustomBg || !rows.some(isEscapeOnlyRow)) return rows;
		const paddingX = Math.min(this.paddingXValue, Math.max(0, Math.floor((width - 1) / 2)));
		const contentWidth = Math.max(1, width - paddingX * 2);
		const plainText = source.replace(/\x1b\[[0-9;]*m/g, "");
		const expected = wrapTextWithAnsi(plainText.replace(/\t/g, "   "), contentWidth).length;
		let excess = rows.length - expected;
		if (excess <= 0) return rows;
		// A trailing reset can land on a real trailing blank line (`…\n`); keep that row.
		const keepsTrailingBlank = /\n$/.test(plainText) || /\r$/.test(plainText);
		const kept: string[] = [];
		for (let index = 0; index < rows.length; index++) {
			const droppable =
				excess > 0 &&
				isEscapeOnlyRow(rows[index]) &&
				!(keepsTrailingBlank && index === rows.length - 1);
			if (droppable) excess--;
			else kept.push(rows[index]);
		}
		return kept.length > 0 ? kept : rows;
	}
	setPaddingX(paddingX: number): void {
		this.paddingXValue = paddingX;
		this.layout = undefined;
		const nativeSetPaddingX = (super.setPaddingX as ((value: number) => void) | undefined)?.bind(
			this,
		);
		nativeSetPaddingX?.(paddingX);
	}
	invalidate(): void {
		this.layout = undefined;
		super.invalidate();
	}
	private rememberLayout(width: number, lines: string[]): string[] {
		this.layout = { width, lines };
		return lines.slice();
	}
	render(rawWidth: number): string[] {
		const width = safeWidth(rawWidth);
		if (!width) return [];
		// Cache only after safety validation; setters and host invalidation clear it.
		if (this.layout?.width === width) return this.layout.lines.slice();
		const input = boundedContentLines(this.source, 20_000);
		// The bounded pre-pass exists to build a capped row set. Prove it is unnecessary
		// with one cheap visible-width scan instead of wrapping twice on every repaint.
		const columns = Math.min(MAX_PREVIEW_LINE_CHARS + 128, Math.max(1, width) * 20_000);
		const needsBound =
			input.capped ||
			input.lines.length > this.safetyRows ||
			input.lines.some((line) => visibleWidth(line) > columns);
		const wrapped: string[] = [];
		let capped = needsBound;
		if (needsBound) {
			capped = input.capped;
			for (const line of input.lines) {
				if (wrapped.length >= 20_000) {
					capped = true;
					break;
				}
				const next = boundedWrap(line.replace(/\t/g, "   "), width, 20_000 - wrapped.length, true);
				capped ||= next.capped;
				for (const row of next.lines) wrapped.push(row);
			}
		}
		if (!capped) {
			super.setText(this.source);
			return this.rememberLayout(
				width,
				this.settleRows(
					super
						.render(width)
						.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line)),
					this.source,
					width,
				),
			);
		}
		const shown = wrapped.slice(0, this.safetyRows);
		super.setText(
			`${shown.join("\n")}\n${truncateToWidth("… (preview output omitted)", width, "")}`,
		);
		return this.rememberLayout(
			width,
			this.settleRows(
				super
					.render(width)
					.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line)),
				this.source,
				width,
			),
		);
	}
}
