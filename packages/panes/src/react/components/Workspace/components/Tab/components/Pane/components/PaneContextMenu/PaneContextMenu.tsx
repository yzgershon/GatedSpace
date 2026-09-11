import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { type ReactNode, useRef } from "react";
import type {
	ContextMenuActionConfig,
	RendererContext,
} from "../../../../../../../../types";

interface PaneContextMenuProps<TData> {
	children: ReactNode;
	header?: ReactNode;
	actions: ContextMenuActionConfig<TData>[];
	context: RendererContext<TData>;
}

function ContextMenuItems<TData>({
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
					return <ContextMenuSeparator key={action.key} />;
				}

				if (action.children) {
					const childActions =
						typeof action.children === "function"
							? action.children(context)
							: action.children;

					return (
						<ContextMenuSub key={action.key}>
							<ContextMenuSubTrigger className="gap-2">
								{action.icon}
								{action.label}
							</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								<ContextMenuItems
									actions={childActions}
									context={context}
									onAction={onAction}
								/>
							</ContextMenuSubContent>
						</ContextMenuSub>
					);
				}

				const disabled =
					typeof action.disabled === "function"
						? action.disabled(context)
						: action.disabled;

				const shortcut = action.shortcut ?? action.hotkeyId;

				return (
					/*
					 * The shortcut is a TOOLTIP, not a column.
					 *
					 * Rendered inline it claimed the right half of every row, and the
					 * long ones — "Ctrl+Alt+Shift+E" — pushed the label onto a second
					 * line. Ten items each two lines tall is a menu you scroll rather
					 * than scan, for a hint most rows do not need. `title` puts it one
					 * hover away and costs no width, and `whitespace-nowrap` stops the
					 * label wrapping now that nothing competes with it.
					 */
					<ContextMenuItem
						key={action.key}
						disabled={disabled}
						variant={action.variant}
						title={shortcut ? `${action.label} · ${shortcut}` : undefined}
						className="gap-2 whitespace-nowrap"
						onSelect={() => onAction(action)}
					>
						{action.icon}
						{action.label}
					</ContextMenuItem>
				);
			})}
		</>
	);
}

export function PaneContextMenu<TData>({
	header,
	children,
	actions,
	context,
}: PaneContextMenuProps<TData>) {
	const pendingAction = useRef<ContextMenuActionConfig<TData> | null>(null);
	if (actions.length === 0) {
		return <>{children}</>;
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent
				onCloseAutoFocus={() => {
					const action = pendingAction.current;
					pendingAction.current = null;
					if (action) queueMicrotask(() => action.onSelect?.(context));
				}}
			>
				{header}
				<ContextMenuItems
					actions={actions}
					context={context}
					onAction={(action) => {
						pendingAction.current = action;
					}}
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}
