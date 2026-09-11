import http from "node:http";
import type { BrowserWindow } from "electron";
import { env } from "shared/env.shared";

/** Window IDs defined in the router configuration */
type WindowId = "main" | "about";

/**
 * Ask the dev server for the document, and report whether it is actually
 * serving it. `node:http` rather than electron's `net` so this file stays
 * importable from a plain-Node entrypoint (AGENTS.md rule: never import
 * electron at module scope in anything a child entrypoint can reach).
 *
 * A 4xx counts as NOT ready. That is the whole point: Vite answers 431 for a
 * while during startup, and a 431 is a perfectly successful HTTP exchange, so
 * `loadURL` "succeeds", `did-finish-load` fires, and the window sits there
 * black with no error anywhere.
 */
function isDevServerServing(url: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const request = http.get(url, { timeout: timeoutMs }, (response) => {
			const status = response.statusCode ?? 0;
			response.resume(); // drain, or the socket is never released
			resolve(status >= 200 && status < 400);
		});
		request.on("error", () => resolve(false));
		request.on("timeout", () => {
			request.destroy();
			resolve(false);
		});
	});
}

const DEV_SERVER_POLL_MS = 250;
const DEV_SERVER_WAIT_MS = 120_000;

/**
 * Where the dev instance opens. `GATEDSPACE_DEV_ROUTE=/v2-workspace/<id>` lands
 * straight on a workspace.
 *
 * The dev instance exists to look at UI. Making it start at the dashboard means
 * navigating to the screen you are iterating on every single launch — and when
 * the dashboard cannot list workspaces (cloud mode never finishes its collection
 * sync on this machine), there is no way to reach the pane UI at all. This is
 * the way in that does not depend on any of that resolving.
 *
 * Dev only. Production always loads `#/`.
 */
function devHashRoute(): string {
	const route = process.env.GATEDSPACE_DEV_ROUTE?.trim();
	if (!route) return "/";
	return route.startsWith("/") ? route : `/${route}`;
}

function devUrl(): string {
	return `http://localhost:${env.DESKTOP_VITE_PORT}/#${devHashRoute()}`;
}

/**
 * Wait for the Vite dev server before pointing the window at it, then keep
 * retrying if the load still fails.
 *
 * Electron reaches `createWindow` in about 1.5s with a warm cache, while a cold
 * Vite takes tens of seconds to serve the renderer. Loading immediately is a
 * race, and LOSING it was permanent: `did-fail-load` only logged, so a window
 * that lost the race stayed black forever with no retry and no visible error.
 * That is the "it opens and it's just a black window" report, and it is timing
 * dependent, which is why it reproduced on one machine's load and not another's.
 */
async function clearDevServerCookies(
	browserWindow: BrowserWindow,
	url: string,
): Promise<void> {
	/*
	 * Vite answers 431 Request Header Fields Too Large, and a 431 is a perfectly
	 * successful HTTP exchange — `loadURL` resolves, `did-finish-load` fires,
	 * and the window sits there BLACK with nothing in the log but a yellow Vite
	 * line. Navigating to Settings hit it every time.
	 *
	 * The oversized header is `Cookie`. Cookies are scoped by HOST and IGNORE
	 * the port, so every service this app talks to on `localhost` — host-service,
	 * Electric, anything else the machine runs there — writes into one jar that
	 * is then sent to the dev server on every module request.
	 *
	 * Two earlier attempts missed. `--max-http-header-size=65536` only raises the
	 * point at which the jar overflows. Moving the dev server to `127.0.0.1`
	 * would have been a different host with its own jar, but the bind did not
	 * take — Vite still came up on `::1` only and the window got
	 * ERR_CONNECTION_REFUSED, which is a blank screen by another route.
	 *
	 * So: empty the jar for this origin before loading. Dev-only, and the dev
	 * instance has its own `userData`, so nothing the installed app relies on is
	 * touched.
	 */
	try {
		const { cookies } = browserWindow.webContents.session;
		const existing = await cookies.get({ url });
		await Promise.all(
			existing.map((cookie) =>
				cookies.remove(url, cookie.name).catch(() => {}),
			),
		);
		if (existing.length > 0) {
			console.log(
				`[window-loader] cleared ${existing.length} cookie(s) for the dev origin`,
			);
		}
	} catch (error) {
		// Never block the load on this — a failure here is at worst the 431 we
		// were already living with.
		console.error("[window-loader] could not clear dev cookies:", error);
	}
}

async function loadDevUrlWhenReady(
	browserWindow: BrowserWindow,
	url: string,
): Promise<void> {
	const deadline = Date.now() + DEV_SERVER_WAIT_MS;
	let announced = false;

	if (!browserWindow.isDestroyed()) {
		await clearDevServerCookies(browserWindow, url);
	}

	while (Date.now() < deadline) {
		if (browserWindow.isDestroyed()) return;
		if (await isDevServerServing(url, 5_000)) {
			if (announced) console.log("[window-loader] dev server ready, loading");
			if (browserWindow.isDestroyed()) return;
			await browserWindow.loadURL(url).catch((error) => {
				console.error("[window-loader] loadURL threw:", error);
			});
			return;
		}
		if (!announced) {
			announced = true;
			console.log("[window-loader] waiting for the dev server at", url);
		}
		await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_POLL_MS));
	}

	console.error(
		`[window-loader] dev server never became ready within ${
			DEV_SERVER_WAIT_MS / 1000
		}s — loading anyway so the failure is visible rather than blank.`,
	);
	if (!browserWindow.isDestroyed()) {
		await browserWindow.loadURL(url).catch(() => {});
	}
}

const PAINT_CHECK_DELAY_MS = 25_000;
const PAINT_RELOAD_LIMIT = 3;

/**
 * Reload the dev window if the renderer never actually painted.
 *
 * `did-finish-load` fires for the DOCUMENT, not for the app. Vite can serve
 * the HTML and then answer the entry-module request badly while it is still
 * optimising deps — one 431 is enough — and the result is a window that
 * reports a successful load, logs nothing at all, and shows the background
 * colour forever. Nothing retries, because as far as Electron is concerned the
 * load worked.
 *
 * It is a RACE, so it is intermittent: the same launcher, the same shortcut and
 * the same code render one time and go black the next. That intermittency is
 * what made it look like the launcher, the parent shell, or the window style
 * mattered when none of them did.
 *
 * So: give it a while, then ask the page whether anything is on it. Scripts,
 * links and styles do not count — those are in the HTML whether the app booted
 * or not. If the body has no real content, reload. Bounded, because a reload
 * loop against a genuinely broken renderer is worse than one black window.
 */
function watchForBlankRender(browserWindow: BrowserWindow): void {
	let reloads = 0;

	const check = () => {
		setTimeout(() => {
			if (browserWindow.isDestroyed()) return;
			browserWindow.webContents
				.executeJavaScript(
					`Array.from(document.body.children).filter((el) => !["SCRIPT","LINK","STYLE"].includes(el.tagName)).length`,
					true,
				)
				.then((count: unknown) => {
					if (typeof count === "number" && count > 0) return;
					if (reloads >= PAINT_RELOAD_LIMIT) {
						console.error(
							`[window-loader] renderer still blank after ${PAINT_RELOAD_LIMIT} reloads — giving up so this does not loop.`,
						);
						return;
					}
					reloads++;
					console.error(
						`[window-loader] renderer loaded but painted NOTHING — reloading (${reloads}/${PAINT_RELOAD_LIMIT})`,
					);
					if (!browserWindow.isDestroyed()) browserWindow.webContents.reload();
					check();
				})
				.catch(() => {
					// Page torn down mid-check, or devtools detached the context.
				});
		}, PAINT_CHECK_DELAY_MS);
	};

	check();
}

/**
 * Load an Electron window with the appropriate URL for TanStack Router.
 * Uses hash-based routing for compatibility with Electron's file:// protocol.
 *
 * - Development: loads from Vite dev server at http://localhost:PORT/#/
 * - Production: loads from built HTML file with hash routing (#/)
 */
export function registerRoute(props: {
	id: WindowId;
	browserWindow: BrowserWindow;
	htmlFile: string;
	query?: Record<string, string>;
}): void {
	const isDev = env.NODE_ENV === "development";

	if (isDev) {
		// Development: load from Vite dev server with hash routing
		const url = devUrl();
		console.log("[window-loader] Loading development URL:", url);
		void loadDevUrlWhenReady(props.browserWindow, url);
		watchForBlankRender(props.browserWindow);
	} else {
		// Production: load from file with hash routing
		// TanStack Router uses hash-based routing, so we always start at #/
		console.log("[window-loader] Loading file:", props.htmlFile);
		props.browserWindow.loadFile(props.htmlFile, { hash: "/" });
	}

	// Log successful loads
	props.browserWindow.webContents.on("did-finish-load", () => {
		console.log(
			"[window-loader] Successfully loaded:",
			props.browserWindow.webContents.getURL(),
		);
	});

	// Log and handle load failures
	props.browserWindow.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			console.error("[window-loader] Failed to load URL:", validatedURL);
			console.error("[window-loader] Error code:", errorCode);
			console.error("[window-loader] Error description:", errorDescription);

			/*
			 * In dev, RECOVER rather than just narrate.
			 *
			 * -3 is ERR_ABORTED, which is what a navigation superseded by another
			 * one reports; retrying that would fight the navigation that replaced
			 * it. Everything else in dev is the dev server not being up yet, and
			 * the old behaviour — log and stop — is what left the window black
			 * permanently instead of for a few seconds.
			 */
			if (!isDev || !isMainFrame || errorCode === -3) return;
			console.log("[window-loader] retrying dev load...");
			void loadDevUrlWhenReady(props.browserWindow, devUrl());
		},
	);
}
