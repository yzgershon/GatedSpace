import { BUILTIN_AGENT_LABELS } from "@superset/shared/agent-catalog";
import { TerminalSquare } from "lucide-react";
import { useTerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { agentAccent } from "renderer/lib/agent-accent";

interface TerminalPaneIconProps {
	workspaceId: string;
	terminalId: string;
}

/**
 * A terminal pane always looks like a TERMINAL, tinted by whatever is running
 * in it.
 *
 * It used to swap in the agent's own logo once host-service detected one, which
 * made a Claude running in a terminal identical to a Claude session pane — same
 * mark, same colour, different thing entirely. In the tab rail, where the mark
 * is all a collapsed tab has, the two were indistinguishable.
 *
 * So the glyph stays the terminal square and the AGENT becomes its colour:
 * orange for Claude, each of the others their own. Shape says what kind of pane
 * it is, colour says what is running inside it, and neither has to carry both.
 */
export function TerminalPaneIcon({
	workspaceId,
	terminalId,
}: TerminalPaneIconProps) {
	const binding = useTerminalAgentBinding(workspaceId, terminalId);
	const agentId = binding?.agentId;
	const accent = agentAccent(agentId);

	const label = agentId
		? (agentId in BUILTIN_AGENT_LABELS &&
				BUILTIN_AGENT_LABELS[agentId as keyof typeof BUILTIN_AGENT_LABELS]) ||
			agentId
		: undefined;

	return (
		<span
			className="flex shrink-0 items-center"
			title={label ? `Terminal — ${label}` : "Terminal"}
		>
			<TerminalSquare
				className="size-3.5 shrink-0"
				// An agent with no accent of its own keeps the inherited colour rather
				// than falling back to a shared one, which would say "some agent" and
				// mean nothing.
				style={accent ? { color: accent } : undefined}
			/>
		</span>
	);
}
