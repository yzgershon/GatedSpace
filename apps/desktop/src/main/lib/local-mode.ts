/**
 * Local-only mode (main process side).
 *
 * Mirrors renderer/lib/local-mode.ts, minus the localStorage escape hatch
 * (that lives in the renderer). Main-process consumers treat the baked build
 * flag as "local mode is available": when the renderer runs in cloud mode it
 * supplies real auth tokens, which always take precedence over the local
 * fallbacks gated on this flag.
 */
import { env } from "main/env.main";

/** Must match renderer/lib/local-mode.ts. */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_ORG_ID = "00000000-0000-4000-8000-000000000002";

export function isLocalOnlyBuild(): boolean {
	return env.NEXT_PUBLIC_LOCAL_ONLY === "1";
}
