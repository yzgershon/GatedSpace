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
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain('"GatedDuet"');
		expect(MOBILE_BRIDGE_SERVICE_WORKER).toContain(
			"Open GatedDuet for the latest session status.",
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
	type NoticeData = {
		noticeId?: string;
		sessionKey?: string;
		provider?: string;
	};
	type WorkerEvent = {
		waitUntil: (promise: Promise<unknown>) => void;
		notification?: { data: NoticeData; close: () => void };
	};
	const listeners = new Map<string, (event: WorkerEvent) => void>();
	const shown: Array<{
		title: string;
		options: {
			body: string;
			renotify: boolean;
			data: NoticeData;
		};
	}> = [];
	let notice: unknown = null;
	let existingClients = false;
	let focused = 0;
	const opened: string[] = [];
	const messages: unknown[] = [];
	const self = {
		location: { href: "https://example.test/sw.js?t=test" },
		addEventListener: (name: string, callback: (event: WorkerEvent) => void) =>
			listeners.set(name, callback),
		clients: {
			matchAll: async () =>
				existingClients
					? [
							{
								postMessage: (message: unknown) => messages.push(message),
								focus: async () => {
									focused++;
								},
							},
						]
					: [],
			openWindow: async (url: string) => {
				opened.push(url);
			},
		},
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
		opened,
		messages,
		get focused() {
			return focused;
		},
		async click(data: NoticeData, withOpenApp = false) {
			existingClients = withOpenApp;
			let pending: Promise<unknown> = Promise.resolve();
			const handler = listeners.get("notificationclick");
			if (!handler) throw new Error("Missing notification click handler");
			handler({
				notification: { data, close: () => {} },
				waitUntil: (promise) => {
					pending = promise;
				},
			});
			await pending;
		},
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
	expect(w.shown[0]?.title).toBe("GatedDuet");
	expect(w.shown[0]?.options.body).toBe(
		"Open GatedDuet for the latest session status.",
	);
});

it("carries Codex metadata from push through a cold-launch URL", async () => {
	const w = workerFixture();
	await w.push({
		id: "codex-done",
		title: "Codex done",
		body: "Finished",
		sessionKey: "pane/codex",
		provider: "codex",
	});
	const data = w.shown[0]?.options.data;
	expect(data?.provider).toBe("codex");
	await w.click(data ?? {});
	expect(w.opened).toEqual(["/#session=pane%2Fcodex&provider=codex"]);
});

it("focuses an existing app and delivers Codex identity without opening another window", async () => {
	const w = workerFixture();
	await w.click({ sessionKey: "pane-codex", provider: "codex" }, true);
	expect(w.messages).toEqual([
		{ type: "open-session", sessionKey: "pane-codex", provider: "codex" },
	]);
	expect(w.focused).toBe(1);
	expect(w.opened).toEqual([]);
});

it("keeps legacy Claude notification URLs readable", async () => {
	const w = workerFixture();
	await w.click({ sessionKey: "old-claude" });
	expect(w.opened).toEqual(["/#session=old-claude"]);
});
