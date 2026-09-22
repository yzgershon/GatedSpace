import type { Terminal } from "@xterm/xterm";

type Point = Pick<MouseEvent, "clientX" | "clientY">;
type MouseCoords = {
	getCoords(
		event: Point,
		element: HTMLElement,
		cols: number,
		rows: number,
		selection?: boolean,
	): [number, number] | undefined;
	getMouseReportCoords(
		event: Point,
		element: HTMLElement,
	): { col: number; row: number; x: number; y: number } | undefined;
};
type Selection = {
	_screenElement: HTMLElement;
	_getMouseEventScrollAmount(event: Point): number;
};

// xterm compares viewport coordinates with unscaled CSS cell dimensions. The
// workspace uses CSS zoom, so convert only that coordinate boundary, keeping
// xterm's selection rounding, word selection and mouse protocols intact.
function unscale(event: Point, element: HTMLElement): Point {
	const rect = element.getBoundingClientRect();
	const style = getComputedStyle(element);
	const box = (axis: "width" | "height") => {
		let size = Number.parseFloat(style[axis]);
		if (style.boxSizing !== "border-box") {
			const edges = axis === "width" ? ["Left", "Right"] : ["Top", "Bottom"];
			for (const edge of edges) {
				size +=
					Number.parseFloat(
						style.getPropertyValue(`padding-${edge.toLowerCase()}`),
					) || 0;
				size +=
					Number.parseFloat(
						style.getPropertyValue(`border-${edge.toLowerCase()}-width`),
					) || 0;
			}
		}
		return size;
	};
	const sx = rect.width / box("width");
	const sy = rect.height / box("height");
	return {
		clientX:
			sx > 0 && Number.isFinite(sx)
				? rect.left + (event.clientX - rect.left) / sx
				: event.clientX,
		clientY:
			sy > 0 && Number.isFinite(sy)
				? rect.top + (event.clientY - rect.top) / sy
				: event.clientY,
	};
}

/** Scoped to the pinned xterm internals; restored when the terminal is disposed. */
export function installTerminalMouseCoordinates(
	terminal: Terminal,
): () => void {
	const core = (
		terminal as unknown as {
			_core: {
				_mouseCoordsService?: MouseCoords;
				_selectionService?: Selection;
			};
		}
	)._core;
	const mouse = core._mouseCoordsService;
	const selection = core._selectionService;
	if (!mouse || !selection) {
		console.warn("[terminal] Mouse coordinate services unavailable");
		return () => {};
	}
	const getCoords = mouse.getCoords;
	const getReport = mouse.getMouseReportCoords;
	const getScroll = selection._getMouseEventScrollAmount;
	mouse.getCoords = function (event, element, ...args) {
		return getCoords.call(this, unscale(event, element), element, ...args);
	};
	mouse.getMouseReportCoords = function (event, element) {
		return getReport.call(this, unscale(event, element), element);
	};
	selection._getMouseEventScrollAmount = function (event) {
		return getScroll.call(this, unscale(event, this._screenElement));
	};
	return () => {
		mouse.getCoords = getCoords;
		mouse.getMouseReportCoords = getReport;
		selection._getMouseEventScrollAmount = getScroll;
	};
}
