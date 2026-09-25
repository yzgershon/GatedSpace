import { Monitor, RotateCw, Smartphone } from "lucide-react";
import {
	type BrowserPreviewMode,
	type BrowserPreviewOrientation,
	browserPreviewSize,
} from "shared/browser-preview";

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
	const Icon = mode === "galaxy-s24" ? Smartphone : Monitor;
	return (
		<div className="gs-browser-preview-controls">
			<Icon size={14} aria-hidden="true" />
			<select
				aria-label="Preview device"
				value={mode}
				onChange={(event) =>
					onChange(event.target.value as BrowserPreviewMode, orientation)
				}
			>
				<option value="responsive">Responsive</option>
				<option value="desktop">Desktop</option>
				<option value="galaxy-s24">Galaxy S24</option>
			</select>
			<span
				className="gs-browser-preview-dimensions"
				title={
					mode === "galaxy-s24"
						? "Samsung Galaxy S24 · 1080 × 2340 pixels · 3× pixel density"
						: undefined
				}
			>
				{size ? `${size.width} × ${size.height}` : "Panel size"}
			</span>
			{size && (
				<span className="gs-browser-preview-fit">
					Fit {Math.round(scale * 100)}%
				</span>
			)}
			{mode === "galaxy-s24" && (
				<button
					type="button"
					aria-label="Rotate Galaxy S24"
					title="Rotate Galaxy S24"
					onClick={() =>
						onChange(
							mode,
							orientation === "portrait" ? "landscape" : "portrait",
						)
					}
				>
					<RotateCw size={14} />
				</button>
			)}
		</div>
	);
}
