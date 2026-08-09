import { cn } from "@superset/ui/utils";
import { useEffect, useRef, useState } from "react";
import { resolvePaneRename } from "./resolve-rename";

interface PaneTitleEditorProps {
	/** The title as currently displayed, override or derived. */
	title: string;
	isActive: boolean;
	/** Commit a new name, or `undefined` to fall back to the derived title. */
	onRename: (title: string | undefined) => void;
}

/**
 * Rename a pane: click the pencil, or double-click the title.
 *
 * The pencil exists because double-click alone is invisible. Renaming has
 * always worked here, and was reported as a missing feature — which is the
 * same thing as not having it. It sits at 60% on the focused pane so the
 * affordance is present without being loud, and fades up on hover.
 *
 * Clearing the field restores the DERIVED title rather than leaving the pane
 * blank — four terminals called "" is worse than four called "zsh", and it is
 * the only way back once a name has been set.
 *
 * Blur commits, matching every other inline rename people use (file explorers,
 * editor tabs). Escape is the explicit way out, and it restores the value the
 * field opened with rather than the last keystroke.
 */
export function PaneTitleEditor({
	title,
	isActive,
	onRename,
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
				{/* biome-ignore lint/a11y/noStaticElementInteractions: rename is a pointer affordance layered on a drag handle; the pencil beside it carries the accessible path */}
				<span
					className={cn(
						"truncate text-xs transition-colors duration-150",
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
				<button
					type="button"
					aria-label="Rename pane"
					title="Rename"
					className={cn(
						"shrink-0 rounded p-0.5 text-muted-foreground transition-opacity duration-150",
						"hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none",
						"group-hover/rename:opacity-100",
						isActive ? "opacity-60" : "opacity-0",
					)}
					// Same reason as the title's dblclick: this lives on a drag handle
					// that also pins the pane on click.
					onMouseDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						event.preventDefault();
						begin();
					}}
				>
					<svg
						width="11"
						height="11"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M12 20h9" />
						<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
					</svg>
				</button>
			</span>
		);
	}

	return (
		<input
			ref={inputRef}
			value={draft}
			aria-label="Rename pane"
			className={cn(
				"min-w-0 flex-1 bg-transparent text-xs outline-none",
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
