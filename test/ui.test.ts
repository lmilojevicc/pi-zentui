import type { Theme } from "@mariozechner/pi-coding-agent";
import { UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { patchUserMessageComponent, restoreUserMessageComponent } from "../extensions/zentui/ui";

const theme = {
	fg(_color: string, text: string) {
		return text;
	},
} as Theme;

describe("patchUserMessageComponent", () => {
	afterEach(() => {
		restoreUserMessageComponent();
	});

	it("is idempotent and restores the original renderer", () => {
		const originalRender = UserMessageComponent.prototype.render;

		patchUserMessageComponent(theme);
		const patchedRender = UserMessageComponent.prototype.render;
		expect(patchedRender).not.toBe(originalRender);

		patchUserMessageComponent(theme);
		expect(UserMessageComponent.prototype.render).toBe(patchedRender);

		restoreUserMessageComponent();
		expect(UserMessageComponent.prototype.render).toBe(originalRender);
	});
});
