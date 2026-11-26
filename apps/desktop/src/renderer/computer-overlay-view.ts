import type { ComputerPointer, ComputerUseState } from "shared/computer-use";

const labels: Record<string, string> = {
	Snapshot: "Reading the screen",
	Screenshot: "Looking at the screen",
	App: "Working with an app",
	Click: "Clicking",
	Type: "Typing",
	Scroll: "Scrolling",
	Move: "Moving the pointer",
	Drag: "Dragging",
	Shortcut: "Using the keyboard",
	Wait: "Waiting for the app",
};

/** Shared with the visual fixture; receives state, never initiates desktop input. */
export function mountComputerOverlay(actions: {
	stop: () => Promise<unknown>;
	returnToSession: () => Promise<unknown>;
}) {
	const status = document.getElementById("control-status");
	const stop = document.getElementById("control-stop") as HTMLButtonElement;
	const back = document.getElementById("control-return") as HTMLButtonElement;
	const help = document.getElementById("control-help") as HTMLButtonElement;
	const detail = document.getElementById("control-detail");
	const pointer = document.getElementById("control-pointer");
	if (!status || !detail || !pointer || !stop || !back || !help)
		throw new Error("Computer overlay is incomplete");
	let stopped = false;
	let pointerActive = false;
	let latestPoint: ComputerPointer | null = null;
	const drawPointer = () => {
		const point = latestPoint;
		const belongs =
			pointerActive &&
			point &&
			point.displayX === window.screenX &&
			point.displayY === window.screenY;
		pointer.hidden = !belongs;
		if (!point || !belongs) return;
		pointer.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
		pointer.dataset.left = String(point.x > innerWidth - 130);
		pointer.dataset.up = String(point.y > innerHeight - 50);
	};
	const onStop = () => {
		if (stopped) return;
		stopped = true;
		pointerActive = false;
		pointer.hidden = true;
		stop.disabled = true;
		status.textContent = "Stopping computer control…";
		void actions.stop().catch(() => {
			status.textContent = "Use Ctrl + Alt + Shift + Esc to stop";
			stopped = false;
			stop.disabled = false;
		});
	};
	const onBack = () => {
		void actions.returnToSession().catch(() => {
			status.textContent = "Could not open session. Try again.";
		});
	};
	const onHelp = () => {
		detail.hidden = !detail.hidden;
		help.setAttribute("aria-expanded", String(!detail.hidden));
		help.setAttribute(
			"aria-label",
			detail.hidden ? "Show control shortcuts" : "Hide control shortcuts",
		);
		document.body.dataset.details = String(!detail.hidden);
	};
	stop.addEventListener("click", onStop);
	back.addEventListener("click", onBack);
	help.addEventListener("click", onHelp);
	return {
		render(state: ComputerUseState) {
			pointerActive = state.phase === "ready" && Boolean(state.activity);
			document.body.dataset.active = String(Boolean(state.activity));
			document.body.dataset.phase = state.phase;
			stopped = state.phase === "stopping" || state.phase === "off";
			stop.disabled = stopped;
			status.textContent =
				state.phase === "off"
					? "Computer control stopped"
					: state.phase === "paused"
						? "Approved · reconnects when needed"
						: state.phase === "connecting"
							? (state.setupMessage ?? "Connecting to Windows…")
							: state.phase === "stopping"
								? "Stopping computer control…"
								: state.activity
									? (labels[state.activity] ?? "Working on your desktop")
									: "Ready for the next step";
			status.title = status.textContent;
			drawPointer();
		},
		pointer(point: ComputerPointer | null) {
			latestPoint = point;
			drawPointer();
		},
		dispose() {
			stop.removeEventListener("click", onStop);
			back.removeEventListener("click", onBack);
			help.removeEventListener("click", onHelp);
		},
	};
}
