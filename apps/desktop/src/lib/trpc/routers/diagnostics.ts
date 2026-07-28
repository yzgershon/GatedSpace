import { app } from "electron";
import { crashSentinel } from "main/lib/crash-sentinel";
import { publicProcedure, router } from "..";

/**
 * Facts about how the app is running, for the UI and for a bug report.
 *
 * `previousSession` is the crash sentinel's verdict on the last run. Without a
 * reader, the sentinel is a file nobody opens — recording that the app died is
 * only worth anything if something can say so afterwards.
 *
 * Read-only and cheap: the verdict is computed once at startup and held in
 * memory, so this touches no disk.
 */
export const createDiagnosticsRouter = () => {
	return router({
		/**
		 * How the previous run ended. Null when there was no previous run — a
		 * first launch, or a home directory that was wiped.
		 *
		 * `crashed: true` means the last run never stamped an expected exit, so it
		 * was killed rather than quit. The bucketed diagnostics describe what it
		 * looked like at the time: memory band, terminal count band, how long it
		 * had been up, and whether the user had done anything at all.
		 */
		previousSession: publicProcedure.query(() =>
			crashSentinel.getPreviousSession(),
		),

		/**
		 * The running build's version, for display in the app chrome.
		 *
		 * Worth surfacing because "which build am I actually on" is otherwise
		 * answered by hashing an installer — several personal builds can share a
		 * version number, and the one that's installed is not always the newest on
		 * disk.
		 */
		appVersion: publicProcedure.query(() => ({
			version: app.getVersion(),
			isDev: process.env.NODE_ENV === "development",
		})),
	});
};
