/**
 * Independent size control for the two halves of the window.
 *
 * The app already responds to Electron's window zoom, but that scales
 * everything at once. The request this answers is the other one: make the
 * session smaller without making the workspace list smaller, or the reverse.
 */
import { Button } from "@superset/ui/button";
import { Slider } from "@superset/ui/slider";
import {
	DEFAULT_UI_SCALE,
	formatUiScale,
	MAX_UI_SCALE,
	MIN_UI_SCALE,
	UI_SCALE_STEP,
	useUiScaleStore,
} from "renderer/stores/ui-scale";

function ScaleRow({
	label,
	description,
	value,
	onChange,
}: {
	label: string;
	description: string;
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<div className="flex items-center gap-4">
			<div className="w-44 shrink-0">
				<div className="text-sm">{label}</div>
				<div className="text-xs text-muted-foreground">{description}</div>
			</div>
			<Slider
				value={[value]}
				min={MIN_UI_SCALE}
				max={MAX_UI_SCALE}
				step={UI_SCALE_STEP}
				onValueChange={([next]) => {
					if (next !== undefined) onChange(next);
				}}
				aria-label={label}
				className="flex-1"
			/>
			<span className="w-12 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
				{formatUiScale(value)}
			</span>
		</div>
	);
}

export function ScaleSection() {
	const mainScale = useUiScaleStore((state) => state.mainScale);
	const sidebarScale = useUiScaleStore((state) => state.sidebarScale);
	const setMainScale = useUiScaleStore((state) => state.setMainScale);
	const setSidebarScale = useUiScaleStore((state) => state.setSidebarScale);
	const reset = useUiScaleStore((state) => state.reset);

	const isDefault =
		mainScale === DEFAULT_UI_SCALE && sidebarScale === DEFAULT_UI_SCALE;

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-base font-medium">Interface Scale</h3>
				<p className="text-sm text-muted-foreground mt-1">
					Size each part of the window on its own. This is separate from the
					window zoom, which scales everything together.
				</p>
			</div>

			<div className="space-y-4">
				<ScaleRow
					label="Main area"
					description="Tabs, sessions, and panes"
					value={mainScale}
					onChange={setMainScale}
				/>
				<ScaleRow
					label="Left sidebar"
					description="Projects and workspaces"
					value={sidebarScale}
					onChange={setSidebarScale}
				/>
			</div>

			<Button variant="outline" size="sm" onClick={reset} disabled={isDefault}>
				Reset to 100%
			</Button>
		</div>
	);
}
