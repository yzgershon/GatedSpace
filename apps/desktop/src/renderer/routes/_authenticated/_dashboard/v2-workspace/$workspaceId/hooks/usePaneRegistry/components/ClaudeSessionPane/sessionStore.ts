/**
 * Module-level store for live Claude Code sessions, keyed by pane id.
 *
 * Why this exists: a pane component unmounts every time you switch workspace
 * tabs. Holding the timeline in React state meant coming back to a blank
 * session even though the `claude` process was still alive in main. This store
 * lives outside the React tree, so the subscription and the folded timeline
 * survive unmount and the pane re-attaches instantly on the way back.
 *
 * Main is still the source of truth: it buffers the transcript and replays it
 * on subscribe, so a full window reload rebuilds the same timeline. This store
 * is the fast path (no refold on every tab switch) and the home for UI-only
 * state (mode, effort) that main doesn't track.
 *
 * Consumed via `useSyncExternalStore` — `getSnapshot` returns a stable object
 * identity that only changes when something actually changed.
 */
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type {
	ClaudeStreamEvent,
	UserImagePayload,
} from "shared/claude-session/events";
import {
	applyEvent,
	emptyTimeline,
	type SessionTimeline,
	settled,
} from "shared/claude-session/timeline";
import type { EffortLevel, SessionMode } from "./SessionComposer";

export interface SessionSnapshot {
	timeline: SessionTimeline;
	mode: SessionMode;
	effort: EffortLevel;
}

export interface SessionStartOptions {
	cwd: string;
	model?: string;
	configDir?: string;
	/** Session id from a previous app run; resumes it and loads its history. */
	resumeSessionId?: string;
	/** Resume into a copy under a fresh id, leaving the original alone. */
	forkSession?: boolean;
	/** From the user's Claude agent preset; sanitized in main before argv. */
	binary?: string;
	extraArgs?: string[];
	env?: Record<string, string>;
}

interface SessionEntry {
	snapshot: SessionSnapshot;
	listeners: Set<() => void>;
	subscription: { unsubscribe: () => void } | null;
	/** Guards the async gap while a resumed session's history loads. */
	starting: boolean;
	started: boolean;
	/** Spawn options, kept so a mode change can respawn with the same cwd. */
	options: SessionStartOptions | null;
	/** Effort picked before the session was up; flushed once init lands. */
	pendingEffort: EffortLevel | null;
}

/** Auto by default so edits land — matches how Yish runs Codex. */
const DEFAULT_MODE: SessionMode = "bypassPermissions";
const DEFAULT_EFFORT: EffortLevel = "high";

/** Stable identity for panes whose session hasn't been created yet. */
const EMPTY_SNAPSHOT: SessionSnapshot = {
	timeline: emptyTimeline(),
	mode: DEFAULT_MODE,
	effort: DEFAULT_EFFORT,
};

const entries = new Map<string, SessionEntry>();

function getOrCreateEntry(key: string): SessionEntry {
	let entry = entries.get(key);
	if (!entry) {
		entry = {
			snapshot: EMPTY_SNAPSHOT,
			listeners: new Set(),
			subscription: null,
			starting: false,
			started: false,
			options: null,
			pendingEffort: null,
		};
		entries.set(key, entry);
	}
	return entry;
}

function update(
	key: string,
	next: (snapshot: SessionSnapshot) => SessionSnapshot,
): void {
	const entry = getOrCreateEntry(key);
	const snapshot = next(entry.snapshot);
	if (snapshot === entry.snapshot) return;
	entry.snapshot = snapshot;
	for (const listener of entry.listeners) listener();
}

/**
 * Attach to (and if needed spawn) the session for `key`. Idempotent — safe to
 * call on every mount; only the first call subscribes and starts.
 *
 * Ordering matters: subscribe FIRST so the buffered transcript replays and no
 * live event is missed, then start.
 */
export function ensureSession(key: string, opts: SessionStartOptions): void {
	const entry = getOrCreateEntry(key);
	entry.options = opts;
	if (entry.subscription || entry.starting) return;
	entry.starting = true;

	// Resuming across an app restart: main's replay buffer is gone, so paint the
	// stored transcript first and only then attach. Awaiting before subscribing
	// is safe — the session isn't running yet, there's nothing to miss.
	if (opts.resumeSessionId) {
		const sessionId = opts.resumeSessionId;
		// Cost comes from a sidecar, not the transcript — the CLI writes no cost
		// field there, and its per-result figure restarts at zero in every new
		// process. Fetched alongside history so a restored pane opens showing what
		// the conversation has actually cost rather than starting again at zero.
		void Promise.allSettled([
			electronTrpcClient.claudeSession.history.query({ sessionId }),
			electronTrpcClient.claudeSession.cost.query({ sessionId }),
		])
			.then(([historyResult, costResult]) => {
				const events: ClaudeStreamEvent[] =
					historyResult.status === "fulfilled" ? historyResult.value : [];
				const storedCost =
					costResult.status === "fulfilled" ? costResult.value.costUsd : 0;
				if (events.length === 0 && storedCost <= 0) return;
				update(key, (snapshot) => {
					const folded = events.reduce(applyEvent, snapshot.timeline);
					return {
						...snapshot,
						timeline: settled({
							...folded,
							// The fold cannot know about spend from earlier processes, so
							// the stored total wins over anything it derived. `max` rather
							// than assignment: a pane that has already streamed a turn this
							// run must not be walked backwards.
							...(storedCost > 0
								? { costUsd: Math.max(storedCost, folded.costUsd ?? 0) }
								: {}),
						}),
					};
				});
			})
			.finally(() => {
				attach(key, opts);
			});
		return;
	}

	attach(key, opts);
}

/** Subscribe to the live stream, then spawn. Never call before history loads. */
function attach(key: string, opts: SessionStartOptions): void {
	const entry = getOrCreateEntry(key);
	if (entry.subscription) return;

	entry.subscription = electronTrpcClient.claudeSession.stream.subscribe(
		{ key },
		{
			onData: (event: ClaudeStreamEvent) => {
				update(key, (snapshot) => {
					const timeline = applyEvent(snapshot.timeline, event);
					return timeline === snapshot.timeline
						? snapshot
						: { ...snapshot, timeline };
				});
				// The session is only ready for slash commands once it says hello.
				if (event.type === "system" && event.subtype === "init") {
					flushPendingEffort(key);
				}
			},
		},
	);

	if (!entry.started) {
		entry.started = true;
		void electronTrpcClient.claudeSession.start.mutate({
			key,
			cwd: opts.cwd,
			model: opts.model,
			configDir: opts.configDir,
			resumeSessionId: opts.resumeSessionId,
			forkSession: opts.forkSession,
			permissionMode: entry.snapshot.mode,
			binary: opts.binary,
			extraArgs: opts.extraArgs,
			env: opts.env,
		});
	}
}

export function subscribeSession(
	key: string,
	listener: () => void,
): () => void {
	const entry = getOrCreateEntry(key);
	entry.listeners.add(listener);
	return () => {
		entry.listeners.delete(listener);
	};
}

export function getSessionSnapshot(key: string): SessionSnapshot {
	return entries.get(key)?.snapshot ?? EMPTY_SNAPSHOT;
}

/** Longest tab title worth showing before it stops being readable. */
const TITLE_MAX_LENGTH = 32;

/**
 * A tab label taken from the conversation's opening prompt, so several open
 * sessions are told apart by what they're about rather than all reading
 * "Claude". Undefined until there's a prompt, which leaves the static title in
 * place.
 */
export function getSessionTitle(key: string): string | undefined {
	const first = entries
		.get(key)
		?.snapshot.timeline.items.find((item) => item.kind === "user");
	if (first?.kind !== "user") return undefined;
	const line = first.text.trim().split("\n")[0]?.trim();
	if (!line) return undefined;
	return line.length > TITLE_MAX_LENGTH
		? `${line.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
		: line;
}

export function sendSessionMessage(
	key: string,
	text: string,
	images?: UserImagePayload[],
): void {
	// Main echoes the prompt back as a `local_user_message` event, which is what
	// puts it on the timeline — no optimistic local copy to reconcile.
	void electronTrpcClient.claudeSession.send.mutate({
		key,
		text,
		...(images?.length ? { images } : {}),
	});
}

export function interruptSession(key: string): void {
	void electronTrpcClient.claudeSession.interrupt.mutate({ key });
}

/**
 * Change the permission mode. The CLI has no slash command for this (a real
 * `system/init` lists no `/permissions` or `/mode`), so the process has to
 * respawn — with `--resume <session_id>`, which loads the history silently
 * instead of replaying it, so the conversation carries over and the timeline
 * doesn't duplicate. Before the session is up it's just a spawn-time choice.
 */
export function setSessionMode(key: string, mode: SessionMode): void {
	const entry = getOrCreateEntry(key);
	if (entry.snapshot.mode === mode) return;
	update(key, (snapshot) => ({ ...snapshot, mode }));

	const sessionId = entry.snapshot.timeline.header?.sessionId;
	const options = entry.options;
	if (!entry.started || !sessionId || !options) return;
	// A fresh process comes up at the CLI's default effort — re-apply the
	// slider once the resumed session says hello.
	if (entry.snapshot.effort !== DEFAULT_EFFORT) {
		entry.pendingEffort = entry.snapshot.effort;
	}
	void electronTrpcClient.claudeSession.restart.mutate({
		key,
		cwd: options.cwd,
		model: options.model,
		configDir: options.configDir,
		permissionMode: mode,
		resumeSessionId: sessionId,
		binary: options.binary,
		extraArgs: options.extraArgs,
		env: options.env,
	});
}

/**
 * Push the chosen effort to the CLI. There's no spawn flag for it — the real
 * command is `/effort <low|medium|high|xhigh|max|auto>` (verified against the
 * installed CLI; `ultracode` is accepted too and needs an xhigh-capable model)
 * — so it goes over stdin as a control message. `silent` keeps it from
 * rendering as something the user typed; the CLI's one-line confirmation still
 * shows, which is the feedback you want.
 */
function applyEffort(key: string, effort: EffortLevel): void {
	void electronTrpcClient.claudeSession.send.mutate({
		key,
		text: `/effort ${effort}`,
		silent: true,
	});
}

function flushPendingEffort(key: string): void {
	const entry = entries.get(key);
	if (!entry?.pendingEffort) return;
	const effort = entry.pendingEffort;
	entry.pendingEffort = null;
	applyEffort(key, effort);
}

export function setSessionEffort(key: string, effort: EffortLevel): void {
	const entry = getOrCreateEntry(key);
	if (entry.snapshot.effort === effort) return;
	update(key, (snapshot) => ({ ...snapshot, effort }));

	// Before init the session can't take slash commands yet — hold it.
	if (!entry.snapshot.timeline.header) {
		entry.pendingEffort = effort;
		return;
	}
	applyEffort(key, effort);
}

/**
 * Bring a dead session back. The process is gone (spawn failure, a crash), but
 * the conversation isn't — resuming its session id picks it up where it
 * stopped. Without this a failed session leaves the pane permanently dead and
 * the only way out is closing the tab.
 */
export function restartSession(key: string): void {
	const entry = entries.get(key);
	const options = entry?.options;
	if (!entry || !options) return;
	const sessionId = entry.snapshot.timeline.header?.sessionId;
	void electronTrpcClient.claudeSession.restart.mutate({
		key,
		cwd: options.cwd,
		model: options.model,
		configDir: options.configDir,
		permissionMode: entry.snapshot.mode,
		resumeSessionId: sessionId ?? options.resumeSessionId,
		binary: options.binary,
		extraArgs: options.extraArgs,
		env: options.env,
	});
}

/**
 * What's been typed but not sent, per pane.
 *
 * This lives OUTSIDE React for the same reason the timeline does: the pane
 * unmounts on a tab switch, opening another session, or navigating anywhere
 * else in the app, and component state goes with it. Losing a half-written
 * timeline was a bug worth fixing; losing a half-written PROMPT is worse,
 * because the user typed it and nothing else has a copy.
 *
 * Attachments ride along, since re-picking a screenshot is the same loss.
 */
export interface ComposerDraft {
	text: string;
	images: UserImagePayload[];
}

const EMPTY_DRAFT: ComposerDraft = { text: "", images: [] };
const drafts = new Map<string, ComposerDraft>();
const draftListeners = new Map<string, Set<() => void>>();

export function getSessionDraft(key: string): ComposerDraft {
	return drafts.get(key) ?? EMPTY_DRAFT;
}

export function setSessionDraft(key: string, draft: ComposerDraft): void {
	// Don't hold an entry for an empty box — it'd keep a key alive for every
	// pane that was ever focused and then cleared.
	if (!draft.text && draft.images.length === 0) drafts.delete(key);
	else drafts.set(key, draft);
}

/**
 * Watch a draft for changes made from OUTSIDE the composer.
 *
 * The composer owns its own state and mirrors it out here, so it does not need
 * this for its own edits — only for something else writing into its box, which
 * today means a browser-pane capture being attached to it.
 */
export function subscribeSessionDraft(
	key: string,
	listener: () => void,
): () => void {
	const listeners = draftListeners.get(key) ?? new Set();
	listeners.add(listener);
	draftListeners.set(key, listeners);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) draftListeners.delete(key);
	};
}

/**
 * Attach an image to a session's composer from elsewhere in the app.
 *
 * Goes through the draft store rather than a live component, so it works
 * whether or not that pane is currently mounted: capture a page, switch to the
 * session tab, and the screenshot is already waiting. A pane that has never
 * been opened gets a draft it will pick up the first time it is.
 */
export function attachSessionDraftImage(
	key: string,
	image: UserImagePayload,
): void {
	const current = getSessionDraft(key);
	setSessionDraft(key, { ...current, images: [...current.images, image] });
	for (const listener of draftListeners.get(key) ?? []) listener();
}

/** Called when a pane is closed for good: kill the process, drop the state. */
export function disposeSession(key: string): void {
	drafts.delete(key);
	const entry = entries.get(key);
	if (!entry) return;
	entry.subscription?.unsubscribe();
	entries.delete(key);
	void electronTrpcClient.claudeSession.stop.mutate({ key });
}
