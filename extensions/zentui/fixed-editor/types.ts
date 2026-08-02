/**
 * Shared types for the fixed/sticky editor compositor.
 *
 * @internal
 */

/** Result of parsing a mouse SGR wheel sequence. */
export type MouseScrollInput = {
	direction: "up" | "down";
	amount: number;
};

/** Full parsed SGR mouse event. */
export type MouseEvent = {
	button: "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "other";
	action: "press" | "drag" | "release";
	col: number; // 1-indexed
	row: number; // 1-indexed
};

/** Result of parsing a keyboard scroll sequence. */
export type KeyboardScrollInput = {
	action: "pageUp" | "pageDown" | "jumpBottom" | "lineUp" | "lineDown";
};

/** Compositor configuration provided by a getter. */
export type CompositorConfig = {
	enabled: boolean;
	mouseScroll: boolean;
	copyNotice: boolean;
};

export type DisposalReason = "live" | "shutdown";

export type FixedLayoutPlan =
	| {
			mode: "fixed";
			transcriptRows: number;
			selectedEditorRows: readonly number[];
			selectedAutocompleteRows: readonly number[];
			statusBudget: number;
			aboveBudget: number;
			belowBudget: number;
			footerBudget: number;
	  }
	| {
			mode: "normal-flow";
			reason: "editor-minimum-does-not-fit" | "opaque-editor-does-not-fit";
	  }
	| { mode: "no-terminal-rows"; pendingDesiredMode: "fixed" | "normal-flow" };

/** Result of rendering the pinned cluster. */
export type ClusterRender = {
	mode: "fixed" | "normal-flow" | "no-terminal-rows";
	lines: string[];
	cursor: { row: number; col: number } | null;
	plan?: FixedLayoutPlan;
};
