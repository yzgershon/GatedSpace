// Path validation for the procedures that hand a path to the operating system.
//
// `isAbsolute` is not enough on Windows. A UNC path (`\\host\share\file`) is
// absolute, so it passes that check and reaches shell.showItemInFolder /
// shell.openPath / an editor CLI — at which point Windows connects to the host
// and authenticates automatically, handing over a NetNTLMv2 hash for offline
// cracking or relay. The user sees a file dialog, not a network login.
//
// Extended-length local paths (`\\?\C:\...`) also start with two backslashes
// but are local, so they stay allowed. `\\?\UNC\host\share` is UNC wearing the
// same prefix and does not.
//
// Kept free of trpc/electron imports so it can be unit tested.

import { isAbsolute } from "node:path";

/** `\\?\C:\...` or `\\?\D:` — extended-length, but local. */
const EXTENDED_LOCAL = /^[\\/]{2}[?.][\\/][a-z]:/i;

/** `\\?\UNC\host\share` — extended-length UNC. */
const EXTENDED_UNC = /^[\\/]{2}[?.][\\/]unc[\\/]/i;

export function isUncPath(candidate: string): boolean {
	if (EXTENDED_UNC.test(candidate)) return true;
	if (EXTENDED_LOCAL.test(candidate)) return false;
	// Any other leading pair of separators is a network path.
	return /^[\\/]{2}/.test(candidate);
}

export type LocalPathRejection = "not-absolute" | "unc";

/** null when the path is a local absolute path, otherwise why it was refused. */
export function checkLocalAbsolutePath(
	candidate: string,
): LocalPathRejection | null {
	if (isUncPath(candidate)) return "unc";
	if (!isAbsolute(candidate)) return "not-absolute";
	return null;
}

export function describeRejection(
	reason: LocalPathRejection,
	procedure: string,
	candidate: string,
): string {
	if (reason === "unc") {
		return `${procedure} refuses network paths (got ${JSON.stringify(candidate)}). Opening one makes Windows authenticate to the remote host.`;
	}
	return `${procedure} requires an absolute path (got ${JSON.stringify(candidate)}).`;
}
