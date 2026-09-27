import type { ZentuiConfig } from "./config";

/** References include both wide and responsive compact formats, but only owned surfaces. */
export function projectDemand(
	config: ZentuiConfig,
	references: ReadonlySet<string>,
	ownsMinimalist: boolean,
) {
	const starship = config.components.footer.styles.starship;
	const minimalist = config.components.editor.styles.minimalist;
	const has = (...names: string[]) => names.some((name) => references.has(name));
	const git =
		has(
			"git_branch",
			"git_status",
			"git_state",
			"git_commit",
			"git_tag",
			"git_metrics",
			"git_added",
			"git_deleted",
		) ||
		(ownsMinimalist && minimalist.showGit);
	const root =
		(references.has("cwd") && starship.pathDisplay.mode === "repository") ||
		(ownsMinimalist && minimalist.pathDisplay === "project");
	const runtime = has("runtime");
	const packageVersion = has("package", "package_version");
	return {
		active: git || root || runtime || packageVersion,
		git,
		root,
		runtime,
		packageVersion,
		gitOptions: {
			readStash: has("git_status"),
			readOperationState: has("git_state"),
			readExactTag: (has("git_commit") && starship.gitCommit.showTag) || has("git_tag"),
			readMetrics: has("git_metrics", "git_added", "git_deleted"),
			ignoreSubmodules: starship.gitMetrics.ignoreSubmodules,
		},
	};
}
