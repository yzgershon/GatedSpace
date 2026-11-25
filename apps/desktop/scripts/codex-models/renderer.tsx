import "../../src/renderer/globals.css";
import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { CodexSession } from "../../src/renderer/components/CodexSession/CodexSession";
import { useThemeStore } from "../../src/renderer/stores/theme";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";

for (const [key, value] of Object.entries(draculaTheme.ui)) {
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
			value,
		);
}
document.documentElement.classList.add("dark");
useThemeStore.getState().setTheme(draculaTheme.id);
document.body.style.cssText =
	"margin:0;background:var(--background);font-family:Segoe UI,sans-serif";
const root = document.createElement("main");
root.style.cssText =
	"height:100vh;max-width:850px;margin:auto;background:var(--card);display:flex;flex-direction:column";
document.body.append(root);
createRoot(root).render(
	<QueryClientProvider client={new QueryClient()}>
		<TooltipProvider>
			<CodexSession
				paneId="fixture"
				resumeSessionId="thread-fixture"
				cwd="C:/Dev/superset"
				onSessionId={() => {}}
			/>
		</TooltipProvider>
	</QueryClientProvider>,
);
