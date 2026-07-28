/**
 * The full session surface: header + scrollable timeline + composer.
 *
 * Pure and presentational — it takes a `SessionTimeline` plus composer
 * callbacks, so it renders identically from a live stream or a captured
 * transcript, and can be reviewed on a build before the transport/IPC wiring
 * lands. The pane wrapper (next increment) owns the transport and passes these
 * props down.
 */
import { cn } from "@superset/ui/utils";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import type { UserImagePayload } from "shared/claude-session/events";
import type {
	RateLimitInfo,
	SessionTimeline,
	SessionUsage,
} from "shared/claude-session/timeline";
import {
	type EffortLevel,
	type FileMention,
	SESSION_MODES,
	SessionComposer,
	type SessionMode,
} from "./SessionComposer";
import { SessionTimelineView } from "./SessionTimelineView";
import { SessionUsageStrip } from "./SessionUsageStrip";
import { UsageBanner, type UsageLimits } from "./UsageBanner";

interface SessionViewProps {
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
	/** Pane id, so an unsent prompt survives the pane unmounting. */
	draftKey?: string;
	/** Subscription windows for the active account, for the warning banner. */
	limits?: UsageLimits | null;
	onRestart?: () => void;
}

/**
 * The CLI reports rate-limit state on its own channel. Anything other than
 * "allowed" is worth surfacing: otherwise a throttled session just looks slow,
 * and a rejected one looks broken for no visible reason.
 */
function RateLimitChip({ rateLimit }: { rateLimit: RateLimitInfo }) {
	const status = rateLimit.status;
	if (!status || status === "allowed") return null;

	const rejected = status.includes("reject") || status.includes("exceeded");
	// The field is seconds in every capture so far; treat a large value as ms
	// rather than rendering a date in 1970.
	const resetsAt = rateLimit.resetsAt
		? new Date(
				rateLimit.resetsAt > 1e12
					? rateLimit.resetsAt
					: rateLimit.resetsAt * 1000,
			)
		: null;

	return (
		<span
			className={cn(
				"rounded px-1.5 py-0.5 text-[11px]",
				rejected
					? "bg-destructive/10 text-destructive"
					: "bg-warning/10 text-warning",
			)}
			title={
				resetsAt
					? `Rate limit ${status} · resets ${resetsAt.toLocaleString()}`
					: `Rate limit ${status}`
			}
		>
			{rejected ? "Rate limited" : "Approaching limit"}
			{resetsAt
				? ` · resets ${resetsAt.toLocaleTimeString([], {
						hour: "numeric",
						minute: "2-digit",
					})}`
				: ""}
		</span>
	);
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
	return String(count);
}

/**
 * How full the context is after the last turn. Worth showing continuously:
 * running out of context is what explains a long session suddenly behaving
 * differently, and it's invisible until it bites.
 */
function ContextChip({ usage }: { usage: SessionUsage }) {
	const { contextTokens, contextWindow } = usage;
	const ratio = contextWindow ? contextTokens / contextWindow : 0;
	return (
		<span
			className={cn(
				"tabular-nums",
				ratio >= 0.9
					? "text-destructive"
					: ratio >= 0.7
						? "text-warning"
						: "text-muted-foreground/70",
			)}
			title={
				contextWindow
					? `${contextTokens.toLocaleString()} of ${contextWindow.toLocaleString()} context tokens used`
					: `${contextTokens.toLocaleString()} context tokens used`
			}
		>
			{formatTokens(contextTokens)}
			{contextWindow ? ` / ${formatTokens(contextWindow)}` : ""}
		</span>
	);
}

function SessionHeader({
	timeline,
	limits,
}: {
	timeline: SessionTimeline;
	limits?: UsageLimits | null;
}) {
	const header = timeline.header;
	const running = timeline.status === "streaming";
	// Renderer is a browser context — no node:path. Basename by hand (win + posix).
	const folder = header?.cwd
		? (header.cwd
				.replace(/[/\\]+$/, "")
				.split(/[/\\]/)
				.pop() ?? undefined)
		: undefined;
	const connectedMcp =
		header?.mcpServers.filter((s) => s.status === "connected").length ?? 0;
	return (
		<div className="relative flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 text-xs">
			{running ? (
				<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
			) : (
				<span
					className={cn(
						"size-1.5 rounded-full",
						timeline.status === "error" ? "bg-destructive" : "bg-success",
					)}
				/>
			)}
			<span className="font-medium text-foreground">{folder ?? "Session"}</span>

			{/*
			 * The account and its limits sit CENTRED, not in the corner. Which
			 * account is spending, and how much of its window is gone, is the thing
			 * you want to know without hunting — the terminal statusline put it in
			 * front of you and losing that was a real regression.
			 */}
			<div className="pointer-events-none absolute inset-x-0 flex justify-center">
				<SessionUsageStrip limits={limits} costUsd={timeline.costUsd} />
			</div>

			<div className="flex-1" />
			{timeline.rateLimit ? (
				<RateLimitChip rateLimit={timeline.rateLimit} />
			) : null}
			{timeline.usage ? <ContextChip usage={timeline.usage} /> : null}
			{header ? (
				// The CLI's own name for the mode, not the one the user picked from —
				// the composer says "Auto", so a header reading "bypassPermissions"
				// looks like a different setting entirely.
				<span className="text-muted-foreground/70">
					{SESSION_MODES.find((m) => m.id === header.permissionMode)?.label ??
						header.permissionMode}
				</span>
			) : null}
			{connectedMcp > 0 ? (
				<span
					className="text-muted-foreground/70"
					title={`${connectedMcp} MCP server${connectedMcp === 1 ? "" : "s"} connected: ${
						header?.mcpServers
							.filter((s) => s.status === "connected")
							.map((s) => s.name)
							.join(", ") ?? ""
					}`}
				>
					· {connectedMcp} MCP server{connectedMcp === 1 ? "" : "s"}
				</span>
			) : null}
		</div>
	);
}

/**
 * Openers for an empty session.
 *
 * A blank composer asks the user to invent a first move, which is the moment a
 * session is most likely to be abandoned. These are deliberately COMPLETE
 * prompts rather than fragments: clicking one starts the turn, because the
 * composer seeds its text from the draft store only on mount and prefilling
 * after that would need state plumbing this doesn't earn.
 *
 * Kept generic on purpose — nothing here reads the workspace, so a suggestion
 * can't be wrong about what the repo contains.
 */
const STARTER_PROMPTS = [
	"Explain this codebase",
	"What changed on this branch?",
	"Run /review on my current changes",
] as const;

/** Within this many px of the bottom still counts as "following along". */
const STICK_THRESHOLD = 80;

/**
 * Follow the stream, but only while the user is already at the bottom. Scroll
 * up to read something and the view stays put instead of yanking you back down
 * on every token.
 */
function useStickToBottom() {
	const ref = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);

	// No dependency list on purpose: this component only re-renders when the
	// timeline actually changed, and every one of those renders is a moment to
	// re-pin. Writing scrollTop while already at the bottom is a no-op.
	useEffect(() => {
		const el = ref.current;
		if (!el || !stickRef.current) return;
		el.scrollTop = el.scrollHeight;
	});

	const onScroll = () => {
		const el = ref.current;
		if (!el) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		stickRef.current = distance <= STICK_THRESHOLD;
	};

	return { ref, onScroll };
}

export function SessionView({
	timeline,
	mode,
	effort,
	onSend,
	onInterrupt,
	onModeChange,
	onEffortChange,
	onSearchFiles,
	onRunCommand,
	draftKey,
	limits,
	onRestart,
}: SessionViewProps) {
	const isEmpty =
		timeline.items.length === 0 && timeline.status !== "streaming";
	const { ref: scrollRef, onScroll } = useStickToBottom();
	const claudeIcon = usePresetIcon("claude");

	return (
		// `relative`: the composer floats over the timeline rather than docking
		// under it, so the conversation keeps the full pane width behind it.
		<div className="relative flex h-full w-full flex-col bg-background">
			<SessionHeader timeline={timeline} limits={limits} />
			<div
				ref={scrollRef}
				onScroll={onScroll}
				className="min-h-0 flex-1 overflow-y-auto"
			>
				{isEmpty ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
						{/* Claude's own mark, not a generic sparkle — this pane IS Claude
						    Code, and the reference leads with the logo. */}
						{claudeIcon ? (
							<img src={claudeIcon} alt="" className="size-10 opacity-90" />
						) : (
							<Sparkles className="size-8 text-muted-foreground/40" />
						)}
						<p className="text-sm text-muted-foreground">
							Start a Claude Code session
						</p>
						<p className="text-xs text-muted-foreground/60">
							Ask to make changes, @mention files, or run /commands.
						</p>
						<div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
							{STARTER_PROMPTS.map((prompt) => (
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
				) : (
					<SessionTimelineView timeline={timeline} />
				)}
				{timeline.status === "error" && onRestart ? (
					// A dead session isn't a dead pane: the conversation is still on disk,
					// so offer the way back rather than making the user close the tab.
					// It sits at the END of the conversation, where the session stopped,
					// instead of in chrome that would compete with the composer.
					<div className="flex items-center gap-2 px-4 pb-2">
						<button
							type="button"
							onClick={onRestart}
							className="rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							Restart session
						</button>
						<span className="text-xs text-muted-foreground/70">
							Picks the conversation back up where it stopped.
						</span>
					</div>
				) : null}
				{/*
				 * The composer's footprint, as a spacer rather than padding on the
				 * scroller: without it the last row of a finished turn sits under the
				 * card and can't be scrolled to, but padding would also push the
				 * empty state off-centre, since it centres inside the content box.
				 */}
				{isEmpty ? null : <div className="h-32 shrink-0" />}
			</div>
			{/*
			 * A fade where the conversation runs under the composer, so text
			 * dissolves instead of being guillotined by the card's edge. Tall enough
			 * to cover the gap the composer floats over; pointer-events-none so it
			 * never eats a click meant for the last row.
			 */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background via-background/85 to-transparent" />

			{/*
			 * The banner shares the composer's floating column so it sits directly
			 * above the box, where the reference puts it — a warning you read as
			 * you reach to type, rather than a chip in a corner you notice after.
			 */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center px-4 pb-[6.5rem]">
				<UsageBanner limits={limits} />
			</div>
			<SessionComposer
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
				draftKey={draftKey}
			/>
		</div>
	);
}
