import "../../src/renderer/globals.css";
import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { SidebarSessionsPanel } from "../../src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarPanels/SidebarSessionsPanel";
import { ProjectThumbnail } from "../../src/renderer/routes/_authenticated/components/ProjectThumbnail";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
document.documentElement.style.setProperty(
	"--font-sans",
	"Segoe UI, sans-serif",
);
document.body.style.cssText =
	"margin:0;background:var(--background);color:var(--foreground);font-family:Segoe UI,sans-serif";
const root = document.createElement("main");
document.body.append(root);
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
createRoot(root).render(
	<QueryClientProvider client={client}>
		<TooltipProvider>
			<div
				style={{
					display: "flex",
					gap: 24,
					padding: 24,
					height: "100vh",
					boxSizing: "border-box",
				}}
			>
				<section
					style={{
						width: 250,
						background: "var(--sidebar)",
						borderRadius: 12,
						padding: 12,
					}}
				>
					<h2 style={{ fontSize: 14 }}>Workspaces</h2>
					{["Agent studio", "Development", "Research"].map((name) => (
						<div
							key={name}
							style={{
								display: "flex",
								gap: 10,
								alignItems: "center",
								height: 46,
							}}
						>
							<ProjectThumbnail projectName={name} />
							{name}
						</div>
					))}
				</section>
				<section
					style={{ width: 280, background: "var(--sidebar)", borderRadius: 12 }}
				>
					<SidebarSessionsPanel
						onOpenSession={(request) => {
							const output = document.querySelector("output");
							if (output) output.textContent = JSON.stringify(request);
						}}
					/>
				</section>
				<output
					style={{ whiteSpace: "pre-wrap", maxWidth: 300, fontSize: 13 }}
				/>
			</div>
		</TooltipProvider>
	</QueryClientProvider>,
);
