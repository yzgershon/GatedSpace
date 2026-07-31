import { app } from "electron";
import { crashSentinel } from "main/lib/crash-sentinel";
import { markStartup } from "main/lib/startup-timing";
import { z } from "zod";
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

		/**
		 * Record a renderer launch milestone in main's log file.
		 *
		 * Main's own `[startup]` lines stop at window creation (~1.4s measured),
		 * but the host service only came up ~9s later and everything in that gap
		 * — renderer boot, auth hydration, provider mount — happens in the
		 * renderer. That gap was the whole remaining launch budget and none of it
		 * was visible.
		 *
		 * Over tRPC rather than `electron-log/renderer`, which needs
		 * `log.initialize()` — that relies on `session.setPreloads`, removed in
		 * Electron 39, and this app is on 40. Had it thrown during startup the
		 * window would never have been created: a catastrophic failure mode for a
		 * diagnostic. This channel is one the app already depends on.
		 *
		 * Main stamps the time, not the renderer, so every line shares one clock
		 * (process uptime) and the renderer's numbers read directly against
		 * main's instead of needing to be correlated by hand.
		 */
		startupMark: publicProcedure
			.input(z.object({ label: z.string().max(120) }))
			.mutation(({ input }) => {
				markStartup(`renderer: ${input.label}`);
				return { ok: true } as const;
			}),
	});
};
