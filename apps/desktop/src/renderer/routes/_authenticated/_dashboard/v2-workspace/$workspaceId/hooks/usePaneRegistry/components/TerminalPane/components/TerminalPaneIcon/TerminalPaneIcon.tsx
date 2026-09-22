import { BUILTIN_AGENT_LABELS } from "@superset/shared/agent-catalog";
import { TerminalSquare } from "lucide-react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import { useTerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { agentAccent } from "renderer/lib/agent-accent";

interface TerminalPaneIconProps {
	workspaceId: string;
	terminalId: string;
	/** Header identity; floating tabs retain the terminal glyph. */
	showAgent?: boolean;
	agentId?: string;
}

/** Headers identify the running agent; floating tabs keep a distinct terminal mark. */
export function TerminalPaneIcon({
	workspaceId,
	terminalId,
	showAgent = false,
	agentId: initialAgentId,
}: TerminalPaneIconProps) {
	const binding = useTerminalAgentBinding(workspaceId, terminalId);
	const agentId = binding?.agentId ?? initialAgentId;
	const iconSrc = usePresetIcon(agentId ?? "");
	const accent = agentAccent(agentId);

	const label = agentId
		? (agentId in BUILTIN_AGENT_LABELS &&
				BUILTIN_AGENT_LABELS[agentId as keyof typeof BUILTIN_AGENT_LABELS]) ||
			agentId
		: undefined;

	if (showAgent && iconSrc) {
		return (
			<img
				src={iconSrc}
				alt={label}
				title={`Terminal — ${label}`}
				className="size-4 shrink-0"
				draggable={false}
			/>
		);
	}

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
