import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodexApprovalCard } from "renderer/components/CodexSession/components/CodexApprovalCard/CodexApprovalCard";
import { CodexComposer } from "renderer/components/CodexSession/components/CodexComposer/CodexComposer";
import { SessionComposer } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionComposer";
import { SessionPermissionRequests } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionPermissionRequests";
import type { ClaudePermissionRequest } from "shared/claude-session/events";
import type { CodexSessionState } from "shared/codex-session/types";
import { draculaTheme } from "shared/themes/built-in/dracula";
import { fixture } from "./fixture-client";
import "renderer/globals.css";
import "renderer/components/CodexSession/codex-session.css";
import "renderer/components/SessionComposerControls/session-composer.css";

document.documentElement.classList.add("dark");
for (const [key, value] of Object.entries(draculaTheme.ui))
	document.documentElement.style.setProperty(`--${key}`, value);
Object.assign(window, { interactionFixture: fixture });
const client = new QueryClient();
function App() {
	const [, render] = useState(0);
	const [requests, setRequests] = useState<ClaudePermissionRequest[]>([]);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => fixture.listen(() => render((n) => n + 1)), []);
	useEffect(() => fixture.claude.listen(setRequests), []);
	const state = (key: string): CodexSessionState => ({
		key,
		cwd: "fixture",
		threadId: key,
		title: key,
		status: key === "question-codex" ? "working" : "idle",
		model: "gpt-6-astra",
		effort: "high",
		items: [],
		approvals:
			key === "question-codex" && fixture.approval ? [fixture.approval] : [],
		error: null,
		turnId: "turn",
		historyCursor: null,
		diff: "",
		contextTokens: 0,
		contextWindow: 200000,
	});
	return (
		<main
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
				gap: 16,
				padding: 16,
				height: "100vh",
			}}
		>
			{["question-codex", "question-claude", "other-codex"].map((key) => (
				<section
					key={key}
					id={key}
					className="codex-native"
					style={{
						border: "1px solid var(--border)",
						borderRadius: 16,
						overflow: "hidden",
					}}
				>
					<h2 style={{ padding: 12 }}>{key}</h2>
					<div
						style={{ flex: 1, minHeight: 0, overflow: "auto" }}
						className="codex-question-dock"
					>
						{key === "question-codex" && fixture.approval && (
							<CodexApprovalCard sessionKey={key} approval={fixture.approval} />
						)}
						{key === "question-claude" && (
							<SessionPermissionRequests
								sessionKey="question-fixture"
								requests={requests}
							/>
						)}
					</div>
					{key === "question-claude" ? (
						<SessionComposer
							draftKey={key}
							model="opus"
							status="streaming"
							hasPendingQuestion={requests.some(
								(r) => r.tool === "AskUserQuestion",
							)}
							slashCommands={[]}
							mode="manual"
							effort="high"
							onSend={(text) => fixture.send({ key, text })}
							onInterrupt={() => {}}
							onModeChange={() => {}}
							onEffortChange={() => {}}
						/>
					) : (
						<CodexComposer
							paneId={key}
							state={state(key)}
							models={[
								{
									id: "gpt-6-astra",
									name: "Astra",
									efforts: ["high"],
									defaultEffort: "high",
								},
							]}
							onError={setError}
						/>
					)}
				</section>
			))}
			{error && <p role="alert">{error}</p>}
		</main>
	);
}
createRoot(document.getElementById("root") as HTMLElement).render(
	<TooltipProvider>
		<QueryClientProvider client={client}>
			<App />
		</QueryClientProvider>
	</TooltipProvider>,
);
