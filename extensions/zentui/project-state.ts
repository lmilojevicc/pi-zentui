import type { GitReadResult } from "./git";
import { emptyGitStatus } from "./git";
import type { PackageVersionReadResult } from "./package-version";
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
		packageVersion?: PackageVersionReadResult;
	},
): string {
	const cwdChanged = args.previousCwd !== undefined && args.previousCwd !== args.cwd;

	if (cwdChanged) {
		Object.assign(state, emptyGitStatus());
		state.runtime = undefined;
		state.packageVersion = undefined;
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

	if (args.packageVersion !== undefined) {
		if (args.packageVersion.kind === "ok") {
			// `null` means "no manifest in this cwd"; clear so the segment disappears
			// even on the same cwd when the user removes their manifest.
			state.packageVersion = args.packageVersion.result ?? undefined;
		} else if (!cwdChanged) {
			// error + same cwd: keep previous packageVersion (last-good semantics)
		} else {
			state.packageVersion = undefined;
		}
	}

	return args.cwd;
}
