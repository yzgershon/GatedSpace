import type { CodexPermission } from "./types";

/** The maintainer explicitly opted into Full access for the personal app. */
export function defaultCodexPermission(
	personal = process.env.GATEDSPACE_PERSONAL === "1",
): CodexPermission {
	return personal ? "full-access" : "default";
}
