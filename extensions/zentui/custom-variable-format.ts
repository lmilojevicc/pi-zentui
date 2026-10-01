import { visibleWidth } from "@earendil-works/pi-tui";
import { MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS, MAX_CUSTOM_VARIABLES } from "./custom-variables";

/** Owner-local aliases never replace built-in or structural variables. */
export function normalizeTemplateVariables(
	value: unknown,
	reserved: readonly string[],
): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const excluded = new Set([
		...reserved,
		"__proto__",
		"constructor",
		"prototype",
		"fill",
		"wrap",
		"wrap_sep",
		"extensions",
	]);
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([name, key]) =>
					/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) &&
					!excluded.has(name) &&
					typeof key === "string" &&
					key.length > 0 &&
					key.length <= MAX_CUSTOM_VARIABLE_KEY_CODE_UNITS &&
					!/[\s\x00-\x20\x7f-\x9f]/.test(key),
			)
			.slice(0, MAX_CUSTOM_VARIABLES),
	);
}

/** Internal width-equivalent probes survive packing only when a complete value fits.
 * Probes are restored before any terminal output; publisher strings are never parsed as probes.
 */
export class AtomicTemplateValues {
	private readonly values = new Map<string, { marker: string; probe: string; text: string }>();

	constructor(values: ReadonlyMap<string, string>, source: readonly string[]) {
		let candidate = 0xe000;
		const reserved = [...source, ...values.values()].join("");
		for (const [key, text] of values) {
			const width = visibleWidth(text);
			if (!width) continue;
			while (candidate <= 0xf8ff && reserved.includes(String.fromCharCode(candidate))) candidate++;
			if (candidate > 0xf8ff) break;
			const marker = String.fromCharCode(candidate++);
			if (visibleWidth(marker) !== 1) continue;
			this.values.set(key, { marker, probe: marker.repeat(width), text });
		}
	}

	resolve(key: string): string {
		return this.values.get(key)?.probe ?? "";
	}

	omitted(source: readonly string[], rows: readonly string[]): string[] {
		const input = source.join("\n");
		const output = rows.join("\n");
		return [...this.values]
			.filter(([, { marker, probe }]) => {
				const expected = input.split(probe).length - 1;
				const actual = output.split(probe).length - 1;
				// Also detect partial values cropped before the final packer source was captured.
				const cells = output.split(marker).length - 1;
				return expected !== actual || cells !== actual * probe.length;
			})
			.map(([key]) => key);
	}

	restore(rows: readonly string[]): string[] {
		return rows.map((row) => {
			for (const { probe, text } of this.values.values()) row = row.replaceAll(probe, text);
			return row;
		});
	}
}
