import { createRoot } from "react-dom/client";
import { BrowserTabIcon } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/BrowserTabIcon";
import {
	type PersistableBrowserState,
	browserRuntimeRegistry as registry,
} from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistry";

const iconElement = document.getElementById("icon");
const pageElement = document.getElementById("page");
if (!iconElement || !pageElement) throw new Error("Missing fixture containers");
const icon = createRoot(iconElement);
const persistedStates: PersistableBrowserState[] = [];
const persist = (data: PersistableBrowserState) => {
	persistedStates.push(data);
	icon.render(<BrowserTabIcon data={data} />);
};
Object.assign(window, {
	faviconTest: {
		open: (url: string, saved?: Partial<PersistableBrowserState>) => {
			registry.attach("test", pageElement, url, persist, saved);
		},
		navigate: (url: string) => registry.navigate("test", url),
		reload: () => registry.reload("test"),
		state: () => registry.getState("test"),
		history: persistedStates,
		registry,
	},
});
