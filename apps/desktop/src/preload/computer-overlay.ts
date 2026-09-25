import { contextBridge, ipcRenderer } from "electron";

// Keep the standard trpc-electron bridge self-contained. Importing its shared
// preload chunk requires a relative Node module, which a sandboxed preload
// cannot load. This window exposes only the existing tRPC transport.
contextBridge.exposeInMainWorld("electronTRPC", {
	sendMessage: (message: unknown) => ipcRenderer.send("trpc-electron", message),
	onMessage: (callback: (message: unknown) => void) => {
		ipcRenderer.on("trpc-electron", (_event, message: unknown) =>
			callback(message),
		);
	},
});
