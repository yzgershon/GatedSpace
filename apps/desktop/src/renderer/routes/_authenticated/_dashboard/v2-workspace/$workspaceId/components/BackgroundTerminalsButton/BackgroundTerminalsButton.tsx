import type { WorkspaceStore } from "@superset/panes";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { Archive, ChevronDown, Trash2 } from "lucide-react";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { getRelativeTime } from "renderer/components/WorkspacesListView/utils";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import {
	logStressEvent,
	useRenderStressInstrumentation,
} from "renderer/lib/performance/stress-instrumentation";
import {
	clearTerminalBackgroundMarker,
	forgetTerminalBackgroundLabel,
	getTerminalBackgroundLabel,
	getTerminalBackgroundMarkerIdsKey,
	subscribeTerminalBackgroundMarkers,
} from "renderer/lib/terminal/terminal-background-intents";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import { focusOrAddTerminalPane } from "../../utils/focusTerminalPane";
import {
	BACKGROUND_TERMINAL_ATTACHMENT_DEBOUNCE_MS,
	getAttachedTerminalIdsKey,
	getBackgroundTerminalCountRefetchInterval,
	getBackgroundTerminalListRefetchInterval,
	getBackgroundTerminalSessions,
	getUnattachedTerminalIds,
	parseAttachedTerminalIdsKey,
} from "./BackgroundTerminalsButton.utils";

interface BackgroundTerminalsButtonProps {
	workspaceId: string;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}

/**
 * Top-bar control for shells that are RUNNING something with no pane attached
 * (e.g. moved to the background from the terminal pane header).
 *
 * It sits beside the open-in-file-explorer button rather than on the tab strip:
 * it is a property of the workspace, not of any one tab, and the tab strip is
 * gone under Liquid Glass.
 *
 * Renders nothing when nothing is running. There is no history here on purpose
 * — a shell that finished an hour ago is not a background job, and a control
 * that keeps reporting one is worse than no control.
 */
export const BackgroundTerminalsButton = memo(
	function BackgroundTerminalsButton({
		workspaceId,
		store,
	}: BackgroundTerminalsButtonProps) {
		const [isOpen, setIsOpen] = useState(false);
		const attachedTerminalIdsKey = useStore(store, (s) =>
			getAttachedTerminalIdsKey(s.tabs),
		);
		const debouncedAttachedTerminalIdsKey = useDebouncedValue(
			attachedTerminalIdsKey,
			BACKGROUND_TERMINAL_ATTACHMENT_DEBOUNCE_MS,
		);
		const attachedTerminalIds = useMemo(
			() => parseAttachedTerminalIdsKey(attachedTerminalIdsKey),
			[attachedTerminalIdsKey],
		);
		const getBackgroundMarkerSnapshot = useCallback(
			() => getTerminalBackgroundMarkerIdsKey(workspaceId),
			[workspaceId],
		);
		const backgroundMarkerIdsKey = useSyncExternalStore(
			subscribeTerminalBackgroundMarkers,
			getBackgroundMarkerSnapshot,
			() => "[]",
		);
		const backgroundMarkerIds = useMemo(
			() => parseAttachedTerminalIdsKey(backgroundMarkerIdsKey),
			[backgroundMarkerIdsKey],
		);
		const debouncedAttachedTerminalIds = useMemo(
			() => parseAttachedTerminalIdsKey(debouncedAttachedTerminalIdsKey),
			[debouncedAttachedTerminalIdsKey],
		);
		const optimisticBackgroundTerminalIds = useMemo(
			() => getUnattachedTerminalIds(backgroundMarkerIds, attachedTerminalIds),
			[backgroundMarkerIds, attachedTerminalIds],
		);
		const optimisticBackgroundCount = optimisticBackgroundTerminalIds.length;
		const backgroundCountInput = useMemo(
			() => ({
				workspaceId,
				attachedTerminalIds: debouncedAttachedTerminalIds,
			}),
			[workspaceId, debouncedAttachedTerminalIds],
		);
		const sessionsInput = useMemo(() => ({ workspaceId }), [workspaceId]);
		const utils = workspaceTrpc.useUtils();
		const killSession = workspaceTrpc.terminal.killSession.useMutation();
		const backgroundCountQuery =
			workspaceTrpc.terminal.countBackgroundSessions.useQuery(
				backgroundCountInput,
				{
					enabled: !isOpen,
					notifyOnChangeProps: ["data", "dataUpdatedAt"],
					refetchInterval: getBackgroundTerminalCountRefetchInterval(isOpen),
					refetchOnWindowFocus: false,
					staleTime: 5_000,
				},
			);
		const sessionsQuery = workspaceTrpc.terminal.listSessions.useQuery(
			sessionsInput,
			{
				enabled: isOpen,
				notifyOnChangeProps: ["data", "isLoading"],
				refetchInterval: getBackgroundTerminalListRefetchInterval(isOpen),
				refetchOnWindowFocus: isOpen,
				staleTime: 1_000,
			},
		);

		useRenderStressInstrumentation("BackgroundTerminalsButton", {
			warnAt: 35,
			getDetails: () => ({
				isOpen,
				attachedTerminalCount: attachedTerminalIds.length,
				optimisticBackgroundCount,
				closedCount: backgroundCountQuery.data?.count ?? null,
			}),
		});

		const backgroundSessions = useMemo(() => {
			const sessions = sessionsQuery.data?.sessions ?? [];
			return getBackgroundTerminalSessions(sessions, attachedTerminalIds);
		}, [sessionsQuery.data?.sessions, attachedTerminalIds]);

		const markerObservedAtRef = useRef(0);
		useEffect(() => {
			markerObservedAtRef.current =
				backgroundMarkerIdsKey === "[]" ? 0 : Date.now();
		}, [backgroundMarkerIdsKey]);

		useEffect(() => {
			if (!sessionsQuery.data) return;

			const actualBackgroundTerminalIds = new Set(
				backgroundSessions.map((session) => session.terminalId),
			);
			for (const terminalId of backgroundMarkerIds) {
				if (actualBackgroundTerminalIds.has(terminalId)) continue;
				clearTerminalBackgroundMarker(workspaceId, terminalId);
			}
		}, [
			backgroundMarkerIds,
			backgroundSessions,
			sessionsQuery.data,
			workspaceId,
		]);

		useEffect(() => {
			if (isOpen || optimisticBackgroundTerminalIds.length === 0) return;
			if (debouncedAttachedTerminalIdsKey !== attachedTerminalIdsKey) return;
			if (backgroundCountQuery.data?.count !== 0) return;
			if (backgroundCountQuery.dataUpdatedAt <= markerObservedAtRef.current) {
				return;
			}

			for (const terminalId of optimisticBackgroundTerminalIds) {
				clearTerminalBackgroundMarker(workspaceId, terminalId);
			}
		}, [
			attachedTerminalIdsKey,
			backgroundCountQuery.data?.count,
			backgroundCountQuery.dataUpdatedAt,
			debouncedAttachedTerminalIdsKey,
			isOpen,
			optimisticBackgroundTerminalIds,
			workspaceId,
		]);

		/*
		 * The host is the only authority on whether a shell is running.
		 *
		 * This used to be `Math.max(serverCount, optimisticBackgroundCount)`,
		 * where the optimistic half came from a marker written when a terminal
		 * was sent to the background and cleared only on a later round trip. So
		 * the button outlived the job it was reporting: background a build, let
		 * it finish, and the chip stayed up claiming a shell was running. The
		 * markers still drive adopt, they just no longer inflate the count.
		 *
		 * Backgrounding a terminal detaches its pane, which changes
		 * `attachedTerminalIds`, which is part of the query key — so the count
		 * refetches immediately anyway and nothing was gained by guessing.
		 */
		const backgroundCount =
			isOpen && sessionsQuery.data
				? backgroundSessions.length
				: (backgroundCountQuery.data?.count ?? 0);

		if (!isOpen && backgroundCount === 0) return null;

		// "1 shell running", not "1 background terminal session". The question
		// this answers is "is my build still going", asked at a glance from
		// across the room, and the answer should read as an English sentence
		// rather than as a data structure.
		const label = `${backgroundCount} shell${
			backgroundCount === 1 ? "" : "s"
		} running`;

		const handleAdopt = (terminalId: string) => {
			clearTerminalBackgroundMarker(workspaceId, terminalId);
			forgetTerminalBackgroundLabel(terminalId);
			const result = focusOrAddTerminalPane(store, terminalId);
			void utils.terminal.listSessions.invalidate({ workspaceId });
			void utils.terminal.countBackgroundSessions.invalidate({ workspaceId });
			logStressEvent("background-terminals.adopt", { result, workspaceId });
			setIsOpen(false);
		};

		const handleKill = async (terminalId: string) => {
			try {
				await killSession.mutateAsync({ terminalId, workspaceId });
				clearTerminalBackgroundMarker(workspaceId, terminalId);
				forgetTerminalBackgroundLabel(terminalId);
			} catch (error) {
				console.error(
					"[BackgroundTerminalsButton] Failed to kill session:",
					error,
				);
				toast.error("Failed to close terminal session");
			} finally {
				void utils.terminal.listSessions.invalidate({ workspaceId });
				void utils.terminal.countBackgroundSessions.invalidate({ workspaceId });
			}
		};

		return (
			<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						className="h-7 gap-1.5 rounded-full px-2.5 text-[11.5px] text-muted-foreground shadow-none hover:bg-accent/50 hover:text-foreground"
						size="sm"
						type="button"
						variant="ghost"
					>
						{/*
						 * A live dot, not an archive box. The state being reported is
						 * "working", and the same dot means the same thing on a pane
						 * header and a session row.
						 */}
						<span className="relative flex size-1.5 shrink-0">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />
							<span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
						</span>
						<span>{label}</span>
						<ChevronDown className="size-3 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-80">
					<DropdownMenuLabel className="text-xs">
						Shells running
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<div className="max-h-80 overflow-y-auto">
						{sessionsQuery.isLoading && (
							<div className="px-2 py-3 text-xs text-muted-foreground">
								Loading sessions…
							</div>
						)}
						{!sessionsQuery.isLoading && backgroundSessions.length === 0 && (
							<div className="px-2 py-3 text-xs text-muted-foreground">
								Nothing running in the background
							</div>
						)}
						{/*
						 * The TAB the shell came from, not the shell's own title.
						 * Every agent shell reports itself as "claude", so a list of
						 * them named nothing; "GatedSpace Edits" is the answer to
						 * "which one of these is building".
						 */}
						{backgroundSessions.map((session) => (
							<DropdownMenuItem
								key={session.terminalId}
								className="group flex items-center gap-2"
								onSelect={() => handleAdopt(session.terminalId)}
							>
								<Archive className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate text-xs">
									{getTerminalBackgroundLabel(session.terminalId) ??
										session.title ??
										"Terminal"}
								</span>
								{session.createdAt > 0 && (
									<span className="shrink-0 text-xs text-muted-foreground/70">
										{getRelativeTime(session.createdAt, { format: "compact" })}
									</span>
								)}
								<button
									type="button"
									aria-label="Close terminal session"
									title="Close terminal session"
									disabled={
										killSession.isPending &&
										killSession.variables?.terminalId === session.terminalId
									}
									className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30 group-hover:opacity-100"
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										void handleKill(session.terminalId);
									}}
								>
									<Trash2 className="size-3" />
								</button>
							</DropdownMenuItem>
						))}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	},
	areBackgroundTerminalsButtonPropsEqual,
);

function areBackgroundTerminalsButtonPropsEqual(
	prev: BackgroundTerminalsButtonProps,
	next: BackgroundTerminalsButtonProps,
) {
	return prev.workspaceId === next.workspaceId && prev.store === next.store;
}
