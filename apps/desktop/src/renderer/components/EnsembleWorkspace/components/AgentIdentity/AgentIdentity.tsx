import {
	claudeIcon as claude,
	codexIcon as codex,
} from "@superset/ui/icons/preset-icons";

export function AgentIdentity({
	provider,
	size = 26,
}: {
	provider: "claude" | "codex";
	size?: number;
}) {
	return (
		<img
			className="en-provider"
			src={provider === "claude" ? claude : codex}
			width={size}
			height={size}
			alt={provider === "claude" ? "Claude Code" : "Codex"}
			draggable={false}
		/>
	);
}
