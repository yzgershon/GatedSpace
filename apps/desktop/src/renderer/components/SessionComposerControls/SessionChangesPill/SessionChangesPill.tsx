import type { SessionChangeSummary } from "shared/session-changes";
import "./session-changes-pill.css";

export function SessionChangesPill({
	changes,
	provider,
}: {
	changes?: SessionChangeSummary | null;
	provider: "codex" | "claude";
}) {
	if (!changes?.files) return null;
	const known = changes.added !== null && changes.removed !== null;
	return (
		<div className="session-changes-dock" data-provider={provider}>
			<output
				className="session-changes-pill"
				aria-live="polite"
				aria-atomic="true"
				aria-label="Changes in this task"
				title={
					known
						? "Successful file edits in this task"
						: "Successful file edits in this task. Line totals are unavailable for some edits."
				}
			>
				<span>
					{changes.files} {changes.files === 1 ? "file" : "files"} changed
				</span>
				{known && (
					<span className="session-changes-counts">
						<span
							className="session-changes-added"
							title={`${changes.added} lines added`}
						>
							+{changes.added}
						</span>
						<span
							className="session-changes-removed"
							title={`${changes.removed} lines removed`}
						>
							−{changes.removed}
						</span>
					</span>
				)}
			</output>
		</div>
	);
}
