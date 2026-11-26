import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodexUsageRecovery } from "../../src/renderer/components/CodexSession/components/CodexUsageRecovery";
import { ClaudeUsageRecovery } from "../../src/renderer/components/UsageRecoveryPanel/components/ClaudeUsageRecovery";
import { deriveSessionPaneStatus } from "../../src/renderer/hooks/useSessionPaneStatuses/deriveSessionPaneStatus";
import type { CodexSessionState } from "../../src/shared/codex-session/types";
import { fixture } from "./fixture-client";
import "../../src/renderer/globals.css";
import "../sync-preview/style.css";
import "./style.css";
Object.assign(window, { usageFixture: fixture });
function App() {
	const [, render] = useState(0);
	useEffect(() => fixture.listen(() => render((n) => n + 1)), []);
	const state = {
		key: "codex",
		usageRecovery: fixture.recoveries.codex,
	} as CodexSessionState;
	return (
		<main className="usage-preview">
			<header>
				<h1>Continue after a usage limit</h1>
				<p>
					Interactive preview · Simulated limits. No messages are sent to an
					agent.
				</p>
				<button type="button" onClick={() => fixture.reset()}>
					Reset preview
				</button>
			</header>
			<div className="usage-preview-grid">
				{(["codex", "claude"] as const).map((provider) => (
					<article key={provider} id={provider}>
						<h2>
							<span
								data-status={deriveSessionPaneStatus({
									activity: {
										status: "error",
										turnKey: "seen",
										usageBlocked: Boolean(fixture.recoveries[provider]),
									},
									seenTurn: "seen",
								})}
							/>
							{provider === "codex"
								? "Codex · API cleanup"
								: "Claude · Layout review"}
						</h2>
						<div className="preview-conversation">
							<p>
								The remaining changes are ready to finish when the account is
								available again.
							</p>
							<p className="text-muted-foreground">
								The conversation and its files stay in place.
							</p>
						</div>
						{fixture.recoveries[provider] ? (
							provider === "codex" ? (
								<CodexUsageRecovery state={state} />
							) : fixture.recoveries.claude ? (
								<ClaudeUsageRecovery
									paneId="claude"
									recovery={fixture.recoveries.claude}
								/>
							) : null
						) : (
							<p className="preview-resumed">
								Continuation requested in this conversation.
							</p>
						)}
						<textarea
							aria-label={`${provider} composer`}
							placeholder="Keep typing in any pane…"
						/>
						<button
							className="preview-send"
							type="button"
							onClick={() => {
								fixture.calls.push({
									provider,
									action: "composer",
									input: null,
								});
								fixture.emit();
							}}
						>
							Send draft
						</button>
					</article>
				))}
			</div>
		</main>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
