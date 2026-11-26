import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CompactSessionRows } from "../../src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/CompactWorkspaceSessions/CompactSessionRows";
import { CompactWorkspaceHeader } from "../../src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/CompactWorkspaceSessions/CompactWorkspaceHeader";
import { WorkspaceSidebarSection } from "../../src/renderer/routes/_authenticated/settings/appearance/components/AppearanceSettings/components/WorkspaceSidebarSection";
import { useWorkspaceRecency } from "../../src/renderer/stores/workspace-recency";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import "../../src/renderer/globals.css";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
const icon =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Ccircle cx='9' cy='9' r='8' fill='%23948cff'/%3E%3C/svg%3E";
const session = (id: string, title: string) => ({
	id,
	title,
	icon,
	status: "idle",
	statusLabel: "Idle",
});
function Fixture() {
	const [collapsed, setCollapsed] = useState(false);
	const [selection, setSelection] = useState("");
	const openedAt = useWorkspaceRecency((state) => state.openedAt);
	const recentFirst = useWorkspaceRecency((state) => state.recentFirst);
	const open = (id: string) => {
		useWorkspaceRecency.getState().markOpened("dev");
		setSelection(id);
	};
	return (
		<main style={{ padding: 18 }}>
			<aside
				style={{
					width: "min(300px, calc(100vw - 36px))",
					background: "var(--sidebar)",
					borderRadius: 12,
					padding: 6,
				}}
			>
				<CompactWorkspaceHeader
					project={{
						name: "Dev",
						isCollapsed: collapsed,
						onToggle: () => setCollapsed(!collapsed),
						onNewWorkspace: () => setSelection("new"),
						actions: (
							<button
								type="button"
								aria-label="Workspace actions"
								onClick={() => setSelection("actions")}
							>
								…
							</button>
						),
					}}
					active
					branch="local"
					onOpen={() => open("workspace")}
				/>
				{!collapsed && (
					<CompactSessionRows
						groups={[
							{
								id: "gs",
								title: "GS Edits",
								isActive: true,
								sessions: [session("gs-pane", "GS Edits")],
							},
							{
								id: "college",
								title: "College",
								isActive: false,
								sessions: [
									session("codex", "College Codex"),
									session("claude", "College Claude"),
									session("resume", "Resume review"),
								],
							},
							{
								id: "long",
								title:
									"A long workspace session title that should fit inside the sidebar",
								isActive: false,
								sessions: [session("long-pane", "A long workspace session")],
							},
						]}
						onSelect={open}
					/>
				)}
			</aside>
			<section style={{ maxWidth: 500, marginTop: 24 }}>
				<WorkspaceSidebarSection />
			</section>
			<output data-testid="selection">{selection}</output>
			<output data-testid="recency">{openedAt.dev ?? 0}</output>
			<output data-testid="recent-first">{String(recentFirst)}</output>
		</main>
	);
}
const container = document.createElement("div");
document.body.append(container);
createRoot(container).render(<Fixture />);
