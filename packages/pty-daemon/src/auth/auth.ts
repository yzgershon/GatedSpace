// Connection auth for the daemon socket.
//
// The daemon spawns processes and writes into live PTYs, so reaching its
// socket is equivalent to code execution as the user. The socket used to be
// the whole boundary: on POSIX that is defensible (the .sock file is chmod
// 0600), but on Windows it is not. Node's net.Server.listen() creates a named
// pipe with NULL security attributes, which yields a descriptor that admits
// every process in the user's session — including anything a package's
// postinstall script decides to run. Pipe names are also enumerable by any
// unprivileged process via \\.\pipe\, so there is nothing to guess.
//
// So: a shared secret in a file next to the socket. Both the daemon and its
// clients call ensureDaemonToken() on the same path; whichever runs first
// creates it and the other reads it back, which means no spawn ordering has
// to be guaranteed. Reading the file requires filesystem access the attacker
// we care about does not have.

import { randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { restrictToCurrentUser } from "../secure-fs/index.ts";

const TOKEN_BYTES = 32;
/** 32 bytes hex. Anchored so a truncated or padded file is rejected. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function defaultHomeDir(): string {
	return process.env.SUPERSET_HOME_DIR ?? path.join(os.homedir(), ".superset");
}

/**
 * Token file for a given socket, derived from the socket path so that both
 * ends agree without the spawner threading an extra argument through — which
 * matters for handoff successors, who are spawned by the predecessor daemon
 * and only receive --socket.
 *
 * `\\.\pipe\superset-ptyd-ab12cd34ef56` -> `<home>/superset-ptyd-ab12cd34ef56.token`
 * `/tmp/superset-ptyd-ab12cd34ef56.sock` -> the same.
 */
export function ptyDaemonTokenPath(
	socketPath: string,
	homeDir?: string,
): string {
	const home = homeDir ?? defaultHomeDir();
	const base = socketPath.split(/[\\/]/).pop() ?? "superset-ptyd";
	const name = base.endsWith(".sock") ? base.slice(0, -".sock".length) : base;
	return path.join(home, `${name}.token`);
}

/** Reads a token, or null when the file is missing or malformed. */
export function readDaemonToken(tokenPath: string): string | null {
	try {
		const raw = fs.readFileSync(tokenPath, "utf8").trim();
		return TOKEN_PATTERN.test(raw) ? raw : null;
	} catch {
		return null;
	}
}

/**
 * Reads the token, creating one if absent. Safe to call concurrently from
 * both ends: the write is exclusive, and a loser of that race reads back the
 * winner's value.
 */
export function ensureDaemonToken(tokenPath: string): string {
	const existing = readDaemonToken(tokenPath);
	if (existing !== null) return existing;

	const token = randomBytes(TOKEN_BYTES).toString("hex");
	fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
	try {
		// `wx` so a concurrent creator wins cleanly instead of us clobbering a
		// token the daemon is already enforcing.
		fs.writeFileSync(tokenPath, token, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			const raced = readDaemonToken(tokenPath);
			if (raced !== null) return raced;
			// Present but unreadable/corrupt — replace it rather than leaving
			// the daemon unable to authenticate anyone.
			fs.writeFileSync(tokenPath, token, { encoding: "utf8", mode: 0o600 });
		} else {
			throw err;
		}
	}
	restrictToCurrentUser(tokenPath);
	return token;
}

/** Constant-time compare. `provided` is off the wire, so it is unvalidated. */
export function verifyDaemonToken(
	expected: string,
	provided: unknown,
): boolean {
	if (typeof provided !== "string") return false;
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(provided, "utf8");
	// timingSafeEqual throws on a length mismatch; the length of a hex token
	// is not a secret, so comparing it up front is fine.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
