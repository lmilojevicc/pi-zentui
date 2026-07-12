import type { GitReadResult } from "./git";
import { emptyGitStatus } from "./git";
import type { RuntimeReadResult } from "./runtime";
import type { FooterState } from "./state";

/**
 * Apply a project refresh (git + runtime) onto footer state, preserving
 * last-good values on transient errors and clearing on cwd change / not-a-repo.
 *
 * Returns the cwd to store as `previousCwd` for the next refresh.
 */
export function applyProjectRefreshToState(
	state: FooterState,
	args: {
		cwd: string;
		previousCwd: string | undefined;
		git: GitReadResult;
		runtime: RuntimeReadResult;
	},
): string {
	const cwdChanged = args.previousCwd !== undefined && args.previousCwd !== args.cwd;

	if (cwdChanged) {
		Object.assign(state, emptyGitStatus());
		state.runtime = undefined;
	}

	if (args.git.kind === "ok") {
		Object.assign(state, args.git.status);
	} else if (args.git.kind === "not_a_repo") {
		Object.assign(state, emptyGitStatus());
	}
	// kind === "error": keep previous git fields (unless cwdChanged already cleared)

	if (args.runtime.kind === "ok") {
		state.runtime = args.runtime.runtime;
	} else if (cwdChanged && args.runtime.kind === "error") {
		// Already cleared above; keep undefined.
		state.runtime = undefined;
	}
	// error + same cwd: keep previous runtime

	return args.cwd;
}
