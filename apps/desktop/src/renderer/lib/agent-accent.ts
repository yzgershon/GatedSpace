/**
 * The colour that identifies each agent in pane chrome.
 *
 * These are the ONLY chroma in an otherwise greyscale app shell, so they are
 * doing real work rather than decoration: at a glance you can tell which of
 * four panes is Claude and which is Codex without reading any of them.
 *
 * Chosen against the actual brand each agent is known by, so the mapping is
 * guessable rather than arbitrary, then held to a mid-range lightness so the
 * same value survives both the light and dark theme. A colour that reads
 * correctly on one theme and vanishes on the other is worse than no colour,
 * because it looks like a rendering fault rather than a choice.
 *
 * Not every pane gets one. A plain shell, a file viewer, a diff — those have
 * nothing to identify, and they keep the neutral header. That is a deliberate
 * look, not a gap, which is why the fallback is `undefined` rather than grey:
 * a grey bar would imply an agent whose colour failed to load.
 */

const AGENT_ACCENTS: Record<string, string> = {
	claude: "#d97757",
	codex: "#10a37f",
	copilot: "#8b5cf6",
	gemini: "#4285f4",
	"cursor-agent": "#06b6d4",
	droid: "#f59e0b",
	amp: "#ec4899",
	opencode: "#22c55e",
	mastracode: "#a855f7",
	pi: "#eab308",
	vibe: "#fb7185",
	glm: "#3b82f6",
	kimi: "#14b8a6",
	polygraph: "#94a3b8",
};

/**
 * The accent for an agent id, or undefined when there is nothing to identify.
 *
 * Unknown ids return undefined rather than a generated colour: a user-defined
 * agent getting a stable-but-meaningless hue would be indistinguishable from a
 * built-in one, and the point of this is that the colour MEANS something.
 */
export function agentAccent(agentId: string | undefined): string | undefined {
	if (!agentId) return undefined;
	return AGENT_ACCENTS[agentId];
}

/** Exposed for the settings/preview surfaces that list every agent. */
export const AGENT_ACCENT_IDS = Object.keys(AGENT_ACCENTS);
