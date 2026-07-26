/**
 * Typed model for the Claude Code stream-json protocol.
 *
 * These types are derived from REAL captured output of the installed CLI
 * (`claude --print --output-format stream-json --include-partial-messages
 * --verbose`), version 2.1.218. Sample transcripts live next to this file's
 * spec at:
 *   apps/desktop/plans/20260723-claude-code-session-ui-schema-sample.jsonl
 *   apps/desktop/plans/20260724-claude-code-stream-tools-sample.jsonl
 *
 * Single source of truth for the main-process transport (which parses the
 * NDJSON) and the renderer (which builds the session timeline from it).
 *
 * Design notes:
 * - The union discriminates on `type` (and `subtype` for "system").
 * - Every event carries `session_id` and `uuid`; assistant/user/stream events
 *   also carry `parent_tool_use_id` (non-null when the work belongs to a
 *   subagent — used to group subagent activity in the UI).
 * - Shapes we don't fully model (usage counters, rate-limit info) keep an index
 *   signature so unknown fields survive round-trips without `any`.
 */

// ---------------------------------------------------------------------------
// Anthropic content blocks (inside assistant/user messages)
// ---------------------------------------------------------------------------

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
	signature?: string;
}

export interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
	/** "direct" when the top-level agent called it; subagents differ. */
	caller?: { type: string };
}

export interface ToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	/** String for simple tools; block array for rich (image, etc.) results. */
	content: string | Array<Record<string, unknown>>;
	is_error?: boolean;
}

export type AssistantContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

// ---------------------------------------------------------------------------
// Anthropic streaming SSE events (the inner `event` of a stream_event)
// ---------------------------------------------------------------------------

export interface AnthropicMessageStart {
	type: "message_start";
	message: AnthropicMessage;
}
export interface AnthropicContentBlockStart {
	type: "content_block_start";
	index: number;
	content_block: AssistantContentBlock;
}
export interface AnthropicContentBlockDelta {
	type: "content_block_delta";
	index: number;
	delta:
		| { type: "text_delta"; text: string }
		| { type: "input_json_delta"; partial_json: string }
		| { type: "thinking_delta"; thinking: string }
		| { type: "signature_delta"; signature: string };
}
export interface AnthropicContentBlockStop {
	type: "content_block_stop";
	index: number;
}
export interface AnthropicMessageDelta {
	type: "message_delta";
	delta: { stop_reason?: string | null; stop_sequence?: string | null };
	usage?: Record<string, number>;
}
export interface AnthropicMessageStop {
	type: "message_stop";
}

export type AnthropicStreamInnerEvent =
	| AnthropicMessageStart
	| AnthropicContentBlockStart
	| AnthropicContentBlockDelta
	| AnthropicContentBlockStop
	| AnthropicMessageDelta
	| AnthropicMessageStop;

export interface AnthropicMessage {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	content: AssistantContentBlock[];
	stop_reason: string | null;
	stop_sequence: string | null;
	usage: Record<string, unknown>;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Top-level CLI events (one JSON object per NDJSON line)
// ---------------------------------------------------------------------------

/** system/init — the session header: tools, slash commands, model, MCP, etc. */
export interface SystemInitEvent {
	type: "system";
	subtype: "init";
	session_id: string;
	uuid: string;
	cwd: string;
	model: string;
	permissionMode: string;
	apiKeySource: string;
	claude_code_version: string;
	output_style: string;
	tools: string[];
	slash_commands: string[];
	agents: string[];
	skills: string[];
	plugins: string[];
	capabilities: string[];
	mcp_servers: Array<{ name: string; status: string }>;
	memory_paths?: Record<string, string>;
	fast_mode_state?: string;
	[key: string]: unknown;
}

/** system/status — transient lifecycle pings (e.g. "requesting"). */
export interface SystemStatusEvent {
	type: "system";
	subtype: "status";
	status: string;
	session_id: string;
	uuid: string;
}

export interface HookStartedEvent {
	type: "system";
	subtype: "hook_started";
	hook_id: string;
	hook_name: string;
	hook_event: string;
	session_id: string;
	uuid: string;
}

export interface HookResponseEvent {
	type: "system";
	subtype: "hook_response";
	hook_id: string;
	hook_name: string;
	hook_event: string;
	output: string;
	stdout: string;
	stderr: string;
	exit_code: number;
	outcome: string;
	session_id: string;
	uuid: string;
}

/** A complete assistant turn (or a coalesced snapshot during streaming). */
export interface AssistantEvent {
	type: "assistant";
	message: AnthropicMessage;
	parent_tool_use_id: string | null;
	session_id: string;
	uuid: string;
	timestamp?: string;
	request_id?: string;
}

/** A user turn — in headless runs this carries tool_result blocks. */
export interface UserEvent {
	type: "user";
	message:
		| { role: "user"; content: ToolResultBlock[] }
		| Record<string, unknown>;
	parent_tool_use_id: string | null;
	session_id: string;
	uuid: string;
	timestamp?: string;
	tool_use_result?: unknown;
}

/** Wrapper around a raw Anthropic SSE event (partial-messages mode). */
export interface StreamEvent {
	type: "stream_event";
	event: AnthropicStreamInnerEvent;
	session_id: string;
	parent_tool_use_id: string | null;
	uuid: string;
	ttft_ms?: number;
}

export interface RateLimitEvent {
	type: "rate_limit_event";
	rate_limit_info: {
		status: string;
		resetsAt?: number;
		rateLimitType?: string;
		overageStatus?: string;
		isUsingOverage?: boolean;
		[key: string]: unknown;
	};
	session_id: string;
	uuid: string;
}

/** Terminal event of a turn — the end-of-turn rundown (cost, usage, timings). */
export interface ResultEvent {
	type: "result";
	subtype: string;
	is_error: boolean;
	result: string;
	session_id: string;
	uuid: string;
	num_turns: number;
	duration_ms: number;
	duration_api_ms: number;
	total_cost_usd: number;
	stop_reason: string | null;
	terminal_reason: string;
	usage: Record<string, unknown>;
	modelUsage: Record<string, unknown>;
	permission_denials: unknown[];
	api_error_status: unknown;
	[key: string]: unknown;
}

/**
 * GatedSpace-internal — NOT part of the CLI protocol. The user's own typed
 * prompt, recorded by the main-process session manager when it writes to stdin.
 * The CLI never echoes user messages back (that needs --replay-user-messages),
 * so without this the prompts would be missing from the replayable buffer and a
 * pane that remounts would show only Claude's half of the conversation.
 */
export interface LocalUserMessageEvent {
	type: "local_user_message";
	id: string;
	text: string;
	/** Images sent with this prompt, described but not carried — see below. */
	attachments?: UserAttachment[];
}

/**
 * An image the user attached to a prompt, as the TIMELINE needs to know it.
 *
 * Deliberately not the bytes. This rides inside `local_user_message`, which goes
 * into main's replay buffer for the life of the session — a couple of pasted
 * screenshots as base64 would outweigh an entire conversation's text. The chip
 * in the timeline only ever needs a name and a size.
 *
 * Dimensions are optional because a transcript replayed from disk knows an image
 * was there but not how big it was.
 */
export interface UserAttachment {
	name: string;
	mediaType: string;
	width?: number;
	height?: number;
	/**
	 * A small preview data URL, kept so the conversation can SHOW what was sent
	 * rather than just name it. Bounded to a few KB — this rides in the event and
	 * therefore lives in the replay buffer, which is exactly why the full image
	 * payload does not. Absent for transcripts loaded from disk, which record
	 * that an image was attached but not how it looked.
	 */
	thumbnail?: string;
}

/**
 * An image on its way TO the CLI: an attachment plus the base64 payload that
 * becomes an Anthropic image content block on stdin.
 *
 * Verified empirically against CLI 2.1.218 — a `{type:"image", source:{type:
 * "base64"}}` block in a stream-json user message is read and seen by the model.
 */
export interface UserImagePayload extends UserAttachment {
	/** Base64, no data: prefix. */
	data: string;
}

/**
 * GatedSpace-internal — a line of our own explanation in the transcript, for
 * when the app did something the user should know about (e.g. declined to
 * resume a session that's already open elsewhere). Never emitted by the CLI.
 */
export interface LocalNoticeEvent {
	type: "local_notice";
	id: string;
	text: string;
	/**
	 * Set when the notice explains why the session stopped (spawn failure, a
	 * crash). It settles the timeline so the UI doesn't sit on a spinner
	 * waiting for a turn that will never finish.
	 */
	fatal?: boolean;
}

export type ClaudeStreamEvent =
	| LocalNoticeEvent
	| LocalUserMessageEvent
	| SystemInitEvent
	| SystemStatusEvent
	| HookStartedEvent
	| HookResponseEvent
	| AssistantEvent
	| UserEvent
	| StreamEvent
	| RateLimitEvent
	| ResultEvent;

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

export function isSystemEvent(
	e: ClaudeStreamEvent,
): e is
	| SystemInitEvent
	| SystemStatusEvent
	| HookStartedEvent
	| HookResponseEvent {
	return e.type === "system";
}

export function isInitEvent(e: ClaudeStreamEvent): e is SystemInitEvent {
	return e.type === "system" && e.subtype === "init";
}

export function isResultEvent(e: ClaudeStreamEvent): e is ResultEvent {
	return e.type === "result";
}

/**
 * Parse one NDJSON line into a typed event. Returns null for blank lines or
 * malformed JSON (the transport logs and skips those rather than crashing the
 * stream). Unknown `type` values are returned as-is under the union's index
 * signatures so a newer CLI can't break the parser.
 */
export function parseStreamLine(line: string): ClaudeStreamEvent | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof parsed.type === "string"
		) {
			return parsed as ClaudeStreamEvent;
		}
		return null;
	} catch {
		return null;
	}
}
