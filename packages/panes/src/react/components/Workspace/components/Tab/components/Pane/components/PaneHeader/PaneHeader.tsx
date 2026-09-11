import { cn } from "@superset/ui/utils";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useDrag } from "react-dnd";
import { getEmptyDragImage } from "../../../../../../utils/emptyDragImage";
import { DefaultHeaderContent } from "./components/DefaultHeaderContent";

interface PaneHeaderProps {
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
	toolbar?: ReactNode;
	maximizeControl?: ReactNode;
	overflowControl?: ReactNode;
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
	headerLead,
	isActive,
	titleContent,
	headerExtras,
	titleTrailing,
	headerCenter,
	actionsContent,
	titleActions,
	toolbar,
	maximizeControl,
	overflowControl,
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
				"relative flex h-[var(--gs-pane-header-height,40px)] shrink-0 items-center transition-[background-color] duration-150",
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
				/*
				 * The tint STRENGTH is a variable so the host can switch it off.
				 * With a status dot and an agent mark at the head of the row, the
				 * wash is a third thing saying the same thing — and it was the
				 * loudest object on screen. Defaults to the 17% it always used, so
				 * a host that sets nothing is unchanged.
				 */
				accent && isActive
					? {
							backgroundColor: `color-mix(in oklab, ${accent} var(--gs-pane-header-tint, 17%), var(--muted))`,
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
			{accent && !isActive && (
				/*
				 * Only on the panes you are NOT looking at.
				 *
				 * This 2px bar answers "what is this pane" for the unfocused ones,
				 * which is the whole reason to spend colour here. On the FOCUSED pane
				 * it was fighting the active-pane ring for identical pixels: the ring
				 * is a 2px inset shadow on the pane's left edge, this was a 2px
				 * absolute bar at `left-0` of a header flush to that same edge. Two
				 * elements painting the same colour in the same 2px, one clipping the
				 * other depending on stacking — which is exactly what it looked like,
				 * a bar leaking over the frame.
				 *
				 * The ring says it better anyway: it is the same accent, and it runs
				 * the whole pane rather than the header. So the bar stands down when
				 * the ring is up. The header tint stays either way.
				 */
				<span
					aria-hidden
					className="pointer-events-none absolute inset-y-0 left-0 w-0.5 transition-opacity duration-150"
					style={{
						backgroundColor: accent,
						// Same reasoning as the tint: a variable so the host can drop
						// it once the header carries a dot instead.
						opacity: "var(--gs-pane-header-bar, 0.45)",
					}}
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
					headerLead={headerLead}
					isActive={isActive}
					titleContent={titleContent}
					headerExtras={headerExtras}
					titleTrailing={titleTrailing}
					headerCenter={headerCenter}
					overflowControl={overflowControl}
					paneId={paneId}
					actionsContent={actionsContent}
					titleActions={titleActions}
					maximizeControl={maximizeControl}
					onRename={onRename}
				/>
			)}
		</div>
	);
}
