const ESC = "\x1b";
const BEL = "\x07";
const C1_DCS = "\x90";
const C1_SOS = "\x98";
const C1_CSI = "\x9b";
const C1_ST = "\x9c";
const C1_OSC = "\x9d";
const C1_PM = "\x9e";
const C1_APC = "\x9f";
const CAN = 0x18;
const SUB = 0x1a;

type ControlBoundary =
	| { kind: "terminator"; index: number; length: number; safeOsc8Terminator: boolean }
	| { kind: "start"; index: number };

type FilterOptions = {
	preserveValidOsc8: boolean;
	preserveSourceWhitespace: boolean;
	preserveSgr: boolean;
};

type FilterResult = {
	text: string;
	balancedOsc8: boolean;
};

function anyOscStartLength(text: string, index: number): number {
	if (text[index] === C1_OSC) return 1;
	return text[index] === ESC && text[index + 1] === "]" ? 2 : 0;
}

function findOscBoundary(text: string, payloadStart: number): ControlBoundary | undefined {
	for (let index = payloadStart; index < text.length; index += 1) {
		if (anyOscStartLength(text, index) > 0) return { kind: "start", index };
		if (text[index] === BEL) {
			return { kind: "terminator", index, length: 1, safeOsc8Terminator: true };
		}
		if (text[index] === C1_ST) {
			return { kind: "terminator", index, length: 1, safeOsc8Terminator: false };
		}
		if (text[index] === ESC && text[index + 1] === "\\") {
			return { kind: "terminator", index, length: 2, safeOsc8Terminator: true };
		}
	}
	return undefined;
}

const terminalControlPattern = /[\u0000-\u001f\u007f-\u009f]/;
const safeParameterKeyPattern = /^[A-Za-z0-9_.-]+$/;

export function isValidUserMessageOsc8Payload(payload: string): boolean {
	if (!payload.startsWith("8;")) return false;
	const uriSeparator = payload.indexOf(";", 2);
	if (uriSeparator < 0) return false;

	const params = payload.slice(2, uriSeparator);
	const uri = payload.slice(uriSeparator + 1);
	if (params === "" && uri === "") return true;
	if (uri === "" || /\s/.test(uri) || terminalControlPattern.test(uri)) return false;
	if (params === "") return true;

	return params.split(":").every((entry) => {
		const equals = entry.indexOf("=");
		if (equals <= 0) return false;
		const key = entry.slice(0, equals);
		const value = entry.slice(equals + 1);
		return (
			safeParameterKeyPattern.test(key) &&
			!terminalControlPattern.test(key) &&
			!terminalControlPattern.test(value)
		);
	});
}

function incompleteOsc133PrefixLength(payload: string): number {
	if (payload.length > 0 && "133".startsWith(payload)) return payload.length;
	if (!payload.startsWith("133;")) return 0;

	let length = 4;
	if (/^[A-D]$/.test(payload[length] ?? "")) length += 1;
	if (payload[length] === ";") length += 1;
	return length;
}

function consumeCsi(value: string, start: number): number {
	for (let index = start; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === CAN || code === SUB) return index + 1;
		if (code >= 0x40 && code <= 0x7e) return index + 1;
	}
	return value.length;
}

function consumeControlString(value: string, start: number, allowBel: boolean): number {
	for (let index = start; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === CAN || code === SUB) return index + 1;
		if (allowBel && code === BEL.charCodeAt(0)) return index + 1;
		if (code === C1_ST.charCodeAt(0)) return index + 1;
		if (code === ESC.charCodeAt(0) && value[index + 1] === "\\") return index + 2;
	}
	return value.length;
}

function consumeEscape(value: string, start: number): number {
	if (start + 1 >= value.length) return value.length;
	const next = value[start + 1];
	if (next === "[") return consumeCsi(value, start + 2);
	if (next === "P" || next === "X" || next === "^" || next === "_") {
		return consumeControlString(value, start + 2, false);
	}

	let index = start + 1;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code >= 0x20 && code <= 0x2f) {
			index += 1;
			continue;
		}
		return code >= 0x30 && code <= 0x7e ? index + 1 : index;
	}
	return value.length;
}

function isSafeSgr(sequence: string): boolean {
	return /^\x1b\[[0-9:;]*m$/.test(sequence);
}

function isOsc8Close(payload: string): boolean {
	return payload === "8;;";
}

function updateOsc8Balance(payload: string, state: { open: boolean; invalid: boolean }): void {
	if (isOsc8Close(payload)) {
		if (!state.open) state.invalid = true;
		state.open = false;
		return;
	}
	if (state.open) state.invalid = true;
	state.open = true;
}

function filterUserMessageTerminalText(text: string, options: FilterOptions): FilterResult {
	let output = "";
	let index = 0;
	const osc8 = { open: false, invalid: false };
	while (index < text.length) {
		const oscStartLength = anyOscStartLength(text, index);
		if (oscStartLength > 0) {
			const payloadStart = index + oscStartLength;
			const boundary = findOscBoundary(text, payloadStart);
			if (boundary?.kind === "terminator") {
				const end = boundary.index + boundary.length;
				const payload = text.slice(payloadStart, boundary.index);
				if (
					options.preserveValidOsc8 &&
					oscStartLength === 2 &&
					boundary.safeOsc8Terminator &&
					isValidUserMessageOsc8Payload(payload)
				) {
					updateOsc8Balance(payload, osc8);
					output += text.slice(index, end);
				}
				index = end;
				continue;
			}

			// Removing an unterminated introducer prevents it from consuming
			// Zentui's prompt markers. Preserve visible trailing payload, except
			// for a recognized partial OSC 133 command prefix.
			const payloadEnd = boundary?.index ?? text.length;
			const payload = text.slice(payloadStart, payloadEnd);
			index = payloadStart + incompleteOsc133PrefixLength(payload);
			continue;
		}

		const code = text.charCodeAt(index);
		if (code === ESC.charCodeAt(0)) {
			if (text[index + 1] === "[") {
				const end = consumeCsi(text, index + 2);
				const sequence = text.slice(index, end);
				if (options.preserveSgr && isSafeSgr(sequence)) output += sequence;
				index = end;
				continue;
			}
			index = consumeEscape(text, index);
			continue;
		}
		if (text[index] === C1_CSI) {
			index = consumeCsi(text, index + 1);
			continue;
		}
		if (
			text[index] === C1_DCS ||
			text[index] === C1_SOS ||
			text[index] === C1_PM ||
			text[index] === C1_APC
		) {
			index = consumeControlString(text, index + 1, false);
			continue;
		}
		if (code === 0x09 || code === 0x0a) {
			if (options.preserveSourceWhitespace) output += text[index];
			index += 1;
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			index += 1;
			continue;
		}
		output += text[index];
		index += 1;
	}
	return { text: output, balancedOsc8: !osc8.open && !osc8.invalid };
}

function filterBalancedUserMessageTerminalText(text: string, options: FilterOptions): string {
	const filtered = filterUserMessageTerminalText(text, options);
	if (!options.preserveValidOsc8 || filtered.balancedOsc8) return filtered.text;
	return filterUserMessageTerminalText(text, { ...options, preserveValidOsc8: false }).text;
}

/** Strip every terminal control from untrusted source text before Markdown rendering. */
export function sanitizeUserMessageSourceText(text: string): string {
	return filterBalancedUserMessageTerminalText(text, {
		preserveValidOsc8: false,
		preserveSourceWhitespace: true,
		preserveSgr: false,
	});
}

/**
 * Sanitize a predecessor-rendered row. Pi formatting needs only SGR and
 * structurally valid 7-bit OSC 8; every other terminal control is removed.
 */
export function sanitizeRenderedUserMessageText(text: string): string {
	return filterBalancedUserMessageTerminalText(text, {
		preserveValidOsc8: true,
		preserveSourceWhitespace: true,
		preserveSgr: true,
	});
}

/** Sanitize one predecessor output stream while retaining its row boundaries. */
export function sanitizeRenderedUserMessageLines(lines: string[]): string[] {
	return sanitizeRenderedUserMessageText(lines.join("\n")).split("\n");
}
