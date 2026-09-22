import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { ChevronDown, RotateCcw, Zap } from "lucide-react";
import { type CSSProperties, useState } from "react";
import "./session-effort.css";

export const effortLabel = (value: string) =>
	value === "xhigh"
		? "Extra High"
		: value === "ultracode"
			? "Ultracode"
			: value.charAt(0).toUpperCase() + value.slice(1);

export function SessionEffortSlider({
	value,
	options,
	onChange,
	model,
	defaultValue = "xhigh",
	disabled = false,
	compact = false,
	fast = false,
	onFastChange,
}: {
	value: string;
	options: readonly string[];
	onChange: (value: string) => void;
	model: string;
	defaultValue?: string;
	disabled?: boolean;
	compact?: boolean;
	fast?: boolean;
	onFastChange?: (fast: boolean) => void;
}) {
	const index = Math.max(0, options.indexOf(value));
	const [dragging, setDragging] = useState(false);
	return (
		<div className="session-effort-sheet" data-compact={compact}>
			<div className="session-effort-heading">
				{onFastChange ? (
					<button
						type="button"
						className="session-fast-toggle"
						aria-label="Fast mode"
						aria-pressed={fast}
						aria-description="Faster responses use more usage."
						title={`${fast ? "Turn off" : "Turn on"} Fast mode · uses more usage`}
						disabled={disabled}
						onClick={() => onFastChange(!fast)}
					>
						<Zap size={compact ? 16 : 20} />
					</button>
				) : (
					<Zap size={20} aria-hidden="true" />
				)}
				<div>
					<strong>{effortLabel(value)}</strong>
					<span>{model}</span>
				</div>
				<button
					type="button"
					aria-label="Reset effort to default"
					title={`Reset to ${effortLabel(defaultValue)}`}
					disabled={disabled}
					onClick={() =>
						onChange(
							options.includes(defaultValue)
								? defaultValue
								: (options[options.length - 1] ?? value),
						)
					}
				>
					<RotateCcw size={compact ? 16 : 20} />
				</button>
			</div>
			<div
				className="session-effort-range"
				data-dragging={dragging}
				style={
					{
						"--effort-progress": index / Math.max(1, options.length - 1),
					} as CSSProperties
				}
			>
				<div className="session-effort-fill" />
				<div className="session-effort-stops" aria-hidden="true">
					{options.map((option) => (
						<span key={option} />
					))}
				</div>
				<div className="session-effort-thumb" aria-hidden="true" />
				<input
					type="range"
					aria-label="Reasoning effort"
					aria-valuetext={effortLabel(value)}
					min={0}
					max={Math.max(1, options.length - 1)}
					step={1}
					value={index}
					disabled={disabled || options.length < 2}
					onPointerDown={() => setDragging(true)}
					onPointerUp={() => setDragging(false)}
					onPointerCancel={() => setDragging(false)}
					onBlur={() => setDragging(false)}
					onChange={(event) => {
						const next = options[Number(event.target.value)];
						if (next) onChange(next);
					}}
				/>
			</div>
			{onFastChange && (
				<p className="session-fast-description" data-active={fast}>
					{fast ? "Fast on · uses more usage" : "Fast off · standard usage"}
				</p>
			)}
		</div>
	);
}

export function SessionEffortControl(
	props: Parameters<typeof SessionEffortSlider>[0],
) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="session-effort-trigger"
					disabled={props.disabled}
					aria-label={`Reasoning effort: ${effortLabel(props.value)}`}
				>
					<span>{effortLabel(props.value)}</span>
					<ChevronDown size={13} />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				sideOffset={10}
				className="session-effort-popover"
			>
				<SessionEffortSlider {...props} />
			</PopoverContent>
		</Popover>
	);
}
