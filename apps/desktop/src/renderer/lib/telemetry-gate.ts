// Whether to start analytics at all.
//
// The old gate was `if (!key) return`, which is not the same question. The
// checked-in examples and the local .env set the key to a placeholder like
// `phc_local_dev_disabled` — a non-empty string, so the gate passed and
// posthog-js opened connections to PostHog's US cloud on every launch.
// Ingestion rejects the key, but the request and the source IP still leave the
// machine, and the payloads include worktree paths and branch names.
//
// Two conditions now, both of which must hold:
//   1. the key looks like a real key rather than a stand-in
//   2. this is not a local-only build
//
// (2) matters most: CI sets NEXT_PUBLIC_LOCAL_ONLY for the public release, and
// a build whose whole promise is "no account, nothing leaves your machine"
// should not be talking to an analytics vendor.

const PLACEHOLDER_PATTERN =
	/disabled|placeholder|fake|dummy|example|changeme|your[-_]?(api[-_]?)?key|xxx+/i;

/** False for an absent, blank, or obviously stand-in key. */
export function isUsableTelemetryKey(key: string | undefined): boolean {
	const trimmed = key?.trim();
	if (!trimmed) return false;
	return !PLACEHOLDER_PATTERN.test(trimmed);
}

/** Truthy per the usual env convention: "1", "true", "yes". */
export function isLocalOnly(flag: string | undefined): boolean {
	const trimmed = flag?.trim().toLowerCase();
	if (!trimmed) return false;
	return trimmed === "1" || trimmed === "true" || trimmed === "yes";
}

export function shouldEnableTelemetry({
	key,
	localOnly,
}: {
	key: string | undefined;
	localOnly: string | undefined;
}): boolean {
	if (isLocalOnly(localOnly)) return false;
	return isUsableTelemetryKey(key);
}
