import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import {
	ArrowDown,
	ArrowUp,
	Check,
	FolderInput,
	FolderPlus,
	Inbox,
} from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";
import {
	type OrganizationCommand,
	orderedPins,
	projectForSession,
	type SessionOrganization,
	sessionKey,
} from "shared/session-organization";
import type {
	CollectionSession,
	SessionCollectionRow,
} from "../SessionCollectionRow/SessionCollectionRow";
import { projectNameFor } from "../session-list-helpers";
import { ProjectSection } from "./ProjectSection/ProjectSection";
import {
	SortableSession,
	sessionDragId,
} from "./SortableSession/SortableSession";
import "./organizer.css";

type RowExtras = Pick<
	ComponentProps<typeof SessionCollectionRow>,
	"dragHandle" | "organizationActions" | "projectLabel"
>;
export function SessionOrganizer({
	sessions,
	organization,
	disabled = false,
	archived = false,
	filtered = false,
	filterKey = "",
	onChange,
	onPin,
	renderSession,
}: {
	sessions: CollectionSession[];
	organization: SessionOrganization;
	disabled?: boolean;
	archived?: boolean;
	filtered?: boolean;
	filterKey?: string;
	onChange: (command: OrganizationCommand) => Promise<unknown>;
	onPin: (session: CollectionSession) => Promise<unknown>;
	renderSession: (session: CollectionSession, extras: RowExtras) => ReactNode;
}) {
	const [creating, setCreating] = useState(false);
	const [assignOnCreate, setAssignOnCreate] = useState<CollectionSession>();
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const focusInput = useCallback(
		(node: HTMLInputElement | null) => node?.focus(),
		[],
	);
	const [dragging, setDragging] = useState<CollectionSession>();
	const [filteredCollapsed, setFilteredCollapsed] = useState<string[]>([]);
	const projectInputId = useId();
	useEffect(() => {
		if (filterKey !== undefined) setFilteredCollapsed([]);
	}, [filterKey]);
	const busy = disabled || pending;
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const change = async (command: OrganizationCommand) => {
		setPending(true);
		setError("");
		try {
			await onChange(command);
		} finally {
			setPending(false);
		}
	};
	const run = (command: OrganizationCommand) =>
		void change(command).catch((error) =>
			setError(error instanceof Error ? error.message : String(error)),
		);
	const rowsByKey = new Map(sessions.map((s) => [sessionKey(s), s]));
	const groups = [
		{
			id: "@pinned",
			name: "Pinned",
			rows: orderedPins(sessions, organization.pinnedOrder),
		},
		...organization.projects.map((p) => ({
			...p,
			rows: p.sessions.flatMap((id) => rowsByKey.get(id) ?? []),
		})),
		{
			id: "@unsorted",
			name: "Unsorted",
			rows: sessions
				.filter(
					(s) => !s.pinned && !projectForSession(organization, sessionKey(s)),
				)
				.sort((a, b) => b.lastModified - a.lastModified),
		},
	];
	const startCreate = (session?: CollectionSession) => {
		setAssignOnCreate(session);
		setDraft("");
		setCreating(true);
		setError("");
	};
	const dragEnd = async ({ active, over }: DragEndEvent) => {
		setDragging(undefined);
		if (!over || active.id === over.id || busy) return;
		const session = active.data.current?.session as
			| CollectionSession
			| undefined;
		const group = over.data.current?.group as string | undefined;
		const target = over.data.current?.session as CollectionSession | undefined;
		if (!session || !group) return;
		const key = sessionKey(session);
		const targetKey = target && sessionKey(target);
		if (key === targetKey) return;
		const sourceGroup = active.data.current?.group;
		const visibleOrder = groups.find((g) => g.id === group)?.rows ?? [];
		const after =
			!!target &&
			(sourceGroup === group
				? visibleOrder.findIndex((s) => sessionKey(s) === key) <
					visibleOrder.findIndex((s) => sessionKey(s) === targetKey)
				: (active.rect.current.translated?.top ?? 0) > over.rect.top);
		try {
			if (group === "@pinned") {
				if (!session.pinned) {
					setPending(true);
					await onPin(session);
				}
				if (targetKey)
					await change({ type: "movePin", key, target: targetKey, after });
			} else
				await change({
					type: "assign",
					session,
					projectId: group === "@unsorted" ? null : group,
					...(group !== "@unsorted" && targetKey
						? { target: targetKey, after }
						: {}),
				});
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setPending(false);
		}
	};
	return (
		<div className="session-organizer" aria-busy={pending}>
			{!archived && (
				<div className="organizer-toolbar">
					<span>YOUR LIBRARY</span>
					<button type="button" disabled={busy} onClick={() => startCreate()}>
						<FolderPlus size={14} />
						New project
					</button>
				</div>
			)}
			{creating && (
				<form
					className="project-inline-form project-create"
					onSubmit={async (e) => {
						e.preventDefault();
						try {
							await change({
								type: "createProject",
								name: draft,
								session: assignOnCreate,
							});
							setCreating(false);
						} catch (error) {
							setError(error instanceof Error ? error.message : String(error));
						}
					}}
				>
					<label htmlFor={projectInputId}>
						{assignOnCreate
							? `New project for “${assignOnCreate.title}”`
							: "New project"}
					</label>
					<input
						id={projectInputId}
						ref={focusInput}
						placeholder="e.g. GatedSpace, School, Ideas"
						value={draft}
						required
						maxLength={60}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") setCreating(false);
						}}
					/>
					<div>
						<button type="submit" disabled={busy || !draft.trim()}>
							Create project
						</button>
						<button type="button" onClick={() => setCreating(false)}>
							Cancel
						</button>
					</div>
					<p>Group conversations without changing their working folders.</p>
				</form>
			)}
			{error && (
				<p role="alert" className="organizer-error select-text cursor-text">
					{error}
				</p>
			)}
			<DndContext
				sensors={sensors}
				collisionDetection={(args) => {
					const hits = pointerWithin(args);
					// Prefer a row to its enclosing project, allowing both reorder and empty-folder drops.
					return hits.length
						? hits.sort(
								(a, b) =>
									Number(String(a.id).startsWith("group/")) -
									Number(String(b.id).startsWith("group/")),
							)
						: args.pointerCoordinates
							? []
							: closestCenter(args);
				}}
				onDragStart={({ active }) => setDragging(active.data.current?.session)}
				onDragCancel={() => setDragging(undefined)}
				onDragEnd={(event) => void dragEnd(event)}
				accessibility={{
					announcements: {
						onDragStart: ({ active }) =>
							`Picked up ${active.data.current?.session?.title ?? "session"}.`,
						onDragOver: ({ over }) =>
							over
								? `Move to ${over.data.current?.session?.title ?? groups.find((g) => g.id === over.data.current?.group)?.name ?? "project"}.`
								: "Outside the session list. Drop to cancel.",
						onDragEnd: ({ active, over }) =>
							over
								? `Dropped ${active.data.current?.session?.title ?? "session"}.`
								: "Move cancelled.",
						onDragCancel: () => "Move cancelled.",
					},
					screenReaderInstructions: {
						draggable:
							"Press Space to pick up a session. Use arrow keys to move, Space to drop, or Escape to cancel. The session menu also has move controls.",
					},
				}}
			>
				{groups
					.filter((g) => (!archived && !filtered) || g.rows.length)
					.map((group) => {
						const projectIndex = organization.projects.findIndex(
							(p) => p.id === group.id,
						);
						const project = projectIndex >= 0;
						const moveProject = (offset: number) => {
							const neighbour = organization.projects[projectIndex + offset];
							if (neighbour)
								run({
									type: "moveProject",
									id: group.id,
									target: neighbour.id,
									after: offset > 0,
								});
						};
						return (
							<ProjectSection
								key={group.id}
								id={group.id}
								name={group.name}
								count={group.rows.length}
								collapsed={(filtered
									? filteredCollapsed
									: organization.collapsed
								).includes(group.id)}
								disabled={busy || archived}
								onCollapse={() =>
									filtered
										? setFilteredCollapsed((ids) =>
												ids.includes(group.id)
													? ids.filter((id) => id !== group.id)
													: [...ids, group.id],
											)
										: run({
												type: "collapse",
												id: group.id,
												collapsed: !organization.collapsed.includes(group.id),
											})
								}
								onRename={
									project && !archived
										? (name) =>
												change({ type: "renameProject", id: group.id, name })
										: undefined
								}
								onRemove={
									project
										? () => change({ type: "removeProject", id: group.id })
										: undefined
								}
								onUp={projectIndex > 0 ? () => moveProject(-1) : undefined}
								onDown={
									project && projectIndex < organization.projects.length - 1
										? () => moveProject(1)
										: undefined
								}
							>
								<SortableContext
									items={group.rows.map((s) => sessionDragId(group.id, s))}
									strategy={verticalListSortingStrategy}
								>
									{group.rows.map((session, index) => {
										const key = sessionKey(session);
										const owner = projectForSession(organization, key);
										const reorder = (offset: number) => {
											const target = group.rows[index + offset];
											if (!target) return;
											run(
												group.id === "@pinned"
													? {
															type: "movePin",
															key,
															target: sessionKey(target),
															after: offset > 0,
														}
													: {
															type: "assign",
															session,
															projectId: group.id,
															target: sessionKey(target),
															after: offset > 0,
														},
											);
										};
										return (
											<SortableSession
												key={key}
												session={session}
												group={group.id}
												disabled={busy || archived}
											>
												{(dragHandle) =>
													renderSession(session, {
														dragHandle,
														projectLabel:
															group.id === "@pinned"
																? (owner?.name ??
																	projectNameFor(session.cwd) ??
																	undefined)
																: group.id === "@unsorted"
																	? (projectNameFor(session.cwd) ?? undefined)
																	: undefined,
														organizationActions: !archived && (
															<>
																<DropdownMenuSub>
																	<DropdownMenuSubTrigger disabled={busy}>
																		<FolderInput size={14} />
																		Move to project
																	</DropdownMenuSubTrigger>
																	<DropdownMenuSubContent className="session-project-destinations">
																		{organization.projects.map((p) => (
																			<DropdownMenuItem
																				key={p.id}
																				onSelect={() =>
																					run({
																						type: "assign",
																						session,
																						projectId: p.id,
																					})
																				}
																			>
																				<span className="session-project-destination">
																					{p.name}
																				</span>
																				{owner?.id === p.id && (
																					<Check size={13} />
																				)}
																			</DropdownMenuItem>
																		))}
																		<DropdownMenuSeparator />
																		<DropdownMenuItem
																			onSelect={() => startCreate(session)}
																		>
																			<FolderPlus size={14} />
																			New project…
																		</DropdownMenuItem>
																		{owner && (
																			<DropdownMenuItem
																				onSelect={() =>
																					run({
																						type: "assign",
																						session,
																						projectId: null,
																					})
																				}
																			>
																				<Inbox size={14} />
																				Move to Unsorted
																			</DropdownMenuItem>
																		)}
																	</DropdownMenuSubContent>
																</DropdownMenuSub>
																{group.id !== "@unsorted" && (
																	<>
																		<DropdownMenuItem
																			disabled={busy || index === 0}
																			onSelect={() => reorder(-1)}
																		>
																			<ArrowUp size={14} />
																			Move up
																		</DropdownMenuItem>
																		<DropdownMenuItem
																			disabled={
																				busy || index === group.rows.length - 1
																			}
																			onSelect={() => reorder(1)}
																		>
																			<ArrowDown size={14} />
																			Move down
																		</DropdownMenuItem>
																	</>
																)}
																<DropdownMenuSeparator />
															</>
														),
													})
												}
											</SortableSession>
										);
									})}
								</SortableContext>
								{!group.rows.length && (
									<p className="session-project-empty">
										{filtered
											? "No matching sessions"
											: group.id === "@pinned"
												? "Pin your go-to sessions. Drag to put them in order."
												: group.id === "@unsorted"
													? "All caught up. New sessions will appear here."
													: "Drop a session here, or use Move to project in its menu."}
									</p>
								)}
							</ProjectSection>
						);
					})}
				<DragOverlay dropAnimation={null}>
					{dragging && (
						<div className="session-drag-preview">
							<FolderInput size={15} />
							<span>{dragging.title}</span>
						</div>
					)}
				</DragOverlay>
			</DndContext>
		</div>
	);
}
