/**
 * Shared notification types used by both main and renderer processes.
 * Kept in shared/ to avoid cross-boundary imports.
 */

export interface NotificationIds {
	paneId?: string;
	tabId?: string;
	workspaceId?: string;
	sessionId?: string;
	terminalId?: string;
}

export interface AgentLifecycleEvent extends NotificationIds {
	eventType: "Start" | "Stop" | "PermissionRequest" | "PendingQuestion";
	/**
	 * The hook name as the agent reported it, before mapping.
	 *
	 * Several distinct hooks collapse onto one mapped type — which is right for
	 * pane STATUS, where "SessionEnd" and "Stop" both mean the pane is no longer
	 * working, and wrong for NOTIFICATIONS, where only one of them means the
	 * agent finished what you asked. Kept so the notification layer can tell
	 * them apart without the status layer having to care.
	 */
	sourceEventType?: string;
}

export type V2NotificationSource =
	| { type: "terminal"; id: string }
	| { type: "chat"; id: string };

export interface V2NotificationSourceFocusTarget {
	workspaceId: string;
	source: V2NotificationSource;
}
