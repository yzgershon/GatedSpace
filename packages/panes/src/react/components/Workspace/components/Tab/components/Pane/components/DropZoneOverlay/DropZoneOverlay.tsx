import type { SplitPosition } from "../../../../../../../../../types";

interface DropZoneOverlayProps {
	position: SplitPosition | null;
}

const ZONE_TRANSFORMS: Record<SplitPosition, string> = {
	top: "scaleY(0.5)",
	bottom: "translateY(50%) scaleY(0.5)",
	left: "scaleX(0.5)",
	right: "translateX(50%) scaleX(0.5)",
};

export function DropZoneOverlay({ position }: DropZoneOverlayProps) {
	if (!position) return null;

	return (
		<div className="pointer-events-none absolute inset-0 z-10">
			<div
				className="absolute inset-0 origin-top-left rounded-sm border-2 border-primary/70 bg-primary/10 transition-transform duration-150 ease-out motion-reduce:transition-none"
				style={{
					transform: ZONE_TRANSFORMS[position],
				}}
			/>
		</div>
	);
}
