import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import {
	Archive,
	Copy,
	MoreHorizontal,
	Pencil,
	Pin,
	Play,
	Terminal,
	Undo2,
} from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import type { SessionNotificationState } from "shared/session-notifications";
import { formatRelativeTime } from "../session-list-helpers";

export interface CollectionSession {
	provider: "codex" | "claude";
	sessionId: string;
	title: string;
	cwd: string | null;
	lastModified: number;
	pinned?: boolean;
}
export function SessionCollectionRow({
	session,
	live,
	status,
	archived,
	onOpen,
	onPin,
	onArchive,
	onRename,
	onCopy,
	onTerminal,
	dragHandle,
	organizationActions,
	projectLabel,
}: {
	session: CollectionSession;
	live: boolean;
	status?: SessionNotificationState["status"];
	archived: boolean;
	onOpen: () => void;
	onPin: () => void;
	onArchive: () => void;
	onRename: (title: string) => Promise<void>;
	onCopy?: () => void;
	onTerminal?: () => void;
	dragHandle?: ReactNode;
	organizationActions?: ReactNode;
	projectLabel?: string;
}) {
	const icon = usePresetIcon(session.provider);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(session.title);
	const committing = useRef(false);
	const [error, setError] = useState("");
	const focusInput = useCallback(
		(node: HTMLInputElement | null) => node?.focus(),
		[],
	);
	const rename = async () => {
		if (committing.current) return;
		committing.current = true;
		try {
			await onRename(draft.trim());
			setEditing(false);
			setError("");
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			committing.current = false;
		}
	};
	return (
		<div className="collection-session-row" data-status={status ?? "idle"}>
			{editing ? (
				<form
					className="collection-rename"
					onSubmit={(e) => {
						e.preventDefault();
						void rename();
					}}
				>
					<input
						ref={focusInput}
						aria-label={`Rename ${session.title}`}
						value={draft}
						required
						maxLength={120}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") setEditing(false);
						}}
					/>
					<button type="submit">Save</button>
					<button type="button" onClick={() => setEditing(false)}>
						Cancel
					</button>
					{error && <p className="select-text cursor-text">{error}</p>}
				</form>
			) : (
				<>
					{dragHandle}
					<button
						type="button"
						className="collection-session-open"
						onClick={onOpen}
						title={
							live
								? `${session.title} · Already open or unverified; opens a forked copy`
								: `${session.title}\n${session.cwd ?? ""}`
						}
					>
						<span className="collection-agent-icon">
							{icon && <img src={icon} alt="" />}
						</span>
						<span className="collection-session-copy">
							<span className="collection-session-title">{session.title}</span>
							<span className="collection-session-meta">
								{session.provider === "codex" ? "Codex" : "Claude"}
								{projectLabel ? ` · ${projectLabel}` : ""}
								{status === "working"
									? " · Working"
									: status === "attention"
										? " · Needs reply"
										: status === "completed"
											? " · Complete"
											: live
												? " · fork"
												: ""}
							</span>
						</span>
						<span className="collection-session-time">
							{formatRelativeTime(session.lastModified)}
						</span>
					</button>
					{session.pinned && (
						<Pin size={11} className="collection-pin" aria-label="Pinned" />
					)}
					<DropdownMenu modal={false}>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="collection-row-menu"
								aria-label={`Actions for ${session.title}`}
							>
								<MoreHorizontal size={16} />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="data-[state=closed]:animate-none"
							onCloseAutoFocus={(event) => {
								if (editing) event.preventDefault();
							}}
						>
							{organizationActions}
							<DropdownMenuItem onSelect={onOpen}>
								<Play size={14} />
								{live ? "Open a forked copy" : "Resume session"}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={onPin}>
								<Pin size={14} />
								{session.pinned ? "Unpin session" : "Pin session"}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									setDraft(session.title);
									setEditing(true);
								}}
							>
								<Pencil size={14} />
								Rename
							</DropdownMenuItem>
							{onCopy && (
								<DropdownMenuItem onSelect={onCopy}>
									<Copy size={14} />
									Copy resume command
								</DropdownMenuItem>
							)}
							{onTerminal && (
								<DropdownMenuItem onSelect={onTerminal}>
									<Terminal size={14} />
									Resume in terminal
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onSelect={onArchive}>
								{archived ? <Undo2 size={14} /> : <Archive size={14} />}{" "}
								{archived ? "Restore session" : "Archive session"}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</>
			)}
		</div>
	);
}
