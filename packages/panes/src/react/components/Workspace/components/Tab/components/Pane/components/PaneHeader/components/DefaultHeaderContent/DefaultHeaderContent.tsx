import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { PaneTitleEditor } from "../PaneTitleEditor";

interface DefaultHeaderContentProps {
	title: ReactNode;
	icon?: ReactNode;
	headerLead?: ReactNode;
	isActive: boolean;
	titleContent?: ReactNode;
	headerExtras?: ReactNode;
	titleTrailing?: ReactNode;
	headerCenter?: ReactNode;
	actionsContent: ReactNode;
	titleActions?: ReactNode;
	maximizeControl?: ReactNode;
	overflowControl?: ReactNode;
	paneId?: string;
	/**
	 * Rename this pane. Absent for panes whose title isn't a plain string —
	 * a pane that renders its own title widget owns what that title means.
	 */
	onRename?: (title: string | undefined) => void;
}

export function DefaultHeaderContent({
	title,
	icon,
	headerLead,
	isActive,
	titleContent,
	headerExtras,
	titleTrailing,
	headerCenter,
	actionsContent,
	titleActions,
	maximizeControl,
	overflowControl,
	paneId,
	onRename,
}: DefaultHeaderContentProps) {
	return (
		<div className="@container relative flex h-full w-full min-w-0 items-center gap-2 px-3">
			<div className="relative z-10 flex min-w-0 flex-1 items-center gap-2 @min-[640px]:max-w-[calc(50%-50px)]">
				{headerLead}
				{titleContent ?? (
					<>
						{!headerLead && icon && <span className="shrink-0">{icon}</span>}
						{onRename && typeof title === "string" ? (
							<PaneTitleEditor
								title={title}
								isActive={isActive}
								onRename={onRename}
								paneId={paneId}
							/>
						) : (
							<span
								className={cn(
									"truncate text-[length:var(--gs-pane-title-size,14px)] font-medium transition-colors duration-150",
									isActive ? "text-foreground" : "text-muted-foreground",
								)}
								title={typeof title === "string" ? title : undefined}
							>
								{title}
							</span>
						)}
					</>
				)}
				{titleActions}
				{overflowControl}
				{/*
				 * Sits with the title, not across the pane with the window
				 * controls, and gets its own margin so a name and a folder do not
				 * read as one run-on string.
				 */}
				{titleTrailing ? (
					<span className="ml-1 flex shrink-0 items-center">
						{titleTrailing}
					</span>
				) : null}
			</div>
			{/*
			 * Centred against the PANE, not packed between the two clusters.
			 *
			 * `absolute inset-x-0 mx-auto w-fit` is the same trick the top bar's
			 * presets use: out of flow, so a long title on the left or an extra
			 * action on the right cannot shove it off centre. `pointer-events-none`
			 * because it is a readout, and it overlaps a draggable header.
			 */}
			{headerCenter ? (
				<div className="pointer-events-none absolute inset-x-0 mx-auto hidden w-fit items-center @min-[640px]:flex">
					{headerCenter}
				</div>
			) : null}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: stop drag from starting on action buttons */}
			<div
				className="ml-auto flex shrink-0 items-center gap-0.5"
				onMouseDown={(e) => e.stopPropagation()}
			>
				{headerExtras}
				{/* Expand precedes the shared panel toggles and close button. */}
				{maximizeControl}
				{actionsContent}
			</div>
		</div>
	);
}
