/**
 * Stops Chromium's middle-click autoscroll.
 *
 * Middle-clicking a scrollable area in Chromium enters autoscroll mode: a
 * four-way scroll puck appears anchored to the pointer and follows it until the
 * next click. In a browser that is a feature. Here it is an artefact, because
 * middle-click already means "close this tab or pane" — so every miss, or every
 * middle-click that lands on the diff instead of the header, leaves a scroll
 * icon stuck to the cursor over the code.
 *
 * Suppressed at `mousedown` on the CAPTURE phase, because autoscroll begins on
 * mousedown and a listener that waits for the bubble phase runs after something
 * else may have stopped propagation. Only the middle button is touched; left
 * and right behave normally, and middle-click handlers still fire on `auxclick`
 * because preventing the default does not stop the click event.
 */
export function suppressMiddleClickAutoscroll(
	target: Pick<
		EventTarget,
		"addEventListener" | "removeEventListener"
	> = window,
): () => void {
	const onMouseDown = (event: Event) => {
		if ((event as MouseEvent).button !== 1) return;
		event.preventDefault();
	};

	target.addEventListener("mousedown", onMouseDown, { capture: true });
	return () => {
		target.removeEventListener("mousedown", onMouseDown, { capture: true });
	};
}
