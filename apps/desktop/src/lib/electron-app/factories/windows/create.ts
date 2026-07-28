import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import { registerRoute } from "lib/window-loader";
import { crashSentinel } from "main/lib/crash-sentinel";
import type { WindowProps } from "shared/types";

export function createWindow({ id, ...settings }: WindowProps) {
	const window = new BrowserWindow(settings);

	/**
	 * Tell the crash sentinel the user is actually here.
	 *
	 * This separates "crashed on startup" from "crashed during use", which are
	 * different bugs with different suspects. Real keyboard and mouse input is
	 * the only unambiguous signal: a tRPC mutation looked tempting, but the app
	 * fires plenty of those restoring state before anyone has touched it, which
	 * would mark every startup crash as a mid-session one.
	 *
	 * `noteActivity` is a latch — it returns immediately once set — so this
	 * costs one boolean check per event rather than a write per keystroke. It
	 * records THAT something happened, never what.
	 */
	window.webContents.on("input-event", () => {
		crashSentinel.noteActivity();
	});

	// Open external URLs in the system browser instead of Electron
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("http://") || url.startsWith("https://")) {
			shell.openExternal(url);
			return { action: "deny" };
		}
		return { action: "deny" };
	});

	registerRoute({
		id,
		browserWindow: window,
		htmlFile: join(__dirname, "../renderer/index.html"),
	});

	window.on("closed", window.destroy);

	return window;
}
