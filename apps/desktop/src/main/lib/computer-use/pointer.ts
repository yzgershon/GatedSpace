import { screen } from "electron";
import type { ComputerPointer } from "../../../shared/computer-use";
import { ComputerPointerTracker } from "./pointer-tracker";
import { computerUseService } from "./service";

/** Read position only; no hooks, cursor replacement, screen capture or input. */

const tracker = new ComputerPointerTracker(computerUseService, () => {
	const point = screen.getCursorScreenPoint();
	const { bounds } = screen.getDisplayNearestPoint(point);
	return {
		x: point.x - bounds.x,
		y: point.y - bounds.y,
		displayX: bounds.x,
		displayY: bounds.y,
	};
});
export function observeComputerPointer(
	listener: (point: ComputerPointer | null) => void,
) {
	return tracker.subscribe(listener);
}
