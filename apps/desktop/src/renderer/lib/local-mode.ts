/** Public builds always use local identity. Legacy cloud preferences are ignored. */
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
	return isLocalOnlyBuild();
}

/** Retained for older recovery controls; public mode no longer reads this preference. */
export function setAuthMode(mode: "local" | "cloud"): void {
	try {
		window.localStorage.setItem(AUTH_MODE_STORAGE_KEY, mode);
	} catch {
		// Storage may be unavailable; public builds remain local.
	}
}
