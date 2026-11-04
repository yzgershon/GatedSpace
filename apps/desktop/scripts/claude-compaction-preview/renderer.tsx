import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { createRoot } from "react-dom/client";
import { electronTrpc } from "../../src/renderer/lib/electron-trpc";
import { ClaudeCompactionSettings } from "../../src/renderer/routes/_authenticated/settings/agents/components/ClaudeCompactionSettings/ClaudeCompactionSettings";
import {
	type ClaudeCompactionState,
	claudeCompactionPreference,
} from "../../src/shared/claude-compaction";
import "../../src/renderer/globals.css";
import "../sync-preview/style.css";

let state: ClaudeCompactionState = {
	preference: { mode: "off" },
	savedPreference: null,
	accounts: ["Personal", "Work"].map((label) => ({
		label,
		preference: { mode: "off" },
	})),
};
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const client = electronTrpc.createClient({
	links: [
		() =>
			({ op }) =>
				observable((observer) => {
					if (op.path === "claudeCompaction.set") {
						if (location.search.includes("error")) {
							observer.error(
								new Error(
									"Couldn't save Claude compaction settings. Previous settings were restored.",
								),
							);
							return;
						}
						const preference = claudeCompactionPreference.parse(op.input);
						state = {
							preference,
							savedPreference: preference,
							accounts: state.accounts.map((account) => ({
								...account,
								preference,
							})),
						};
					}
					observer.next({ result: { data: state } });
					observer.complete();
				}),
	],
});
const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(
	<electronTrpc.Provider client={client} queryClient={queryClient}>
		<QueryClientProvider client={queryClient}>
			<main className="preview-shell">
				<p className="mb-6 text-xs text-muted-foreground">
					Settings preview · simulated saving · your accounts are unchanged
				</p>
				<h1 className="text-xl font-semibold mb-5">Agents / Claude Code</h1>
				<ClaudeCompactionSettings />
			</main>
		</QueryClientProvider>
	</electronTrpc.Provider>,
);
