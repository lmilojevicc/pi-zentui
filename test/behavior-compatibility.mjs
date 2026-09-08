import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Matched, isolated package trees: never borrow the global or source node_modules.
const root = join(import.meta.dirname, "..");
const workspace = mkdtempSync(join(tmpdir(), "zentui-behavior-compatibility-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run test:behavior-compatibility");
const versions = process.env.ZENTUI_PI_VERSIONS?.split(",") ?? [
	"0.80.5",
	"0.84.0",
	"0.84.4",
	"0.85.1",
];
const packages = ["pi-ai", "pi-coding-agent", "pi-tui"];
const tests = [
	"subagent-summary.test.ts",
	"subagent-summary-view.test.ts",
	"subagent-summary-lifecycle.test.ts",
	"subagent-summary-config.test.ts",
	"editor-mouse.test.ts",
	"user-message-native.test.ts",
	"user-message-native-reduced-capabilities.test.ts",
	"settings-command.test.ts",
	"settings-keys.test.ts",
	"settings-list-selection.test.ts",
	"user-message-styles.test.ts",
	"user-message-osc.test.ts",
	"runtime.test.ts",
	"minimalist-editor.test.ts",
];
const vitest = JSON.parse(
	readFileSync(join(root, "node_modules/vitest/package.json"), "utf8"),
).version;
try {
	for (const version of versions) {
		const cwd = join(workspace, version);
		mkdirSync(cwd);
		cpSync(join(root, "extensions"), join(cwd, "extensions"), { recursive: true });
		mkdirSync(join(cwd, "test"));
		cpSync(join(root, "test/fixtures"), join(cwd, "test/fixtures"), { recursive: true });
		for (const test of tests) cpSync(join(root, "test", test), join(cwd, "test", test));
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ type: "module", private: true }));
		execFileSync(
			process.execPath,
			[
				npmCli,
				"install",
				"--ignore-scripts",
				"--no-package-lock",
				"--no-audit",
				"--no-fund",
				...packages.map((name) => `@earendil-works/${name}@${version}`),
				`vitest@${vitest}`,
			],
			{ cwd, stdio: "inherit", timeout: 180_000 },
		);
		for (const name of packages) {
			const installed = JSON.parse(
				readFileSync(join(cwd, "node_modules/@earendil-works", name, "package.json"), "utf8"),
			);
			if (installed.version !== version)
				throw new Error(`${name}: expected ${version}, got ${installed.version}`);
			console.log(`attested ${name}@${installed.version}`);
		}
		const agentDir = join(cwd, "agent");
		mkdirSync(agentDir);
		execFileSync(
			process.execPath,
			[join(cwd, "node_modules/vitest/vitest.mjs"), "run", "--testTimeout=30000"],
			{
				cwd,
				stdio: "inherit",
				timeout: 180_000,
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: agentDir,
					PI_OFFLINE: "1",
					PI_SKIP_VERSION_CHECK: "1",
				},
			},
		);
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
