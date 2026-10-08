import { useDroppable } from "@dnd-kit/core";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	Folder,
	Inbox,
	MoreHorizontal,
	Pencil,
	Pin,
	Trash2,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export function ProjectSection({
	id,
	name,
	count,
	collapsed,
	disabled,
	children,
	onCollapse,
	onRename,
	onRemove,
	onUp,
	onDown,
}: {
	id: string;
	name: string;
	count: number;
	collapsed: boolean;
	disabled: boolean;
	children: ReactNode;
	onCollapse: () => void;
	onRename?: (name: string) => Promise<void>;
	onRemove?: () => Promise<void>;
	onUp?: () => void;
	onDown?: () => void;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `group/${id}`,
		data: { group: id },
		disabled,
	});
	const [editing, setEditing] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [draft, setDraft] = useState(name);
	const [error, setError] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const previous = useRef({ menuOpen: false, editing: false, removing: false });
	useLayoutEffect(() => {
		const was = previous.current;
		if (
			!menuOpen &&
			!editing &&
			!removing &&
			(was.menuOpen || was.editing || was.removing)
		)
			trigger.current?.focus();
		previous.current = { menuOpen, editing, removing };
	}, [menuOpen, editing, removing]);
	const focusInput = useCallback(
		(node: HTMLInputElement | null) => node?.focus(),
		[],
	);
	const Icon = id === "@pinned" ? Pin : id === "@unsorted" ? Inbox : Folder;
	return (
		<section
			ref={setNodeRef}
			className="session-project-section"
			data-over={isOver}
			data-group={id}
		>
			<div className="session-project-heading">
				<button
					type="button"
					className="collection-heading"
					onClick={onCollapse}
					aria-expanded={!collapsed}
					aria-label={`${name}, ${count} session${count === 1 ? "" : "s"}`}
				>
					<Icon size={14} />
					<span>{name}</span>
					<small>{count}</small>
					<ChevronDown
						size={12}
						style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
					/>
				</button>
				{onRename && (
					<DropdownMenu
						modal={false}
						open={menuOpen}
						onOpenChange={setMenuOpen}
					>
						<DropdownMenuTrigger asChild>
							<button
								ref={trigger}
								type="button"
								disabled={disabled || editing || removing}
								className="project-menu-button"
								aria-label={`Project actions for ${name}`}
							>
								<MoreHorizontal size={16} />
							</button>
						</DropdownMenuTrigger>
						{menuOpen && (
							<DropdownMenuContent
								align="end"
								className="data-[state=closed]:animate-none"
								onCloseAutoFocus={(event) => event.preventDefault()}
							>
								<DropdownMenuItem
									onSelect={() => {
										setDraft(name);
										setEditing(true);
										setRemoving(false);
										setError("");
									}}
								>
									<Pencil size={14} />
									Rename project
								</DropdownMenuItem>
								<DropdownMenuItem disabled={!onUp} onSelect={onUp}>
									<ArrowUp size={14} />
									Move project up
								</DropdownMenuItem>
								<DropdownMenuItem disabled={!onDown} onSelect={onDown}>
									<ArrowDown size={14} />
									Move project down
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => {
										setRemoving(true);
										setEditing(false);
										setError("");
									}}
								>
									<Trash2 size={14} />
									Remove project…
								</DropdownMenuItem>
							</DropdownMenuContent>
						)}
					</DropdownMenu>
				)}
			</div>
			{editing && (
				<form
					className="project-inline-form"
					onSubmit={async (e) => {
						e.preventDefault();
						try {
							await onRename?.(draft);
							setEditing(false);
						} catch (error) {
							setError(String(error));
						}
					}}
				>
					<input
						ref={focusInput}
						aria-label="Project name"
						maxLength={60}
						required
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") setEditing(false);
						}}
					/>
					<div>
						<button type="submit" disabled={disabled}>
							Save
						</button>
						<button type="button" onClick={() => setEditing(false)}>
							Cancel
						</button>
					</div>
				</form>
			)}
			{removing && (
				<div className="project-inline-form">
					<p>
						Remove this project? Its sessions stay saved and return to Unsorted.
					</p>
					<div>
						<button
							type="button"
							disabled={disabled}
							onClick={async () => {
								try {
									await onRemove?.();
									setRemoving(false);
								} catch (error) {
									setError(String(error));
								}
							}}
						>
							Remove project
						</button>
						<button type="button" onClick={() => setRemoving(false)}>
							Cancel
						</button>
					</div>
				</div>
			)}
			{error && (
				<p className="collection-empty select-text cursor-text" role="alert">
					{error}
				</p>
			)}
			{!collapsed && children}
		</section>
	);
}
