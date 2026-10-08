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
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain(
			"Open GatedSpace for the latest session status.",
		);
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

function workerFixture() {
	const listeners = new Map<
		string,
		(event: { waitUntil: (promise: Promise<unknown>) => void }) => void
	>();
	const shown: Array<{
		title: string;
		options: {
			body: string;
			renotify: boolean;
			data: { noticeId?: string; sessionKey?: string };
		};
	}> = [];
	let notice: unknown = null;
	const self = {
		location: { href: "https://example.test/sw.js?t=test" },
		addEventListener: (
			name: string,
			callback: (event: {
				waitUntil: (promise: Promise<unknown>) => void;
			}) => void,
		) => listeners.set(name, callback),
		registration: {
			getNotifications: async () =>
				shown.slice(-1).map((n) => ({ data: n.options.data })),
			showNotification: async (
				title: string,
				options: (typeof shown)[number]["options"],
			) => {
				shown.push({ title, options });
			},
		},
	};
	new Function("self", "fetch", MOBILE_BRIDGE_SERVICE_WORKER)(
		self,
		async () => ({ ok: true, json: async () => notice }),
	);
	return {
		shown,
		async push(value: unknown) {
			notice = value;
			let pending: Promise<unknown> = Promise.resolve();
			const handler = listeners.get("push");
			if (!handler) throw new Error("Missing push handler");
			handler({
				waitUntil: (promise) => {
					pending = promise;
				},
			});
			await pending;
		},
	};
}
it("push delivery shows the session title and does not re-alert for duplicate wakes", async () => {
	const w = workerFixture();
	const notice = {
		id: "turn-1",
		title: "Jarvis - Complete",
		body: "Finished its response",
		sessionKey: "pane-jarvis",
	};
	await w.push(notice);
	await w.push(notice);
	expect(w.shown[0]?.title).toBe("Jarvis - Complete");
	expect(w.shown[0]?.options.renotify).toBe(true);
	expect(w.shown[1]?.options.renotify).toBe(false);
	expect(w.shown[1]?.options.data.sessionKey).toBe("pane-jarvis");
	await w.push({ ...notice, id: "turn-2" });
	expect(w.shown[2]?.options.renotify).toBe(true);
});
it("a stale or invalidated wake cannot claim the session finished", async () => {
	const w = workerFixture();
	await w.push(null);
	expect(w.shown[0]?.title).toBe("GatedSpace");
	expect(w.shown[0]?.options.body).toBe(
		"Open GatedSpace for the latest session status.",
	);
});
