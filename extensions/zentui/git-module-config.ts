export type GitBranchModuleConfig = {
	enable: boolean;
	truncation_length: number;
	truncation_symbol: string;
};

export type GitStatusModuleConfig = {
	enable: boolean;
};

export const DEFAULT_GIT_BRANCH_TRUNCATION_LENGTH = Number.MAX_SAFE_INTEGER;

export const defaultGitBranchModuleConfig: GitBranchModuleConfig = {
	enable: true,
	truncation_length: DEFAULT_GIT_BRANCH_TRUNCATION_LENGTH,
	truncation_symbol: "…",
};

export const defaultGitStatusModuleConfig: GitStatusModuleConfig = {
	enable: true,
};

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function booleanValue(record: ConfigRecord, key: string, fallback: boolean): boolean {
	const value = record[key];
	return typeof value === "boolean" ? value : fallback;
}

function stringValue(record: ConfigRecord, key: string, fallback: string): string {
	const value = record[key];
	return typeof value === "string" ? value : fallback;
}

function truncationLengthValue(record: ConfigRecord): number {
	const value = record.truncation_length;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return defaultGitBranchModuleConfig.truncation_length;
	}

	const length = Math.round(value);
	if (length < 0) return defaultGitBranchModuleConfig.truncation_length;
	return Math.min(length, DEFAULT_GIT_BRANCH_TRUNCATION_LENGTH);
}

export function normalizeGitBranchModuleConfig(value: unknown): GitBranchModuleConfig {
	if (!isRecord(value)) return { ...defaultGitBranchModuleConfig };

	return {
		enable: booleanValue(value, "enable", defaultGitBranchModuleConfig.enable),
		truncation_length: truncationLengthValue(value),
		truncation_symbol: stringValue(
			value,
			"truncation_symbol",
			defaultGitBranchModuleConfig.truncation_symbol,
		),
	};
}

export function normalizeGitStatusModuleConfig(value: unknown): GitStatusModuleConfig {
	if (!isRecord(value)) return { ...defaultGitStatusModuleConfig };

	return {
		enable: booleanValue(value, "enable", defaultGitStatusModuleConfig.enable),
	};
}
