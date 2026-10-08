import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageQueue } from "../../src/renderer/components/SessionComposerControls/MessageQueue/MessageQueue";
import { useMessageQueue } from "../../src/renderer/components/SessionComposerControls/MessageQueue/useMessageQueue";
import { useQueuedMessageEdit } from "../../src/renderer/components/SessionComposerControls/MessageQueue/useQueuedMessageEdit";
import { SidebarSessionsPanel } from "../../src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarPanels/SidebarSessionsPanel";
import { DashboardSidebarProjectRow } from "../../src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarProjectSection/components/DashboardSidebarProjectRow/DashboardSidebarProjectRow";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import "../../src/renderer/globals.css";
import "../../src/renderer/components/SessionComposerControls/session-composer.css";
import "./style.css";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
function Preview() {
	const [provider, setProvider] = useState<"claude" | "codex">("codex");
	const [message, setMessage] = useState("");
	const [workspaceOpen, setWorkspaceOpen] = useState(true);
	const [workspacePinned, setWorkspacePinned] = useState(false);
	const [opened, setOpened] = useState("");
	const queue = useMessageQueue(provider);
	const editor = useQueuedMessageEdit({
		key: provider,
		queue,
		read: () =>
			provider === "claude"
				? { provider, text: message }
				: {
						provider,
						text: message,
						model: "model",
						effort: "high",
						permission: "default",
					},
		write: (prompt) => setMessage(prompt.text),
		focus: () =>
			document
				.querySelector<HTMLTextAreaElement>(
					'textarea[aria-label="Message draft"]',
				)
				?.focus(),
	});
	return (
		<main className="collections-check">
			<header>
				<h1>Collections</h1>
				<p>Production components · isolated sample conversations</p>
			</header>
			<div className="check-grid">
				<aside>
					<SidebarSessionsPanel
						onOpenSession={(session) =>
							setOpened(`${session.title} · ${session.mode}`)
						}
						onResumeInTerminal={(session) => setOpened(session.command)}
					/>
				</aside>
				<section className="check-conversation">
					<h2>{opened || "GatedSpace Edits"}</h2>
					<p>
						Queued messages stay close to the composer. Edit a message, remove
						it, or send it into the current turn.
					</p>
					<div className="check-project">
						<div className="workspace-collection">
							<button
								type="button"
								className="workspace-collection-pin"
								aria-label="Pin project"
								aria-pressed={workspacePinned}
								onClick={() => setWorkspacePinned(!workspacePinned)}
							>
								⌖
							</button>
							<DashboardSidebarProjectRow
								projectName="GatedSpace"
								iconUrl={null}
								totalWorkspaceCount={2}
								isCollapsed={!workspaceOpen}
								isRenaming={false}
								renameValue=""
								onRenameValueChange={() => {}}
								onSubmitRename={() => {}}
								onCancelRename={() => {}}
								onStartRename={() => {}}
								onToggleCollapse={() => setWorkspaceOpen(!workspaceOpen)}
								onNewWorkspace={() => setOpened("New workspace")}
							/>
							{workspaceOpen && (
								<div className="check-branches">
									⌘ local
									<br />└ windows-port
								</div>
							)}
						</div>
					</div>
					<div className="check-provider">
						<button type="button" onClick={() => setProvider("codex")}>
							Codex composer
						</button>
						<button type="button" onClick={() => setProvider("claude")}>
							Claude composer
						</button>
					</div>
					<div className="session-composer-area">
						<MessageQueue
							key={provider}
							queue={queue}
							provider={provider}
							editor={editor}
						/>
						<div className="session-composer">
							<textarea
								aria-label="Message draft"
								placeholder="Add your next message…"
								value={message}
								onChange={(e) => setMessage(e.target.value)}
							/>
							<div className="session-composer-toolbar">
								<span>{provider === "codex" ? "GPT-6 Astra" : "Claude"}</span>
								<button
									type="button"
									disabled={!message.trim()}
									onClick={async () => {
										await (editor.id ? editor.save : queue.enqueue)(
											provider === "claude"
												? { provider, text: message }
												: {
														provider,
														text: message,
														model: "model",
														effort: "high",
														permission: "default",
													},
										);
										if (!editor.id) setMessage("");
									}}
								>
									{editor.id ? "Save queued message" : "Queue message"}
								</button>
							</div>
						</div>
					</div>
				</section>
			</div>
		</main>
	);
}
const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(
	<QueryClientProvider
		client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
	>
		<TooltipProvider>
			<Preview />
		</TooltipProvider>
	</QueryClientProvider>,
);
