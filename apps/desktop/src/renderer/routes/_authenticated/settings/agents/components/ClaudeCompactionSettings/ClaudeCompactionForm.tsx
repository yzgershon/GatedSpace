import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useId, useState } from "react";
import {
	type ClaudeCompactionPreference,
	type ClaudeCompactionState,
	claudeCompactionPreference,
} from "shared/claude-compaction";

interface Props {
	state: ClaudeCompactionState;
	saving: boolean;
	error?: string;
	saved?: boolean;
	onSave: (preference: ClaudeCompactionPreference) => void;
}

export function ClaudeCompactionForm({
	state,
	saving,
	error,
	saved,
	onSave,
}: Props) {
	const id = useId();
	const [mode, setMode] = useState(state.preference?.mode ?? "mixed");
	const [windowK, setWindowK] = useState(
		String(
			state.preference?.mode === "custom"
				? state.preference.windowTokens / 1000
				: 500,
		),
	);
	const parsed = claudeCompactionPreference.safeParse(
		mode === "custom"
			? { mode, windowTokens: Number(windowK) * 1000 }
			: { mode },
	);
	const dirty =
		parsed.success &&
		(JSON.stringify(parsed.data) !== JSON.stringify(state.preference) ||
			JSON.stringify(parsed.data) !== JSON.stringify(state.savedPreference));
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="space-y-3 border-t border-border pt-4"
		>
			<div>
				<h3 id={`${id}-title`} className="text-sm font-medium">
					Automatic compaction
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Choose when Claude summarizes its context and continues working.
				</p>
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 w-52 space-y-1.5">
					<Label htmlFor={`${id}-mode`}>Compaction mode</Label>
					<Select value={mode} onValueChange={setMode} disabled={saving}>
						<SelectTrigger id={`${id}-mode`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{mode === "mixed" && (
								<SelectItem value="mixed" disabled>
									Different account settings
								</SelectItem>
							)}
							<SelectItem value="default">Claude default</SelectItem>
							<SelectItem value="custom">Custom context window</SelectItem>
							<SelectItem value="off">Off · compact manually</SelectItem>
						</SelectContent>
					</Select>
				</div>
				{mode === "custom" && (
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-window`}>
							Context window (thousand tokens)
						</Label>
						<Input
							id={`${id}-window`}
							className="w-36"
							type="number"
							min={100}
							max={1000}
							step="any"
							value={windowK}
							onChange={(event) => setWindowK(event.target.value)}
							disabled={saving}
							aria-invalid={!parsed.success}
							aria-describedby={`${id}-help`}
						/>
					</div>
				)}
				<Button
					size="sm"
					disabled={saving || !parsed.success || !dirty}
					onClick={() => {
						if (parsed.success) onSave(parsed.data);
					}}
				>
					{saving ? "Saving…" : "Save for all accounts"}
				</Button>
			</div>
			<p
				id={`${id}-help`}
				className="text-xs leading-relaxed text-muted-foreground"
			>
				{mode === "custom"
					? "100–1,000k. Start with 500k for a 1M-context model. Claude reserves space for the summary and caps this at the model’s limit. A larger window does not guarantee lower usage."
					: mode === "off"
						? "Automatic and idle compaction are off. Manual /compact remains available. Claude may stop at its context limit until you compact or start a new conversation."
						: mode === "default"
							? "Use Claude’s model-specific default. This clears custom compaction windows for these accounts."
							: "Your accounts or models have different compaction overrides. Choose a mode to apply one setting to all accounts."}
			</p>
			<p className="text-xs leading-relaxed text-muted-foreground">
				Applies to all local Claude accounts, including terminal sessions and
				accounts added later. Running sessions can pick up the settings; if one
				keeps its old behavior, stop and reopen that session. Project or managed
				settings may override this choice.
			</p>
			<p className="text-xs text-muted-foreground">
				Loop protection: native Claude sessions stop after three automatic
				compactions within ten minutes. Their conversations are preserved.
			</p>
			{mode === "custom" && !parsed.success && (
				<p
					role="alert"
					className="text-xs text-destructive select-text cursor-text"
				>
					Enter a window between 100k and 1,000k tokens.
				</p>
			)}
			{error && (
				<p
					role="alert"
					className="text-sm text-destructive select-text cursor-text"
				>
					{error}
				</p>
			)}
			{saved && !dirty && (
				<output className="block text-xs text-muted-foreground">
					Saved for {state.accounts.length}{" "}
					{state.accounts.length === 1 ? "account" : "accounts"}. Existing
					conversations are unchanged.
				</output>
			)}
		</section>
	);
}
