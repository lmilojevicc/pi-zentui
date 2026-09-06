import { stripVTControlCharacters } from "node:util";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { getCapabilities, resetCapabilitiesCache } from "@earendil-works/pi-tui";
import { afterAll, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../extensions/zentui/config";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

// A separate isolated test module is necessary: native themes/capabilities cache
// at import time. `screen` also disables links on Pi hosts predating PI_* flags.
const restoreEnvironment = vi.hoisted(() => {
	const overrides = {
		PI_HYPERLINKS: "0",
		PI_TRUE_COLOR: "0",
		COLORTERM: "",
		TERM: "screen",
		TMUX: undefined,
	};
	const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
});
initTheme("dark", false);
afterAll(() => {
	restoreEnvironment();
	resetCapabilitiesCache();
});

describe("native user-message reduced terminal capabilities", () => {
	it("keeps readable Markdown URLs and sanitizes raw controls without generated OSC 8 or truecolor", () => {
		expect(getCapabilities()).toMatchObject({ hyperlinks: false, trueColor: false });
		const config = structuredClone(defaultConfig);
		config.components.userMessages.style = "compact";
		const cleanup = installUserMessageStyle(
			() => undefined,
			() => config,
		);
		try {
			const message = new UserMessageComponent(
				"\x1b]8;;custom:unsafe\x07RAW\x1b]8;;\x07 \x1b[38;2;1;2;3mSOURCE\x1b[0m [docs](https://markdown.example)",
			);
			const output = message.render(100).join("\n");
			expect(output).not.toContain("\x1b]8;");
			expect(output).not.toMatch(/\x1b\[(?:38|48);2;/);
			expect(output).not.toContain("custom:unsafe");
			const plain = stripVTControlCharacters(output);
			expect(plain).toContain("RAW SOURCE");
			expect(plain).toContain("docs");
			expect(plain).toContain("https://markdown.example");
		} finally {
			cleanup();
		}
	});
});
