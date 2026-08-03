// Which push endpoints the desktop will POST to.
//
// The subscribe route only checked `startsWith("https://")`, and push.ts then
// fetches that URL on every agent event, carrying a VAPID JWT signed for its
// audience. So a caller holding the bridge token could point the desktop at
// any HTTPS host and get a persistent beacon — one request per agent event,
// revealing the desktop's source IP and its activity pattern — or aim it at an
// internal host that is only reachable from this machine.
//
// The real push services are a short, known list. Everything else is refused.
//
// Kept free of express imports so it can be unit tested.

/**
 * Suffixes matched against the hostname. A leading dot means "this domain or
 * any subdomain", so `notify.windows.com` matches but `evilnotify.windows.com`
 * does not.
 */
const ALLOWED_HOST_SUFFIXES = [
	// Chrome / Chromium, and Edge on Android
	".googleapis.com",
	// Firefox
	".push.services.mozilla.com",
	// Edge / Windows
	".notify.windows.com",
	".push.apple.com",
];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
	if (typeof endpoint !== "string") return false;

	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}

	// https only: a push endpoint is a third-party URL, and the VAPID token
	// travels with it.
	if (url.protocol !== "https:") return false;
	// Credentials in the URL would be sent on every event.
	if (url.username || url.password) return false;

	const host = url.hostname.toLowerCase();
	return ALLOWED_HOST_SUFFIXES.some(
		(suffix) => host === suffix.slice(1) || host.endsWith(suffix),
	);
}
