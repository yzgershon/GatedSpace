/**
 * Local-only mode (renderer side).
 *
 * Public GatedSpace builds bake NEXT_PUBLIC_LOCAL_ONLY=1 so the app runs with
 * no cloud account: a static local session replaces Better Auth, the
 * host-service starts against a fixed local org, and cloud-backed collections
 * become local-only stores seeded on boot.
 *
 * Escape hatch: setting localStorage "gatedspace:auth-mode" to "cloud"
 * restores the cloud sign-in path on next launch (for users who run their own
 * Superset-compatible backend). Anything else — including unset — means local.
 *
 * isLocalMode() is intentionally safe to call at module load; several modules
 * (auth-client) branch on it when they're first imported.
 */
import { env } from "renderer/env.renderer";

export const AUTH_MODE_STORAGE_KEY = "gatedspace:auth-mode";

/** Fixed identifiers for the local user/org. Stable across launches so
 * host.db rows, settings, and analytics stay attached to the same ids. */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_ORG_ID = "00000000-0000-4000-8000-000000000002";

export function isLocalOnlyBuild(): boolean {
	return env.NEXT_PUBLIC_LOCAL_ONLY === "1";
}

export function isLocalMode(): boolean {
	if (!isLocalOnlyBuild()) return false;
	try {
		return window.localStorage.getItem(AUTH_MODE_STORAGE_KEY) !== "cloud";
	} catch {
		return true;
	}
}

/** Switch between local and cloud auth. Takes effect on reload. */
export function setAuthMode(mode: "local" | "cloud"): void {
	try {
		window.localStorage.setItem(AUTH_MODE_STORAGE_KEY, mode);
	} catch {
		// localStorage unavailable — stay in the baked default
	}
}
