import type { RendererContext } from "@superset/panes";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { workspaceTrpc } from "@superset/workspace-client";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import {
	Check,
	ChevronDown,
	LoaderCircle,
	PencilLine,
	Plus,
	Trash2,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useRenderStressInstrumentation } from "renderer/lib/performance/stress-instrumentation";
import { markTerminalForBackground } from "renderer/lib/terminal/terminal-background-intents";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { TerminalLauncher } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2TerminalLauncher";
import type {
	PaneViewerData,
	TerminalPaneData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { getRelativeTime } from "renderer/screens/main/components/WorkspacesListView/utils";
import { TerminalPaneIcon } from "../TerminalPaneIcon";
import {
	getTerminalDisplayTitle,
	getTerminalSessionListRefetchInterval,
	shouldQueryTerminalSessionList,
	TERMINAL_SESSION_LIST_STALE_MS,
} from "./TerminalSessionDropdown.utils";

interface TerminalSessionDropdownProps {
	context: RendererContext<PaneViewerData>;
	launcher: TerminalLauncher;
	workspaceId: string;
}

interface VisibleTerminalSession {
	terminalId: string;
	createdAt?: number;
	exited: boolean;
	exitCode: number;
	attached: boolean;
	title: string | null;
	pending?: boolean;
}

interface TerminalPaneLocation {
	tabId: string;
	paneId: string;
	titleOverride?: string;
}

const EMPTY_TERMINAL_PANE_LOCATIONS = new Map<string, TerminalPaneLocation[]>();

function formatCreatedAt(createdAt: number | undefined): string {
	if (!createdAt) return "Creating";

	return getRelativeTime(createdAt, { format: "compact" });
}

function getTerminalPaneLocations(
	context: RendererContext<PaneViewerData>,
): Map<string, TerminalPaneLocation[]> {
	const locations = new Map<string, TerminalPaneLocation[]>();
	for (const tab of context.store.getState().tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (pane.id === context.pane.id || pane.kind !== "terminal") continue;
			const data = pane.data as Partial<TerminalPaneData>;
			if (data.terminalId) {
				const terminalLocations = locations.get(data.terminalId) ?? [];
				terminalLocations.push({
					tabId: tab.id,
					paneId: pane.id,
					titleOverride: pane.titleOverride,
				});
				locations.set(data.terminalId, terminalLocations);
			}
		}
	}
	return locations;
}

export function TerminalSessionDropdown({
	context,
	launcher,
	workspaceId,
}: TerminalSessionDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
	const [isEditingTopic, setIsEditingTopic] = useState(false);
	const [topicDraft, setTopicDraft] = useState("");
	const topicInputRef = useRef<HTMLInputElement>(null);
	const editTopicButtonRef = useRef<HTMLButtonElement>(null);
	const restoreTopicButtonFocusRef = useRef(false);
	const collections = useCollections();
	const { terminalId } = context.pane.data as TerminalPaneData;
	const terminalInstanceId = context.pane.id;
	const utils = workspaceTrpc.useUtils();
	const killTerminalSession = workspaceTrpc.terminal.killSession.useMutation();
	const sessionsInput = useMemo(() => ({ workspaceId }), [workspaceId]);
	const sessionsQuery = workspaceTrpc.terminal.listSessions.useQuery(
		sessionsInput,
		{
			enabled: shouldQueryTerminalSessionList(isOpen),
			notifyOnChangeProps: ["data", "isFetching"],
			refetchInterval: getTerminalSessionListRefetchInterval(isOpen),
			refetchOnWindowFocus: false,
			staleTime: TERMINAL_SESSION_LIST_STALE_MS,
		},
	);
	useRenderStressInstrumentation("TerminalSessionDropdown", {
		warnAt: 30,
		getDetails: () => ({
			workspaceId,
			terminalId,
			isOpen,
			hasSessionData: Boolean(sessionsQuery.data),
		}),
	});
	const { data: localWorkspaceRows = [] } = useLiveQuery(
		(query) =>
			query
				.from({ v2WorkspaceLocalState: collections.v2WorkspaceLocalState })
				.where(({ v2WorkspaceLocalState }) =>
					eq(v2WorkspaceLocalState.workspaceId, workspaceId),
				),
		[collections, workspaceId],
	);
	const workspaceRunTerminals =
		localWorkspaceRows[0]?.workspaceRunTerminals ?? {};
	const workspaceRunState = workspaceRunTerminals[terminalId]?.state ?? null;

	const sessions = useMemo<VisibleTerminalSession[]>(() => {
		const liveSessions = sessionsQuery.data?.sessions ?? [];
		const ordered = [...liveSessions].sort((a, b) => {
			if (a.terminalId === terminalId) return -1;
			if (b.terminalId === terminalId) return 1;
			return (b.createdAt ?? 0) - (a.createdAt ?? 0);
		});
		if (ordered.some((session) => session.terminalId === terminalId)) {
			return ordered;
		}
		return [
			{
				terminalId,
				exited: false,
				exitCode: 0,
				attached: false,
				title: null,
				pending: true,
			},
			...ordered,
		];
	}, [sessionsQuery.data?.sessions, terminalId]);
	const currentSession = sessions.find(
		(session) => session.terminalId === terminalId,
	);
	const subscribeTitle = useCallback(
		(callback: () => void) =>
			terminalRuntimeRegistry.onTitleChange(
				terminalId,
				callback,
				terminalInstanceId,
			),
		[terminalId, terminalInstanceId],
	);
	const getTitleSnapshot = useCallback(
		() => terminalRuntimeRegistry.getTitle(terminalId, terminalInstanceId),
		[terminalId, terminalInstanceId],
	);
	const runtimeTitle = useSyncExternalStore(subscribeTitle, getTitleSnapshot);
	const renderTerminalPaneLocations = isOpen
		? getTerminalPaneLocations(context)
		: EMPTY_TERMINAL_PANE_LOCATIONS;

	useEffect(() => {
		if (isEditingTopic) {
			topicInputRef.current?.focus();
			topicInputRef.current?.select();
			return;
		}
		if (!restoreTopicButtonFocusRef.current) return;
		restoreTopicButtonFocusRef.current = false;
		editTopicButtonRef.current?.focus();
	}, [isEditingTopic]);

	const handleSelectSession = (session: VisibleTerminalSession) => {
		const nextTerminalId = session.terminalId;
		if (nextTerminalId === terminalId) {
			setIsOpen(false);
			return;
		}

		const state = context.store.getState();
		const terminalPaneLocations = getTerminalPaneLocations(context);
		const existingLocation = terminalPaneLocations.get(nextTerminalId)?.[0];
		if (existingLocation) {
			state.setActiveTab(existingLocation.tabId);
			state.setActivePane({
				tabId: existingLocation.tabId,
				paneId: existingLocation.paneId,
			});
			setIsOpen(false);
			return;
		}

		if ((terminalPaneLocations.get(terminalId)?.length ?? 0) === 0) {
			markTerminalForBackground(terminalId, workspaceId);
		}

		state.setPaneData({
			paneId: context.pane.id,
			data: {
				terminalId: nextTerminalId,
			} as PaneViewerData,
		});
		state.setPaneTitleOverride({
			tabId: context.tab.id,
			paneId: context.pane.id,
			titleOverride: undefined,
		});
		setIsOpen(false);
	};

	const closePanesForTerminal = (targetTerminalId: string) => {
		const terminalPaneLocations = getTerminalPaneLocations(context);
		for (const location of terminalPaneLocations.get(targetTerminalId) ?? []) {
			context.store.getState().closePane({
				tabId: location.tabId,
				paneId: location.paneId,
			});
		}

		if (targetTerminalId === terminalId) {
			void context.actions.close();
		}
	};

	const removeTerminalSession = async (session: VisibleTerminalSession) => {
		try {
			await killTerminalSession.mutateAsync({
				terminalId: session.terminalId,
				workspaceId,
			});
			closePanesForTerminal(session.terminalId);
		} finally {
			await utils.terminal.listSessions.invalidate({ workspaceId });
		}
	};

	const handleRemoveTerminal = (session: VisibleTerminalSession) => {
		toast.promise(removeTerminalSession(session), {
			loading: "Removing terminal...",
			success: "Terminal removed",
			error: "Failed to remove terminal",
		});
	};

	const handleNewTerminal = async () => {
		if (isCreatingTerminal) return;
		setIsCreatingTerminal(true);
		try {
			const nextTerminalId = await launcher.create();
			const state = context.store.getState();
			const terminalPaneLocations = getTerminalPaneLocations(context);
			if ((terminalPaneLocations.get(terminalId)?.length ?? 0) === 0) {
				markTerminalForBackground(terminalId, workspaceId);
			}
			state.setPaneData({
				paneId: context.pane.id,
				data: {
					terminalId: nextTerminalId,
				} as PaneViewerData,
			});
			state.setPaneTitleOverride({
				tabId: context.tab.id,
				paneId: context.pane.id,
				titleOverride: undefined,
			});
			void utils.terminal.listSessions.invalidate({ workspaceId });
			setIsOpen(false);
		} catch (error) {
			toast.error("Failed to create terminal", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			setIsCreatingTerminal(false);
		}
	};

	const hostTitle =
		runtimeTitle !== undefined ? runtimeTitle : currentSession?.title;
	const titleOverride = context.pane.titleOverride;
	const triggerTitle = getTerminalDisplayTitle({
		titleOverride,
		runtimeTitle: hostTitle,
	});
	const editTopicLabel = titleOverride?.trim()
		? "Rename panel topic"
		: "Add panel topic";

	const startEditingTopic = () => {
		setIsOpen(false);
		restoreTopicButtonFocusRef.current = false;
		setTopicDraft(triggerTitle);
		setIsEditingTopic(true);
	};

	const saveTopic = (restoreButtonFocus = false) => {
		const nextTitle = topicDraft.trim();
		if (nextTitle !== triggerTitle) {
			context.actions.setTitle(nextTitle || undefined);
		}
		if (restoreButtonFocus) {
			restoreTopicButtonFocusRef.current = true;
		}
		setIsEditingTopic(false);
	};

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<div className="flex min-w-0 max-w-96 flex-1 items-center gap-0.5">
				{isEditingTopic ? (
					<input
						ref={topicInputRef}
						type="text"
						aria-label="Panel topic"
						value={topicDraft}
						maxLength={64}
						placeholder="Panel topic"
						className="h-5 min-w-0 flex-1 rounded border border-ring/60 bg-background px-1.5 text-xs text-foreground outline-none ring-1 ring-ring/20 placeholder:text-muted-foreground focus-visible:ring-ring"
						onChange={(event) => setTopicDraft(event.target.value)}
						onBlur={() => saveTopic()}
						onClick={(event) => event.stopPropagation()}
						onMouseDown={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Enter") {
								event.preventDefault();
								saveTopic(true);
							} else if (event.key === "Escape") {
								event.preventDefault();
								restoreTopicButtonFocusRef.current = true;
								setIsEditingTopic(false);
							}
						}}
					/>
				) : (
					<>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label="Terminal sessions"
								title={triggerTitle}
								className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => event.stopPropagation()}
							>
								<TerminalPaneIcon
									workspaceId={workspaceId}
									terminalId={terminalId}
								/>
								{workspaceRunState && (
									<span
										className={
											workspaceRunState === "running"
												? "size-1.5 shrink-0 rounded-full bg-emerald-500"
												: workspaceRunState === "stopped-by-user"
													? "size-1.5 shrink-0 rounded-full bg-amber-500"
													: "size-1.5 shrink-0 rounded-full bg-red-500"
										}
										title={`Workspace run: ${workspaceRunState}`}
									/>
								)}
								<span className="min-w-0 flex-1 truncate text-left">
									{triggerTitle}
								</span>
								{sessionsQuery.isFetching && isOpen ? (
									<LoaderCircle className="size-3 shrink-0 animate-spin" />
								) : (
									<ChevronDown className="size-3 shrink-0" />
								)}
							</button>
						</DropdownMenuTrigger>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									ref={editTopicButtonRef}
									type="button"
									aria-label={editTopicLabel}
									className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									onMouseDown={(event) => event.stopPropagation()}
									onClick={(event) => {
										event.stopPropagation();
										startEditingTopic();
									}}
								>
									<PencilLine className="size-3" />
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom" showArrow={false}>
								{editTopicLabel}
							</TooltipContent>
						</Tooltip>
					</>
				)}
			</div>
			<DropdownMenuContent align="start" className="w-96">
				<DropdownMenuLabel className="flex items-center gap-2 text-xs">
					<span className="min-w-0 flex-1 truncate">Terminal Sessions</span>
					<button
						type="button"
						aria-label="New terminal"
						title="New terminal"
						disabled={isCreatingTerminal}
						className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void handleNewTerminal();
						}}
					>
						{isCreatingTerminal ? (
							<LoaderCircle className="size-3.5 animate-spin" />
						) : (
							<Plus className="size-3.5" />
						)}
					</button>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<div className="max-h-80 overflow-y-auto">
					{sessions.length > 0 ? (
						sessions.map((session) => {
							const isCurrent = session.terminalId === terminalId;
							const location = renderTerminalPaneLocations.get(
								session.terminalId,
							)?.[0];
							const createdAtLabel = formatCreatedAt(session.createdAt);
							const status = isCurrent
								? "Current"
								: workspaceRunTerminals[session.terminalId]
									? "Run"
									: session.pending
										? "Starting"
										: session.attached
											? "Attached"
											: "Detached";
							const title = isCurrent
								? triggerTitle
								: getTerminalDisplayTitle({
										titleOverride: location?.titleOverride,
										sessionTitle: session.title,
									});

							return (
								<DropdownMenuItem
									key={session.terminalId}
									className="group flex items-center gap-2"
									onSelect={(_event) => {
										handleSelectSession(session);
									}}
								>
									<span className="w-4 shrink-0">
										{isCurrent && <Check className="size-3.5" />}
									</span>
									<span className="min-w-0 flex-1 truncate text-xs">
										{title}
									</span>
									<span className="shrink-0 text-xs text-muted-foreground/70">
										{createdAtLabel}
									</span>
									<span className="shrink-0 text-xs text-muted-foreground">
										{status}
									</span>
									<button
										type="button"
										aria-label={`Remove terminal ${session.createdAt ? createdAtLabel : "session"}`}
										disabled={killTerminalSession.isPending}
										className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30 group-hover:opacity-100"
										onClick={(event) => {
											event.preventDefault();
											event.stopPropagation();
											handleRemoveTerminal(session);
										}}
									>
										<Trash2 className="size-3" />
									</button>
								</DropdownMenuItem>
							);
						})
					) : (
						<div className="px-2 py-1.5 text-xs text-muted-foreground">
							No live sessions
						</div>
					)}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
