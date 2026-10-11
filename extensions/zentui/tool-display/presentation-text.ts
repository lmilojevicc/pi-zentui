import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { boundedContentLines, boundedWrap, safeWidth } from "./bounds.js";
/** Native Text in the normal domain; bounds are checked before native wrapping allocates rows. */
export class PresentationText extends Text {
	private source: string;
	private safetyRows = 20_000;
	constructor(text = "", paddingX = 0, paddingY = 0) {
		super(text, paddingX, paddingY);
		this.source = text;
	}
	setText(text: string): void {
		this.source = text;
		super.setText(text);
	}
	setSafetyRows(rows: number): void {
		this.safetyRows = Math.max(1, Math.min(20_000, rows));
	}
	render(rawWidth: number): string[] {
		const width = safeWidth(rawWidth);
		if (!width) return [];
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
			return super
				.render(width)
				.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
		}
		const shown = wrapped.slice(0, this.safetyRows);
		super.setText(
			`${shown.join("\n")}\n${truncateToWidth("… (preview output omitted)", width, "")}`,
		);
		return super
			.render(width)
			.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
	}
}
