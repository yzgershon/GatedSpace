// Deny-by-default policy for Chromium permission requests.
//
// Without a handler, Electron falls back to permissive behaviour for the
// app's own session. That is survivable while the only thing loaded is our
// own UI — but this app also renders arbitrary pages in the Browser pane and
// in webviews, and those share the `persist:superset` partition. A page can
// therefore ask for the camera, the microphone, geolocation, or the clipboard
// and be answered without anyone being asked.
//
// So: an allowlist scoped to our own content, and a flat refusal for anything
// loaded from the network. Nothing here prompts — a desktop shell should not
// be brokering a webcam request on behalf of a page the user is only
// previewing. The decision itself lives in ./policy so it can be tested
// without an Electron process.

import { session, type WebContents } from "electron";
import log from "electron-log/main";
import { decidePermission } from "./policy.ts";

export const APP_SESSION_PARTITION = "persist:superset";

/**
 * Installs the policy on the app partition and on the default session.
 *
 * Both matter: windows use the explicit partition, while webviews and any
 * contents created without one land on the default session.
 */
export function installPermissionsPolicy(): void {
	for (const target of [
		session.fromPartition(APP_SESSION_PARTITION),
		session.defaultSession,
	]) {
		target.setPermissionRequestHandler(
			(contents, permission, callback, details) => {
				const url = details?.requestingUrl ?? contents?.getURL();
				const allowed = decidePermission(permission, url);
				if (!allowed) {
					log.info(
						`[permissions] denied "${permission}" for ${url ?? "unknown origin"}`,
					);
				}
				callback(allowed);
			},
		);

		// The synchronous counterpart. Chromium consults this without raising a
		// request, so leaving it unset would let some checks through.
		target.setPermissionCheckHandler(
			(_contents, permission, requestingOrigin) =>
				decidePermission(permission, requestingOrigin),
		);
	}
}

/**
 * Belt-and-braces for contents that arrive with their own session (a webview
 * given a partition of its own, say) and therefore miss the two above.
 */
export function applyPermissionsPolicyTo(contents: WebContents): void {
	contents.session.setPermissionRequestHandler(
		(inner, permission, callback, details) => {
			const url = details?.requestingUrl ?? inner?.getURL();
			callback(decidePermission(permission, url));
		},
	);
}
