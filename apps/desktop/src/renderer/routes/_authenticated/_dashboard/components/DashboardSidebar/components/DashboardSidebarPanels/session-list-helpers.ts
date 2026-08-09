/**
 * Pure helpers for the recent-sessions list.
 *
 * Split out of SidebarSessionsPanel.tsx because that module builds a tRPC
 * client at import time, which needs Electron's preload global. Importing it
 * from a test therefore throws before a single assertion runs — which is
 * exactly what had happened: the tests covering the liveness rule, the decision
 * that silently destroyed a transcript on 7/18 and again on 7/19, were dead and
 * reported as one failing file among many.
 *
 * Nothing here may import the trpc client, or these go dark again.
 */
import { formatAgentResumeCommand } from "@superset/shared/agent-resume";

export type AgentSessionProvider = "claude" | "codex";

export function formatRelativeTime(ms: number, now = Date.now()): string {
	const seconds = Math.max(0, (now - ms) / 1000);
	if (seconds < 60) return "now";
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	const days = Math.round(seconds / 86400);
	if (days < 30) return `${days}d`;
	return `${Math.round(days / 30)}mo`;
}

/**
 * Which session ids must not be plain-resumed.
 *
 * Returns null for "unknown" — when the host can't be asked, the caller forks
 * everything rather than assuming nothing is live. Failing safe costs a new
 * session id; failing open costs a conversation.
 */
export function liveSessionKeys(
	hostBindings: Array<{
		agentId: string;
		agentSessionId?: string | null;
	}> | null,
	paneSessionIds: string[] | null,
): Set<string> | null {
	if (hostBindings === null) return null;
	const keys = new Set<string>();
	for (const binding of hostBindings) {
		if (!binding.agentSessionId) continue;
		keys.add(`${binding.agentId}:${binding.agentSessionId}`);
	}
	for (const sessionId of paneSessionIds ?? []) {
		keys.add(`claude:${sessionId}`);
	}
	return keys;
}

/**
 * The command that reattaches this conversation from a plain terminal.
 *
 * Worth surfacing because the app is not the only way back in: when a pane is
 * wedged, when GatedSpace itself is the thing being restarted, or when the work
 * has to move to another machine, the CLI is the escape hatch — and the session
 * id is otherwise buried in a transcript filename.
 *
 * Deliberately NOT offered for a live session: running this in a second place
 * is precisely the two-writer case above. The UI hands out a fork for those,
 * and this returns null so there is nothing to copy.
 */
/**
 * Which dated bucket a session falls in, for the list's group headers.
 *
 * Boundaries are CALENDAR days, not elapsed hours: something from 11pm last
 * night is "Yesterday" at 1am, not "Today", because that is what the user means
 * by it. Anchored on a passed-in `now` so this is testable without freezing the
 * clock.
 */
export type SessionDateGroup =
	| "Today"
	| "Yesterday"
	| "Previous 7 days"
	| "Previous 30 days"
	| "Older";

export function sessionDateGroup(
	lastModified: number,
	now: number = Date.now(),
): SessionDateGroup {
	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const dayMs = 86_400_000;
	const start = startOfToday.getTime();

	if (lastModified >= start) return "Today";
	if (lastModified >= start - dayMs) return "Yesterday";
	if (lastModified >= start - 7 * dayMs) return "Previous 7 days";
	if (lastModified >= start - 30 * dayMs) return "Previous 30 days";
	return "Older";
}

/**
 * The folder a session belongs to, as a bare name.
 *
 * The second line of every row. Renderer is a browser context with no
 * node:path, so the basename is taken by hand, and both separators are handled
 * because a cwd can arrive in either shape.
 */
export function projectNameFor(cwd: string | null): string | null {
	if (!cwd) return null;
	const trimmed = cwd.replace(/[/\\]+$/, "");
	const name = trimmed.split(/[/\\]/).pop();
	return name && name.length > 0 ? name : null;
}

export function resumeCommandFor(
	provider: AgentSessionProvider,
	sessionId: string,
	isLive: boolean,
): string | null {
	// Liveness is decided here; SYNTAX comes from the shared catalog, so this
	// can't drift from the host-service path that rebuilds the same command
	// when a PTY dies.
	if (isLive) return null;
	return formatAgentResumeCommand(provider, sessionId);
}
