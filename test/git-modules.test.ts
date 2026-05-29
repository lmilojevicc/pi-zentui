import { describe, expect, it } from "vitest";
import type { PolishedTuiConfig } from "../extensions/zentui/config";
import { defaultConfig } from "../extensions/zentui/config";
import { emptyGitStatus } from "../extensions/zentui/git";
import { renderGitModules, truncateGitBranch } from "../extensions/zentui/git-modules";
import type { ThemeLike } from "../extensions/zentui/style";

const theme: ThemeLike = {
	fg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
};

function configWithGitModules(
	gitBranch: Partial<PolishedTuiConfig["gitBranch"]> = {},
	gitStatus: Partial<PolishedTuiConfig["gitStatus"]> = {},
): PolishedTuiConfig {
	return {
		...defaultConfig,
		gitBranch: {
			...defaultConfig.gitBranch,
			...gitBranch,
		},
		gitStatus: {
			...defaultConfig.gitStatus,
			...gitStatus,
		},
	};
}

describe("git module rendering", () => {
	it("leaves branch names untruncated by default", () => {
		expect(truncateGitBranch("feature/very-long-branch", defaultConfig.gitBranch)).toBe(
			"feature/very-long-branch",
		);
	});

	it("truncates branch names by display width and appends the full truncation symbol", () => {
		const config = configWithGitModules({ truncation_length: 4, truncation_symbol: "..." });

		expect(truncateGitBranch("feature/foo", config.gitBranch)).toBe("feat...");
	});

	it("renders only the truncation symbol when truncation length is zero", () => {
		const config = configWithGitModules({ truncation_length: 0 });

		expect(truncateGitBranch("feature/foo", config.gitBranch)).toBe("…");
	});

	it("preserves the existing combined git output when both modules are enabled", () => {
		const state = emptyGitStatus();
		state.branch = "main";
		state.modified = 1;

		expect(renderGitModules(theme, "theme", defaultConfig, state)).toBe("on  main [!]");
	});

	it("renders git status independently when the branch module is disabled", () => {
		const state = emptyGitStatus();
		state.branch = "main";
		state.modified = 1;
		const config = configWithGitModules({ enable: false });

		expect(renderGitModules(theme, "theme", config, state)).toBe("[!]");
	});

	it("renders the branch independently when the status module is disabled", () => {
		const state = emptyGitStatus();
		state.branch = "main";
		state.modified = 1;
		const config = configWithGitModules({}, { enable: false });

		expect(renderGitModules(theme, "theme", config, state)).toBe("on  main");
	});

	it("suppresses an empty branch module when truncation leaves no branch text or marker", () => {
		const state = emptyGitStatus();
		state.branch = "main";
		state.modified = 1;
		const config = configWithGitModules({ truncation_length: 0, truncation_symbol: "" });

		expect(renderGitModules(theme, "theme", config, state)).toBe("[!]");
	});
});
