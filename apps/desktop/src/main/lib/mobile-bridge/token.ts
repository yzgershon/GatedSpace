/**
 * The bridge's access token.
 *
 * Tailscale already limits WHO can reach the port; this limits what a device on
 * the tailnet can do without being told the secret. Two locks, because what is
 * behind them is an agent that runs shell commands — the worst case is
 * someone else's code execution, not someone else's screenshot.
 *
 * The token PERSISTS across restarts, and that is a deliberate reversal.
 * It used to be regenerated every time the bridge came up, on the theory that
 * toggling it off and on should be a real revocation. In practice the bridge
 * comes up on every app launch, so the phone's saved token was dead by morning
 * — the installed app opened to "this link has expired", and the only way back
 * in was to fetch the link from the desktop and paste it again. An app you have
 * to re-authorise from another machine before every use is not an app.
 *
 * Revocation still exists, but it is now something you ASK for
 * (`rotateBridgeToken`) rather than a side effect of restarting. The file sits
 * in the same directory as the rest of the app's secrets, with the same
 * owner-only permissions.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	ensureSupersetHomeDirExists,
	SUPERSET_HOME_DIR,
	SUPERSET_SENSITIVE_FILE_MODE,
} from "../app-environment";

const TOKEN_FILE = join(SUPERSET_HOME_DIR, "bridge-token");

/** Rejects a truncated or otherwise mangled file rather than trusting it. */
function isWellFormed(token: string): boolean {
	return /^[A-Za-z0-9_-]{40,}$/.test(token);
}

/**
 * The token to serve with, reused if one was already issued.
 *
 * A read failure falls through to generating a new one: being unable to read
 * the file should cost a re-scan of the QR code, not a bridge that won't start.
 */
export function loadOrCreateBridgeToken(): string {
	try {
		const stored = readFileSync(TOKEN_FILE, "utf8").trim();
		if (isWellFormed(stored)) return stored;
	} catch {
		// No token yet, or unreadable. Fall through and mint one.
	}
	return rotateBridgeToken();
}

/** Issues a new token and forgets the old one. Every device must re-pair. */
export function rotateBridgeToken(): string {
	const token = generateBridgeToken();
	try {
		ensureSupersetHomeDirExists();
		writeFileSync(TOKEN_FILE, token, { mode: SUPERSET_SENSITIVE_FILE_MODE });
	} catch (error) {
		// Serve the in-memory token anyway. It works until the next restart,
		// which beats refusing to start the bridge over a disk problem.
		console.warn("[mobile-bridge] Could not persist the token", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return token;
}

/**
 * 32 bytes of randomness, base64url. Long enough that guessing is not a
 * consideration, short enough to survive being put in a URL and a QR code.
 */
export function generateBridgeToken(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison.
 *
 * `===` on a secret leaks its prefix through timing. That is a marginal attack
 * over a network and a completely unnecessary one to leave available, given the
 * fix is one function call.
 */
export function tokensMatch(expected: string, provided: unknown): boolean {
	if (typeof provided !== "string") return false;
	if (!expected) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(provided);
	// timingSafeEqual throws on a length mismatch, which would itself be a
	// timing signal — compare lengths first and keep the result uniform.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
