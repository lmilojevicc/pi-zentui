import { pathToFileURL } from "node:url";

const diagnosticPatterns = [
	/Failed to load extension(?:\s|:|")/i,
	/Extension\s+(?:"[^"\r\n]*"|'[^'\r\n]*')\s+error\s*:/i,
	/Extension error\s*\(/i,
	/loader diagnostic\s*:/i,
	/\b(?:ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_UNKNOWN_FILE_EXTENSION|MODULE_NOT_FOUND)\b/i,
];

export function hasExtensionLoaderDiagnostic(output) {
	return diagnosticPatterns.some((pattern) => pattern.test(output));
}

export const rejectedDiagnosticFixtures = Object.freeze([
	'Extension "/tmp/any path/zentui.ts" error: SyntaxError: unexpected token',
	"Extension '/private/quoted/path with spaces/index.ts' error: missing export",
	'Failed to load extension "/tmp/zentui.ts": import failed',
	"Failed to load extension: transform failed",
	"Extension error (/tmp/zentui.ts): runtime failure",
	"loader diagnostic: source module rejected",
	"ERR_MODULE_NOT_FOUND: Cannot find package pi-tui",
	"ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './package.json' is not defined",
	"ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension .ts",
	"MODULE_NOT_FOUND: Cannot find module 'pi-ai'",
]);

export const acceptedOutputFixtures = Object.freeze([
	"Thinking 0.1s  (ctrl+t to expand)",
	"Extension loaded: /tmp/zentui.ts",
	"The user asked whether a loader diagnostic would help explain an extension error.",
	"The assistant described the phrase extension error while discussing a loader diagnostic.",
	"The assistant discussed extension recovery strategy.",
]);

export function assertExtensionLoaderDiagnosticFixtures() {
	for (const fixture of rejectedDiagnosticFixtures) {
		if (!hasExtensionLoaderDiagnostic(fixture)) {
			throw new Error(`loader diagnostic fixture was not rejected: ${JSON.stringify(fixture)}`);
		}
	}
	for (const fixture of acceptedOutputFixtures) {
		if (hasExtensionLoaderDiagnostic(fixture)) {
			throw new Error(`ordinary output fixture was rejected: ${JSON.stringify(fixture)}`);
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	assertExtensionLoaderDiagnosticFixtures();
	console.log(
		`loader-diagnostics: rejected=${rejectedDiagnosticFixtures.length} accepted=${acceptedOutputFixtures.length}`,
	);
}
