import type { CodexItem } from "../../src/shared/codex-session/types";

const prompts = [
	"Make the workspace panels feel smoother. Keep the selected tab when I reopen the sidebar.",
	"Can we make the composer grow with a long prompt? Keep the controls in place while I write.",
	"Show me what the agent is doing, and collapse its completed work so the conversation stays readable.",
	"Keep my prompt in the conversation. Only show the sticky copy once the original has scrolled out of view.",
	"Add a quiet way to jump between my prompts. I like these little lines along the left edge.",
	"Verify the navigation in a narrow pane, then build my personal installer and the public Windows versions.",
];
const replies = [
	"The panels reopen with your active tab selected and your layout preserved.",
	"The composer expands upward as you type. Longer prompts remain editable without pushing the controls out of reach.",
	"Live activity follows the latest response. Completed commands stay under an expandable summary.",
	"Your original message stays in the conversation. The compact sticky copy follows the task you are reading.",
	"Each mark represents one of your prompts. Hover for a short preview, or click to return to the original message.",
	"I will check the scroll behavior, keyboard navigation, and compact layout before building the installers.",
];
export const navigatorCodexItems: CodexItem[] = prompts.flatMap((text, i) => [
	{
		id: `nav-prompt-${i}`,
		turnId: `nav-turn-${i}`,
		kind: "user",
		title: "",
		text,
	},
	{
		id: `nav-reply-${i}`,
		turnId: `nav-turn-${i}`,
		kind: "assistant",
		title: "",
		text: `${replies[i]}\n\n${Array.from({ length: 5 }, (_, n) => `**Check ${n + 1}**\n\nThe conversation keeps its place while new content arrives. The selected prompt stays visible and the pane controls remain available.`).join("\n\n")}`,
	},
]);
