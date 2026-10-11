import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function validateReferenceSources(root, manifest) {
	const names = readdirSync(join(root, "src"))
		.filter((name) => name.endsWith(".ts"))
		.sort();
	if (JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.files).sort()))
		throw new Error("Pinned reference source inventory mismatch");
	for (const [name, expected] of Object.entries(manifest.files)) {
		const actual = createHash("sha256")
			.update(readFileSync(join(root, "src", name)))
			.digest("hex");
		if (actual !== expected) throw new Error(`Pinned reference source hash mismatch: ${name}`);
	}
	return manifest.files;
}
