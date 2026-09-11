import type { Pane, Tab } from "@superset/panes";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type V2NotificationPaneLike = Pick<
	Pane<unknown>,
	"id" | "kind" | "data"
>;
export type V2NotificationTabLike = Pick<Tab<unknown>, "panes">;

export type V2NotificationSource =
	| { type: "terminal"; id: string }
	/**
	 * A live Claude Code session pane. Keyed on the PANE id, because that is
	 * what the session store is keyed on — the conversation's own session id
	 * isn't known until the CLI says hello, and it changes under a fork, so a
	 * dot keyed on it would go missing exactly when a session is starting up.
	 */
	| { type: "session"; id: string }
	| { type: "chat"; id: string };

export type V2NotificationSourceKey =
	`${V2NotificationSource["type"]}:${string}`;
export type V2NotificationSourceInput =
	| V2NotificationSource
	| V2NotificationSourceKey;

/**
 * Renderer-local notification state. Terminal agent statuses
 * (working/permission/idle/review) are DERIVED from host agent bindings —
 * see `renderer/hooks/host-service/useV2NotificationStatus` — so the only
 * facts stored here are about the user, not the agents:
 * manual unread marks and per-terminal seen timestamps.
 */
export interface V2NotificationState {
	/** Workspaces manually marked unread from the sidebar. */
	manualUnread: Record<string, true>;
	/**
	 * terminalId → last agent event the user has seen for that terminal.
	 * Compared to the host binding's lastEventAt to derive `review` (unseen
	 * Stop). `at` must be a HOST-clock value (event occurredAt or binding
	 * lastEventAt) — never the renderer clock, which can drift either way
	 * and, with the monotonic guard, poison the comparison.
	 */
	terminalSeenAt: Record<string, number>;
	/**
	 * Session pane id → the id of the finished turn the user has already seen.
	 *
	 * An id rather than a timestamp, unlike `terminalSeenAt`: a session pane's
	 * completions arrive as timeline items with their own ids and no host clock
	 * to compare against, and matching on the id means "seen" survives a replay
	 * of the buffered transcript — which happens on every window reload, and
	 * would otherwise relight every dot in the workspace.
	 */
	sessionSeenTurn: Record<string, string>;
	setManualUnread: (workspaceId: string) => void;
	clearManualUnread: (workspaceId: string) => void;
	markTerminalSeen: (terminalId: string, at: number) => void;
	pruneTerminalSeen: (terminalId: string) => void;
	markSessionSeen: (paneId: string, turnKey: string) => void;
	pruneSessionSeen: (paneId: string) => void;
}

export const useV2NotificationStore = create<V2NotificationState>()(
	devtools(
		persist(
			(set) => ({
				manualUnread: {},
				terminalSeenAt: {},
				sessionSeenTurn: {},
				setManualUnread: (workspaceId) => {
					set((state) => ({
						manualUnread: { ...state.manualUnread, [workspaceId]: true },
					}));
				},
				clearManualUnread: (workspaceId) => {
					set((state) => {
						if (!(workspaceId in state.manualUnread)) return state;
						const { [workspaceId]: _removed, ...manualUnread } =
							state.manualUnread;
						return { manualUnread };
					});
				},
				markTerminalSeen: (terminalId, at) => {
					set((state) => {
						const prev = state.terminalSeenAt[terminalId];
						// Monotonic: a late event must not roll the seen mark back.
						if (prev !== undefined && prev >= at) return state;
						return {
							terminalSeenAt: { ...state.terminalSeenAt, [terminalId]: at },
						};
					});
				},
				pruneTerminalSeen: (terminalId) => {
					set((state) => {
						if (!(terminalId in state.terminalSeenAt)) return state;
						const { [terminalId]: _removed, ...terminalSeenAt } =
							state.terminalSeenAt;
						return { terminalSeenAt };
					});
				},
				markSessionSeen: (paneId, turnKey) => {
					set((state) => {
						if (state.sessionSeenTurn[paneId] === turnKey) return state;
						return {
							sessionSeenTurn: { ...state.sessionSeenTurn, [paneId]: turnKey },
						};
					});
				},
				pruneSessionSeen: (paneId) => {
					set((state) => {
						if (!(paneId in state.sessionSeenTurn)) return state;
						const { [paneId]: _removed, ...sessionSeenTurn } =
							state.sessionSeenTurn;
						return { sessionSeenTurn };
					});
				},
			}),
			{
				name: "v2-notifications-v1",
				version: 3,
				partialize: (state) => ({
					manualUnread: state.manualUnread,
					terminalSeenAt: state.terminalSeenAt,
					sessionSeenTurn: state.sessionSeenTurn,
				}),
				migrate: migrateV2NotificationState,
			},
		),
		{ name: "V2Notifications" },
	),
);

type PersistedV2NotificationState = Pick<
	V2NotificationState,
	"manualUnread" | "terminalSeenAt" | "sessionSeenTurn"
>;

/**
 * v1 persisted a per-source status map. Terminal statuses are now derived
 * from host bindings (carrying them forward would resurrect the stale-dot
 * bug) and chat statuses never shipped, so only manual unread marks survive.
 */
export function migrateV2NotificationState(
	persisted: unknown,
	version: number,
): PersistedV2NotificationState {
	if (version >= 2) {
		const state = persisted as
			| Partial<PersistedV2NotificationState>
			| undefined;
		return {
			manualUnread: state?.manualUnread ?? {},
			terminalSeenAt: state?.terminalSeenAt ?? {},
			// v2 predates session dots; an empty map means every open session
			// starts unseen, which is the safe direction to be wrong in.
			sessionSeenTurn: state?.sessionSeenTurn ?? {},
		};
	}
	const legacy = persisted as
		| {
				sources?: Record<string, { workspaceId?: string; status?: string }>;
		  }
		| undefined;
	const manualUnread: Record<string, true> = {};
	for (const [sourceKey, entry] of Object.entries(legacy?.sources ?? {})) {
		if (
			sourceKey.startsWith("manual:") &&
			entry.status === "review" &&
			entry.workspaceId
		) {
			manualUnread[entry.workspaceId] = true;
		}
	}
	return { manualUnread, terminalSeenAt: {}, sessionSeenTurn: {} };
}

export function getV2NotificationSourceKey(
	source: V2NotificationSourceInput,
): V2NotificationSourceKey {
	if (typeof source === "string") return source;
	return `${source.type}:${source.id}`;
}

export function getV2TerminalNotificationSource(
	terminalId: string,
): V2NotificationSource {
	return { type: "terminal", id: terminalId };
}

export function getV2NotificationSourcesForPane(
	pane: V2NotificationPaneLike | null | undefined,
): V2NotificationSource[] {
	const terminalId = getTerminalIdForPane(pane);
	if (terminalId) return [getV2TerminalNotificationSource(terminalId)];
	// The Claude Code session pane. Its kind is "session" — NOT "chat", which
	// is a v1 kind the v2 pane registry never registered. Missing this case is
	// why the tab dot silently worked for terminals only: a session pane
	// produced no sources at all, so there was never a status to show.
	if (pane?.kind === "session" && pane.id) {
		return [{ type: "session", id: pane.id }];
	}
	const chatId = getChatIdForPane(pane);
	if (chatId) return [{ type: "chat", id: chatId }];
	return [];
}

export function getV2NotificationSourcesForTab(
	tab: V2NotificationTabLike | null | undefined,
): V2NotificationSource[] {
	if (!tab) return [];
	const sources = new Map<V2NotificationSourceKey, V2NotificationSource>();
	for (const pane of Object.values(tab.panes)) {
		for (const source of getV2NotificationSourcesForPane(pane)) {
			sources.set(getV2NotificationSourceKey(source), source);
		}
	}
	return [...sources.values()];
}

function getTerminalIdForPane(
	pane: V2NotificationPaneLike | null | undefined,
): string | null {
	if (!pane || pane.kind !== "terminal") return null;
	if (!pane.data || typeof pane.data !== "object") return null;
	const terminalId = (pane.data as { terminalId?: unknown }).terminalId;
	return typeof terminalId === "string" && terminalId ? terminalId : null;
}

function getChatIdForPane(
	pane: V2NotificationPaneLike | null | undefined,
): string | null {
	if (!pane || pane.kind !== "chat") return null;
	if (!pane.data || typeof pane.data !== "object") return null;
	const sessionId = (pane.data as { sessionId?: unknown }).sessionId;
	return typeof sessionId === "string" && sessionId ? sessionId : null;
}
