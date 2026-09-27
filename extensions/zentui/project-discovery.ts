import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** One refresh only: share directory discovery, never retain filesystem state between polls. */
export class ProjectDiscovery {
	private listing?: Promise<ReadonlyMap<string, Dirent>>;
	private candidateNames?: ReadonlySet<string>;
	private readonly stats = new Map<string, Promise<Stats | undefined>>();

	constructor(readonly cwd: string) {}

	entries(): Promise<ReadonlyMap<string, Dirent>> {
		this.listing ??= readdir(this.cwd, { withFileTypes: true }).then((entries) => {
			this.candidateNames = new Set(entries.map((entry) => entry.name.toLowerCase()));
			return new Map(entries.map((entry) => [entry.name, entry]));
		});
		return this.listing;
	}

	stat(name: string): Promise<Stats | undefined> {
		let pending = this.stats.get(name);
		if (!pending) {
			pending = stat(join(this.cwd, name)).catch(() => undefined);
			this.stats.set(name, pending);
		}
		return pending;
	}

	/** Only a lookup filter: the filesystem decides whether alternate case resolves. */
	async hasCandidate(name: string): Promise<boolean> {
		await this.entries();
		return this.candidateNames?.has(name.toLowerCase()) === true;
	}

	async exists(name: string): Promise<boolean> {
		const entry = (await this.entries()).get(name);
		if (!entry) return (await this.hasCandidate(name)) && !!(await this.stat(name));
		return !entry.isSymbolicLink() || !!(await this.stat(name));
	}

	async isDirectory(name: string): Promise<boolean> {
		const entry = (await this.entries()).get(name);
		if (!entry) return (await this.hasCandidate(name)) && !!(await this.stat(name))?.isDirectory();
		return (
			!!entry &&
			(entry.isDirectory() || (entry.isSymbolicLink() && !!(await this.stat(name))?.isDirectory()))
		);
	}

	async read(name: string): Promise<string | undefined> {
		try {
			return await readFile(join(this.cwd, name), "utf8");
		} catch {
			return undefined;
		}
	}
}
