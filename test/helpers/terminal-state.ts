export type TerminalScreen = "primary" | "alternate";

type VisualTerminalState = {
	autowrap: boolean;
	cursorVisible: boolean;
	mouse1000: boolean;
	mouse1002: boolean;
	mouse1006: boolean;
	alternateScroll: boolean;
	scrollRegion: "full" | { top: number; bottom: number };
};

type KeyboardTerminalState = {
	bracketedPaste: boolean;
	modifyOtherKeys: 0 | 2;
	kittyFlags: number;
	kittyStack: number[];
};

export type ScreenTerminalState = VisualTerminalState & KeyboardTerminalState;

export type OwnedTerminalState = ScreenTerminalState & {
	buffer: TerminalScreen;
};

function defaultVisualState(): VisualTerminalState {
	return {
		autowrap: true,
		cursorVisible: true,
		mouse1000: false,
		mouse1002: false,
		mouse1006: false,
		alternateScroll: false,
		scrollRegion: "full",
	};
}

function defaultKeyboardState(
	initial: Partial<KeyboardTerminalState> | undefined,
): KeyboardTerminalState {
	return {
		bracketedPaste: initial?.bracketedPaste ?? false,
		modifyOtherKeys: initial?.modifyOtherKeys ?? 0,
		kittyFlags: initial?.kittyFlags ?? 0,
		kittyStack: [...(initial?.kittyStack ?? [])],
	};
}

export class OwnedTerminalStateParser {
	private activeScreen: TerminalScreen;
	private readonly visual: VisualTerminalState;
	private readonly keyboard: Record<TerminalScreen, KeyboardTerminalState>;
	private pending = "";
	readonly operations: string[] = [];
	readonly keyboardUnderflows: TerminalScreen[] = [];

	constructor(
		initial: Partial<OwnedTerminalState> = {},
		screens: Partial<Record<TerminalScreen, Partial<ScreenTerminalState>>> = {},
		private readonly kittySupported = true,
	) {
		this.activeScreen = initial.buffer ?? "primary";
		this.visual = { ...defaultVisualState(), ...initial };
		this.keyboard = {
			primary: defaultKeyboardState(screens.primary),
			alternate: defaultKeyboardState(screens.alternate),
		};
		const active = this.keyboard[this.activeScreen];
		if (initial.bracketedPaste !== undefined) active.bracketedPaste = initial.bracketedPaste;
		if (initial.modifyOtherKeys !== undefined) active.modifyOtherKeys = initial.modifyOtherKeys;
		if (initial.kittyFlags !== undefined) active.kittyFlags = initial.kittyFlags;
		if (initial.kittyStack !== undefined) active.kittyStack = [...initial.kittyStack];
	}

	get state(): OwnedTerminalState {
		return { buffer: this.activeScreen, ...this.screen(this.activeScreen) };
	}

	screen(screen: TerminalScreen): ScreenTerminalState {
		return {
			...this.visual,
			...this.keyboard[screen],
			kittyStack: [...this.keyboard[screen].kittyStack],
		};
	}

	feed(chunk: string): void {
		this.pending += chunk;
		let cursor = 0;
		const pattern = /\x1b\[([?=><]?)([0-9;:]*)([A-Za-z])/g;
		for (let match = pattern.exec(this.pending); match; match = pattern.exec(this.pending)) {
			cursor = pattern.lastIndex;
			const prefix = match[1] ?? "";
			const args = match[2] ?? "";
			const final = match[3] ?? "";
			const sequence = match[0];
			const keyboard = this.keyboard[this.activeScreen];

			if (prefix === ">" && final === "u") {
				if (!this.kittySupported) continue;
				const flags = Number(args || "0");
				if (Number.isFinite(flags)) {
					keyboard.kittyStack.push(keyboard.kittyFlags);
					keyboard.kittyFlags = flags;
					this.operations.push(sequence);
				}
				continue;
			}
			if (prefix === "<" && final === "u") {
				if (!this.kittySupported) continue;
				const count = Math.max(1, Number(args || "1"));
				for (let index = 0; index < count; index++) {
					const previous = keyboard.kittyStack.pop();
					if (previous === undefined) {
						this.keyboardUnderflows.push(this.activeScreen);
						keyboard.kittyFlags = 0;
					} else {
						keyboard.kittyFlags = previous;
					}
				}
				this.operations.push(sequence);
				continue;
			}
			if (prefix === "=" && final === "u") {
				if (!this.kittySupported) continue;
				const flags = Number(args.split(";")[0] || "0");
				if (Number.isFinite(flags)) keyboard.kittyFlags = flags;
				this.operations.push(sequence);
				continue;
			}
			if (prefix === ">" && final === "m") {
				const [resource, level] = args.split(";").map(Number);
				if (resource === 4 && (level === 0 || level === 2)) {
					keyboard.modifyOtherKeys = level;
					this.operations.push(sequence);
				}
				continue;
			}
			if (final === "r" && prefix === "") {
				const parts = args ? args.split(";").map(Number) : [];
				const top = parts[0];
				const bottom = parts[1];
				this.visual.scrollRegion =
					parts.length === 2 && Number.isFinite(top) && Number.isFinite(bottom)
						? { top: top ?? 0, bottom: bottom ?? 0 }
						: "full";
				this.operations.push(sequence);
				continue;
			}
			if (prefix !== "?" || (final !== "h" && final !== "l")) continue;
			const enabled = final === "h";
			for (const code of args.split(";")) {
				switch (code) {
					case "1049":
						this.activeScreen = enabled ? "alternate" : "primary";
						break;
					case "7":
						this.visual.autowrap = enabled;
						break;
					case "25":
						this.visual.cursorVisible = enabled;
						break;
					case "1000":
						this.visual.mouse1000 = enabled;
						break;
					case "1002":
						this.visual.mouse1002 = enabled;
						break;
					case "1006":
						this.visual.mouse1006 = enabled;
						break;
					case "1007":
						this.visual.alternateScroll = enabled;
						break;
					case "2004":
						this.keyboard[this.activeScreen].bracketedPaste = enabled;
						break;
					default:
						continue;
				}
				this.operations.push(`\x1b[?${code}${final}`);
			}
		}
		const lastEscape = this.pending.lastIndexOf("\x1b");
		this.pending =
			lastEscape >= cursor ? this.pending.slice(lastEscape) : this.pending.slice(cursor);
		if (this.pending.length > 64) this.pending = this.pending.slice(-64);
	}

	isSafe(keyboardBaseline: { kittyFlags?: number; kittyStack?: readonly number[] } = {}): boolean {
		const primary = this.keyboard.primary;
		const expectedStack = keyboardBaseline.kittyStack ?? [];
		return (
			this.activeScreen === "primary" &&
			this.visual.autowrap &&
			this.visual.cursorVisible &&
			!this.visual.mouse1000 &&
			!this.visual.mouse1002 &&
			!this.visual.mouse1006 &&
			!this.visual.alternateScroll &&
			!primary.bracketedPaste &&
			primary.modifyOtherKeys === 0 &&
			primary.kittyFlags === (keyboardBaseline.kittyFlags ?? 0) &&
			primary.kittyStack.length === expectedStack.length &&
			primary.kittyStack.every((value, index) => value === expectedStack[index]) &&
			this.visual.scrollRegion === "full" &&
			this.keyboardUnderflows.length === 0
		);
	}
}
