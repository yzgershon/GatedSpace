/**
 * The escape hatch for the agent toolbar.
 *
 * The only other way to turn it off is the gear ON the toolbar itself — so
 * turning it off removed the control that turns it back on. There was no way
 * back short of editing preferences by hand, which is not a setting, it is a
 * trap. Anything that can hide its own switch needs a switch somewhere else.
 */
import { Switch } from "@superset/ui/switch";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";

export function AgentToolbarSection() {
	const { preferences, setShowPresetsBar } = useV2UserPreferences();

	return (
		<div className="flex items-start justify-between gap-6">
			<div className="min-w-0">
				<div className="font-medium text-sm">Agent toolbar</div>
				<p className="mt-1 text-muted-foreground text-sm">
					The row of agent buttons — Claude, Codex, Gemini and the rest. Under
					Liquid Glass it sits centred in the title bar; under VS Code Style it
					has its own row. Its gear can hide it, and only this can bring it
					back.
				</p>
			</div>
			<Switch
				aria-label="Show the agent toolbar"
				checked={preferences.showPresetsBar}
				className="mt-1 shrink-0"
				onCheckedChange={setShowPresetsBar}
			/>
		</div>
	);
}
