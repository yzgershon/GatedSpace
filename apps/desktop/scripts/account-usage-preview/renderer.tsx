import "../../src/renderer/globals.css";
import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ClaudeAccountSwapHost } from "renderer/components/ClaudeAccountSwap/ClaudeAccountSwapHost";
import { CodexSession } from "renderer/components/CodexSession/CodexSession";
import { DashboardSidebarUsageBar } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarUsageBar/DashboardSidebarUsageBar";
import { UsageDialog } from "renderer/routes/_authenticated/_dashboard/components/UsageDialog/UsageDialog";
import { SessionAccountChip } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionAccountChip";
import { getSessionSnapshot } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/sessionStore";
import { useFocusedSession } from "renderer/stores/focused-session";
import { useThemeStore } from "renderer/stores/theme";
import { draculaTheme } from "shared/themes/built-in/dracula";
import { quotaFixture } from "./fixture";

for (const [key, value] of Object.entries(draculaTheme.ui)) {
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
}
document.documentElement.classList.add("dark");
useThemeStore.getState().setTheme(draculaTheme.id);
useFocusedSession.getState().set({ paneId: "fixture", provider: "codex" });
// Fixture-only snapshot, representing the config directory reported by a running Claude process.
getSessionSnapshot("claude-fixture").accountConfigDir =
	"fixture/claude-writing";
document.body.style.cssText =
	"margin:0;background:var(--background);font-family:Inter,Segoe UI,sans-serif";
const root = document.createElement("div");
document.body.append(root);
function Preview() {
	const [usage, setUsage] = useState(false);
	return (
		<div className="flex h-screen min-w-0 flex-col gap-3 p-3">
			<header className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
				<strong className="text-foreground">Account switching</strong>
				<span>Interactive preview · simulated accounts</span>
				<button
					type="button"
					className="rounded-md border px-3 py-2 hover:bg-accent"
					onClick={() => setUsage(true)}
				>
					Usage
				</button>
				<button
					type="button"
					className="rounded-md border px-3 py-2 hover:bg-accent"
					onClick={quotaFixture}
				>
					Simulate usage limit
				</button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
				<aside className="flex shrink-0 flex-col gap-4 rounded-xl bg-card p-3 sm:w-64">
					<SessionAccountChip paneId="claude-fixture" compact />
					<DashboardSidebarUsageBar />
				</aside>
				<div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
					<CodexSession
						paneId="fixture"
						cwd="C:/Dev/superset"
						onSessionId={() => {}}
					/>
				</div>
			</div>
			<UsageDialog open={usage} onOpenChange={setUsage} />
			<ClaudeAccountSwapHost />
		</div>
	);
}
createRoot(root).render(
	<QueryClientProvider
		client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
	>
		<TooltipProvider>
			<Preview />
		</TooltipProvider>
	</QueryClientProvider>,
);
