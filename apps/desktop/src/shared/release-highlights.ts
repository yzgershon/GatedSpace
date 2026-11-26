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
	{
		version: "1.18.61",
		title: "A calmer workspace, easier to write in",
		changes: [
			{
				title: "Focus is easier to see",
				detail:
					"Codex panes use the blue from their icon. Only the focused pane highlights its composer, keeping the rest of your workspace quiet.",
			},
			{
				title: "Tab names fit properly",
				detail:
					"Selected names show up to 15 characters before an ellipsis, including at larger display scales. Tighter spacing and a subtle hover keep tab targets steady.",
			},
			{
				title: "Attachments stay within reach",
				detail:
					"Shorter image cards stay inside your composer. Scroll across all your attachments with a mouse wheel or trackpad, even in narrow panes.",
			},
			{
				title: "Autocorrect, without another service",
				detail:
					"Common English typos are corrected locally while you type. Press Backspace immediately or Ctrl+Z to undo. Turn autocorrect off in Settings, General.",
			},
		],
	},
	{
		version: "1.18.62",
		title: "Better together, at any size",
		changes: [
			{
				title: "Bring sessions into one tab",
				detail:
					"Drag a floating tab into another session to combine their panes. Dropping into an expanded pane now reveals the whole group instead of hiding the incoming sessions.",
			},
			{
				title: "Rounded panes, even at their smallest",
				detail:
					"Pane frames keep their rounded corners when resized to the minimum width or height, including at larger display scales.",
			},
			{
				title: "A quieter rail and closer previews",
				detail:
					"The floating rail has a subtle gray border. Hover previews fit their thumbnail without empty side gutters, with the agent icon and tab name centered above it.",
			},
		],
	},
	{
		version: "1.18.63",
		title: "An easier start, smoother long conversations",
		changes: [
			{
				title: "A guide through your first workspace",
				detail:
					"Getting started walks you through your GatedSpace account, agent sign-in, project folder, and first session. Install missing agents from the app and return to the guide whenever you need it.",
			},
			{
				title: "Reliable local projects and account setup",
				detail:
					"Local projects open without requiring cloud services. Account settings clearly separate your GatedSpace connection from Claude and Codex sign-ins, and newly installed agents become available without restarting.",
			},
			{
				title: "Computer control prepares its own tools",
				detail:
					"When you enable computer control, GatedSpace can prepare its required runtime automatically. Progress, cancellation, and retry stay in the app, with no manual terminal setup.",
			},
			{
				title: "Long Claude sessions resize more smoothly",
				detail:
					"Recent messages display first, with Load earlier messages at the top for older history. Claude keeps its full session context and saved conversation; this does not compact or delete anything.",
			},
		],
	},
	{
		version: "1.18.64",
		title: "Answer questions without interrupting your work",
		changes: [
			{
				title: "Answer Claude's clarifying questions",
				detail:
					"Choose an option, select multiple answers, or type your own response. Send answer delivers your answers to Claude instead of treating the question as a tool permission.",
			},
			{
				title: "Dismiss a question or send a new direction",
				detail:
					"Claude and Codex questions have a Dismiss question action. You can also send a new direction from the main composer while a question is waiting. Dismissing never grants tool permission.",
			},
			{
				title: "Keep working across panes",
				detail:
					"Questions no longer pull focus away while you type or paste in another pane. Queued messages can be sent during a pending question, and failed Claude sends preserve your draft and attachments.",
			},
		],
	},
	{
		version: "1.18.65",
		title: "A clearer, faster GatedSpace on your phone",
		changes: [
			{
				title: "Readable conversations and accurate progress",
				detail:
					"Mobile replies display formatted text, with command code behind expandable details. Recent messages load first, earlier history stays available, and finished Claude turns stop showing as working.",
			},
			{
				title: "Photos that attach and preview",
				detail:
					"Attach up to 20 images, 5 MB each, with visible preparation and previews. Large-image validation, retry feedback, and the phone keyboard layout are repaired. The Home Screen app uses the GatedSpace logo.",
			},
			{
				title: "Answer questions from your phone",
				detail:
					"Claude and Codex question controls support answers and dismissal. Background updates preserve your selected choices, typed answers, and focus.",
			},
			{
				title: "Recover model selections and close split previews",
				detail:
					"Refresh available Codex models and recover from an unavailable selection while keeping your reasoning preference. Each split browser pane now has its own close button, so the other pane stays open.",
			},
		],
	},
	{
		version: "1.18.66",
		title: "Meet GatedDuet",
		changes: [
			{
				title: "A calmer mobile conversation",
				detail:
					"GatedDuet replaces the mobile companion with quieter reply bubbles, a compact navigation dock, and a recent-session menu. Tool traces and repeated message labels stay out of the conversation.",
			},
			{
				title: "Keep directing your agents",
				detail:
					"Send messages and photos while Claude or Codex is working. Mobile messages steer the active turn, and switching conversations preserves your drafts.",
			},
			{
				title: "Tasks, saved work, and themes",
				detail:
					"Organize conversations into channels, track tasks, and save useful replies from the conversation menu. Choose a theme, text size, and motion preference in the new settings sheet.",
			},
		],
	},
	{
		version: "1.18.67",
		title: "Return straight to your workspace",
		changes: [
			{
				title: "Reliable session restoration",
				detail:
					"Large profile pictures no longer interrupt sign-in. Your personal installation remembers its workspace so temporary local-service failures do not send you back to the welcome screen. Signing out clears the saved identity.",
			},
		],
	},
	{
		version: "1.18.68",
		title: "Clearer recovery and computer control",
		changes: [
			{
				title: "Pick up when your usage resets",
				detail:
					"Claude and Codex both mark usage-limited sessions red. Continue session explains how to resume the same conversation, and Auto-continue at reset can make one attempt when your allowance returns while GatedSpace stays open.",
			},
			{
				title: "See computer control at work",
				detail:
					"A glowing GatedSpace cursor marker and softer screen-edge glow show when desktop control is active. The compact toolbar adds Return to session and shortcuts beside Stop, with fewer duplicate captures and clearer approval status.",
			},
			{
				title: "Quieter updates, useful details",
				detail:
					"Automatic Claude effort confirmations stay out of your conversation. What's New now presents compact illustrated cards, keyboard navigation, and more detail when you want it.",
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
