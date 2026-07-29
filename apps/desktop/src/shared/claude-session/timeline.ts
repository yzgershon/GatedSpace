/**
 * Folds the Claude Code event stream into a renderable session timeline.
 *
 * Pure and incremental: `applyEvent(state, event)` returns the next immutable
 * state, and `buildTimeline(events)` is just a reduce over that. The same
 * function powers both the unit tests (folding a captured transcript) and the
 * live UI (applying one event at a time as it streams in).
 *
 * Observed protocol behaviour (from real captures, CLI 2.1.218): the coalesced
 * `assistant` events are PER-BLOCK and non-cumulative — one event carries
 * thinking, the next carries a tool_use, a later one a fresh text message — so
 * blocks are appended, not re-snapshotted. tool_use blocks are keyed by their
 * own id so the matching tool_result (a later `user` event) can attach output
 * to the right card. `parent_tool_use_id` is preserved on every item so the
 * renderer can group subagent work under the Task call that spawned it.
 */
import type {
	AssistantContentBlock,
	ClaudeStreamEvent,
	StreamEvent,
	TextBlock,
	ToolResultBlock,
	UserAttachment,
} from "./events";
import { isSyntheticUserTurn } from "./synthetic-user-turn";

export type { UserAttachment } from "./events";

export type ToolStatus = "running" | "success" | "error";

export interface UserTextItem {
	kind: "user";
	id: string;
	text: string;
	/** Images sent with the prompt, shown as chips above it. */
	attachments?: UserAttachment[];
}
export interface AssistantTextItem {
	kind: "text";
	id: string;
	text: string;
	parentToolUseId: string | null;
}
export interface ThinkingItem {
	kind: "thinking";
	id: string;
	text: string;
	parentToolUseId: string | null;
}
export interface ToolItem {
	kind: "tool";
	id: string;
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: ToolStatus;
	output?: string;
	parentToolUseId: string | null;
}
/** GatedSpace explaining itself in the transcript, not part of the chat. */
export interface NoticeItem {
	kind: "notice";
	id: string;
	text: string;
	/** This notice explains why the session stopped. */
	fatal?: boolean;
}
export interface ResultItem {
	kind: "result";
	id: string;
	result: string;
	isError: boolean;
	costUsd: number;
	durationMs: number;
	numTurns: number;
}

export type TimelineItem =
	| UserTextItem
	| AssistantTextItem
	| ThinkingItem
	| ToolItem
	| NoticeItem
	| ResultItem;

export interface SessionHeader {
	sessionId: string;
	model: string;
	cwd: string;
	permissionMode: string;
	slashCommands: string[];
	skills: string[];
	agents: string[];
	mcpServers: Array<{ name: string; status: string }>;
}

export interface RateLimitInfo {
	status: string;
	resetsAt?: number;
	rateLimitType?: string;
}

/** How full the context is, as of the last completed turn. */
export interface SessionUsage {
	contextTokens: number;
	contextWindow?: number;
}

/**
 * Output tokens produced during the turn running right now.
 *
 * Kept as two parts because the API reports `output_tokens` CUMULATIVELY per
 * message, not as a delta — adding each report would count the same tokens
 * again on every frame. A turn can span several assistant messages (each tool
 * call ends one and starts another), so the finished ones are banked and only
 * the message currently streaming is replaced in place.
 */
export interface TurnTokens {
	/** Banked from assistant messages already finished this turn. */
	committed: number;
	/** Latest cumulative count for the message streaming right now. */
	live: number;
	/**
	 * Whether a message is open — started and not yet banked.
	 *
	 * The CLI can forward a message's trailing SSE frames AFTER it has emitted
	 * the assembled `assistant` event for that same message. Without this flag
	 * those late frames revive a count that has already been banked, and the
	 * total reads high by a whole message for the rest of the turn.
	 */
	open: boolean;
}

export function turnTokenTotal(tokens: TurnTokens | undefined): number {
	if (!tokens) return 0;
	return tokens.committed + tokens.live;
}

/**
 * Bank a finished assistant message's output into the turn's total.
 *
 * Deliberately driven by the `assistant` event rather than by the SSE frames,
 * because main's replay buffer DROPS stream events — a pane rebuilt from that
 * buffer (a reload, a reattach) would otherwise show no count at all while one
 * built from the live stream showed the real figure. Both paths carry the
 * `assistant` event, so both arrive at the same number.
 */
function bankTurnTokens(
	state: SessionTimeline,
	usage: Record<string, unknown> | undefined,
): TurnTokens | undefined {
	const output = usage?.output_tokens;
	const tokens = state.turnTokens ?? EMPTY_TURN_TOKENS;
	const counted =
		typeof output === "number" && Number.isFinite(output) ? output : 0;

	// `live` is always cleared, never added — it was this same message's running
	// count, and the final figure supersedes it. Clearing it even when the final
	// figure is MISSING is what keeps the two paths in step: the replay buffer
	// has no running count to strand, so banking one here would make a reloaded
	// pane and a live one disagree.
	if (counted === 0 && tokens.live === 0 && !tokens.open)
		return state.turnTokens;
	return { committed: tokens.committed + counted, live: 0, open: false };
}

const EMPTY_TURN_TOKENS: TurnTokens = { committed: 0, live: 0, open: false };

export type SessionStatus = "idle" | "streaming" | "done" | "error";

/**
 * A block currently being streamed in token by token. `key` is how the SSE
 * deltas address it (they only carry a block index, so it's scoped by which
 * agent is talking); `id` is the timeline item it's filling in.
 */
export interface DraftBlock {
	key: string;
	id: string;
	type: "text" | "thinking" | "tool_use";
}

export interface SessionTimeline {
	header?: SessionHeader;
	items: TimelineItem[];
	rateLimit?: RateLimitInfo;
	usage?: SessionUsage;
	/**
	 * Live output-token count for the turn in progress. Reset at the start of
	 * each turn, so it answers "how much has it written since I asked" rather
	 * than accumulating over the conversation.
	 */
	turnTokens?: TurnTokens;
	/**
	 * Running API cost for the whole conversation, across every CLI process
	 * that has served it.
	 *
	 * NOT simply the CLI's number. `total_cost_usd` is cumulative within ONE
	 * process and restarts at zero in the next, so a session that has been
	 * resumed — after a restart, a profile switch, or waiting out a rate limit —
	 * reports only what the current process has spent. Taking the latest value
	 * therefore made the total appear to reset, repeatedly, which is exactly
	 * what it looked like.
	 */
	costUsd?: number;
	/**
	 * The last `total_cost_usd` seen from the CURRENT process, so the next one
	 * can be added as a delta rather than replacing the total. Internal
	 * bookkeeping; nothing renders it.
	 */
	costUsdThisRun?: number;
	status: SessionStatus;
	/** Blocks still streaming, oldest first. Empty between turns. */
	drafts: DraftBlock[];
}

export function emptyTimeline(): SessionTimeline {
	return { items: [], status: "idle", drafts: [] };
}

/**
 * Fold one process's reported cost into the conversation total.
 *
 * `total_cost_usd` is cumulative within a single CLI process and starts again
 * at zero in the next one, so it can only be added as a DELTA against the last
 * value that process reported.
 *
 * A value lower than the previous one means a new process is reporting (a
 * resume, a restart, a mode change), so the whole of it is new spend. That
 * check is the backstop: `system`/`init` already resets the per-run figure, but
 * a resumed session whose init was missed would otherwise silently subtract.
 */
function accrueCost(
	state: SessionTimeline,
	reported: unknown,
): Pick<SessionTimeline, "costUsd" | "costUsdThisRun"> | Record<string, never> {
	if (
		typeof reported !== "number" ||
		!Number.isFinite(reported) ||
		reported < 0
	)
		return {};
	const previous = state.costUsdThisRun ?? 0;
	const delta = reported >= previous ? reported - previous : reported;
	return {
		costUsd: (state.costUsd ?? 0) + delta,
		costUsdThisRun: reported,
	};
}

function toolResultOutput(block: ToolResultBlock): string {
	if (typeof block.content === "string") return block.content;
	return JSON.stringify(block.content);
}

/** Optimistically add the user's own typed prompt (the stream doesn't echo it). */
export function withUserMessage(
	state: SessionTimeline,
	id: string,
	text: string,
	attachments?: UserAttachment[],
): SessionTimeline {
	return {
		...state,
		status: "streaming",
		// A new prompt is a new turn, so the token counter starts again. Without
		// this it would read as a running total for the conversation, which is
		// both a different number and one that never stops growing.
		turnTokens: EMPTY_TURN_TOKENS,
		items: [
			...state.items,
			{
				kind: "user",
				id,
				text,
				...(attachments?.length ? { attachments } : {}),
			},
		],
	};
}

/**
 * Describe an image block read back from a stored transcript.
 *
 * A transcript records that an image was attached and its media type, but
 * nothing about how it looked, so the chip gets a generated name and no
 * dimensions — which is exactly what `UserAttachment` leaves optional.
 */
function transcriptAttachment(block: unknown, index: number): UserAttachment {
	const source = (block as { source?: { media_type?: unknown } }).source;
	const mediaType =
		typeof source?.media_type === "string" ? source.media_type : "image/png";
	return {
		name: `image-${index + 1}.${mediaType.split("/")[1] ?? "png"}`,
		mediaType,
	};
}

/** The settled form of one assistant content block. */
function finalizeBlock(
	block: AssistantContentBlock,
	id: string,
	parentToolUseId: string | null,
): TimelineItem | null {
	if (block.type === "text") {
		return { kind: "text", id, text: block.text, parentToolUseId };
	}
	if (block.type === "thinking") {
		return { kind: "thinking", id, text: block.thinking, parentToolUseId };
	}
	if (block.type === "tool_use") {
		return {
			kind: "tool",
			id: block.id,
			toolUseId: block.id,
			name: block.name,
			input: block.input,
			status: "running",
			parentToolUseId,
		};
	}
	return null;
}

/**
 * Swap a draft for its final form, keeping anything the draft learned in the
 * meantime — a tool_result can land before the finalizing assistant event, and
 * that output must not be thrown away.
 */
function mergeIntoFinal(
	existing: TimelineItem,
	final: TimelineItem,
): TimelineItem {
	if (
		existing.kind === "tool" &&
		final.kind === "tool" &&
		existing.output !== undefined
	) {
		return { ...final, status: existing.status, output: existing.output };
	}
	return final;
}

/**
 * Fold one SSE delta so text and thinking type out live instead of appearing in
 * a single jump when the turn settles. Deltas only carry a block index, so
 * they're scoped by which agent is speaking (a subagent streams its own indices
 * in parallel with the main one).
 *
 * Tool input deltas are ignored on purpose: a half-parsed JSON argument is
 * worse than a tool card that fills in its arguments a moment later.
 */
function applyStreamDelta(
	state: SessionTimeline,
	event: StreamEvent,
): SessionTimeline {
	const inner = event.event;
	const parentToolUseId = event.parent_tool_use_id;
	const scope = parentToolUseId ?? "main";

	/*
	 * The LIVE half of the token count: how much the message being written has
	 * produced so far. Banking is done by the `assistant` event that closes the
	 * message, not here — see `bankTurnTokens`.
	 *
	 * Main conversation only. A subagent's output is real work but it is not
	 * what this turn is writing back, and counting it made the number jump by
	 * thousands the moment a Task started, which reads as a glitch rather than
	 * as progress.
	 */
	if (!parentToolUseId && inner.type === "message_start") {
		const tokens = state.turnTokens ?? EMPTY_TURN_TOKENS;
		return { ...state, turnTokens: { ...tokens, live: 0, open: true } };
	}

	if (!parentToolUseId && inner.type === "message_delta") {
		const output = inner.usage?.output_tokens;
		const tokens = state.turnTokens ?? EMPTY_TURN_TOKENS;
		// A frame for a message already banked. See TurnTokens.open.
		if (!tokens.open) return state;
		if (typeof output === "number" && Number.isFinite(output)) {
			// Replaced, never added: this figure is cumulative for the message.
			if (tokens.live === output) return state;
			return { ...state, turnTokens: { ...tokens, live: output } };
		}
	}

	if (inner.type === "content_block_start") {
		const key = `${scope}:${inner.index}`;
		const block = inner.content_block;
		// A draft still sitting on this key belongs to an abandoned turn.
		const stale = state.drafts.find((d) => d.key === key);
		const baseItems = stale
			? state.items.filter((i) => i.id !== stale.id)
			: state.items;
		const baseDrafts = stale
			? state.drafts.filter((d) => d.key !== key)
			: state.drafts;

		let item: TimelineItem;
		if (block.type === "text") {
			item = { kind: "text", id: `stream:${key}`, text: "", parentToolUseId };
		} else if (block.type === "thinking") {
			item = {
				kind: "thinking",
				id: `stream:${key}`,
				text: block.thinking ?? "",
				parentToolUseId,
			};
		} else if (block.type === "tool_use") {
			item = {
				kind: "tool",
				id: block.id,
				toolUseId: block.id,
				name: block.name,
				input: block.input ?? {},
				status: "running",
				parentToolUseId,
			};
		} else {
			return state;
		}

		return {
			...state,
			status: "streaming",
			items: [...baseItems, item],
			drafts: [...baseDrafts, { key, id: item.id, type: block.type }],
		};
	}

	if (inner.type === "content_block_delta") {
		const draft = state.drafts.find((d) => d.key === `${scope}:${inner.index}`);
		if (!draft) return state;
		const { delta } = inner;
		const added =
			delta.type === "text_delta"
				? delta.text
				: delta.type === "thinking_delta"
					? delta.thinking
					: "";
		if (!added) return state;
		return {
			...state,
			items: state.items.map((item) =>
				item.id === draft.id &&
				(item.kind === "text" || item.kind === "thinking")
					? { ...item, text: item.text + added }
					: item,
			),
		};
	}

	return state;
}

/**
 * Read context occupancy out of a result event's per-model usage.
 *
 * What counts as "context used" is everything that was sent as prompt for the
 * last turn — fresh input plus whatever was served from or written to cache.
 * Output tokens are excluded: they're the reply, not the standing context.
 *
 * Shapes here are loosely typed by the protocol, so every field is read
 * defensively; a missing or malformed block simply means no indicator.
 */
function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The context window size, which is the ONLY thing worth taking from a result's
 * `modelUsage`.
 *
 * Its token counts are cumulative over the whole session, not a snapshot: every
 * turn re-reads the conversation from cache, so `cacheReadInputTokens` adds a
 * full context's worth each time. Summing them read 33.5M against a 1M window
 * on a session whose real context was 419k — roughly eighty turns of cache
 * reads, which is exactly what it was measuring.
 */
function readContextWindow(
	modelUsage: Record<string, unknown>,
): number | undefined {
	const latest = Object.values(modelUsage ?? {}).at(-1);
	if (!latest || typeof latest !== "object") return undefined;
	const window = (latest as Record<string, unknown>).contextWindow;
	return typeof window === "number" && window > 0 ? window : undefined;
}

/**
 * How much context ONE request carried, off an assistant message's own usage.
 *
 * This is the honest measure: a single API request's input plus whatever it read
 * or wrote to cache IS the conversation it was given. Per request, so it can't
 * accumulate.
 */
export function readAssistantContext(
	usage: Record<string, unknown> | undefined,
): number | undefined {
	if (!usage) return undefined;
	const tokens =
		asNumber(usage.input_tokens) +
		asNumber(usage.cache_read_input_tokens) +
		asNumber(usage.cache_creation_input_tokens);
	return tokens > 0 ? tokens : undefined;
}

/** Apply one protocol event, returning the next immutable timeline state. */
export function applyEvent(
	state: SessionTimeline,
	event: ClaudeStreamEvent,
): SessionTimeline {
	switch (event.type) {
		// GatedSpace's own echo of the prompt we wrote to stdin (the CLI doesn't
		// send one back), recorded in main so it survives a pane remount.
		case "local_user_message":
			return withUserMessage(state, event.id, event.text, event.attachments);

		case "local_notice":
			return {
				...state,
				// A fatal notice is the end of the story: settle the status and drop
				// any half-streamed drafts, or the UI spins on a turn that died.
				...(event.fatal ? { status: "error" as const, drafts: [] } : {}),
				items: [
					...state.items,
					{
						kind: "notice",
						id: event.id,
						text: event.text,
						fatal: event.fatal,
					},
				],
			};

		case "system": {
			if (event.subtype !== "init") return state;
			// An init means a live process said hello, which clears a previous
			// failure: restarting a dead session must not leave it looking dead.
			// A turn already in flight keeps its status.
			const settledBefore = state.status === "idle" || state.status === "error";
			return {
				...state,
				status: settledBefore ? "streaming" : state.status,
				// A new process starts its cost count at zero, so the running total
				// must stop measuring deltas against the old one. `costUsd` itself is
				// deliberately untouched — that is the number this fixes.
				costUsdThisRun: 0,
				header: {
					sessionId: event.session_id,
					model: event.model,
					cwd: event.cwd,
					permissionMode: event.permissionMode,
					slashCommands: event.slash_commands,
					skills: event.skills,
					agents: event.agents,
					mcpServers: event.mcp_servers,
				},
			};
		}

		case "assistant": {
			// Each block here is the FINAL form of something we may already be
			// showing as a live draft. Replace the draft in place (so the text
			// doesn't jump to the bottom); append when there was no draft, which is
			// what happens without --include-partial-messages.
			const parentToolUseId = event.parent_tool_use_id;
			let items = state.items;
			let drafts = state.drafts;
			let changed = false;
			let index = 0;
			for (const block of event.message.content) {
				const final = finalizeBlock(
					block,
					`${event.uuid}:${index++}`,
					parentToolUseId,
				);
				if (!final) continue;
				const draftIndex = drafts.findIndex((d) =>
					block.type === "tool_use" ? d.id === block.id : d.type === block.type,
				);
				const draft = draftIndex === -1 ? undefined : drafts[draftIndex];
				const itemIndex = draft
					? items.findIndex((i) => i.id === draft.id)
					: -1;
				if (draft) drafts = drafts.filter((_, n) => n !== draftIndex);
				if (itemIndex === -1) {
					items = [...items, final];
				} else {
					const existing = items[itemIndex];
					items = items.map((item, n) =>
						n === itemIndex ? mergeIntoFinal(existing, final) : item,
					);
				}
				changed = true;
			}
			// Context is measured HERE, per request, not from the result's running
			// totals. A subagent's requests carry their own smaller context and
			// would understate the main conversation, so they don't count.
			const contextTokens = parentToolUseId
				? undefined
				: readAssistantContext(
						(event.message as { usage?: Record<string, unknown> }).usage,
					);
			const usage: SessionUsage | undefined = contextTokens
				? { ...state.usage, contextTokens }
				: state.usage;

			// Subagent messages are excluded for the same reason their context is:
			// they are not what this turn is writing back.
			const turnTokens = parentToolUseId
				? state.turnTokens
				: bankTurnTokens(
						state,
						(event.message as { usage?: Record<string, unknown> }).usage,
					);

			if (
				!changed &&
				drafts === state.drafts &&
				usage === state.usage &&
				turnTokens === state.turnTokens
			) {
				return state;
			}
			return {
				...state,
				status: "streaming",
				items,
				drafts,
				...(usage ? { usage } : {}),
				...(turnTokens ? { turnTokens } : {}),
			};
		}

		case "stream_event":
			return applyStreamDelta(state, event);

		case "user": {
			// Harness-injected turns (background-task notifications and the like)
			// arrive as user events because that is what they are to the model.
			// Rendering one as a prompt pins `<task-notification>` XML to the top
			// of the pane as "the last thing you said". Filtered on the live path
			// as well as the restore path, so a pane looks the same before and
			// after a restart.
			if (isSyntheticUserTurn(event as unknown as Record<string, unknown>)) {
				return state;
			}
			const content = (event.message as { content?: unknown }).content;
			// A stored transcript records real prompts here (often as a bare
			// string); the live stream only ever puts tool_result blocks in a user
			// event, so this branch is what makes history load.
			if (typeof content === "string") {
				return content.trim()
					? withUserMessage(state, event.uuid, content)
					: state;
			}
			if (!Array.isArray(content)) return state;
			const blocks = content as Array<
				ToolResultBlock | TextBlock | { type: string; [key: string]: unknown }
			>;
			const prompt = blocks
				.filter((b): b is TextBlock => b.type === "text")
				.map((b) => b.text)
				.join("\n")
				.trim();
			// A prompt that was only an image still has to appear, or the reply
			// below it reads as an answer to nothing.
			const attachments = blocks
				.filter((b) => b.type === "image")
				.map(transcriptAttachment);
			const base =
				prompt || attachments.length
					? withUserMessage(state, event.uuid, prompt, attachments)
					: state;
			let items = base.items;
			// Explicit predicate: the block union now admits shapes other than
			// text/tool_result (images), so a `!==` check no longer narrows.
			const toolResults = blocks.filter(
				(b): b is ToolResultBlock => b.type === "tool_result",
			);
			for (const block of toolResults) {
				items = items.map((item) =>
					item.kind === "tool" && item.toolUseId === block.tool_use_id
						? {
								...item,
								status: block.is_error ? "error" : "success",
								output: toolResultOutput(block),
							}
						: item,
				);
			}
			return items === base.items ? base : { ...base, items };
		}

		case "rate_limit_event": {
			return {
				...state,
				rateLimit: {
					status: event.rate_limit_info.status,
					resetsAt: event.rate_limit_info.resetsAt,
					rateLimitType: event.rate_limit_info.rateLimitType,
				},
			};
		}

		case "result": {
			// Only the window size comes from here — see readContextWindow for why
			// its token counts can't be used as a context measure.
			const contextWindow = readContextWindow(event.modelUsage);
			const usage: SessionUsage | undefined = state.usage
				? { ...state.usage, ...(contextWindow ? { contextWindow } : {}) }
				: contextWindow
					? { contextTokens: 0, contextWindow }
					: undefined;
			return {
				...state,
				status: event.is_error ? "error" : "done",
				...(usage ? { usage } : {}),
				...accrueCost(state, event.total_cost_usd),
				items: [
					...state.items,
					{
						kind: "result",
						id: event.uuid,
						result: event.result,
						isError: event.is_error,
						costUsd: event.total_cost_usd,
						durationMs: event.duration_ms,
						numTurns: event.num_turns,
					},
				],
			};
		}

		default:
			// Hook lifecycle and status pings carry no timeline change.
			return state;
	}
}

export function buildTimeline(events: ClaudeStreamEvent[]): SessionTimeline {
	return events.reduce(applyEvent, emptyTimeline());
}

/**
 * Mark a timeline as finished — used after folding a transcript read from disk.
 * Stored transcripts carry no `result` event, so the fold would otherwise leave
 * loaded history looking like a turn still in flight.
 */
export function settled(state: SessionTimeline): SessionTimeline {
	if (state.status === "idle" && state.drafts.length === 0) return state;
	return { ...state, status: "idle", drafts: [] };
}

/**
 * Split a flat timeline into top-level items and subagent groups keyed by the
 * Task tool_use id that owns them. The renderer draws each group as one
 * collapsible block. Items whose parentToolUseId is null are top-level.
 */
export function groupSubagents(items: TimelineItem[]): {
	topLevel: TimelineItem[];
	groups: Map<string, TimelineItem[]>;
} {
	const topLevel: TimelineItem[] = [];
	const groups = new Map<string, TimelineItem[]>();
	for (const item of items) {
		const parent =
			item.kind === "user" || item.kind === "result" || item.kind === "notice"
				? null
				: item.parentToolUseId;
		if (parent) {
			const group = groups.get(parent) ?? [];
			group.push(item);
			groups.set(parent, group);
		} else {
			topLevel.push(item);
		}
	}
	return { topLevel, groups };
}
