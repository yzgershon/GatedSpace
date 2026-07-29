import { describe, expect, it } from "bun:test";
import { MOBILE_BRIDGE_SERVICE_WORKER } from "./pwa-assets";

/**
 * A service worker is the hardest thing here to debug after the fact: it runs
 * with no page, on a device that is not next to a debugger, and a broken one
 * persists until it is explicitly unregistered.
 */

describe("the service worker", () => {
	it("parses as JavaScript", () => {
		expect(() => new Function(MOBILE_BRIDGE_SERVICE_WORKER)).not.toThrow();
	});

	it("caches nothing at all", () => {
		// The single hardest bug in this feature's history was a cached page that
		// survived two releases. A worker with a fetch handler could bring it
		// back in a form that reloading cannot clear.
		expect(MOBILE_BRIDGE_SERVICE_WORKER).not.toContain(
			'addEventListener("fetch"',
		);
		expect(MOBILE_BRIDGE_SERVICE_WORKER).not.toContain("caches.open");
	});

	it("takes over immediately instead of waiting for every tab to close", () => {
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("skipWaiting()");
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("clients.claim()");
	});

	it("reads the token from its own URL", () => {
		// It cannot reach the page's sessionStorage, and has to work while the
		// page is closed — which is exactly when a push arrives.
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("self.location.href");
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain('searchParams.get("t")');
	});

	it("still shows something when the desktop cannot be reached", () => {
		// A push that resolves without showing a notification is a permission
		// browsers take back.
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain('"GatedSpace"');
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("An agent needs you.");
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain(".catch(");
	});

	it("focuses the open app rather than opening a second copy", () => {
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("clients.matchAll");
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("postMessage");
	});

	it("carries the session through to the click", () => {
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain("sessionKey");
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain(
			'"/#session=" + encodeURIComponent(key)',
		);
	});

	it("collapses repeats onto one notification", () => {
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain('tag: "gatedspace-agent"');
	});
});
