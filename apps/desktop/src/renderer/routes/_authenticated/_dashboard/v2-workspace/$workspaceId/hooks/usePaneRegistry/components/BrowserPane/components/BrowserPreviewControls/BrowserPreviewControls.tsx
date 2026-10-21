import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import {
	ChevronDown,
	Monitor,
	PanelsTopLeft,
	RotateCw,
	Smartphone,
} from "lucide-react";
import {
	type BrowserPreviewMode,
	type BrowserPreviewOrientation,
	browserPreviewSize,
} from "shared/browser-preview";

const modes = [
	{
		value: "responsive",
		label: "Responsive",
		description: "Follow the panel width",
		icon: PanelsTopLeft,
	},
	{
		value: "desktop",
		label: "Desktop",
		description: "1280 × 800",
		icon: Monitor,
	},
	{
		value: "galaxy-s24",
		label: "Galaxy S24",
		description: "360 × 780 · 3× density",
		icon: Smartphone,
	},
] as const;

export function BrowserPreviewControls({
	mode,
	orientation,
	scale,
	onChange,
}: {
	mode: BrowserPreviewMode;
	orientation: BrowserPreviewOrientation;
	scale: number;
	onChange: (
		mode: BrowserPreviewMode,
		orientation: BrowserPreviewOrientation,
	) => void;
}) {
	const size = browserPreviewSize(mode, orientation);
	const selected = modes.find((option) => option.value === mode) ?? modes[0];
	const Icon = selected.icon;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="gs-browser-preview-controls"
					aria-label="Preview size"
					title={`Preview size: ${selected.label}`}
					data-mode={mode}
				>
					<Icon size={15} aria-hidden="true" />
					<ChevronDown size={9} aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={8}
				className="gs-browser-preview-menu"
			>
				<DropdownMenuLabel>Preview size</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={mode}
					onValueChange={(value) => {
						if (
							value === "responsive" ||
							value === "desktop" ||
							value === "galaxy-s24"
						)
							onChange(value, orientation);
					}}
				>
					{modes.map(({ value, label, description, icon: DeviceIcon }) => (
						<DropdownMenuRadioItem
							key={value}
							value={value}
							aria-label={label}
							className="gs-browser-preview-option"
						>
							<DeviceIcon size={16} aria-hidden="true" />
							<span>
								<span>{label}</span>
								<small>{description}</small>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{mode === "galaxy-s24" && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							aria-label="Rotate Galaxy S24"
							onSelect={() =>
								onChange(
									mode,
									orientation === "portrait" ? "landscape" : "portrait",
								)
							}
						>
							<RotateCw size={16} aria-hidden="true" />
							Rotate Galaxy S24
							<span className="ml-auto text-xs text-muted-foreground">
								{orientation === "portrait" ? "Portrait" : "Landscape"}
							</span>
						</DropdownMenuItem>
					</>
				)}
				<DropdownMenuSeparator />
				<div className="gs-browser-preview-summary">
					<span>
						{size ? `${size.width} × ${size.height}` : "Fits the panel"}
					</span>
					{size && <span>Fit {Math.round(scale * 100)}%</span>}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
