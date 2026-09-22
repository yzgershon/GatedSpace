import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import {
	Check,
	ChevronDown,
	ListChecks,
	ShieldCheck,
	SlidersHorizontal,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { SessionEffortSlider } from "../../src/renderer/components/SessionEffortControl";

const modes = [
	{
		name: "Auto",
		description: "Work with approval when needed",
		icon: SlidersHorizontal,
	},
	{
		name: "Plan",
		description: "Think through the approach first",
		icon: ListChecks,
	},
	{
		name: "Full access",
		description: "Work without approval prompts",
		icon: ShieldCheck,
	},
];

export function ComposerSettings({
	provider,
}: {
	provider: "claude" | "codex";
}) {
	const models =
		provider === "codex"
			? ["GPT-6 Astra", "GPT-5.6 Sol"]
			: ["Claude Opus", "Claude Sonnet"];
	const [model, setModel] = useState(models[0]);
	const [mode, setMode] = useState("Auto");
	const [effort, setEffort] = useState("xhigh");
	const [fast, setFast] = useState(false);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="preview-model-trigger"
					aria-label={`${model} settings`}
					title={`${mode} · ${fast ? "Fast on" : "Standard speed"}`}
				>
					{fast && <Zap size={12} className="preview-fast-indicator" />}
					<span>{model}</span>
					<ChevronDown size={13} />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				sideOffset={10}
				className="preview-settings"
				aria-label={`${provider === "codex" ? "Codex" : "Claude"} model and mode`}
			>
				<div className="preview-model-row">
					<label htmlFor={`${provider}-model`}>Model</label>
					<div className="preview-model-select">
						<select
							id={`${provider}-model`}
							value={model}
							onChange={(e) => setModel(e.target.value)}
						>
							{models.map((name) => (
								<option key={name}>{name}</option>
							))}
						</select>
						<ChevronDown size={12} aria-hidden="true" />
					</div>
				</div>
				<div
					className="preview-mode-list"
					role="radiogroup"
					aria-label="Session mode"
				>
					{modes.map(({ name, description, icon: Icon }) => (
						<label key={name} data-selected={mode === name}>
							<input
								type="radio"
								name={`${provider}-mode`}
								value={name}
								checked={mode === name}
								onChange={() => setMode(name)}
							/>
							<Icon size={16} />
							<span>
								<strong>{name}</strong>
								<small>{description}</small>
							</span>
							<Check
								size={14}
								className="preview-mode-check"
								aria-hidden="true"
							/>
						</label>
					))}
				</div>
				<div className="preview-settings-effort">
					<SessionEffortSlider
						value={effort}
						options={["low", "medium", "high", "xhigh", "max"]}
						onChange={setEffort}
						model={model}
						compact
						fast={fast}
						onFastChange={setFast}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
