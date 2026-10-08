import {
	Archive,
	Check,
	MoreHorizontal,
	Pencil,
	Pin,
	PinOff,
	X,
} from "lucide-react";
import { useState } from "react";
import claude from "../../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import { type Session, statusLabels } from "../data";

export function SessionRow({
	session,
	selected,
	detailed,
	onSelect,
	onUpdate,
	onArchive,
}: {
	session: Session;
	selected: boolean;
	detailed: boolean;
	onSelect: () => void;
	onUpdate: (update: Partial<Session>) => void;
	onArchive: () => void;
}) {
	const [menu, setMenu] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [name, setName] = useState(session.title);
	const save = () => {
		if (name.trim()) {
			onUpdate({ title: name.trim() });
			setRenaming(false);
		}
	};
	return (
		<div
			className={`session-row ${selected ? "selected" : ""}`}
			data-session={session.id}
		>
			{renaming ? (
				<form
					className="rename-row"
					onSubmit={(e) => {
						e.preventDefault();
						save();
					}}
				>
					<input
						aria-label="Session name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						ref={(el) => el?.focus()}
						onKeyDown={(e) => {
							if (e.key === "Escape") setRenaming(false);
						}}
					/>
					<button className="icon-button" aria-label="Save name" type="submit">
						<Check />
					</button>
					<button
						className="icon-button"
						aria-label="Cancel rename"
						type="button"
						onClick={() => setRenaming(false)}
					>
						<X />
					</button>
				</form>
			) : (
				<>
					<button
						type="button"
						className="session-open"
						onClick={onSelect}
						aria-label={`Open ${session.title}`}
						aria-current={selected ? "true" : undefined}
					>
						<span
							className={`agent-mark ${session.status}`}
							title={statusLabels[session.status]}
						>
							<img
								src={session.provider === "claude" ? claude : codex}
								alt={session.provider === "claude" ? "Claude" : "Codex"}
							/>
						</span>
						<span className="session-copy">
							<span className="row-title">{session.title}</span>
							<span className="row-meta">
								{session.project}
								<span className={`status-label ${session.status}`}>
									{session.status === "idle"
										? session.time
										: statusLabels[session.status]}
								</span>
							</span>
							{detailed && (
								<span className="row-preview">{session.preview}</span>
							)}
						</span>
					</button>
					{session.pinned && <Pin className="pin-marker" aria-label="Pinned" />}
					<button
						type="button"
						className="icon-button row-more"
						aria-label={`Actions for ${session.title}`}
						aria-expanded={menu}
						onClick={() => setMenu(!menu)}
					>
						<MoreHorizontal />
					</button>
				</>
			)}
			{menu && (
				<>
					<button
						type="button"
						className="menu-dismiss"
						aria-label="Close session actions"
						onClick={() => setMenu(false)}
					/>
					<fieldset
						className="row-menu"
						aria-label="Session actions"
						onKeyDown={(e) => {
							if (e.key === "Escape") setMenu(false);
						}}
					>
						<button
							type="button"
							onClick={() => {
								onUpdate({ pinned: !session.pinned });
								setMenu(false);
							}}
						>
							{session.pinned ? <PinOff /> : <Pin />}
							{session.pinned ? "Unpin session" : "Pin session"}
						</button>
						<button
							type="button"
							onClick={() => {
								setName(session.title);
								setRenaming(true);
								setMenu(false);
							}}
						>
							<Pencil />
							Rename
						</button>
						<button
							type="button"
							onClick={() => {
								onArchive();
								setMenu(false);
							}}
						>
							<Archive />
							Archive
						</button>
					</fieldset>
				</>
			)}
		</div>
	);
}
