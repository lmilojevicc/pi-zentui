import { formatAverageTokenRate } from "./average-token-rate";
import { sanitizeEditorMetadataText } from "./editor-metadata-format";
import { compiledFooterFormat, renderFormatTokens } from "./footer-format";
import { formatCount, formatElapsedDuration } from "./format";

export const DEFAULT_TURN_SUMMARY_FORMAT =
	"Turn took $turn_duration$join_sep(thought for $thought_duration)$join_sep(↑$input_tokens ↓$output_tokens)$join_sep$token_rate";
export const MAX_TURN_SUMMARY_FORMAT_LENGTH = 2048;
// Nested joined optional groups repeatedly evaluate children in the shared renderer.
const MAX_TURN_SUMMARY_GROUP_DEPTH = 8;

export function normalizeTurnSummaryFormat(value: unknown): string {
	if (typeof value !== "string" || value.length > MAX_TURN_SUMMARY_FORMAT_LENGTH)
		return DEFAULT_TURN_SUMMARY_FORMAT;
	const safe = sanitizeEditorMetadataText(value);
	let depth = 0;
	for (const character of safe) {
		if (character === "(" && ++depth > MAX_TURN_SUMMARY_GROUP_DEPTH)
			return DEFAULT_TURN_SUMMARY_FORMAT;
		if (character === ")") depth = Math.max(0, depth - 1);
	}
	return safe.trim() ? safe : DEFAULT_TURN_SUMMARY_FORMAT;
}

export function renderTurnSummaryFormat(
	format: string,
	metrics: {
		durationMs: number;
		thoughtDurationMs: number;
		input: number;
		output: number;
		averageTokenRate?: number;
	},
): string {
	const values: Record<string, string> = {
		turn_duration: formatElapsedDuration(metrics.durationMs),
		thought_duration:
			metrics.thoughtDurationMs > 0 ? formatElapsedDuration(metrics.thoughtDurationMs) : "",
		input_tokens: formatCount(metrics.input),
		output_tokens: formatCount(metrics.output),
		token_rate:
			metrics.averageTokenRate === undefined ||
			!Number.isFinite(metrics.averageTokenRate) ||
			metrics.averageTokenRate < 0
				? ""
				: formatAverageTokenRate(metrics.averageTokenRate),
		sep: " · ",
		separator: " · ",
	};
	try {
		const text = renderFormatTokens(
			compiledFooterFormat(normalizeTurnSummaryFormat(format)).tokens,
			(name) => (Object.hasOwn(values, name) ? (values[name] ?? "") : ""),
		);
		return text.startsWith(" ") ? text : ` ${text}`;
	} catch {
		return "";
	}
}
