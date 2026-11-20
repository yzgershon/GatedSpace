import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionPermissionRequests } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionPermissionRequests";
import type { ClaudePermissionRequest } from "../../src/shared/claude-session/events";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { fixture } from "./fixture-client";
import "../../src/renderer/globals.css";

document.documentElement.classList.add("dark");
for (const [name, value] of Object.entries(draculaTheme.ui))
	document.documentElement.style.setProperty(`--${name}`, value);
Object.assign(window, { questionFixture: fixture });
function App() {
	const [requests, setRequests] = useState<ClaudePermissionRequest[]>([]);
	useEffect(() => fixture.listen(setRequests), []);
	return (
		<main
			style={{
				width: "min(100%, 600px)",
				margin: "32px auto",
				overflow: "auto",
				maxHeight: "calc(100vh - 64px)",
			}}
		>
			<SessionPermissionRequests
				sessionKey="question-fixture"
				requests={requests}
			/>
		</main>
	);
}
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
