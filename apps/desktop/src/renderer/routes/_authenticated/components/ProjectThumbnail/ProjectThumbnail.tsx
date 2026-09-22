import { cn } from "@superset/ui/utils";
import { Bot } from "lucide-react";
import { useState } from "react";

interface ProjectThumbnailProps {
	projectName: string;
	iconUrl?: string | null;
	className?: string;
}

/** Custom project art wins; mixed-agent workspaces use a theme-colored assistant mark. */
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

	return (
		<div
			// The adjacent project name provides the accessible label.
			aria-hidden
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-md",
				"text-primary/80",
				className,
			)}
		>
			<Bot className="size-full" strokeWidth={1.65} />
		</div>
	);
}
