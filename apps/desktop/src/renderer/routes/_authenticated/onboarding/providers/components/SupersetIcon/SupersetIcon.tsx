import { cn } from "@superset/ui/utils";

interface SupersetIconProps {
	className?: string;
}

// The GatedMind "Watchman" helm (same mark as SupersetLogo) — replaces the
// upstream Superset wordmark, which is not ours to ship.
export function SupersetIcon({ className }: SupersetIconProps) {
	return (
		<svg
			viewBox="22 18 56 68"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={cn("text-[#eae8e6]", className)}
			aria-label="GatedSpace"
		>
			<title>GatedSpace</title>
			<path
				fillRule="evenodd"
				fill="currentColor"
				d="M28 82 V46 A22 22 0 0 1 72 46 V82 Z M34 53 H47 V62 H34 Z M53 53 H66 V62 H53 Z"
			/>
		</svg>
	);
}
