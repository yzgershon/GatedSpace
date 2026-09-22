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
import {
	clearSessionActivity,
	publishSessionActivity,
} from "renderer/stores/session-activity";
import { useV2NotificationStore } from "renderer/stores/v2-notifications";
import type {
	ClaudeStreamEvent,
	UserImagePayload,
} from "shared/claude-session/events";
import {
	applyEvent,
	emptyTimeline,
	lastFinishedTurnId,
	type SessionTimeline,
	settled,
} from "shared/claude-session/timeline";
import {
	EFFORT_LABELS,
	type EffortLevel,
	SESSION_MODES,
	type SessionMode,
} from "./SessionComposer";
import {
	forgetPinnedAccount,
	getPinnedAccount,
	type PinnedAccount,
	setPinnedAccount,
} from "./session-account";
import type { SessionRestoreState } from "./session-restore";

export interface SessionSnapshot {
	fast: boolean;
	timeline: SessionTimeline;
	mode: SessionMode;
	effort: EffortLevel;
	/** Progress of the stored-transcript load. See SessionRestoreState. */
	restore: SessionRestoreState;
	/**
	 * The config dir the RUNNING process was actually spawned with.
	 *
	 * Reported back by main, which resolves it, rather than guessed here. The
	 * header chip used to fall back to the current global default whenever a
	 * pane had no `/swap` pin — true at the instant of spawn and false forever
	 * after, so changing the default from the profile menu renamed the chip on a
	 * pane whose process had not moved. This is the fact that replaces that
	 * guess; null means nothing has spawned yet, and the chip says nothing
	 * rather than inventing an answer.
	 */
	accountConfigDir: string | null;
}

export interface SessionStartOptions {
	workspaceId?: string;
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
	/** Explicit choice from /model, retained across pane remounts and respawns. */
	modelOverride?: string;
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

/**
 * What the CLI itself boots at. A FACT about the binary, not a preference.
 *
 * Kept separate from our own default below, because the two answer different
 * questions and one constant was being used for both: "what does the slider
 * start on" and "does the running process already agree with the slider". Once
 * those diverge, conflating them means the UI shows one effort while the CLI
 * runs another, with nothing to reveal it.
 */
const CLI_DEFAULT_EFFORT: EffortLevel = "high";

/** Where the slider starts. Above the CLI's own default, deliberately. */
const DEFAULT_EFFORT: EffortLevel = "xhigh";

/** Stable identity for panes whose session hasn't been created yet. */
const EMPTY_SNAPSHOT: SessionSnapshot = {
	fast: false,
	timeline: emptyTimeline(),
	mode: DEFAULT_MODE,
	effort: DEFAULT_EFFORT,
	restore: null,
	accountConfigDir: null,
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
	// Mirror the pane's status out to whoever draws the dots. Every snapshot
	// change funnels through here, so this one call covers streaming, results,
	// fatal notices and restarts alike; `publishSessionActivity` drops the ones
	// that changed nothing, so a token-by-token stream doesn't repaint the tabs.
	publishSessionActivity(key, {
		status: snapshot.timeline.status,
		turnKey: lastFinishedTurnId(snapshot.timeline),
	});
	for (const listener of entry.listeners) listener();
}

/** Move a pane's restore state, notifying subscribers. */
function setRestore(key: string, restore: SessionRestoreState): void {
	update(key, (snapshot) =>
		snapshot.restore === restore ? snapshot : { ...snapshot, restore },
	);
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
	const hadCwd = entry.options?.cwd;
	/*
	 * A `/swap` pin outranks the caller's account, and it has to be re-applied
	 * HERE rather than only at swap time.
	 *
	 * `ensureSession` runs on every mount and assigns `options` wholesale, so a
	 * pin written into `options` alone would be overwritten the next time the
	 * pane remounted — a tab switch would quietly walk the session back onto the
	 * global account while the header still named the swapped one. Re-reading
	 * the pin on every call is what makes the swap stick.
	 */
	const pinned = getPinnedAccount(key);
	entry.options = pinned ? { ...opts, configDir: pinned.configDir } : opts;
	if (entry.modelOverride)
		entry.options = { ...entry.options, model: entry.modelOverride };
	/*
	 * The cwd is readable the moment it is known, before any event arrives.
	 *
	 * `options` is not part of the snapshot, so assigning it notifies nobody.
	 * That is fine for everything else here, which is only read at spawn time —
	 * but the header's folder chip subscribes to this store and would otherwise
	 * sit blank until some unrelated update happened to notify it.
	 */
	if (opts.cwd !== hadCwd) {
		for (const listener of entry.listeners) listener();
	}
	if (entry.subscription || entry.starting) return;
	entry.starting = true;

	// Resuming across an app restart: main's replay buffer is gone, so paint the
	// stored transcript first and only then attach. Awaiting before subscribing
	// is safe — the session isn't running yet, there's nothing to miss.
	if (opts.resumeSessionId) {
		const sessionId = opts.resumeSessionId;
		setRestore(key, "loading");
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
				// Before attach, not after: attach spawns the process, and the pane
				// should stop showing a skeleton the moment the stored transcript is
				// on screen rather than waiting on the CLI to say hello.
				setRestore(key, "done");
				attach(key, opts);
			});
		return;
	}

	setRestore(key, "done");
	attach(key, opts);
}

/**
 * Record which account the process actually came up on.
 *
 * Main resolves it — `configDir` is optional at every call site, and when it is
 * omitted the account is whatever the global setting resolved to AT THAT
 * INSTANT. Nothing in the renderer can reconstruct that afterwards, which is
 * exactly why the header chip used to answer with the current default and
 * drift. Now the spawn hands the answer back and the pane holds onto it.
 *
 * Failures are swallowed: a rejected spawn already surfaces as a session error
 * in the timeline, and an unhandled rejection here would be a second, uglier
 * report of the same thing.
 */
function recordSpawnedAccount(
	key: string,
	call: Promise<{ configDir?: string }>,
): void {
	void call
		.then((result) => {
			if (!result?.configDir) return;
			update(key, (snapshot) =>
				snapshot.accountConfigDir === result.configDir
					? snapshot
					: { ...snapshot, accountConfigDir: result.configDir ?? null },
			);
		})
		.catch(() => {});
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
		// The slider's default sits ABOVE the CLI's, so a brand new session has
		// to be told — there is no spawn flag for effort. Without this the pane
		// would display xhigh while the process ran at high, which is worse than
		// having no default at all. Queued rather than sent: the CLI only accepts
		// slash commands once it has said hello.
		if (entry.snapshot.effort !== CLI_DEFAULT_EFFORT) {
			entry.pendingEffort = entry.snapshot.effort;
		}
		recordSpawnedAccount(
			key,
			electronTrpcClient.claudeSession.start.mutate({
				key,
				cwd: opts.cwd,
				workspaceId: opts.workspaceId,
				model: entry.modelOverride ?? opts.model,
				// `entry.options` carries the `/swap` pin; `opts` is what the pane
				// asked for. Spawning from the former is what binds a restored pane
				// to the account it was swapped onto.
				configDir: entry.options?.configDir ?? opts.configDir,
				resumeSessionId: opts.resumeSessionId,
				forkSession: opts.forkSession,
				permissionMode: entry.snapshot.mode,
				binary: opts.binary,
				extraArgs: opts.extraArgs,
				env: opts.env,
				fast: entry.snapshot.fast,
			}),
		);
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

/**
 * Where this session is running.
 *
 * The SPAWN option first, the CLI's `system:init` header second — deliberately
 * that order. The header only exists once a live process has said hello, so a
 * session that is still starting, or one whose transcript was replayed from
 * disk without an init, has no header and reported no directory at all. That is
 * why the pane header showed a name and no folder. The spawn cwd is known
 * before the process is, and is the same value the CLI reports back.
 */
export function getSessionCwd(key: string): string | undefined {
	const entry = entries.get(key);
	return entry?.options?.cwd ?? entry?.snapshot.timeline.header?.cwd;
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

/**
 * The LAST thing you asked this pane, one line, clipped.
 *
 * `getSessionTitle` deliberately takes the FIRST prompt, because a tab's label
 * should not change under you mid-session. The sidebar wants the opposite: the
 * question is "what is this pane doing right now", and the answer is whatever
 * you asked it most recently.
 *
 * A primitive return on purpose — this feeds `useSyncExternalStore`, and an
 * object rebuilt per call would re-render forever.
 */
export function getSessionLastPrompt(key: string): string | undefined {
	const items = entries.get(key)?.snapshot.timeline.items;
	if (!items) return undefined;
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (item?.kind !== "user") continue;
		const line = item.text.trim().split("\n")[0]?.trim();
		if (!line) continue;
		return line.length > TITLE_MAX_LENGTH
			? `${line.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
			: line;
	}
	return undefined;
}

/**
 * Whether this session is blocked on a rate limit.
 *
 * `rateLimit.status` is a raw string from the CLI, so this matches the one
 * value that means "stopped" and treats everything else — including values
 * added later — as fine. Guessing the other way would paint a red dot on a
 * healthy session every time the CLI grew a new status.
 */
export function isSessionRateLimited(key: string): boolean {
	const status = entries.get(key)?.snapshot.timeline.rateLimit?.status;
	return typeof status === "string" && status.toLowerCase().includes("reject");
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
	addSwitchMarker(
		key,
		`Switched to ${SESSION_MODES.find((m) => m.id === mode)?.label ?? mode}`,
	);

	const sessionId = entry.snapshot.timeline.header?.sessionId;
	const options = entry.options;
	if (!entry.started || !sessionId || !options) return;
	// A fresh process comes up at the CLI's default effort — re-apply the
	// slider once the resumed session says hello.
	if (entry.snapshot.effort !== CLI_DEFAULT_EFFORT) {
		entry.pendingEffort = entry.snapshot.effort;
	}
	recordSpawnedAccount(
		key,
		electronTrpcClient.claudeSession.restart.mutate({
			key,
			cwd: options.cwd,
			workspaceId: options.workspaceId,
			model: options.model,
			configDir: options.configDir,
			permissionMode: mode,
			resumeSessionId: sessionId,
			binary: options.binary,
			extraArgs: options.extraArgs,
			env: options.env,
			fast: entry.snapshot.fast,
		}),
	);
}

/**
 * Which Claude account this pane is running on, if it has been swapped.
 *
 * Null means "whatever the global setting resolves to", which is what a pane
 * that has never been swapped is doing. The header chip renders the global
 * account's name in that case, so the answer on screen is always a concrete
 * account rather than the word "auto".
 */
export function getSessionAccount(key: string): PinnedAccount | null {
	return getPinnedAccount(key);
}

/**
 * `/swap` — move THIS conversation onto another Claude account.
 *
 * The mechanism is the one a permission-mode change already uses: the account
 * is bound at spawn via CLAUDE_CONFIG_DIR, so the process has to come back up,
 * and `--resume <session_id>` carries the conversation across silently rather
 * than replaying it into the timeline.
 *
 * **Resuming across accounts needs the transcript to be reachable from the new
 * account's config dir.** Claude Code stores transcripts under
 * `<configDir>/projects`, so this works when those directories are shared (a
 * junction, which is the standard multi-account setup) and does not when they
 * are separate — the CLI then starts a fresh session instead of failing, which
 * would be silent. Hence the marker below states which account it moved to and
 * the caller is told to expect a new session id if the stores are separate:
 * a swap that quietly loses your history would be worse than no swap at all.
 *
 * Before the session is up there is nothing to restart, so the pin alone is
 * enough — the pending spawn reads it.
 */
export function swapSessionAccount(key: string, account: PinnedAccount): void {
	const entry = getOrCreateEntry(key);
	const current = getPinnedAccount(key);
	if (current?.configDir === account.configDir) return;

	/*
	 * Already RUNNING on it, just not pinned to it.
	 *
	 * A pane with no pin follows the global default, so picking the account it
	 * happens to be on is a real request — it stops the pane drifting when the
	 * default next changes — but it is not a reason to kill and respawn the
	 * process, and a "switched to X" marker under a conversation that did not
	 * move would be a lie. Pin it and leave it alone.
	 */
	if (!current && entry.snapshot.accountConfigDir === account.configDir) {
		setPinnedAccount(key, account);
		const opts = entry.options;
		if (opts) entry.options = { ...opts, configDir: account.configDir };
		return;
	}

	setPinnedAccount(key, account);
	const options = entry.options;
	if (options) entry.options = { ...options, configDir: account.configDir };

	/*
	 * Say it if a reply died for this.
	 *
	 * The account is bound at spawn, so the process has to come back up, and a
	 * turn in flight does not survive that. It is NOT a reason to refuse the
	 * swap — hitting a limit mid-answer is the commonest reason to want one —
	 * but the partial reply left on screen looks like the model stopping for its
	 * own reasons unless the marker under it says otherwise.
	 */
	const wasStreaming = entry.snapshot.timeline.status === "streaming";
	addSwitchMarker(
		key,
		wasStreaming
			? `Switched to the ${account.label} account — the reply in progress was cut off`
			: `Switched to the ${account.label} account`,
	);

	const sessionId = entry.snapshot.timeline.header?.sessionId;
	if (!entry.started || !options) return;
	// A fresh process comes up at the CLI's default effort — re-apply the
	// slider once the session says hello, the same as a mode change does.
	if (entry.snapshot.effort !== CLI_DEFAULT_EFFORT) {
		entry.pendingEffort = entry.snapshot.effort;
	}
	recordSpawnedAccount(
		key,
		electronTrpcClient.claudeSession.restart.mutate({
			key,
			cwd: options.cwd,
			workspaceId: options.workspaceId,
			model: options.model,
			configDir: account.configDir,
			permissionMode: entry.snapshot.mode,
			resumeSessionId: sessionId ?? options.resumeSessionId,
			binary: options.binary,
			extraArgs: options.extraArgs,
			env: options.env,
			fast: entry.snapshot.fast,
		}),
	);
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

/**
 * Mark a boundary in the transcript: everything below it ran differently.
 *
 * Session-local by design. It records a choice the USER made in this window,
 * not something the CLI reported, so it is not in main's replay buffer and does
 * not survive a reload. Persisting it would mean inventing transcript entries
 * the CLI never wrote, which is a worse trade than a marker that fades with the
 * session it describes.
 */
function addSwitchMarker(key: string, text: string): void {
	update(key, (snapshot) => ({
		...snapshot,
		timeline: {
			...snapshot.timeline,
			items: [
				...snapshot.timeline.items,
				{
					kind: "notice" as const,
					// Distinct per marker so React keeps them apart when the same
					// setting is changed back and forth.
					id: `switch-${snapshot.timeline.items.length}-${text}`,
					text,
					divider: true,
				},
			],
		},
	}));
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
	addSwitchMarker(key, `Effort set to ${EFFORT_LABELS[effort]}`);

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
	recordSpawnedAccount(
		key,
		electronTrpcClient.claudeSession.restart.mutate({
			key,
			cwd: options.cwd,
			workspaceId: options.workspaceId,
			model: options.model,
			configDir: options.configDir,
			permissionMode: entry.snapshot.mode,
			resumeSessionId: sessionId ?? options.resumeSessionId,
			binary: options.binary,
			extraArgs: options.extraArgs,
			env: options.env,
			fast: entry.snapshot.fast,
		}),
	);
}

import { deleteSessionDraft } from "./composer-draft";

export {
	appendSessionDraftText,
	attachSessionDraftImage,
	type ComposerDraft,
	deleteSessionDraft,
	getSessionDraft,
	setSessionDraft,
	subscribeSessionDraft,
} from "./composer-draft";

/** Called when a pane is closed for good: kill the process, drop the state. */
export function disposeSession(key: string): void {
	// The pane is gone for good, so its persisted draft goes with it — otherwise
	// `localStorage` accumulates a key per pane ever opened.
	deleteSessionDraft(key);
	// Ahead of the early return below, and unconditional: a pane can carry a
	// published status and a seen mark without still holding a live entry, and
	// leaving either behind means a closed pane's dot is counted forever by the
	// workspace and dock badges.
	clearSessionActivity(key);
	// The account pin is stored per pane id and outlives the window on purpose,
	// so a closed pane has to drop it or `localStorage` keeps a row for every
	// pane ever swapped — the same reason the draft is deleted above.
	forgetPinnedAccount(key);
	useV2NotificationStore.getState().pruneSessionSeen(key);
	const entry = entries.get(key);
	if (!entry) return;
	entry.subscription?.unsubscribe();
	entries.delete(key);
	void electronTrpcClient.claudeSession.stop.mutate({ key });
}

/** Called only after the CLI acknowledges a /model command. */
export function recordSessionModel(key: string, model: string): void {
	const entry = getOrCreateEntry(key);
	entry.modelOverride = model;
	if (entry.options) entry.options = { ...entry.options, model };
	update(key, (snapshot) => ({
		...snapshot,
		timeline: {
			...snapshot.timeline,
			header: snapshot.timeline.header
				? { ...snapshot.timeline.header, model }
				: undefined,
		},
	}));
}

/** Fast is opt-in per session. Only display success after the CLI acknowledges it. */
export async function setSessionFast(
	key: string,
	fast: boolean,
): Promise<void> {
	const entry = getOrCreateEntry(key);
	if (entry.snapshot.timeline.status === "streaming")
		throw new Error("Wait for Claude to finish before changing speed.");
	const reply = await electronTrpcClient.claudeSession.runCommand.mutate({
		key,
		command: `/fast ${fast ? "on" : "off"}`,
	});
	if (
		!reply ||
		!new RegExp(`fast mode\\s+(?:is\\s+)?${fast ? "on" : "off"}`, "i").test(
			reply,
		)
	) {
		throw new Error(
			reply ||
				"Claude did not confirm the speed change. Try again when the session is ready.",
		);
	}
	update(key, (snapshot) => ({ ...snapshot, fast }));
}
