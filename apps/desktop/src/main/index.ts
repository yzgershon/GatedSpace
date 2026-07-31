import path from "node:path";
import { pathToFileURL } from "node:url";
import { settings } from "@superset/local-db";
import {
	app,
	BrowserWindow,
	dialog,
	Notification,
	net,
	protocol,
	session,
} from "electron";
import log from "electron-log/main";
import { makeAppSetup } from "lib/electron-app/factories/app/setup";
import {
	handleAuthCallback,
	loadToken,
	parseAuthDeepLink,
} from "lib/trpc/routers/auth/utils/auth-functions";
import { resolveSpawnConfig } from "lib/trpc/routers/host-service-coordinator";
import { applyShellEnvToProcess } from "lib/trpc/routers/workspaces/utils/shell-env";
import { env as mainEnv } from "main/env.main";
import {
	DEFAULT_CONFIRM_ON_QUIT,
	PLATFORM,
	PROTOCOL_SCHEME,
} from "shared/constants";
import { setupAgentHooks } from "./lib/agent-setup";
import { initAppState } from "./lib/app-state";
import { requestAppleEventsAccess } from "./lib/apple-events-permission";
import { isUpdateReadyToInstall, setupAutoUpdater } from "./lib/auto-updater";
import { installBundledCliShim } from "./lib/bundled-cli";
import { flushCostStore } from "./lib/claude-session/cost-store";
import { startUsageRefreshTicker } from "./lib/claude-session/usage-refresh";
import { crashSentinel } from "./lib/crash-sentinel";
import { resolveDevWorkspaceName } from "./lib/dev-workspace-name";
import { setWorkspaceDockIcon } from "./lib/dock-icon";
import { loadWebviewBrowserExtension } from "./lib/extensions";
import { getHostServiceCoordinator } from "./lib/host-service-coordinator";
import { listKnownOrganizationIds } from "./lib/host-service-manifest";
import { localDb } from "./lib/local-db";
import { isLocalOnlyBuild, LOCAL_ORG_ID } from "./lib/local-mode";
import { requestLocalNetworkAccess } from "./lib/local-network-permission";
import { mobileBridge } from "./lib/mobile-bridge/server";
import {
	initTanstackDbPersistence,
	shutdownTanstackDbPersistence,
} from "./lib/persistence/persistence";
import { ensureProjectIconsDir, getProjectIconPath } from "./lib/project-icons";
import { initSentry } from "./lib/sentry";
import { markStartup, timeStartupPhase } from "./lib/startup-timing";
import {
	prewarmTerminalRuntime,
	reconcileDaemonSessions,
} from "./lib/terminal";
import {
	disposeTerminalHostClient,
	getTerminalHostClient,
} from "./lib/terminal-host/client";
import { disposeTray, initTray } from "./lib/tray";
import { startNetworkLogger, stopNetworkLogger } from "./network-logger";
import { MainWindow } from "./windows/main";

// First statement in the module body, so it runs once every import above has
// been evaluated. That number IS the main bundle's load cost, and it is spent
// before Electron will even fire `ready` — so it is charged directly to launch.
// Worth isolating: the gap between this and "electron ready" is Electron's own
// boot, which we cannot shrink, while this half is our own dependency graph.
markStartup("main bundle evaluated");

console.log("[main] Local database ready:", !!localDb);
const IS_DEV = process.env.NODE_ENV === "development";

void applyShellEnvToProcess().catch((error) => {
	console.error("[main] Failed to apply shell environment:", error);
});

// Dev mode: label the app with the workspace name so multiple worktrees are distinguishable
if (IS_DEV) {
	const workspaceName = resolveDevWorkspaceName();
	if (workspaceName) {
		app.setName(`Superset (${workspaceName})`);
	}
}

// Dev mode: register with execPath + app script so macOS launches Electron with our entry point
if (process.defaultApp) {
	if (process.argv.length >= 2) {
		app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
			path.resolve(process.argv[1]),
		]);
	}
} else {
	app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

async function processDeepLink(url: string): Promise<void> {
	console.log("[main] Processing deep link:", url);

	const authParams = parseAuthDeepLink(url);
	if (authParams) {
		const result = await handleAuthCallback(authParams);
		if (result.success) {
			focusMainWindow();
		} else {
			console.error("[main] Auth deep link failed:", result.error);
		}
		return;
	}

	// Non-auth deep links: extract path and navigate in renderer
	// e.g. superset://tasks/my-slug -> /tasks/my-slug
	const path = `/${url.split("://")[1]}`;
	focusMainWindow();

	const windows = BrowserWindow.getAllWindows();
	if (windows.length > 0) {
		windows[0].webContents.send("deep-link-navigate", path);
	}
}

function findDeepLinkInArgv(argv: string[]): string | undefined {
	return argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
}

export function focusMainWindow(): void {
	const windows = BrowserWindow.getAllWindows();
	if (windows.length > 0) {
		const mainWindow = windows[0];
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus();
	} else {
		// Triggers window creation via makeAppSetup's activate handler
		app.emit("activate");
	}
}

function registerWithMacOSNotificationCenter() {
	if (!PLATFORM.IS_MAC || !Notification.isSupported()) return;

	const registrationNotification = new Notification({
		title: app.name,
		body: " ",
		silent: true,
	});

	let handled = false;
	const cleanup = () => {
		if (handled) return;
		handled = true;
		registrationNotification.close();
	};

	registrationNotification.on("show", () => {
		cleanup();
		console.log("[notifications] Registered with Notification Center");
	});

	// Fallback timeout in case macOS doesn't fire events
	setTimeout(cleanup, 1000);

	registrationNotification.show();
}

// macOS open-url can fire before the window exists (cold-start via protocol link).
// Queue the URL and process it after initialization.
let pendingDeepLinkUrl: string | null = null;
let appReady = false;

app.on("open-url", async (event, url) => {
	event.preventDefault();
	if (appReady) {
		await processDeepLink(url);
	} else {
		pendingDeepLinkUrl = url;
	}
});

let isQuitting = false;
let skipQuitConfirmation = false;
let forceFullCleanup = false;

export function setSkipQuitConfirmation(): void {
	skipQuitConfirmation = true;
}

export function quitApp(): void {
	setSkipQuitConfirmation();
	app.quit();
}

/** Quit + also stop background services. Tray "Quit Completely". */
export function quitAppCompletely(): void {
	forceFullCleanup = true;
	setSkipQuitConfirmation();
	app.quit();
}

/** Bypasses before-quit. Host-service children self-exit via the parent watchdog. */
export function exitImmediately(): void {
	// Bypassing before-quit also bypasses the stamp there, so it has to happen
	// here: an unstamped deliberate exit is indistinguishable from a crash.
	crashSentinel.expectExit("quit");
	// Cost accrual is debounced, so the last turn or two is still in memory.
	flushCostStore();
	// A listening socket must not outlive the window that authorised it.
	mobileBridge.stopSync();
	app.exit(0);
}

function getConfirmOnQuitSetting(): boolean {
	try {
		const row = localDb.select().from(settings).get();
		return row?.confirmOnQuit ?? DEFAULT_CONFIRM_ON_QUIT;
	} catch {
		return DEFAULT_CONFIRM_ON_QUIT;
	}
}

app.on("before-quit", async (event) => {
	if (isQuitting) return;

	// Stamp the exit as expected BEFORE anything can prevent it. If the user
	// cancels the confirmation below the stamp is cleared again; leaving it set
	// would only mean one crash goes unreported, whereas not stamping at all
	// means every ordinary quit is counted as a crash.
	crashSentinel.expectExit("quit");
	flushCostStore();
	mobileBridge.stopSync();

	const isDev = process.env.NODE_ENV === "development";
	if (!skipQuitConfirmation && !isDev && getConfirmOnQuitSetting()) {
		event.preventDefault();

		try {
			const { response } = await dialog.showMessageBox({
				type: "question",
				buttons: ["Quit", "Cancel"],
				defaultId: 0,
				cancelId: 1,
				title: "Quit Superset",
				message: "Are you sure you want to quit?",
			});

			if (response === 1) {
				// Quit cancelled — this run is still going, so it must be able to
				// report a crash later.
				crashSentinel.clearExpectedExit();
				return;
			}
		} catch (error) {
			console.error("[main] Quit confirmation dialog failed:", error);
		}
	}

	isQuitting = true;
	try {
		getHostServiceCoordinator().stopAll();
		if (isDev || forceFullCleanup) {
			await teardownTerminalHost();
		} else if (isUpdateReadyToInstall()) {
			disposeTerminalHostClient();
		}
		shutdownTanstackDbPersistence();
		disposeTray();
	} catch (error) {
		console.error("[main] Cleanup during quit failed:", error);
	} finally {
		await stopNetworkLogger();
	}
	app.exit(0);
});

/**
 * Fully stop the v1 terminal-host process. Do not call this for update
 * installs: terminal-host owns the PTY subprocesses, so shutdown is
 * destructive and prevents reattach on next launch.
 */
async function teardownTerminalHost(): Promise<void> {
	try {
		await getTerminalHostClient().shutdownIfRunning({ killSessions: true });
	} catch (err) {
		console.warn("[main] terminal-host dev shutdown failed:", err);
	}
	disposeTerminalHostClient();
}

process.on("uncaughtException", (error) => {
	if (isQuitting) return;
	console.error("[main] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
	if (isQuitting) return;
	console.error("[main] Unhandled rejection:", reason);
});

// Without these handlers, Electron may not quit when electron-vite sends SIGTERM
if (process.env.NODE_ENV === "development") {
	let signalHandled = false;
	const handleTerminationSignal = (signal: string) => {
		if (signalHandled) return;
		signalHandled = true;
		console.log(`[main] Received ${signal}, quitting...`);
		getHostServiceCoordinator().stopAll();
		void Promise.allSettled([
			teardownTerminalHost(),
			stopNetworkLogger(),
		]).finally(() => app.exit(0));
	};

	process.on("SIGTERM", () => handleTerminationSignal("SIGTERM"));
	process.on("SIGINT", () => handleTerminationSignal("SIGINT"));

	// Fallback: electron-vite may exit without signaling the child Electron process
	const parentPid = process.ppid;
	const isParentAlive = (): boolean => {
		try {
			process.kill(parentPid, 0);
			return true;
		} catch {
			return false;
		}
	};

	const parentCheckInterval = setInterval(() => {
		if (!isParentAlive()) {
			console.log("[main] Parent process exited, quitting...");
			clearInterval(parentCheckInterval);
			handleTerminationSignal("parent-exit");
		}
	}, 1000);
	parentCheckInterval.unref();
}

protocol.registerSchemesAsPrivileged([
	{
		scheme: "superset-icon",
		privileges: {
			standard: true,
			secure: true,
			bypassCSP: true,
			supportFetchAPI: true,
		},
	},
	{
		scheme: "superset-font",
		privileges: {
			standard: true,
			secure: true,
			bypassCSP: true,
			supportFetchAPI: true,
		},
	},
]);

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.exit(0);
} else {
	// Windows/Linux: protocol URL arrives as argv on the second instance
	app.on("second-instance", async (_event, argv) => {
		focusMainWindow();
		const url = findDeepLinkInArgv(argv);
		if (url) {
			await processDeepLink(url);
		}
	});

	(async () => {
		await app.whenReady();
		markStartup("electron ready");

		/**
		 * Start the host service NOW, not when the renderer gets round to asking.
		 *
		 * This is the slowest step in a launch by a wide margin — measured at
		 * ~9s from window creation on a real cold start, because spawning it is
		 * node boot plus migrations plus a health check. Every workspace the app
		 * shows waits on it, so it has to be the first thing moving, not the last.
		 *
		 * It used to be last: the only caller was a React provider that cannot run
		 * until the window exists, the tree mounts, AND (in cloud mode) two network
		 * round-trips of auth hydration finish. The slowest step was queued behind
		 * the most variable one.
		 *
		 * The org id comes from disk rather than from a session, which is what lets
		 * this run at all in cloud mode. A first-ever launch knows nothing and
		 * prewarms nothing — correct, and the renderer still asks once it has a
		 * session.
		 *
		 * Not awaited: the window must not wait on this either. `start` is
		 * idempotent and deduplicates concurrent calls, so the renderer asking
		 * again on mount joins this attempt instead of racing it — and gets the
		 * live connection straight back if it has already finished.
		 */
		void (async () => {
			const prewarmOrgIds = new Set(listKnownOrganizationIds());
			// A local-only build knows its org without having run before, so a fresh
			// install still gets the head start.
			if (isLocalOnlyBuild()) prewarmOrgIds.add(LOCAL_ORG_ID);
			// Said out loud, because the first version of this returned here silently
			// and the only evidence was an ABSENT log line. A whole build cycle went
			// into working out that "no output" meant "found nothing" rather than
			// "never ran". A no-op on the path being measured has to announce itself.
			markStartup(`host service prewarm: ${prewarmOrgIds.size} org(s) known`);
			if (prewarmOrgIds.size === 0) return;

			const config = await resolveSpawnConfig().catch((error: unknown) => {
				// Cloud build with no stored token yet: nothing to prewarm with. The
				// renderer handles it after sign-in.
				log.info(`[startup] host service prewarm skipped: ${String(error)}`);
				return null;
			});
			if (!config) return;

			await Promise.all(
				[...prewarmOrgIds].map(async (organizationId) => {
					try {
						await getHostServiceCoordinator().start(organizationId, config);
						markStartup(`host service ready (${organizationId.slice(0, 8)})`);
					} catch (error) {
						// Costs nothing to lose: the renderer still asks on mount, and
						// that path already surfaces the failure to the user.
						log.warn(`[startup] host service prewarm failed: ${String(error)}`);
					}
				}),
			);
		})();
		// Started here rather than from the renderer, and deliberately not
		// awaited: the phone must be able to reach this machine without anyone
		// opening a settings page on it, and a slow Tailscale handshake should
		// not hold up the window appearing.
		void mobileBridge.restore();
		registerWithMacOSNotificationCenter();
		requestAppleEventsAccess();
		requestLocalNetworkAccess();

		// Must register on both default session and the app's custom partition
		const iconProtocolHandler = (request: Request) => {
			const url = new URL(request.url);
			const projectId = url.pathname.replace(/^\//, "");
			const iconPath = getProjectIconPath(projectId);
			if (!iconPath) {
				return new Response("Not found", { status: 404 });
			}
			return net.fetch(pathToFileURL(iconPath).toString());
		};
		protocol.handle("superset-icon", iconProtocolHandler);
		session
			.fromPartition("persist:superset")
			.protocol.handle("superset-icon", iconProtocolHandler);

		// Serve system fonts (e.g. SF Mono on macOS) via custom protocol
		// so the renderer can use @font-face with font-src 'self' CSP
		if (process.platform === "darwin") {
			const SYSTEM_FONT_DIRS = [
				"/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts",
				"/System/Library/Fonts",
				"/Library/Fonts",
			];
			const fontProtocolHandler = async (request: Request) => {
				const url = new URL(request.url);
				const filename = path.basename(url.pathname);
				if (!/\.(otf|ttf|woff2?)$/i.test(filename)) {
					return new Response("Not found", { status: 404 });
				}
				for (const dir of SYSTEM_FONT_DIRS) {
					const fontPath = path.join(dir, filename);
					try {
						return await net.fetch(pathToFileURL(fontPath).toString());
					} catch {
						// Not in this directory
					}
				}
				return new Response("Not found", { status: 404 });
			};
			protocol.handle("superset-font", fontProtocolHandler);
			session
				.fromPartition("persist:superset")
				.protocol.handle("superset-font", fontProtocolHandler);
		}

		ensureProjectIconsDir();
		setWorkspaceDockIcon();
		initSentry();
		await timeStartupPhase("initAppState", initAppState);
		initTanstackDbPersistence();

		// Not awaited: it measured 173ms, spent entirely in front of the window.
		// It is a diagnostic logger — the worst case for starting it late is that
		// it misses the first few requests, which is a far better trade than
		// holding the whole app back. Kept here rather than moved after
		// `createWindow` so it still starts before the renderer does anything.
		void timeStartupPhase("startNetworkLogger", startNetworkLogger).catch(
			(error: unknown) => {
				console.error("[main] Failed to start network logger:", error);
			},
		);

		// Everything from here to makeAppSetup blocks the window — and therefore
		// the boot screen — from appearing at all. Timed rather than trimmed on a
		// hunch: `reconcileDaemonSessions` genuinely has to precede the renderer's
		// restore, so the only safe cuts are the ones the numbers justify.
		await timeStartupPhase(
			"loadWebviewBrowserExtension",
			loadWebviewBrowserExtension,
		);

		// Must happen before renderer restore runs
		await timeStartupPhase("reconcileDaemonSessions", reconcileDaemonSessions);
		prewarmTerminalRuntime();

		try {
			setupAgentHooks();
		} catch (error) {
			console.error("[main] Failed to set up agent hooks:", error);
		}
		try {
			installBundledCliShim();
		} catch (error) {
			console.error("[main] Failed to install bundled CLI shim:", error);
		}
		try {
			// Keeps every Claude account's usage numbers current while the app is
			// open. Without it a snapshot only changes when that account happens to
			// take a turn, so an idle account's bar outlives the window it measured.
			startUsageRefreshTicker();
		} catch (error) {
			console.error("[main] Failed to start the usage refresh ticker:", error);
		}
		try {
			// Reads the previous run's verdict, then starts recording this one.
			const previous = crashSentinel.start(app.getVersion());
			if (previous?.crashed) {
				console.warn(
					`[crash-sentinel] previous run did NOT exit cleanly — release=${previous.release} ` +
						`memory=${previous.diagnostics.memory} terminals=${previous.diagnostics.terminals} ` +
						`runtime=${previous.diagnostics.runtime} activityWasNone=${previous.activityWasNone}`,
				);
			} else if (previous) {
				console.log(
					`[crash-sentinel] previous run exited as expected (${previous.expectedExit})`,
				);
			}
		} catch (error) {
			console.error("[main] Failed to start the crash sentinel:", error);
		}

		if (IS_DEV) {
			getHostServiceCoordinator().enableDevReload(async () => {
				const { token } = await loadToken();
				if (!token) return null;
				return { authToken: token, cloudApiUrl: mainEnv.NEXT_PUBLIC_API_URL };
			});
		}

		await timeStartupPhase("createWindow", () =>
			makeAppSetup(() => MainWindow()),
		);
		setupAutoUpdater();
		initTray();

		const coldStartUrl = findDeepLinkInArgv(process.argv);
		if (coldStartUrl) {
			await processDeepLink(coldStartUrl);
		}
		if (pendingDeepLinkUrl) {
			await processDeepLink(pendingDeepLinkUrl);
			pendingDeepLinkUrl = null;
		}

		appReady = true;
	})();
}
