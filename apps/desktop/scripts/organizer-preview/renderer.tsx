import { Toaster } from "@superset/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SidebarSessionsPanel } from "../../src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarPanels/SidebarSessionsPanel";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import "../../src/renderer/globals.css";
import "./style.css";
for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
function Preview() {
	const [opened, setOpened] = useState("");
	return (
		<main className="organizer-preview">
			<header>
				<span>GatedSpace / Interactive preview</span>
				<h1>A place for every conversation.</h1>
				<p>
					Drag pins into order. Create a project, then drag sessions into it or
					use their menus. Refresh to check that your organization stays put.
				</p>
			</header>
			<div className="organizer-preview-layout">
				<aside>
					<SidebarSessionsPanel
						onOpenSession={(session) => setOpened(session.title)}
					/>
				</aside>
				<section className="organizer-preview-notes">
					<span className="preview-caption">YOUR WORKFLOW</span>
					<h2>Keep the important work close.</h2>
					<p>
						<strong>Pinned</strong> is your quick-access list. Its order stays
						yours, even when an agent is busy.
					</p>
					<p>
						<strong>Projects</strong> hold related Claude and Codex sessions
						together. A pinned session can also belong to a project.
					</p>
					<p>
						<strong>Unsorted</strong> catches conversations you haven’t filed
						yet. Removing a project sends its conversations here.
					</p>
					<p className="preview-note">
						This preview uses sample sessions and isolated storage. Your actual
						sessions are unchanged.
					</p>
					<output>
						{opened
							? `Selected: ${opened}`
							: "Try the sidebar. Every control is interactive."}
					</output>
				</section>
			</div>
			<Toaster />
		</main>
	);
}
const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(
	<QueryClientProvider client={new QueryClient()}>
		<Preview />
	</QueryClientProvider>,
);
