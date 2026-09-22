import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import "./session-welcome.css";

const PROMPTS = [
	"Explain this codebase",
	"Review my changes",
	"Plan a feature",
];
export function SessionWelcome({
	provider,
	onSuggest,
	connecting = false,
}: {
	provider: "claude" | "codex";
	onSuggest: (text: string) => void;
	connecting?: boolean;
}) {
	const icon = usePresetIcon(provider);
	return (
		<div className="session-welcome">
			{icon && (
				<img src={icon} alt={provider === "codex" ? "Codex" : "Claude"} />
			)}
			<p>{connecting ? "Connecting…" : "Start a session"}</p>
			<span>Ask to make changes or run /commands.</span>
			<div className="session-starters">
				{PROMPTS.map((prompt) => (
					<button key={prompt} type="button" onClick={() => onSuggest(prompt)}>
						{prompt}
					</button>
				))}
			</div>
		</div>
	);
}
