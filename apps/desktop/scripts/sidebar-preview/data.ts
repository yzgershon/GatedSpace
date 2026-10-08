export type Provider = "codex" | "claude";
export type Direction = "focus" | "collections" | "activity";
export type Session = {
	id: string;
	title: string;
	project: string;
	provider: Provider;
	status: "working" | "question" | "complete" | "idle";
	pinned: boolean;
	time: string;
	preview: string;
};
export type Workspace = {
	id: string;
	name: string;
	path: string;
	pinned: boolean;
	branches: string[];
};
export const directions: Record<
	Direction,
	{ name: string; description: string }
> = {
	focus: {
		name: "Focus",
		description:
			"A compact list with clear titles and quiet details. Familiar, with less clutter.",
	},
	collections: {
		name: "Collections",
		description:
			"Keep each project together. Expand a workspace or project to see its sessions.",
	},
	activity: {
		name: "Activity",
		description:
			"Questions first, running agents next. Quickly find what needs your attention.",
	},
};
export const initialSessions: Session[] = [
	{
		id: "gs",
		title: "GatedSpace Edits",
		project: "GatedSpace",
		provider: "codex",
		status: "working",
		pinned: true,
		time: "Now",
		preview: "Refining the sidebar and message queue.",
	},
	{
		id: "filtr",
		title: "Filtrsoft reliability audit",
		project: "Filtrsoft",
		provider: "claude",
		status: "question",
		pinned: false,
		time: "2m",
		preview: "Which recovery batch should I run first?",
	},
	{
		id: "jarvis",
		title: "Jarvis voice controls",
		project: "Jarvis",
		provider: "codex",
		status: "complete",
		pinned: true,
		time: "18m",
		preview: "The voice controls are ready to review.",
	},
	{
		id: "mobile",
		title: "Mobile session handoff",
		project: "GatedSpace",
		provider: "claude",
		status: "working",
		pinned: false,
		time: "Now",
		preview: "Checking reconnect behavior on the phone.",
	},
	{
		id: "search",
		title: "Search result ranking",
		project: "Filtrsoft",
		provider: "codex",
		status: "idle",
		pinned: false,
		time: "1h",
		preview: "Compare the latest evaluation results.",
	},
	{
		id: "voice",
		title: "Wake word tuning",
		project: "Jarvis",
		provider: "claude",
		status: "idle",
		pinned: false,
		time: "3h",
		preview: "Review the wake word sensitivity settings.",
	},
	{
		id: "release",
		title: "Installer release checks",
		project: "GatedSpace",
		provider: "codex",
		status: "complete",
		pinned: false,
		time: "Yesterday",
		preview: "The release checks have finished.",
	},
	{
		id: "ideas",
		title: "Product ideas",
		project: "Filtrsoft",
		provider: "claude",
		status: "idle",
		pinned: false,
		time: "Yesterday",
		preview: "Notes for the next iteration.",
	},
];
export const initialWorkspaces: Workspace[] = [
	{
		id: "gatedspace",
		name: "GatedSpace",
		path: "C:\\Dev\\superset",
		pinned: true,
		branches: ["windows-port", "mobile-bridge"],
	},
	{
		id: "filtrsoft",
		name: "Filtrsoft",
		path: "C:\\Dev\\filtrsoft",
		pinned: true,
		branches: ["main", "recovery-audit"],
	},
	{
		id: "jarvis",
		name: "Jarvis",
		path: "C:\\Dev\\AIOS",
		pinned: false,
		branches: ["main"],
	},
];
export const statusLabels = {
	working: "Working",
	question: "Needs your reply",
	complete: "Complete",
	idle: "Idle",
};
