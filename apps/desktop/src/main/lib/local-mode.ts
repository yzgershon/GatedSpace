/** Public builds always use local identity, including when older cloud tokens exist. */
import { env } from "main/env.main";

/** Must match renderer/lib/local-mode.ts. */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_ORG_ID = "00000000-0000-4000-8000-000000000002";

export function isLocalOnlyBuild(): boolean {
	return env.NEXT_PUBLIC_LOCAL_ONLY === "1";
}
