import { createTRPCProxyClient } from "@trpc/client";
import type { AppRouter } from "lib/trpc/routers";
import type { ComputerUseState } from "shared/computer-use";
import superjson from "superjson";
import { ipcLink } from "trpc-electron/renderer";
import "./computer-overlay.css";

document.body.dataset.kind =
	new URLSearchParams(location.search).get("kind") ?? "toolbar";
const status = document.getElementById("control-status");
const stop = document.getElementById("control-stop") as HTMLButtonElement;
const client = createTRPCProxyClient<AppRouter>({
	links: [ipcLink({ transformer: superjson })],
});
const labels: Record<string, string> = {
	Snapshot: "Reading the screen",
	Screenshot: "Looking at the screen",
	App: "Working with an app",
	Click: "Clicking",
	Type: "Typing",
	Scroll: "Scrolling",
	Move: "Moving the pointer",
	Shortcut: "Using the keyboard",
	Wait: "Waiting for the app",
};
function render(state: ComputerUseState) {
	document.body.dataset.active = String(Boolean(state.activity));
	document.body.dataset.phase = state.phase;
	stop.disabled = state.phase === "stopping";
	if (status)
		status.textContent =
			state.phase === "connecting"
				? "Connecting to Windows…"
				: state.phase === "stopping"
					? "Stopping computer control…"
					: state.activity
						? (labels[state.activity] ?? "Working on your desktop")
						: "Computer control ready";
}
stop.addEventListener("click", () => {
	stop.disabled = true;
	if (status) status.textContent = "Stopping computer control…";
	void client.codexSession.computerStop.mutate().catch(() => {
		if (status) status.textContent = "Use Ctrl + Alt + Shift + Esc to stop";
		stop.disabled = false;
	});
});
const subscription = client.codexSession.computerStream.subscribe(undefined, {
	onData: render,
	onError: () => {
		if (status) status.textContent = "Connection lost · use emergency stop";
		void client.codexSession.computerStop.mutate().catch(() => {});
	},
});
window.addEventListener("beforeunload", () => subscription.unsubscribe());
