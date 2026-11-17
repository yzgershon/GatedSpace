import { ipcRenderer } from "electron";

const mutate = (method: string) => ({
	mutate: (input: unknown) => ipcRenderer.invoke("favicon-test", method, input),
});
export const electronTrpcClient = {
	browser: {
		register: mutate("register"),
		unregister: mutate("unregister"),
		favicon: mutate("favicon"),
		setPreview: mutate("setPreview"),
	},
	browserHistory: { upsert: mutate("history") },
};
