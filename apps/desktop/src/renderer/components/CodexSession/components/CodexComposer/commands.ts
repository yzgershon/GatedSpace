export const CODEX_COMMANDS = [
	{ name: "/model", description: "Choose a model", insert: "/model " },
	{
		name: "/effort",
		description: "Change reasoning effort",
		insert: "/effort ",
	},
	{
		name: "/permissions",
		description: "Choose default, read-only, or full-access",
		insert: "/permissions ",
	},
	{
		name: "/review",
		description: "Review uncommitted changes",
		insert: "/review",
	},
	{
		name: "/compact",
		description: "Compact this conversation",
		insert: "/compact",
	},
	{
		name: "/skills",
		description: "Browse installed skills",
		insert: "/skills",
	},
	{
		name: "/status",
		description: "Show this session's model and settings",
		insert: "/status",
	},
	{ name: "/help", description: "Show available commands", insert: "/help" },
] as const;

export function parseCodexCommand(message: string) {
	const match = message.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
	return match
		? { name: match[1].toLowerCase(), args: match[2]?.trim() ?? "" }
		: null;
}
