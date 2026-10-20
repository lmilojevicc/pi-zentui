import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { boundedContentLines, boundedWrap, safeWidth } from "./bounds.ts";
/** Native Text in the normal domain; bounds are checked before native wrapping allocates rows. */
export class PresentationText extends Text {
	private source: string;
	private safetyRows = 20_000;
	private layout?: { width: number; lines: string[] };
	constructor(text = "", paddingX = 0, paddingY = 0) {
		super(text, paddingX, paddingY);
		this.source = text;
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
		super.setCustomBgFn(customBgFn);
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
		const wrapped: string[] = [];
		let capped = input.capped;
		for (const line of input.lines) {
			if (wrapped.length >= 20_000) {
				capped = true;
				break;
			}
			const next = boundedWrap(line.replace(/\t/g, "   "), width, 20_000 - wrapped.length, true);
			capped ||= next.capped;
			for (const row of next.lines) wrapped.push(row);
		}
		if (!capped) {
			super.setText(this.source);
			return this.rememberLayout(
				width,
				super
					.render(width)
					.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line)),
			);
		}
		const shown = wrapped.slice(0, this.safetyRows);
		super.setText(
			`${shown.join("\n")}\n${truncateToWidth("… (preview output omitted)", width, "")}`,
		);
		return this.rememberLayout(
			width,
			super
				.render(width)
				.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line)),
		);
	}
}
