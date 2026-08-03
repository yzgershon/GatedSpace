// Which raw IPC channels the renderer may touch.
//
// `window.ipcRenderer` used to forward any channel name straight to
// ipcRenderer.invoke/send/on. contextIsolation stops a page reaching Node, but
// it does not stop it reaching a bridge we handed it — so any script running
// in the renderer could address every channel in the process, including the
// ones @sentry/electron and trpc-electron register for their own use, and any
// internal Electron channel. That turns a single XSS into a general-purpose
// lever on the main process.
//
// Primary IPC is tRPC (exposeElectronTRPC), which has its own channel and is
// unaffected by any of this. What is left is one receive-only channel, so the
// allowlist is short and closed by default: a channel absent from these lists
// is refused.

/** Main -> renderer. Deep links arrive here after the OS hands us a URL. */
export const RECEIVE_CHANNELS = new Set<string>(["deep-link-navigate"]);

/**
 * Renderer -> main.
 *
 * `tanstack-db:sqlite-persistence` is the TanStack DB SQLite persistence
 * bridge: `exposeElectronSQLitePersistence` registers the ipcMain handler in
 * main/lib/persistence, and CollectionsProvider/collections.ts drives it from
 * the renderer through `window.ipcRenderer.invoke`. It is the app's only raw
 * invoke channel — everything else goes through tRPC.
 *
 * A string literal because the package does not export
 * DEFAULT_ELECTRON_PERSISTENCE_CHANNEL from its public entrypoints. If a
 * future version changes that default, persistence throws on its first
 * request and the error names the channel to add here.
 *
 * This list started empty, on the reasoning that the app registers no ipcMain
 * handlers — which a grep for `ipcMain.handle` across apps/desktop appeared to
 * confirm. The handler is registered inside the npm package, not by app code,
 * so the grep never saw it and the closed list broke every collection write.
 * Grep the dependencies too before concluding a channel is unused.
 */
export const INVOKE_CHANNELS = new Set<string>([
	"tanstack-db:sqlite-persistence",
]);

/** Nothing uses fire-and-forget send. Closed by default. */
export const SEND_CHANNELS = new Set<string>();

export type IpcDirection = "invoke" | "send" | "receive";

function allowlistFor(direction: IpcDirection): Set<string> {
	if (direction === "invoke") return INVOKE_CHANNELS;
	if (direction === "send") return SEND_CHANNELS;
	return RECEIVE_CHANNELS;
}

export function isChannelAllowed(
	direction: IpcDirection,
	channel: unknown,
): boolean {
	if (typeof channel !== "string") return false;
	return allowlistFor(direction).has(channel);
}

/**
 * Throws on a refused channel rather than failing quietly.
 *
 * If a feature ever does need raw IPC, the right outcome is a loud error
 * naming the channel — add it to the list above — not a call that silently
 * does nothing and takes an afternoon to track down.
 */
export function assertChannelAllowed(
	direction: IpcDirection,
	channel: unknown,
): asserts channel is string {
	if (isChannelAllowed(direction, channel)) return;
	throw new Error(
		`[preload] refused ${direction} on IPC channel ${JSON.stringify(channel)}. ` +
			`Add it to ${direction.toUpperCase()}_CHANNELS in preload/ipc-allowlist.ts if it is genuinely needed.`,
	);
}
