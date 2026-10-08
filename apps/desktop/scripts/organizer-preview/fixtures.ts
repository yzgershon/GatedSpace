export const sampleSessions = [
	["codex", "GatedSpace improvements", "superset", true],
	["claude", "Filtrsoft reliability audit", "filtrsoft", true],
	["codex", "Sortie syllabus workflow", "sortie", true],
	["claude", "School presentation research", "school", false],
	["codex", "Preview sizing and responsive layouts", "superset", false],
	["claude", "Mobile sign-in investigation", "superset", false],
	[
		"codex",
		"Session naming and keeping titles consistent across all devices",
		"superset",
		false,
	],
	["claude", "Weekend ideas", "notes", false],
].map(([provider, title, folder, pinned], i) => ({
	provider: provider as "claude" | "codex",
	title: String(title),
	pinned: Boolean(pinned),
	archived: false,
	sessionId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
	cwd: `C:/Dev/${folder}`,
	lastModified: Date.now() - (i + 1) * 600_000,
}));
