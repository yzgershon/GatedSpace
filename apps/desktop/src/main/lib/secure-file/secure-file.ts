// Owner-only file permissions that hold on Windows.
//
// The codebase already asks for the right thing — SUPERSET_SENSITIVE_FILE_MODE
// is 0o600 and the bridge token, push keys and local db all pass it. The
// problem is that on NTFS Node's `mode` only toggles the read-only attribute.
// It never writes a DACL. So every one of those files silently inherits
// whatever its parent directory grants, and on this maintainer's machine that
// meant a lower-trust local group could read the host-service pre-shared key,
// the terminal-host token and the account token.
//
// These wrappers set the POSIX mode AND, on Windows, replace the inherited ACL
// with a single entry for the current user. Use them anywhere a secret, a
// token, or a credential-bearing manifest is written.

import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { SUPERSET_SENSITIVE_FILE_MODE } from "../app-environment";

/**
 * Drops inherited permissions and grants only the current user.
 *
 * Best effort on purpose. These callers are on the startup path for terminals,
 * auth and the host service; hard-failing any of them over a permissions tweak
 * would be a worse outcome than the permissions being loose, which is the
 * status quo this improves on. Failures are silent by design — a thrown icacls
 * error here is not actionable and would only add noise to launch.
 */
export function restrictToCurrentUser(targetPath: string): void {
	if (process.platform !== "win32") return;
	const user = process.env.USERNAME ?? userInfo().username;
	if (!user) return;

	// (OI)(CI) are inheritance flags, valid only on a directory. Passing them
	// for a file makes icacls reject the /grant AFTER /inheritance:r has
	// applied, leaving an empty DACL that locks out the owner too.
	let isDirectory: boolean;
	try {
		isDirectory = statSync(targetPath).isDirectory();
	} catch {
		return;
	}

	try {
		execFileSync(
			"icacls",
			[
				targetPath,
				"/inheritance:r",
				"/grant:r",
				isDirectory ? `${user}:(OI)(CI)F` : `${user}:F`,
			],
			{ stdio: "ignore", windowsHide: true, timeout: 10_000 },
		);
	} catch {
		// Ignored on purpose — see the doc comment.
	}
}

/** writeFileSync for a secret: 0600 plus a real Windows ACL. */
export function writeSecureFile(
	filePath: string,
	data: string | Uint8Array,
): void {
	writeFileSync(filePath, data, { mode: SUPERSET_SENSITIVE_FILE_MODE });
	restrictToCurrentUser(filePath);
}

/** chmodSync for a file written by something else (a db driver, say). */
export function secureExistingFile(filePath: string): void {
	try {
		chmodSync(filePath, SUPERSET_SENSITIVE_FILE_MODE);
	} catch {
		// A missing file is the normal first-run case for some callers.
		return;
	}
	restrictToCurrentUser(filePath);
}

/**
 * mkdir -p for a directory holding secrets. Restricting the directory is what
 * protects files created inside it later, which matters for anything that
 * writes through a driver we do not control.
 */
export function ensureSecureDir(dir: string): void {
	const existed = existsSync(dir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	// Only on creation: re-ACLing every launch would stomp a deliberate grant.
	if (!existed) restrictToCurrentUser(dir);
}
