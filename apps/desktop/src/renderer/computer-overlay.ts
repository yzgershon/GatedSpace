import { createTRPCProxyClient } from "@trpc/client";
import type { AppRouter } from "lib/trpc/routers";
import superjson from "superjson";
import { ipcLink } from "trpc-electron/renderer";
import "./computer-overlay.css";
import { mountComputerOverlay } from "./computer-overlay-view";

document.body.dataset.kind =
	new URLSearchParams(location.search).get("kind") ?? "toolbar";
const client = createTRPCProxyClient<AppRouter>({
	links: [ipcLink({ transformer: superjson })],
});
const view = mountComputerOverlay({
	stop: () => client.codexSession.computerStop.mutate(),
	returnToSession: () => client.notifications.returnToComputerSession.mutate(),
});
const subscription = client.codexSession.computerStream.subscribe(undefined, {
	onData: view.render,
	onError: () => {
		view.render({ phase: "stopping" });
		void client.codexSession.computerStop.mutate().catch(() => {});
	},
});
const pointer =
	document.body.dataset.kind === "border"
		? client.codexSession.computerPointer.subscribe(undefined, {
				onData: view.pointer,
				onError: () => view.pointer(null),
			})
		: undefined;
window.addEventListener("beforeunload", () => {
	subscription.unsubscribe();
	pointer?.unsubscribe();
	view.dispose();
});
