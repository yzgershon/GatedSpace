import { cn } from "@superset/ui/utils";
import { useState } from "react";
import { projectAccent, projectInitial } from "./project-accent";

interface ProjectThumbnailProps {
	projectName: string;
	iconUrl?: string | null;
	className?: string;
}

/**
 * A project's mark in the sidebar: its own icon when it has one, otherwise a
 * coloured initial.
 *
 * The fallback used to be a grey square with a hard border, which made a list of
 * five projects read as five identical placeholders with the letter doing all
 * the work of telling them apart. The colour is derived from the name (see
 * `project-accent.ts`), so it needs no setup and is the same on every machine
 * that opens the same project.
 *
 * `rounded-md` rather than `rounded-sm`, and no border on the coloured version —
 * an outline around a saturated fill reads as a sticker. The image version keeps
 * a hairline ring, because a pale favicon needs an edge to sit against on a
 * similarly pale surface.
 */
export function ProjectThumbnail({
	projectName,
	iconUrl,
	className,
}: ProjectThumbnailProps) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);

	if (iconUrl && failedUrl !== iconUrl) {
		return (
			<div
				className={cn(
					"relative size-6 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10",
					className,
				)}
			>
				<img
					src={iconUrl}
					alt={`${projectName} icon`}
					className="size-full object-cover"
					onError={() => setFailedUrl(iconUrl)}
				/>
			</div>
		);
	}

	const accent = projectAccent(projectName);

	return (
		<div
			// The name is always rendered as text beside this, so the letter is
			// decoration and announcing it would just repeat the row.
			aria-hidden
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-md",
				"font-semibold text-[11px] leading-none",
				className,
			)}
			style={{ backgroundColor: accent.background, color: accent.foreground }}
		>
			{projectInitial(projectName)}
		</div>
	);
}
