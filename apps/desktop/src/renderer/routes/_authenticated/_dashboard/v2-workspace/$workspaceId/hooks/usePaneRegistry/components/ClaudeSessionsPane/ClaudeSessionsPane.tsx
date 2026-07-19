import { Input } from "@superset/ui/input";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { History, MessageSquareText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export type AgentSessionProvider = "claude" | "codex";

export interface ClaudeSessionResumeRequest {
	provider: AgentSessionProvider;
	sessionId: string;
	cwd: string | null;
	title: string;
}

interface ClaudeSessionsPaneProps {
	onResume: (request: ClaudeSessionResumeRequest) => void;
}

const PROVIDERS: { id: AgentSessionProvider; label: string }[] = [
	{ id: "claude", label: "Claude" },
	{ id: "codex", label: "Codex" },
];

function formatRelativeTime(ms: number): string {
	const seconds = Math.max(0, (Date.now() - ms) / 1000);
	if (seconds < 60) return "just now";
	if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
	const days = Math.round(seconds / 86400);
	if (days < 30) return `${days}d ago`;
	return `${Math.round(days / 30)}mo ago`;
}

function formatContext(tokens: number | null): string {
	if (tokens == null) return "—";
	if (tokens >= 1000)
		return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
	return String(tokens);
}

function shortenCwd(cwd: string | null, projectDirName: string): string {
	const value = cwd ?? projectDirName;
	const parts = value.split(/[\\/]/).filter(Boolean);
	return parts.slice(-2).join("/") || value;
}

export function ClaudeSessionsPane({ onResume }: ClaudeSessionsPaneProps) {
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState<AgentSessionProvider>("claude");
	// Deliberately the context-free proxy client, NOT electronTrpc hooks: this
	// pane renders inside the workspace tree, where the workspace client's
	// provider is the innermost tRPC context. electronTrpc hooks here silently
	// resolve through that provider and hit the host-service (which has no
	// claudeSessions router → "No procedure found"). The proxy client always
	// goes over IPC to the desktop main process, no React context involved.
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
		queryKey: ["agent-sessions", provider],
		queryFn: () =>
			electronTrpcClient.claudeSessions.list.query({ limit: 40, provider }),
		refetchOnWindowFocus: true,
		retry: 2,
		staleTime: 15_000,
	});

	const filtered = useMemo(() => {
		const sessions = data ?? [];
		const q = query.trim().toLowerCase();
		if (!q) return sessions;
		return sessions.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				(s.cwd ?? "").toLowerCase().includes(q),
		);
	}, [data, query]);

	const providerLabel = provider === "codex" ? "Codex" : "Claude";

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
				<History className="size-4 shrink-0 text-muted-foreground" />
				<span className="text-xs font-medium text-foreground">
					Recent sessions
				</span>
				<div className="ml-1 flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
					{PROVIDERS.map((entry) => (
						<button
							key={entry.id}
							type="button"
							onClick={() => setProvider(entry.id)}
							className={cn(
								"rounded px-2 py-0.5 text-[11px] transition-colors",
								provider === entry.id
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{entry.label}
						</button>
					))}
				</div>
				<button
					type="button"
					onClick={() => refetch()}
					className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				>
					{isFetching ? "Refreshing…" : "Refresh"}
				</button>
			</div>

			<div className="relative border-b border-border/60 px-3 py-2">
				<Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-5 size-3.5 text-muted-foreground" />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={`Search ${providerLabel} sessions…`}
					className="h-8 pl-7 text-xs"
				/>
			</div>

			<div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto">
				{isLoading ? (
					<div className="p-4 text-center text-xs text-muted-foreground">
						Loading sessions…
					</div>
				) : isError ? (
					<div className="flex flex-col items-center gap-2 p-4 text-center">
						<p className="text-xs text-destructive">
							Couldn't read your {providerLabel} sessions.
						</p>
						{error?.message ? (
							<p className="max-w-full cursor-text select-text break-words text-[11px] text-muted-foreground">
								{error.message}
							</p>
						) : null}
						<button
							type="button"
							onClick={() => refetch()}
							className="rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
						>
							Try again
						</button>
					</div>
				) : filtered.length === 0 ? (
					<div className="p-4 text-center text-xs text-muted-foreground">
						{query
							? "No matching sessions."
							: `No ${providerLabel} sessions yet.`}
					</div>
				) : (
					<ul className="flex flex-col">
						{filtered.map((session) => (
							<li key={session.filePath}>
								<button
									type="button"
									title={`${session.title}\n${session.cwd ?? session.projectDirName}\nResume this session`}
									onClick={() =>
										onResume({
											provider,
											sessionId: session.sessionId,
											cwd: session.cwd,
											title: session.title,
										})
									}
									className={cn(
										"group flex w-full flex-col gap-1 border-border/40 border-b px-3 py-2 text-left",
										"transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
									)}
								>
									<div className="flex items-center gap-2">
										<MessageSquareText className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
										<span className="min-w-0 flex-1 truncate text-xs text-foreground">
											{session.title}
										</span>
									</div>
									<div className="flex items-center gap-2 pl-[22px] text-[11px] text-muted-foreground">
										<span>{formatRelativeTime(session.lastModified)}</span>
										<span aria-hidden>·</span>
										<span title="Context size">
											{formatContext(session.contextTokens)} ctx
										</span>
										<span aria-hidden>·</span>
										<span className="min-w-0 truncate">
											{shortenCwd(session.cwd, session.projectDirName)}
										</span>
									</div>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
