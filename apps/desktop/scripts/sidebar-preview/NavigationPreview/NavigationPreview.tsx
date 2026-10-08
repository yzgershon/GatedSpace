import {
	ChevronDown,
	FolderPlus,
	Layers,
	MessageSquare,
	Plus,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type Direction,
	initialSessions,
	initialWorkspaces,
	type Session,
} from "../data";
import { SessionRow } from "../SessionRow/SessionRow";
import { WorkspaceRow } from "../WorkspaceRow/WorkspaceRow";

export function NavigationPreview({
	direction,
	onOpen,
}: {
	direction: Direction;
	onOpen: (title: string) => void;
}) {
	const [tab, setTab] = useState<"sessions" | "workspaces">("sessions");
	const [sessions, setSessions] = useState(initialSessions);
	const [workspaces, setWorkspaces] = useState(initialWorkspaces);
	const [provider, setProvider] = useState("all");
	const [filter, setFilter] = useState("all");
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState("gs");
	const [archived, setArchived] = useState<Session | null>(null);
	const [collapsed, setCollapsed] = useState<string[]>([]);
	const [adding, setAdding] = useState(false);
	const [newName, setNewName] = useState("");
	const [activeOnly, setActiveOnly] = useState(false);
	const search = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				search.current?.focus();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);
	const filtered = sessions.filter(
		(s) =>
			(provider === "all" || s.provider === provider) &&
			(filter === "all" ||
				(filter === "pinned" ? s.pinned : s.status === filter)) &&
			`${s.title} ${s.project}`.toLowerCase().includes(query.toLowerCase()),
	);
	const groups = useMemo(() => {
		const list: Record<string, Session[]> = {};
		for (const s of filtered) {
			const activityGroup = {
				working: "Working now",
				question: "Needs your reply",
				complete: "Ready to review",
				idle: s.pinned ? "Pinned" : "Earlier",
			}[s.status];
			const group =
				direction === "activity"
					? activityGroup
					: s.pinned
						? "Pinned"
						: direction === "collections"
							? s.project
							: s.time === "Yesterday"
								? "Yesterday"
								: "Today";
			list[group] ??= [];
			list[group].push(s);
		}
		const order =
			direction === "activity"
				? [
						"Needs your reply",
						"Working now",
						"Pinned",
						"Ready to review",
						"Earlier",
					]
				: ["Pinned", "GatedSpace", "Filtrsoft", "Jarvis", "Today", "Yesterday"];
		return Object.entries(list).sort(
			([a], [b]) => order.indexOf(a) - order.indexOf(b),
		);
	}, [filtered, direction]);
	const update = (id: string, change: Partial<Session>) =>
		setSessions((rows) =>
			rows.map((s) => (s.id === id ? { ...s, ...change } : s)),
		);
	const visibleWorkspaces = workspaces
		.filter(
			(w) =>
				`${w.name} ${w.path}`.toLowerCase().includes(query.toLowerCase()) &&
				(!activeOnly ||
					sessions.some(
						(s) =>
							s.project === w.name &&
							["working", "question"].includes(s.status),
					)),
		)
		.sort((a, b) => Number(b.pinned) - Number(a.pinned));
	return (
		<aside
			className={`navigation-preview direction-${direction}`}
			aria-label="Sidebar preview"
		>
			<div className="sidebar-brand">
				<span>GatedSpace</span>
				<span className="local-label">Local preview</span>
			</div>
			<nav className="sidebar-switch" aria-label="Sidebar section">
				<button
					type="button"
					aria-pressed={tab === "workspaces"}
					onClick={() => {
						setTab("workspaces");
						setQuery("");
					}}
				>
					<Layers />
					Workspaces
				</button>
				<button
					type="button"
					aria-pressed={tab === "sessions"}
					onClick={() => {
						setTab("sessions");
						setQuery("");
					}}
				>
					<MessageSquare />
					Recent sessions
				</button>
			</nav>
			<div className="sidebar-title">
				<h2>{tab === "sessions" ? "Recent sessions" : "Workspaces"}</h2>
				{tab === "workspaces" ? (
					<button
						type="button"
						className="icon-button add-workspace"
						aria-label="New workspace"
						onClick={() => setAdding(true)}
					>
						<Plus />
					</button>
				) : (
					<span className="total-count">{sessions.length}</span>
				)}
			</div>
			<label className="search-box">
				<Search />
				<input
					ref={search}
					aria-label={
						tab === "sessions" ? "Search sessions" : "Search workspaces"
					}
					placeholder={
						tab === "sessions" ? "Search title or project" : "Find a workspace"
					}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				{query ? (
					<button
						type="button"
						className="icon-button"
						aria-label="Clear search"
						onClick={() => setQuery("")}
					>
						<X />
					</button>
				) : (
					<kbd>Ctrl K</kbd>
				)}
			</label>
			{tab === "sessions" ? (
				<div className="filter-row">
					<label>
						<span className="sr-only">Agent</span>
						<select
							aria-label="Agent filter"
							value={provider}
							onChange={(e) => setProvider(e.target.value)}
						>
							<option value="all">All agents</option>
							<option value="claude">Claude</option>
							<option value="codex">Codex</option>
						</select>
					</label>
					<label>
						<SlidersHorizontal />
						<select
							aria-label="Session filter"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
						>
							<option value="all">All sessions</option>
							<option value="working">Working</option>
							<option value="question">Needs reply</option>
							<option value="complete">Complete</option>
							<option value="pinned">Pinned</option>
						</select>
					</label>
				</div>
			) : (
				<div className="workspace-filters">
					<span>{workspaces.length} workspaces</span>
					<button
						type="button"
						aria-pressed={activeOnly}
						onClick={() => setActiveOnly(!activeOnly)}
					>
						<span className={`toggle ${activeOnly ? "on" : ""}`} />
						Active only
					</button>
				</div>
			)}
			<div className="sidebar-list">
				{tab === "sessions" ? (
					groups.length ? (
						groups.map(([group, list]) => (
							<section
								className={`session-group ${direction === "collections" && group !== "Pinned" ? "project-group" : ""}`}
								key={group}
							>
								<button
									type="button"
									className="group-heading"
									aria-expanded={!collapsed.includes(group)}
									onClick={() =>
										setCollapsed((values) =>
											values.includes(group)
												? values.filter((v) => v !== group)
												: [...values, group],
										)
									}
								>
									<ChevronDown
										className={collapsed.includes(group) ? "closed" : ""}
									/>
									<span>{group}</span>
									<span className="group-count">{list.length}</span>
								</button>
								{!collapsed.includes(group) &&
									list.map((s) => (
										<SessionRow
											key={s.id}
											session={s}
											selected={selected === s.id}
											detailed={direction === "activity" && s.status !== "idle"}
											onSelect={() => {
												setSelected(s.id);
												onOpen(s.title);
											}}
											onUpdate={(change) => update(s.id, change)}
											onArchive={() => {
												setArchived(s);
												setSessions((all) =>
													all.filter((row) => row.id !== s.id),
												);
											}}
										/>
									))}
							</section>
						))
					) : (
						<div className="empty-state">
							<Search />
							<strong>No sessions found</strong>
							<p>Try a different title, project or filter.</p>
							<button
								type="button"
								onClick={() => {
									setQuery("");
									setProvider("all");
									setFilter("all");
								}}
							>
								Clear filters
							</button>
						</div>
					)
				) : visibleWorkspaces.length ? (
					<>
						<div className="section-caption">
							{direction === "activity" ? "Your projects" : "Projects"}
						</div>
						{visibleWorkspaces.map((w) => (
							<WorkspaceRow
								key={w.id}
								workspace={w}
								direction={direction}
								sessions={sessions.filter((s) => s.project === w.name)}
								onPin={() =>
									setWorkspaces((rows) =>
										rows.map((row) =>
											row.id === w.id ? { ...row, pinned: !row.pinned } : row,
										),
									)
								}
								onOpen={onOpen}
							/>
						))}
						<button
							type="button"
							className="new-workspace"
							onClick={() => setAdding(true)}
						>
							<FolderPlus />
							New workspace
						</button>
					</>
				) : (
					<div className="empty-state">
						<Layers />
						<strong>No workspaces found</strong>
						<button
							type="button"
							onClick={() => {
								setQuery("");
								setActiveOnly(false);
							}}
						>
							Clear filters
						</button>
					</div>
				)}
			</div>
			{archived && (
				<output className="undo-bar">
					<span>Session archived</span>
					<button
						type="button"
						onClick={() => {
							setSessions((rows) => [...rows, archived]);
							setArchived(null);
						}}
					>
						Undo
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Dismiss archive notice"
						onClick={() => setArchived(null)}
					>
						<X />
					</button>
				</output>
			)}
			<footer className="sidebar-footer">
				<span className="online-dot" />
				<span>2 agents working</span>
				<span>Yish</span>
			</footer>
			{adding && (
				<div className="modal-backdrop">
					<form
						className="workspace-dialog"
						aria-label="New workspace"
						onSubmit={(e) => {
							e.preventDefault();
							if (!newName.trim()) return;
							setWorkspaces((rows) => [
								...rows,
								{
									id: crypto.randomUUID(),
									name: newName.trim(),
									path: "Choose a folder when applying this design",
									pinned: false,
									branches: ["main"],
								},
							]);
							setNewName("");
							setAdding(false);
						}}
						onKeyDown={(e) => {
							if (e.key === "Escape") setAdding(false);
						}}
					>
						<h3>New workspace</h3>
						<label>
							Name
							<input
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								placeholder="Project name"
								ref={(el) => el?.focus()}
							/>
						</label>
						<p>Creates a sample workspace in this preview.</p>
						<div>
							<button type="button" onClick={() => setAdding(false)}>
								Cancel
							</button>
							<button
								type="submit"
								className="primary"
								disabled={!newName.trim()}
							>
								Create
							</button>
						</div>
					</form>
				</div>
			)}
		</aside>
	);
}
