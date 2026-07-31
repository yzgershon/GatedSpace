/**
 * Applying the stored auth token BEFORE React renders.
 *
 * This exists to delete a ~4.7s wait (measured) from cold launch. The shape of
 * the problem:
 *
 * Better Auth's session store fires its first request as soon as something
 * subscribes to `useSession`, which happens during the first render. The stored
 * token, meanwhile, arrived from an async IPC call in an effect — AFTER that
 * first request had already gone out unauthenticated. So the app had to make a
 * SECOND, authenticated request and wait for it, and could not mount until it
 * landed: mounting earlier would let the authenticated layout see the
 * unauthenticated result, decide nobody was signed in, and redirect a signed-in
 * user to the login screen.
 *
 * Applying the token first collapses two network round-trips into one and
 * removes the race that forced the wait. The cost is one local IPC call before
 * first paint, which is microseconds against a network request.
 *
 * The token is only applied when it is present and unexpired — an expired token
 * must still fall through to sign-in.
 */
import { setAuthToken } from "renderer/lib/auth-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";

/**
 * What happened during the pre-render attempt.
 *
 * `unavailable` is the one that matters: it means the attempt could not be made
 * (IPC not answering, or too slow), so the token's state is unknown and the
 * provider must fall back to hydrating the old, awaited way. Getting that wrong
 * would bounce a signed-in user to the login screen, so an unknown answer is
 * never treated as "no token".
 */
export type StoredTokenOutcome =
	| "applied"
	| "no-token"
	| "expired"
	| "unavailable";

let outcome: StoredTokenOutcome = "unavailable";

export function getStoredTokenOutcome(): StoredTokenOutcome {
	return outcome;
}

/**
 * How long to wait for the token before rendering anyway.
 *
 * A ceiling, not an expectation: this is local IPC and normally resolves in
 * single-digit milliseconds. It exists because a renderer that never paints is
 * far worse than one that falls back to the slower auth path, and the whole
 * point of this module is to sit in front of first paint.
 */
const STORED_TOKEN_TIMEOUT_MS = 1_500;

export async function applyStoredAuthTokenBeforeRender(): Promise<StoredTokenOutcome> {
	try {
		const timeout = new Promise<"timeout">((resolve) => {
			setTimeout(() => resolve("timeout"), STORED_TOKEN_TIMEOUT_MS);
		});
		const stored = await Promise.race([
			electronTrpcClient.auth.getStoredToken.query(),
			timeout,
		]);

		if (stored === "timeout") {
			outcome = "unavailable";
			return outcome;
		}
		if (!stored?.token || !stored?.expiresAt) {
			outcome = "no-token";
			return outcome;
		}
		if (new Date(stored.expiresAt) < new Date()) {
			outcome = "expired";
			return outcome;
		}

		setAuthToken(stored.token);
		outcome = "applied";
		return outcome;
	} catch {
		// Unknown, not absent. The provider hydrates the slow way from here.
		outcome = "unavailable";
		return outcome;
	}
}
