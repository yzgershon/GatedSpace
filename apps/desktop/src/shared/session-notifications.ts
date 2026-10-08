export interface SessionNotificationState {
	key: string;
	provider: "claude" | "codex";
	workspaceId?: string;
	sessionId?: string;
	title?: string;
	visible?: boolean;
	turnId?: string;
	status: "idle" | "working" | "attention" | "completed" | "error";
}
