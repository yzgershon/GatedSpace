import { useEffect, useMemo, useRef } from "react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import type { ClaudeAccount } from "renderer/components/ClaudeAccountSwap";
import { SessionTranscriptSkeleton } from "renderer/routes/_authenticated/_dashboard/v2-workspace/components/SessionPaneSkeleton";
import { claudeTaskChanges } from "shared/claude-session/changes";
import type { UserImagePayload } from "shared/claude-session/events";
import type { SessionTimeline } from "shared/claude-session/timeline";
import { ResumeWithAccount } from "./ResumeWithAccount";
import {
	type EffortLevel,
	type FileMention,
	SessionComposer,
	type SessionMode,
} from "./SessionComposer";
import { SessionPermissionRequests } from "./SessionPermissionRequests";
import { SessionTimelineView } from "./SessionTimelineView";
import type { UsageLimits } from "./usage-limits";

interface SessionViewProps {
	fast?: boolean;
	onFastChange?: (fast: boolean) => Promise<void>;
	timeline: SessionTimeline;
	mode: SessionMode;
	effort: EffortLevel;
	onSend: (text: string, images?: UserImagePayload[]) => void;
	onInterrupt: () => void;
	onModeChange: (mode: SessionMode) => void;
	onEffortChange: (effort: EffortLevel) => void;
	onSearchFiles?: (query: string) => Promise<FileMention[]>;
	/** Run a local slash command in the live session, for the palette's panels. */
	onRunCommand?: (command: string) => Promise<string | null>;
	/** `/swap`: move this conversation onto another Claude account. */
	onSwapAccount?: (account: ClaudeAccount) => void;
	/** Which account this pane is pinned to, if it has been swapped. */
	pinnedAccountId?: string | null;
	/** The config dir this pane's process was actually spawned with. */
	accountConfigDir?: string | null;
	/** Pane id, so an unsent prompt survives the pane unmounting. */
	draftKey?: string;
	/** Subscription windows for the active account, for the warning banner. */
	limits?: UsageLimits | null;
	/** Panes sharing this tab. Above one, the header sheds its wider items. */
	paneCount?: number;
	isActive?: boolean;
	onRestart?: () => void;
	/**
	 * The stored transcript is still loading. Distinguishes a resumed session
	 * that hasn't painted yet from a genuinely new one, so the openers below
	 * aren't offered for a conversation that already exists.
	 */
	restoring?: boolean;
}

/** Within this many px of the bottom still counts as following along. */
const STICK_THRESHOLD = 80;

function useStickToBottom(timeline: SessionTimeline, restoring: boolean) {
	const ref = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);

	// Pane focus also re-renders this view. Only new conversation content should
	// move it: scrolling between pointer-down and click can move a tool approval.
	useEffect(() => {
		void timeline;
		void restoring;
		const el = ref.current;
		if (!el || !stickRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [timeline, restoring]);

	const onScroll = () => {
		const el = ref.current;
		if (!el) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		stickRef.current = distance <= STICK_THRESHOLD;
	};

	return { ref, onScroll };
}

export function SessionView({
	fast,
	onFastChange,
	timeline,
	mode,
	effort,
	onSend,
	onInterrupt,
	onModeChange,
	onEffortChange,
	onSearchFiles,
	onRunCommand,
	onSwapAccount,
	pinnedAccountId,
	accountConfigDir,
	draftKey,
	onRestart,
	restoring = false,
}: SessionViewProps) {
	const claudeIcon = usePresetIcon("claude");
	const changes = useMemo(
		() => claudeTaskChanges(timeline.items),
		[timeline.items],
	);
	// Restoring outranks empty: a conversation being read off disk is not an
	// empty one, and offering "Explain this codebase" over a session with a
	// hundred messages in it is actively wrong, not just premature.
	const isEmpty =
		!restoring &&
		timeline.items.length === 0 &&
		!timeline.permissions?.length &&
		timeline.status !== "streaming";
	const { ref: scrollRef, onScroll } = useStickToBottom(timeline, restoring);

	return (
		// The dock reserves the real composer height, including long prompts.
		<div className="relative flex h-full min-h-0 w-full flex-col bg-background">
			<div
				ref={scrollRef}
				onScroll={onScroll}
				className="min-h-0 flex-1 overflow-y-auto"
				style={{ scrollBehavior: "auto" }}
			>
				{isEmpty ? (
					<div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 py-6 text-center">
						{claudeIcon && (
							<img
								src={claudeIcon}
								alt="Claude"
								className="size-10 opacity-90"
							/>
						)}
						<p className="text-sm text-muted-foreground">
							Start a Claude Code session
						</p>
						<p className="text-xs text-muted-foreground/60">
							Ask to make changes, @mention files, or run /commands.
						</p>
						<div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
							{[
								"Explain this codebase",
								"What changed on this branch?",
								"Run /review on my current changes",
							].map((prompt) => (
								<button
									key={prompt}
									type="button"
									onClick={() => onSend(prompt)}
									className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								>
									{prompt}
								</button>
							))}
						</div>
					</div>
				) : restoring && timeline.items.length === 0 ? (
					// Nothing painted yet, but there IS something coming. Once the first
					// rows land this falls through to the real timeline, so the skeleton
					// is never shown over partial content.
					<SessionTranscriptSkeleton />
				) : (
					<SessionTimelineView timeline={timeline} onInterrupt={onInterrupt} />
				)}
				{draftKey && (
					<SessionPermissionRequests
						sessionKey={draftKey}
						requests={timeline.permissions ?? []}
					/>
				)}
				{timeline.status === "error" && onRestart ? (
					// A dead session isn't a dead pane: the conversation is still on disk,
					// so offer the way back rather than making the user close the tab.
					// It sits at the END of the conversation, where the session stopped,
					// instead of in chrome that would compete with the composer.
					//
					// TWO WAYS BACK, because stopping has two reasons. Usually the
					// session died and you want it again; often — the whole reason
					// `/swap` exists — you stopped it BECAUSE the account ran low, and
					// what you want is the same conversation on a different one. That
					// second case used to mean closing the tab and finding the session
					// again in the recent list, so it is offered here rather than left
					// as a slash command you have to know about.
					<div className="flex flex-wrap items-center gap-2 px-4 pb-2">
						<button
							type="button"
							onClick={onRestart}
							className="rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors duration-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							Restart session
						</button>
						{onSwapAccount ? (
							<ResumeWithAccount
								pinnedAccountId={pinnedAccountId}
								runningConfigDir={accountConfigDir}
								onPick={onSwapAccount}
							/>
						) : null}
						<span className="text-xs text-muted-foreground/70">
							Picks the conversation back up where it stopped.
						</span>
					</div>
				) : null}
			</div>
			<SessionComposer
				changes={changes}
				model={timeline.header?.model}
				fast={fast}
				onFastChange={onFastChange}
				status={timeline.status}
				slashCommands={timeline.header?.slashCommands ?? []}
				mode={mode}
				effort={effort}
				onSend={onSend}
				onInterrupt={onInterrupt}
				onModeChange={onModeChange}
				onEffortChange={onEffortChange}
				onSearchFiles={onSearchFiles}
				onRunCommand={onRunCommand}
				onSwapAccount={onSwapAccount}
				pinnedAccountId={pinnedAccountId}
				draftKey={draftKey}
			/>
		</div>
	);
}
