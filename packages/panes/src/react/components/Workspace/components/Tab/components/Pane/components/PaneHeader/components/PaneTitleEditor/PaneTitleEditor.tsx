import { cn } from "@superset/ui/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { resolvePaneRename } from "./resolve-rename";

interface PaneTitleEditorProps {
	title: string;
	isActive: boolean;
	onRename: (title: string | undefined) => void;
	paneId?: string;
	children?: ReactNode;
}

export const PANE_RENAME_EVENT = "superset:pane-rename";
export function requestPaneRename(paneId: string): void {
	window.dispatchEvent(
		new CustomEvent(PANE_RENAME_EVENT, { detail: { paneId } }),
	);
}

/** Rename from the pane menu or by double-clicking the title. Blur saves; Escape cancels. */
export function PaneTitleEditor({
	title,
	isActive,
	onRename,
	paneId,
	children,
}: PaneTitleEditorProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const inputRef = useRef<HTMLInputElement>(null);
	// Escape has to restore what the field opened with, not the last committed
	// value — those differ the moment someone types.
	const committedRef = useRef(false);

	useEffect(() => {
		if (!isEditing) return;
		const input = inputRef.current;
		if (!input) return;
		input.focus();
		input.select();
	}, [isEditing]);

	function begin() {
		committedRef.current = false;
		setDraft(title);
		setIsEditing(true);
	}

	// `title` is read inside `begin`, so the listener is re-registered when it
	// changes rather than capturing a stale name in the closure.
	useEffect(() => {
		if (!paneId) return;
		const onRequest = (event: Event) => {
			const detail = (event as CustomEvent<{ paneId?: string }>).detail;
			if (detail?.paneId !== paneId) return;
			committedRef.current = false;
			setDraft(title);
			setIsEditing(true);
		};
		window.addEventListener(PANE_RENAME_EVENT, onRequest);
		return () => window.removeEventListener(PANE_RENAME_EVENT, onRequest);
	}, [paneId, title]);

	function commit() {
		if (committedRef.current) return;
		committedRef.current = true;
		setIsEditing(false);
		const resolution = resolvePaneRename(draft, title);
		if (!resolution.shouldRename) return;
		onRename(resolution.title);
	}

	function cancel() {
		committedRef.current = true;
		setIsEditing(false);
		setDraft(title);
	}

	if (!isEditing) {
		return (
			<span className="group/rename flex min-w-0 items-center gap-1">
				{children ?? (
					// biome-ignore lint/a11y/noStaticElementInteractions: the pane menu provides keyboard rename
					<span
						className={cn(
							"truncate gs-pane-title text-[length:var(--gs-pane-title-size,14px)] font-medium transition-colors duration-150",
							isActive ? "text-foreground" : "text-muted-foreground",
						)}
						title={title}
						onDoubleClick={(event) => {
							// The header is a drag handle and a click target; without this a
							// rename also pins the pane and starts a drag.
							event.stopPropagation();
							event.preventDefault();
							begin();
						}}
					>
						{title}
					</span>
				)}
			</span>
		);
	}

	return (
		<input
			ref={inputRef}
			value={draft}
			aria-label="Rename pane"
			className={cn(
				"min-w-0 flex-1 bg-transparent gs-pane-title text-[length:var(--gs-pane-title-size,14px)] font-medium outline-none",
				"rounded-sm border border-border px-1 py-0 text-foreground",
			)}
			onChange={(event) => setDraft(event.target.value)}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onBlur={commit}
			onKeyDown={(event) => {
				// The workspace binds plenty of single-key shortcuts; without this
				// typing a name triggers them.
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					commit();
				} else if (event.key === "Escape") {
					event.preventDefault();
					cancel();
				}
			}}
		/>
	);
}
