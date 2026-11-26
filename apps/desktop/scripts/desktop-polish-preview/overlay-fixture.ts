import { mountComputerOverlay } from "../../src/renderer/computer-overlay-view";
import "../../src/renderer/computer-overlay.css";

document.body.dataset.kind = "preview";
const calls: string[] = [];
let moving = false;
let stopped = false;
const view = mountComputerOverlay({
	stop: async () => {
		calls.push("stop");
		moving = false;
		stopped = true;
		view.render({ phase: "off" });
		view.pointer(null);
		document.body.dataset.stopped = "true";
	},
	returnToSession: async () => {
		calls.push("return");
		const feedback = document.getElementById("fixture-feedback");
		if (feedback)
			feedback.textContent = "Returned to the controlling session (simulated).";
	},
});
view.render({ phase: "ready", activity: "Move" });
document.getElementById("fixture-move")?.addEventListener("click", () => {
	moving = true;
	stopped = false;
	document.body.dataset.stopped = "false";
	view.render({ phase: "ready", activity: "Move" });
	const started = performance.now();
	const frame = () => {
		if (!moving) return;
		const t = (performance.now() - started) / 1000;
		view.pointer({
			x: innerWidth / 2 + Math.sin(t * 1.5) * Math.min(200, innerWidth / 3),
			y: innerHeight / 2 + Math.cos(t * 1.5) * 70,
			displayX: screenX,
			displayY: screenY,
		});
		if (t < 5) requestAnimationFrame(frame);
		else {
			moving = false;
			view.render({ phase: "ready" });
			view.pointer(null);
		}
	};
	frame();
});
document.addEventListener("pointermove", (event) => {
	if (moving || stopped) return;
	view.render({ phase: "ready", activity: "Move" });
	view.pointer({
		x: event.clientX,
		y: event.clientY,
		displayX: screenX,
		displayY: screenY,
	});
});
Object.assign(window, { overlayFixture: { calls, view } });
