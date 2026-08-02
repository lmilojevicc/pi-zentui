export type OwnedTerminalState = {
	buffer: "primary" | "alternate";
	autowrap: boolean;
	cursorVisible: boolean;
	mouse1000: boolean;
	mouse1002: boolean;
	mouse1006: boolean;
	alternateScroll: boolean;
	scrollRegion: "full" | { top: number; bottom: number };
};

export class OwnedTerminalStateParser {
	readonly state: OwnedTerminalState;
	private pending = "";
	readonly operations: string[] = [];

	constructor(initial: Partial<OwnedTerminalState> = {}) {
		this.state = {
			buffer: "primary",
			autowrap: true,
			cursorVisible: true,
			mouse1000: false,
			mouse1002: false,
			mouse1006: false,
			alternateScroll: false,
			scrollRegion: "full",
			...initial,
		};
	}

	feed(chunk: string): void {
		this.pending += chunk;
		let cursor = 0;
		const pattern = /\x1b\[([?]?)([0-9;]*)([hlr])/g;
		for (let match = pattern.exec(this.pending); match; match = pattern.exec(this.pending)) {
			cursor = pattern.lastIndex;
			const privateMode = match[1] === "?";
			const args = match[2] ?? "";
			const final = match[3];
			const sequence = match[0];
			if (final === "r" && !privateMode) {
				const parts = args ? args.split(";").map(Number) : [];
				const top = parts[0];
				const bottom = parts[1];
				this.state.scrollRegion =
					parts.length === 2 && Number.isFinite(top) && Number.isFinite(bottom)
						? { top: top ?? 0, bottom: bottom ?? 0 }
						: "full";
				this.operations.push(sequence);
				continue;
			}
			if (!privateMode || (final !== "h" && final !== "l")) continue;
			const enabled = final === "h";
			for (const code of args.split(";")) {
				switch (code) {
					case "1049":
						this.state.buffer = enabled ? "alternate" : "primary";
						break;
					case "7":
						this.state.autowrap = enabled;
						break;
					case "25":
						this.state.cursorVisible = enabled;
						break;
					case "1000":
						this.state.mouse1000 = enabled;
						break;
					case "1002":
						this.state.mouse1002 = enabled;
						break;
					case "1006":
						this.state.mouse1006 = enabled;
						break;
					case "1007":
						this.state.alternateScroll = enabled;
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

	isSafe(): boolean {
		return (
			this.state.buffer === "primary" &&
			this.state.autowrap &&
			this.state.cursorVisible &&
			!this.state.mouse1000 &&
			!this.state.mouse1002 &&
			!this.state.mouse1006 &&
			!this.state.alternateScroll &&
			this.state.scrollRegion === "full"
		);
	}
}
