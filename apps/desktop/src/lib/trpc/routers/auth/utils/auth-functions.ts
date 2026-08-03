import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { join } from "node:path";
import {
	SUPERSET_HOME_DIR,
	SUPERSET_SENSITIVE_FILE_MODE,
} from "main/lib/app-environment";
import { restrictToCurrentUser } from "main/lib/secure-file";
import { PROTOCOL_SCHEME } from "shared/constants";
import {
	decryptSecret,
	encryptSecret,
	needsReencryption,
} from "./crypto-storage";

interface StoredAuth {
	token: string;
	expiresAt: string;
}

export const TOKEN_FILE = join(SUPERSET_HOME_DIR, "auth-token.enc");
export const stateStore = new Map<string, number>();

/**
 * Event emitter for auth-related events.
 * Used by tRPC subscription to notify renderer of token changes.
 *
 * Events:
 * - "token-saved": { token, expiresAt } - New token saved (OAuth callback)
 * - "token-cleared": (no data) - Token deleted (sign-out)
 */
export const authEvents = new EventEmitter();

/**
 * Load token from encrypted disk storage.
 */
export async function loadToken(): Promise<{
	token: string | null;
	expiresAt: string | null;
}> {
	try {
		const raw = await fs.readFile(TOKEN_FILE);
		const data = decryptSecret(raw);
		const parsed: StoredAuth = JSON.parse(data);

		// Migrate on read. The legacy scheme derives its key from a registry
		// value any local process can read, so a token left in that format is
		// recoverable by anyone who can read the file — rewriting it here means
		// the weak blob does not survive the first launch after this change.
		if (needsReencryption(raw)) {
			try {
				await writeTokenFile(data);
			} catch {
				// A failed rewrite is not worth failing the sign-in that just
				// succeeded; the next launch tries again.
			}
		}

		return { token: parsed.token, expiresAt: parsed.expiresAt };
	} catch {
		return { token: null, expiresAt: null };
	}
}

/**
 * Writes the token blob with owner-only permissions.
 *
 * The mode matters as much as the encryption: this file used to be written
 * with no mode at all, so it inherited whatever the home directory granted.
 */
async function writeTokenFile(plaintext: string): Promise<void> {
	await fs.writeFile(TOKEN_FILE, encryptSecret(plaintext), {
		mode: SUPERSET_SENSITIVE_FILE_MODE,
	});
	restrictToCurrentUser(TOKEN_FILE);
}

/**
 * Persist token to encrypted disk storage and notify subscribers.
 */
export async function saveToken({
	token,
	expiresAt,
}: {
	token: string;
	expiresAt: string;
}): Promise<void> {
	const storedAuth: StoredAuth = { token, expiresAt };
	await writeTokenFile(JSON.stringify(storedAuth));
	authEvents.emit("token-saved", { token, expiresAt });
}

/**
 * Handle OAuth callback from deep link.
 * Validates CSRF state and saves token.
 */
export async function handleAuthCallback(params: {
	token: string;
	expiresAt: string;
	state: string;
}): Promise<{ success: boolean; error?: string }> {
	if (!stateStore.has(params.state)) {
		return { success: false, error: "Invalid or expired auth session" };
	}
	stateStore.delete(params.state);

	await saveToken({ token: params.token, expiresAt: params.expiresAt });

	return { success: true };
}

/**
 * Parse and validate auth deep link URL.
 */
export function parseAuthDeepLink(
	url: string,
): { token: string; expiresAt: string; state: string } | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null;
		if (parsed.host !== "auth" || parsed.pathname !== "/callback") return null;

		const token = parsed.searchParams.get("token");
		const expiresAt = parsed.searchParams.get("expiresAt");
		const state = parsed.searchParams.get("state");
		if (!token || !expiresAt || !state) return null;
		return { token, expiresAt, state };
	} catch {
		return null;
	}
}
