// Only the IPC boundary is simulated. The mounted TopBar, update subscription,
// button, progress ring and active-session confirmation are production code.
import { useEffect, useState } from "react";

let current = { status: "ready", version: "1.18.53" };
const listeners = new Set();
window.updatePreview = {
	busySessions: 0,
	failInstall: false,
	calls: [],
	emit(event) {
		current = event;
		for (const listener of listeners) listener(event);
	},
};

function useSubscription(_input, { onData }) {
	useEffect(() => {
		onData(current);
		listeners.add(onData);
		return () => listeners.delete(onData);
	}, [onData]);
}

function useMutation(path, options = {}) {
	const [isPending, setPending] = useState(false);
	return {
		isPending,
		mutate() {
			window.updatePreview.calls.push(path);
			setPending(true);
			queueMicrotask(() => {
				setPending(false);
				if (path === "autoUpdate.install" && window.updatePreview.failInstall)
					options.onError?.(new Error("Installer could not start"));
			});
		},
	};
}

const branch = (path = []) =>
	new Proxy(() => {}, {
		get: (_, key) => {
			const name = path.join(".");
			if (key === "useQuery")
				return () => ({
					data:
						name === "window.getPlatform"
							? "win32"
							: name === "diagnostics.appVersion"
								? { version: "1.18.52", isDev: false }
								: name === "autoUpdate.checkPersonal"
									? null // Public installers never have a local personal update.
									: undefined,
				});
			if (key === "useMutation") return (options) => useMutation(name, options);
			if (key === "useSubscription") return useSubscription;
			return branch([...path, key]);
		},
	});

export const electronTrpc = branch();
