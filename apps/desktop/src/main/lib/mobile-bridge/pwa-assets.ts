/**
 * What turns the phone page into an installed app.
 *
 * With a manifest declaring `display: standalone`, both Android Chrome and iOS
 * Safari will add it to the home screen and launch it without browser chrome —
 * no address bar, no tabs, its own icon and task-switcher entry. It is the same
 * mechanism the YDdetailers site uses.
 *
 * There IS now a service worker, but only because notifications require one —
 * a push cannot be received without a worker to receive it. It caches NOTHING.
 * That is a deliberate constraint, not an omission: a caching worker here would
 * be a second, harder-to-clear layer of the problem that kept an old page alive
 * on the phone for two releases, and this app is useless offline anyway since
 * it is a window onto a desktop that has to be reachable.
 */

/**
 * The phone page's own version, shown in its header.
 *
 * Deliberately NOT the desktop app's version: the page changes on its own
 * cadence, and a number that tracked the installer would jump by several
 * releases for a one-line CSS fix. Bump the last part for each change worth
 * confirming on the device.
 */
export const MOBILE_BRIDGE_PAGE_VERSION = "1.6.0";

// A new URL replaces the old placeholder in browser/launcher icon caches.
// Served from the same PNG used by the desktop installer, without redrawing it.
export const MOBILE_BRIDGE_ICON_URL = "/icon.png?v=gatedspace-1";

export const MOBILE_BRIDGE_MANIFEST = JSON.stringify({
	name: "GatedDuet",
	short_name: "GatedDuet",
	description: "Continue Claude and Codex sessions from your phone",
	// standalone, not fullscreen: fullscreen hides the status bar too, which
	// costs the clock and battery for no gain on a page that is mostly text.
	display: "standalone",
	orientation: "portrait",
	start_url: "/",
	scope: "/",
	background_color: "#0e0e0e",
	theme_color: "#0e0e0e",
	icons: [
		{
			src: MOBILE_BRIDGE_ICON_URL,
			sizes: "1024x1024",
			type: "image/png",
			purpose: "any",
		},
	],
});

/**
 * The service worker. Its entire job is notifications.
 *
 * It caches nothing and intercepts no requests — there is no `fetch` handler at
 * all, so it cannot serve a stale page even by accident.
 *
 * The bridge token reaches it through its OWN SCRIPT URL. A worker has no
 * access to the page's sessionStorage, and the alternatives (IndexedDB,
 * postMessage handshakes) all have to work while the page is closed, which is
 * exactly when a push arrives. Registering as `/sw.js?t=…` means the token is
 * simply part of `location`, and re-registering with a new token replaces the
 * old worker — so revoking the bridge token revokes this too.
 *
 * The push carries no data. The worker wakes, asks the desktop what happened
 * over the connection it already has, and writes the notification itself. If
 * the desktop cannot be reached — asleep, off the network — it still shows
 * something, because a push that resolves to no notification at all is a
 * permission browsers take back.
 */
export const MOBILE_BRIDGE_SERVICE_WORKER = `
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

var TOKEN = new URL(self.location.href).searchParams.get("t") || "";
var lastNoticeId = null;

self.addEventListener("push", function (event) {
  event.waitUntil(
    fetch("/api/push/pending", { headers: { "x-bridge-token": TOKEN } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (notice) {
        var title = (notice && notice.title) || "GatedDuet";
        var body = (notice && notice.body) || "Open GatedDuet for the latest session status.";
        return self.registration.getNotifications({ tag: "gatedspace-agent" }).then(function (existing) {
        var duplicate = Boolean(notice && notice.id && (lastNoticeId === notice.id || existing.some(function (n) { return n.data && n.data.noticeId === notice.id; })));
        lastNoticeId = notice && notice.id;
        return self.registration.showNotification(title, {
          body: body,
          icon: "${MOBILE_BRIDGE_ICON_URL}",
          badge: "${MOBILE_BRIDGE_ICON_URL}",
          // Same tag for everything: a phone left alone for an hour should
          // show the latest state, not a stack of twenty.
          tag: "gatedspace-agent",
          renotify: !duplicate,
          data: { sessionKey: (notice && notice.sessionKey) || null, provider: notice && notice.provider, noticeId: notice && notice.id }
        });
        });
      })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var key = event.notification.data && event.notification.data.sessionKey;
  var provider = event.notification.data && event.notification.data.provider;
  if (provider !== "claude" && provider !== "codex") provider = null;
  var url = key ? "/#session=" + encodeURIComponent(key) : "/";
  if (key && provider) url += "&provider=" + provider;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        // Focus the app if it is already open rather than opening a second
        // copy, and tell it which session to show.
        for (var i = 0; i < list.length; i++) {
          if ("focus" in list[i]) {
            list[i].postMessage({ type: "open-session", sessionKey: key, provider: provider });
            return list[i].focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
`;
