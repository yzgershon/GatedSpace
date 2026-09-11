/**
 * The pane header's overflow menu.
 *
 * It renders the SAME `ContextMenuActionConfig[]` the right-click menu does,
 * deliberately. The alternative — a second list of items maintained beside the
 * first — is how a menu ends up offering "Split right" in one place and not the
 * other, and there is no version of that which stays true.
 *
 * So this is a presentation of an existing menu, not a new one. Anything added
 * to `contextMenuActions`, by the workspace or by a pane kind, appears in both
 * without being wired twice.
 */
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { MoreHorizontalIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import type {
	ContextMenuActionConfig,
	RendererContext,
} from "../../../../../../../../../../types";

function OverflowItems<TData>({
	actions,
	context,
	onAction,
}: {
	actions: ContextMenuActionConfig<TData>[];
	context: RendererContext<TData>;
	onAction: (action: ContextMenuActionConfig<TData>) => void;
}) {
	return (
		<>
			{actions.map((action) => {
				if (action.type === "separator") {
					return <DropdownMenuSeparator key={action.key} />;
				}

				if (action.children) {
					const childActions =
						typeof action.children === "function"
							? action.children(context)
							: action.children;

					return (
						<DropdownMenuSub key={action.key}>
							<DropdownMenuSubTrigger className="gap-2">
								{action.icon}
								{action.label}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<OverflowItems
									actions={childActions}
									context={context}
									onAction={onAction}
								/>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					);
				}

				const disabled =
					typeof action.disabled === "function"
						? action.disabled(context)
						: action.disabled;

				const shortcut = action.shortcut ?? action.hotkeyId;

				return (
					// Same reasoning as the right-click menu: the shortcut is a
					// tooltip rather than a column, so no row is two lines tall.
					<DropdownMenuItem
						key={action.key}
						disabled={disabled}
						variant={action.variant}
						title={shortcut ? `${action.label} · ${shortcut}` : undefined}
						className="gap-2 whitespace-nowrap"
						onSelect={() => onAction(action)}
					>
						{action.icon}
						{action.label}
					</DropdownMenuItem>
				);
			})}
		</>
	);
}

export function PaneOverflowMenu<TData>({
	header,
	actions,
	context,
}: {
	header?: ReactNode;
	actions: ContextMenuActionConfig<TData>[];
	context: RendererContext<TData>;
}) {
	const pendingAction = useRef<ContextMenuActionConfig<TData> | null>(null);
	if (actions.length === 0) return null;

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label="Pane menu"
							className="flex size-8 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:text-foreground"
						>
							<MoreHorizontalIcon className="size-4" />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom" showArrow={false}>
					More
				</TooltipContent>
			</Tooltip>
			{/* The menu follows the session name; Radix handles edge collisions. */}
			<DropdownMenuContent
				align="start"
				className="min-w-[15rem] w-auto"
				onCloseAutoFocus={() => {
					const action = pendingAction.current;
					pendingAction.current = null;
					// Finish the menu's focus restoration before an action focuses
					// another control (for example, the inline rename field).
					if (action) queueMicrotask(() => action.onSelect?.(context));
				}}
			>
				{header}
				<OverflowItems
					actions={actions}
					context={context}
					onAction={(action) => {
						pendingAction.current = action;
					}}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
