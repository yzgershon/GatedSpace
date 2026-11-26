export interface SessionNotificationState {
	key: string;
	provider: "claude" | "codex";
	workspaceId?: string;
	sessionId?: string;
	title?: string;
	visible?: boolean;
	turnId?: string;
	usageBlocked?: boolean;
	status: "idle" | "working" | "attention" | "completed" | "error";
}
