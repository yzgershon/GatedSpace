import { cn } from "@superset/ui/utils";
import { useId } from "react";

interface SupersetLogoProps {
	className?: string;
	gradient?: boolean;
}

// The GatedMind "Watchman" — a gatekeeper's helm with two eye-slits, cut as
// negative space so it adapts to light/dark themes. `gradient` keeps the
// session-restore shimmer.
export function SupersetLogo({
	className,
	gradient = false,
}: SupersetLogoProps) {
	const reactId = useId();
	const gradientId = `gatedmind-logo-gradient-${reactId}`;

	return (
		<svg
			width="60"
			height="72"
			viewBox="22 18 56 68"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={cn("text-foreground", className)}
			aria-label="GatedSpace"
		>
			<title>GatedSpace</title>
			{gradient && (
				<defs>
					<linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
						<stop offset="45%" stopColor="currentColor" stopOpacity="0.45" />
						<stop offset="50%" stopColor="currentColor" stopOpacity="1" />
						<stop offset="55%" stopColor="currentColor" stopOpacity="0.45" />
						<stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
						<animate
							attributeName="x1"
							values="-100%;100%;100%"
							keyTimes="0;0.55;1"
							dur="1.6s"
							repeatCount="indefinite"
						/>
						<animate
							attributeName="x2"
							values="0%;200%;200%"
							keyTimes="0;0.55;1"
							dur="1.6s"
							repeatCount="indefinite"
						/>
					</linearGradient>
				</defs>
			)}
			<path
				fillRule="evenodd"
				fill={gradient ? `url(#${gradientId})` : "currentColor"}
				d="M28 82 V46 A22 22 0 0 1 72 46 V82 Z M34 53 H47 V62 H34 Z M53 53 H66 V62 H53 Z"
			/>
		</svg>
	);
}
