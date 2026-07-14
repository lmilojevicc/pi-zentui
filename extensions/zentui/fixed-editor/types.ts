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

/** Result of parsing a keyboard scroll sequence. */
export type KeyboardScrollInput = {
	action: "pageUp" | "pageDown" | "jumpBottom" | "lineUp" | "lineDown";
};

/** Compositor configuration provided by a getter. */
export type CompositorConfig = {
	enabled: boolean;
	mouseScroll: boolean;
};

/** Result of rendering the pinned cluster. */
export type ClusterRender = {
	lines: string[];
	cursor: { row: number; col: number } | null;
};

/** Loose TUI shape with the internal fields the compositor touches. */
export type TuiLike = {
	children: { render(width: number): string[] }[];
	terminal?: TerminalLike;
	focusedComponent?: unknown;
	requestRender?: (force?: boolean) => void;
	doRender?: () => void;
	render?: (width: number) => string[];
	compositeLineAt?: (
		baseLine: string,
		overlayLine: string,
		startCol: number,
		overlayWidth: number,
		totalWidth: number,
	) => string;
	hardwareCursorRow?: number;
	cursorRow?: number;
	previousViewportTop?: number;
	addInputListener?: (
		listener: (data: string) => { consume?: boolean; data?: string } | undefined,
	) => () => void;
	hasOverlay?: () => boolean;
	overlayStack?: { hidden?: boolean }[];
};

/** Loose terminal shape with the fields the compositor patches. */
export type TerminalLike = {
	columns: number;
	rows: number;
	kittyProtocolActive?: boolean;
	write(data: string): void;
};
