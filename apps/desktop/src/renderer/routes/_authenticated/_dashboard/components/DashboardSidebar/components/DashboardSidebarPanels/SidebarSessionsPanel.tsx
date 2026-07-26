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
import { Input } from "@superset/ui/input";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { getHostTrpcClient } from "renderer/lib/host-trpc-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export type AgentSessionProvider = "claude" | "codex";

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

export function formatRelativeTime(ms: number, now = Date.now()): string {
	const seconds = Math.max(0, (now - ms) / 1000);
	if (seconds < 60) return "now";
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	const days = Math.round(seconds / 86400);
	if (days < 30) return `${days}d`;
	return `${Math.round(days / 30)}mo`;
}

/**
 * Which session ids must not be plain-resumed.
 *
 * `hostReachable` is the whole safety argument: when the host can't be asked,
 * this returns null meaning "unknown", and the caller forks everything rather
 * than assuming nothing is live.
 */
export function liveSessionKeys(
	hostBindings: Array<{
		agentId: string;
		agentSessionId?: string | null;
	}> | null,
	paneSessionIds: string[] | null,
): Set<string> | null {
	if (hostBindings === null) return null;
	const keys = new Set<string>();
	for (const binding of hostBindings) {
		if (!binding.agentSessionId) continue;
		keys.add(`${binding.agentId}:${binding.agentSessionId}`);
	}
	for (const sessionId of paneSessionIds ?? []) {
		keys.add(`claude:${sessionId}`);
	}
	return keys;
}

export function SidebarSessionsPanel({
	onOpenSession,
	onNewSession,
}: {
	onOpenSession: (request: SidebarSessionOpenRequest) => void;
	onNewSession?: () => void;
}) {
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState<AgentSessionProvider>("claude");
	const { activeHostUrl } = useLocalHostService();

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

	const filtered = useMemo(() => {
		const list = sessions.data ?? [];
		const q = query.trim().toLowerCase();
		if (!q) return list;
		return list.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				(s.cwd ?? "").toLowerCase().includes(q),
		);
	}, [sessions.data, query]);

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
					filtered.map((session) => {
						const key = `${provider}:${session.sessionId}`;
						// Unknown (null) is treated exactly like live: fork.
						const live = liveKeys === null || liveKeys.has(key);
						return (
							<button
								key={session.sessionId}
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
								className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
							>
								<span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
									{session.title}
								</span>
								{live ? (
									<span className="shrink-0 text-[10px] text-muted-foreground/60">
										fork
									</span>
								) : null}
								<span className="shrink-0 tabular-nums text-[11px] text-muted-foreground/60">
									{formatRelativeTime(session.lastModified)}
								</span>
							</button>
						);
					})
				)}
			</div>
		</div>
	);
}
