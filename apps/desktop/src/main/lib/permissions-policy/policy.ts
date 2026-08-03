// The decision half of the permissions policy, kept free of `electron` imports
// so it can be unit tested — importing electron outside a real Electron
// process fails to resolve.

/**
 * Permissions our own renderer legitimately uses. Everything absent from this
 * set is refused, including `media` (camera/microphone), `geolocation`,
 * `midi`, `hid`, `serial`, `usb`, `idle-detection` and `pointerLock`.
 */
const APP_ALLOWED = new Set([
	"clipboard-read",
	"clipboard-sanitized-write",
	"fullscreen",
	"notifications",
]);

/**
 * True when the request comes from our own UI rather than a page we are
 * merely displaying. Production loads the renderer from disk; dev serves it
 * from localhost.
 */
export function isAppOrigin(url: string | undefined): boolean {
	if (!url) return false;
	if (url.startsWith("file://")) return true;
	try {
		const { protocol, hostname } = new URL(url);
		if (protocol !== "http:" && protocol !== "https:") return false;
		// Exact match: `localhost.evil.com` is not us.
		return hostname === "localhost" || hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

/** Shared decision so the request and check handlers cannot drift apart. */
export function decidePermission(
	permission: string,
	requestingUrl: string | undefined,
): boolean {
	if (!isAppOrigin(requestingUrl)) return false;
	return APP_ALLOWED.has(permission);
}
