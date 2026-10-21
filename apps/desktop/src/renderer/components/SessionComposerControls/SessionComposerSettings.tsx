import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import {
	Brain,
	Check,
	ChevronDown,
	Hexagon,
	ListChecks,
	ShieldCheck,
	SlidersHorizontal,
	Terminal,
	Zap,
} from "lucide-react";
import { useId } from "react";
import {
	effortLabel,
	SessionEffortSlider,
} from "renderer/components/SessionEffortControl";
import "./session-composer.css";

export interface ComposerMode {
	id: string;
	label: string;
	description: string;
	kind?: "plan" | "full";
}

export function SessionComposerSettings({
	provider,
	model,
	models,
	onModelChange,
	mode,
	modes,
	onModeChange,
	effort,
	efforts,
	onEffortChange,
	fast,
	onFastChange,
	disabled = false,
	section = "all",
}: {
	provider: string;
	model: string;
	models: { id: string; name: string }[];
	onModelChange?: (value: string) => void;
	mode: string;
	modes: ComposerMode[];
	onModeChange: (value: string) => void;
	effort: string;
	efforts: readonly string[];
	onEffortChange: (value: string) => void;
	fast: boolean;
	onFastChange?: (value: boolean) => void;
	disabled?: boolean;
	/** The split icon layout reuses the same model, mode and effort controls. */
	section?: "all" | "model" | "permissions";
}) {
	const id = useId();
	const name = models.find((m) => m.id === model)?.name || model || provider;
	const modeName = modes.find((m) => m.id === mode)?.label ?? mode;
	const iconLayout = section !== "all";
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={
						iconLayout ? "session-settings-icon" : "session-model-trigger"
					}
					aria-label={
						section === "model"
							? "Model and effort"
							: section === "permissions"
								? "Permissions"
								: `${name} settings`
					}
					title={
						section === "model"
							? `${name} · ${effortLabel(effort)} · ${fast ? "Fast on" : "Standard speed"}`
							: `${modeName} · ${fast ? "Fast on" : "Standard speed"}`
					}
				>
					{section === "model" ? (
						<Brain size={18} aria-hidden="true" />
					) : section === "permissions" ? (
						<span className="session-permissions-symbol" aria-hidden="true">
							<Hexagon size={20} />
							<Terminal size={11} />
						</span>
					) : (
						<>
							{fast && <Zap size={12} className="session-fast-indicator" />}
							<span>{name}</span>
							<ChevronDown size={13} />
						</>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				sideOffset={10}
				className="session-settings"
				aria-label={
					section === "model"
						? `${provider} model and effort`
						: section === "permissions"
							? `${provider} permissions`
							: `${provider} model and mode`
				}
			>
				{section !== "permissions" && (
					<div className="session-model-row">
						<label htmlFor={`${id}-model`}>Model</label>
						<div className="session-model-select">
							<select
								id={`${id}-model`}
								aria-label={`${provider} model`}
								value={model}
								disabled={disabled || !onModelChange}
								onChange={(e) => onModelChange?.(e.target.value)}
							>
								{!models.some((m) => m.id === model) && (
									<option value={model}>{name}</option>
								)}
								{models.map((m) => (
									<option key={m.id} value={m.id}>
										{m.name}
									</option>
								))}
							</select>
							<ChevronDown size={12} aria-hidden="true" />
						</div>
					</div>
				)}
				{section !== "model" && (
					<div
						className="session-mode-list"
						role="radiogroup"
						aria-label="Session mode"
					>
						{modes.map((m) => {
							const Icon =
								m.kind === "plan"
									? ListChecks
									: m.kind === "full"
										? ShieldCheck
										: SlidersHorizontal;
							return (
								<label key={m.id} data-selected={mode === m.id}>
									<input
										type="radio"
										name={`${id}-mode`}
										value={m.id}
										checked={mode === m.id}
										disabled={disabled}
										onChange={() => onModeChange(m.id)}
									/>
									<Icon size={16} />
									<span>
										<strong>{m.label}</strong>
										<small>{m.description}</small>
									</span>
									<Check
										size={14}
										className="session-mode-check"
										aria-hidden="true"
									/>
								</label>
							);
						})}
					</div>
				)}
				{section !== "permissions" && (
					<div className="session-settings-effort">
						<SessionEffortSlider
							value={effort}
							options={efforts}
							onChange={onEffortChange}
							model={name}
							compact
							fast={fast}
							onFastChange={onFastChange}
							disabled={disabled}
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
