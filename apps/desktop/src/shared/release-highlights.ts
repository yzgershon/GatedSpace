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
