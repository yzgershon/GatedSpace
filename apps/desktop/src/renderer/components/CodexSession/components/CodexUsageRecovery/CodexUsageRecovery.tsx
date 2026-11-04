import { useState } from "react";
import { AccountSwapDialog } from "renderer/components/ClaudeAccountSwap/AccountSwapDialog";
import { useFocusedSession } from "renderer/stores/focused-session";
import type { CodexSessionState } from "shared/codex-session/types";

export function CodexUsageRecovery({ state }: { state: CodexSessionState }) {
	const [dismissed, setDismissed] = useState<string>();
	const [requested, setRequested] = useState(false);
	const focused = useFocusedSession(
		(value) => value.session?.paneId === state.key,
	);
	const incident = state.usageLimit;
	if (!incident) return null;
	const open = requested || (focused && dismissed !== incident.id);
	return (
		<>
			<output className="mx-3 mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs">
				<span>Account usage limit reached. This conversation is saved.</span>
				<button
					type="button"
					className="rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => setRequested(true)}
				>
					Switch account
				</button>
			</output>
			{open && (
				<AccountSwapDialog
					initialProvider="codex"
					paneKey={state.key}
					usageLimit
					onClose={() => {
						setDismissed(incident.id);
						setRequested(false);
					}}
				/>
			)}
		</>
	);
}
