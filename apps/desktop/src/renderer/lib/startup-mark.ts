/**
 * Renderer-side launch milestones, written into main's log file.
 *
 * Main's own `[startup]` lines only reach as far as the window being created,
 * which measured ~1.4s. The host service then came up ~9s later, and everything
 * in between happens here: renderer boot, auth hydration (two network
 * round-trips in cloud mode), provider mount. That gap was the entire remaining
 * launch budget and none of it was visible.
 *
 * Sent to main rather than logged locally: an installed app has no terminal, and
 * DevTools is not somewhere a log gets read from after the fact. Main also
 * stamps the time, so every line shares one clock and these read directly
 * against main's own timings.
 */
import { electronTrpcClient } from "renderer/lib/trpc-client";

const marked = new Set<string>();

/**
 * Record a launch milestone once.
 *
 * Once, because these sit in providers that re-render freely, and a milestone
 * logged fifty times is noise rather than a measurement.
 *
 * Failures are swallowed deliberately. This is a diagnostic: it must not be
 * able to break a launch it exists to measure.
 */
export function markStartupOnce(label: string): void {
	if (marked.has(label)) return;
	marked.add(label);
	void electronTrpcClient.diagnostics.startupMark
		.mutate({ label })
		.catch(() => {});
}
