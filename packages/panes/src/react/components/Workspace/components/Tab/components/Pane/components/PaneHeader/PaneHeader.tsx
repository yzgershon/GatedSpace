import { cn } from "@superset/ui/utils";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useDrag } from "react-dnd";
import { getEmptyDragImage } from "../../../../../../utils/emptyDragImage";
import { DefaultHeaderContent } from "./components/DefaultHeaderContent";

interface PaneHeaderProps {
	title: ReactNode;
	icon?: ReactNode;
	isActive: boolean;
	titleContent?: ReactNode;
	headerExtras?: ReactNode;
	actionsContent: ReactNode;
	toolbar?: ReactNode;
	maximizeControl?: ReactNode;
	paneId?: string;
	onClick?: () => void;
	onMiddleClick?: () => void;
	/** Double-click-to-rename, when the pane's title is a plain string. */
	onRename?: (title: string | undefined) => void;
	/** CSS colour identifying what this pane runs. Undefined = neutral header. */
	accent?: string;
}

export const PANE_DRAG_TYPE = "pane";

export function PaneHeader({
	title,
	icon,
	isActive,
	titleContent,
	headerExtras,
	actionsContent,
	toolbar,
	maximizeControl,
	paneId,
	onClick,
	onMiddleClick,
	onRename,
	accent,
}: PaneHeaderProps) {
	const [{ isDragging }, connectDrag, connectDragPreview] = useDrag(
		() => ({
			type: PANE_DRAG_TYPE,
			item: { paneId },
			canDrag: !!paneId,
			collect: (monitor) => ({
				isDragging: monitor.isDragging(),
			}),
		}),
		[paneId],
	);

	// See TabItem: Chromium's default drag image is a snapshot of the element,
	// which on a dark header renders as a black rectangle following the cursor.
	useEffect(() => {
		connectDragPreview(getEmptyDragImage(), { captureDraggingState: true });
	}, [connectDragPreview]);

	const nodeRef = useRef<HTMLDivElement>(null);
	const setRef = useCallback(
		(node: HTMLDivElement | null) => {
			(nodeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
			connectDrag(node);
		},
		[connectDrag],
	);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: pane header click-to-pin doesn't need keyboard equivalent
		// biome-ignore lint/a11y/noStaticElementInteractions: click to pin, middle-click to close
		<div
			ref={setRef}
			className={cn(
				"relative flex h-7 shrink-0 items-center transition-[background-color] duration-150",
				isActive ? "bg-muted" : "bg-transparent",
				isDragging && "opacity-30",
			)}
			style={
				// Tint the FOCUSED header with the pane's own colour, over the muted
				// background it already had. 17% is the ceiling found while previewing
				// this: past roughly a quarter the tint starts competing with the
				// terminal output directly beneath it, and the header stops reading as
				// chrome. `color-mix` so the result tracks the active theme instead of
				// being two hardcoded colours.
				accent && isActive
					? {
							backgroundColor: `color-mix(in oklab, ${accent} 17%, var(--muted))`,
						}
					: undefined
			}
			onClick={onClick}
			onAuxClick={(e) => {
				if (e.button === 1 && onMiddleClick) {
					e.preventDefault();
					onMiddleClick();
				}
			}}
		>
			{accent && (
				/*
				 * The bar stays visible when the pane is unfocused, just dimmer. It
				 * answers "what is this pane" — which is worth knowing about the panes
				 * you are NOT looking at, and is the whole reason to spend colour here.
				 * Only the tint is focus-dependent.
				 */
				<span
					aria-hidden
					className="pointer-events-none absolute inset-y-0 left-0 w-0.5 transition-opacity duration-150"
					style={{ backgroundColor: accent, opacity: isActive ? 1 : 0.45 }}
				/>
			)}
			{toolbar ? (
				<>
					<div className="min-w-0 flex-1">{toolbar}</div>
					{maximizeControl && (
						// biome-ignore lint/a11y/noStaticElementInteractions: stop drag from starting on the control
						<div
							className="flex shrink-0 items-center pr-2"
							onMouseDown={(e) => e.stopPropagation()}
						>
							{maximizeControl}
						</div>
					)}
				</>
			) : (
				<DefaultHeaderContent
					title={title}
					icon={icon}
					isActive={isActive}
					titleContent={titleContent}
					headerExtras={headerExtras}
					actionsContent={actionsContent}
					maximizeControl={maximizeControl}
					onRename={onRename}
				/>
			)}
		</div>
	);
}
