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

/** Bumped whenever the page changes in a way worth confirming on the device. */
export const MOBILE_BRIDGE_PAGE_VERSION = "6";

export const MOBILE_BRIDGE_MANIFEST = JSON.stringify({
	name: "GatedSpace",
	short_name: "GatedSpace",
	description: "Drive your Claude sessions from your phone",
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
			src: "/icon.svg",
			sizes: "any",
			type: "image/svg+xml",
			purpose: "any maskable",
		},
	],
});

/**
 * SVG rather than a set of PNGs: one file covers every density, and the app
 * has no build step to generate raster sizes from.
 *
 * `maskable` in the manifest means Android may crop this to a circle or
 * squircle, so the mark is kept well inside the safe zone — the middle 80% —
 * rather than running to the edges.
 */
export const MOBILE_BRIDGE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0e0e0e"/>
  <path d="M256 132 L352 300 L160 300 Z" fill="#d97757"/>
  <circle cx="256" cy="356" r="26" fill="#d97757"/>
</svg>`;

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

self.addEventListener("push", function (event) {
  event.waitUntil(
    fetch("/api/push/pending", { headers: { "x-bridge-token": TOKEN } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (notice) {
        var title = (notice && notice.title) || "GatedSpace";
        var body = (notice && notice.body) || "An agent needs you.";
        return self.registration.showNotification(title, {
          body: body,
          icon: "/icon.svg",
          badge: "/icon.svg",
          // Same tag for everything: a phone left alone for an hour should
          // show the latest state, not a stack of twenty.
          tag: "gatedspace-agent",
          renotify: true,
          data: { sessionKey: (notice && notice.sessionKey) || null }
        });
      })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var key = event.notification.data && event.notification.data.sessionKey;
  var url = key ? "/#session=" + encodeURIComponent(key) : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        // Focus the app if it is already open rather than opening a second
        // copy, and tell it which session to show.
        for (var i = 0; i < list.length; i++) {
          if ("focus" in list[i]) {
            list[i].postMessage({ type: "open-session", sessionKey: key });
            return list[i].focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
`;
