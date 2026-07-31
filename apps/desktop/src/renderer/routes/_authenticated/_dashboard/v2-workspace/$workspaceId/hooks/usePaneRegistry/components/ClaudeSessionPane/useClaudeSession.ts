/**
 * Renderer-side driver for a Claude Code session pane.
 *
 * Thin by design: all the state lives in `sessionStore` (a module singleton
 * outside the React tree) so the timeline and the transport subscription
 * survive the pane unmounting on every tab switch. This hook just binds a
 * component to one session key via `useSyncExternalStore` and hands back the
 * callbacks the view needs.
 *
 * The session is deliberately left running in main on unmount, the same way
 * terminals persist; closing the pane for good is what calls dispose.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { UserImagePayload } from "shared/claude-session/events";
import type { EffortLevel, SessionMode } from "./SessionComposer";
import { isRestoringTranscript } from "./session-restore";
import {
	ensureSession,
	getSessionSnapshot,
	interruptSession,
	restartSession,
	sendSessionMessage,
	setSessionEffort,
	setSessionMode,
	subscribeSession,
} from "./sessionStore";

interface UseClaudeSessionOptions {
	/** Stable key for this session (the pane id). */
	paneKey: string;
	/** Working directory — the workspace / worktree path. */
	cwd: string;
	model?: string;
	/** Account config dir; omit to use the active switcher profile in main. */
	configDir?: string;
	/** Session id saved on the pane; resumes it and loads its history. */
	resumeSessionId?: string;
	/** Resume into a copy under a fresh id, leaving the original alone. */
	forkSession?: boolean;
	/** Launch details from the user's configured Claude agent preset. */
	binary?: string;
	extraArgs?: string[];
	env?: Record<string, string>;
}

export function useClaudeSession({
	paneKey,
	cwd,
	model,
	configDir,
	resumeSessionId,
	forkSession,
	binary,
	extraArgs,
	env,
}: UseClaudeSessionOptions) {
	const snapshot = useSyncExternalStore(
		useCallback((listener) => subscribeSession(paneKey, listener), [paneKey]),
		useCallback(() => getSessionSnapshot(paneKey), [paneKey]),
	);

	// Idempotent: the first mount subscribes and spawns, later mounts re-attach
	// to the session that's already running.
	useEffect(() => {
		ensureSession(paneKey, {
			cwd,
			model,
			configDir,
			resumeSessionId,
			forkSession,
			binary,
			extraArgs,
			env,
		});
	}, [
		paneKey,
		cwd,
		model,
		configDir,
		resumeSessionId,
		forkSession,
		binary,
		extraArgs,
		env,
	]);

	const send = useCallback(
		(text: string, images?: UserImagePayload[]) =>
			sendSessionMessage(paneKey, text, images),
		[paneKey],
	);
	const interrupt = useCallback(() => interruptSession(paneKey), [paneKey]);
	const restart = useCallback(() => restartSession(paneKey), [paneKey]);
	const setMode = useCallback(
		(mode: SessionMode) => setSessionMode(paneKey, mode),
		[paneKey],
	);
	const setEffort = useCallback(
		(effort: EffortLevel) => setSessionEffort(paneKey, effort),
		[paneKey],
	);

	return {
		timeline: snapshot.timeline,
		mode: snapshot.mode,
		effort: snapshot.effort,
		/** The stored conversation is still being read off disk. */
		restoring: isRestoringTranscript({
			restore: snapshot.restore,
			resumeSessionId,
		}),
		setMode,
		setEffort,
		send,
		interrupt,
		restart,
	};
}
