import { Sparkles } from "lucide-react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";

/** Identifies the provider even after the session is renamed. */
export function SessionPaneIcon({
	agentId = "claude",
}: {
	/** Which agent this pane runs. */
	agentId?: string;
}) {
	const iconSrc = usePresetIcon(agentId);

	if (!iconSrc) {
		// No icon for this agent id. A sparkle is still a better "something AI is
		// here" than a broken image, which is what a bare <img> would give.
		return <Sparkles className="size-4 shrink-0" />;
	}

	return (
		<img
			src={iconSrc}
			alt={agentId === "codex" ? "Codex" : "Claude Code"}
			title={agentId === "codex" ? "Codex session" : "Claude Code session"}
			className="size-4 shrink-0"
			draggable={false}
		/>
	);
}
