/**
 * The tab strip, as one pill in the top bar.
 *
 * The strip charged a permanent 40px row across the whole window for a control
 * that answers a question you ask a few times an hour, and `TAB_WIDTH` is a
 * fixed 160px, so past three or four groups it was a row of truncated
 * prefixes. This says the full name of the group you are in and hands over the
 * list when you ask for it.
 *
 * DRAG IS THE PART THAT MATTERS. Dragging a pane out of its tab and onto empty
 * strip space was the one-gesture way to give a pane its own group, and
 * deleting the strip would have deleted the only drop target for it. So the
 * pill IS that target: drag a pane header onto it and the pane leaves its tab
 * for a new one, exactly as before. It announces itself mid-drag rather than
 * relying on anyone guessing, because an invisible drop target is not a
 * feature.
 *
 * Everything else the strip could do is still reachable. Dragging a pane onto
 * another pane still splits, a row switches, a row closes, and DOUBLE-CLICKING
 * THE PILL renames — the same gesture that renamed a tab, on the control that
 * replaced the tab. Rename matters more than it used to: with the strip gone
 * the group name is what the sidebar nests under and what the background-shell
 * list says a build belongs to, so "Tab 3" is a worse answer than it was.
 */

import type { PaneRegistry, WorkspaceStore } from "@superset/panes";
import { PANE_DRAG_TYPE, resolveTabTitle } from "@superset/panes";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import { LuChevronDown, LuGripVertical, LuPlus, LuX } from "react-icons/lu";
import { getV2NotificationSourcesForTab } from "renderer/stores/v2-notifications";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import { V2NotificationStatusIndicator } from "../V2NotificationStatusIndicator";

interface GroupSwitcherProps {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	registry: PaneRegistry<PaneViewerData>;
	/** Makes an undecided group, the same one `+` used to make on the strip. */
	onNewGroup: () => void;
	/** Rendered beside the group name — the `Ctrl+T` that opens a new one. */
	newGroupHint?: string;
	/**
	 * Closes a group through the SAME path the strip's × used.
	 *
	 * Not `store.removeTab` directly: that skips `onBeforeCloseTab`, which is
	 * the dirty-tab guard. A group holding a half-written prompt would close
	 * without asking, and the prompt is not recoverable.
	 */
	onCloseGroup: (tabId: string) => void;
}

interface PaneDragItem {
	paneId?: string;
}

export function GroupSwitcher({
	store,
	registry,
	onNewGroup,
	newGroupHint,
	onCloseGroup,
}: GroupSwitcherProps) {
	const tabs = useStore(store, (s) => s.tabs);
	const activeTabId = useStore(store, (s) => s.activeTabId);
	const [isOpen, setIsOpen] = useState(false);

	/*
	 * The strip's drop behaviour, kept whole.
	 *
	 * `canDrop` is false for a pane that is already alone in its tab: moving it
	 * out would destroy the tab it came from and create an identical one, so
	 * the gesture would look like it did nothing. Refusing it says so.
	 */
	const [{ isOver, canDrop }, connectDrop] = useDrop(
		() => ({
			accept: PANE_DRAG_TYPE,
			canDrop: (item: PaneDragItem) => {
				const paneId = item.paneId;
				if (!paneId) return false;
				const owner = store.getState().tabs.find((tab) => paneId in tab.panes);
				return !!owner && Object.keys(owner.panes).length > 1;
			},
			drop: (item: PaneDragItem) => {
				if (!item.paneId) return;
				store.getState().movePaneToNewTab({ paneId: item.paneId });
			},
			collect: (monitor) => ({
				isOver: monitor.isOver() && monitor.canDrop(),
				canDrop: monitor.canDrop(),
			}),
		}),
		[store],
	);

	const setRef = useCallback(
		(node: HTMLButtonElement | null) => {
			connectDrop(node);
		},
		[connectDrop],
	);

	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
	const activeTitle = activeTab
		? resolveTabTitle(activeTab, tabs, registry)
		: "No group";
	const activePaneCount = activeTab ? Object.keys(activeTab.panes).length : 0;

	/*
	 * Two pieces of state, not one nullable draft: the effect that focuses the
	 * field has to fire when editing STARTS and not on every keystroke, so it
	 * needs a dependency that only changes at that moment.
	 */
	const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!renamingTabId) return;
		// focus() before select(): the field mounts unfocused, and select() on
		// an unfocused input does not reliably focus it.
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [renamingTabId]);

	/*
	 * Reorder by dragging the grip, with POINTER events rather than HTML5 drag.
	 *
	 * The rows are Radix `DropdownMenuItem`s, which own pointerdown for their own
	 * selection and focus handling — an HTML5 draggable inside one does not
	 * reliably start a drag, which is why the list "wouldn't let me" reorder.
	 * Pointer events sidestep that entirely, and the grip is the only thing that
	 * starts a drag so an ordinary click still selects the group.
	 *
	 * The target index is read from the actual row rectangles rather than from a
	 * fixed row height: a row with a status dot and a count is not the same
	 * height as a bare one, and assuming otherwise makes the drop land one row
	 * off near the bottom of a long list.
	 */
	const listRef = useRef<HTMLDivElement>(null);
	const dragTabIdRef = useRef<string | null>(null);
	const didDragRef = useRef(false);

	const handleGripPointerDown = (
		event: React.PointerEvent<HTMLButtonElement>,
		tabId: string,
	) => {
		// Stop Radix treating this as a selection, and stop the menu closing.
		event.preventDefault();
		event.stopPropagation();
		dragTabIdRef.current = tabId;
		didDragRef.current = false;

		const onMove = (moveEvent: PointerEvent) => {
			const dragTabId = dragTabIdRef.current;
			const list = listRef.current;
			if (!dragTabId || !list) return;

			const rows = Array.from(
				list.querySelectorAll<HTMLElement>("[data-tab-id]"),
			);
			const targetIndex = rows.findIndex((row) => {
				const rect = row.getBoundingClientRect();
				return (
					moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom
				);
			});
			if (targetIndex < 0) return;

			const currentIndex = store
				.getState()
				.tabs.findIndex((tab) => tab.id === dragTabId);
			if (currentIndex === targetIndex) return;

			didDragRef.current = true;
			// Reorder live, so the row follows the cursor instead of waiting for a
			// drop nobody can see the target of.
			store.getState().reorderTab({ tabId: dragTabId, toIndex: targetIndex });
		};

		const onUp = () => {
			dragTabIdRef.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			// Cleared on the next tick: pointerup is followed by the row's click,
			// and that is the one that must not select a group you were dragging.
			setTimeout(() => {
				didDragRef.current = false;
			}, 0);
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const startRename = () => {
		if (!activeTab) return;
		setRenamingTabId(activeTab.id);
		setDraftTitle(activeTitle);
	};

	const commitRename = () => {
		const tabId = renamingTabId;
		const next = draftTitle.trim();
		setRenamingTabId(null);
		if (!tabId) return;
		store.getState().setTabTitleOverride({
			tabId,
			// An empty name is a request to go back to the derived one, not a
			// request for a blank pill. The same rule the tab strip used.
			titleOverride: next.length > 0 ? next : undefined,
		});
	};

	if (renamingTabId) {
		return (
			<input
				ref={inputRef}
				value={draftTitle}
				aria-label="Group name"
				className="no-drag h-8 w-[220px] rounded-full bg-accent/40 px-3 text-[13.5px] text-foreground outline-none ring-1 ring-highlight/50"
				onBlur={commitRename}
				onChange={(event) => setDraftTitle(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitRename();
					} else if (event.key === "Escape") {
						event.preventDefault();
						setRenamingTabId(null);
					}
				}}
			/>
		);
	}

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<DropdownMenuTrigger asChild>
				<button
					ref={setRef}
					type="button"
					className={cn(
						"no-drag flex h-9 min-w-0 max-w-[280px] items-center gap-2 rounded-full px-3.5 text-[14.5px] text-foreground/80 transition-colors",
						"hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						// Mid-drag the pill stops being a label and starts being a
						// target, and says which of the two it currently is.
						canDrop && "ring-1 ring-highlight/40",
						isOver && "bg-highlight/15 text-foreground ring-1 ring-highlight",
					)}
					onDoubleClick={(event) => {
						if (!activeTab) return;
						// The first click of the double already opened the menu, and
						// Radix opens on pointerdown, so it has to be closed here or
						// it hangs under the rename field.
						event.preventDefault();
						event.stopPropagation();
						setIsOpen(false);
						startRename();
					}}
				>
					{canDrop ? (
						<span className="truncate">
							{isOver ? "Release for a new group" : "Drop for a new group"}
						</span>
					) : (
						<>
							<span className="min-w-0 truncate">{activeTitle}</span>
							{activePaneCount > 1 ? (
								<span className="shrink-0 text-[11px] text-muted-foreground/60">
									{activePaneCount}
								</span>
							) : null}
							<LuChevronDown className="size-3.5 shrink-0 opacity-50" />
						</>
					)}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-72">
				<div ref={listRef}>
					{tabs.map((tab) => {
						const title = resolveTabTitle(tab, tabs, registry);
						const paneCount = Object.keys(tab.panes).length;
						return (
							<DropdownMenuItem
								key={tab.id}
								data-tab-id={tab.id}
								className="group flex items-center gap-2"
								onSelect={(event) => {
									// A drag ends with a click on the row it landed on.
									// Selecting there would switch groups every reorder.
									if (didDragRef.current) {
										event.preventDefault();
										return;
									}
									store.getState().setActiveTab(tab.id);
								}}
							>
								<button
									type="button"
									aria-label={`Reorder ${title}`}
									className="-ml-1 shrink-0 cursor-grab rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover:opacity-100"
									onPointerDown={(event) =>
										handleGripPointerDown(event, tab.id)
									}
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
									}}
								>
									<LuGripVertical className="size-3" />
								</button>
								<V2NotificationStatusIndicator
									sources={getV2NotificationSourcesForTab(tab)}
								/>
								<span
									className={cn(
										"min-w-0 flex-1 truncate text-xs",
										tab.id === activeTabId && "font-medium text-foreground",
									)}
								>
									{title}
								</span>
								{paneCount > 1 ? (
									<span className="shrink-0 text-[11px] text-muted-foreground/60">
										{paneCount}
									</span>
								) : null}
								{/*
								 * Close stays on the row rather than behind a context menu:
								 * the strip put an × on every tab, and losing it would make
								 * the pill a worse control than the thing it replaced.
								 */}
								<button
									type="button"
									aria-label={`Close ${title}`}
									className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										onCloseGroup(tab.id);
									}}
								>
									<LuX className="size-3" />
								</button>
							</DropdownMenuItem>
						);
					})}
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onNewGroup}>
					<LuPlus className="size-3.5 shrink-0 opacity-70" />
					<span className="flex-1 text-xs">New group</span>
					{newGroupHint ? (
						<span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
							{newGroupHint}
						</span>
					) : null}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
