import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
	...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
	AssistantMessageComponent: undefined,
}));

describe("Streaming (Experimental) optional private export", () => {
	it("loads fail-open and preserves the selected mode when the private constructor is absent", async () => {
		const { ThinkingExperimentalController } = await import(
			"../extensions/zentui/thinking-experimental"
		);
		const config = { enabled: true, mode: "streaming" as const };
		const value = new ThinkingExperimentalController(() => config);
		const ctx = {
			mode: "tui",
			hasUI: true,
			ui: { onTerminalInput: vi.fn() },
			sessionManager: { getEntries: () => [] },
		};

		expect(value.state).toMatchObject({ available: false, active: false });
		expect(value.startSession(ctx as never)).toMatchObject({
			applied: false,
			reason: expect.stringContaining("unavailable"),
		});
		expect(config).toEqual({ enabled: true, mode: "streaming" });
		value.shutdown();
	});

	it("does not statically import or deep-import the private renderer", () => {
		const source = readFileSync(
			join(process.cwd(), "extensions/zentui/thinking-experimental.ts"),
			"utf8",
		);
		expect(source).not.toMatch(
			/import\s*\{[^}]*AssistantMessageComponent[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/s,
		);
		expect(source).not.toMatch(/pi-coding-agent\/(?:dist|src)\//);
		expect(source).toContain("AssistantMessageComponent?: PrivateAssistantConstructor");
	});
});
