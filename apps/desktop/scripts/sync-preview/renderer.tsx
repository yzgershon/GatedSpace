import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { createRoot } from "react-dom/client";
import { electronTrpc } from "../../src/renderer/lib/electron-trpc";
import { SyncSettings } from "../../src/renderer/routes/_authenticated/settings/account/components/AccountSettings/components/SyncSettings";
import "../../src/renderer/globals.css";
import "./style.css";
const mode = new URLSearchParams(location.search).get("mode");
const state = {
	connected: mode !== "disconnected",
	key: mode !== "disconnected",
	pending: false,
	automatic: true,
	conflict: mode === "conflict",
	restored: false,
};
const id = "22222222-2222-4222-8222-222222222222";
const title = "GatedSpace — startup, mobile, and continuity";
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const client = electronTrpc.createClient({
	links: [
		() =>
			({ op }) =>
				observable((observer) => {
					const input = op.input as Record<string, unknown> | undefined;
					let result: unknown;
					switch (op.path) {
						case "continuity.status":
							result = {
								origin: "https://gatedspace-sync.vercel.app",
								deviceName: "LAPTOP",
								account: state.connected
									? {
											email: "owner@example.com",
											connected: true,
											hasRecoveryKey: state.key,
										}
									: null,
								pending: state.pending
									? {
											code: "DEMO-1234",
											url: "https://example.invalid",
											expiresAt: Date.now() + 300000,
										}
									: null,
								error: null,
							};
							break;
						case "continuity.transferStatus":
							result = {
								busy: false,
								error: null,
								result: state.conflict ? { sent: 0, conflicts: [id] } : null,
								queued: state.conflict ? 1 : 0,
								bindings: state.key
									? [
											{
												streamId: id,
												provider: "codex",
												sessionId: id,
												title,
												project: "C:/Projects/GatedSpace",
												revision: 4,
												sourceStamp: "",
												autoSync: state.automatic,
												updatedAt: new Date().toISOString(),
											},
										]
									: [],
							};
							break;
						case "continuity.sessions":
							result = [
								{
									sessionId: id,
									title,
									provider: "codex",
									cwd: "C:/Projects/GatedSpace",
								},
								{
									sessionId: "33333333-3333-4333-8333-333333333333",
									title: "Filtrsoft — inventory review",
									provider: "claude",
									cwd: "C:/Projects/Filtrsoft",
								},
							];
							break;
						case "continuity.available":
							result = [
								{
									id,
									revision: 5,
									updatedAt: new Date().toISOString(),
									provider: "codex",
									title,
									projectName: "GatedSpace",
									fileCount: 312,
								},
							];
							break;
						case "continuity.connect":
							state.pending = true;
							result = {};
							break;
						case "continuity.openSignIn":
							result = {};
							break;
						case "continuity.cancel":
							state.pending = false;
							result = {};
							break;
						case "continuity.disconnect":
							state.connected = false;
							result = {};
							break;
						case "continuity.setRecoveryKey":
							state.key = true;
							result = {};
							break;
						case "continuity.exportRecoveryKey":
							result = { saved: true };
							break;
						case "continuity.send":
							result = { canceled: false, result: { sent: 1, conflicts: [] } };
							break;
						case "continuity.automatic":
							state.automatic = Boolean(input?.enabled);
							result = {};
							break;
						case "continuity.retry":
						case "continuity.syncNow":
							state.conflict = false;
							result = { sent: 1, conflicts: [] };
							break;
						case "continuity.restore":
							state.restored = true;
							state.conflict = false;
							result = {
								sessionId: id,
								provider: "codex",
								cwd: "C:/Projects/Restored",
								title,
							};
							break;
						default:
							observer.error(new Error(`Unimplemented fixture: ${op.path}`));
							return;
					}
					observer.next({ result: { data: result } });
					observer.complete();
				}),
	],
});
function Preview() {
	return (
		<electronTrpc.Provider client={client} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<main className="preview-shell">
					<header>
						<p className="text-xs tracking-widest text-muted-foreground">
							INTERACTIVE PREVIEW · NO REAL TRANSFERS
						</p>
						<h1 className="mt-3 text-2xl font-semibold">
							Account & continuity
						</h1>
						<nav
							aria-label="Preview scenarios"
							className="mt-4 flex flex-wrap gap-4 text-sm"
						>
							<a href="/?mode=disconnected">Disconnected</a>
							<a href="/">Connected</a>
							<a href="/?mode=conflict">Conflicting edits</a>
							<button
								type="button"
								onClick={() => {
									state.connected = true;
									state.pending = false;
									state.key = false;
									void queryClient.invalidateQueries();
								}}
							>
								Simulate browser approval
							</button>
						</nav>
					</header>
					<SyncSettings />
				</main>
			</QueryClientProvider>
		</electronTrpc.Provider>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
