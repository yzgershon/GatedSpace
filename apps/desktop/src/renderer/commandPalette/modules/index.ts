import { subscribeToCommandHistory } from "renderer/lib/command-history-snapshot";
import { registerProvider } from "../core/registry";
import { actionsProvider } from "./actions/commands";
import { historyProvider } from "./history/commands";
import { navigationProvider } from "./navigation/commands";
import { openInProvider } from "./openIn/commands";
import { workspaceProvider } from "./workspace/commands";

export function registerAllModules(): () => void {
	const unregisters = [
		registerProvider(workspaceProvider),
		registerProvider(actionsProvider),
		registerProvider(openInProvider),
		registerProvider(navigationProvider),
		registerProvider(historyProvider),
	];

	// Shell history arrives asynchronously, and providers are read through a
	// `useSyncExternalStore` snapshot that only changes when the provider set
	// does. Re-registering under the same id rebuilds that snapshot, which is
	// the supported way to tell the palette its data moved. The snapshot store
	// only notifies on a real change, so this cannot loop.
	const unsubscribeHistory = subscribeToCommandHistory(() => {
		registerProvider(historyProvider);
	});

	return () => {
		unsubscribeHistory();
		for (const u of unregisters) u();
	};
}
