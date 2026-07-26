export interface FilePaneData {
	filePath: string;
	mode: "editor" | "diff" | "preview";
	language?: string;
	viewId?: string;
	forceViewId?: string;
}

export interface TerminalPaneData {
	terminalId: string;
}

// Read-only browser of recent Claude CLI sessions; carries no per-instance
// state (the list is fetched live via the claudeSessions tRPC endpoint).
export type ClaudeSessionsPaneData = Record<string, never>;

// A live VS Code-style Claude Code session (pane kind "session"). Distinct from
// the read-only ClaudeSessionsPaneData list above. Minimal per-instance state —
// the timeline streams from the main-process transport keyed by pane id.
export interface SessionPaneData {
	/** Optional model override; omit for the CLI default. */
	model?: string;
	/** Resume an existing claude session id instead of starting fresh. */
	resumeSessionId?: string;
	/**
	 * Resume into a copy under a fresh session id, leaving the original session
	 * untouched. Set when opening a session that's already live somewhere else.
	 */
	forkSession?: boolean;
	/**
	 * Working directory override. Set when a session is resumed from the recent
	 * list, where the conversation can belong to a different project than the
	 * workspace the pane opens in. Omit to use the workspace's worktree path.
	 */
	cwd?: string;
}

export interface ChatPaneData {
	sessionId: string | null;
	/**
	 * Transient initial launch config for a freshly-opened chat pane.
	 * Cleared by the chat pane on first consume. Set by the V2 workspace
	 * page's useConsumePendingLaunch when a pending chat launch exists.
	 */
	launchConfig?: {
		initialPrompt?: string;
		initialFiles?: Array<{
			data: string;
			mediaType: string;
			filename?: string;
		}>;
		model?: string;
		taskSlug?: string;
	} | null;
}

export interface BrowserPaneData {
	url: string;
	pageTitle?: string;
	faviconUrl?: string | null;
}

export interface DevtoolsPaneData {
	targetPaneId: string;
	targetTitle: string;
}

export type DiffFocusSide = "deletions" | "additions";

export interface DiffPaneData {
	path: string;
	changeKey?: string;
	collapsedFiles: string[];
	/** Line to scroll to within `path`. `focusTick` bumps on each request
	 *  so repeated clicks of the same line still re-scroll. */
	focusLine?: number;
	focusSide?: DiffFocusSide;
	focusTick?: number;
}

export interface CommentPaneData {
	commentId: string;
	authorLogin: string;
	avatarUrl?: string;
	body: string;
	url?: string;
	path?: string;
	line?: number;
}

export type PaneViewerData =
	| FilePaneData
	| TerminalPaneData
	| ChatPaneData
	| BrowserPaneData
	| DevtoolsPaneData
	| DiffPaneData
	| CommentPaneData
	| ClaudeSessionsPaneData
	| SessionPaneData;
