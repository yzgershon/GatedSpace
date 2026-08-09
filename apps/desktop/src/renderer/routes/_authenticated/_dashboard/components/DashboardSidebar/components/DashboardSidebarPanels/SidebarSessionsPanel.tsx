/**
 * Recent sessions, as a sidebar panel.
 *
 * Laid out like the editor's: title, a way to start a new one, a provider
 * toggle, a search field, then one flat list of title + relative time. Nothing
 * here is workspace-aware — it's a global list you act on — which is exactly
 * what made it awkward as a pane taking half a workspace.
 *
 * THE IMPORTANT PART IS THE LIVENESS CHECK. A session a terminal is already
 * holding must not be plain-resumed: two writers on one session id silently
 * destroy the newer transcript, which happened on 7/18 and again on 7/19. The
 * check has two sources — the desktop's own pane sessions, and the host's
 * terminal bindings — and the host is only reachable from here through a
 * standalone client.
 *
 * When that client can't answer, sessions are treated as UNVERIFIABLE and
 * offered as a fork. Failing safe costs a new session id. Failing open costs a
 * conversation.
 */

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { Input } from "@superset/ui/input";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
	Copy,
	Pencil,
	Play,
	Search,
	Terminal as TerminalIcon,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { getHostTrpcClient } from "renderer/lib/host-trpc-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	type AgentSessionProvider,
	formatRelativeTime,
	liveSessionKeys,
	projectNameFor,
	resumeCommandFor,
	type SessionDateGroup,
	sessionDateGroup,
} from "./session-list-helpers";

export type { AgentSessionProvider } from "./session-list-helpers";
export {
	formatRelativeTime,
	liveSessionKeys,
	resumeCommandFor,
} from "./session-list-helpers";

export interface SidebarSessionOpenRequest {
	provider: AgentSessionProvider;
	sessionId: string;
	cwd: string | null;
	title: string;
	/** "fork" when a plain resume would risk a second writer. */
	mode: "resume" | "fork";
}

const PROVIDERS: { id: AgentSessionProvider; label: string }[] = [
	{ id: "claude", label: "Claude" },
	{ id: "codex", label: "Codex" },
];

export function SidebarSessionsPanel({
	onOpenSession,
	onNewSession,
	onResumeInTerminal,
}: {
	onOpenSession: (request: SidebarSessionOpenRequest) => void;
	onNewSession?: () => void;
	/**
	 * Runs the resume command in a real terminal pane. Optional so the panel
	 * still renders anywhere it is mounted without a workspace to put one in;
	 * the menu item is simply absent there rather than failing on click.
	 */
	onResumeInTerminal?: (request: {
		command: string;
		cwd: string | null;
		title: string;
		provider: AgentSessionProvider;
	}) => void;
}) {
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState<AgentSessionProvider>("claude");
	/** Session currently being renamed inline, and the text in its field. */
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	/**
	 * Which session's rename field has already been focused, so the ref callback
	 * does its work once instead of on every render. See the input for what that
	 * cost when it was missing.
	 */
	const renameFocusedFor = useRef<string | null>(null);
	/**
	 * Guards against committing the same rename twice.
	 *
	 * Enter commits and then closes the field; depending on how focus unwinds,
	 * the blur handler can fire on the way out and commit a second time. The
	 * second write is the same value so nothing is corrupted, but it costs a
	 * round trip and a refetch, and it makes the list flicker back through the
	 * old title on the way.
	 */
	const committingRename = useRef<string | null>(null);
	/**
	 * Delete is two clicks, not one.
	 *
	 * The trash sits next to Copy in a hover strip, and these rows are small.
	 * One click there should not be able to take a conversation away, even with
	 * the Recycle Bin behind it — the second click is what makes it a decision.
	 */
	const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
		null,
	);
	const { activeHostUrl } = useLocalHostService();
	const { copyToClipboard } = useCopyToClipboard();
	/*
	 * No copied-tick state any more. It existed to flash a checkmark on the row's
	 * copy button, and that button is gone — copying is a context-menu item now,
	 * and the menu closes on select, so there is nothing left on screen to put a
	 * tick on.
	 */
	const copyResumeCommand = useCallback(
		async (command: string) => {
			await copyToClipboard(command);
		},
		[copyToClipboard],
	);

	const sessions = useQuery({
		queryKey: ["sidebar-agent-sessions", provider],
		queryFn: () =>
			electronTrpcClient.claudeSessions.list.query({ limit: 60, provider }),
		refetchOnWindowFocus: true,
		staleTime: 15_000,
	});

	// The host's terminal bindings. `null` on failure or with no host — the
	// distinction between "nothing is live" and "we don't know" is the point.
	const bindings = useQuery({
		queryKey: ["sidebar-host-bindings", activeHostUrl],
		queryFn: async () => {
			const client = getHostTrpcClient(activeHostUrl);
			if (!client) return null;
			return client.terminalAgents.list.query();
		},
		refetchInterval: 10_000,
		refetchOnWindowFocus: true,
	});

	const paneSessions = useQuery({
		queryKey: ["sidebar-pane-sessions"],
		queryFn: () => electronTrpcClient.claudeSession.liveSessionIds.query(),
		refetchInterval: 10_000,
		refetchOnWindowFocus: true,
	});

	const liveKeys = useMemo(
		() => liveSessionKeys(bindings.data ?? null, paneSessions.data ?? null),
		[bindings.data, paneSessions.data],
	);

	const commitRename = useCallback(
		async (sessionId: string, draft: string, previous: string) => {
			// Enter closes the field, and blur can then fire on the way out. Both
			// call this. Without the guard the same rename is written twice and the
			// list refetches twice, which shows as the old title flashing back.
			if (committingRename.current === sessionId) return;
			committingRename.current = sessionId;

			setRenamingId(null);
			renameFocusedFor.current = null;
			const next = draft.trim();
			if (next === previous.trim()) {
				committingRename.current = null;
				return;
			}
			try {
				await electronTrpcClient.claudeSessions.rename.mutate({
					sessionId,
					// Empty hands the session back to its generated title, which is the
					// only way to undo a rename.
					title: next ? next : null,
				});
				await sessions.refetch();
			} finally {
				committingRename.current = null;
			}
		},
		[sessions],
	);

	const deleteSession = useCallback(
		async (sessionId: string) => {
			setConfirmingDeleteId(null);
			await electronTrpcClient.claudeSessions.remove.mutate({
				provider,
				sessionId,
			});
			await sessions.refetch();
		},
		[provider, sessions],
	);

	/**
	 * Content search, debounced and separate from the instant title filter.
	 *
	 * Typing filters titles locally with no latency at all; this runs behind it
	 * and adds sessions whose TRANSCRIPT matches. Two mechanisms rather than one
	 * because they have different costs: a title filter is free, and a content
	 * scan reads files off disk and cannot keep up with a keystroke.
	 *
	 * Under three characters it does not run — a two-letter query matches almost
	 * every transcript and costs a full scan to prove it.
	 */
	const [debouncedQuery, setDebouncedQuery] = useState("");
	useEffect(() => {
		const trimmed = query.trim();
		if (trimmed.length < 3) {
			setDebouncedQuery("");
			return;
		}
		const timer = setTimeout(() => setDebouncedQuery(trimmed), 250);
		return () => clearTimeout(timer);
	}, [query]);

	const contentMatches = useQuery({
		queryKey: ["sidebar-session-content", provider, debouncedQuery],
		queryFn: () =>
			electronTrpcClient.claudeSessions.searchContent.query({
				query: debouncedQuery,
				provider,
			}),
		enabled: debouncedQuery.length >= 3,
		// The transcripts on disk do not change because the window regained focus,
		// and re-scanning hundreds of files on every focus event would be felt.
		refetchOnWindowFocus: false,
		staleTime: 60_000,
	});

	const filtered = useMemo(() => {
		const list = sessions.data ?? [];
		const q = query.trim().toLowerCase();
		if (!q) return list;
		const inContent = new Set(contentMatches.data ?? []);
		return list.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				(s.cwd ?? "").toLowerCase().includes(q) ||
				inContent.has(s.sessionId),
		);
	}, [sessions.data, query, contentMatches.data]);

	/**
	 * The list with a header inserted wherever the dated bucket changes.
	 *
	 * Computed here rather than in the render so the grouping is decided once per
	 * data change instead of once per render, and so `now` is captured a single
	 * time — reading the clock per row can put two sessions a millisecond apart
	 * into different days.
	 */
	const grouped = useMemo(() => {
		const now = Date.now();
		const rows: (
			| { kind: "header"; label: SessionDateGroup }
			| { kind: "session"; session: (typeof filtered)[number] }
		)[] = [];
		let current: SessionDateGroup | null = null;
		for (const session of filtered) {
			const group = sessionDateGroup(session.lastModified, now);
			if (group !== current) {
				current = group;
				rows.push({ kind: "header", label: group });
			}
			rows.push({ kind: "session", session });
		}
		return rows;
	}, [filtered]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground/60">
				Recent sessions
			</div>

			{onNewSession ? (
				<button
					type="button"
					onClick={onNewSession}
					className="mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<span className="text-muted-foreground">+</span>
					New session
				</button>
			) : null}

			<div className="mx-2 mt-2 flex rounded-md bg-muted/60 p-0.5">
				{PROVIDERS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						onClick={() => setProvider(entry.id)}
						className={cn(
							"flex-1 rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none",
							provider === entry.id
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{entry.label}
					</button>
				))}
			</div>

			<div className="relative mx-2 mt-2">
				<Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search sessions…"
					className="h-7 pl-7 text-xs"
				/>
			</div>

			<div className="mt-1 min-h-0 flex-1 overflow-y-auto py-1">
				{sessions.isLoading ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
				) : filtered.length === 0 ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">
						{query ? "No matches." : "No sessions yet."}
					</p>
				) : (
					grouped.map((row) => {
						if (row.kind === "header") {
							return (
								<div
									key={`header:${row.label}`}
									/*
									 * Sticky, so the bucket you are looking at is still named
									 * once you have scrolled a screen into it. The background is
									 * opaque rather than a blur: rows pass UNDER this, and a
									 * translucent header over 13px text reads as a rendering
									 * fault.
									 */
									className="sticky top-0 z-10 bg-sidebar px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60 first:pt-1"
								>
									{row.label}
								</div>
							);
						}
						const session = row.session;
						const key = `${provider}:${session.sessionId}`;
						const project = projectNameFor(session.cwd);
						// Unknown (null) is treated exactly like live: fork.
						const live = liveKeys === null || liveKeys.has(key);
						const resumeCommand = resumeCommandFor(
							provider,
							session.sessionId,
							live,
						);
						if (renamingId === session.sessionId) {
							return (
								<div
									key={session.sessionId}
									className="flex items-center px-3 py-1"
								>
									<input
										/*
										 * Focus and select EXACTLY ONCE, when the field first
										 * appears.
										 *
										 * This used to be a bare inline callback that called
										 * focus() and select() with no guard. React re-creates an
										 * inline ref on every render and re-invokes it, so every
										 * keystroke ran select() again: type a character, the
										 * whole value gets selected, the next character replaces
										 * all of it. Renaming was unusable — it looked like the
										 * field was fighting you, and whatever survived got
										 * committed, which read as the rename silently reverting.
										 *
										 * The guard is keyed on the session id, not a boolean, so
										 * renaming a second session in the same sitting focuses
										 * that one too.
										 */
										ref={(node) => {
											if (!node) return;
											if (renameFocusedFor.current === session.sessionId) {
												return;
											}
											renameFocusedFor.current = session.sessionId;
											node.focus();
											node.select();
										}}
										value={renameDraft}
										aria-label={`Rename ${session.title}`}
										className="w-full min-w-0 rounded-sm border border-highlight bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
										onChange={(e) => setRenameDraft(e.target.value)}
										onBlur={() =>
											void commitRename(
												session.sessionId,
												renameDraft,
												session.title,
											)
										}
										onKeyDown={(e) => {
											// The sidebar and workspace both bind bare keys.
											e.stopPropagation();
											if (e.key === "Enter") {
												e.preventDefault();
												void commitRename(
													session.sessionId,
													renameDraft,
													session.title,
												);
											} else if (e.key === "Escape") {
												e.preventDefault();
												// Abandoning the rename has to release the focus
												// guard too, or reopening the field on this same
												// session would come up unfocused.
												renameFocusedFor.current = null;
												setRenamingId(null);
											}
										}}
									/>
								</div>
							);
						}
						return (
							<ContextMenu key={session.sessionId}>
								<ContextMenuTrigger asChild>
									{/* A row, not a button: the delete affordance is itself a button
									 * and nesting one inside another is invalid. */}
									{/* biome-ignore lint/a11y/noStaticElementInteractions: onMouseLeave only disarms the delete confirmation; every action in the row is a real button */}
									<div
										className="group relative flex items-center transition-colors hover:bg-accent focus-within:bg-accent"
										onMouseLeave={() =>
											// Leaving the row withdraws the confirmation. A trash sitting
											// armed after the pointer has gone is a trap for the next
											// click that lands there.
											setConfirmingDeleteId((id) =>
												id === session.sessionId ? null : id,
											)
										}
									>
										<button
											type="button"
											onClick={() =>
												onOpenSession({
													provider,
													sessionId: session.sessionId,
													cwd: session.cwd ?? null,
													title: session.title,
													mode: live ? "fork" : "resume",
												})
											}
											title={
												live
													? "Already open, or its state can't be confirmed — this opens a forked copy under a new session id."
													: (session.cwd ?? undefined)
											}
											className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-1.5 text-left focus-visible:outline-none"
										>
											{/*
											 * Two lines, because one was not telling them apart.
											 *
											 * Titles are generated from the first prompt, so
											 * several sessions started the same way render as the
											 * same truncated string with only a relative time
											 * between them — four rows of "ok Ive got a ne…" over
											 * a column of "2d". The project is what actually
											 * separates them, so it gets its own line instead of
											 * competing with the title for width.
											 *
											 * The time moves up beside the title and the fork
											 * marker moves down beside the project: the top line
											 * answers "which conversation", the bottom answers
											 * "where, and can I resume it".
											 */}
											<span className="flex items-baseline gap-2">
												<span className="min-w-0 flex-1 truncate text-[13px] leading-tight text-foreground">
													{session.title}
												</span>
												<span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/60">
													{formatRelativeTime(session.lastModified)}
												</span>
											</span>
											{project || live ? (
												<span className="flex items-baseline gap-1.5 text-[11px] leading-tight">
													{project ? (
														<span className="min-w-0 truncate text-muted-foreground/70">
															{project}
														</span>
													) : null}
													{live ? (
														<span className="shrink-0 text-muted-foreground/45">
															{project ? "· fork" : "fork"}
														</span>
													) : null}
												</span>
											) : null}
										</button>
										{/*
										 * Resume and rename moved to the right-click menu.
										 *
										 * Three hover buttons took roughly half the row, and what they
										 * took it from was the one thing the row exists to show — the
										 * session's name, truncated to a few words on every entry.
										 * Delete stays here because it is the action people take while
										 * skimming a list; the other two are deliberate enough to be
										 * worth a right-click, and get a readable label there instead
										 * of an icon you have to hover to identify.
										 */}
										<button
											type="button"
											aria-label={
												confirmingDeleteId === session.sessionId
													? `Confirm delete ${session.title}`
													: `Delete ${session.title}`
											}
											title={
												confirmingDeleteId === session.sessionId
													? "Click again to send this session to the Recycle Bin"
													: "Delete"
											}
											onClick={() => {
												if (confirmingDeleteId === session.sessionId) {
													void deleteSession(session.sessionId);
													return;
												}
												setConfirmingDeleteId(session.sessionId);
											}}
											className={cn(
												"mr-1.5 shrink-0 rounded p-1 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100",
												confirmingDeleteId === session.sessionId
													? // Armed: stays visible and goes loud, so the second
														// click is obviously not the same as the first.
														"bg-destructive/15 text-destructive opacity-100"
													: "text-muted-foreground/50 opacity-0 hover:text-destructive",
											)}
										>
											<Trash2 className="size-3.5" />
										</button>
									</div>
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem
										onSelect={() =>
											onOpenSession({
												provider,
												sessionId: session.sessionId,
												cwd: session.cwd ?? null,
												title: session.title,
												mode: live ? "fork" : "resume",
											})
										}
									>
										<Play className="mr-2 size-4" />
										{live ? "Open a forked copy" : "Resume session"}
									</ContextMenuItem>
									{resumeCommand && onResumeInTerminal ? (
										<ContextMenuItem
											onSelect={() =>
												onResumeInTerminal({
													command: resumeCommand,
													cwd: session.cwd ?? null,
													title: session.title,
													provider,
												})
											}
										>
											<TerminalIcon className="mr-2 size-4" />
											Resume in terminal
										</ContextMenuItem>
									) : null}
									{resumeCommand ? (
										<ContextMenuItem
											onSelect={() => void copyResumeCommand(resumeCommand)}
										>
											<Copy className="mr-2 size-4" />
											Copy resume command
										</ContextMenuItem>
									) : null}
									<ContextMenuItem
										onSelect={() => {
											setConfirmingDeleteId(null);
											// Released here as well as on commit and escape: the
											// field must focus every time it is opened, however
											// the last rename ended.
											renameFocusedFor.current = null;
											setRenameDraft(session.title);
											setRenamingId(session.sessionId);
										}}
									>
										<Pencil className="mr-2 size-4" />
										Rename
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						);
					})
				)}
			</div>
		</div>
	);
}
