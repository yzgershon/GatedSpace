// Owner-only filesystem permissions that actually work on Windows.
//
// Node's `mode` argument (fs.mkdirSync(d, {mode: 0o700}), the mode option on
// writeFileSync, chmodSync) only toggles the read-only attribute on NTFS. It
// never writes a DACL. So a file created with 0600 on Windows inherits
// whatever the parent directory grants — which is how the secrets under
// ~/.superset ended up readable by a lower-trust local group despite the code
// asking for owner-only.
//
// These helpers set the POSIX mode AND, on Windows, replace the inherited ACL
// with a single entry for the current user.

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";

/**
 * Drops inherited permissions and grants only the current user.
 *
 * Best effort by design: the callers are a terminal-output log and a token
 * file, and hard-failing either would take terminals down over a permissions
 * tweak. A failure here leaves the previous (inherited) ACL in place, which is
 * no worse than before this function existed.
 */
export function restrictToCurrentUser(
	targetPath: string,
	{ recurse = false }: { recurse?: boolean } = {},
): void {
	if (process.platform !== "win32") return;
	const user = process.env.USERNAME ?? os.userInfo().username;
	if (!user) return;

	// (OI)(CI) are inheritance flags and are only valid on a directory. Passing
	// them for a file makes icacls reject the /grant while /inheritance:r has
	// already applied — which leaves an empty DACL that denies everyone,
	// including the owner. Ask for the right shape up front.
	let isDirectory: boolean;
	try {
		isDirectory = fs.statSync(targetPath).isDirectory();
	} catch {
		return;
	}
	const grant = isDirectory ? `${user}:(OI)(CI)F` : `${user}:F`;

	const args = [targetPath, "/inheritance:r", "/grant:r", grant];
	if (recurse && isDirectory) args.push("/T");
	try {
		childProcess.execFileSync("icacls", args, {
			stdio: "ignore",
			windowsHide: true,
			timeout: 10_000,
		});
	} catch {
		// Ignored on purpose — see the doc comment.
	}
}

/**
 * mkdir -p for a directory holding sensitive data. New files created inside
 * inherit the restricted ACL, so the per-file mode below is belt-and-braces
 * rather than the only protection.
 */
export function ensureSecureDir(dir: string): void {
	const existed = fs.existsSync(dir);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	// Only re-ACL on creation: doing it on every daemon start would stomp any
	// deliberate grant, and recursing over a directory of scrollback logs on
	// each boot is wasted work.
	if (!existed) restrictToCurrentUser(dir);
}
