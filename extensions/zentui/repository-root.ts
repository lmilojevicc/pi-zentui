import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type RepositoryRootState = {
	/** The cwd whose repository lookup produced this state. */
	cwd: string;
	root?: string;
};

export type RepositoryRootRequest = {
	cwd: string;
	generation: number;
};

/** Find the nearest ancestor containing either a .git directory or worktree .git file. */
export function findRepositoryRoot(cwd: string): string | undefined {
	let current = resolve(cwd);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export function updateRepositoryRootState(
	cwd: string,
	isRepository: boolean,
	findRoot: (cwd: string) => string | undefined = findRepositoryRoot,
): RepositoryRootState {
	if (!isRepository) return { cwd };
	try {
		return { cwd, root: findRoot(cwd) };
	} catch {
		return { cwd };
	}
}

/** Return only a current, still-present root produced for this exact cwd. */
export function repositoryRootForCwd(
	state: RepositoryRootState | undefined,
	cwd: string,
	markerExists: (path: string) => boolean = existsSync,
): string | undefined {
	if (!state?.root || state.cwd !== cwd) return undefined;
	try {
		return markerExists(join(state.root, ".git")) ? state.root : undefined;
	} catch {
		return undefined;
	}
}

/** Own repository-root request generations so returning to an older cwd cannot revive old state. */
export class RepositoryRootController {
	private generation = 0;
	private requestedCwd: string | undefined;
	private state: RepositoryRootState | undefined;

	request(cwd: string): RepositoryRootRequest {
		if (cwd !== this.requestedCwd) {
			this.generation += 1;
			this.requestedCwd = cwd;
			this.state = undefined;
		}
		return { cwd, generation: this.generation };
	}

	isCurrent(request: RepositoryRootRequest): boolean {
		return request.cwd === this.requestedCwd && request.generation === this.generation;
	}

	update(
		request: RepositoryRootRequest,
		isRepository: boolean,
		findRoot: (cwd: string) => string | undefined = findRepositoryRoot,
	): string | undefined {
		if (!this.isCurrent(request)) return undefined;
		this.state = updateRepositoryRootState(request.cwd, isRepository, findRoot);
		return this.state.root;
	}

	cachedRootForCwd(cwd: string): string | undefined {
		return this.state?.cwd === cwd ? this.state.root : undefined;
	}

	rootForCwd(
		cwd: string,
		markerExists: (path: string) => boolean = existsSync,
	): string | undefined {
		return repositoryRootForCwd(this.state, cwd, markerExists);
	}

	reset(): void {
		this.generation += 1;
		this.requestedCwd = undefined;
		this.state = undefined;
	}
}
