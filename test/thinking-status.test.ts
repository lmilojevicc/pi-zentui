import { describe, expect, it } from "vitest";
import type { ThinkingStepsComponentConfig } from "../extensions/zentui/config";
import {
	formatThinkingStatus,
	type ThinkingStatusState,
	thinkingStatusLabels,
} from "../extensions/zentui/thinking-status";

const config = (mode: ThinkingStepsComponentConfig["mode"]): ThinkingStepsComponentConfig => ({
	enabled: true,
	mode,
});

const status = (mode: ThinkingStepsComponentConfig["mode"], state: ThinkingStatusState) =>
	formatThinkingStatus(thinkingStatusLabels(config(mode), state));

describe("Thinking status", () => {
	it("reports displaced whole-renderer availability independently", () => {
		expect(
			status("tree", {
				active: false,
				rendererAvailable: false,
				streamingAvailable: true,
				restartRequired: true,
				reason: "Private renderer patch ownership was displaced",
			}),
		).toBe(
			"Saved: Tree · Active: Native · Renderer unavailable · restart required · Private renderer patch ownership was displaced",
		);
	});

	it("reports a matcher runtime failure as Streaming-only unavailability", () => {
		expect(
			status("streaming", {
				active: false,
				rendererAvailable: true,
				streamingAvailable: false,
				restartRequired: true,
				reason: "Pi's thinking-toggle matcher failed at runtime",
			}),
		).toBe(
			"Saved: Streaming · Active: Native · Streaming unavailable · restart required · Pi's thinking-toggle matcher failed at runtime",
		);
	});

	it("keeps poisoned Streaming visible while Rail is healthy", () => {
		expect(
			status("rail", {
				active: true,
				activeMode: "rail",
				rendererAvailable: true,
				streamingAvailable: false,
				streamingPoisoned: true,
				restartRequired: false,
				reason: "Pi's thinking timer is unavailable",
			}),
		).toBe(
			"Saved: Rail · Active: Rail · Streaming unavailable · Pi's thinking timer is unavailable",
		);
	});

	it("reports an enabled startup fallback as active native", () => {
		expect(
			status("tree", {
				active: false,
				rendererAvailable: true,
				streamingAvailable: true,
				restartRequired: true,
			}),
		).toBe("Saved: Tree · Active: Native · restart required");
	});

	it("does not duplicate availability or restart text from a reason", () => {
		expect(
			status("streaming", {
				active: true,
				activeMode: "rail",
				rendererAvailable: true,
				streamingAvailable: false,
				restartRequired: true,
				reason: "Streaming unavailable; restart required",
			}),
		).toBe("Saved: Streaming · Active: Rail · Streaming unavailable · restart required");
	});
});
