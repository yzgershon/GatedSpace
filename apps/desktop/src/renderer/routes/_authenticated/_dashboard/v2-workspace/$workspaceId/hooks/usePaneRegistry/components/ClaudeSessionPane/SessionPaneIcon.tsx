import { Sparkles } from "lucide-react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";

/**
 * The session pane's header mark: the agent's own logo.
 *
 * This pane used to show a generic sparkle, which said "AI" and nothing else —
 * beside a terminal pane that already showed the real Claude or Codex logo (see
 * `TerminalPaneIcon`), it read as the one pane that hadn't been finished.
 *
 * Goes through the same preset-icon lookup as the terminal pane rather than
 * importing the Claude SVG directly. A session runs the `claude` binary today,
 * so the agent is a constant — but routing it through the shared table means
 * the day another CLI gets a session pane, its logo appears here for free, and
 * the fallback below is the one place that has to be right for all of them.
 */
export function SessionPaneIcon({
	agentId = "claude",
}: {
	/** Which agent this pane runs. Constant today; a prop for when it isn't. */
	agentId?: string;
}) {
	const iconSrc = usePresetIcon(agentId);

	if (!iconSrc) {
		// No icon for this agent id. A sparkle is still a better "something AI is
		// here" than a broken image, which is what a bare <img> would give.
		return <Sparkles className="size-3.5 shrink-0" />;
	}

	return (
		<img
			src={iconSrc}
			alt=""
			title="Claude Code session"
			className="size-3.5 shrink-0"
			draggable={false}
		/>
	);
}
