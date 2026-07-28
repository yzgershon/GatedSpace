/**
 * The bridge's access token.
 *
 * Tailscale already limits WHO can reach the port; this limits what a device on
 * the tailnet can do without being told the secret. Two locks, because what is
 * behind them is an agent that runs shell commands — the worst case is
 * someone else's code execution, not someone else's screenshot.
 *
 * Regenerated every time the bridge is enabled, so turning it off and on again
 * is a real revocation rather than a pause. Anything that had the old token
 * stops working, which is what a person reaching for the toggle after handing
 * their phone to someone expects it to mean.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

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
