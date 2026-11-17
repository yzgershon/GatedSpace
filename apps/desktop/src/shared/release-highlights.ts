/** Append a release entry when preparing an installer. Never describe previews
 * or unfinished features here: this content ships in public and personal apps. */
export const RELEASE_HIGHLIGHTS = [
	{
		version: "1.18.57",
		title: "A workspace that stays the way you left it",
		changes: [
			{
				title: "Claude models stay current",
				detail:
					"The model picker reads available models from your installed Claude runtime, so newly supported models can appear without another GatedSpace update.",
			},
			{
				title: "Every tab has its own layout",
				detail:
					"Resize or arrange panes independently. Wider divider targets and fewer updates during dragging keep resizing responsive.",
			},
			{
				title: "Status rings know when you have caught up",
				detail:
					"Opening a tab clears its completed and failed notices. Questions stay highlighted until answered; running sessions stay yellow.",
			},
			{
				title: "Files attach from the picker or a drop",
				detail:
					"Attach up to 20 images, 5 MB each. Add local documents, source files, or archives as file references with + or drag and drop. The composer waits for attachments to finish before sending.",
			},
		],
	},
	{
		version: "1.18.58",
		title: "Find your place faster",
		changes: [
			{
				title: "More room for your sessions",
				detail:
					"A wider, centered tab rail shows more sessions. Hover names appear beneath stationary tabs. Context counters stay visible in narrow panes, and the build button uses a compact progress ring.",
			},
			{
				title: "Search by what you remember",
				detail:
					"Find files by name or words without typing their full path. Recent sessions can search conversation content, show more rows, and take you straight to a session that is already open.",
			},
			{
				title: "Recognizable browser tabs",
				detail:
					"Website favicons stay with your tabs across reloads and restarts. Closing a tab keeps its neighbor in view. The cleaner address bar includes a working Open in Chrome button for websites and saved previews.",
			},
		],
	},
	{
		version: "1.18.59",
		title: "Your sessions, at a glance",
		changes: [
			{
				title: "Compact tabs with a preview",
				detail:
					"The floating rail fits your tabs, with larger agent icons, a subtle hover lift, and one compact thumbnail of the last viewed tab. Matching pink edges add a soft glow to the rail and composers.",
			},
			{
				title: "Live code is working again",
				detail:
					"Live code follows your session's actual folder, merges duplicate file paths, and keeps readable code available during reconnects. File icons, colored diffs, wrap controls, and smoother resizing make changes easier to follow.",
			},
			{
				title: "Preferences that stay yours",
				detail:
					"Codex model, effort, and Fast mode are remembered when you return to a conversation. Recent-session rows can be dragged directly, leaving more room for their names.",
			},
		],
	},
	{
		version: "1.18.60",
		title: "Speak, open, and pick up where you left off",
		changes: [
			{
				title: "Voice typing is built in",
				detail:
					"Flow dictation is included on Windows ARM64 and x64. Use the microphone in a Claude or Codex composer to turn speech into text locally, with no separate app, account, or first-run download.",
			},
			{
				title: "File links open correctly",
				detail:
					"Pink, underlined file links work in Claude and Codex replies, including Windows paths with spaces and source-line references.",
			},
			{
				title: "Long Claude conversations return intact",
				detail:
					"Restoring a conversation now reads past large image and internal request records so they no longer hide the earlier discussion.",
			},
		],
	},
] as const;

function versionParts(version: string): number[] | null {
	return /^\d+\.\d+\.\d+$/.test(version)
		? version.split(".").map(Number)
		: null;
}

function compareVersions(left: string, right: string): number {
	const a = versionParts(left) ?? [0, 0, 0];
	const b = versionParts(right) ?? [0, 0, 0];
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

export function releaseHighlightsFor(
	version: string,
	seenVersion?: string | null,
) {
	if (!versionParts(version)) return [];
	const shipped = RELEASE_HIGHLIGHTS.filter(
		(entry) => compareVersions(entry.version, version) <= 0,
	);
	if (!seenVersion || !versionParts(seenVersion)) return shipped.slice(-1);
	return shipped.filter(
		(entry) => compareVersions(entry.version, seenVersion) > 0,
	);
}
