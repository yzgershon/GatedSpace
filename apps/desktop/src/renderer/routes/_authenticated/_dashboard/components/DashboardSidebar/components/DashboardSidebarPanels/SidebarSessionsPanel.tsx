import { toast } from "@superset/ui/sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { getHostTrpcClient } from "renderer/lib/host-trpc-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import type { SessionNotificationState } from "shared/session-notifications";
import {
	emptyOrganization,
	projectForSession,
	sessionKey,
} from "shared/session-organization";
import {
	type CollectionSession,
	SessionCollectionRow,
} from "./SessionCollectionRow/SessionCollectionRow";
import { SessionOrganizer } from "./SessionOrganizer/SessionOrganizer";
import {
	type AgentSessionProvider,
	liveSessionKeys,
	resumeCommandFor,
} from "./session-list-helpers";
import "./collections.css";

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
	mode: "resume" | "fork";
}

export function SidebarSessionsPanel({
	onOpenSession,
	onResumeInTerminal,
}: {
	onOpenSession: (request: SidebarSessionOpenRequest) => void;
	onResumeInTerminal?: (request: {
		command: string;
		cwd: string | null;
		title: string;
		provider: AgentSessionProvider;
	}) => void;
}) {
	const queryClient = useQueryClient();
	const refreshSessions = () =>
		queryClient.invalidateQueries({ queryKey: ["sidebar-agent-sessions"] });
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState<"all" | AgentSessionProvider>(() => {
		const saved = localStorage.getItem("gatedspace-session-provider");
		return saved === "codex" || saved === "claude" ? saved : "all";
	});
	const [filter, setFilter] = useState("all");
	const organization = useQuery({
		queryKey: ["session-organization"],
		queryFn: () => electronTrpcClient.claudeSessions.organization.query(),
		staleTime: 30_000,
	});
	useEffect(() => {
		const subscription =
			electronTrpcClient.claudeSessions.watchOrganization.subscribe(undefined, {
				onData: (state) => {
					queryClient.setQueryData(["session-organization"], state);
					void queryClient.invalidateQueries({
						queryKey: ["sidebar-agent-sessions"],
					});
				},
				onError: () =>
					void queryClient.invalidateQueries({
						queryKey: ["session-organization"],
					}),
			});
		return () => subscription.unsubscribe();
	}, [queryClient]);
	const [states, setStates] = useState<SessionNotificationState[]>([]);
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const { activeHostUrl } = useLocalHostService();
	const { copyToClipboard } = useCopyToClipboard();
	const archived = filter === "archived";
	useEffect(() => {
		const timer = setTimeout(
			() => setDebouncedQuery(query.trim().slice(0, 200)),
			250,
		);
		return () => clearTimeout(timer);
	}, [query]);
	useEffect(() => {
		const subscription =
			electronTrpcClient.notifications.sessionStates.subscribe(undefined, {
				onData: setStates,
			});
		return () => subscription.unsubscribe();
	}, []);
	const providers: AgentSessionProvider[] =
		provider === "all" ? ["claude", "codex"] : [provider];
	const sessions = useQuery({
		queryKey: ["sidebar-agent-sessions", provider, archived],
		queryFn: async () => {
			const responses = await Promise.allSettled(
				providers.map(async (agent) => {
					const rows = await electronTrpcClient.claudeSessions.list.query({
						provider: agent,
						limit: 100,
						archived,
					});
					return rows.map((row) => ({ ...row, provider: agent }));
				}),
			);
			return {
				rows: responses.flatMap((r) =>
					r.status === "fulfilled" ? r.value : [],
				),
				errors: responses.flatMap((r, i) =>
					r.status === "rejected"
						? [
								`${providers[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
							]
						: [],
				),
			};
		},
		staleTime: 15_000,
		refetchOnWindowFocus: true,
	});
	const bindings = useQuery({
		queryKey: ["sidebar-host-bindings", activeHostUrl],
		queryFn: async () =>
			getHostTrpcClient(activeHostUrl)?.terminalAgents.list.query() ?? null,
		refetchInterval: 10_000,
	});
	const paneSessions = useQuery({
		queryKey: ["sidebar-pane-sessions"],
		queryFn: () => electronTrpcClient.claudeSession.liveSessionIds.query(),
		refetchInterval: 10_000,
	});
	const codexPaneSessions = useQuery({
		queryKey: ["sidebar-codex-pane-sessions"],
		queryFn: () => electronTrpcClient.codexSession.liveSessionIds.query(),
		refetchInterval: 10_000,
	});
	const liveKeys = useMemo(
		() =>
			liveSessionKeys(
				bindings.data ?? null,
				paneSessions.data ?? null,
				codexPaneSessions.data ?? null,
			),
		[bindings.data, paneSessions.data, codexPaneSessions.data],
	);
	const content = useQuery({
		queryKey: ["sidebar-session-content", provider, debouncedQuery],
		queryFn: async () =>
			(
				await Promise.all(
					providers.map(async (agent) =>
						(
							await electronTrpcClient.claudeSessions.searchContent.query({
								provider: agent,
								query: debouncedQuery,
							})
						).map((id) => `${agent}:${id}`),
					),
				)
			).flat(),
		enabled: debouncedQuery.length >= 3 && !archived,
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	});
	const activity = new Map(
		states
			.filter((s) => s.sessionId)
			.map((s) => [`${s.provider}:${s.sessionId}`, s.status]),
	);
	// Keep native Codex history search beyond the recent page. Fetch it separately
	// so a custom project-name search cannot hide that project's local bookmarks.
	const historySearch = useQuery({
		queryKey: ["sidebar-agent-sessions", "codex-search", debouncedQuery],
		queryFn: async () =>
			(
				await electronTrpcClient.claudeSessions.list.query({
					provider: "codex",
					limit: 100,
					search: debouncedQuery,
				})
			).map((row) => ({ ...row, provider: "codex" as const })),
		enabled: provider !== "claude" && !archived && debouncedQuery.length >= 2,
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});
	const candidates = new Map(
		(sessions.data?.rows ?? []).map((s) => [sessionKey(s), s]),
	);
	if (provider !== "claude" && !archived && debouncedQuery.length >= 2)
		for (const row of historySearch.data ?? [])
			candidates.set(sessionKey(row), row);
	const matches = new Set(content.data ?? []);
	const filtered = [...candidates.values()].filter((s) => {
		const key = `${s.provider}:${s.sessionId}`;
		const textMatch =
			!query.trim() ||
			`${s.title} ${s.cwd ?? ""} ${organization.data ? (projectForSession(organization.data, sessionKey(s))?.name ?? "") : ""}`
				.toLowerCase()
				.includes(query.trim().toLowerCase()) ||
			matches.has(key);
		return (
			textMatch &&
			(filter === "all" ||
				archived ||
				(filter === "pinned" ? s.pinned : activity.get(key) === filter))
		);
	});

	const perform = async (action: () => Promise<unknown>) => {
		try {
			await action();
			await refreshSessions();
		} catch (error) {
			toast.error("Could not update session", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};
	const archive = (session: CollectionSession) =>
		void perform(async () => {
			await electronTrpcClient.claudeSessions.setArchived.mutate({
				...session,
				archived: !archived,
			});
			if (!archived)
				toast("Session archived", {
					action: {
						label: "Undo",
						onClick: () =>
							void perform(() =>
								electronTrpcClient.claudeSessions.setArchived.mutate({
									...session,
									archived: false,
								}),
							),
					},
				});
		});
	return (
		<div className="session-collections flex h-full min-h-0 flex-col">
			<div className="collection-panel-title">
				<h2>Recent sessions</h2>
				<span>{sessions.data?.rows.length ?? ""}</span>
			</div>
			<label className="collection-search">
				<Search size={14} />
				<input
					aria-label="Search sessions"
					placeholder="Search title or project"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				{query && (
					<button
						type="button"
						aria-label="Clear search"
						onClick={() => setQuery("")}
					>
						<X size={14} />
					</button>
				)}
			</label>
			<div className="collection-filters">
				<select
					aria-label="Agent filter"
					value={provider}
					onChange={(e) => {
						const next = e.target.value as typeof provider;
						setProvider(next);
						localStorage.setItem("gatedspace-session-provider", next);
					}}
				>
					<option value="all">All agents</option>
					<option value="claude">Claude</option>
					<option value="codex">Codex</option>
				</select>
				<label>
					<SlidersHorizontal size={12} />
					<select
						aria-label="Session filter"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
					>
						<option value="all">All sessions</option>
						<option value="working">Working</option>
						<option value="attention">Needs reply</option>
						<option value="completed">Complete</option>
						<option value="pinned">Pinned</option>
						<option value="archived">Archived</option>
					</select>
				</label>
			</div>
			<div className="collection-list">
				{sessions.isError || sessions.data?.errors.length ? (
					<div className="collection-empty select-text cursor-text">
						{sessions.error?.message || sessions.data?.errors.join(" / ")}
						<button type="button" onClick={() => void sessions.refetch()}>
							Retry
						</button>
					</div>
				) : null}
				{sessions.isLoading && !sessions.data ? (
					<p className="collection-empty">Loading sessions...</p>
				) : (
					!filtered.length && (
						<p className="collection-empty">
							{query || filter !== "all"
								? "No matching sessions."
								: "Your conversations will appear here."}
						</p>
					)
				)}
				{organization.isError && (
					<p className="collection-empty select-text cursor-text" role="alert">
						{organization.error.message}
						<button type="button" onClick={() => void organization.refetch()}>
							Retry projects
						</button>
					</p>
				)}
				<SessionOrganizer
					sessions={filtered}
					organization={organization.data ?? emptyOrganization()}
					disabled={!organization.data || organization.isError}
					archived={archived}
					filtered={!!query.trim() || filter !== "all" || provider !== "all"}
					filterKey={`${query}/${filter}/${provider}`}
					onChange={async (command) => {
						const state =
							await electronTrpcClient.claudeSessions.organize.mutate(command);
						queryClient.setQueryData(["session-organization"], state);
						await refreshSessions();
					}}
					onPin={async (session) => {
						await electronTrpcClient.claudeSessions.pin.mutate({
							...session,
							pinned: true,
						});
						await refreshSessions();
					}}
					renderSession={(session, extras) => {
						const key = `${session.provider}:${session.sessionId}`;
						// Preserve the two-writer safeguard for native panes AND terminal bindings.
						const live = liveKeys === null || liveKeys.has(key);
						const command = resumeCommandFor(
							session.provider,
							session.sessionId,
							live,
						);
						return (
							<SessionCollectionRow
								key={key}
								{...extras}
								session={session}
								live={live}
								status={activity.get(key)}
								archived={archived}
								onOpen={() =>
									onOpenSession({
										...session,
										mode: live ? "fork" : "resume",
									})
								}
								onPin={() =>
									void perform(() =>
										electronTrpcClient.claudeSessions.pin.mutate({
											...session,
											pinned: !session.pinned,
										}),
									)
								}
								onArchive={() => archive(session)}
								onRename={async (title) => {
									await electronTrpcClient.claudeSessions.rename.mutate({
										provider: session.provider,
										sessionId: session.sessionId,
										title: title || null,
									});
									await refreshSessions();
								}}
								onCopy={
									command
										? () => {
												void copyToClipboard(command);
											}
										: undefined
								}
								onTerminal={
									command && onResumeInTerminal
										? () =>
												onResumeInTerminal({
													command,
													provider: session.provider,
													cwd: session.cwd,
													title: session.title,
												})
										: undefined
								}
							/>
						);
					}}
				/>
			</div>
		</div>
	);
}
