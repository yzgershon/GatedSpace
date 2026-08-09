/**
 * The Claude Code session pane — connects the transport-driven hook to the
 * presentational SessionView.
 *
 * Resolves the workspace worktree path (the session cwd) from `workspaceId`,
 * and GATES spawning the session until that path is known, so `claude` never
 * starts in an empty directory. The pane-registry entry maps
 * RendererContext → these props (paneId from ctx.pane.id, model from pane data).
 *
 * It also reports the live session id back up so the registry can store it on
 * the pane. That's what lets a pane restored after an app restart resume its
 * real conversation instead of opening a blank one.
 */
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useEffect, useState } from "react";
import { useWorkspaceHostTarget } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { SessionPaneSkeleton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/components/SessionPaneSkeleton";
import { SessionView } from "./SessionView";
import type { UsageLimits } from "./usage-limits";
import {
	type ClaudePresetLaunch,
	useClaudePresetLaunch,
} from "./useClaudePresetLaunch";
import { useClaudeSession } from "./useClaudeSession";

export interface ClaudeSessionPaneProps {
	/** Stable pane id (used as the session key in main). */
	paneId: string;
	/** Workspace id — used to resolve the worktree path (session cwd). */
	workspaceId: string;
	/** How many panes share this tab. Above one, the header goes compact. */
	paneCount?: number;
	/** Optional model id; omit for the CLI default. */
	model?: string;
	/** Session id saved on the pane from a previous run, if any. */
	resumeSessionId?: string;
	/** Open a forked copy under a fresh id instead of resuming in place. */
	forkSession?: boolean;
	/** Overrides the workspace worktree path (resumed cross-project sessions). */
	cwdOverride?: string;
	/** Called once the live session id is known, to persist it on the pane. */
	onSessionId?: (sessionId: string) => void;
}

function ClaudeSessionPaneInner({
	paneId,
	workspaceId,
	cwd,
	paneCount,
	model,
	resumeSessionId,
	forkSession,
	launch,
	onSessionId,
}: {
	paneId: string;
	workspaceId: string;
	cwd: string;
	paneCount?: number;
	model?: string;
	resumeSessionId?: string;
	forkSession?: boolean;
	launch: ClaudePresetLaunch;
	onSessionId?: (sessionId: string) => void;
}) {
	const {
		timeline,
		mode,
		effort,
		setMode,
		setEffort,
		send,
		interrupt,
		restart,
		restoring,
	} = useClaudeSession({
		paneKey: paneId,
		cwd,
		model,
		resumeSessionId,
		forkSession,
		binary: launch.binary,
		extraArgs: launch.extraArgs,
		env: launch.env,
	});

	// @mention autocomplete. The CLI reads @paths out of the prompt itself, so
	// this only supplies the picker — typing a path by hand already worked.
	const trpcUtils = workspaceTrpc.useUtils();
	const searchFiles = useCallback(
		async (query: string) => {
			const { matches } = await trpcUtils.filesystem.searchFiles.fetch({
				workspaceId,
				query,
				includeHidden: false,
				limit: 20,
			});
			return matches.map((match) => ({
				name: match.name,
				relativePath: match.relativePath,
			}));
		},
		[trpcUtils, workspaceId],
	);

	/**
	 * Run a local slash command in this session for the palette's panels. Keyed
	 * by pane id, the same key the session was started under — `/context` has to
	 * answer about THIS conversation, which is the whole reason it can't be run
	 * in a throwaway process.
	 */
	const runCommand = useCallback(
		async (command: string) => {
			// `/usage` is about the ACCOUNT, not this conversation, so it goes to a
			// throwaway process instead of the live session. That makes it work
			// while a turn is running — which is exactly when you want to check what
			// a long turn is costing you, and precisely when the live session
			// refuses to answer.
			if (command === "/usage") {
				const report = await electronTrpcClient.usage.refreshLimits
					.mutate({ force: true })
					.catch(() => null);
				return report?.raw ?? null;
			}
			return electronTrpcClient.claudeSession.runCommand
				.mutate({ key: paneId, command })
				.catch(() => null);
		},
		[paneId],
	);

	const sessionId = timeline.header?.sessionId;
	useEffect(() => {
		if (sessionId && sessionId !== resumeSessionId) onSessionId?.(sessionId);
	}, [sessionId, resumeSessionId, onSessionId]);

	/**
	 * Refresh the usage numbers each time a turn settles.
	 *
	 * The panel reads a file written by the CLI's status line, and a headless
	 * session never renders one — so an account used only through this pane sat
	 * at 0% forever. Asking the CLI for `/usage` fills it in. That call is
	 * answered locally (`turns=0 cost=0`), so this spends nothing and sends
	 * nothing; main throttles it to once a minute per profile regardless.
	 */
	const status = timeline.status;
	const [limits, setLimits] = useState<UsageLimits | null>(null);
	useEffect(() => {
		if (status === "streaming") return;
		let current = true;
		void electronTrpcClient.usage.refreshLimits
			.mutate({})
			// Read back afterwards rather than from the refresh's own return: the
			// refresh is throttled and returns null when it declines, and a warning
			// that blanks itself every other turn is worse than a slightly old one.
			.then(() => electronTrpcClient.usage.activeLimits.query())
			.then((next) => {
				if (current) setLimits(next);
			})
			.catch(() => {
				// Best effort: a stale number is worth less than a broken pane.
			});
		return () => {
			current = false;
		};
	}, [status]);

	return (
		<SessionView
			timeline={timeline}
			mode={mode}
			effort={effort}
			onSend={send}
			onInterrupt={interrupt}
			onModeChange={setMode}
			onEffortChange={setEffort}
			onSearchFiles={searchFiles}
			onRunCommand={runCommand}
			draftKey={paneId}
			limits={limits}
			paneCount={paneCount}
			onRestart={restart}
			restoring={restoring}
		/>
	);
}

export function ClaudeSessionPane({
	paneId,
	workspaceId,
	paneCount,
	model,
	resumeSessionId,
	forkSession,
	cwdOverride,
	onSessionId,
}: ClaudeSessionPaneProps) {
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspaceId },
		{ staleTime: 30_000 },
	);
	// A session resumed from the recent list carries its own project directory;
	// running it in this workspace's worktree would resume the conversation
	// against the wrong tree.
	const cwd = cwdOverride ?? workspaceQuery.data?.worktreePath;
	// Both gates matter: spawning before the cwd resolves would run claude in
	// the wrong directory, and spawning before the preset resolves would
	// silently ignore the user's configured launch.
	const { launch, ready: launchReady } = useClaudePresetLaunch();
	const hostTarget = useWorkspaceHostTarget(workspaceId);

	// This pane spawns claude in the desktop's own process. For a workspace that
	// lives on another machine that would run the wrong binary against a path
	// that means something different here — quietly doing the wrong thing. The
	// terminal goes through the host, so it still works.
	if (hostTarget.status === "ready" && hostTarget.kind === "remote") {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
				<p className="text-sm text-muted-foreground">
					Session panes only run on this machine
				</p>
				<p className="text-xs text-muted-foreground/60">
					This workspace lives on another host. Open a Claude terminal instead —
					it runs there.
				</p>
			</div>
		);
	}

	// Resolving the worktree path and the launch preset. Shaped like the pane
	// that is about to appear rather than centred text: this is the first thing
	// on screen when the app reopens a saved session, and a lone "Loading…"
	// there is what made a launch look like it had failed.
	if (!cwd || !launchReady) {
		return <SessionPaneSkeleton className="h-full" />;
	}

	return (
		<ClaudeSessionPaneInner
			paneId={paneId}
			workspaceId={workspaceId}
			cwd={cwd}
			paneCount={paneCount}
			model={model}
			resumeSessionId={resumeSessionId}
			forkSession={forkSession}
			launch={launch}
			onSessionId={onSessionId}
		/>
	);
}
