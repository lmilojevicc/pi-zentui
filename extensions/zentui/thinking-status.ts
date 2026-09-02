import type { ThinkingStepsComponentConfig, ThinkingStepsMode } from "./config";

export type ThinkingStatusState = Readonly<{
	active: boolean;
	activeMode?: ThinkingStepsMode;
	restartRequired: boolean;
	/** Whole private renderer capability, independent of mode-specific resources. */
	rendererAvailable?: boolean;
	/** Streaming input/timer capability for this session. */
	streamingAvailable?: boolean;
	/** Irreversible session-local acquisition/callback poison. */
	streamingPoisoned?: boolean;
	/** Legacy whole-renderer capability accepted by settings adapters. */
	available?: boolean;
	reason?: string;
}>;

export type ThinkingStatusLabels = Readonly<{
	saved: ThinkingStepsMode | "disabled";
	active: ThinkingStepsMode | "native";
	rendererUnavailable: boolean;
	streamingUnavailable: boolean;
	streamingPoisoned: boolean;
	restartRequired: boolean;
	reason?: string;
}>;

function cleanReason(value: string | undefined): string | undefined {
	const reason = value
		?.replace(/(?:[;,·]\s*)?restart required\b[.!]?/gi, "")
		.replace(/^restart pi to apply(?: saved thinking changes)?[.!]?$/i, "")
		.replace(/^[\s;,.·]+|[\s;,.·]+$/g, "")
		.trim();
	if (!reason || /^(?:renderer|streaming) unavailable$/i.test(reason)) return undefined;
	return reason;
}

/** Builds independent status facts once so every consumer reports the same state. */
export function thinkingStatusLabels(
	config: ThinkingStepsComponentConfig,
	state: ThinkingStatusState,
): ThinkingStatusLabels {
	const rendererAvailable = state.rendererAvailable ?? state.available ?? true;
	const reason = cleanReason(state.reason);
	return {
		saved: config.enabled ? config.mode : "disabled",
		active: state.active && state.activeMode ? state.activeMode : "native",
		rendererUnavailable: !rendererAvailable,
		streamingUnavailable: state.streamingAvailable === false || state.streamingPoisoned === true,
		streamingPoisoned: state.streamingPoisoned === true,
		restartRequired: state.restartRequired,
		...(reason ? { reason } : {}),
	};
}

const modeLabel = (mode: ThinkingStepsMode | "disabled" | "native"): string =>
	`${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;

/** Formats the canonical complete status line used by settings, previews, and apply failures. */
export function formatThinkingStatus(facts: ThinkingStatusLabels): string {
	return [
		`Saved: ${modeLabel(facts.saved)}`,
		`Active: ${modeLabel(facts.active)}`,
		...(facts.rendererUnavailable ? ["Renderer unavailable"] : []),
		...(facts.streamingUnavailable ? ["Streaming unavailable"] : []),
		...(facts.restartRequired ? ["restart required"] : []),
		...(facts.reason ? [facts.reason] : []),
	].join(" · ");
}
